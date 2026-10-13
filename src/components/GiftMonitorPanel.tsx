import { useEffect, useState } from 'react';
import type { ArenaState } from '../types';

interface GiftRow {
  id: number; at: string; giftId: string; giftName: string | null; repeatCount: number; sender: string | null;
  status: string; registryName: string | null; runner: string | null; detail: string | null; reason: string | null;
}
interface Pending { giftId: string; giftName: string | null; count: number; lastAt: string }

const STATUS: Record<string, string> = { aplicado: 'APLICADO', pendente: 'PENDENTE', fora_da_rodada: 'FORA DA RODADA', descartado: 'DESCARTADO' };
const RUNNER = (value: string | null) => value === 'lula' ? '13' : value === 'bolsonaro' ? '22' : '—';
const CONNECTION: Record<string, string> = {
  connected: 'CONECTADO', connecting: 'CONECTANDO', reconnecting: 'RECONECTANDO', offline: 'LIVE OFFLINE', standby: 'EM ESPERA',
  error: 'ERRO', disconnected: 'DESCONECTADO', disabled: 'DESATIVADO', ended: 'ENCERRADA', stalled: 'SEM EVENTOS'
};

/** Monitoramento administrativo dos presentes REAIS do TikTok (simulações não aparecem aqui). */
export function GiftMonitorPanel({ state, token, onMessage }: { state: ArenaState; token: string; onMessage: (message: string) => void }) {
  const [history, setHistory] = useState<GiftRow[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const connector = state.connector;
  const headers = { 'x-admin-token': token };

  const load = async () => {
    const response = await fetch('/api/tiktok/gifts?limit=30', { headers });
    if (!response.ok) return;
    const data = await response.json();
    setHistory(data.history ?? []);
    setPending(data.pending ?? []);
  };
  useEffect(() => { void load(); }, [token, connector.lastGift?.at, connector.status]);
  useEffect(() => { const timer = setInterval(() => void load(), 10_000); return () => clearInterval(timer); }, [token]);

  async function applyCatalog() {
    const response = await fetch('/api/tiktok/catalog/apply', { method: 'POST', headers });
    const data = await response.json().catch(() => ({}));
    onMessage(response.ok ? `${data.applied?.length ?? 0} ID(s) aplicados pelo catálogo da sala.` : 'Falha ao aplicar o catálogo.');
  }

  const last = connector.lastGift;
  return (
    <article className="panel gift-monitor">
      <div className="panel-heading"><div><p className="eyebrow">TIKTOK · PRESENTES REAIS</p><h2>Monitoramento do listener</h2></div><span className={`demo-chip`}>{CONNECTION[connector.status] ?? connector.status}</span></div>
      <p>{connector.detail}</p>
      <dl className="monitor-grid">
        <div><dt>Conexão LIVE</dt><dd>{CONNECTION[connector.status] ?? connector.status}</dd></div>
        <div><dt>Conta</dt><dd>{connector.username ? `@${connector.username}` : '—'}</dd></div>
        <div><dt>Room ID</dt><dd>{connector.roomId ?? '—'}</dd></div>
        <div><dt>Último presente</dt><dd>{last ? `${last.giftName ?? '(sem nome)'} ×${last.repeatCount}` : '—'}</dd></div>
        <div><dt>giftId</dt><dd>{last?.giftId ?? '—'}</dd></div>
        <div><dt>Quantidade</dt><dd>{last?.repeatCount ?? '—'}</dd></div>
        <div><dt>Corredor</dt><dd>{RUNNER(last?.runner ?? null)}</dd></div>
        <div><dt>Poder aplicado</dt><dd>{last?.power ?? (last ? STATUS[last.status] : '—')}</dd></div>
        <div><dt>Aplicados / desconhecidos</dt><dd>{connector.appliedGifts ?? 0} / {connector.unknownGifts ?? 0}</dd></div>
      </dl>
      {pending.length > 0 && <>
        <h3>Presentes desconhecidos (pendentes)</h3>
        <p className="helper-text">Cadastre o giftId no painel de presentes para ativá-los. Nenhum poder foi acionado por eles.</p>
        <table className="monitor-table"><thead><tr><th>giftId</th><th>Nome</th><th>Qtd</th><th>Último</th></tr></thead>
          <tbody>{pending.map(item => <tr key={item.giftId}><td>{item.giftId}</td><td>{item.giftName ?? '—'}</td><td>{item.count}</td><td>{new Date(item.lastAt).toLocaleTimeString('pt-BR')}</td></tr>)}</tbody></table>
      </>}
      <h3>Histórico recente</h3>
      {history.length === 0 ? <p className="helper-text">Nenhum presente real recebido ainda.</p> :
        <table className="monitor-table"><thead><tr><th>Hora</th><th>giftId</th><th>Presente</th><th>Qtd</th><th>De</th><th>Corredor</th><th>Situação</th></tr></thead>
          <tbody>{history.map(row => <tr key={row.id} title={row.reason ?? row.detail ?? ''}><td>{new Date(row.at).toLocaleTimeString('pt-BR')}</td><td>{row.giftId}</td><td>{row.registryName ?? row.giftName ?? '—'}</td><td>{row.repeatCount}</td><td>{row.sender ?? '—'}</td><td>{RUNNER(row.runner)}</td><td>{STATUS[row.status] ?? row.status}</td></tr>)}</tbody></table>}
      <div className="inline-actions"><button className="ghost-button" onClick={() => void load()}>Atualizar</button><button className="ghost-button" onClick={() => void applyCatalog()}>Aplicar IDs do catálogo da sala</button></div>
      <small>Integração não oficial (tiktok-live-connector). Eventos simulados não aparecem neste histórico.</small>
    </article>
  );
}
