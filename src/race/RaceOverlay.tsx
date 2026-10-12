import { useEffect, useRef, useState } from 'react';
import { RACE_ITEMS, raceProgressPercent, type ArenaState, type AudioCue, type Candidate, type GiftBoardItem, type GiftEffect, type RaceItemId } from '../types';
import { HeadBadge, RaceStage } from './RaceStage';

/**
 * Layout vertical da corrida (1080×1920): placar no topo, chamadas de
 * comando, colunas de poderes nas laterais, pista ao centro e rodapé enxuto.
 * Tudo dimensionado em `cqw` para escalar do celular ao OBS.
 */

const NAMES: Record<Candidate, string> = { lula: 'LULA', bolsonaro: 'BOLSONARO' };
const ORDER: Candidate[] = ['lula', 'bolsonaro'];
const ICONS: Record<RaceItemId, string> = { impulso: '»', arrancada: '↟', turbo: '⚡', escudo: '◈', tropeco: '✖' };
const SHORT: Record<RaceItemId, string> = { impulso: 'IMPULSO', arrancada: 'ARRANCADA', turbo: 'TURBO', escudo: 'ESCUDO', tropeco: 'TROPEÇO' };

function keywordNumber(keyword: string, fallback: string) {
  return keyword.split(',').map(part => part.trim()).find(part => /^\d+$/.test(part)) ?? fallback;
}

