import { useEffect, useState } from 'react';
import { AUDIO_GROUPS, audioGroupOf, type ArenaConfig, type AudioAsset, type SystemDiagnostics } from '../types';

/**
 * Diagnóstico de áudio: o que o overlay está tocando de verdade, mudo geral,
 * volume por categoria, trilha opcional e teste de cada som.
 * Os números vêm da telemetria que o próprio /overlay envia ao servidor.
 */
export function AudioDiagnosticsPanel({ config, token, onMessage, onConfigChange }: {
  config: ArenaConfig;
  token: string;
  onMessage: (message: string) => void;
  onConfigChange: (patch: Partial<ArenaConfig>) => void;
}) {
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const headers = { 'Content-Type': 'application/json', 'x-admin-token': token };

  useEffect(() => {
    const load = async () => {
      const [diagnosticResponse, assetResponse] = await Promise.all([
        fetch('/api/diagnostics', { headers }), fetch('/api/audio/assets', { headers })
      ]);
      if (diagnosticResponse.ok) setDiagnostics(await diagnosticResponse.json());
      if (assetResponse.ok) setAssets(await assetResponse.json());
    };
    void load().catch(() => undefined);
    const timer = window.setInterval(() => void load().catch(() => undefined), 1_500);
    return () => window.clearInterval(timer);
  }, [token]);

  async function patch(change: Partial<ArenaConfig>, message: string) {
    const response = await fetch('/api/config', { method: 'PATCH', headers, body: JSON.stringify(change) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return onMessage(body.error ?? 'Falha ao salvar o áudio.');
    onConfigChange(change);
    onMessage(message);
  }

  async function audioOperation(path:string) {
    const response = await fetch(path, { method:'POST', headers, body:'{}' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return onMessage(body.error ?? 'Falha na operação de áudio.');
    const enabling = path.endsWith('/enable');
    onConfigChange(enabling ? { audioSafeMode:false, soundEnabled:true } : { audioSafeMode:true, soundEnabled:false });
    onMessage(body.message ?? (enabling ? 'Áudio habilitado.' : 'Todo o áudio foi silenciado.'));
  }

  async function test(asset: AudioAsset) {
    const response = await fetch(`/api/audio/assets/${asset.id}/test`, { method: 'POST', headers });
    const body = await response.json().catch(() => ({}));
    onMessage(response.ok ? `“${asset.name}” enviado ao overlay.` : body.error ?? 'O som não pôde ser testado.');
  }

  async function testOverlap(){
    const response=await fetch('/api/audio/test-overlap',{method:'POST',headers,body:'{}'});const body=await response.json().catch(()=>({}));
    onMessage(response.ok?`Sobreposição enviada: ${body.voice} + ${body.sfx}${body.replacement?` → ${body.replacement}`:''}.`:body.error??'Falha no teste de sobreposição.');
  }

  const audio = diagnostics?.overlay?.audio;
  const overlays = diagnostics?.server.overlayConnections ?? 0;
  const status = config.audioSafeMode ? { text: 'AUDIO_SAFE_MODE: silêncio absoluto', tone: 'off' }
    : diagnostics?.overlay?.outdated ? { text: 'Overlay com código antigo — recarregue', tone: 'warn' }
    : !diagnostics?.overlay ? { text: 'Sem overlay aberto', tone: 'off' }
    : !config.soundEnabled || audio?.muted ? { text: 'Silenciado', tone: 'warn' }
    : audio?.state === 'running' ? { text: 'Áudio ativo', tone: 'ok' }
    : { text: `Navegador: ${audio?.state ?? '—'} (clique no overlay)`, tone: 'warn' };
  const playable = assets.filter(asset => asset.enabled && !asset.pending && !asset.fileMissing);

  return <section className="panel audio-diag-panel" id="audio-diagnostics">
    <div className="panel-heading">
      <div><p className="eyebrow">DIAGNÓSTICO DE ÁUDIO</p><h2>O que está tocando agora</h2></div>
      <div className="audio-enable-actions">
        <button type="button" className="release-button audio-mute" disabled={!config.audioSafeMode && config.soundEnabled}
          onClick={() => void audioOperation('/api/audio/enable')}>🔊 HABILITAR ÁUDIO</button>
        <button type="button" className="emergency-button audio-mute" disabled={config.audioSafeMode}
          onClick={() => void audioOperation('/api/audio/silence')}>🔇 SILENCIAR TUDO</button>
      </div>
    </div>

    {overlays > 1 && <div className="alert-banner"><b>⚠ {overlays} overlays tocando ao mesmo tempo</b><span>Cada janela de /overlay (navegador e OBS) toca o próprio áudio, o que soa como eco ou ruído. Deixe só uma aberta.</span></div>}

    <div className="form-section dynamic-mixing"><h3>MIXAGEM DINÂMICA</h3><div className="form-grid">
      <label className="switch"><input type="checkbox" checked={config.dynamicMixingEnabled} onChange={event=>void patch({dynamicMixingEnabled:event.target.checked},`Sobreposição ${event.target.checked?'ativada':'desativada'}.`)} /><span/><b>Permitir sobreposição por canais</b></label>
      <label>Música: {config.musicVolume}%<input type="range" min="0" max="100" value={config.musicVolume} onChange={event=>void patch({musicVolume:Number(event.target.value)},'Volume MUSIC salvo.')} /></label>
      <label>Bordões: {config.categoryVolumes.bordoes}%<input type="range" min="0" max="100" value={config.categoryVolumes.bordoes} onChange={event=>void patch({categoryVolumes:{...config.categoryVolumes,bordoes:Number(event.target.value)}},'Volume VOICE salvo.')} /></label>
      <label>Efeitos: {config.effectsVolume}%<input type="range" min="0" max="100" value={config.effectsVolume} onChange={event=>void patch({effectsVolume:Number(event.target.value)},'Volume SFX salvo.')} /></label>
      <label>Duração máxima do bordão: {config.maxCatchphraseDurationSec}s<input type="range" min=".5" max="10" step=".5" value={config.maxCatchphraseDurationSec} onChange={event=>void patch({maxCatchphraseDurationSec:Number(event.target.value)},'Limite de duração salvo.')} /></label>
      <label>Intervalo entre bordões: {config.minCatchphraseIntervalSec}s<input type="range" min="1" max="30" value={config.minCatchphraseIntervalSec} onChange={event=>void patch({minCatchphraseIntervalSec:Number(event.target.value)},'Intervalo de VOICE salvo.')} /></label>
      <label>Efeitos simultâneos: {config.maxConcurrentSounds}<input type="range" min="1" max="3" value={config.maxConcurrentSounds} onChange={event=>void patch({maxConcurrentSounds:Number(event.target.value)},'Limite de SFX salvo.')} /></label>
      <label>Prioridade VOICE: {config.channelPriorities.voice}<input type="range" min="0" max="110" value={config.channelPriorities.voice} onChange={event=>void patch({channelPriorities:{...config.channelPriorities,voice:Number(event.target.value)}},'Prioridade VOICE salva.')} /></label>
      <label>Prioridade SFX: {config.channelPriorities.sfx}<input type="range" min="0" max="110" value={config.channelPriorities.sfx} onChange={event=>void patch({channelPriorities:{...config.channelPriorities,sfx:Number(event.target.value)}},'Prioridade SFX salva.')} /></label>
      <label>Prioridade chegada/vitória: {config.channelPriorities.priority}<input type="range" min="0" max="110" value={config.channelPriorities.priority} onChange={event=>void patch({channelPriorities:{...config.channelPriorities,priority:Number(event.target.value)}},'Prioridade PRIORITY salva.')} /></label>
    </div><div className="inline-actions"><button type="button" className="primary-button" onClick={()=>void testOverlap()}>▶ Testar sobreposição</button><button type="button" className="emergency-button audio-mute" onClick={()=>void audioOperation('/api/audio/silence')}>🔇 Silenciar Tudo</button></div>
      <p className="helper-text">MUSIC é atenuado durante VOICE/PRIORITY. Um bordão novo de prioridade igual ou maior substitui o anterior com fade. Turbo e ultrapassagem usam SFX independente. Chegada limpa sons antigos e assume PRIORITY.</p>
    </div>

    <div className="audio-diag-grid">
      <article><span>ESTADO</span><b className={`diag-${status.tone}`}>{status.text}</b><small>{overlays} overlay(s) reportando</small></article>
      <article><span>SONS SIMULTÂNEOS</span><b>{audio ? `${audio.active} / ${audio.maxVoices ?? config.maxConcurrentSounds}` : '—'}</b><small>{audio?.queued ?? 0} na fila</small></article>
      <article><span>REPRODUZIDOS</span><b>{audio?.played ?? 0}</b><small>{audio?.dropped ?? 0} barrados pela trava</small></article>
      <article><span>ERROS</span><b className={audio?.errors ? 'diag-error' : ''}>{audio?.errors ?? 0}</b><small>{audio?.lastError ?? 'nenhum'}</small></article>
      <article><span>TRILHA DE FUNDO</span><b>{audio?.music ? 'tocando' : 'desligada'}</b><small>{config.musicEnabled ? 'toca só durante a corrida' : 'ligue abaixo se quiser'}</small></article>
      <article><span>AUTORIZAÇÃO</span><b>{!audio ? '—' : audio.authorized ? 'preservada' : 'aguardando gesto'}</b><small>{audio?.roundsObserved ?? 0} rodada(s) no mesmo mixer</small></article>
      <article><span>ÚLTIMO SOM</span><b>{audio?.lastPlayedName ?? '—'}</b><small>evento: {audio?.lastEventName ?? '—'}</small></article>
      <article><span>SESSÃO DO OVERLAY</span><b>{audio?.pageLoadId ?? '—'}</b><small>{audio?.navigationType ?? '—'} · rodada {audio?.currentRound ?? '—'}</small></article>
    </div>

    <div className="audio-diag-columns">
      <div>
        <h3>Volumes</h3>
        <label className="switch audio-music-switch"><input type="checkbox" checked={config.musicEnabled}
          onChange={event => void patch({ musicEnabled: event.target.checked }, event.target.checked ? 'Trilha de fundo ligada.' : 'Trilha de fundo desligada.')} /><span /><b>Trilha de fundo (opcional)</b></label>
        <label className="audio-range">Trilha {config.musicVolume}%<input type="range" min="0" max="100" value={config.musicVolume}
          onChange={event => void patch({ musicVolume: Number(event.target.value) }, 'Volume da trilha salvo.')} /></label>
        <label className="audio-range">Efeitos (geral) {config.effectsVolume}%<input type="range" min="0" max="100" value={config.effectsVolume}
          onChange={event => void patch({ effectsVolume: Number(event.target.value) }, 'Volume dos efeitos salvo.')} /></label>
        {AUDIO_GROUPS.map(group => <label key={group.id} className="audio-range">{group.label} {config.categoryVolumes[group.id]}%
          <input type="range" min="0" max="100" value={config.categoryVolumes[group.id]}
            onChange={event => void patch({ categoryVolumes: { ...config.categoryVolumes, [group.id]: Number(event.target.value) } }, `Volume de ${group.label.toLowerCase()} salvo.`)} /></label>)}
      </div>
      <div>
        <h3>Testar cada som <small>(toca no overlay aberto)</small></h3>
        <div className="audio-diag-list">{playable.map(asset => <div key={asset.id}>
          <span className={`source ${asset.sourceType === 'synth' ? 'system' : 'demo'}`}>{AUDIO_GROUPS.find(group => group.id === audioGroupOf(asset.category))?.label}</span>
          <b>{asset.name}</b>
          <button type="button" className="ghost-button" onClick={() => void test(asset)}>▶</button>
        </div>)}</div>
      </div>
      <div>
        <h3>Últimas reproduções</h3>
        <div className="audio-diag-log">{audio?.recent?.length ? audio.recent.map((entry, index) =>
          <p key={`${entry.at}-${index}`} className={entry.result}>
            <time>{new Date(entry.at).toLocaleTimeString('pt-BR')}</time><b>{entry.result}</b><span>{entry.name}{entry.detail ? ` · ${entry.detail}` : ''}</span>
          </p>) : <p className="empty-log">Nada tocou ainda. Abra /overlay e dispare um som.</p>}</div>
      </div>
    </div>
  </section>;
}
