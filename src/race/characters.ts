import type { Candidate } from '../types';

/**
 * Corredores cartoon desenhados 100% em vetor (Canvas 2D): nenhuma foto.
 *
 * Sistema de coordenadas do boneco: unidades onde o corpo inteiro tem ~100 de
 * altura, com a origem no chão entre os pés e o eixo y para baixo. O corredor
 * sempre olha para a direita (+x). Ângulos de membros são medidos a partir da
 * vertical para baixo; positivo = para a frente.
 */

export type RunnerMood = 'idle' | 'ready' | 'run' | 'sprint' | 'boost' | 'stumble' | 'overtake' | 'victory' | 'defeat';
export type Expression = 'smile' | 'effort' | 'shout' | 'dizzy' | 'joy' | 'sad';

type Point = [number, number];

interface Look {
  skin: string; skinShade: string; blush: string;
  hair: string; hairShade: string; hairLight: string;
  brow: string;
  top: string; topShade: string; trim: string;
  sleeve: string; sleeveShade: string; shortSleeve: boolean;
  bottom: string; bottomShade: string; stripe: string; longPants: boolean;
  sock: string; shoe: string; shoeShade: string; sole: string;
  number: string; numberFill: string; numberStroke: string;
  width: number; belly: number; leg: number; limb: number;
}

const INK = '#22161a';

export const LOOKS: Record<Candidate, Look> = {
  lula: {
    skin: '#eab48d', skinShade: '#c88660', blush: 'rgba(226,96,86,.32)',
    hair: '#dcd8d3', hairShade: '#a8a29c', hairLight: '#f4f2ef',
    brow: '#c9c3bc',
    top: '#e3262f', topShade: '#a3121c', trim: '#ffffff',
    sleeve: '#e3262f', sleeveShade: '#a3121c', shortSleeve: false,
    bottom: '#c51d27', bottomShade: '#8a0f17', stripe: '#ffffff', longPants: true,
    sock: '#ffffff', shoe: '#ffffff', shoeShade: '#c4cad3', sole: '#e3262f',
    number: '13', numberFill: '#ffffff', numberStroke: '#a3121c',
    width: 1.17, belly: 0.17, leg: 0.95, limb: 1.1
  },
  bolsonaro: {
    skin: '#f2c6a6', skinShade: '#cf987a', blush: 'rgba(222,110,96,.22)',
    hair: '#4b4743', hairShade: '#2f2c29', hairLight: '#a29d97',
    brow: '#37322f',
    top: '#12a14b', topShade: '#0a6c33', trim: '#ffd21f',
    sleeve: '#ffd21f', sleeveShade: '#d6a50a', shortSleeve: true,
    bottom: '#1f46a6', bottomShade: '#132f72', stripe: '#ffd21f', longPants: false,
    sock: '#ffffff', shoe: '#ffd21f', shoeShade: '#c99600', sole: '#12a14b',
    number: '22', numberFill: '#ffd21f', numberStroke: '#0a6c33',
    width: 0.93, belly: 0, leg: 1.07, limb: 0.92
  }
};

// ---------------------------------------------------------------- utilidades

const limbPoint = (from: Point, angle: number, length: number): Point =>
  [from[0] + Math.sin(angle) * length, from[1] + Math.cos(angle) * length];

function strokePath(ctx: CanvasRenderingContext2D, points: Point[], width: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Membro cartoon: contorno escuro + preenchimento + brilho fino. */
function limb(ctx: CanvasRenderingContext2D, points: Point[], width: number, fill: string, light?: string) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokePath(ctx, points, width + 3.2, INK);
  strokePath(ctx, points, width, fill);
  if (light) {
    ctx.save();
    ctx.translate(-width * 0.16, -width * 0.16);
    ctx.globalAlpha = 0.35;
    strokePath(ctx, points, width * 0.28, light);
    ctx.restore();
  }
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function along(a: Point, b: Point, t: number): Point { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; }

function shade(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 + amount))));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

// ---------------------------------------------------------------- pose

interface LegPose { thigh: number; knee: number; foot: number }
interface ArmPose { upper: number; elbow: number }

export interface Pose {
  hipY: number;
  lean: number;
  headTilt: number;
  near: { leg: LegPose; arm: ArmPose };
  far: { leg: LegPose; arm: ArmPose };
  expression: Expression;
}

function runLeg(phase: number, amplitude: number, lean: number): LegPose {
  const swing = Math.max(0, Math.cos(phase));
  return {
    thigh: amplitude * Math.sin(phase) + lean * 0.25,
    knee: 0.12 + 1.45 * Math.pow(swing, 1.4) + 0.22 * Math.max(0, Math.sin(phase)),
    foot: 0.35 * Math.max(0, -Math.sin(phase)) - 0.2 * swing
  };
}

function runArm(phase: number, amplitude: number, lean: number): ArmPose {
  return { upper: -amplitude * 1.1 * Math.sin(phase) + lean * 0.35, elbow: 1.55 + 0.25 * Math.sin(phase) };
}