function formatTime(total: number) {
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

/** "DIGITE 13 PARA LULA CORRER" vira: DIGITE · 13 · PARA LULA CORRER. */
function splitCommand(label: string) {
  const match = /^\s*(digite|comente|mande)\s+(\S+)\s+(.*)$/i.exec(label);
  return match ? { verb: match[1].toUpperCase(), code: match[2], rest: match[3].toUpperCase() } : null;
}

function Scoreboard({ state }: { state: ArenaState }) {
  const game = state.game;
  const leader = game.lula.raceProgress === game.bolsonaro.raceProgress ? null
    : game.lula.raceProgress > game.bolsonaro.raceProgress ? 'lula' : 'bolsonaro';
  return <section className="ro-board">
    {ORDER.map(candidate => {
      const runner = game[candidate];
      const progress = raceProgressPercent(runner.raceProgress);
      const remaining = runner.raceProgress>=1?0:Math.max(1,Math.ceil((1-runner.raceProgress)*(game.raceDistanceM||400)));
      const lead = leader === candidate;
      return <article key={candidate} className={`ro-row ${candidate} ${lead ? 'lead' : ''}`}>
        <div className="ro-medal"><HeadBadge candidate={candidate} expression={runner.action === 'stumble' ? 'dizzy' : lead ? 'joy' : 'smile'} /></div>
        <div className="ro-row-main">
          <div className="ro-row-top">
            <b>{NAMES[candidate]}</b>
            <span className="ro-trophy" title="Corridas vencidas">🏆 {game.roundWins[candidate]}</span>
            {lead && <span className="ro-crown">LIDERANDO</span>}
            <em>{remaining} M</em>
          </div>
          <div className="ro-bar">
            <i style={{ width: `${progress}%` }} />
            <u style={{ left: `${progress}%` }} />
          </div>
        </div>
        <div className="ro-pct"><b>{progress}</b><small>%</small></div>
        <div className="ro-place">{leader ? `${lead ? 1 : 2}º` : '—'}</div>
      </article>;
    })}
  </section>;
}

function CommandCards({ state }: { state: ArenaState }) {
  const labels: Record<Candidate, string> = { lula: state.config.lulaCommandLabel, bolsonaro: state.config.bolsonaroCommandLabel };
  return <section className="ro-calls">
    {ORDER.map(candidate => {
      const parts = splitCommand(labels[candidate]);
      return <div key={candidate} className={`ro-call ${candidate}`}>
        <HeadBadge candidate={candidate} expression="shout" className="ro-call-head" />
        {parts
          ? <p><span>{parts.verb}</span><b>{parts.code}</b><em>{parts.rest}</em></p>
          : <p><em>{labels[candidate].toUpperCase()}</em></p>}
      </div>;
    })}
    <div className="ro-gift-hint">🎁 Presentes da <b>esquerda</b> empurram o LULA · da <b>direita</b>, o BOLSONARO</div>
  </section>;
}

function PowerRail({ state, candidate }: { state: ArenaState; candidate: Candidate }) {
  const runner = state.game[candidate];
  const number = keywordNumber(candidate === 'lula' ? state.config.lulaKeyword : state.config.bolsonaroKeyword, candidate === 'lula' ? '13' : '22');
  return <aside className={`ro-rail ${candidate}`}>
    {RACE_ITEMS.map(item => {
      const count = runner.items?.[item.id] ?? 0;
      const active = item.id === 'escudo' ? runner.shield > 0
        : item.id === 'tropeco' ? runner.action === 'stumble'
        : item.id === 'turbo' ? runner.boost > 55
        : item.id === 'arrancada' ? runner.action === 'boost' && runner.boost <= 55
        : runner.action === 'sprint' && runner.boost > 0;
      const hint = (state.config.powerShortcuts?.[item.id] ?? '').replace('{n}', number);
      return <div key={item.id} className={`ro-power ${item.id} ${active ? 'on' : ''} ${count ? 'used' : ''}`}>
        <i>{ICONS[item.id]}</i>
        <div><b>{SHORT[item.id]}</b>{hint && <small>{hint}</small>}</div>
        {count > 0 && <span>{count}</span>}
      </div>;
    })}
  </aside>;
}

/** Ícone provisório enquanto a imagem oficial do presente não é enviada. */
const PLACEHOLDER: Record<GiftEffect, string> = { impulso: '»', arrancada: '↟', turbo: '⚡', escudo: '◈', tropeco: '✖', especial: '★', aleatorio: '?', recuperacao: '♥' };
/** Até 10 presentes por coluna cabem de uma vez; acima disso a coluna alterna. */
const PAGE_SIZE = 10, PAGE_MS = 6_000;

/** Coluna de presentes cadastrados: imagem, efeito, valor e contador da rodada. */
function GiftRail({ state, candidate, gifts }: { state: ArenaState; candidate: Candidate; gifts: GiftBoardItem[] }) {
  const now = Date.parse(state.serverNow);
  // Mais de 10 presentes: a coluna mostra 10 por vez e alterna; o presente
  // recém-recebido sempre puxa a página dele para a tela.
  const pages = Math.max(1, Math.ceil(gifts.length / PAGE_SIZE));
  const recent = gifts.map((gift, index) => ({ index, at: gift.lastAt ? Date.parse(gift.lastAt) : 0 }))
    .filter(item => now - item.at < 4_000).sort((a, b) => b.at - a.at)[0];
  const page = recent ? Math.floor(recent.index / PAGE_SIZE) : Math.floor(Date.now() / PAGE_MS) % pages;
  const visible = gifts.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return <aside className={`ro-rail ro-gifts ${candidate}`}>
    {visible.map(gift => {
      const hit = gift.lastAt !== null && now - Date.parse(gift.lastAt) < 2_200;
      return <div key={gift.id} className={`ro-gift ${gift.effect} ${gift.target} ${hit ? 'hit' : ''}`} title={gift.name}>
        <div className="ro-gift-img">
          {gift.imageUrl ? <img src={gift.imageUrl} alt={gift.name} /> : <i>{PLACEHOLDER[gift.effect]}</i>}
          {gift.costLabel && <small className="ro-coin">{gift.costLabel}</small>}
        </div>
        <b>{gift.label}</b>
        {gift.count > 0 && <span className="ro-gift-count">{gift.count}</span>}
        {hit && <em key={gift.lastAt} className="ro-gift-pop">+1</em>}
      </div>;
    })}
    {pages > 1 && <div className="ro-gift-pages">{Array.from({ length: pages }, (_, index) => <i key={index} className={index === page ? 'on' : ''} />)}</div>}
  </aside>;
}

function Flash({ state }: { state: ArenaState }) {
  const game = state.game;
  const [flash, setFlash] = useState<{ id: number; text: string; tone: string } | null>(null);
  const lastOvertake = useRef(game.lastOvertakeBy), sprintShown = useRef(game.finalSprint), sequence = useRef(0);
  useEffect(() => {
    if (game.lastOvertakeBy && game.lastOvertakeBy !== lastOvertake.current && state.phase === 'live') {
      setFlash({ id: ++sequence.current, text: `${NAMES[game.lastOvertakeBy]} ULTRAPASSOU!`, tone: game.lastOvertakeBy });
    }
    lastOvertake.current = game.lastOvertakeBy;
  }, [game.lastOvertakeBy, state.phase]);
  useEffect(() => {
    if (game.finalSprint && !sprintShown.current) setFlash({ id: ++sequence.current, text: 'RETA FINAL!', tone: 'gold' });
    sprintShown.current = game.finalSprint;
  }, [game.finalSprint]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [flash?.id]);
  return flash ? <div key={flash.id} className={`ro-flash ${flash.tone}`}>{flash.text}</div> : null;
}

function Curtain({ state, seconds }: { state: ArenaState; seconds: number }) {
  const { phase, game } = state;
  if (phase === 'live') return null;
  if (phase === 'results') {
    const winner = game.winner;
    return <div className="ro-curtain results">
      {winner && winner !== 'tie' && <HeadBadge candidate={winner} expression="joy" className="ro-curtain-head" />}
      <span>RESULTADO DA CORRIDA</span>
      <h3>{winner === 'tie' ? 'EMPATE!' : `${winner === 'lula' ? 'LULA' : 'BOLSONARO'} VENCEU!`}</h3>
      <p>{game.roundWins.lula} <i>×</i> {game.roundWins.bolsonaro}</p>
    </div>;
  }
  const text = phase === 'opening' ? 'PREPARAR…' : phase === 'intermission' ? 'PRÓXIMA CORRIDA' : phase === 'paused' ? 'CORRIDA PAUSADA'
    : phase === 'emergency' ? 'TRANSMISSÃO SUSPENSA' : 'AGUARDANDO LARGADA';
  return <div className={`ro-curtain ${phase}`}>
    <span>{phase === 'opening' ? 'CORREDORES NA LARGADA' : `PISTA DE ${game.raceDistanceM || 400} METROS`}</span>
    <h3>{text}</h3>
    {(phase === 'opening' || phase === 'intermission') && seconds > 0 && <p className="ro-count">{seconds}</p>}
    {phase === 'emergency' && state.emergencyReason && <small>{state.emergencyReason}</small>}
  </div>;
}

export interface RaceOverlayProps {
  state: ArenaState;
  seconds: number;
  connected: boolean;
  callout: AudioCue | null;
  muted: boolean;
  onToggleSound: () => void;
}

/**
 * Antes da largada (aguardando, abertura, intervalo) a tela mostra o grid de
 * largada: progresso zerado e sem vencedor, em vez do retrato da corrida anterior.
 * O resultado continua visível na fase de resultado.
 */
function atStartingGrid(source: ArenaState): ArenaState {
  if (!['idle', 'opening', 'intermission'].includes(source.phase)) return source;
  const reset = (runner: ArenaState['game']['lula']) => ({
    ...runner, raceProgress: 0, speed: 0, boost: 0, shield: 0, action: 'idle' as const,
    items: { impulso: 0, arrancada: 0, turbo: 0, escudo: 0, tropeco: 0 }
  });
  return {
    ...source,
    game: { ...source.game, winner: null, finalSprint: false, lastOvertakeBy: null, lula: reset(source.game.lula), bolsonaro: reset(source.game.bolsonaro) }
  };
}

export function RaceOverlay({ state: source, seconds, connected, callout, muted, onToggleSound }: RaceOverlayProps) {
  const state = atStartingGrid(source);
  const [, setTick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTick(value => value + 1), 1_000); return () => window.clearInterval(timer); }, []);
  const testing = state.connector.status !== 'connected';
  const lastEvent = state.lastEvent;
  return <section className={`broadcast-frame race-frame phase-${state.phase}`}>
    <RaceStage game={state.game} phase={state.phase} reduced={state.config.reducedMotion} />

    <header className="ro-top">
      <span className="ro-live"><i className={connected ? '' : 'off'} />AO VIVO</span>
      <span className="ro-title">CORRIDA <em>PRESIDENCIAL</em></span>
      <span className="ro-timer">{formatTime(seconds)}<small className="ro-round">R{Math.max(1, state.roundNumber)}</small></span>
    </header>

    <Scoreboard state={state} />
    <CommandCards state={state} />
    {ORDER.map(candidate => {
      // Com presentes cadastrados, a coluna mostra os presentes; sem eles, os poderes.
      const gifts = (state.gifts ?? []).filter(gift => gift.side === candidate);
      return gifts.length ? <GiftRail key={candidate} state={state} candidate={candidate} gifts={gifts} /> : <PowerRail key={candidate} state={state} candidate={candidate} />;
    })}
    {state.phase === 'live' && <Flash state={state} />}
    <Curtain state={state} seconds={seconds} />

    <footer className="ro-bottom">
      <div className="ro-likes">
        <span>♥</span>
        <div><b>META DE CURTIDAS</b><i><u style={{ width: `${Math.min(100, state.likes / Math.max(1, state.config.likesGoal) * 100)}%` }} /></i></div>
        <strong>{state.likes.toLocaleString('pt-BR')}<small>/{state.config.likesGoal.toLocaleString('pt-BR')}</small></strong>
      </div>
      <div className="ro-support">
        <span className="lula">{state.lula.points}<small>apoio</small></span>
        {lastEvent ? <p>{lastEvent.summary}</p> : <p>comente para empurrar seu corredor</p>}
        <span className="bolsonaro">{state.bolsonaro.points}<small>apoio</small></span>
      </div>
    </footer>

    {callout && <div key={callout.id} className={`ro-callout ${callout.candidate ?? 'neutral'}`}>{callout.isSatire ? 'SÁTIRA · ' : '♪ '}{callout.name}</div>}

    <div className="ro-badges">
      {testing && <span className="ro-chip">MODO TESTE</span>}
      <span className="ro-legal">paródia fictícia · não é pesquisa eleitoral</span>
    </div>
    <button className="ro-sound" onClick={onToggleSound} aria-label={muted ? 'Ativar som' : 'Silenciar'}>{muted ? 'SOM OFF' : 'SOM ON'}</button>
  </section>;
}
