import { EventEmitter } from 'node:events';
import type { ArenaConfig, ArenaState, AudioTrigger, Candidate, ConnectorGift, ConnectorStatus, GameState, GiftBoardItem, Phase, PublicEvent, RaceGift, RaceItemId } from '../src/types.js';
import { candidateFromComment, candidateFromGift, DedupeCache } from './scoring.js';
import { GameSimulation, modeForRound } from './game-simulation.js';
import { AudioDirector } from './audio-director.js';
import { Store } from './store.js';

interface PersistedRuntime {
  phase: Phase;
  previousPhase?: Phase;
  roundNumber: number;
  phaseEndsAt: string | null;
  roundStartedAt: string | null;
  pausedRemainingMs?: number;
  lulaPoints: number;
  bolsonaroPoints: number;
  lulaInteractions: number;
  bolsonaroInteractions: number;
  lulaUsers: string[];
  bolsonaroUsers: string[];
  likes: number;
  emergencyReason: string | null;
  game?: GameState;
  /** Quantas vezes cada presente cadastrado chegou nesta rodada. */
  giftCounts?: Record<string, number>;
  giftLastAt?: Record<string, string>;
}

export interface AppliedGift {
  registryId: string; name: string; side: Candidate; runner: Candidate; effect: string; label: string;
  detail: string | null; applied: boolean; quantity: number;
}

export interface IncomingEvent {
  source: 'demo' | 'tiktok';
  type: 'comment' | 'gift' | 'like';
  externalId: string;
  username: string;
  comment?: string;
  giftId?: string | number;
  forcedCandidate?: Candidate;
  /** Só para simulação: aponta direto um presente cadastrado (sem ID do TikTok). */
  registryGiftId?: string;
  repeatCount?: number;
  likes?: number;
  raw?: unknown;
}

interface EngineOptions {
  phaseIntervalMs?: number; gameIntervalMs?: number; gameRandom?: () => number; audioSafeMode?: boolean;
  /** Corridas 100% automáticas: ciclo contínuo, sem depender de painel ou aba aberta. */
  alwaysOn?: boolean;
  /** Eventos aleatórios de pista (arrancada, tropeço, impulso, escudo) sem público. Padrão: desligados. */
  autoEvents?: boolean;
  /** Em modo alwaysOn, pausa do operador volta sozinha depois deste tempo. */
  pauseMaxSec?: number;
}

const initialRuntime = (): PersistedRuntime => ({
  phase: 'idle', roundNumber: 0, phaseEndsAt: null, roundStartedAt: null,
  lulaPoints: 0, bolsonaroPoints: 0, lulaInteractions: 0, bolsonaroInteractions: 0,
  lulaUsers: [], bolsonaroUsers: [], likes: 0, emergencyReason: null
});

/** Atualização do painel: objetos aninhados podem vir parciais. */
export type ConfigPatch = Omit<Partial<ArenaConfig>, 'powerShortcuts' | 'categoryVolumes' | 'channelPriorities'> & {
  powerShortcuts?: Partial<ArenaConfig['powerShortcuts']>;
  categoryVolumes?: Partial<ArenaConfig['categoryVolumes']>;
  channelPriorities?: Partial<ArenaConfig['channelPriorities']>;
};

export class ArenaEngine extends EventEmitter {
  private config: ArenaConfig;
  private runtime: PersistedRuntime;
  private connector = {
    status: 'disabled' as ConnectorStatus,
    username: null as string | null,
    lastEventAt: null as string | null,
    detail: 'Conector não configurado',
    countingRealEvents: false,
    roomId: null as string | null,
    lastGift: null as ConnectorGift | null,
    unknownGifts: 0,
    appliedGifts: 0
  };
  private lastEvent: PublicEvent | null = null;
  private lastTickAt = new Date().toISOString();
  private startedAt = Date.now();
  private dedupe = new DedupeCache();
  private interval: NodeJS.Timeout;
  private gameInterval: NodeJS.Timeout;
  private game: GameSimulation;
  private lastGameTick = Date.now();
  private lastGamePersist = 0;
  private audio: AudioDirector;
  private lastAudioEffectId = 0;
  private finalSprintAnnounced = false;
  private autoEvents = { round: 0, total: 0, last: null as { at: string; candidate: Candidate; kind: RaceItemId; applied: boolean } | null };
  private pausedSince: number | null = null;
  /** Motores em atividade neste processo: deve haver exatamente um em produção. */
  private static running = new Set<ArenaEngine>();
  static activeEngines() { return ArenaEngine.running.size; }
  private diagnostics = {
    eventsReceived: 0, eventsAccepted: 0, eventsDiscarded: 0,
    discardReasons: {} as Record<string, number>, eventsBySource: { demo: 0, tiktok: 0 } as Record<string, number>, audioCues: 0, gameTicks: 0,
    gameRecoveries: 0, lastGameTickMs: 0, maxGameTickMs: 0
  };

