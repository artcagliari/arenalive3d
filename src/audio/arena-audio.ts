import { audioGroupOf, type ArenaConfig, type AudioAsset, type AudioCue, type AudioDiagnostics, type AudioGroup, type AudioLogEntry, type GameState } from '../types';

/**
 * AudioManager — o único ponto do app que produz som.
 *
 * Garantias:
 * - AUDIO_SAFE_MODE (padrão): nenhum AudioContext é criado e nada toca. Se um
 *   contexto já existir, ele é fechado e todas as fontes são paradas.
 * - Fora do modo seguro, o AudioContext só nasce quando um som válido for
 *   tocar de fato: abrir a página não produz áudio.
 * - Nada contínuo é sintetizado. Efeitos procedurais são notas curtas com fim
 *   agendado; música de fundo só existe se houver um arquivo enviado pelo operador.
 * - Toda fonte em reprodução é rastreada: "silenciar" para todas na hora.
 * - MUSIC, VOICE, SFX e PRIORITY possuem barramentos de ganho independentes,
 *   com ganhos conservadores e limitador na saída principal.
 */

const MASTER = 0.5;
const EFFECTS_HEADROOM = 0.4;
const MUSIC_HEADROOM = 0.5;
const MAX_VOICES = 3;
const MAX_QUEUE = 6;
/** Teste manual da música toca só um trecho. */
const MUSIC_TEST_SECONDS = 12;

type Tone = [frequency: number, delay: number, length: number, type: OscillatorType];

interface Bus {
  ctx: AudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  music: GainNode;
  voice: GainNode;
  sfx: GainNode;
  priority: GainNode;
}

interface Voice {
  name: string;
  nodes: AudioScheduledSourceNode[];
  cue?: AudioCue;
  isMusic: boolean;
  channel:AudioChannel;
  output?:GainNode;
  fading?:boolean;
  timer?: number;
}

type AudioChannel='music'|'voice'|'sfx'|'priority';

export class ArenaAudio {
  private bus: Bus | null = null;
  /** Começa seguro: até a configuração dizer o contrário, nada é criado. */
  private safe = true;
  private enabled = false;
  private muted = false;
  private contextsCreated = 0;
  private voices = new Map<number, Voice>();
  private voiceSequence = 0;
  private queue: AudioCue[] = [];
  private maxVoices = 2;
  private dynamicMixing=true;
  private maxVoiceDuration=3;
  private minVoiceIntervalMs=1_000;
  private lastVoiceStartedAt=-Infinity;
  private channelPriorities={music:10,voice:60,sfx:40,priority:100};
  private pending:Record<AudioChannel,number>={music:0,voice:0,sfx:0,priority:0};
  private repeatMs = 400;
  private effectsScale = 0.7;
  private musicScale = 0.35;
  private categoryScale: Record<AudioGroup, number> = { corrida: 0.7, bordoes: 0.9, memes: 0.8, torcida: 0.55, resultado: 0.75 };
  private music: { voice: number; assetId: string } | null = null;
  private musicWanted = false;
  private musicLoading = false;
  private buffers = new Map<string, AudioBuffer>();
  private catalog: AudioAsset[] = [];
  private lastFired = new Map<string, number>();
  private recent: AudioLogEntry[] = [];
  private played = 0;
  private dropped = 0;
  private errors = 0;
  private lastCueAt: string | null = null;
  private lastError: string | null = null;
  private authorized = false;
  private roundsObserved = 0;
  private currentRound: number | null = null;
  private lastEventAt: string | null = null;
  private lastEventName: string | null = null;
  private lastPlayedAt: string | null = null;
  private lastPlayedName: string | null = null;
  private readonly pageLoadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  private readonly pageLoadedAt = new Date().toISOString();
  private readonly navigationType = typeof performance !== 'undefined'
    ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? 'unknown'
    : 'test';

  constructor(private onError: (assetId: string, message: string) => void = () => undefined,
    private createContext?: () => AudioContext) {}

  setCatalog(assets: AudioAsset[]) {
    this.catalog = assets;
    this.syncMusic();
  }

