import { type FormEvent, useEffect, useState } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { AudioLibraryPanel } from '../components/AudioLibraryPanel';
import { AudioDiagnosticsPanel } from '../components/AudioDiagnosticsPanel';
import { GiftsPanel } from '../components/GiftsPanel';
import { GiftMonitorPanel } from '../components/GiftMonitorPanel';
import { CharacterAssetsPanel } from '../components/CharacterAssetsPanel';
import { RaceControlPanel } from '../components/RaceControlPanel';
import { useArena, useCountdown } from '../hooks/useArena';
import { RACE_ITEMS, raceProgressPercent, type ArenaConfig, type PublicEvent, type RoundSummary, type SystemDiagnostics } from '../types';

const phaseLabel = { idle: 'Preparação', opening: 'Contagem regressiva', live: 'Corrida', paused: 'Automação pausada', results: 'Resultado', intermission: 'Reinício automático', emergency: 'Emergência' };

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  return `${m}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function Admin({ mode }: { mode: 'admin' | 'monitor' }) {
  const { state, connected } = useArena();
  const seconds = useCountdown(state?.phaseEndsAt, state?.serverNow);
  const [token, setToken] = useState(() => sessionStorage.getItem('arena_token') ?? '');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [draft, setDraft] = useState<ArenaConfig | null>(null);
  const [username, setUsername] = useState('');

  async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'x-admin-token': token, ...(options.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? 'Falha na operação.');
    return body;
  }

  async function loadPrivate() {
    const [eventData, roundData, diagnosticData] = await Promise.all([api<PublicEvent[]>('/api/events?limit=80'), api<RoundSummary[]>('/api/rounds'), api<SystemDiagnostics>('/api/diagnostics')]);
    setEvents(eventData); setRounds(roundData); setDiagnostics(diagnosticData);
  }

  useEffect(() => { if (state && !draft) setDraft(state.config); }, [state, draft]);
  useEffect(()=>{if(!state)return;setDraft(current=>current?{...current,lulaCharacterAsset:state.config.lulaCharacterAsset,bolsonaroCharacterAsset:state.config.bolsonaroCharacterAsset,characterAssetVersion:state.config.characterAssetVersion}:state.config)},[state?.config.characterAssetVersion]);
  useEffect(() => {
    if (!authenticated) return;
    void loadPrivate();
    const timer = window.setInterval(() => void loadPrivate().catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, [authenticated, token]);

  async function login(event: FormEvent) {
    event.preventDefault(); setAuthError('');
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ token }) });
      sessionStorage.setItem('arena_token', token); setAuthenticated(true);
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Acesso negado.'); }
  }

  async function action(name: string, body: object = {}) {
    setMessage('');
    try {
      await api(`/api/control/${name}`, { method: 'POST', body: JSON.stringify(body) });
      setMessage('Comando aplicado.'); await loadPrivate();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha.'); }
  }

  async function simulate(type: 'comment' | 'gift' | 'like', candidate?: 'lula' | 'bolsonaro', count = 1) {
    try {
      const response = await api<{ ok: boolean; results: Array<{ accepted: boolean; reason?: string }> }>('/api/simulate', { method: 'POST', body: JSON.stringify({ type, candidate, count }) });
      const failed = response.results.find(result => !result.accepted);
      setMessage(response.ok ? 'Evento simulado enviado.' : failed?.reason ?? 'Evento recusado.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha.'); }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    try {
      await api('/api/config', { method: 'PATCH', body: JSON.stringify(draft) });
      setMessage('Configuração salva e persistida.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar.'); }
  }

  if (!authenticated) return (
    <main className="auth-page">
      <div className="auth-orbit" />
      <form className="auth-card" onSubmit={login}>
        <div className="admin-logo"><span>LA</span><div><b>LIVE ARENA</b><small>CONTROL CENTER</small></div></div>
        <p className="eyebrow">ACESSO RESTRITO</p>
        <h1>{mode === 'monitor' ? 'Monitoramento remoto' : 'Painel administrativo'}</h1>
        <p>Use o token definido em <code>ADMIN_TOKEN</code>. O token fica apenas nesta sessão do navegador.</p>
        <label>Token de acesso<input type="password" value={token} onChange={event => setToken(event.target.value)} autoFocus autoComplete="current-password" /></label>
        {authError && <div className="form-error">{authError}</div>}
        <button className="primary-button">Entrar com segurança <span>→</span></button>
        <a href="/overlay" target="_blank">Abrir apenas o overlay</a>
      </form>
    </main>
  );

  if (!state || !draft) return <main className="loading-screen"><div className="loader" /><p>Sincronizando painel…</p></main>;
  const gameIsRace = state.game.mode === 'race';
  const lulaGameValue = gameIsRace ? raceProgressPercent(state.game.lula.raceProgress) : state.game.lula.energy;
  const bolsonaroGameValue = gameIsRace ? raceProgressPercent(state.game.bolsonaro.raceProgress) : state.game.bolsonaro.energy;

  return (
    <main className="admin-app">
      <aside className="sidebar">
        <div className="admin-logo"><span>LA</span><div><b>LIVE ARENA</b><small>CONTROL CENTER</small></div></div>
        <nav><a className="active" href="#overview">◫ Visão geral</a><a href="#diagnostics">◇ Diagnóstico</a>{mode === 'admin' && <><a href="#controls">◉ Operação</a><a href="#race">⚑ Corrida</a><a href="#gifts">🎁 Presentes</a><a href="/admin/testes">⚗ Central de testes</a><a href="#settings">⌘ Configurações</a><a href="#characters">◎ Personagens</a><a href="#audio-diagnostics">♪ Diagnóstico de áudio</a><a href="/admin/bordoes">♫ Central de Bordões</a><a href="#events">≡ Eventos</a></>}<a href="#history">↻ Histórico</a></nav>
        <div className="sidebar-foot"><span className={`mini-dot ${connected ? 'online' : ''}`} /> Servidor {connected ? 'online' : 'reconectando'}<button onClick={() => { sessionStorage.removeItem('arena_token'); setAuthenticated(false); }}>Sair</button></div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div><p className="eyebrow">{mode === 'monitor' ? 'MODO MODERADOR' : 'OPERAÇÃO SUPERVISIONADA'}</p><h1>{mode === 'monitor' ? 'Monitoramento' : 'Painel da transmissão'}</h1></div>
          <div className="top-actions"><a href="/admin/bordoes" className="primary-button">♫ GERENCIAR BORDÕES</a><a href="/admin/testes" className="ghost-button">⚗ TESTES</a><a href="/overlay" target="_blank" className="ghost-button">Abrir overlay ↗</a><StatusBadge state={state} socketConnected={connected} /></div>
        </header>

        {(['disconnected', 'stalled', 'error', 'ended'].includes(state.connector.status) || !connected) && <div className="alert-banner"><b>⚠ Contagem real suspensa</b><span>{!connected ? 'O painel perdeu a conexão com o servidor local.' : state.connector.detail}</span></div>}
        {message && <button className="toast" onClick={() => setMessage('')}>{message}<span>×</span></button>}

        <section className="metrics-grid" id="overview">
          <article className="metric-card live-state"><span>ESTADO DA OPERAÇÃO</span><div><i className={`state-light ${state.phase}`} /><b>{phaseLabel[state.phase]}</b></div><small>{state.phaseEndsAt ? `${fmtDuration(seconds)} para a próxima etapa` : 'Sem transição agendada'}</small></article>
          <article className="metric-card"><span>JOGO ATUAL · RODADA #{Math.max(1, state.roundNumber)}</span><b className="big-number">{gameIsRace ? `Corrida · ${state.game.raceDistanceM} m` : 'Batalha 3D'}</b><small>{state.config.autoMode ? 'Ciclo automático ativo' : 'Controle manual'} · dificuldade {state.config.gameDifficulty}</small></article>
          <article className="metric-card"><span>EVENTOS NA RODADA</span><b className="big-number">{state.lula.interactions + state.bolsonaro.interactions}</b><small>{state.lula.uniqueUsers + state.bolsonaro.uniqueUsers} participantes únicos</small></article>
          <article className="metric-card"><span>EVENTOS INTERNOS (AUTOMÁTICOS)</span><b className="big-number">{state.automation?.autoEventsRound ?? 0}</b><small>{state.automation?.alwaysOn ? 'Corrida automática permanente' : 'Ciclo manual'} · {state.automation?.autoEventsEnabled === false ? 'aleatórios DESLIGADOS: impulso só por comentário/presente' : `${state.automation?.autoEventsTotal ?? 0} no total`}{state.automation?.lastAutoEvent ? ` · último: ${state.automation.lastAutoEvent.kind} em ${state.automation.lastAutoEvent.candidate === 'lula' ? '13' : '22'}` : ''} · não são presentes</small></article>
          <article className="metric-card"><span>WATCHDOG</span><div><i className={`state-light ${state.health.watchdog}`} /><b>{state.health.watchdog === 'ok' ? 'Saudável' : 'Atenção'}</b></div><small>Servidor ativo há {fmtDuration(state.health.uptimeSec)}</small></article>
        </section>

        <section className="panel diagnostics-panel" id="diagnostics">
          <div className="panel-heading"><div><p className="eyebrow">TELEMETRIA AO VIVO</p><h2>Diagnóstico da arena</h2></div><span className={`phase-chip ${diagnostics?.overlay ? '' : 'offline'}`}>{diagnostics?.overlay ? 'OVERLAY ATIVO' : 'SEM OVERLAY'}</span></div>
          <div className="diagnostic-grid">
            <article><span>FPS DO OVERLAY</span><b>{diagnostics?.overlay ? diagnostics.overlay.fps.toFixed(1) : '—'}</b><small>{diagnostics?.overlay ? (diagnostics.overlay.fps >= 50 ? 'fluido para 60 FPS' : diagnostics.overlay.fps >= 27 ? 'adequado para 30 FPS' : 'desempenho reduzido recomendado') : 'Abra /overlay ou a fonte no OBS'}</small></article>
            <article><span>MEMÓRIA ESTIMADA</span><b>{diagnostics ? `${diagnostics.server.rssMb} MB` : '—'}</b><small>Servidor RSS{diagnostics?.overlay?.memoryMb != null ? ` · overlay ${diagnostics.overlay.memoryMb} MB` : ' · navegador indisponível'}</small></article>
            <article><span>WEBSOCKET</span><b className={connected ? 'diag-ok' : 'diag-error'}>{connected ? 'Conectado' : 'Reconectando'}</b><small>{diagnostics ? `${diagnostics.server.websocketClients} cliente(s) · ${diagnostics.server.overlayConnections} overlay(s)` : 'Aguardando telemetria'}</small></article>
            <article><span>EVENTOS</span><b>{diagnostics?.engine.eventsReceived ?? 0}</b><small>{diagnostics?.engine.eventsAccepted ?? 0} aceitos · {diagnostics?.engine.eventsDiscarded ?? 0} descartados</small></article>
            <article><span>SISTEMA DE ÁUDIO</span><b className={diagnostics?.overlay?.audio.state === 'running' ? 'diag-ok' : 'diag-warn'}>{diagnostics?.overlay ? (diagnostics.overlay.audio.enabled ? diagnostics.overlay.audio.state : 'silenciado') : 'sem telemetria'}</b><small>{diagnostics?.overlay ? `${diagnostics.overlay.audio.active} tocando · ${diagnostics.overlay.audio.queued} na fila · ${diagnostics.overlay.audio.dropped} descartados` : 'O mixer roda somente no overlay'}</small></article>
            <article><span>MOTOR 3D</span><b>{diagnostics?.engine.lastGameTickMs ?? 0} ms</b><small>máx. {diagnostics?.engine.maxGameTickMs ?? 0} ms · {diagnostics?.engine.gameRecoveries ?? 0} recuperações</small></article>
          </div>
          <div className="discard-summary"><b>DESCARTES POR MOTIVO</b><span>{diagnostics && Object.keys(diagnostics.engine.discardReasons).length ? Object.entries(diagnostics.engine.discardReasons).map(([reason,count])=>`${reason}: ${count}`).join(' · ') : 'nenhum descarte registrado nesta execução'}</span></div>
          <div className="diagnostic-errors"><div><b>HISTÓRICO DE ALERTAS E ERROS</b><span>{diagnostics?.errors.length ?? 0} registro(s)</span></div>{diagnostics?.errors.length ? diagnostics.errors.slice(0,10).map(log=><p key={log.id}><time>{new Date(log.at).toLocaleString('pt-BR')}</time><strong className={log.level}>{log.level}</strong><span>{log.message}</span></p>) : <p className="empty-log">Nenhuma falha importante registrada.</p>}</div>
        </section>

        <section className="admin-grid">
          <article className="panel scoreboard-panel">
            <div className="panel-heading"><div><p className="eyebrow">JOGO EM TEMPO REAL</p><h2>{gameIsRace ? `Progresso da corrida · ${state.game.raceDistanceM} m` : 'Energia da batalha'}</h2></div><span className="phase-chip">{phaseLabel[state.phase]}</span></div>
            <div className="admin-score">
              <div className="admin-candidate lula"><img src="/portraits/lula.jpg" alt="" /><div><span>13 · {state.game.lula.action}</span><b>{Math.round(lulaGameValue)}{gameIsRace ? '%' : ''}</b><small>{state.game.roundWins.lula} vitórias · {state.lula.points} apoio</small></div></div>
              <div className="score-divider">{state.game.roundWins.lula}<i>×</i>{state.game.roundWins.bolsonaro}</div>
              <div className="admin-candidate bolsonaro"><div><span>22 · {state.game.bolsonaro.action}</span><b>{Math.round(bolsonaroGameValue)}{gameIsRace ? '%' : ''}</b><small>{state.game.roundWins.bolsonaro} vitórias · {state.bolsonaro.points} apoio</small></div><img src="/portraits/bolsonaro.jpg" alt="" /></div>
            </div>
            <div className="admin-balance"><i style={{ width: `${Math.max(1,lulaGameValue)}%` }} /><i style={{ width: `${Math.max(1,bolsonaroGameValue)}%` }} /></div>
            <div className="last-event"><span>ÚLTIMO EVENTO</span><p>{state.lastEvent?.summary ?? 'Nenhum evento recebido ainda'}</p><time>{state.lastEvent ? new Date(state.lastEvent.at).toLocaleTimeString('pt-BR') : '—'}</time></div>
          </article>

          <article className="panel safety-panel">
            <div className="panel-heading"><div><p className="eyebrow">SEGURANÇA</p><h2>Interrupção imediata</h2></div></div>
            <p>Suspende a contagem, o ciclo automático e desconecta o coletor de eventos reais. Não encerra nem inicia a LIVE no TikTok.</p>
            {state.phase === 'emergency' ? <button className="release-button" onClick={() => action('release-emergency')}>Liberar emergência</button> : <button className="emergency-button" onClick={() => action('emergency', { reason: `Acionada por ${mode === 'monitor' ? 'moderador' : 'administrador'}` })}><span>■</span> PARADA DE EMERGÊNCIA</button>}
          </article>
        </section>

        {mode === 'admin' && <>
          <section className="panel" id="controls">
            <div className="panel-heading"><div><p className="eyebrow">CONTROLE DE TRANSMISSÃO</p><h2>Operação supervisionada</h2></div><label className="switch"><input type="checkbox" checked={draft.autoMode} onChange={event => { const next = { ...draft, autoMode: event.target.checked }; setDraft(next); void api('/api/config', { method: 'PATCH', body: JSON.stringify({ autoMode: next.autoMode }) }); }} /><span /><b>Modo automático</b></label></div>
            <div className="control-buttons"><button onClick={() => action('start')} className="start">▶ Iniciar ciclo</button><button onClick={() => action(state.phase === 'paused' ? 'resume' : 'pause')}>Ⅱ {state.phase === 'paused' ? 'Continuar automação' : 'Pausar automação'}</button><button onClick={() => action('restart')}>↻ Reiniciar rodada</button><button onClick={() => action('finish')}>■ Encerrar rodada</button><button onClick={() => action('stop-cycle')} className="danger-lite">■ Encerrar ciclo</button><button onClick={() => action('reset')} className="danger-lite">↺ Zerar placar</button></div>
            <p className="helper-text">O sistema automatiza o placar e a apresentação. Ele nunca inicia uma transmissão no TikTok. Com o modo automático ligado, a corrida reinicia sozinha a cada rodada.</p>
          </section>

          <RaceControlPanel state={state} token={token} onMessage={setMessage} />
          <GiftMonitorPanel state={state} token={token} onMessage={setMessage} />
          <GiftsPanel token={token} onMessage={setMessage} />

          <section className="admin-grid">
            <article className="panel simulation-panel">
              <div className="panel-heading"><div><p className="eyebrow">AMBIENTE DE TESTE</p><h2>Simular eventos</h2></div><span className="demo-chip">DEMO</span></div>
              <p>Os registros ficam identificados como simulação. Na corrida, comentários dão impulso e presentes liberam turbo; na batalha, defesa e golpe especial.</p>
              <div className="simulation-grid"><button onClick={() => simulate('comment', 'lula')}>Comentário <b>13</b></button><button onClick={() => simulate('comment', 'bolsonaro')}>Comentário <b>22</b></button><button onClick={() => simulate('gift', 'lula')}>Presente <b>13</b></button><button onClick={() => simulate('gift', 'bolsonaro')}>Presente <b>22</b></button><button onClick={() => simulate('like')}>♥ 10 curtidas</button><button onClick={() => simulate('gift', 'lula', 10)}>⚡ Rajada de presentes</button></div>
            </article>
            <article className="panel connector-panel">
              <div className="panel-heading"><div><p className="eyebrow">CONECTOR</p><h2>TikTok LIVE</h2></div><StatusBadge state={state} socketConnected={connected} /></div>
              <p>{state.connector.detail}</p>
              <label>Usuário da conta<input placeholder="@usuario" value={username} onChange={event => setUsername(event.target.value)} /></label>
              <div className="inline-actions"><button className="primary-button" onClick={async () => { try { await api('/api/tiktok/connect', { method: 'POST', body: JSON.stringify({ username }) }); setMessage('Conexão iniciada.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha.'); } }}>Conectar</button><button className="ghost-button" onClick={() => api('/api/tiktok/disconnect', { method: 'POST', body: '{}' })}>Desconectar</button></div>
              <small>Integração não oficial, sujeita a alterações. Use apenas em uma transmissão autorizada.</small>
            </article>
          </section>

          <form className="panel settings-panel" id="settings" onSubmit={saveConfig}>
            <div className="panel-heading"><div><p className="eyebrow">CONFIGURAÇÃO PERSISTENTE</p><h2>Rodadas e pontuação</h2></div><button className="primary-button">Salvar alterações</button></div>
            <div className="form-section"><h3>Jogo, câmera e áudio</h3><div className="form-grid"><label>Sequência de jogos<select value={draft.gameMode} onChange={e => setDraft({ ...draft, gameMode: e.target.value as ArenaConfig['gameMode'] })}><option value="race">Somente corrida (principal)</option><option value="alternate">Alternar corrida/batalha</option><option value="battle">Somente batalha</option></select></label><label>Dificuldade: {draft.gameDifficulty}<input type="range" min="1" max="5" value={draft.gameDifficulty} onChange={e => setDraft({ ...draft, gameDifficulty: Number(e.target.value) })} /></label><label>Câmera<select value={draft.cameraMode} onChange={e => setDraft({ ...draft, cameraMode: e.target.value as ArenaConfig['cameraMode'] })}><option value="dynamic">Dinâmica</option><option value="wide">Plano aberto</option><option value="close">Plano fechado</option></select></label><label>Modo de áudio<select value={draft.audioMode} onChange={e => setDraft({ ...draft, audioMode: e.target.value as ArenaConfig['audioMode'] })}><option value="discreet">Discreto</option><option value="memes">Memes</option><option value="arena">Arena</option></select></label><label>Intensidade visual: {draft.animationIntensity}%<input type="range" min="0" max="100" value={draft.animationIntensity} onChange={e => setDraft({ ...draft, animationIntensity: Number(e.target.value) })} /></label><label>Trilha: {draft.musicVolume}%<input type="range" min="0" max="100" value={draft.musicVolume} onChange={e => setDraft({ ...draft, musicVolume: Number(e.target.value) })} /></label><label>Efeitos: {draft.effectsVolume}%<input type="range" min="0" max="100" value={draft.effectsVolume} onChange={e => setDraft({ ...draft, effectsVolume: Number(e.target.value) })} /></label><label>Efeitos SFX simultâneos: {draft.maxConcurrentSounds}<input type="range" min="1" max="3" value={draft.maxConcurrentSounds} onChange={e => setDraft({ ...draft, maxConcurrentSounds: Number(e.target.value) })} /></label><label>Intervalo entre bordões (seg)<input type="number" min="1" max="300" value={draft.minCatchphraseIntervalSec} onChange={e => setDraft({ ...draft, minCatchphraseIntervalSec: Number(e.target.value) })} /></label></div></div>
            <div className="form-section"><h3>Corrida</h3><div className="form-grid">
              <label>Distância da pista (m)<input type="number" min="50" max="5000" step="50" value={draft.raceDistanceM} onChange={e => setDraft({ ...draft, raceDistanceM: Number(e.target.value) })} /></label>
              <label>Duração da corrida<select value={[120,180,300,420,600].includes(draft.raceDurationSec)?draft.raceDurationSec:'custom'} onChange={e=>{if(e.target.value!=='custom'){const value=Number(e.target.value);setDraft({...draft,raceDurationSec:value,roundDurationSec:value})}}}><option value={120}>2 minutos (padrão)</option><option value={180}>3 minutos</option><option value={300}>5 minutos</option><option value={420}>7 minutos</option><option value={600}>10 minutos</option><option value="custom">Personalizada</option></select></label>
              <label>Duração personalizada (seg)<input type="number" min="60" max="3600" value={draft.raceDurationSec} onChange={e=>{const value=Number(e.target.value);setDraft({...draft,raceDurationSec:value,roundDurationSec:value})}} /></label>
              <label>Frequência de eventos de pista: {draft.raceEventFrequency}<input type="range" min="1" max="5" value={draft.raceEventFrequency} onChange={e => setDraft({ ...draft, raceEventFrequency: Number(e.target.value) })} /></label>
              <label>Vantagem por comentário: {draft.commentBoost}<input type="range" min="0" max="100" value={draft.commentBoost} onChange={e => setDraft({ ...draft, commentBoost: Number(e.target.value) })} /></label><label>Vantagem por presente: {draft.giftBoost}<input type="range" min="0" max="100" value={draft.giftBoost} onChange={e => setDraft({ ...draft, giftBoost: Number(e.target.value) })} /></label><label className="wide">Comando no overlay · 13<input maxLength={60} value={draft.lulaCommandLabel} onChange={e => setDraft({ ...draft, lulaCommandLabel: e.target.value })} /></label><label className="wide">Comando no overlay · 22<input maxLength={60} value={draft.bolsonaroCommandLabel} onChange={e => setDraft({ ...draft, bolsonaroCommandLabel: e.target.value })} /></label>{RACE_ITEMS.map(item => <label key={item.id}>Atalho · {item.label}<input maxLength={24} value={draft.powerShortcuts[item.id]} onChange={e => setDraft({ ...draft, powerShortcuts: { ...draft.powerShortcuts, [item.id]: e.target.value } })} /></label>)}</div><p className="helper-text">A duração é o limite máximo: a corrida encerra imediatamente quando um corredor chega a 100%.</p></div>

            <div className="form-section"><h3>Tempos do ciclo</h3><div className="form-grid"><label>Contagem regressiva (seg)<input type="number" min="1" value={draft.openingDurationSec} onChange={e => setDraft({ ...draft, openingDurationSec: Number(e.target.value) })} /></label><label>Resultado (seg)<input type="number" min="2" value={draft.resultsDurationSec} onChange={e => setDraft({ ...draft, resultsDurationSec: Number(e.target.value) })} /></label><label>Intervalo / reinício (seg)<input type="number" min="1" value={draft.intermissionDurationSec} onChange={e => setDraft({ ...draft, intermissionDurationSec: Number(e.target.value) })} /></label></div></div>
            <div className="form-section"><h3>Gatilhos e pontos</h3><div className="form-grid"><label>Palavras do 13 (separadas por vírgula)<input value={draft.lulaKeyword} onChange={e => setDraft({ ...draft, lulaKeyword: e.target.value })} /></label><label>Pontos por comentário<input type="number" min="0" value={draft.commentPoints} onChange={e => setDraft({ ...draft, commentPoints: Number(e.target.value) })} /></label><label>Presente 13 (ID)<input value={draft.lulaGiftId} onChange={e => setDraft({ ...draft, lulaGiftId: e.target.value })} /></label><label>Pontos presente 13<input type="number" min="0" value={draft.lulaGiftPoints} onChange={e => setDraft({ ...draft, lulaGiftPoints: Number(e.target.value) })} /></label><label>Palavras do 22 (separadas por vírgula)<input value={draft.bolsonaroKeyword} onChange={e => setDraft({ ...draft, bolsonaroKeyword: e.target.value })} /></label><label>Meta de curtidas<input type="number" min="1" value={draft.likesGoal} onChange={e => setDraft({ ...draft, likesGoal: Number(e.target.value) })} /></label><label>Presente 22 (ID)<input value={draft.bolsonaroGiftId} onChange={e => setDraft({ ...draft, bolsonaroGiftId: e.target.value })} /></label><label>Pontos presente 22<input type="number" min="0" value={draft.bolsonaroGiftPoints} onChange={e => setDraft({ ...draft, bolsonaroGiftPoints: Number(e.target.value) })} /></label></div></div>
            <div className="checks"><label><input type="checkbox" checked={draft.soundEnabled} onChange={e => setDraft({ ...draft, soundEnabled: e.target.checked })} /> Som ligado (desmarque para mutar tudo)</label><label><input type="checkbox" checked={draft.reducedMotion} onChange={e => setDraft({ ...draft, reducedMotion: e.target.checked })} /> Modo de desempenho reduzido</label></div>
          </form>
          <CharacterAssetsPanel config={state.config} token={token} onMessage={setMessage}/>
          <AudioDiagnosticsPanel config={state.config} token={token} onMessage={setMessage} onConfigChange={patch => setDraft(current => current ? { ...current, ...patch } : current)} />
          <AudioLibraryPanel token={token} onMessage={setMessage} />
        </>}

        {mode === 'admin' && <section className="panel table-panel" id="events"><div className="panel-heading"><div><p className="eyebrow">AUDITORIA</p><h2>Eventos recentes</h2></div></div><div className="table-wrap"><table><thead><tr><th>Horário</th><th>Origem</th><th>Tipo</th><th>Resumo</th><th>Pontos</th></tr></thead><tbody>{events.map((event, index) => <tr key={`${event.at}-${index}`}><td>{new Date(event.at).toLocaleTimeString('pt-BR')}</td><td><span className={`source ${event.source}`}>{event.source === 'demo' ? 'SIMULADO' : event.source === 'tiktok' ? 'REAL (TikTok)' : 'INTERNO'}</span></td><td>{event.type}</td><td>{event.summary}</td><td>{event.points ?? '—'}</td></tr>)}</tbody></table></div></section>}

        <section className="panel table-panel" id="history"><div className="panel-heading"><div><p className="eyebrow">PERSISTÊNCIA</p><h2>Histórico de rodadas</h2></div></div><div className="table-wrap"><table><thead><tr><th>Rodada</th><th>Modo</th><th>Encerramento</th><th>13</th><th>22</th><th>Resultado</th></tr></thead><tbody>{rounds.length ? rounds.map(round => <tr key={round.id}><td>#{round.roundNumber}</td><td>{round.gameMode === 'race' ? 'Corrida' : 'Batalha'}</td><td>{new Date(round.endedAt).toLocaleString('pt-BR')}</td><td>{round.gameMode === 'race' ? `${Math.round((round.lulaProgress ?? 0)*100)}%` : `${Math.round(round.lulaEnergy ?? 0)} energia`} · {round.lulaPoints} apoio</td><td>{round.gameMode === 'race' ? `${Math.round((round.bolsonaroProgress ?? 0)*100)}%` : `${Math.round(round.bolsonaroEnergy ?? 0)} energia`} · {round.bolsonaroPoints} apoio</td><td>{round.winner === 'tie' ? 'Empate' : round.winner === 'lula' ? '13' : '22'}</td></tr>) : <tr><td colSpan={6}>Nenhuma rodada concluída.</td></tr>}</tbody></table></div></section>
      </div>
    </main>
  );
}