  /** Time de cada espectador pelo último comentário com 13/22. */
  private teamByUser = new Map<string, Candidate>();
  private giftWithoutTeam = false;
  private giftRandom = Math.random;

  constructor(private store: Store, private options: EngineOptions = {}) {
    super();
    // O modo seguro de áudio vale a cada inicialização, independente do que ficou salvo.
    this.config = { ...store.getConfig(), audioSafeMode: options.audioSafeMode ?? true };
    this.runtime = store.getRuntime<PersistedRuntime>() ?? initialRuntime();
    if (options.alwaysOn && !this.config.autoMode) {
      this.config = { ...this.config, autoMode: true };
      store.saveConfig(this.config);
    }
    this.game = this.createGame(this.runtime.game);
    if (this.game.getState().mode === 'race') this.game.setRaceDuration(this.config.raceDurationSec);
    this.lastAudioEffectId = this.game.getState().effect?.id ?? 0;
    this.audio = new AudioDirector(store, () => this.config);
    this.audio.on('cue', cue => { this.diagnostics.audioCues += 1; this.emit('audio', cue); });
    if (this.runtime.phase === 'emergency') this.runtime.emergencyReason ||= 'Parada de emergência restaurada após reinicialização';
    this.alignGameMode();
    this.interval = setInterval(() => this.tick(), options.phaseIntervalMs ?? 500);
    this.interval.unref();
    this.gameInterval = setInterval(() => this.tickGame(), options.gameIntervalMs ?? (this.config.reducedMotion ? 180 : 100));
    this.gameInterval.unref();
    ArenaEngine.running.add(this);
  }

  private createGame(saved?: GameState) {
    const game = new GameSimulation(saved, this.options.gameRandom);
    game.autoEventsEnabled = Boolean(this.options.autoEvents);
    game.onAutoEvent = event => {
      this.autoEvents.round += 1;
      this.autoEvents.total += 1;
      this.autoEvents.last = { at: new Date().toISOString(), ...event };
    };
    return game;
  }

  getDiagnostics() { return structuredClone(this.diagnostics); }

  getState(): ArenaState {
    const silent = this.connector.status === 'connected' && this.connector.lastEventAt &&
      Date.now() - Date.parse(this.connector.lastEventAt) > this.config.staleEventThresholdSec * 1000;
    return {
      phase: this.runtime.phase,
      automationStage: this.runtime.phase === 'idle' ? 'preparation'
        : this.runtime.phase === 'opening' ? 'countdown'
        : this.runtime.phase === 'live' ? 'race'
        : this.runtime.phase === 'results' ? 'result'
        : this.runtime.phase === 'intermission' ? 'restart'
        : this.runtime.phase === 'paused' ? 'paused' : 'stopped',
      previousPhase: this.runtime.previousPhase,
      roundNumber: this.runtime.roundNumber,
      phaseEndsAt: this.runtime.phaseEndsAt,
      serverNow: new Date().toISOString(),
      lula: { points: this.runtime.lulaPoints, interactions: this.runtime.lulaInteractions, uniqueUsers: this.runtime.lulaUsers.length },
      bolsonaro: { points: this.runtime.bolsonaroPoints, interactions: this.runtime.bolsonaroInteractions, uniqueUsers: this.runtime.bolsonaroUsers.length },
      likes: this.runtime.likes,
      // Em modo seguro todo cliente recebe "som desligado" — inclusive páginas
      // antigas abertas, que assim silenciam o próprio mixer.
      config: { ...this.config, soundEnabled: this.config.soundEnabled && !this.config.audioSafeMode },
      connector: { ...this.connector, status: silent ? 'stalled' : this.connector.status },
      health: {
        server: Date.now() - Date.parse(this.lastTickAt) < 4_000 ? 'ok' : 'degraded',
        watchdog: silent ? 'warning' : 'ok',
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
        lastTickAt: this.lastTickAt
      },
      lastEvent: this.lastEvent,
      emergencyReason: this.runtime.emergencyReason,
      game: this.game.getState(),
      gifts: this.giftBoard(),
      automation: {
        alwaysOn: Boolean(this.options.alwaysOn),
        autoEventsEnabled: Boolean(this.options.autoEvents),
        autoEventsRound: this.autoEvents.round,
        autoEventsTotal: this.autoEvents.total,
        lastAutoEvent: this.autoEvents.last
      }
    };
  }