  getDiagnostics(): AudioDiagnostics {
    const nodes = [...this.voices.values()].reduce((sum, voice) => sum + voice.nodes.length, 0);
    return {
      state: this.bus?.ctx.state ?? 'not-started',
      enabled: this.enabled && !this.muted && !this.safe,
      active: this.voices.size,
      queued: this.queue.length,
      loaded: this.buffers.size,
      played: this.played,
      dropped: this.dropped,
      errors: this.errors,
      lastCueAt: this.lastCueAt,
      lastError: this.lastError,
      maxVoices: this.maxVoices,
      muted: this.muted,
      music: Boolean(this.music),
      recent: this.recent.slice(0, 12),
      safeMode: this.safe,
      contextsCreated: this.contextsCreated,
      sources: nodes,
      playing: [...this.voices.values()].map(voice => voice.name).slice(0, 12),
      masterVolume: this.bus && this.enabled && !this.muted ? Math.round(MASTER * this.effectsScale * 100) / 100 : 0,
      authorized:this.authorized, roundsObserved:this.roundsObserved, currentRound:this.currentRound ?? undefined,
      lastEventAt:this.lastEventAt, lastEventName:this.lastEventName,
      lastPlayedAt:this.lastPlayedAt, lastPlayedName:this.lastPlayedName,
      pageLoadId:this.pageLoadId, pageLoadedAt:this.pageLoadedAt, navigationType:this.navigationType
    };
  }

  /**
   * Limpa apenas fontes temporárias da rodada anterior. O barramento, a
   * autorização do navegador, os volumes e os AudioBuffers permanecem vivos.
   */
  observeRound(roundNumber:number) {
    if (this.currentRound === roundNumber) return;
    if (this.currentRound !== null) this.stopTransientSounds();
    this.currentRound = roundNumber;
    this.roundsObserved += 1;
  }

  /** Silêncio imediato: para todas as fontes, não só abaixa o volume. */
  muteAll() {
    this.muted = true;
    this.silence();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.silence();
  }

  isMuted() { return this.muted; }

  configure(game: GameState, config: ArenaConfig, enabled: boolean) {
    // ausente = seguro (servidor antigo ou configuração incompleta)
    this.safe = config.audioSafeMode !== false;
    this.maxVoices = Math.min(MAX_VOICES, Math.max(1, config.maxConcurrentSounds || 2));
    this.repeatMs = Math.max(100, config.effectRepeatMs ?? 400);
    this.dynamicMixing=config.dynamicMixingEnabled!==false;
    this.maxVoiceDuration=Math.min(15,Math.max(.5,config.maxCatchphraseDurationSec??3));
    this.minVoiceIntervalMs=Math.max(0,(config.minCatchphraseIntervalSec??1)*1_000);
    this.channelPriorities={...this.channelPriorities,...(config.channelPriorities??{})};
    this.effectsScale = clamp01(config.effectsVolume / 100);
    this.musicScale = clamp01(config.musicVolume / 100);
    if (config.categoryVolumes) {
      for (const [group, value] of Object.entries(config.categoryVolumes)) this.categoryScale[group as AudioGroup] = clamp01(value / 100);
    }
    this.enabled = enabled && !this.muted && !this.safe;

    // AUDIO_SAFE_MODE continua cortando tudo imediatamente, mas não destrói o
    // contexto autorizado. Só o encerramento real da página chama shutdown().
    if (this.safe) { this.silence(); return; }
    if (!this.enabled) { this.silence(); return; }

    // Não cria AudioContext aqui. Só ajusta o volume se ele já existir.
    if (this.bus) {
      this.ramp(this.bus.master.gain, MASTER, 0.05);
      this.ramp(this.bus.voice.gain, this.effectsScale * .9, 0.05);
      this.ramp(this.bus.sfx.gain, this.effectsScale, 0.05);
      this.ramp(this.bus.priority.gain, this.effectsScale * .9, 0.05);
      this.ramp(this.bus.music.gain, this.musicScale * MUSIC_HEADROOM, 0.2);
      if (this.authorized && this.bus.ctx.state === 'suspended') void this.bus.ctx.resume().catch(() => undefined);
    }
    this.musicWanted = Boolean(config.musicEnabled) && config.musicVolume > 0 && config.audioMode !== 'discreet'
      && game.mode === 'race' && game.active && !game.winner;
    this.syncMusic();
    this.pump();
  }

