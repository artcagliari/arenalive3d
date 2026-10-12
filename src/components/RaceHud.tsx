import { useEffect, useRef, useState } from 'react';
import { RACE_ITEMS, raceProgressPercent, type ArenaState, type Candidate, type GameState } from '../types';
import { RACE_OUTFITS } from '../outfits';

const NAMES: Record<Candidate, string> = { lula: 'LULA', bolsonaro: 'BOLSONARO' };
const ORDER: Candidate[] = ['lula', 'bolsonaro'];

function pct(value: number) { return raceProgressPercent(value); }

/** Placar horizontal do topo: posição, número, nome, barra e percentual. */
export function RaceScoreboard({ game }: { game: GameState }) {
  const leader = game.lula.raceProgress === game.bolsonaro.raceProgress ? null
    : game.lula.raceProgress > game.bolsonaro.raceProgress ? 'lula' : 'bolsonaro';
  return <section className="race-board">
    {ORDER.map(candidate => {
      const runner = game[candidate], outfit = RACE_OUTFITS[candidate], progress = pct(runner.raceProgress);
      const remaining = runner.raceProgress>=1?0:Math.max(1,Math.ceil((1-runner.raceProgress)*(game.raceDistanceM||400)));
      return <article key={candidate} className={`race-row ${candidate} ${leader === candidate ? 'leading' : ''}`}>
        <span className="race-place">{runner.position ?? (leader === candidate ? 1 : 2)}º</span>
        <span className="race-number">{outfit.number}</span>
        <div className="race-row-main">
          <div className="race-row-top"><b>{NAMES[candidate]}</b><em>{remaining} M PARA A CHEGADA</em></div>
          <div className="race-track-bar">
            <i style={{ width: `${progress}%` }} />
            <u style={{ left: `${progress}%` }}>{outfit.number}</u>
          </div>
        </div>
        <span className="race-percent">{progress}<small>%</small></span>
      </article>;
    })}
  </section>;
}

/** Colunas laterais de itens e ações especiais, com contador por rodada. */
export function RaceRails({ game }: { game: GameState }) {
  return <>{ORDER.map(candidate => <aside key={candidate} className={`race-rail ${candidate}`}>
    {RACE_ITEMS.map(item => {
      const count = game[candidate].items?.[item.id] ?? 0;
      const live = item.id === 'escudo' ? (game[candidate].shield ?? 0) > 0
        : item.id === 'tropeco' ? game[candidate].action === 'stumble'
        : game[candidate].boost > 0 && game[candidate].action !== 'run';
      return <div key={item.id} className={`race-item ${count ? 'used' : ''} ${live ? 'live' : ''}`} title={item.hint}>
        <i>{item.icon}</i><span>{item.label}</span><b>{count}</b>
      </div>;
    })}
  </aside>)}</>;
}

/** Chamadas de comando do chat, configuráveis pelo painel. */
export function RaceCommands({ config }: { config: ArenaState['config'] }) {
  return <section className="race-commands">
    <div className="race-command lula"><span>{config.lulaCommandLabel}</span></div>
    <i>×</i>
    <div className="race-command bolsonaro"><span>{config.bolsonaroCommandLabel}</span></div>
  </section>;
}

/** Destaques momentâneos: ultrapassagem e reta final. */
export function RaceFlash({ game }: { game: GameState }) {
  const [flash, setFlash] = useState<{ id: number; text: string; tone: string } | null>(null);
  const lastOvertake = useRef(game.lastOvertakeBy);
  const sprintShown = useRef(game.finalSprint);
  const sequence = useRef(0);
  useEffect(() => {
    if (game.lastOvertakeBy && game.lastOvertakeBy !== lastOvertake.current) {
      setFlash({ id: ++sequence.current, text: `${NAMES[game.lastOvertakeBy]} ULTRAPASSOU`, tone: game.lastOvertakeBy });
    }
    lastOvertake.current = game.lastOvertakeBy;
  }, [game.lastOvertakeBy]);
  useEffect(() => {
    if (game.finalSprint && !sprintShown.current) setFlash({ id: ++sequence.current, text: 'RETA FINAL', tone: 'neutral' });
    sprintShown.current = game.finalSprint;
  }, [game.finalSprint]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2_200);
    return () => window.clearTimeout(timer);
  }, [flash?.id]);
  if (!flash) return null;
  return <div key={flash.id} className={`race-flash ${flash.tone}`}>{flash.text}</div>;
}