/** Converte o estado do corredor numa pose. `phase` avança com a passada. */
export function poseFor(mood: RunnerMood, phase: number, time: number): Pose {
  if (mood === 'run' || mood === 'sprint' || mood === 'boost' || mood === 'overtake') {
    const amplitude = mood === 'boost' ? 1.0 : mood === 'run' ? 0.74 : 0.88;
    const lean = mood === 'boost' ? 0.36 : mood === 'run' ? 0.17 : 0.26;
    return {
      hipY: 1.9 * Math.cos(phase * 2) - (mood === 'boost' ? 0.6 : 0),
      lean,
      headTilt: -lean * 0.45 + 0.03 * Math.sin(phase * 2),
      near: { leg: runLeg(phase, amplitude, lean), arm: runArm(phase, amplitude, lean) },
      far: { leg: runLeg(phase + Math.PI, amplitude, lean), arm: runArm(phase + Math.PI, amplitude, lean) },
      expression: mood === 'boost' || mood === 'overtake' ? 'shout' : mood === 'sprint' ? 'effort' : 'smile'
    };
  }
  if (mood === 'stumble') {
    const wobble = Math.sin(time * 19);
    return {
      hipY: 3.5 + Math.abs(Math.sin(time * 9)) * 1.5,
      lean: 0.78 + wobble * 0.08,
      headTilt: 0.25 + Math.sin(time * 11) * 0.12,
      near: { leg: { thigh: 0.65, knee: 1.25, foot: 0.3 }, arm: { upper: 2.3 + wobble * 0.7, elbow: 0.5 } },
      far: { leg: { thigh: -0.55, knee: 0.35, foot: 0.4 }, arm: { upper: 1.7 + Math.cos(time * 17) * 0.8, elbow: 0.7 } },
      expression: 'dizzy'
    };
  }
  if (mood === 'victory') {
    const jump = Math.abs(Math.sin(time * 5.5));
    return {
      hipY: -9 * jump,
      lean: -0.06,
      headTilt: -0.12,
      near: { leg: { thigh: 0.45 * jump, knee: 0.4 + 0.9 * jump, foot: 0.3 }, arm: { upper: Math.PI - 0.42 + Math.sin(time * 11) * 0.12, elbow: -0.25 } },
      far: { leg: { thigh: 0.15 * jump, knee: 0.3 + 0.7 * jump, foot: 0.3 }, arm: { upper: Math.PI + 0.38 + Math.cos(time * 11) * 0.12, elbow: 0.25 } },
      expression: 'joy'
    };
  }
  if (mood === 'defeat') {
    const breath = Math.sin(time * 3.2);
    return {
      hipY: 4 + breath * 0.6,
      lean: 0.92 + breath * 0.03,
      headTilt: 0.38,
      near: { leg: { thigh: 0.32, knee: 0.62, foot: 0 }, arm: { upper: 0.35, elbow: 0.1 } },
      far: { leg: { thigh: 0.12, knee: 0.5, foot: 0 }, arm: { upper: 0.2, elbow: 0.1 } },
      expression: 'sad'
    };
  }
  if (mood === 'ready') {
    const tense = Math.sin(time * 6) * 0.03;
    return {
      hipY: 6 + tense * 10,
      lean: 0.62,
      headTilt: -0.42,
      near: { leg: { thigh: 0.95, knee: 1.55, foot: 0.1 }, arm: { upper: -0.55, elbow: 1.2 } },
      far: { leg: { thigh: -0.42, knee: 0.55, foot: 0.4 }, arm: { upper: 0.95 + tense, elbow: 1.3 } },
      expression: 'effort'
    };
  }
  // idle: pulando no lugar, aquecendo
  const bounce = Math.abs(Math.sin(time * 4.2));
  return {
    hipY: -1.6 * bounce,
    lean: 0.04,
    headTilt: Math.sin(time * 1.3) * 0.04,
    near: { leg: { thigh: 0.08, knee: 0.14 + 0.2 * (1 - bounce), foot: 0.1 }, arm: { upper: 0.22 + Math.sin(time * 4.2) * 0.12, elbow: 0.7 } },
    far: { leg: { thigh: -0.08, knee: 0.14 + 0.2 * (1 - bounce), foot: 0.1 }, arm: { upper: -0.2 - Math.sin(time * 4.2) * 0.12, elbow: 0.7 } },
    expression: 'smile'
  };
}

// ---------------------------------------------------------------- corpo

interface Skeleton {
  hip: Point; shoulder: Point; neck: Point; head: Point;
  near: { knee: Point; ankle: Point; elbow: Point; hand: Point; shoulder: Point; hip: Point; foot: number };
  far: { knee: Point; ankle: Point; elbow: Point; hand: Point; shoulder: Point; hip: Point; foot: number };
}

const THIGH = 17.5, SHIN = 17.5, UPPER_ARM = 13, FOREARM = 12, TORSO = 26;

function skeleton(pose: Pose, look: Look): Skeleton {
  const legScale = look.leg;
  const hip: Point = [0, -(THIGH + SHIN) * legScale - 1.5 + pose.hipY];
  const up: Point = [Math.sin(pose.lean), -Math.cos(pose.lean)];
  const shoulder: Point = [hip[0] + up[0] * TORSO, hip[1] + up[1] * TORSO];
  const neck: Point = [shoulder[0] + up[0] * 4, shoulder[1] + up[1] * 4];
  const headLean = pose.lean * 0.55 + pose.headTilt;
  const head: Point = [neck[0] + Math.sin(headLean) * 15 + 2.5, neck[1] - Math.cos(headLean) * 15];

  const side = (legPose: LegPose, armPose: ArmPose, offset: number) => {
    const hipJoint: Point = [hip[0] + offset * 0.5, hip[1]];
    const shoulderJoint: Point = [shoulder[0] - up[1] * offset * 0.2, shoulder[1] + 1.5];
    const knee = limbPoint(hipJoint, legPose.thigh, THIGH * legScale);
    const ankle = limbPoint(knee, legPose.thigh - legPose.knee, SHIN * legScale);
    const elbow = limbPoint(shoulderJoint, armPose.upper, UPPER_ARM * look.limb);
    const hand = limbPoint(elbow, armPose.upper + armPose.elbow, FOREARM * look.limb);
    return { knee, ankle, elbow, hand, shoulder: shoulderJoint, hip: hipJoint, foot: legPose.foot + (legPose.thigh - legPose.knee) * 0.35 };
  };
  return { hip, shoulder, neck, head, near: side(pose.near.leg, pose.near.arm, 1), far: side(pose.far.leg, pose.far.arm, -1) };
}