  enqueue(cue: AudioCue) {
    this.lastEventAt = new Date().toISOString();
    this.lastEventName = cue.name;
    if (this.safe) { this.dropped += 1; this.log(cue, 'barrado', 'modo seguro'); return; }
    if (!this.enabled || this.muted) { this.dropped += 1; this.log(cue, 'barrado', this.muted ? 'mudo' : 'som desligado'); return; }
    if (this.queue.some(item => item.id === cue.id)) { this.dropped += 1; return; }
    const key = cue.assetId || cue.synthPreset || cue.trigger;
    const now = performance.now();
    if (now - (this.lastFired.get(key) ?? -Infinity) < this.repeatMs) { this.dropped += 1; this.log(cue, 'barrado', 'repetição'); return; }
    if (cue.trigger !== 'background_music' && this.categoryScale[audioGroupOf(cue.category)] <= 0) {
      this.dropped += 1; this.log(cue, 'barrado', 'categoria em 0%'); return;
    }
    const channel=this.channelOf(cue);
    if(channel==='priority'&&cue.trigger==='round_end')this.interruptForFinish();
    if(channel==='voice'){
      const active=[...this.voices.entries()].find(([,voice])=>voice.channel==='voice'&&!voice.fading);
      const queued=this.queue.find(item=>this.channelOf(item)==='voice');
      const previous=active?.[1].cue??queued;
      if(previous&&this.effectivePriority(cue)<this.effectivePriority(previous)){
        this.dropped+=1;this.log(cue,'barrado','bordão de menor prioridade');return;
      }
      if(!previous&&now-this.lastVoiceStartedAt<this.minVoiceIntervalMs){
        this.dropped+=1;this.log(cue,'barrado','intervalo entre bordões');return;
      }
      this.dropQueuedChannel('voice','substituído por bordão mais recente');
      if(active)this.stopVoice(active[0],100);
    }
    if(channel==='sfx'&&this.channelLoad('sfx')>=this.maxVoices){
      this.dropped+=1;this.log(cue,'barrado','limite de efeitos simultâneos');return;
    }
    if(channel==='priority'&&this.channelLoad('priority')>=2){
      const weakest=[...this.voices.entries()].filter(([,voice])=>voice.channel==='priority')
        .sort((a,b)=>this.effectivePriority(a[1].cue!)-this.effectivePriority(b[1].cue!))[0];
      if(!weakest||this.effectivePriority(cue)<this.effectivePriority(weakest[1].cue!)){
        this.dropped+=1;this.log(cue,'barrado','canal prioritário ocupado');return;
      }
      this.stopVoice(weakest[0],60);
    }
    this.lastFired.set(key, now);
    this.queue.push(cue);
    this.queue.sort((a,b)=>this.effectivePriority(b)-this.effectivePriority(a));
    if (this.queue.length > Math.min(MAX_QUEUE,3)) {
      for (const removed of this.queue.slice(3)) this.log(removed, 'barrado', 'evento perdeu relevância');
      this.dropped += this.queue.length - 3;
      this.queue.length = 3;
    }
    this.pump();
  }

  /**
   * Chamado dentro de um clique ou tecla do usuário. Safari e Chrome só deixam
   * o AudioContext tocar se ele for criado/retomado dentro de um gesto.
   * Em modo seguro não faz nada.
   */
  unlock() {
    if (this.safe || !this.enabled || this.muted) return;
    const bus = this.ensureBus();
    if (bus.ctx.state !== 'running') void bus.ctx.resume();
  }

