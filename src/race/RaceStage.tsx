import { useEffect, useRef } from 'react';
import type { Candidate, GameState, Phase } from '../types';
import { drawHead, drawRunner, star, strideRate, type Expression, type RunnerMood } from './characters';

/**
 * Pista da corrida em Canvas 2D, desenhada no espaço de projeto 1080×1920 e
 * escalada para o tamanho real do overlay. Estádio, pista e corredores são
 * 100% vetoriais e procedurais.
 */

const W = 1080, H = 1920;
const ORDER: Candidate[] = ['lula', 'bolsonaro'];
/** O 13 na raia de trás, o 22 na da frente: profundidade sem sobreposição confusa. */
const LANE: Record<Candidate, { foot: number; size: number }> = {
  lula: { foot: 1168, size: 318 },
  bolsonaro: { foot: 1366, size: 344 }
};
const TRACK_TOP = 1002, TRACK_MID = 1196, TRACK_BOTTOM = 1398;
const PX_PER_M = 30;
const CENTER_X = 540;
const SPREAD_PX = 235;
/** Distância mínima na tela entre os dois corredores. */
const MIN_GAP_PX = 175;

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 'dust' | 'confetti' | 'spark' };

interface RunnerView {
  shown: number;      // progresso exibido, suavizado
  phase: number;      // fase da passada
  lastStep: number;   // para soltar poeira a cada passo
  overtakeUntil: number;
}

function moodFor(game: GameState, phase: Phase, candidate: Candidate): RunnerMood {
  const runner = game[candidate];
  if (phase === 'results' || game.winner) {
    if (game.winner === 'tie') return 'victory';
    return game.winner === candidate ? 'victory' : 'defeat';
  }
  if (phase === 'opening') return 'ready';
  if (phase !== 'live' || !game.active) return phase === 'paused' ? 'ready' : 'idle';
  switch (runner.action) {
    case 'stumble': return 'stumble';
    case 'boost': return 'boost';
    case 'overtake': return 'overtake';
    case 'sprint': return 'sprint';
    case 'celebrate': return 'victory';
    default: return game.finalSprint ? 'sprint' : 'run';
  }
}

// ---------------------------------------------------------------- cenário estático

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function seeded(seed: number) {
  return () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000);
}

const CROWD_COLORS = ['#e3262f', '#e3262f', '#12a14b', '#ffd21f', '#1f46a6', '#f4f4f4', '#ff7a45', '#7b4dd8', '#12a14b', '#ffd21f'];
const SKINS = ['#f2c6a6', '#e0a57f', '#c88660', '#9a6444', '#6e452e'];

/** Arquibancada em dois anéis, com torcedores, desenhada uma vez e repetida. */
function buildStands(): HTMLCanvasElement {
  const width = 1600, height = 420;
  const canvas = makeCanvas(width, height), ctx = canvas.getContext('2d')!;
  const random = seeded(31);
  // concreto e degraus
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#162238');
  base.addColorStop(1, '#22324d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const tier = (top: number, bottom: number, scale: number, dim: number) => {
    const rowHeight = 30 * scale;
    for (let y = top; y < bottom; y += rowHeight) {
      ctx.fillStyle = `rgba(10,16,30,${0.55 + dim * 0.2})`;
      ctx.fillRect(0, y + rowHeight * 0.72, width, rowHeight * 0.28);
      for (let x = (y / rowHeight % 2) * 9 * scale; x < width; x += 19 * scale) {
        if (random() < 0.08) continue;
        const color = CROWD_COLORS[Math.floor(random() * CROWD_COLORS.length)];
        const skin = SKINS[Math.floor(random() * SKINS.length)];
        const jitter = (random() - 0.5) * 4 * scale;
        const cx = x + jitter, cy = y + rowHeight * 0.55;
        ctx.globalAlpha = 1 - dim * 0.45;
        // corpo
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(cx - 7 * scale, cy - 6 * scale, 14 * scale, 14 * scale, 5 * scale);
        ctx.fill();
        // braços levantados em parte da torcida
        if (random() < 0.22) {
          ctx.strokeStyle = skin;
          ctx.lineWidth = 3 * scale;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - 6 * scale, cy - 4 * scale); ctx.lineTo(cx - 10 * scale, cy - 17 * scale);
          ctx.moveTo(cx + 6 * scale, cy - 4 * scale); ctx.lineTo(cx + 10 * scale, cy - 17 * scale);
          ctx.stroke();
        }
        // cabeça
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(cx, cy - 10 * scale, 5.6 * scale, 0, Math.PI * 2);
        ctx.fill();
        // bandeirinhas
        if (random() < 0.035) {
          ctx.fillStyle = random() < 0.5 ? '#e3262f' : '#12a14b';
          ctx.fillRect(cx + 2 * scale, cy - 34 * scale, 16 * scale, 11 * scale);
          ctx.fillStyle = '#d9d9d9';
          ctx.fillRect(cx + 1 * scale, cy - 34 * scale, 1.6 * scale, 26 * scale);
        }
      }
    }
    ctx.globalAlpha = 1;
  };
  tier(8, 170, 0.78, 1);
  // marquise entre os anéis
  ctx.fillStyle = '#0b1322';
  ctx.fillRect(0, 172, width, 22);
  ctx.fillStyle = '#ffd21f';
  for (let x = 0; x < width; x += 80) ctx.fillRect(x, 180, 46, 4);
  tier(196, height - 6, 1, 0);
  // gradeado
  ctx.fillStyle = 'rgba(200,220,255,.18)';
  ctx.fillRect(0, height - 8, width, 3);
  return canvas;
}