  updateConfig(patch: ConfigPatch) {
    const wasAuto = this.config.autoMode;
    if (this.options.alwaysOn && patch.autoMode === false) patch = { ...patch, autoMode: true };
    const duration = patch.raceDurationSec ?? patch.roundDurationSec;
    this.config = {
      ...this.config, ...patch,
      ...(duration === undefined ? {} : { raceDurationSec:duration, roundDurationSec:duration }),
      // objetos aninhados chegam parciais do painel: mescla em vez de substituir
      powerShortcuts: { ...this.config.powerShortcuts, ...(patch.powerShortcuts ?? {}) },
      categoryVolumes: { ...this.config.categoryVolumes, ...(patch.categoryVolumes ?? {}) },
      channelPriorities:{...this.config.channelPriorities,...(patch.channelPriorities??{})}
    };
    this.store.saveConfig(this.config);
    this.recordSystem('control', 'Configuração atualizada');
    if (this.alignGameMode()) this.persist();
    if (!wasAuto && this.config.autoMode && this.runtime.phase === 'idle') this.start();
    this.broadcast();
  }

  /**
   * Fora de uma rodada, o cenário mostrado precisa ser o da próxima rodada e não
   * o da última encerrada: sem isso o overlay parado exibe a arena da batalha
   * mesmo com o modo corrida configurado.
   */
  private alignGameMode(): boolean {
    if (!['idle', 'emergency'].includes(this.runtime.phase)) return false;
    const next = modeForRound(this.config.gameMode, this.runtime.roundNumber + 1);
    if (this.game.getState().mode === next) return false;
    this.game.reset(this.config.gameMode, this.runtime.roundNumber + 1, {
      distanceM: this.config.raceDistanceM, eventFrequency: this.config.raceEventFrequency, durationSec: this.config.raceDurationSec
    });
    this.runtime.game = this.game.getState();
    return true;
  }

  start() {
    if (this.runtime.phase === 'emergency') throw new Error('Libere a parada de emergência antes de iniciar.');
    if (this.runtime.phase === 'paused') return this.resume();
    if (this.runtime.phase !== 'idle') return;
    this.enterOpening();
  }

  /** Chamado uma única vez quando o servidor local fica pronto. */
  ensureAutomaticCycle() {
    if (this.config.autoMode && this.runtime.phase === 'idle') this.start();
  }

  /**
   * Início do backend em modo automático: qualquer estado herdado do volume (pausa, parada de
   * emergência, rodada interrompida) é descartado e uma rodada nova abre em 0%, sem intervenção.
   */
  bootAutomation() {
    if (!this.options.alwaysOn) return this.ensureAutomaticCycle();
    this.game.pause();
    this.runtime.phase = 'idle';
    this.runtime.previousPhase = undefined;
    this.runtime.pausedRemainingMs = undefined;
    this.runtime.emergencyReason = null;
    this.runtime.phaseEndsAt = null;
    this.runtime.roundStartedAt = null;
    this.recordSystem('control', 'Backend iniciado: corrida automática começa do zero');
    this.enterOpening();
  }

  /** Reinicia a corrida do zero: encerra a rodada atual e abre outra na hora. */
  restart() {
    if (this.runtime.phase === 'emergency') throw new Error('Libere a parada de emergência antes de reiniciar.');
    this.game.pause();
    this.resetCounters();
    this.recordSystem('control', 'Corrida reiniciada pelo operador');
    this.enterOpening();
  }

  pause() {
    if (['idle', 'paused', 'emergency'].includes(this.runtime.phase)) return;
    this.runtime.previousPhase = this.runtime.phase;
    this.runtime.pausedRemainingMs = this.runtime.phaseEndsAt ? Math.max(0, Date.parse(this.runtime.phaseEndsAt) - Date.now()) : 0;
    this.runtime.phase = 'paused';
    this.runtime.phaseEndsAt = null;
    this.game.pause();
    this.recordSystem('control', 'Operação pausada pelo administrador');
    this.saveAndBroadcast();
  }

  resume() {
    if (this.runtime.phase !== 'paused') return;
    this.runtime.phase = this.runtime.previousPhase && this.runtime.previousPhase !== 'paused' ? this.runtime.previousPhase : 'live';
    this.runtime.phaseEndsAt = new Date(Date.now() + (this.runtime.pausedRemainingMs ?? this.config.roundDurationSec * 1000)).toISOString();
    this.runtime.previousPhase = undefined;
    this.runtime.pausedRemainingMs = undefined;
    if (this.runtime.phase === 'live') this.game.resume();
    this.recordSystem('control', 'Operação retomada');
    this.saveAndBroadcast();
  }

