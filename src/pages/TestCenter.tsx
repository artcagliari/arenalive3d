import { type FormEvent, type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { ArenaScene } from '../components/ArenaScene';
import { RaceStage } from '../race/RaceStage';
import { StatusBadge } from '../components/StatusBadge';
import { useArena, useCountdown } from '../hooks/useArena';
import { RACE_ITEMS, raceProgressPercent, type AudioAsset, type AudioTrigger, type Candidate, type PublicEvent, type RaceItemId, type SystemDiagnostics } from '../types';

const NAMES: Record<Candidate, string> = { lula: 'Lula', bolsonaro: 'Bolsonaro' };
const SIDES: Candidate[] = ['lula', 'bolsonaro'];

interface LogLine { id: number; at: string; label: string; detail: string; tone: 'ok' | 'warn' | 'fail' }
interface Metrics { sent: number; accepted: number; rejected: number; failed: number; latencyTotal: number; latencyMax: number }
const EMPTY_METRICS: Metrics = { sent: 0, accepted: 0, rejected: 0, failed: 0, latencyTotal: 0, latencyMax: 0 };

export function TestCenter() {
  const { state, connected, audioCue } = useArena();
  const seconds = useCountdown(state?.phaseEndsAt, state?.serverNow);
  const [token, setToken] = useState(() => sessionStorage.getItem('arena_token') ?? '');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  const [log, setLog] = useState<LogLine[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [fps, setFps] = useState(0);
  const [preview, setPreview] = useState(true);
  const [running, setRunning] = useState<{ label: string; done: number; total: number } | null>(null);
  const [strength, setStrength] = useState(1);
  const [gift, setGift] = useState({ name: 'Rosa', id: '', quantity: 1 });
  const [demo, setDemo] = useState(false);

  const sequence = useRef(0);
  const timers = useRef<number[]>([]);
  const metricsRef = useRef<Metrics>(EMPTY_METRICS);

  const broadcasting = state?.connector.status === 'connected';
  const live = state?.phase === 'live';

  const note = useCallback((label: string, detail: string, tone: LogLine['tone'] = 'ok') => {
    setLog(current => [{ id: ++sequence.current, at: new Date().toLocaleTimeString('pt-BR'), label, detail, tone }, ...current].slice(0, 60));
  }, []);

  const bump = useCallback((patch: Partial<Metrics>) => {
    const next = { ...metricsRef.current };
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'latencyMax') next.latencyMax = Math.max(next.latencyMax, value as number);
      else next[key as keyof Metrics] += value as number;
    }
    metricsRef.current = next;
    setMetrics(next);
  }, []);

  /** Toda chamada passa pelo motor real do jogo e é medida. */
  const call = useCallback(async (path: string, body: object, label: string): Promise<any> => {
    const started = performance.now();
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
        body: JSON.stringify(body)
      });
      const latency = performance.now() - started;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        bump({ sent: 1, rejected: 1, latencyTotal: latency, latencyMax: latency });
        note(label, payload.error ?? `HTTP ${response.status}`, 'warn');
        return null;
      }
      const refused = Array.isArray(payload.results) ? payload.results.filter((item: any) => !item.accepted) : [];
      bump({
        sent: 1,
        accepted: Array.isArray(payload.results) ? payload.results.length - refused.length : 1,
        rejected: refused.length,
        latencyTotal: latency,
        latencyMax: latency
      });
      if (refused.length) note(label, `${refused.length} recusado(s): ${refused[0].reason ?? 'motivo não informado'}`, 'warn');
      else note(label, `ok em ${latency.toFixed(0)} ms`);
      return payload;
    } catch (error) {
      const latency = performance.now() - started;
      bump({ sent: 1, failed: 1, latencyTotal: latency, latencyMax: latency });
      note(label, error instanceof Error ? error.message : 'falha de rede', 'fail');
      return null;
    }
  }, [token, bump, note]);

  /** Cancela apenas as sequências em andamento, sem mexer no modo demonstração. */
  const cancelRuns = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    setRunning(null);
  }, []);

  /** Sequência com controle de taxa: nunca dispara tudo de uma vez. */
  const schedule = useCallback((label: string, total: number, intervalMs: number, step: (index: number) => void, onDone?: () => void) => {
    cancelRuns();
    setRunning({ label, done: 0, total });
    let index = 0;
    const tick = () => {
      step(index);
      index += 1;
      setRunning({ label, done: index, total });
      if (index >= total) { setRunning(null); note(label, `sequência concluída (${total} passos)`); onDone?.(); return; }
      timers.current.push(window.setTimeout(tick, intervalMs));
    };
    timers.current.push(window.setTimeout(tick, 0));
  }, [cancelRuns, note]);

  /** Parada imediata de tudo, inclusive da demonstração. */
  const stopAll = useCallback(() => { cancelRuns(); setDemo(false); }, [cancelRuns]);

  useEffect(() => () => { for (const timer of timers.current) window.clearTimeout(timer); }, []);

  useEffect(() => {
    let frame = 0, frames = 0, last = performance.now();
    const measure = (now: number) => {
      frames += 1;
      if (now - last >= 1000) { setFps(Math.round(frames * 1000 / (now - last))); frames = 0; last = now; }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const load = async () => {
      const headers = { 'x-admin-token': token };
      const [diagnosticData, eventData, assetData] = await Promise.all([
        fetch('/api/diagnostics', { headers }).then(response => response.json()).catch(() => null),
        fetch('/api/events?limit=30', { headers }).then(response => response.json()).catch(() => []),
        fetch('/api/audio/assets', { headers }).then(response => response.json()).catch(() => [])
      ]);
      if (diagnosticData) setDiagnostics(diagnosticData);
      if (Array.isArray(eventData)) setEvents(eventData);
      if (Array.isArray(assetData)) setAssets(assetData);
    };
    void load();
    const timer = window.setInterval(() => void load(), 1_000);
    return () => window.clearInterval(timer);
  }, [authenticated, token]);

  async function login(event: FormEvent) {
    event.preventDefault(); setAuthError('');
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (!response.ok) throw new Error('Token recusado pelo servidor. Sem um arquivo .env, vale o token padrão local que o servidor mostra no início de logs/server.log.');
      sessionStorage.setItem('arena_token', token);
      setAuthenticated(true);
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Acesso negado.'); }
  }

  // ---- disparos individuais ----------------------------------------------
  const comment = (candidate: Candidate, text?: string) =>
    void call('/api/simulate', { type: 'comment', candidate, comment: text }, `Comentário ${text ?? 'padrão'} · ${NAMES[candidate]}`);
  const gifts = (candidate: Candidate, quantity = gift.quantity, name = gift.name) =>
    void call('/api/simulate', { type: 'gift', candidate, repeatCount: quantity, giftId: gift.id || undefined, giftName: name }, `Presente ${name} ×${quantity} · ${NAMES[candidate]}`);
  const likes = (amount: number) => void call('/api/simulate', { type: 'like', likes: amount }, `${amount} curtida(s)`);
  const power = (candidate: Candidate, item: RaceItemId) =>
    void call('/api/race/test', { candidate, item, strength }, `${item.toUpperCase()} ×${strength.toFixed(1)} · ${NAMES[candidate]}`);
  const overtake = (candidate: Candidate) => void call('/api/race/overtake', { candidate }, `Ultrapassagem · ${NAMES[candidate]}`);
  const finishRace = (candidate: Candidate) => void call('/api/race/finish', { candidate }, `Chegada · ${NAMES[candidate]}`);
  const sound = (trigger: AudioTrigger, candidate: Candidate | null = null) =>
    void call('/api/audio/trigger', { trigger, candidate }, `Som ${trigger}`);
  const control = (action: string, label: string) => void call(`/api/control/${action}`, {}, label);

  /** Altera a configuração de áudio no servidor; o overlay obedece na hora. */
  async function audioConfig(patch: object, label: string) {
    const started = performance.now();
    try {
      const response = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(patch) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { note(label, body.error ?? `HTTP ${response.status}`, 'warn'); return; }
      note(label, `aplicado em ${(performance.now() - started).toFixed(0)} ms`);
    } catch (error) { note(label, error instanceof Error ? error.message : 'falha de rede', 'fail'); }
  }
  const testAsset = (asset: AudioAsset) => void call(`/api/audio/assets/${asset.id}/test`, {}, `Teste de áudio · ${asset.name}`);
  const enableAudio = async () => { await call('/api/audio/enable', {}, 'HABILITAR ÁUDIO · efeito curto'); };
  const silenceAudio = async () => { await call('/api/audio/silence', {}, 'SILENCIAR TUDO'); };

  /**
   * Toca um bordão realmente cadastrado para o personagem. Se a vaga estiver
   * vazia, avisa em vez de fingir que tocou algo.
   */
  function playCatchphrase(candidate: Candidate) {
    const label = `Bordão de ${NAMES[candidate]}`;
    const ready = assets.filter(asset =>
      asset.category === `${candidate}_catchphrase` && !asset.pending && !asset.fileMissing && asset.enabled);
    if (!ready.length) {
      note(label, 'Áudio não cadastrado — envie o arquivo em Painel › Bordões', 'warn');
      return;
    }
    const asset = ready[Math.floor(Math.random() * ready.length)];
    void call(`/api/audio/assets/${asset.id}/test`, {}, `${label} · ${asset.name}`);
  }

  function burst(candidate: Candidate, total: number, intervalMs: number, text?: string) {
    schedule(`${total} comentários · ${NAMES[candidate]}`, total, intervalMs, () => comment(candidate, text));
  }

  function stress(label: string, total: number, windowSec: number) {
    if (broadcasting) { note(label, 'bloqueado: conector do TikTok ativo', 'warn'); return; }
    metricsRef.current = EMPTY_METRICS; setMetrics(EMPTY_METRICS);
    const interval = Math.max(20, Math.round(windowSec * 1000 / total));
    schedule(label, total, interval, index => {
      const candidate: Candidate = index % 2 === 0 ? 'lula' : 'bolsonaro';
      if (index % 7 === 0) gifts(candidate, 1, 'Carga');
      else if (index % 5 === 0) likes(25);
      else comment(candidate);
    });
  }

  function startDemo() {
    if (demo) { stopAll(); note('Demonstração', 'encerrada pelo operador'); return; }
    setDemo(true);
    const script: Array<() => void> = [
      () => comment('lula'), () => comment('bolsonaro'), () => likes(50),
      () => gifts('lula', 1, 'Demo'), () => power('bolsonaro', 'arrancada'),
      () => comment('bolsonaro'), () => power('lula', 'impulso'), () => sound('overtake'),
      () => overtake('bolsonaro'), () => likes(120), () => power('lula', 'escudo'),
      () => power('bolsonaro', 'tropeco'), () => gifts('bolsonaro', 2, 'Demo'), () => comment('lula'),
      () => overtake('lula'), () => power('lula', 'turbo'), () => sound('final_sprint')
    ];
    schedule('Demonstração automática', script.length * 3, 2_200, index => script[index % script.length](), () => setDemo(false));
  }

  function resetTests() {
    stopAll();
    metricsRef.current = EMPTY_METRICS; setMetrics(EMPTY_METRICS);
    setLog([]);
    note('Central de testes', 'contadores e histórico locais zerados');
  }

  if (!authenticated) return (
    <main className="auth-page">
      <div className="auth-orbit" />
      <form className="auth-card" onSubmit={login}>
        <div className="admin-logo"><span>LA</span><div><b>LIVE ARENA</b><small>CENTRAL DE TESTES</small></div></div>
        <p className="eyebrow">ACESSO RESTRITO</p>
        <h1>Central de testes</h1>
        <p>Use o token definido em <code>ADMIN_TOKEN</code> (arquivo <code>.env</code>). Se o projeto ainda não tem <code>.env</code>, o servidor usa o token padrão local e o informa na primeira linha de <code>logs/server.log</code>. Os eventos criados aqui ficam marcados como simulados.</p>
        <label>Token de acesso<input type="password" value={token} onChange={event => setToken(event.target.value)} autoFocus autoComplete="current-password" /></label>
        {authError && <div className="form-error">{authError}</div>}
        <button className="primary-button">Entrar <span>→</span></button>
        <a href="/admin">Voltar ao painel</a>
      </form>
    </main>
  );

  if (!state) return <main className="loading-screen"><div className="loader" /><p>Conectando à arena…</p></main>;

  const average = metrics.sent ? metrics.latencyTotal / metrics.sent : 0;
  const Side = ({ children }: { children: (candidate: Candidate) => ReactElement }) =>
    <div className="test-sides">{SIDES.map(candidate => <div key={candidate} className={`test-side ${candidate}`}><b>{NAMES[candidate]}</b>{children(candidate)}</div>)}</div>;

  return (
    <main className="test-app">
      <header className="test-topbar">
        <div><p className="eyebrow">AMBIENTE DE SIMULAÇÃO</p><h1>Central de testes</h1></div>
        <div className="test-top-actions">
          <a className="ghost-button" href="/overlay" target="_blank" rel="noreferrer">Abrir overlay ↗</a>
          <a className="ghost-button" href="/admin">Painel</a>
          <StatusBadge state={state} socketConnected={connected} />
          <button className="emergency-button test-stop" onClick={stopAll}>■ PARAR TESTES</button>
        </div>
      </header>

      {broadcasting && <div className="alert-banner"><b>⚠ Transmissão real ativa</b><span>O conector do TikTok está conectado. Rajadas e testes de carga estão bloqueados para não contaminar a LIVE.</span></div>}
      {!live && <div className="alert-banner test-hint">
        <b>Rodada parada</b>
        <span>O motor recusa comentários, presentes, curtidas e poderes fora da corrida. Comece por aqui:</span>
        <button className="primary-button" onClick={() => control('start', 'Iniciar corrida')}>▶ Iniciar a corrida agora</button>
      </div>}

      <section className="test-quickbar">
        <b>TESTE RÁPIDO</b>
        <div>
          <button onClick={() => control('start', 'Iniciar corrida')}>▶ Iniciar corrida</button>
          <button onClick={() => control('pause', 'Pausar corrida')}>Ⅱ Pausar</button>
          <button onClick={() => control('restart', 'Reiniciar corrida')}>↻ Reiniciar corrida</button>
          <button onClick={() => control('finish', 'Encerrar rodada')}>■ Encerrar rodada</button>
          <button onClick={() => control('stop-cycle', 'Encerrar ciclo automático')}>■ Encerrar ciclo</button>
        </div>
        <div>
          <button className="lula" onClick={() => comment('lula', '13')}>Comentário 13 · Lula</button>
          <button className="bolsonaro" onClick={() => comment('bolsonaro', '22')}>Comentário 22 · Bolsonaro</button>
          <button className="lula" onClick={() => power('lula', 'impulso')}>» Impulso Lula</button>
          <button className="bolsonaro" onClick={() => power('bolsonaro', 'impulso')}>» Impulso Bolsonaro</button>
          <button className="lula" onClick={() => power('lula', 'turbo')}>⚡ Turbo Lula</button>
          <button className="bolsonaro" onClick={() => power('bolsonaro', 'turbo')}>⚡ Turbo Bolsonaro</button>
          <button className="lula" onClick={() => power('lula', 'tropeco')}>✖ Tropeço Lula</button>
          <button className="bolsonaro" onClick={() => power('bolsonaro', 'tropeco')}>✖ Tropeço Bolsonaro</button>
          <button onClick={() => { gifts('lula', 5, 'Presente simulado'); gifts('bolsonaro', 5, 'Presente simulado'); }}>🎁 Presentes simulados</button>
          <button onClick={() => playCatchphrase('lula')}>♪ Bordão de Lula</button>
          <button onClick={() => playCatchphrase('bolsonaro')}>♪ Bordão de Bolsonaro</button>
          <button className={demo ? 'danger-lite' : ''} onClick={startDemo}>{demo ? '■ Parar sequência' : '▶ Simular sequência de eventos'}</button>
        </div>
      </section>

      <section className="test-strip">
        <article><span>WEBSOCKET</span><b className={connected ? 'diag-ok' : 'diag-error'}>{connected ? 'conectado' : 'reconectando'}</b></article>
        <article><span>RODADA</span><b>{state.automationStage}</b><small>#{Math.max(1, state.roundNumber)} · {seconds}s</small></article>
        <article><span>DURAÇÃO DO MOTOR</span><b>{Math.round(state.game.raceElapsedSec??0)} / {state.game.raceDurationSec??state.config.raceDurationSec}s</b><small>cronômetro e velocidade sincronizados</small></article>
        <article><span>FPS DESTA PÁGINA</span><b>{fps}</b><small>overlay: {diagnostics?.overlay ? diagnostics.overlay.fps.toFixed(0) : '—'}</small></article>
        <article><span>EVENTOS ENVIADOS</span><b>{metrics.sent}</b><small>{metrics.accepted} aceitos · {metrics.rejected} recusados · {metrics.failed} falhas</small></article>
        <article><span>LATÊNCIA MÉDIA</span><b>{average.toFixed(0)} ms</b><small>máx. {metrics.latencyMax.toFixed(0)} ms</small></article>
        <article><span>MEMÓRIA</span><b>{diagnostics ? `${diagnostics.server.rssMb} MB` : '—'}</b><small>motor {diagnostics?.engine.lastGameTickMs ?? 0} ms</small></article>
        <article><span>SIMULADOS × REAIS</span><b>{diagnostics?.engine.eventsBySource?.demo ?? 0} × {diagnostics?.engine.eventsBySource?.tiktok ?? 0}</b><small>desde o início do servidor</small></article>
        <article><button className="ghost-button" onClick={resetTests}>↺ Reiniciar testes</button></article>
      </section>

      {running && <div className="test-running"><span>{running.label}</span><i style={{ width: `${running.done / running.total * 100}%` }} /><b>{running.done}/{running.total}</b></div>}

      <div className="test-grid">
        <section className="panel test-preview-panel">
          <div className="panel-heading"><div><p className="eyebrow">ESPELHO DA ARENA</p><h2>Corrida em tempo real</h2></div><label className="switch"><input type="checkbox" checked={preview} onChange={event => setPreview(event.target.checked)} /><span /><b>Prévia</b></label></div>
          {preview
            ? <div className="test-stage">{state.game.mode === 'race' ? <RaceStage game={state.game} phase={state.phase} reduced framing="track" /> : <ArenaScene game={state.game} reduced cameraMode={state.config.cameraMode} animationIntensity={state.config.animationIntensity} phase={state.phase} audioCue={audioCue} characterAssets={{ lula: state.config.lulaCharacterAsset, bolsonaro: state.config.bolsonaroCharacterAsset }} assetVersion={state.config.characterAssetVersion} runnerStyle={state.config.runnerStyle} />}</div>
            : <p className="helper-text">Prévia desligada para liberar GPU. Deixe o overlay aberto em outra janela.</p>}
          <div className="test-readouts">{SIDES.map(candidate => {
            const runner = state.game[candidate];
            return <article key={candidate} className={candidate}>
              <header><b>{NAMES[candidate]}</b><span>{runner.position}º · {runner.action}</span></header>
              <div className="test-readout-grid">
                <div><span>DISTÂNCIA</span><b>{runner.raceProgress>=1?state.game.raceDistanceM:Math.min(state.game.raceDistanceM-1,Math.floor(runner.raceProgress*state.game.raceDistanceM))} m</b></div>
                <div><span>PROGRESSO</span><b>{raceProgressPercent(runner.raceProgress)}%</b></div>
                <div><span>VELOCIDADE</span><b>{(runner.speed * state.game.raceDistanceM).toFixed(1)} m/s</b></div>
                <div><span>ENERGIA</span><b>{Math.round(runner.energy)}</b></div>
                <div><span>IMPULSO</span><b>{Math.round(runner.boost)}</b></div>
                <div><span>ESCUDO</span><b>{runner.shield > 0 ? `${runner.shield.toFixed(1)}s` : '—'}</b></div>
              </div>
              <div className="test-items">{RACE_ITEMS.map(item => <span key={item.id} className={runner.items?.[item.id] ? 'on' : ''}>{item.label} <b>{runner.items?.[item.id] ?? 0}</b></span>)}</div>
              <div className="test-points">{state[candidate].points} pontos · {state[candidate].interactions} interações</div>
            </article>;
          })}</div>
        </section>

        <section className="panel test-log-panel">
          <div className="panel-heading"><div><p className="eyebrow">HISTÓRICO</p><h2>Últimas interações</h2></div><span className="demo-chip">SIMULADO</span></div>
          <div className="test-log">{log.length ? log.map(line => <p key={line.id} className={line.tone}><time>{line.at}</time><b>{line.label}</b><span>{line.detail}</span></p>) : <p className="empty-log">Nenhum teste disparado ainda.</p>}</div>
          <div className="test-events"><b>EVENTOS REGISTRADOS NO SERVIDOR</b>{events.slice(0, 8).map((event, index) => <p key={`${event.at}-${index}`}><span className={`source ${event.source}`}>{event.source}</span>{event.summary}</p>)}</div>
        </section>
      </div>

      <AudioDiagnostics state={state} diagnostics={diagnostics} assets={assets} onConfig={audioConfig} onTest={testAsset} onEnable={enableAudio} onSilence={silenceAudio} />

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 1</p><h2>Comentários</h2></div><span className="helper-text">Seguem a pontuação configurada no painel</span></div>
        <Side>{candidate => <>
          <button onClick={() => comment(candidate, candidate === 'lula' ? '13' : '22')}>Comentar <b>{candidate === 'lula' ? '13' : '22'}</b></button>
          <button onClick={() => comment(candidate, candidate === 'lula' ? 'LULA' : 'BOLSONARO')}>Comentar <b>{candidate === 'lula' ? 'LULA' : 'BOLSONARO'}</b></button>
          <button disabled={broadcasting} onClick={() => burst(candidate, 10, 250)}>10 comentários</button>
          <button disabled={broadcasting} onClick={() => burst(candidate, 100, 150)}>100 em sequência</button>
        </>}</Side>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 2</p><h2>Presentes</h2></div></div>
        <div className="test-gift-form">
          <label>Nome do presente<input value={gift.name} onChange={event => setGift({ ...gift, name: event.target.value })} /></label>
          <label>ID do presente (opcional)<input value={gift.id} placeholder="usa o ID configurado" onChange={event => setGift({ ...gift, id: event.target.value })} /></label>
          <label>Quantidade: {gift.quantity}<input type="range" min="1" max="50" value={gift.quantity} onChange={event => setGift({ ...gift, quantity: Number(event.target.value) })} /></label>
        </div>
        <Side>{candidate => <>
          <button onClick={() => gifts(candidate, 1, gift.name)}>Enviar <b>{gift.name}</b></button>
          <button onClick={() => gifts(candidate, 5, 'Presente comum')}>Comum ×5</button>
          <button onClick={() => gifts(candidate, 15, 'Presente especial')}>Especial ×15</button>
          <button onClick={() => gifts(candidate, 50, 'Alto valor')}>Alto valor ×50</button>
          <button disabled={broadcasting} onClick={() => schedule(`Sequência de presentes · ${NAMES[candidate]}`, 8, 700, () => gifts(candidate, 1, 'Sequência'))}>Sequência</button>
        </>}</Side>
        <div className="test-row">
          <button disabled={broadcasting} onClick={() => schedule('Combo de presentes', 12, 300, index => gifts(index % 2 ? 'bolsonaro' : 'lula', 3, 'Combo'))}>Combo alternado</button>
          <button onClick={() => { gifts('lula', 10, 'Simultâneo'); gifts('bolsonaro', 10, 'Simultâneo'); }}>Presentes simultâneos dos dois lados</button>
        </div>
      </section>

      <section className="panel test-block" id="presentes">
        <div className="panel-heading"><div><p className="eyebrow">PRESENTES CADASTRADOS</p><h2>Presentes da corrida</h2></div><span className="helper-text">Evento SIMULADO pelo mesmo motor dos presentes reais</span></div>
        <div className="test-sides">{SIDES.map(candidate => <div key={candidate} className={`test-side ${candidate}`}><b>{NAMES[candidate]}</b>
          {(state.gifts ?? []).filter(gift => gift.side === candidate).map(gift => <button key={gift.id} className="test-gift" onClick={() => void call('/api/simulate', { type: 'gift', candidate, registryGiftId: gift.id, repeatCount: 1 }, `Presente ${gift.name} → ${gift.label}`)}>
            {gift.imageUrl ? <img src={gift.imageUrl} alt="" /> : <i>{gift.effect === 'tropeco' ? '✖' : gift.effect === 'escudo' ? '◈' : '»'}</i>}
            <span>{gift.name}</span><b>{gift.label}</b>{gift.count > 0 && <em>{gift.count}</em>}
          </button>)}
          {!(state.gifts ?? []).some(gift => gift.side === candidate) && <span className="helper-text">Nenhum presente ativo nesta coluna.</span>}
        </div>)}</div>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 3</p><h2>Poderes e itens</h2></div><label className="test-strength">Intensidade: {strength.toFixed(1)}×<input type="range" min="0.2" max="3" step="0.1" value={strength} onChange={event => setStrength(Number(event.target.value))} /></label></div>
        <Side>{candidate => <>
          {RACE_ITEMS.map(item => <button key={item.id} title={item.hint} onClick={() => power(candidate, item.id)}><i>{item.icon}</i> {item.label}</button>)}
          <button onClick={() => overtake(candidate)}>↷ Ultrapassagem</button>
          <button onClick={() => finishRace(candidate)}>⚑ Simular chegada</button>
        </>}</Side>
        <p className="helper-text">A intensidade multiplica a força do item; o tropeço continua sendo anulado por um escudo ativo, como na corrida real.</p>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 4</p><h2>Curtidas e meta coletiva</h2></div><span className="helper-text">{state.likes.toLocaleString('pt-BR')} / {state.config.likesGoal.toLocaleString('pt-BR')}</span></div>
        <div className="test-row">
          {[1, 10, 100, 1_000].map(amount => <button key={amount} onClick={() => likes(amount)}>{amount.toLocaleString('pt-BR')} curtida{amount > 1 ? 's' : ''}</button>)}
          <button disabled={broadcasting} onClick={() => likes(Math.max(1, state.config.likesGoal - state.likes))}>Completar a meta</button>
        </div>
        <div className="likes-track test-likes"><i style={{ width: `${Math.min(100, state.likes / state.config.likesGoal * 100)}%` }} /></div>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 5</p><h2>Áudios e bordões</h2></div><span className="helper-text">Dispara pelo diretor real, com as travas de repetição</span></div>
        <div className="test-row">
          <button disabled={!assets.some(asset=>asset.id==='builtin-boost')} onClick={()=>{const asset=assets.find(item=>item.id==='builtin-boost');if(asset)testAsset(asset)}}>Testar efeito curto</button>
          <button onClick={() => sound('gift_received')}>Áudio associado a presente</button>
          {([['race_start', 'Largada'], ['boost', 'Impulso'], ['stumble', 'Tropeço'], ['overtake', 'Ultrapassagem'], ['final_sprint', 'Reta final'], ['victory', 'Chegada/vitória'], ['combo', 'Torcida']] as Array<[AudioTrigger, string]>)
            .map(([trigger, label]) => <button key={trigger} onClick={() => sound(trigger)}>{label}</button>)}
          <button onClick={() => playCatchphrase('lula')}>Bordão de Lula</button>
          <button onClick={() => playCatchphrase('bolsonaro')}>Bordão de Bolsonaro</button>
          <button onClick={() => sound('comment_received', 'lula')}>Som de comentário · Lula</button>
          <button onClick={() => schedule('Teste de sobreposição', 8, 180, index => sound(['impact', 'boost', 'stumble', 'overtake'][index % 4] as AudioTrigger))}>Testar sobreposição (8 sons)</button>
        </div>
        <div className="test-assets">{assets.map(asset => {
          const unavailable = asset.pending || asset.fileMissing;
          return <div key={asset.id} className={asset.enabled && !unavailable ? '' : 'off'}>
            <b>{asset.name}</b>
            <span>{asset.pending ? 'Áudio não cadastrado' : asset.fileMissing ? 'arquivo ausente' : `${asset.trigger} · vol ${asset.volume}%`}</span>
            <button className="ghost-button" disabled={unavailable} onClick={() => void call(`/api/audio/assets/${asset.id}/test`, {}, `Áudio ${asset.name}`)}>▶ no overlay</button>
          </div>;
        })}</div>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 6</p><h2>Rodadas automáticas</h2></div><label className="switch"><input type="checkbox" checked={state.config.autoMode} onChange={event => void audioConfig({ autoMode: event.target.checked }, `Modo automático ${event.target.checked ? 'ligado' : 'desligado'}`)} /><span /><b>Modo automático</b></label></div>
        <div className="test-row">
          <button onClick={() => control('start', 'Iniciar corrida')}>▶ Iniciar</button>
          <button onClick={() => control('pause', 'Pausar')}>Ⅱ Pausar</button>
          <button onClick={() => control('resume', 'Continuar')}>▶ Continuar</button>
          <button onClick={() => control('restart', 'Reiniciar corrida')}>↻ Reiniciar corrida</button>
          <button onClick={() => control('finish', 'Encerrar rodada')}>■ Encerrar rodada</button>
          <button onClick={() => control('stop-cycle', 'Encerrar ciclo')}>■ Encerrar ciclo</button>
          <button onClick={() => control('reset', 'Zerar placar')}>↺ Zerar placar</button>
        </div>
        <div className="test-row">
          <a className="primary-button" href="/admin/bordoes">+ Importar MP3 e associar evento</a>
          <button disabled={broadcasting} onClick={() => schedule('3 rodadas consecutivas', 3, 25_000, () => control('finish', 'Encerrar rodada (sequência)'))}>3 rodadas consecutivas</button>
          <button disabled={broadcasting} onClick={() => schedule('Teste de 15 minutos', 30, 30_000, index => { if (index % 5 === 0) likes(200); else comment(index % 2 ? 'bolsonaro' : 'lula'); })}>Teste de 15 minutos</button>
        </div>
        <p className="helper-text">Com o modo automático ligado, encerrar a rodada já abre a próxima sozinho.</p>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 7</p><h2>Teste de estresse</h2></div><span className="helper-text">{broadcasting ? 'bloqueado durante a transmissão' : 'taxa controlada, sem rajada instantânea'}</span></div>
        <div className="test-row">
          <button disabled={broadcasting} onClick={() => stress('10 eventos em 5 s', 10, 5)}>10 em 5 s</button>
          <button disabled={broadcasting} onClick={() => stress('50 eventos em 10 s', 50, 10)}>50 em 10 s</button>
          <button disabled={broadcasting} onClick={() => stress('100 eventos em 30 s', 100, 30)}>100 em 30 s</button>
          <button disabled={broadcasting} onClick={() => stress('500 eventos em 2 min', 500, 120)}>500 em 2 min</button>
        </div>
        <div className="test-metrics">
          <div><span>PROCESSADOS</span><b>{diagnostics?.engine.eventsAccepted ?? 0}</b></div>
          <div><span>DESCARTADOS</span><b>{diagnostics?.engine.eventsDiscarded ?? 0}</b></div>
          <div><span>LATÊNCIA MÉDIA</span><b>{average.toFixed(0)} ms</b></div>
          <div><span>FPS DO OVERLAY</span><b>{diagnostics?.overlay ? diagnostics.overlay.fps.toFixed(0) : '—'}</b></div>
          <div><span>FALHAS DE REDE</span><b className={metrics.failed ? 'diag-error' : ''}>{metrics.failed}</b></div>
          <div><span>RECUPERAÇÕES DO MOTOR</span><b>{diagnostics?.engine.gameRecoveries ?? 0}</b></div>
          <div><span>TICK MÁXIMO</span><b>{diagnostics?.engine.maxGameTickMs ?? 0} ms</b></div>
          <div><span>MOTIVOS DE DESCARTE</span><b className="test-reasons">{diagnostics && Object.keys(diagnostics.engine.discardReasons).length ? Object.entries(diagnostics.engine.discardReasons).map(([reason, count]) => `${reason}:${count}`).join(' · ') : 'nenhum'}</b></div>
        </div>
      </section>

      <section className="panel test-block">
        <div className="panel-heading"><div><p className="eyebrow">CATEGORIA 8</p><h2>Modo demonstração</h2></div></div>
        <p className="helper-text">Gera comentários, presentes, turbos, ultrapassagens e bordões em sequência, sempre marcados como simulados.</p>
        <div className="test-row">
          <button className={demo ? 'danger-lite' : 'start'} onClick={startDemo}>{demo ? '■ Encerrar demonstração' : '▶ Iniciar demonstração automática'}</button>
        </div>
      </section>

      <footer className="test-footer">Eventos criados aqui são gravados com origem <b>demo</b> e nunca são apresentados como participação real do público.</footer>
    </main>
  );
}