  /**
   * Deve ser chamado por um clique no próprio overlay. Além de retomar o
   * AudioContext, confirma a saída com um efeito procedural curto e baixo.
   */
  async authorizeWithTest(): Promise<{ ok:boolean; state:AudioContextState | 'not-started'; message:string }> {
    if (this.safe || !this.enabled) return { ok:false, state:'not-started', message:'O servidor ainda está em AUDIO_SAFE_MODE.' };
    this.muted = false;
    const bus = this.ensureBus();
    try { await bus.ctx.resume(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.reportError('builtin-audio-confirmation', message);
      return { ok:false, state:bus.ctx.state, message:`O navegador recusou o AudioContext: ${message}` };
    }
    if (bus.ctx.state !== 'running') return { ok:false, state:bus.ctx.state, message:'O navegador ainda bloqueia o áudio. Use Interagir na fonte Navegador do OBS.' };
    this.authorized = true;
    this.enqueue({ id:`audio-confirmation-${Date.now()}`, assetId:'builtin-audio-confirmation', name:'Confirmação de áudio',
      category:'alert', trigger:'round_start', candidate:null, sourceType:'synth', url:null, synthPreset:'whistle',
      volume:28, isSatire:false, animation:'none', priority:110, queuedAt:new Date().toISOString() });
    return { ok:true, state:bus.ctx.state, message:'AudioContext ativo; efeito curto de confirmação enviado.' };
  }

  /** O navegador está segurando o som até alguém clicar na página. */
  needsGesture() {
    return this.enabled && !this.safe && !this.muted && (this.bus === null || this.bus.ctx.state !== 'running');
  }

  /** Compatibilidade: prévias locais foram removidas; o som sai só no overlay. */
  preview(_asset: AudioAsset) { /* intencionalmente vazio */ }

  /** Fecha o AudioContext e solta todos os recursos. */
  shutdown() {
    this.silence();
    this.authorized = false;
    if (this.bus) {
      const { ctx } = this.bus;
      this.bus = null;
      void ctx.close().catch(() => undefined);
    }
    if (typeof document !== 'undefined') {
      for (const element of document.querySelectorAll('audio, video')) (element as HTMLMediaElement).pause();
    }
  }

  dispose() { this.shutdown(); }

  // ---- saída -------------------------------------------------------------

  private ensureBus(): Bus {
    if (this.bus) return this.bus;
    const AudioContextClass = typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      : undefined;
    const ctx = this.createContext ? this.createContext() : new AudioContextClass!();
    this.contextsCreated += 1;
    ctx.addEventListener?.('statechange', () => { if (ctx.state === 'closed') this.authorized = false; });
    const master = ctx.createGain(), music = ctx.createGain(), voice = ctx.createGain(), sfx = ctx.createGain(), priority = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    master.gain.value = MASTER;
    music.gain.value = this.musicScale * MUSIC_HEADROOM;
    voice.gain.value = this.effectsScale * .9;
    sfx.gain.value = this.effectsScale;
    priority.gain.value = this.effectsScale * .9;
    music.connect(master); voice.connect(master); sfx.connect(master); priority.connect(master);
    master.connect(limiter).connect(ctx.destination);
    this.bus = { ctx, master, limiter, music, voice, sfx, priority };
    return this.bus;
  }

  /** Para tudo o que estiver tocando e zera a saída. */
  private silence() {
    this.dropped += this.queue.length;
    this.queue = [];
    for (const id of [...this.voices.keys()]) this.stopVoice(id);
    this.music = null;
    if (this.bus) {
      const { master, ctx } = this.bus;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime);
    }
  }

  private stopTransientSounds() {
    this.dropped += this.queue.length;
    this.queue = [];
    for (const [id, voice] of [...this.voices]) if (!voice.isMusic) this.stopVoice(id);
  }