  finish() {
    if (this.runtime.phase === 'live') this.enterResults();
    else {
      this.runtime.phase = 'idle';
      this.runtime.phaseEndsAt = null;
      this.game.pause();
      this.recordSystem('control', 'Operação encerrada');
      this.saveAndBroadcast();
    }
  }

  /** Encerra o ciclo sem criar outra rodada; a rodada ativa ainda salva resultado. */
  stopCycle() {
    if (this.options.alwaysOn) {
      this.recordSystem('control', 'Ciclo automático permanente (AUTO_RACE): o pedido de encerramento foi ignorado');
      this.broadcast();
      return;
    }
    this.updateConfig({ autoMode:false });
    if (this.runtime.phase === 'live') this.enterResults();
    else if (!['results','intermission','emergency'].includes(this.runtime.phase)) {
      this.runtime.phase = 'idle';
      this.runtime.phaseEndsAt = null;
      this.game.pause();
      this.recordSystem('control', 'Ciclo automático encerrado pelo operador');
      this.saveAndBroadcast();
    }
  }

  resetScore() {
    this.resetCounters();
    this.game.resetWins();
    this.recordSystem('control', 'Placar reiniciado manualmente');
    this.saveAndBroadcast();
  }

  emergencyStop(reason = 'Acionada pelo operador') {
    this.runtime.previousPhase = this.runtime.phase;
    this.runtime.phase = 'emergency';
    this.runtime.phaseEndsAt = null;
    this.runtime.emergencyReason = reason;
    this.game.pause();
    this.recordSystem('control', `PARADA DE EMERGÊNCIA: ${reason}`);
    this.store.log('warn', 'Parada de emergência acionada', { reason });
    this.saveAndBroadcast();
  }

  releaseEmergency() {
    if (this.runtime.phase !== 'emergency') return;
    this.runtime.phase = 'idle';
    this.runtime.previousPhase = undefined;
    this.runtime.emergencyReason = null;
    this.game.pause();
    this.recordSystem('control', 'Parada de emergência liberada; operação permanece ociosa');
    this.saveAndBroadcast();
  }

  setConnector(status: ConnectorStatus, detail: string, username?: string | null) {
    this.connector.status = status;
    this.connector.detail = detail;
    if (username !== undefined) this.connector.username = username;
    this.connector.countingRealEvents = status === 'connected' && this.runtime.phase === 'live';
    this.store.log(status === 'error' ? 'error' : 'info', `TikTok: ${detail}`);
    this.broadcast();
  }

  /** Dados do monitoramento (sala, último presente, contadores). Não altera o status. */
  setConnectorInfo(patch: { roomId?: string | null; lastGift?: ConnectorGift | null; unknownGifts?: number; appliedGifts?: number }) {
    Object.assign(this.connector, patch);
    this.broadcast();
  }

  /** Presentes cadastrados e ativos que usam este ID do TikTok. */
  findRaceGiftsByTikTokId(giftId: string | number): RaceGift[] {
    const id = String(giftId);
    return this.store.raceGifts().filter(gift => gift.enabled && gift.tiktokGiftId && gift.tiktokGiftId === id);
  }

  testAudio(assetId: string) { return this.audio.test(assetId); }

  /** Configuração real (sem a máscara de som aplicada em getState). */
  getConfig(): ArenaConfig { return this.config; }

  /** Dispara um item da corrida a partir do painel administrativo. */
  testRaceItem(candidate: Candidate, item: RaceItemId, strength = 1): { applied: boolean } {
    if (this.runtime.phase !== 'live') throw new Error('Inicie a corrida antes de testar os itens.');
    const applied = this.game.raceItem(candidate, item, strength);
    this.recordSystem('control', `SIMULADO: ${item} em ${candidate === 'lula' ? '13' : '22'}${applied ? '' : ' (anulado pelo escudo)'}`);
    this.saveAndBroadcast();
    return { applied };
  }

  /** Força uma ultrapassagem de teste, usando a detecção normal da corrida. */
  testOvertake(candidate: Candidate): { applied: boolean } {
    if (this.runtime.phase !== 'live') throw new Error('Inicie a corrida antes de testar a ultrapassagem.');
    const applied = this.game.forceOvertake(candidate);
    this.recordSystem('control', `SIMULADO: ultrapassagem de ${candidate === 'lula' ? '13' : '22'}`);
    this.saveAndBroadcast();
    return { applied };
  }