/** Placas de LED à beira da pista. */
function buildBoards(): HTMLCanvasElement {
  const width = 1800, height = 74;
  const canvas = makeCanvas(width, height), ctx = canvas.getContext('2d')!;
  const panels: Array<[string, string, string]> = [
    ['#e3262f', '#ffffff', '13 PARA CORRER'], ['#0d1528', '#ffd21f', 'LIVE ARENA'], ['#12a14b', '#ffd21f', '22 PARA CORRER'],
    ['#0d1528', '#7fd4ff', 'CORRIDA AO VIVO'], ['#ffd21f', '#0d1528', 'TURBO ⚡'], ['#0d1528', '#ffffff', '400 M']
  ];
  const panelWidth = width / panels.length;
  panels.forEach(([bg, fg, text], index) => {
    const x = index * panelWidth;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, bg);
    gradient.addColorStop(1, shadeHex(bg, -0.35));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, panelWidth, height);
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    for (let y = 0; y < height; y += 4) ctx.fillRect(x, y, panelWidth, 1);
    ctx.fillStyle = fg;
    let fontSize = 34;
    ctx.font = `900 ${fontSize}px "Arial Black", Arial, sans-serif`;
    while (ctx.measureText(text).width > panelWidth - 36 && fontSize > 16) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px "Arial Black", Arial, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + panelWidth / 2, height / 2 + 2);
    ctx.fillStyle = '#05080f';
    ctx.fillRect(x + panelWidth - 4, 0, 4, height);
  });
  return canvas;
}

