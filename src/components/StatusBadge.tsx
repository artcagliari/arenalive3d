import type { ArenaState } from '../types';

const labels = {
  disabled: 'TikTok desativado', connecting: 'Conectando', connected: 'TikTok conectado', reconnecting: 'Reconectando',
  stalled: 'Sem eventos', disconnected: 'TikTok desconectado', ended: 'LIVE encerrada', error: 'Erro no conector', offline: 'LIVE offline', standby: 'Listener em espera'
};

export function StatusBadge({ state, socketConnected }: { state: ArenaState; socketConnected: boolean }) {
  const good = socketConnected && state.connector.status === 'connected';
  const warning = ['connecting', 'reconnecting', 'stalled', 'offline', 'standby'].includes(state.connector.status);
  return (
    <div className={`status-badge ${good ? 'good' : warning ? 'warning' : 'bad'}`} title={state.connector.detail}>
      <span className="status-dot" />
      {!socketConnected ? 'Servidor reconectando' : labels[state.connector.status]}
    </div>
  );
}