  /** Leva um corredor à chegada para testar o encerramento e o placar. */
  testFinish(candidate: Candidate): { applied: boolean } {
    if (this.runtime.phase !== 'live') throw new Error('Inicie a corrida antes de simular a chegada.');
    const applied = this.game.forceFinish(candidate);
    this.recordSystem('control', `SIMULADO: chegada de ${candidate === 'lula' ? '13' : '22'}`);
    if (applied && this.game.getState().winner) this.enterResults();
    else this.saveAndBroadcast();
    return { applied };
  }

  /** Dispara um gatilho de áudio pelo diretor real, com as mesmas travas de repetição. */
  testAudioTrigger(trigger: AudioTrigger, candidate: Candidate | null) {
    const cue = this.audio.trigger(trigger, candidate, 105);
    return { fired: Boolean(cue), cue };
  }

  /** O conector ao vivo indica transmissão pública: bloqueia testes em massa. */
  isBroadcasting() {
    return this.connector.status === 'connected';
  }

  receive(input: IncomingEvent): { accepted: boolean; reason?: string; reasonCode?: string; gift?: AppliedGift } {
    this.diagnostics.eventsReceived += 1;
    if (this.runtime.phase !== 'live') return this.rejectEvent('fora_da_rodada', 'A rodada não está na fase de enquete.');
    if (input.source === 'tiktok' && this.connector.status !== 'connected') {
      return this.rejectEvent('conector_indisponivel', 'Contagem real suspensa: conector sem conexão saudável.');
    }
    if (this.store.hasExternalEvent(input.externalId) || !this.dedupe.accept(input.externalId)) return this.rejectEvent('duplicado', 'Evento duplicado.');

    const at = new Date().toISOString();
    let event: PublicEvent | null = null;
    let registry: RaceGift | null = null, giftApplied = false, giftInfo: AppliedGift | undefined;
    this.giftWithoutTeam = false;
    if (input.type === 'comment' && input.comment) {
      const candidate = candidateFromComment(input.comment, this.config);
      if (!candidate) return this.rejectEvent('sem_gatilho', 'Comentário sem palavra-chave configurada.');
      this.teamByUser.set(input.username, candidate);
      event = this.addCandidate(candidate, this.config.commentPoints, input.username, 'comment', input.source, at);
    } else if (input.type === 'gift' && (registry = this.matchGift(input))) {
      // Presente cadastrado na coluna: pontua para o lado da coluna e aplica o efeito configurado.
      const quantity = Math.max(1, input.repeatCount ?? 1);
      const runner: Candidate = registry.target === 'own' ? registry.side : registry.side === 'lula' ? 'bolsonaro' : 'lula';
      event = this.addCandidate(registry.side, registry.points * quantity, input.username, 'gift', input.source, at);
      const strength = Math.min(3, registry.intensity * (1 + 0.15 * Math.min(10, quantity - 1)));
      const { applied, detail } = this.applyGiftEffect(registry, runner, strength);
      const counts = this.runtime.giftCounts ??= {};
      const lastAt = this.runtime.giftLastAt ??= {};
      counts[registry.id] = (counts[registry.id] ?? 0) + quantity;
      lastAt[registry.id] = at;
      const who = runner === 'lula' ? '13' : '22';
      event.summary = `${input.username} enviou ${registry.name}${quantity > 1 ? ` ×${quantity}` : ''} → ${registry.label}${detail ? ` (${detail})` : ''} · ${who}${applied ? '' : ': escudo anulou'}`;
      giftApplied = true;
      giftInfo = { registryId: registry.id, name: registry.name, side: registry.side, runner, effect: registry.effect, label: registry.label, detail: detail ?? null, applied, quantity };
    } else if (input.type === 'gift' && input.giftId !== undefined) {
      const candidate = input.source === 'demo' && input.forcedCandidate ? input.forcedCandidate : candidateFromGift(input.giftId, this.config);
      if (!candidate && this.giftWithoutTeam) { this.giftWithoutTeam = false; return this.rejectEvent('presente_sem_time', 'Quem enviou o presente ainda não comentou 13 ou 22.'); }
      if (!candidate) return this.rejectEvent('presente_nao_mapeado', 'Presente não está atribuído a um participante.');
      const quantity = Math.max(1, input.repeatCount ?? 1);
      const points = (candidate === 'lula' ? this.config.lulaGiftPoints : this.config.bolsonaroGiftPoints) * quantity;
      event = this.addCandidate(candidate, points, input.username, 'gift', input.source, at);
    } else if (input.type === 'like') {
      const likes = Math.max(1, input.likes ?? 1);
      this.runtime.likes += likes;
      event = { at, source: input.source, type: 'like', username: input.username, summary: `${input.username} enviou ${likes} curtida${likes > 1 ? 's' : ''}` };
    }
    if (!event) return this.rejectEvent('invalido', 'Evento inválido.');
    if (!this.store.addEvent(event, input.externalId, input.raw)) return this.rejectEvent('duplicado_persistido', 'Evento já persistido.');
    const strength = input.type === 'gift' ? this.config.giftBoost : input.type === 'comment' ? this.config.commentBoost : (event.points ?? input.likes ?? 1);
    // Presente cadastrado já aplicou o próprio efeito; os demais seguem a regra geral.
    if (!giftApplied) this.game.interaction(event.candidate ?? null, input.type, strength);
    if (input.type === 'gift') this.audio.trigger('gift_received', event.candidate ?? null, 90);
    else if (input.type === 'comment') this.audio.trigger('comment_received', event.candidate ?? null, 60);
    this.lastEvent = event;
    if (input.source === 'tiktok') this.connector.lastEventAt = at;
    this.saveAndBroadcast(event);
    this.diagnostics.eventsAccepted += 1;
    this.diagnostics.eventsBySource[input.source] = (this.diagnostics.eventsBySource[input.source] ?? 0) + 1;
    return { accepted: true, gift: giftInfo };
  }