function shadeHex(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 + amount))));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function drawSky(ctx: CanvasRenderingContext2D, time: number, intensity: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, 640);
  sky.addColorStop(0, '#050816');
  sky.addColorStop(0.55, '#0c1a3a');
  sky.addColorStop(1, '#1a2f5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 660);
  // cobertura do estádio
  ctx.fillStyle = '#070c18';
  ctx.beginPath();
  ctx.moveTo(0, 470); ctx.lineTo(0, 560); ctx.quadraticCurveTo(540, 520, W, 560); ctx.lineTo(W, 470);
  ctx.quadraticCurveTo(540, 430, 0, 470);
  ctx.fill();
  // refletores com feixes
  for (const x of [90, 330, 750, 990]) {
    const glow = ctx.createRadialGradient(x, 470, 4, x, 470, 210);
    glow.addColorStop(0, `rgba(255,248,220,${0.5 * intensity})`);
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 220, 260, 440, 420);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(x - 46, 448, 92, 30);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 5; col++) {
      const flicker = 0.85 + 0.15 * Math.sin(time * 3 + x + col);
      ctx.fillStyle = `rgba(255,251,230,${flicker})`;
      ctx.beginPath();
      ctx.arc(x - 34 + col * 17, 456 + row * 13, 5.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- pista

function drawTrack(ctx: CanvasRenderingContext2D, camM: number, distance: number) {
  // tartan com leve gradiente de profundidade
  const tartan = ctx.createLinearGradient(0, TRACK_TOP, 0, TRACK_BOTTOM);
  tartan.addColorStop(0, '#b8432c');
  tartan.addColorStop(0.5, '#cf5233');
  tartan.addColorStop(1, '#de5d38');
  ctx.fillStyle = tartan;
  ctx.fillRect(0, TRACK_TOP, W, TRACK_BOTTOM - TRACK_TOP);
  // textura de faixas que corre com a câmera
  const offset = -((camM * PX_PER_M) % 60);
  ctx.fillStyle = 'rgba(0,0,0,.05)';
  for (let x = offset - 60; x < W + 60; x += 60) ctx.fillRect(x, TRACK_TOP, 30, TRACK_BOTTOM - TRACK_TOP);
  // linhas das raias
  ctx.fillStyle = '#f7f1ea';
  ctx.fillRect(0, TRACK_TOP, W, 6);
  ctx.fillRect(0, TRACK_MID - 3, W, 6);
  ctx.fillRect(0, TRACK_BOTTOM - 6, W, 6);

  // marcas de distância (inclinadas pela perspectiva)
  const screen = (m: number) => CENTER_X + (m - camM) * PX_PER_M;
  const firstMark = Math.floor((camM - CENTER_X / PX_PER_M) / 10) * 10;
  for (let m = firstMark; m < camM + CENTER_X / PX_PER_M + 20; m += 10) {
    if (m <= 0 || m >= distance) continue;
    const x = screen(m);
    const major = m % 50 === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.28)';
    ctx.lineWidth = major ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(x + 22, TRACK_TOP + 6);
    ctx.lineTo(x - 22, TRACK_BOTTOM - 6);
    ctx.stroke();
    if (major) {
      ctx.save();
      ctx.translate(x - 4, TRACK_MID + 2);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.font = '900 64px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillText(`${m}`, 60, 0);
      ctx.restore();
    }
  }

  // largada
  const start = screen(0);
  if (start > -80 && start < W + 80) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(start + 24, TRACK_TOP + 6);
    ctx.lineTo(start - 24, TRACK_BOTTOM - 6);
    ctx.stroke();
  }

  // chegada: faixa quadriculada e pórtico
  const finish = screen(distance);
  if (finish > -160 && finish < W + 200) {
    const rows = 10, cell = (TRACK_BOTTOM - TRACK_TOP) / rows;
    for (let row = 0; row < rows; row++) for (let col = 0; col < 2; col++) {
      const skew = 24 - (row / rows) * 48;
      ctx.fillStyle = (row + col) % 2 ? '#111111' : '#ffffff';
      ctx.fillRect(finish + skew + col * 18 - 18, TRACK_TOP + row * cell, 18, cell + 1);
    }
  }
  return { finish, start };
}