  private ramp(param: AudioParam, value: number, seconds: number) {
    const ctx = this.bus!.ctx;
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, Math.max(0.01, seconds));
  }

  private startVoice(name:string,nodes:AudioScheduledSourceNode[],lengthSeconds:number|null,cue?:AudioCue,isMusic=false,channel:AudioChannel=isMusic?'music':'sfx',output?:GainNode):number {
    const id = ++this.voiceSequence;
    const voice:Voice={name,nodes,cue,isMusic,channel,output};
    this.voices.set(id, voice);
    if((channel==='voice'||channel==='priority')&&this.music&&this.bus)this.ramp(this.bus.music.gain,this.musicScale*MUSIC_HEADROOM*.25,.04);
    let remaining = nodes.length;
    for (const node of nodes) {
      node.onended = () => {
        try { node.disconnect(); } catch { /* já desconectado */ }
        remaining -= 1;
        if (remaining <= 0) this.endVoice(id);
      };
    }
    // segurança extra: mesmo que um onended falhe, a voz é encerrada
    if (lengthSeconds !== null) voice.timer = window.setTimeout(() => this.stopVoice(id), (lengthSeconds + 0.6) * 1000);
    return id;
  }

  private stopVoice(id:number,fadeMs=0) {
    const voice = this.voices.get(id);
    if (!voice) return;
    if(fadeMs>0&&voice.output&&this.bus&&!voice.fading){
      voice.fading=true;if(voice.timer)window.clearTimeout(voice.timer);
      this.ramp(voice.output.gain,.0001,fadeMs/1_000/3);
      voice.timer=window.setTimeout(()=>this.stopVoice(id),fadeMs);
      return;
    }
    for (const node of voice.nodes) {
      try { node.stop(); } catch { /* não iniciado ou já parado */ }
      try { node.disconnect(); } catch { /* já desconectado */ }
    }
    this.endVoice(id);
  }

  private endVoice(id: number) {
    const voice = this.voices.get(id);
    if (!voice) return;
    if (voice.timer) window.clearTimeout(voice.timer);
    this.voices.delete(id);
    if (this.music?.voice === id) this.music = null;
    if (voice.cue) this.log(voice.cue, 'encerrou');
    if(this.bus&&![...this.voices.values()].some(item=>item.channel==='voice'||item.channel==='priority'))this.ramp(this.bus.music.gain,this.musicScale*MUSIC_HEADROOM,.35);
    this.pump();
  }

  // ---- música de fundo (só arquivo do operador) ---------------------------

  private syncMusic() {
    const asset = this.catalog.find(item => item.trigger === 'background_music' && item.enabled && item.url && !item.pending && !item.fileMissing);
    const want = this.musicWanted && this.enabled && !this.muted && !this.safe && Boolean(asset);
    if (!want) {
      if (this.music) this.stopVoice(this.music.voice);
      return;
    }
    if (this.music || this.musicLoading || !asset) return;
    this.musicLoading = true;
    void this.loadBuffer(asset.id, asset.url!).then(buffer => {
      this.musicLoading = false;
      if (!this.musicWanted || !this.enabled || this.safe || this.muted || this.music) return;
      const bus = this.ensureBus();
      void bus.ctx.resume();
      const source = bus.ctx.createBufferSource(), gain = bus.ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = clamp01(asset.volume / 100);
      source.connect(gain).connect(bus.music);
      source.start();
      this.music={voice:this.startVoice(asset.name,[source],null,undefined,true,'music',gain),assetId:asset.id};
    }).catch(error => {
      this.musicLoading = false;
      this.reportError(asset.id, error instanceof Error ? error.message : String(error));
    });
  }

  // ---- fila e reprodução -------------------------------------------------

  private async loadBuffer(assetId: string, url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(assetId);
    if (cached) return cached;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await this.ensureBus().ctx.decodeAudioData(await response.arrayBuffer());
    this.buffers.set(assetId, buffer);
    return buffer;
  }

  private channelOf(cue:AudioCue):AudioChannel {
    if(cue.trigger==='background_music'||cue.category==='music')return'music';
    if(['lula_catchphrase','bolsonaro_catchphrase','satire_meme'].includes(cue.category))return'voice';
    if(['round_start','race_start','round_end','victory','defeat'].includes(cue.trigger))return'priority';
    return'sfx';
  }

  private channelBus(channel:AudioChannel):GainNode {
    const bus=this.ensureBus();
    return channel==='music'?bus.music:channel==='voice'?bus.voice:channel==='priority'?bus.priority:bus.sfx;
  }

  private effectivePriority(cue:AudioCue){const channel=this.channelOf(cue);return cue.priority+(this.channelPriorities[channel]??0)}
  private channelLoad(channel:AudioChannel){return this.pending[channel]+[...this.voices.values()].filter(voice=>voice.channel===channel&&!voice.fading).length}
  private dropQueuedChannel(channel:AudioChannel,detail:string){
    const removed=this.queue.filter(cue=>this.channelOf(cue)===channel);this.queue=this.queue.filter(cue=>this.channelOf(cue)!==channel);
    this.dropped+=removed.length;for(const cue of removed)this.log(cue,'barrado',detail);
  }
  private interruptForFinish(){
    const stale=this.queue.filter(cue=>this.channelOf(cue)!=='priority');this.queue=this.queue.filter(cue=>this.channelOf(cue)==='priority');
    this.dropped+=stale.length;for(const cue of stale)this.log(cue,'barrado','chegada encerrou a relevância');
    for(const[id,voice]of[...this.voices]){
      if(voice.channel==='voice')this.stopVoice(id,100);
      else if(voice.channel==='sfx'||voice.channel==='priority')this.stopVoice(id,50);
    }
  }

  private pump() {
    if (!this.enabled || this.muted || this.safe) return;
    for(let index=0;index<this.queue.length;){
      const cue=this.queue[index],channel=this.channelOf(cue);
      const stale=Date.now()-Date.parse(cue.queuedAt)>(channel==='priority'?2_500:1_500);
      if(stale){this.queue.splice(index,1);this.dropped+=1;this.log(cue,'barrado','evento atrasado');continue}
      const nonMusicLoad=this.pending.voice+this.pending.sfx+this.pending.priority+[...this.voices.values()].filter(voice=>!voice.isMusic&&!voice.fading).length;
      const available=this.dynamicMixing
        ?channel==='voice'?this.channelLoad('voice')<1:channel==='sfx'?this.channelLoad('sfx')<this.maxVoices:channel==='priority'?this.channelLoad('priority')<2:true
        :nonMusicLoad<1;
      if(!available){index+=1;continue}
      this.queue.splice(index,1);this.pending[channel]+=1;
      void this.play(cue,channel).finally(()=>{this.pending[channel]=Math.max(0,this.pending[channel]-1);this.pump()});
    }
  }

  private async play(cue: AudioCue,channel=this.channelOf(cue)) {
    try {
      const bus = this.ensureBus();
      // Sem um clique na página o navegador pode deixar resume() pendente para sempre.
      await Promise.race([bus.ctx.resume(), new Promise(resolve => window.setTimeout(resolve, 400))]);
      if (!this.enabled || this.safe || this.muted) return;
      if (bus.ctx.state !== 'running') {
        this.dropped += 1;
        this.log(cue, 'barrado', 'navegador bloqueou o som: clique uma vez no overlay');
        return;
      }
      this.ramp(bus.master.gain, MASTER, 0.02);
      const isMusic = cue.trigger === 'background_music';
      const volume = clamp01(cue.volume / 100) * (isMusic ? 1 : this.categoryScale[audioGroupOf(cue.category)]);
      if (cue.sourceType === 'upload') {
        if (!cue.url) throw new Error('Arquivo não cadastrado.');
        const buffer = await this.loadBuffer(cue.assetId, cue.url);
        this.log(cue, 'carregado', `${buffer.duration.toFixed(2)} s`);
        if (!this.enabled || this.safe || this.muted) return;
        const source = bus.ctx.createBufferSource(), gain = bus.ctx.createGain();
        source.buffer = buffer;
        const targetVolume=volume*.9;gain.gain.setValueAtTime(.0001,bus.ctx.currentTime);gain.gain.setTargetAtTime(targetVolume,bus.ctx.currentTime,.02);
        source.connect(gain).connect(this.channelBus(channel));
        const length = isMusic ? Math.min(buffer.duration, MUSIC_TEST_SECONDS) : channel==='voice'?Math.min(buffer.duration,this.maxVoiceDuration):buffer.duration;
        source.start(0, 0, length);
        this.startVoice(cue.name,[source],length,cue,isMusic,channel,gain);
      } else {
        this.log(cue, 'carregado', 'efeito procedural original');
        this.playSynth(cue,cue.synthPreset??'impact',volume,channel);
      }
      if(channel==='voice')this.lastVoiceStartedAt=performance.now();
      this.log(cue, 'iniciou');
      this.played += 1;
      this.lastCueAt = new Date().toISOString();
      this.lastPlayedAt = this.lastCueAt;
      this.lastPlayedName = cue.name;
      this.log(cue, 'tocou');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(cue, 'erro', message.slice(0, 160));
      this.reportError(cue.assetId, message);
    }
  }

  private log(cue: AudioCue, result: AudioLogEntry['result'], detail?: string) {
    this.recent.unshift({ at: new Date().toISOString(), name: cue.name.slice(0, 110), group: audioGroupOf(cue.category), result, detail });
    if (this.recent.length > 20) this.recent.length = 20;
  }

  private reportError(assetId: string, message: string) {
    this.errors += 1;
    this.lastError = message;
    this.onError(assetId, message);
  }

  /**
   * Efeitos procedurais curtos: notas afinadas, ataque suave, fim agendado.
   * Nenhum oscilador fica ligado depois do efeito.
   */
  private playSynth(cue:AudioCue,preset:string,volume:number,channel:AudioChannel) {
    const { ctx } = this.ensureBus();
    const now = ctx.currentTime;
    const out = ctx.createGain();
    const targetVolume=Math.max(.02,Math.min(.9,volume))*EFFECTS_HEADROOM;
    out.gain.setValueAtTime(.0001,now);out.gain.setTargetAtTime(targetVolume,now,.02);
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass'; soften.frequency.value = 4_800; soften.Q.value = 0.5;
    out.connect(soften).connect(this.channelBus(channel));

    const tones: Tone[] =
      preset === 'fanfare'    ? [[392, 0, .18, 'triangle'], [523, .12, .18, 'triangle'], [659, .26, .34, 'triangle']] :
      preset === 'victory'    ? [[523, 0, .16, 'triangle'], [659, .14, .16, 'triangle'], [784, .28, .18, 'triangle'], [1_047, .44, .5, 'sine']] :
      preset === 'defeat'     ? [[392, 0, .24, 'triangle'], [330, .2, .26, 'triangle'], [262, .42, .46, 'sine']] :
      preset === 'gift'       ? [[784, 0, .1, 'sine'], [1_047, .09, .12, 'sine'], [1_319, .19, .26, 'sine']] :
      preset === 'shield'     ? [[659, 0, .2, 'sine'], [880, .1, .34, 'sine']] :
      preset === 'dodge'      ? [[880, 0, .08, 'sine'], [587, .07, .16, 'sine']] :
      preset === 'transition' ? [[523, 0, .24, 'sine'], [392, .2, .3, 'triangle']] :
      preset === 'special'    ? [[262, 0, .16, 'triangle'], [392, .12, .18, 'triangle'], [523, .26, .3, 'sine']] :
      preset === 'whistle'    ? [[988, 0, .09, 'sine'], [1_319, .13, .16, 'sine']] :
      preset === 'boost'      ? [[392, 0, .1, 'triangle'], [523, .08, .12, 'triangle'], [659, .18, .2, 'sine']] :
      preset === 'stumble'    ? [[196, 0, .14, 'triangle'], [147, .11, .2, 'triangle'], [110, .28, .3, 'sine']] :
      preset === 'overtake'   ? [[523, 0, .11, 'sine'], [784, .09, .14, 'sine'], [1_047, .2, .22, 'sine']] :
      preset === 'crowd'      ? [[262, 0, .6, 'sine'], [330, .05, .6, 'sine'], [392, .1, .6, 'sine']] :
      /* impact */              [[147, 0, .14, 'triangle'], [110, .06, .22, 'sine']];

    const nodes: OscillatorNode[] = [];
    let duration = 0.2;
    for (const [frequency, delay, length, type] of tones) {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.5, now + delay + Math.min(0.022, length * 0.35));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + length);
      oscillator.connect(gain).connect(out);
      oscillator.start(now + delay);
      oscillator.stop(now + delay + length + 0.03); // fim sempre agendado
      nodes.push(oscillator);
      duration = Math.max(duration, delay + length);
    }
    const voice=this.startVoice(cue.name,nodes,channel==='voice'?Math.min(duration,this.maxVoiceDuration):duration,cue,false,channel,out);
    const release = window.setTimeout(() => { try { out.disconnect(); soften.disconnect(); } catch { /* ignorado */ } }, (duration + 0.5) * 1000);
    void voice; void release;
  }
}

function clamp01(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

let shared: ArenaAudio | null = null;

/** Instância única por página. */
export function getArenaAudio(onError?: (assetId: string, message: string) => void): ArenaAudio {
  if (!shared) shared = new ArenaAudio(onError);
  return shared;
}

/** Compatibilidade com o nome antigo. */
export const ArenaAudioMixer = ArenaAudio;

// Em desenvolvimento, uma atualização deste arquivo recarrega a página inteira.
// Sem isso, o React mantinha o mixer antigo vivo (com o código antigo) depois de
// cada correção — e o som antigo continuava tocando até alguém recarregar.
if (import.meta.hot) {
  import.meta.hot.dispose(() => shared?.shutdown());
  import.meta.hot.accept(() => window.location.reload());
}