  shutdown() {
    ArenaEngine.running.delete(this);
    clearInterval(this.interval);
    clearInterval(this.gameInterval);
    this.persist();
  }

  private tick() {
    this.lastTickAt = new Date().toISOString();
    this.connector.countingRealEvents = this.connector.status === 'connected' && this.runtime.phase === 'live';
    if (this.options.alwaysOn) this.selfHeal();
    if (this.runtime.phaseEndsAt && Date.now() >= Date.parse(this.runtime.phaseEndsAt)) {
      if (this.runtime.phase === 'opening') this.enterLive();
      else if (this.runtime.phase === 'live') this.enterResults();
      else if (this.runtime.phase === 'results') this.enterIntermission();
      else if (this.runtime.phase === 'intermission') {
        if (this.config.autoMode) this.enterOpening();
        else { this.runtime.phase = 'idle'; this.runtime.phaseEndsAt = null; this.saveAndBroadcast(); }
      }
    } else if (Math.floor(Date.now() / 1000) % 2 === 0) this.broadcast();
  }

  /** Ciclo permanente: ocioso volta a correr e pausa esquecida é retomada. Emergência fica manual. */
  private selfHeal() {
    if (this.runtime.phase === 'idle') {
      this.enterOpening();
      return;
    }
    if (this.runtime.phase === 'paused') {
      this.pausedSince ??= Date.now();
      if (Date.now() - this.pausedSince >= (this.options.pauseMaxSec ?? 120) * 1000) {
        this.pausedSince = null;
        this.recordSystem('control', 'Pausa expirada: automação retomada');
        this.resume();
      }
    } else this.pausedSince = null;
  }

  private tickGame() {
    const tickStartedAt = performance.now();
    try {
    const now = Date.now();
    const delta = (now - this.lastGameTick) / 1000;
    this.lastGameTick = now;
    if (this.runtime.phase !== 'live') return;
    const changed = this.game.tick(delta, this.config.gameDifficulty);
    this.diagnostics.gameTicks += 1;
    if (!changed) return;
    const gameState = this.game.getState();
    if (gameState.effect && gameState.effect.id !== this.lastAudioEffectId) {
      this.lastAudioEffectId = gameState.effect.id;
      this.audio.recordGameEffect(gameState.effect);
    }
    if (gameState.finalSprint && !this.finalSprintAnnounced) {
      this.finalSprintAnnounced = true;
      this.audio.trigger('final_sprint', null, 88);
    }
    if (gameState.winner) {
      this.enterResults();
      return;
    }
    if (now - this.lastGamePersist > 2_000) {
      this.persist();
      this.lastGamePersist = now;
    }
    this.broadcast();
    } catch (error) {
      this.diagnostics.gameRecoveries += 1;
      this.store.log('error', 'Falha no motor 3D; último estado persistido restaurado', { error: String(error) });
      this.game = this.createGame(this.runtime.game);
      if (this.runtime.phase === 'live') this.game.resume();
      this.broadcast();
    } finally {
      const elapsed = performance.now() - tickStartedAt;
      this.diagnostics.lastGameTickMs = Math.round(elapsed * 100) / 100;
      this.diagnostics.maxGameTickMs = Math.max(this.diagnostics.maxGameTickMs, this.diagnostics.lastGameTickMs);
    }
  }