function drawFinishGate(ctx: CanvasRenderingContext2D, x: number, time: number) {
  if (x < -200 || x > W + 220) return;
  const top = 772, left = x - 10, right = x + 120;
  const post = (px: number, bottom: number) => {
    ctx.fillStyle = '#0d1528';
    ctx.fillRect(px - 7, top, 14, bottom - top);
    for (let y = top; y < bottom; y += 36) {
      ctx.fillStyle = '#ffd21f';
      ctx.fillRect(px - 5, y, 10, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 5, y + 18, 10, 18);
    }
  };
  post(left, TRACK_TOP + 26);
  post(right, TRACK_BOTTOM);
  const banner = ctx.createLinearGradient(left, top, right, top + 70);
  banner.addColorStop(0, '#ffd21f');
  banner.addColorStop(1, '#ff9f1a');
  ctx.fillStyle = banner;
  ctx.beginPath();
  ctx.roundRect(left - 30, top - 60, right - left + 70, 74, 10);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#0d1528';
  ctx.stroke();
  ctx.fillStyle = '#0d1528';
  ctx.font = '900 40px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CHEGADA', (left + right) / 2 + 4, top - 22);
  for (let index = 0; index < 6; index++) {
    const on = Math.floor(time * 6 + index) % 2 === 0;
    ctx.fillStyle = on ? '#ffffff' : '#ffd21f';
    ctx.beginPath();
    ctx.arc(left - 14 + index * ((right - left + 40) / 5), top + 8, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawInfield(ctx: CanvasRenderingContext2D, camM: number) {
  const grass = ctx.createLinearGradient(0, TRACK_BOTTOM, 0, 1560);
  grass.addColorStop(0, '#2f8f3a');
  grass.addColorStop(1, '#1d5e27');
  ctx.fillStyle = grass;
  ctx.fillRect(0, TRACK_BOTTOM, W, 170);
  const stripe = 120, offset = -((camM * PX_PER_M * 1.15) % (stripe * 2));
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  for (let x = offset - stripe * 2; x < W + stripe * 2; x += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(x, TRACK_BOTTOM); ctx.lineTo(x + stripe, TRACK_BOTTOM); ctx.lineTo(x + stripe - 40, 1568); ctx.lineTo(x - 40, 1568);
    ctx.fill();
  }
  const fade = ctx.createLinearGradient(0, 1480, 0, H);
  fade.addColorStop(0, 'rgba(4,7,14,0)');
  fade.addColorStop(0.3, 'rgba(4,7,14,.92)');
  fade.addColorStop(1, '#04070e');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 1480, W, H - 1480);
}

// ---------------------------------------------------------------- efeitos

function speedLines(ctx: CanvasRenderingContext2D, x: number, foot: number, size: number, time: number, color: string, strength: number) {
  ctx.save();
  ctx.globalAlpha = 0.75 * strength;
  ctx.lineCap = 'round';
  for (let index = 0; index < 7; index++) {
    const y = foot - size * (0.12 + index * 0.11);
    const length = 120 + ((index * 53 + time * 900) % 140);
    const start = x - size * 0.32 - ((time * 1400 + index * 97) % 60);
    const gradient = ctx.createLinearGradient(start - length, 0, start, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, color);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = index % 2 ? 5 : 8;
    ctx.beginPath();
    ctx.moveTo(start - length, y);
    ctx.lineTo(start, y);
    ctx.stroke();
  }
  ctx.restore();
}

function shieldBubble(ctx: CanvasRenderingContext2D, x: number, foot: number, size: number, time: number) {
  const cy = foot - size * 0.5, r = size * 0.62;
  ctx.save();
  const glow = ctx.createRadialGradient(x, cy, r * 0.55, x, cy, r * 1.05);
  glow.addColorStop(0, 'rgba(90,220,255,0)');
  glow.addColorStop(0.85, 'rgba(90,220,255,.32)');
  glow.addColorStop(1, 'rgba(90,220,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, cy, r * 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(150,240,255,${0.65 + 0.25 * Math.sin(time * 8)})`;
  ctx.lineWidth = 6;
  ctx.setLineDash([22, 14]);
  ctx.lineDashOffset = -time * 80;
  ctx.beginPath();
  ctx.arc(x, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, foot: number, size: number, lift: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(40,8,0,.38)';
  ctx.beginPath();
  ctx.ellipse(x + 6, foot + 4, size * 0.25 * (1 - lift * 0.3), size * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- componente

export interface RaceStageProps {
  game: GameState;
  phase: Phase;
  reduced?: boolean;
  /** `portrait` = quadro 9:16 inteiro; `track` = recorte da pista para painéis largos. */
  framing?: 'portrait' | 'track';
}

export function RaceStage({ game, phase, reduced = false, framing = 'portrait' }: RaceStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ game, phase, at: performance.now() });
  latest.current = { game, phase, at: latest.current.game.simulationTick !== game.simulationTick ? performance.now() : latest.current.at };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const stands = buildStands();
    const boards = buildBoards();
    const views: Record<Candidate, RunnerView> = {
      lula: { shown: 0, phase: 0, lastStep: 0, overtakeUntil: 0 },
      bolsonaro: { shown: 0, phase: 1.3, lastStep: 0, overtakeUntil: 0 }
    };
    let particles: Particle[] = [];
    let frame = 0, last = performance.now(), time = 0, camM = 0, shake = 0;
    let lastEffectId = -1, lastWinner: string | null = null;
    const random = seeded(7);

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, reduced ? 1 : 2);
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const target = Math.round(width * ratio);
      if (canvas.width !== target) {
        canvas.width = target;
        canvas.height = Math.round(height * ratio);
      }
    };

    const emit = (count: number, factory: () => Particle) => {
      if (reduced) count = Math.ceil(count / 3);
      for (let index = 0; index < count; index++) particles.push(factory());
      if (particles.length > 260) particles = particles.slice(-260);
    };

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      resize();
      const { game: state, phase: stagePhase, at } = latest.current;
      const distance = state.raceDistanceM || 400;
      const sinceState = Math.min(0.25, (now - at) / 1000);

      // progresso suavizado com extrapolação curta entre atualizações do servidor
      for (const candidate of ORDER) {
        const runner = state[candidate], view = views[candidate];
        const moving = stagePhase === 'live' && state.active && !state.winner;
        const authoritativeLimit=runner.raceProgress>=1?1:0.999;
        const target = Math.min(authoritativeLimit, runner.raceProgress + (moving ? runner.speed * sinceState : 0));
        if (Math.abs(target - view.shown) > 0.2 || (!moving && runner.raceProgress === 0)) view.shown = target;
        else view.shown += (target - view.shown) * Math.min(1, dt * 7);
      }

      // efeitos novos vindos do motor
      if (state.effect && state.effect.id !== lastEffectId) {
        lastEffectId = state.effect.id;
        const kind = state.effect.kind, who = state.effect.candidate;
        if (kind === 'stumble' || kind === 'impact') shake = Math.max(shake, 10);
        if (kind === 'turbo') shake = Math.max(shake, 6);
        if (kind === 'overtake' && who) views[who].overtakeUntil = time + 1.2;
      }
      if (state.winner && state.winner !== lastWinner) {
        emit(140, () => ({
          x: random() * W, y: -20 - random() * 300, vx: (random() - 0.5) * 120, vy: 180 + random() * 220,
          life: 0, max: 3 + random() * 2, size: 8 + random() * 10,
          color: ['#ffd21f', '#e3262f', '#12a14b', '#ffffff', '#37b9ef'][Math.floor(random() * 5)], kind: 'confetti'
        }));
      }
      lastWinner = state.winner;

      // câmera: o líder fica fiel à posição real, então ele cruza a chegada de verdade
      const meters = ORDER.map(candidate => views[candidate].shown * distance);
      const mid = (meters[0] + meters[1]) / 2;
      const offsets = meters.map(m => Math.tanh((m - mid) / 14) * SPREAD_PX);
      const leaderIndex = meters[0] > meters[1] ? 0 : meters[1] > meters[0] ? 1 : 1;
      // Lado a lado, as cabeças grandes se sobrepõem: o perseguidor recua o mínimo na tela.
      const trailerIndex = 1 - leaderIndex;
      if (offsets[leaderIndex] - offsets[trailerIndex] < MIN_GAP_PX) offsets[trailerIndex] = offsets[leaderIndex] - MIN_GAP_PX;
      const leaderX = CENTER_X + offsets[leaderIndex];
      const desiredCam = meters[leaderIndex] - (leaderX - CENTER_X) / PX_PER_M;
      camM += (desiredCam - camM) * Math.min(1, dt * 6);
      if (Math.abs(desiredCam - camM) > 60) camM = desiredCam;

      const scale = canvas.width / W;
      // No recorte de pista, alinha o fim da pista ao rodapé do quadro.
      const focusY = framing === 'track' ? Math.max(0, 1470 - canvas.height / scale) : 0;
      ctx.setTransform(scale, 0, 0, scale, 0, -focusY * scale);
      shake *= Math.pow(0.02, dt);
      const shakeX = reduced ? 0 : (random() - 0.5) * shake, shakeY = reduced ? 0 : (random() - 0.5) * shake * 0.6;

      // ---- fundo
      drawSky(ctx, time, state.finalSprint ? 1.25 : 1);
      ctx.save();
      ctx.translate(shakeX, shakeY);
      const crowdBounce = state.finalSprint ? Math.abs(Math.sin(time * 9)) * 6 : Math.abs(Math.sin(time * 3)) * 2;
      const standsX = -((camM * PX_PER_M * 0.22) % stands.width);
      for (let x = standsX; x < W; x += stands.width) ctx.drawImage(stands, x, 560 - crowdBounce, stands.width, 360);
      // flashes de câmera na torcida
      if (!reduced) for (let index = 0; index < (state.finalSprint ? 9 : 4); index++) {
        if (random() < 0.4) continue;
        const fx = random() * W, fy = 590 + random() * 300;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.arc(fx, fy, 2 + random() * 3, 0, Math.PI * 2); ctx.fill();
      }
      const boardsX = -((camM * PX_PER_M * 0.6) % boards.width);
      for (let x = boardsX; x < W; x += boards.width) ctx.drawImage(boards, x, 922, boards.width, 74);
      ctx.fillStyle = '#05080f';
      ctx.fillRect(0, 918, W, 5);
      ctx.fillRect(0, 994, W, 8);

      const { finish } = drawTrack(ctx, camM, distance);
      drawInfield(ctx, camM);
      drawFinishGate(ctx, finish, time);

      // ---- corredores (raia de trás primeiro)
      for (const [index, candidate] of ORDER.entries()) {
        const runner = state[candidate], view = views[candidate], lane = LANE[candidate];
        let mood = moodFor(state, stagePhase, candidate);
        if (mood === 'run' || mood === 'sprint') { if (time < view.overtakeUntil) mood = 'overtake'; }
        const rate = strideRate(mood);
        view.phase += dt * rate * Math.PI * 2;
        const x = CENTER_X + offsets[index] + (stagePhase === 'live' ? 0 : 0);
        const size = lane.size;

        // poeira a cada passo
        if (rate > 0) {
          const step = Math.floor(view.phase / Math.PI);
          if (step !== view.lastStep) {
            view.lastStep = step;
            emit(mood === 'boost' ? 5 : 3, () => ({
              x: x - 10 + random() * 30, y: lane.foot - 4, vx: -160 - random() * 160, vy: -40 - random() * 60,
              life: 0, max: 0.45 + random() * 0.3, size: 10 + random() * 12, color: 'rgba(230,180,150,.55)', kind: 'dust'
            }));
          }
        }
        if (mood === 'boost' || runner.boost > 55) {
          speedLines(ctx, x, lane.foot, size, time + index, candidate === 'lula' ? 'rgba(255,120,110,.95)' : 'rgba(255,225,90,.95)', Math.min(1, runner.boost / 70 + 0.3));
          if (!reduced) for (let ghost = 2; ghost >= 1; ghost--) {
            drawRunner(ctx, candidate, x - ghost * 46, lane.foot, { size, mood, phase: view.phase - ghost * 0.5, time, alpha: 0.12 * (3 - ghost) });
          }
        }
        shadow(ctx, x, lane.foot, size, mood === 'victory' ? 0.6 : 0);
        drawRunner(ctx, candidate, x, lane.foot, { size, mood, phase: view.phase, time: time + index * 0.37 });
        if (runner.shield > 0) shieldBubble(ctx, x, lane.foot, size, time);
        if (mood === 'stumble' && random() < 0.3) {
          emit(2, () => ({ x: x + random() * 40, y: lane.foot - 10, vx: (random() - 0.2) * 200, vy: -120 - random() * 120,
            life: 0, max: 0.6, size: 12, color: 'rgba(220,170,140,.6)', kind: 'dust' }));
        }
        if (mood === 'overtake' && !reduced) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, view.overtakeUntil - time) * 0.6;
          star(ctx, x + size * 0.32, lane.foot - size * 1.02, 16, '#ffd21f');
          ctx.restore();
        }
      }

      // ---- partículas
      particles = particles.filter(particle => {
        particle.life += dt;
        if (particle.life > particle.max) return false;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        const fade = 1 - particle.life / particle.max;
        if (particle.kind === 'dust') {
          particle.vy += 160 * dt;
          ctx.globalAlpha = fade * 0.8;
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1.4 - fade * 0.6), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = Math.min(1, fade * 2);
          ctx.fillStyle = particle.color;
          ctx.save();
          ctx.translate(particle.x, particle.y);
          ctx.rotate(particle.life * 7 + particle.size);
          ctx.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        return true;
      });
      ctx.restore();

      // vinheta de velocidade na reta final
      if (state.finalSprint && stagePhase === 'live' && !reduced) {
        const vignette = ctx.createRadialGradient(CENTER_X, 1150, 300, CENTER_X, 1150, 900);
        vignette.addColorStop(0, 'rgba(255,210,31,0)');
        vignette.addColorStop(1, `rgba(255,170,30,${0.18 + 0.06 * Math.sin(time * 10)})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, focusY, W, H);
      }

      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [reduced, framing]);

  return <canvas ref={canvasRef} className="race-stage-canvas" aria-label="Pista da corrida" />;
}

/** Medalhão com a cabeça cartoon, para placar e painéis. Sem foto. */
export function HeadBadge({ candidate, expression = 'smile', className }: { candidate: Candidate; expression?: Expression; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(32, canvas.clientWidth || 64);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width * 0.47, canvas.height * 0.53);
    const unit = canvas.width / 44;
    ctx.scale(unit, unit);
    drawHead(ctx, candidate, expression);
  }, [candidate, expression]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
