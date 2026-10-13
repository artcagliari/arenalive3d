import { useState } from 'react';
import { RACE_ITEMS, raceProgressPercent, type ArenaState, type Candidate, type RaceItemId } from '../types';
import { RACE_OUTFITS } from '../outfits';

const NAMES: Record<Candidate, string> = { lula: '13', bolsonaro: '22' };
const ORDER: Candidate[] = ['lula', 'bolsonaro'];

/** Prévia da corrida + disparo manual dos itens, para testar antes e durante a LIVE. */
export function RaceControlPanel({ state, token, onMessage }: { state: ArenaState; token: string; onMessage: (message: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const game = state.game, live = state.phase === 'live' && game.mode === 'race';

  async function fire(candidate: Candidate, item: RaceItemId) {
    const key = `${candidate}:${item}`;
    setBusy(key);
    try {
      const response = await fetch('/api/race/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify({ candidate, item })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Falha ao acionar o item.');
      onMessage(body.applied
        ? `${RACE_ITEMS.find(entry => entry.id === item)?.label} aplicado em ${NAMES[candidate]}.`
        : `${NAMES[candidate]} estava com escudo: o tropeço foi anulado.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Falha ao acionar o item.');
    } finally { setBusy(null); }
  }

  return <section className="panel race-panel" id="race">
    <div className="panel-heading">
      <div><p className="eyebrow">MODO PRINCIPAL</p><h2>Corrida em tempo real</h2></div>
      <span className={`phase-chip ${live ? '' : 'offline'}`}>{live ? 'CORRIDA ATIVA' : game.mode === 'race' ? 'FORA DA CORRIDA' : 'MODO BATALHA'}</span>
    </div>

    <div className="race-preview">{ORDER.map(candidate => {
      const runner = game[candidate], outfit = RACE_OUTFITS[candidate];
      const progress = raceProgressPercent(runner.raceProgress);
      return <article key={candidate} className={`race-preview-row ${candidate}`}>
        <div className="race-preview-head">
          <span className="race-preview-number">{outfit.number}</span>
          <div><b>{NAMES[candidate]}</b><small>{runner.position ?? '—'}º lugar · {runner.action}{(runner.shield ?? 0) > 0 ? ' · escudo ativo' : ''}</small></div>
          <strong>{progress}%</strong>
        </div>
        <div className="race-preview-bar"><i style={{ width: `${progress}%` }} /></div>
        <div className="race-preview-items">{RACE_ITEMS.map(item =>
          <span key={item.id} className={runner.items?.[item.id] ? 'on' : ''}>{item.label} <b>{runner.items?.[item.id] ?? 0}</b></span>
        )}</div>
      </article>;
    })}</div>

    <div className="race-test">
      <div className="race-test-head"><b>TESTAR ITENS NA PISTA</b><span>{live ? 'Os disparos valem para a corrida em andamento e ficam registrados nos eventos.' : 'Inicie uma corrida para liberar os testes.'}</span></div>
      {ORDER.map(candidate => <div key={candidate} className={`race-test-row ${candidate}`}>
        <span>{NAMES[candidate]}</span>
        <div>{RACE_ITEMS.map(item => <button key={item.id} type="button" disabled={!live || busy !== null}
          onClick={() => void fire(candidate, item.id)} title={item.hint}>
          <i>{item.icon}</i>{busy === `${candidate}:${item.id}` ? '…' : item.label}
        </button>)}</div>
      </div>)}
    </div>
  </section>;
}