  private enterOpening() {
    this.runtime.phase = 'opening';
    this.runtime.roundNumber += 1;
    this.runtime.phaseEndsAt = this.after(this.config.openingDurationSec);
    this.runtime.roundStartedAt = null;
    this.resetCounters();
    this.game.reset(this.config.gameMode, this.runtime.roundNumber, { distanceM: this.config.raceDistanceM, eventFrequency: this.config.raceEventFrequency, durationSec: this.config.raceDurationSec });
    this.finalSprintAnnounced = false;
    this.recordSystem('phase', `Abertura da rodada ${this.runtime.roundNumber}`);
    this.saveAndBroadcast();
  }

  private enterLive() {
    this.runtime.phase = 'live';
    this.runtime.roundStartedAt = new Date().toISOString();
    this.runtime.phaseEndsAt = this.after(this.config.roundDurationSec);
    this.game.start();
    this.audio.trigger(this.game.getState().mode === 'race' ? 'race_start' : 'round_start', null, 95);
    this.recordSystem('phase', `Rodada ${this.runtime.roundNumber} iniciada`);
    this.saveAndBroadcast();
  }

  private enterResults() {
    if (this.runtime.roundStartedAt) {
      const winner = this.game.finish();
      const game = this.game.getState();
      this.store.saveRound({
        roundNumber: this.runtime.roundNumber,
        startedAt: this.runtime.roundStartedAt,
        endedAt: new Date().toISOString(),
        lulaPoints: this.runtime.lulaPoints,
        bolsonaroPoints: this.runtime.bolsonaroPoints,
        lulaInteractions: this.runtime.lulaInteractions,
        bolsonaroInteractions: this.runtime.bolsonaroInteractions,
        winner,
        gameMode: game.mode,
        lulaEnergy: game.lula.energy,
        bolsonaroEnergy: game.bolsonaro.energy,
        lulaProgress: game.lula.raceProgress,
        bolsonaroProgress: game.bolsonaro.raceProgress
      });
      this.audio.trigger('round_end', winner === 'tie' ? null : winner, 92);
      if (winner !== 'tie') {
        this.audio.trigger('victory', winner, 100);
        this.audio.trigger('defeat', winner === 'lula' ? 'bolsonaro' : 'lula', 90);
      }
      this.runtime.roundStartedAt = null;
    }
    this.runtime.phase = 'results';
    this.runtime.phaseEndsAt = this.after(this.config.resultsDurationSec);
    this.recordSystem('phase', `Resultado da rodada ${this.runtime.roundNumber}`);
    this.saveAndBroadcast();
  }

  private enterIntermission() {
    this.runtime.phase = 'intermission';
    this.runtime.phaseEndsAt = this.after(this.config.intermissionDurationSec);
    this.audio.trigger('scene_change', null, 78);
    this.recordSystem('phase', 'Intervalo para a próxima rodada');
    this.saveAndBroadcast();
  }

  private addCandidate(candidate: Candidate, points: number, username: string, type: 'comment' | 'gift', source: 'demo' | 'tiktok', at: string): PublicEvent {
    const users = candidate === 'lula' ? this.runtime.lulaUsers : this.runtime.bolsonaroUsers;
    if (!users.includes(username)) users.push(username);
    if (candidate === 'lula') { this.runtime.lulaPoints += points; this.runtime.lulaInteractions += 1; }
    else { this.runtime.bolsonaroPoints += points; this.runtime.bolsonaroInteractions += 1; }
    return { at, source, type, candidate, points, username, summary: `${username} +${points} para ${candidate === 'lula' ? '13' : '22'}` };
  }

  private recordSystem(type: 'phase' | 'control', summary: string) {
    const event: PublicEvent = { at: new Date().toISOString(), source: 'system', type, summary };
    this.lastEvent = event;
    this.store.addEvent(event);
  }

  /**
   * Presente cadastrado correspondente ao evento: em teste, o ID interno; num
   * evento real, o ID do TikTok. Se o mesmo presente existe nas duas colunas
   * (como na cartela), vale o time do último comentário de quem enviou (13 ou 22).
   */
  private matchGift(input: IncomingEvent): RaceGift | null {
    const gifts = this.store.raceGifts().filter(gift => gift.enabled);
    if (input.source === 'demo' && input.registryGiftId) return gifts.find(gift => gift.id === input.registryGiftId) ?? null;
    if (input.giftId === undefined || input.giftId === null) return null;
    const id = String(input.giftId);
    const matches = gifts.filter(gift => gift.tiktokGiftId && gift.tiktokGiftId === id);
    if (matches.length <= 1) return matches[0] ?? null;
    const team = this.teamByUser.get(input.username);
    if (!team) { this.giftWithoutTeam = true; return null; }
    return matches.find(gift => gift.side === team) ?? null;
  }