/** Diagnóstico de áudio da Central: o que o overlay está realmente tocando. */
function AudioDiagnostics({ state, diagnostics, assets, onConfig, onTest, onEnable, onSilence }: {
  state: NonNullable<ReturnType<typeof useArena>['state']>;
  diagnostics: SystemDiagnostics | null;
  assets: AudioAsset[];
  onConfig: (patch: object, label: string) => Promise<void>;
  onTest: (asset: AudioAsset) => void;
  onEnable: () => Promise<void>;
  onSilence: () => Promise<void>;
}) {
  const config = state.config;
  const overlay = diagnostics?.overlay;
  const audio = overlay?.audio;
  const safe = config.audioSafeMode;
  const effects = assets.filter(asset => asset.sourceType === 'synth');
  const phrases = assets.filter(asset => ['lula_catchphrase', 'bolsonaro_catchphrase', 'satire_meme'].includes(asset.category));
  const music = assets.find(asset => asset.trigger === 'background_music');
  const unavailable = (asset: AudioAsset) => asset.pending ? 'Áudio não cadastrado' : asset.fileMissing ? 'arquivo ausente' : null;

  return <section className="panel test-block test-audio" id="audio">
    <div className="panel-heading">
      <div><p className="eyebrow">PRIORIDADE</p><h2>DIAGNÓSTICO DE ÁUDIO</h2></div>
      <span className={`safe-chip ${safe ? 'on' : 'off'}`}>AUDIO_SAFE_MODE: {safe ? 'ATIVO · silêncio absoluto' : 'desativado'}</span>
    </div>

    {!overlay && <div className="alert-banner"><b>🔇 Nenhum /overlay aberto</b><span>O som sai somente pela página do overlay. Abra-a, clique uma vez nela para o navegador liberar o som e volte aqui.</span><a className="primary-button" href="/overlay" target="_blank" rel="noreferrer">Abrir overlay ↗</a></div>}
    {overlay?.outdated && <div className="alert-banner"><b>⚠ Um /overlay aberto roda uma versão antiga do código</b><span>Feche e abra de novo essa janela. No OBS: clique na fonte → Propriedades → “Atualizar cache da página atual”.</span></div>}
    {(diagnostics?.server.overlayConnections ?? 0) > 1 && <div className="alert-banner"><b>⚠ {diagnostics?.server.overlayConnections} overlays abertos ao mesmo tempo</b><span>Cada um toca o próprio som. Deixe só um.</span></div>}

    <div className="test-row">
      <button className="start" disabled={!safe && config.soundEnabled} onClick={() => void onEnable()}>🔊 HABILITAR ÁUDIO + TESTE CURTO</button>
      <button className="danger-lite" onClick={() => void onSilence()}>🔇 SILENCIAR TUDO</button>
      <button disabled={safe} onClick={() => void onConfig({ audioSafeMode: true }, 'Modo seguro de áudio')}>🛡 Voltar ao modo seguro</button>
    </div>

    <div className="test-metrics">
      <div><span>OVERLAY</span><b>{overlay ? (overlay.outdated ? 'versão antiga' : 'conectado') : 'nenhum aberto'}</b></div>
      <div><span>ÁUDIO DO OVERLAY</span><b>{!audio ? '—' : audio.safeMode ? 'modo seguro' : audio.enabled ? audio.state : 'silenciado'}</b></div>
      <div><span>FONTES ATIVAS</span><b>{audio?.sources ?? 0}</b></div>
      <div><span>SONS TOCANDO</span><b>{audio ? `${audio.active} / ${audio.maxVoices ?? 3}` : '—'}</b></div>
      <div><span>AUDIOCONTEXT CRIADOS</span><b>{audio?.contextsCreated ?? 0}</b></div>
      <div><span>AUTORIZAÇÃO</span><b>{!audio ? '—' : audio.authorized ? 'preservada' : audio.state === 'running' ? 'ativa' : 'aguardando gesto'}</b></div>
      <div><span>RODADAS NO MESMO MIXER</span><b>{audio?.roundsObserved ?? 0}</b></div>
      <div><span>VOLUME</span><b>efeitos {config.effectsVolume}% · bordões {config.categoryVolumes.bordoes}% · música {config.musicEnabled ? `${config.musicVolume}%` : 'off'}</b></div>
      <div><span>ERROS</span><b className={audio?.errors ? 'diag-error' : ''}>{audio?.errors ?? 0}</b></div>
      <div><span>TOCANDO AGORA</span><b className="test-reasons">{audio?.playing?.length ? audio.playing.join(' · ') : 'nada'}</b></div>
      <div><span>ÚLTIMO EVENTO SONORO</span><b className="test-reasons">{audio?.lastEventName ?? '—'}</b></div>
      <div><span>ÚLTIMO SOM REPRODUZIDO</span><b className="test-reasons">{audio?.lastPlayedName ?? '—'}</b></div>
      <div><span>SESSÃO DO OVERLAY</span><b className="test-reasons">{audio?.pageLoadId ?? '—'}</b><small>{audio?.navigationType ?? '—'} · rodada {audio?.currentRound ?? '—'}</small></div>
    </div>

    <div className="test-audio-controls">
      <label>Intervalo mínimo entre repetições: {config.effectRepeatMs} ms<input type="range" min="100" max="2000" step="50" value={config.effectRepeatMs} onChange={event => void onConfig({ effectRepeatMs: Number(event.target.value) }, 'Intervalo entre repetições')} /></label>
      <label>Efeitos {config.effectsVolume}%<input type="range" min="0" max="100" value={config.effectsVolume} onChange={event => void onConfig({ effectsVolume: Number(event.target.value) }, 'Volume dos efeitos')} /></label>
      <label>Bordões {config.categoryVolumes.bordoes}%<input type="range" min="0" max="100" value={config.categoryVolumes.bordoes} onChange={event => void onConfig({ categoryVolumes: { bordoes: Number(event.target.value) } }, 'Volume dos bordões')} /></label>
      <label>Música {config.musicVolume}%<input type="range" min="0" max="100" value={config.musicVolume} onChange={event => void onConfig({ musicVolume: Number(event.target.value) }, 'Volume da música')} /></label>
    </div>

    <div className="test-audio-grid">
      <div>
        <h3>Efeitos ({effects.length})</h3>
        {effects.map(asset => <p key={asset.id}><span>{asset.name}</span><button disabled={safe} onClick={() => onTest(asset)}>▶</button></p>)}
      </div>
      <div>
        <h3>Bordões e memes</h3>
        {phrases.map(asset => <p key={asset.id} className={unavailable(asset) ? 'off' : ''}><span>{asset.name}{unavailable(asset) && <small> · {unavailable(asset)}</small>}</span><button disabled={safe || Boolean(unavailable(asset))} onClick={() => onTest(asset)}>▶</button></p>)}
        <h3>Música de fundo</h3>
        {music ? <p className={unavailable(music) ? 'off' : ''}><span>{music.name}{unavailable(music) ? <small> · {unavailable(music)}</small> : <small> · toca 12 s no teste</small>}</span><button disabled={safe || Boolean(unavailable(music))} onClick={() => onTest(music)}>▶</button></p> : <p className="off"><span>Áudio não cadastrado</span></p>}
      </div>
      <div>
        <h3>Histórico de reprodução</h3>
        {audio?.recent?.length ? audio.recent.map((entry, index) => <p key={`${entry.at}-${index}`} className={`log-${entry.result}`}><span><time>{new Date(entry.at).toLocaleTimeString('pt-BR')}</time> <b>{entry.result}</b> {entry.name}{entry.detail ? ` · ${entry.detail}` : ''}</span></p>)
          : <p className="off"><span>{safe ? 'Modo seguro: nada é reproduzido.' : 'Nada tocou ainda.'}</span></p>}
      </div>
    </div>
  </section>;
}