function drawShoe(ctx: CanvasRenderingContext2D, ankle: Point, angle: number, look: Look, far: boolean) {
  ctx.save();
  ctx.translate(ankle[0], ankle[1]);
  ctx.rotate(-angle);
  const body = far ? shade(look.shoe, -0.28) : look.shoe;
  ctx.beginPath();
  ctx.moveTo(-3.6, -2.4);
  ctx.quadraticCurveTo(-4.4, 2.6, -3, 3.4);
  ctx.lineTo(7.8, 3.4);
  ctx.quadraticCurveTo(10.4, 3.2, 9.6, 0.6);
  ctx.quadraticCurveTo(8, -1.6, 3.6, -1.8);
  ctx.quadraticCurveTo(1.4, -3.6, -1.2, -3.6);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // sola colorida e detalhe lateral
  ctx.beginPath();
  ctx.moveTo(-3.4, 2.1);
  ctx.lineTo(9.6, 2.1);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = far ? shade(look.sole, -0.3) : look.sole;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.5, -0.6);
  ctx.lineTo(5.5, 0.4);
  ctx.lineWidth = 1;
  ctx.strokeStyle = far ? shade(look.sole, -0.3) : look.sole;
  ctx.stroke();
  ctx.restore();
}

function drawLeg(ctx: CanvasRenderingContext2D, side: Skeleton['near'], look: Look, far: boolean) {
  const width = 9.5 * look.limb, shinWidth = 7.6 * look.limb;
  const skin = far ? look.skinShade : look.skin;
  if (look.longPants) {
    const pants = far ? look.bottomShade : look.bottom;
    limb(ctx, [side.hip, side.knee, side.ankle], width, pants, far ? undefined : '#ff8a8a');
    ctx.save();
    ctx.globalAlpha = far ? 0.55 : 1;
    ctx.lineCap = 'round';
    strokePath(ctx, [along(side.hip, side.knee, 0.1), side.knee, along(side.knee, side.ankle, 0.82)], 1.5, look.stripe);
    ctx.restore();
    // punho da calça
    limb(ctx, [along(side.knee, side.ankle, 0.86), side.ankle], shinWidth + 0.6, far ? look.bottomShade : look.bottom);
  } else {
    limb(ctx, [side.hip, side.knee, side.ankle], shinWidth, skin, far ? undefined : '#ffe6d4');
    limb(ctx, [side.hip, along(side.hip, side.knee, 0.42)], width + 3, far ? look.bottomShade : look.bottom);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = far ? 0.6 : 1;
    strokePath(ctx, [along(side.hip, side.knee, 0.02), along(side.hip, side.knee, 0.42)], 1.4, look.stripe);
    ctx.restore();
    limb(ctx, [along(side.knee, side.ankle, 0.58), side.ankle], shinWidth + 0.4, far ? shade(look.sock, -0.25) : look.sock);
  }
  drawShoe(ctx, side.ankle, side.foot, look, far);
}