  /** Aplica o efeito do presente no motor da corrida. */
  private applyGiftEffect(gift: RaceGift, runner: Candidate, strength: number): { applied: boolean; detail?: string } {
    const duration = gift.durationSec || undefined;
    const rival: Candidate = runner === 'lula' ? 'bolsonaro' : 'lula';
    if (gift.effect === 'recuperacao') {
      const stumbling = this.game.getState()[runner].action === 'stumble';
      this.game.recover(runner, strength, duration);
      return { applied: true, detail: stumbling ? 'saiu do tropeço' : 'ritmo recuperado' };
    }
    if (gift.effect === 'especial') {
      // PODER ESPECIAL: combinação aleatória e poderosa
      const combos: Array<[string, () => void]> = [
        ['turbo + escudo', () => { this.game.raceItem(runner, 'turbo', 3, duration); this.game.raceItem(runner, 'escudo', 1, duration); }],
        ['turbo + rival tropeçou', () => { this.game.raceItem(runner, 'turbo', 3, duration); this.game.raceItem(rival, 'tropeco', 3, 1.6); }],
        ['arrancada + escudo + rival tropeçou', () => { this.game.raceItem(runner, 'arrancada', 3, duration); this.game.raceItem(runner, 'escudo', 1, duration); this.game.raceItem(rival, 'tropeco', 2, 1.4); }]
      ];
      const [name, run] = combos[Math.floor(this.giftRandom() * combos.length)];
      run();
      return { applied: true, detail: name };
    }
    if (gift.effect === 'aleatorio') {
      const options: Array<[string, () => boolean]> = [
        ['impulso', () => this.game.raceItem(runner, 'impulso', strength, duration)],
        ['turbo', () => this.game.raceItem(runner, 'turbo', strength, duration)],
        ['super arrancada', () => this.game.raceItem(runner, 'arrancada', strength, duration)],
        ['escudo', () => this.game.raceItem(runner, 'escudo', 1, duration)],
        ['rival tropeçou', () => this.game.raceItem(rival, 'tropeco', strength, 1.4)]
      ];
      const [name, run] = options[Math.floor(this.giftRandom() * options.length)];
      return { applied: run(), detail: `sorteio: ${name}` };
    }
    return { applied: this.game.raceItem(runner, gift.effect, strength, duration) };
  }

  private giftBoard(): GiftBoardItem[] {
    const counts = this.runtime.giftCounts ?? {}, lastAt = this.runtime.giftLastAt ?? {};
    return this.store.raceGifts().filter(gift => gift.enabled).map(gift => ({
      id: gift.id, name: gift.name, side: gift.side, effect: gift.effect, target: gift.target, label: gift.label,
      costLabel: gift.costLabel, imageUrl: gift.imageUrl ?? null, count: counts[gift.id] ?? 0, lastAt: lastAt[gift.id] ?? null
    }));
  }

  /** Atualizações do painel de presentes chegam ao overlay na hora. */
  giftsChanged() { this.broadcast(); }

  private resetCounters() {
    this.autoEvents.round = 0;
    this.runtime.giftCounts = {};
    this.runtime.giftLastAt = {};
    this.runtime.lulaPoints = 0; this.runtime.bolsonaroPoints = 0;
    this.runtime.lulaInteractions = 0; this.runtime.bolsonaroInteractions = 0;
    this.runtime.lulaUsers = []; this.runtime.bolsonaroUsers = []; this.runtime.likes = 0;
  }

  private rejectEvent(code: string, reason: string) {
    this.diagnostics.eventsDiscarded += 1;
    this.diagnostics.discardReasons[code] = (this.diagnostics.discardReasons[code] ?? 0) + 1;
    return { accepted: false, reason, reasonCode: code };
  }

  private after(seconds: number) { return new Date(Date.now() + seconds * 1000).toISOString(); }
  private persist() {
    this.runtime.game = this.game.getState();
    this.store.saveRuntime(this.runtime);
  }
  private broadcast(event?: PublicEvent) { this.emit('state', this.getState(), event); }
  private saveAndBroadcast(event?: PublicEvent) { this.persist(); this.broadcast(event); }
}