function drawArm(ctx: CanvasRenderingContext2D, side: Skeleton['near'], look: Look, far: boolean) {
  const width = 7 * look.limb;
  const skin = far ? look.skinShade : look.skin;
  if (look.shortSleeve) {
    limb(ctx, [side.shoulder, side.elbow, side.hand], width - 0.6, skin, far ? undefined : '#ffe6d4');
    limb(ctx, [side.shoulder, along(side.shoulder, side.elbow, 0.38)], width + 2.6, far ? look.sleeveShade : look.sleeve);
  } else {
    limb(ctx, [side.shoulder, side.elbow, side.hand], width, far ? look.sleeveShade : look.sleeve, far ? undefined : '#ff8a8a');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = far ? 0.5 : 1;
    strokePath(ctx, [along(side.shoulder, side.elbow, 0.15), side.elbow, along(side.elbow, side.hand, 0.7)], 1.3, look.trim);
    ctx.restore();
    limb(ctx, [along(side.elbow, side.hand, 0.82), along(side.elbow, side.hand, 0.9)], width + 0.8, far ? look.sleeveShade : look.sleeve);
  }
  // mão fechada
  ctx.beginPath();
  ctx.arc(side.hand[0], side.hand[1], 3.6 * look.limb, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawTorso(ctx: CanvasRenderingContext2D, skeletonPoints: Skeleton, pose: Pose, look: Look) {
  const { hip } = skeletonPoints;
  const w = 10.6 * look.width;
  ctx.save();
  ctx.translate(hip[0], hip[1]);
  ctx.rotate(pose.lean);
  // pescoço
  const neckWidth = look.width > 1 ? 6.4 : 5.2;
  ctx.beginPath();
  ctx.roundRect(-neckWidth / 2 + 0.8, -TORSO - 7, neckWidth, 9, 2);
  ctx.fillStyle = look.skinShade;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // tronco: costas retas, peito arredondado, barriga quando houver
  const belly = look.belly * 10;
  ctx.beginPath();
  ctx.moveTo(-w * 0.82, 2.5);
  ctx.bezierCurveTo(-w * 0.95, -8, -w * 0.98, -17, -w * 0.72, -TORSO + 0.5);
  ctx.quadraticCurveTo(-w * 0.2, -TORSO - 3.2, w * 0.45, -TORSO - 0.8);
  ctx.bezierCurveTo(w * 0.95, -TORSO + 2, w * 1.02 + belly * 0.2, -13, w * 0.9 + belly * 0.55, -7);
  ctx.bezierCurveTo(w * 0.85 + belly, -2.5, w * 0.75 + belly * 0.6, 1.5, w * 0.55, 3);
  ctx.quadraticCurveTo(0, 4.4, -w * 0.82, 2.5);
  ctx.closePath();
  ctx.fillStyle = look.top;
  ctx.fill();
  // sombra nas costas
  ctx.save();
  ctx.clip();
  ctx.fillStyle = look.topShade;
  ctx.beginPath();
  ctx.ellipse(-w * 1.05, -10, w * 0.55, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath();
  ctx.ellipse(w * 0.45, -16, w * 0.3, 4, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // faixa lateral / barra da camisa
  ctx.fillStyle = look.trim;
  if (look.longPants) {
    ctx.fillRect(-w * 0.12, -TORSO - 2, 1.4, TORSO + 6);
  } else {
    ctx.fillRect(-w * 1.2, 0, w * 2.6, 1.6);
  }
  ctx.restore();
  ctx.lineWidth = 1.9;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // gola
  ctx.beginPath();
  ctx.moveTo(-neckWidth * 0.55, -TORSO - 1.2);
  ctx.quadraticCurveTo(1, -TORSO + 3.2, neckWidth * 0.75 + 1, -TORSO - 1.2);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = look.trim;
  ctx.stroke();

  // número no peito
  ctx.save();
  ctx.translate(w * 0.32, -11.5);
  ctx.rotate(-0.05);
  if (look.longPants) {
    ctx.beginPath();
    ctx.roundRect(-5.4, -4.6, 10.8, 9.4, 1.6);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.font = '900 8.6px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = look.longPants ? 0 : 2.2;
  if (!look.longPants) { ctx.strokeStyle = look.numberStroke; ctx.strokeText(look.number, 0, 0.4); }
  ctx.fillStyle = look.longPants ? look.top : look.numberFill;
  ctx.fillText(look.number, 0, 0.4);
  ctx.restore();

  // shorts / cós
  if (!look.longPants) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.86, 0.5);
    ctx.quadraticCurveTo(0, 2.6, w * 0.62, 1.2);
    ctx.lineTo(w * 0.66, 6);
    ctx.quadraticCurveTo(0, 7.5, -w * 0.9, 5.5);
    ctx.closePath();
    ctx.fillStyle = look.bottom;
    ctx.fill();
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = INK;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-w * 0.86, 1.2);
    ctx.quadraticCurveTo(0, 3.4, w * 0.62, 1.8);
    ctx.lineTo(w * 0.62, 5.5);
    ctx.quadraticCurveTo(0, 7, -w * 0.88, 5);
    ctx.closePath();
    ctx.fillStyle = look.bottom;
    ctx.fill();
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- cabeças

function outline(ctx: CanvasRenderingContext2D, fill: string, width = 1.7) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function eye(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, iris: string, expression: Expression, squint: number, far: boolean) {
  const rx = (far ? 1.7 : 2.3) * size, ry = 1.45 * size * (1 - squint * 0.45);
  if (expression === 'dizzy') {
    ctx.beginPath();
    for (let turn = 0; turn < 2.6 * Math.PI * 2; turn += 0.3) {
      const radius = turn / (2.6 * Math.PI * 2) * rx * 1.1;
      const px = x + Math.cos(turn) * radius, py = y + Math.sin(turn) * radius;
      if (turn === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = INK;
    ctx.stroke();
    return;
  }
  if (expression === 'joy') {
    ctx.beginPath();
    ctx.moveTo(x - rx, y + 0.5);
    ctx.quadraticCurveTo(x, y - ry * 1.9, x + rx, y + 0.5);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(x + rx * 0.28, y + 0.1, 1.15 * size, 0, Math.PI * 2);
  ctx.fillStyle = iris;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + rx * 0.3, y + 0.1, 0.55 * size, 0, Math.PI * 2);
  ctx.fillStyle = '#120c0c';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + rx * 0.1, y - 0.4, 0.32 * size, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  // pálpebra superior marcada
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, Math.PI * 1.04, Math.PI * 1.96);
  ctx.lineWidth = expression === 'sad' ? 1.1 : 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function brow(ctx: CanvasRenderingContext2D, points: Point[], width: number, color: string) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  if (points.length === 3) ctx.quadraticCurveTo(points[1][0], points[1][1], points[2][0], points[2][1]);
  else ctx.lineTo(points[1][0], points[1][1]);
  ctx.lineWidth = width + 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function browSet(expression: Expression, base: number): { lift: number; angle: number } {
  if (expression === 'effort' || expression === 'shout') return { lift: base + 0.6, angle: 1.4 };
  if (expression === 'sad') return { lift: base - 0.8, angle: -1.6 };
  if (expression === 'joy') return { lift: base - 1.2, angle: -0.3 };
  if (expression === 'dizzy') return { lift: base - 1, angle: -0.8 };
  return { lift: base, angle: 0 };
}

/** Nariz em 3/4: forma cheia, contorno só no perfil externo e narina. */
function nose(ctx: CanvasRenderingContext2D, look: Look, p: Point[], size: number) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  ctx.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]);
  ctx.bezierCurveTo(p[4][0], p[4][1] + 0.6, p[5][0], p[5][1] + 0.4, p[6][0], p[6][1]);
  ctx.quadraticCurveTo(p[7][0] - 0.8, p[7][1] - 1.6, p[0][0] - 0.6, p[0][1] + 2);
  ctx.closePath();
  ctx.fillStyle = look.skin;
  ctx.fill();
  ctx.fillStyle = look.skinShade;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(p[6][0] + 0.6, p[6][1] - 1.4, 1.6 * size, 1.4 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // contorno do perfil: da ponte à ponta e à aba da narina
  ctx.beginPath();
  ctx.moveTo(p[1][0] - 0.4, p[1][1] - 0.6);
  ctx.bezierCurveTo(p[2][0] - 1.4, p[2][1] - 0.4, p[3][0], p[3][1] - 1.8, p[3][0], p[3][1]);
  ctx.bezierCurveTo(p[4][0], p[4][1] + 0.6, p[5][0], p[5][1] + 0.4, p[6][0], p[6][1]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p[5][0] + 0.2, p[5][1] - 0.9, 0.75 * size, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
}

/** Barba volumosa: contorno ondulado feito de tufos sobrepostos. */
function fluffyBeard(ctx: CanvasRenderingContext2D, look: Look, bumps: Array<[number, number, number]>, body: () => void) {
  for (const [x, y, r] of bumps) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = 3.4; ctx.strokeStyle = INK; ctx.stroke(); }
  for (const [x, y, r] of bumps) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = look.hair; ctx.fill(); }
  body();
  ctx.fillStyle = look.hair;
  ctx.fill();
}

function lulaHead(ctx: CanvasRenderingContext2D, look: Look, expression: Expression) {
  // orelha
  ctx.beginPath();
  ctx.ellipse(-10.6, 1.4, 3.3, 4.6, -0.15, 0, Math.PI * 2);
  outline(ctx, look.skin);
  ctx.beginPath();
  ctx.arc(-10.4, 1.6, 1.8, -1.2, 1.4);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = look.skinShade;
  ctx.stroke();

  // crânio e rosto arredondado
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.bezierCurveTo(-12.5, -14, -4, -17.4, 3.6, -17);
  ctx.bezierCurveTo(11.5, -16.5, 15.2, -11, 15, -4.5);
  ctx.bezierCurveTo(15.6, -1, 16, 2.4, 15.2, 5.5);
  ctx.bezierCurveTo(14.6, 11.5, 10, 16.8, 3, 17.4);
  ctx.bezierCurveTo(-4.2, 17.8, -10.6, 12.6, -11.8, 5);
  ctx.bezierCurveTo(-12.4, 1.2, -12.3, -2, -12, -5);
  ctx.closePath();
  outline(ctx, look.skin, 1.9);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = look.skinShade;
  ctx.beginPath();
  ctx.ellipse(-13.5, 0, 6.5, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.blush;
  ctx.beginPath();
  ctx.ellipse(4.5, 1.2, 4.2, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // rugas da testa
  ctx.lineCap = 'round';
  ctx.strokeStyle = look.skinShade;
  ctx.lineWidth = 0.8;
  for (const y of [-11.6, -10]) {
    ctx.beginPath();
    ctx.moveTo(1.5, y);
    ctx.quadraticCurveTo(6.5, y - 1, 11.5, y + 0.2);
    ctx.stroke();
  }

  // cabelo grisalho, entradas e laterais volumosas
  ctx.beginPath();
  ctx.moveTo(-13.4, 3.5);
  ctx.bezierCurveTo(-16.6, -3, -15.4, -12.5, -8.5, -16.6);
  ctx.bezierCurveTo(-2.5, -19.6, 6.2, -19.4, 11, -15.8);
  ctx.bezierCurveTo(13.4, -14, 14.2, -12.2, 13.6, -11.2);
  ctx.bezierCurveTo(10.5, -13.6, 5.5, -14.6, 0.8, -13.3);
  ctx.bezierCurveTo(-3.2, -12.2, -5.6, -9.6, -6.6, -6.4);
  ctx.bezierCurveTo(-7.4, -3.6, -7.2, -0.8, -7.8, 1.8);
  ctx.bezierCurveTo(-9.2, 0.2, -10.6, -0.4, -11.6, 0.6);
  ctx.bezierCurveTo(-12.3, 1.6, -12.4, 2.8, -13.4, 3.5);
  ctx.closePath();
  outline(ctx, look.hair, 1.7);
  ctx.strokeStyle = look.hairShade;
  ctx.lineWidth = 0.8;
  for (const [x1, y1, x2, y2] of [[-11, -10, -3, -15.5], [-12.6, -4, -6, -12], [-4, -16.4, 6, -16.6], [-13, 0, -9.5, -6]]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2 + 1, (y1 + y2) / 2 - 1.5, x2, y2);
    ctx.stroke();
  }
  ctx.strokeStyle = look.hairLight;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-6, -16.4);
  ctx.quadraticCurveTo(1, -18.4, 7.5, -16.4);
  ctx.stroke();

  // barba cheia branca
  const mouthOpen = expression === 'shout' ? 1 : expression === 'joy' ? 0.75 : expression === 'effort' ? 0.45 : expression === 'smile' ? 0.35 : expression === 'dizzy' ? 0.6 : 0.15;
  const beardShape = () => {
    ctx.beginPath();
    ctx.moveTo(-7.9, -1);
    ctx.bezierCurveTo(-10, 5, -9, 11.5, -4.5, 15.6);
    ctx.bezierCurveTo(-1, 19.4, 5.5, 20, 9.6, 16.4);
    ctx.bezierCurveTo(13.6, 13, 15.6, 8.4, 15.4, 3.4);
    ctx.bezierCurveTo(13.6, 4.8, 12, 4.4, 10.6, 4.4);
    ctx.bezierCurveTo(7, 4.6, 4, 5.4, 1.4, 3.6);
    ctx.bezierCurveTo(-1.6, 1.6, -3.8, 4.6, -5.6, 2.2);
    ctx.bezierCurveTo(-6.6, 0.8, -7.2, -0.2, -7.9, -1);
    ctx.closePath();
  };
  fluffyBeard(ctx, look, [
    [-8.2, 2.2, 2.4], [-8.6, 6.4, 2.6], [-7.4, 10.4, 2.8], [-4.8, 14, 2.9], [-1, 16.8, 3], [3.2, 18, 3],
    [7.4, 17, 2.9], [10.8, 14.4, 2.8], [13.4, 10.8, 2.6], [14.8, 6.8, 2.2]
  ], beardShape);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(150,143,136,.35)';
  ctx.beginPath();
  ctx.ellipse(-8, 11, 4, 7, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = look.hairShade;
  ctx.lineWidth = 0.6;
  ctx.globalAlpha = 0.7;
  for (let index = 0; index < 9; index++) {
    const x = -5 + index * 2.1, y = 10 + Math.sin(index * 1.7) * 3.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 1, y + 1.4, x + 0.4, y + 2.8);
    ctx.stroke();
  }
  ctx.restore();
  // linha suave entre bochecha e barba
  ctx.beginPath();
  ctx.moveTo(-7.6, -0.6);
  ctx.bezierCurveTo(-6.4, 1.6, -4, 4.2, -1.6, 2.4);
  ctx.bezierCurveTo(0.6, 1.2, 1.6, 3.2, 3, 4.6);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = look.hairShade;
  ctx.stroke();

  // boca dentro da barba
  ctx.beginPath();
  const mouthY = 8.2, depth = 1.4 + mouthOpen * 4.2;
  if (expression === 'sad') {
    ctx.moveTo(5, mouthY + 2);
    ctx.quadraticCurveTo(9, mouthY - 0.8, 13, mouthY + 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  } else {
    ctx.moveTo(4.6, mouthY - 0.6);
    ctx.quadraticCurveTo(9, mouthY + depth * 1.3, 13.6, mouthY - 1);
    ctx.quadraticCurveTo(9, mouthY + 0.2, 4.6, mouthY - 0.6);
    ctx.closePath();
    outline(ctx, '#5a1d22', 1.2);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, mouthY - 1.4, 10, 1.7);
    if (mouthOpen > 0.6) { ctx.fillStyle = '#d6555b'; ctx.beginPath(); ctx.ellipse(9.2, mouthY + depth, 2.8, 1.6, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // bigode
  ctx.beginPath();
  ctx.moveTo(3, 5.6);
  ctx.bezierCurveTo(5.4, 3.4, 9, 3.4, 10.6, 4.6);
  ctx.bezierCurveTo(12.6, 3.6, 14.8, 4.4, 15.6, 6.4);
  ctx.bezierCurveTo(13.4, 7.2, 11.6, 6.6, 9.8, 7.2);
  ctx.bezierCurveTo(7.4, 7.9, 4.4, 7.4, 3, 5.6);
  ctx.closePath();
  outline(ctx, look.hair, 1.3);

  // nariz largo e arredondado
  nose(ctx, look, [[10.2, -3.8], [12.6, -0.6], [18.4, 0.4], [18.6, 3.4], [17.2, 5.8], [13.4, 5.6], [10.8, 5], [9.6, 3.6]], 1.25);

  // olhos sorridentes com pés de galinha
  eye(ctx, 2.6, -4.2, 1, '#4a2f20', expression, expression === 'smile' ? 0.55 : expression === 'effort' ? 0.7 : 0.3, false);
  eye(ctx, 11.6, -4.4, 0.85, '#4a2f20', expression, expression === 'smile' ? 0.55 : expression === 'effort' ? 0.7 : 0.3, true);
  ctx.strokeStyle = look.skinShade;
  ctx.lineWidth = 0.7;
  for (const dy of [-1.2, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(-0.6, -4 + dy);
    ctx.lineTo(-2.4, -4 + dy * 1.8);
    ctx.stroke();
  }
  if (expression !== 'dizzy' && expression !== 'joy') {
    ctx.beginPath();
    ctx.moveTo(0.4, -2.3);
    ctx.quadraticCurveTo(2.8, -1, 5, -2.3);
    ctx.stroke();
  }

  // sobrancelhas grossas grisalhas
  const { lift, angle } = browSet(expression, 0);
  brow(ctx, [[-0.6, -7.2 - lift], [2.4, -9.6 - lift - angle * 0.4], [5.6, -8 - lift + angle]], 2.3, look.brow);
  brow(ctx, [[9.4, -8 - lift + angle * 0.8], [11.5, -9.4 - lift], [14, -7.8 - lift]], 2, look.brow);
}

function bolsonaroHead(ctx: CanvasRenderingContext2D, look: Look, expression: Expression) {
  // orelha
  ctx.beginPath();
  ctx.ellipse(-10.2, 1.6, 3, 4.8, -0.1, 0, Math.PI * 2);
  outline(ctx, look.skin);
  ctx.beginPath();
  ctx.arc(-10, 1.8, 1.7, -1.2, 1.4);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = look.skinShade;
  ctx.stroke();

  // rosto mais longo, maxilar marcado, queixo pronunciado
  ctx.beginPath();
  ctx.moveTo(-11.4, -7);
  ctx.bezierCurveTo(-11.6, -15.6, -3.4, -18.6, 3.8, -18.2);
  ctx.bezierCurveTo(11, -17.6, 14.2, -12.4, 14, -6.4);
  ctx.bezierCurveTo(14.4, -2, 15, 2.6, 14.6, 6.4);
  ctx.bezierCurveTo(14.2, 10.8, 12, 14.8, 8.6, 17.8);
  ctx.bezierCurveTo(6.6, 19.6, 3.4, 19.8, 0.6, 18.4);
  ctx.bezierCurveTo(-5.2, 15.2, -9.4, 10.2, -11, 4.2);
  ctx.bezierCurveTo(-11.8, 0.6, -11.8, -3.4, -11.4, -7);
  ctx.closePath();
  outline(ctx, look.skin, 1.9);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = look.skinShade;
  ctx.beginPath();
  ctx.ellipse(-12.8, 0, 6, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  // sombra do maxilar e barba feita
  ctx.fillStyle = 'rgba(120,90,80,.16)';
  ctx.beginPath();
  ctx.ellipse(5, 14.5, 10, 5, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.blush;
  ctx.beginPath();
  ctx.ellipse(4.6, 3.2, 3.6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // linha do queixo
  ctx.strokeStyle = look.skinShade;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(4.6, 16.2);
  ctx.quadraticCurveTo(7, 15.4, 9.2, 16);
  ctx.stroke();

  // cabelo curto, penteado de lado com volume na frente; grisalho nas têmporas
  ctx.beginPath();
  ctx.moveTo(-12.4, 1.4);
  ctx.bezierCurveTo(-14.6, -6.6, -12.4, -15.8, -5, -19.4);
  ctx.bezierCurveTo(1.6, -22.4, 9.6, -21.6, 13.6, -17.4);
  ctx.bezierCurveTo(15.8, -15.2, 16.4, -12.6, 15.2, -10.6);
  ctx.bezierCurveTo(14.4, -11.6, 13.4, -11.8, 12.8, -11.2);
  ctx.bezierCurveTo(11.6, -12.8, 9.6, -12.6, 8.6, -11.8);
  ctx.bezierCurveTo(6.6, -12.8, 3.6, -12.4, 1.4, -11.4);
  ctx.bezierCurveTo(-1.8, -11.4, -4.8, -10.2, -6.8, -7.8);
  ctx.bezierCurveTo(-8.2, -5.8, -8.6, -2.6, -8.7, 0.6);
  ctx.bezierCurveTo(-10, 0.2, -11.4, 0.6, -12.4, 1.4);
  ctx.closePath();
  outline(ctx, look.hair, 1.7);
  ctx.save();
  ctx.clip();
  const temple = ctx.createRadialGradient(-10.4, -1.4, 0.5, -10.4, -1.4, 6.5);
  temple.addColorStop(0, look.hairLight);
  temple.addColorStop(1, 'rgba(162,157,151,0)');
  ctx.fillStyle = temple;
  ctx.fillRect(-18, -10, 14, 14);
  // fios penteados da risca para a frente
  ctx.lineWidth = 0.75;
  for (const [index, offset] of [0, 2, 4, 6].entries()) {
    ctx.strokeStyle = index % 2 ? look.hairShade : look.hairLight;
    ctx.beginPath();
    ctx.moveTo(-6.6 + offset * 0.2, -18 + offset);
    ctx.bezierCurveTo(-1 + offset, -20.4 + offset * 0.9, 8 + offset * 0.2, -19.6 + offset * 0.8, 14.6 - offset * 0.5, -13.6 + offset * 0.45);
    ctx.stroke();
  }
  ctx.restore();
  // risca lateral
  ctx.strokeStyle = look.hairShade;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-5.4, -18.8);
  ctx.quadraticCurveTo(-8.6, -14, -8.2, -8.6);
  ctx.stroke();

  // marcas de expressão
  ctx.strokeStyle = look.skinShade;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(9.8, 5.4);
  ctx.quadraticCurveTo(7.6, 8.4, 8, 11.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1.6, -11);
  ctx.quadraticCurveTo(6.6, -12, 11.6, -10.8);
  ctx.stroke();

  // nariz reto e comprido
  nose(ctx, look, [[10.4, -4.8], [12.8, -1.4], [16.6, 2.6], [17.4, 5], [16, 7], [13, 6.6], [11, 6], [10, 4.8]], 1.05);

  // boca fina, sorriso de canto
  const mouthY = 11.2;
  if (expression === 'shout' || expression === 'dizzy') {
    ctx.beginPath();
    ctx.ellipse(10, mouthY + 0.4, 3.2, expression === 'shout' ? 2.8 : 2, 0, 0, Math.PI * 2);
    outline(ctx, '#5a1d22', 1.3);
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(6.5, mouthY - 2.6, 7, 1.3);
    ctx.restore();
  } else if (expression === 'joy') {
    ctx.beginPath();
    ctx.moveTo(6, mouthY - 1);
    ctx.quadraticCurveTo(10, mouthY + 4.6, 14.2, mouthY - 1.6);
    ctx.quadraticCurveTo(10, mouthY + 0.4, 6, mouthY - 1);
    ctx.closePath();
    outline(ctx, '#5a1d22', 1.2);
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(5, mouthY - 1.8, 10, 1.6);
    ctx.restore();
  } else if (expression === 'effort') {
    ctx.beginPath();
    ctx.roundRect(6.4, mouthY - 1.4, 7.4, 2.8, 1.2);
    outline(ctx, '#ffffff', 1.3);
    ctx.beginPath();
    ctx.moveTo(6.6, mouthY);
    ctx.lineTo(13.6, mouthY);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  } else {
    ctx.beginPath();
    const corner = expression === 'sad' ? 1.4 : -1.4;
    ctx.moveTo(6.6, mouthY + (expression === 'sad' ? 0.8 : 0.2));
    ctx.quadraticCurveTo(9.6, mouthY + 1.2, 13.8, mouthY + corner);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(7.4, mouthY + 1.6);
    ctx.quadraticCurveTo(10, mouthY + 2.6, 12.6, mouthY + 1.4);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = '#c47a72';
    ctx.stroke();
  }

  // olhos claros, pálpebra pesada e bolsas
  const squint = expression === 'smile' ? 0.35 : expression === 'effort' ? 0.6 : 0.2;
  eye(ctx, 3, -3.6, 1, '#4f97d6', expression, squint, false);
  eye(ctx, 11.8, -3.8, 0.85, '#4f97d6', expression, squint, true);
  if (expression !== 'dizzy' && expression !== 'joy') {
    ctx.strokeStyle = look.skinShade;
    ctx.lineWidth = 0.75;
    ctx.beginPath(); ctx.moveTo(0.8, -1.6); ctx.quadraticCurveTo(3, -0.4, 5.6, -1.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -1.9); ctx.quadraticCurveTo(11.8, -1, 13.6, -1.9); ctx.stroke();
  }

  // sobrancelhas escuras, retas e baixas
  const { lift, angle } = browSet(expression, 0);
  brow(ctx, [[-0.4, -6.6 - lift - angle * 0.2], [3, -7.4 - lift], [5.8, -7 - lift + angle]], 2.1, look.brow);
  brow(ctx, [[9.6, -7.2 - lift + angle * 0.9], [11.8, -7.8 - lift], [14, -6.8 - lift]], 1.8, look.brow);
}

/** Cabeça do personagem, também usada nos medalhões do placar. */
export function drawHead(ctx: CanvasRenderingContext2D, candidate: Candidate, expression: Expression) {
  const look = LOOKS[candidate];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (candidate === 'lula') lulaHead(ctx, look, expression); else bolsonaroHead(ctx, look, expression);
  ctx.restore();
}

// ---------------------------------------------------------------- corredor completo

export interface DrawOptions {
  /** Escala: altura do boneco em pixels. */
  size: number;
  mood: RunnerMood;
  /** Fase da passada (radianos). */
  phase: number;
  time: number;
  alpha?: number;
}

/** Desenha o corredor com os pés no ponto (x, y) da tela. */
export function drawRunner(ctx: CanvasRenderingContext2D, candidate: Candidate, x: number, y: number, options: DrawOptions) {
  const look = LOOKS[candidate];
  const pose = poseFor(options.mood, options.phase, options.time);
  const points = skeleton(pose, look);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(options.size / 100, options.size / 100);
  if (options.alpha !== undefined) ctx.globalAlpha = options.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  drawArm(ctx, points.far, look, true);
  drawLeg(ctx, points.far, look, true);
  drawTorso(ctx, points, pose, look);
  drawLeg(ctx, points.near, look, false);

  // cabeça grande, inclinada com o tronco
  ctx.save();
  ctx.translate(points.head[0], points.head[1]);
  ctx.rotate(pose.lean * 0.35 + pose.headTilt);
  ctx.scale(1.08, 1.08);
  drawHead(ctx, candidate, pose.expression);
  ctx.restore();

  drawArm(ctx, points.near, look, false);

  if (options.mood === 'stumble') {
    // estrelinhas de tontura em volta da cabeça
    for (let index = 0; index < 3; index++) {
      const angle = options.time * 6 + index * (Math.PI * 2 / 3);
      const sx = points.head[0] + Math.cos(angle) * 15, sy = points.head[1] - 16 + Math.sin(angle) * 4;
      star(ctx, sx, sy, 3.2, '#ffd84a');
    }
  }
  ctx.restore();
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.beginPath();
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + index * Math.PI / 5, r = index % 2 ? radius * 0.45 : radius;
    const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r;
    if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Ritmo da passada em ciclos por segundo, a partir do estado do corredor. */
export function strideRate(mood: RunnerMood): number {
  return mood === 'boost' ? 3.1 : mood === 'sprint' || mood === 'overtake' ? 2.6 : mood === 'run' ? 2.15 : 0;
}
