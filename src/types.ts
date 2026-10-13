export type Candidate = 'lula' | 'bolsonaro';
/** Nunca exibe 100% antes de o estado autoritativo realmente alcançar a chegada. */
export function raceProgressPercent(value:number) {
  const normalized=Math.min(1,Math.max(0,value));
  return normalized>=1?100:Math.min(99,Math.floor(normalized*100));
}
export type Phase = 'idle' | 'opening' | 'live' | 'paused' | 'results' | 'intermission' | 'emergency';
/** Último presente real recebido do TikTok (monitoramento administrativo). */
export interface ConnectorGift {
  at: string;
  giftId: string;
  giftName: string | null;
  repeatCount: number;
  sender: string;
  runner: Candidate | null;
  power: string | null;
  status: 'aplicado' | 'pendente' | 'fora_da_rodada' | 'descartado';
}

export type ConnectorStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'stalled' | 'disconnected' | 'ended' | 'error' | 'offline' | 'standby';
export type GameMode = 'battle' | 'race';
export type GameModeSetting = GameMode | 'alternate';
export type CameraMode = 'dynamic' | 'wide' | 'close';
/** Conjunto visual dos corredores: cartoon 2.5D (novo) ou volumes 3D simples (antigo). */
export type RunnerStyle = 'cartoon' | 'classic';
export type AudioMode = 'discreet' | 'memes' | 'arena';
export type AudioCategory = 'lula_catchphrase' | 'bolsonaro_catchphrase' | 'satire_meme' | 'crowd' | 'hit' | 'defense' | 'result' | 'gift' | 'alert' | 'music';
export type AudioTrigger = 'round_start' | 'impact' | 'special' | 'defense' | 'dodge' | 'gift_received' | 'comment_received' | 'combo' | 'scene_change' | 'round_end' | 'victory' | 'defeat' | 'race_start' | 'boost' | 'stumble' | 'overtake' | 'final_sprint' | 'background_music';
export type FighterAction = 'idle' | 'advance' | 'retreat' | 'attack' | 'special' | 'block' | 'dodge' | 'hit' | 'celebrate' | 'drive' | 'boost' | 'overtake' | 'run' | 'sprint' | 'stumble' | 'shielded';

/** Itens/ações especiais da corrida, exibidos nas laterais do overlay. */
export type RaceItemId = 'impulso' | 'arrancada' | 'turbo' | 'escudo' | 'tropeco';
export const RACE_ITEMS: Array<{ id: RaceItemId; label: string; icon: string; hint: string }> = [
  { id:'impulso', label:'IMPULSO', icon:'»', hint:'cada comentário empurra o corredor' },
  { id:'arrancada', label:'SUPER ARRANCADA', icon:'↟', hint:'explosão de velocidade curta' },
  { id:'turbo', label:'TURBO', icon:'⚡', hint:'presente especial libera turbo longo' },
  { id:'escudo', label:'ESCUDO', icon:'◈', hint:'anula o próximo tropeço' },
  { id:'tropeco', label:'TROPEÇO', icon:'✖', hint:'o corredor perde o ritmo' }
];

export interface ArenaConfig {
  autoMode: boolean;
  roundDurationSec: number;
  openingDurationSec: number;
  resultsDurationSec: number;
  intermissionDurationSec: number;
  lulaKeyword: string;
  bolsonaroKeyword: string;
  lulaGiftId: string;
  bolsonaroGiftId: string;
  commentPoints: number;
  lulaGiftPoints: number;
  bolsonaroGiftPoints: number;
  likesGoal: number;
  soundEnabled: boolean;
  reducedMotion: boolean;
  staleEventThresholdSec: number;
  gameMode: GameModeSetting;
  gameDifficulty: number;
  cameraMode: CameraMode;
  musicVolume: number;
  effectsVolume: number;
  animationIntensity: number;
  audioMode: AudioMode;
  maxConcurrentSounds: number;
  minCatchphraseIntervalSec: number;
  lulaCharacterAsset: string;
  bolsonaroCharacterAsset: string;
  characterAssetVersion: number;
  raceDistanceM: number;
  raceDurationSec: number;
  raceEventFrequency: number;
  commentBoost: number;
  giftBoost: number;
  lulaCommandLabel: string;
  bolsonaroCommandLabel: string;
  runnerStyle: RunnerStyle;
  /** Texto do atalho exibido em cada poder das colunas laterais. `{n}` vira 13 ou 22. */
  powerShortcuts: Record<RaceItemId, string>;
  /** Trilha de fundo: desligada por padrão. */
  musicEnabled: boolean;
  /** Volume por categoria de som, de 0 a 100. */
  categoryVolumes: Record<AudioGroup, number>;
  /**
   * AUDIO_SAFE_MODE: silêncio absoluto. Nenhum AudioContext é criado e nenhum
   * som é disparado. Liga sozinho a cada inicialização do servidor; só sai dele
   * por ação explícita do operador ("ATIVAR ÁUDIO").
   */
  audioSafeMode: boolean;
  /** Intervalo mínimo, em ms, entre duas reproduções do mesmo efeito. */
  effectRepeatMs: number;
  /** Mixagem por canais independentes no overlay. */
  dynamicMixingEnabled: boolean;
  /** Limite aplicado só durante a reprodução; o arquivo original não é alterado. */
  maxCatchphraseDurationSec: number;
  /** Peso configurável usado na preempção dentro de cada canal. */
  channelPriorities: { music:number; voice:number; sfx:number; priority:number };
}

/** Grupos de volume do painel de áudio. */
export type AudioGroup = 'corrida' | 'bordoes' | 'memes' | 'torcida' | 'resultado';
export const AUDIO_GROUPS: Array<{ id: AudioGroup; label: string }> = [
  { id: 'corrida', label: 'Efeitos de corrida' },
  { id: 'bordoes', label: 'Bordões' },
  { id: 'memes', label: 'Memes e provocações' },
  { id: 'torcida', label: 'Torcida' },
  { id: 'resultado', label: 'Largada e resultado' }
];
export function audioGroupOf(category: AudioCategory): AudioGroup {
  if (category === 'lula_catchphrase' || category === 'bolsonaro_catchphrase') return 'bordoes';
  if (category === 'satire_meme') return 'memes';
  if (category === 'crowd') return 'torcida';
  if (category === 'result' || category === 'alert' || category === 'music') return 'resultado';
  return 'corrida';
}

export interface AudioAsset {
  id: string;
  name: string;
  category: AudioCategory;
  trigger: AudioTrigger;
  candidate: Candidate | null;
  sourceType: 'synth' | 'upload';
  fileName: string | null;
  mimeType: string | null;
  synthPreset: string | null;
  volume: number;
  enabled: boolean;
  maxFrequencySec: number;
  playMode: 'random' | 'sequential';
  isSatire: boolean;
  licenseNote: string;
  animation: string;
  priority: number;
  /** Duração real detectada pelo navegador no momento do upload. */
  durationSec?: number | null;
  createdAt: string;
  url?: string;
  /** Vaga de bordão criada sem arquivo: aparece como "Áudio não cadastrado". */
  pending?: boolean;
  /** O banco aponta um arquivo que não está mais em data/audio. */
  fileMissing?: boolean;
}

export interface AudioCue {
  id: string;
  assetId: string;
  name: string;
  category: AudioCategory;
  trigger: AudioTrigger;
  candidate: Candidate | null;
  sourceType: 'synth' | 'upload';
  url: string | null;
  synthPreset: string | null;
  volume: number;
  isSatire: boolean;
  animation: string;
  priority: number;
  queuedAt: string;
}

export interface GameCompetitor {
  x: number;
  z: number;
  energy: number;
  stamina: number;
  action: FighterAction;
  actionSequence: number;
  raceProgress: number;
  speed: number;
  lane: number;
  boost: number;
  /** Segundos restantes de escudo; enquanto houver, o corredor não tropeça. */
  shield: number;
  /** Colocação na corrida (1 = liderando). */
  position: 1 | 2;
  /** Quantas vezes cada item foi acionado na rodada. */
  items: Record<RaceItemId, number>;
}

export interface GameEffect {
  id: number;
  kind: 'impact' | 'shield' | 'dodge' | 'special' | 'boost' | 'crowd' | 'stumble' | 'overtake' | 'turbo';
  candidate?: Candidate;
  intensity: number;
}

export interface GameState {
  mode: GameMode;
  active: boolean;
  winner: Candidate | 'tie' | null;
  lula: GameCompetitor;
  bolsonaro: GameCompetitor;
  roundWins: { lula: number; bolsonaro: number };
  effect: GameEffect | null;
  cameraShot: number;
  simulationTick: number;
  /** Distância da pista em metros, usada pelo HUD da corrida. */
  raceDistanceM: number;
  /** Tempo efetivamente corrido e mínimo antes de aceitar uma chegada. */
  raceElapsedSec?: number;
  raceDurationSec?: number;
  /** Reta final: os dois corredores entram em sprint. */
  finalSprint: boolean;
  /** Quem assumiu a liderança por último (para bordões de ultrapassagem). */
  lastOvertakeBy: Candidate | null;
}

export interface CandidateScore {
  points: number;
  interactions: number;
  uniqueUsers: number;
}

export interface RoundSummary {
  id: number;
  roundNumber: number;
  startedAt: string;
  endedAt: string;
  lulaPoints: number;
  bolsonaroPoints: number;
  lulaInteractions: number;
  bolsonaroInteractions: number;
  winner: Candidate | 'tie';
  gameMode?: GameMode;
  lulaEnergy?: number;
  bolsonaroEnergy?: number;
  lulaProgress?: number;
  bolsonaroProgress?: number;
}

export interface PublicEvent {
  id?: number;
  at: string;
  source: 'demo' | 'tiktok' | 'system';
  type: 'comment' | 'gift' | 'like' | 'phase' | 'error' | 'control';
  candidate?: Candidate;
  points?: number;
  username?: string;
  summary: string;
}

/** Quem recebe o efeito do presente: o corredor da própria coluna ou o rival. */
export type GiftTarget = 'own' | 'rival';

/**
 * Efeito de um presente. Os cinco itens da corrida, mais:
 * - `especial`: turbo + escudo no corredor e tropeço no rival;
 * - `aleatorio`: sorteia um efeito diferente a cada envio;
 * - `recuperacao`: tira o corredor do tropeço e devolve a velocidade.
 */
export type GiftEffect = RaceItemId | 'especial' | 'aleatorio' | 'recuperacao';
export const GIFT_EFFECTS: Array<{ id: GiftEffect; label: string }> = [
  ...RACE_ITEMS.map(item => ({ id: item.id as GiftEffect, label: item.label })),
  { id: 'recuperacao', label: 'RECUPERAÇÃO (sai do tropeço, recupera a velocidade)' },
  { id: 'aleatorio', label: 'EFEITO ALEATÓRIO (um efeito diferente a cada uso)' },
  { id: 'especial', label: 'PODER ESPECIAL (combinação aleatória e poderosa)' }
];

/** Presente da corrida, cadastrado no painel. */
export interface RaceGift {
  id: string;
  /** Nome exibido. Enquanto `confirmed` for falso, é só uma descrição visual. */
  name: string;
  /** ID real do presente no TikTok. Vazio = só funciona em teste. */
  tiktokGiftId: string | null;
  /** Coluna onde aparece (13 à esquerda, 22 à direita). */
  side: Candidate;
  effect: GiftEffect;
  target: GiftTarget;
  /** Texto curto embaixo do ícone, ex.: "IMPULSO", "22 TROPEÇA". */
  label: string;
  /** Quantidade/valor mostrado, ex.: "1 moeda". Opcional. */
  costLabel: string;
  intensity: number;
  durationSec: number;
  points: number;
  enabled: boolean;
  order: number;
  imageFile: string | null;
  confirmed: boolean;
  note: string;
  createdAt: string;
  imageUrl?: string | null;
}

/** O que o overlay precisa para desenhar a coluna de presentes. */
export interface GiftBoardItem {
  id: string;
  name: string;
  side: Candidate;
  effect: GiftEffect;
  target: GiftTarget;
  label: string;
  costLabel: string;
  imageUrl: string | null;
  count: number;
  lastAt: string | null;
}

export interface ArenaState {
  phase: Phase;
  /** Nome operacional compartilhado entre admin, testes e overlay. */
  automationStage: 'preparation' | 'countdown' | 'race' | 'result' | 'restart' | 'paused' | 'stopped';
  previousPhase?: Phase;
  roundNumber: number;
  phaseEndsAt: string | null;
  serverNow: string;
  lula: CandidateScore;
  bolsonaro: CandidateScore;
  likes: number;
  config: ArenaConfig;
  connector: {
    status: ConnectorStatus;
    username: string | null;
    lastEventAt: string | null;
    detail: string;
    countingRealEvents: boolean;
    roomId?: string | null;
    lastGift?: ConnectorGift | null;
    unknownGifts?: number;
    appliedGifts?: number;
  };
  health: {
    server: 'ok' | 'degraded';
    watchdog: 'ok' | 'warning';
    uptimeSec: number;
    lastTickAt: string;
  };
  lastEvent: PublicEvent | null;
  emergencyReason: string | null;
  game: GameState;
  /** Presentes ativos nas colunas laterais, com contador da rodada. */
  gifts: GiftBoardItem[];
  /** Eventos INTERNOS automáticos da pista (não são presentes nem comentários). */
  automation?: {
    alwaysOn: boolean;
    autoEventsEnabled?: boolean;
    autoEventsRound: number;
    autoEventsTotal: number;
    lastAutoEvent: { at: string; candidate: Candidate; kind: RaceItemId; applied: boolean } | null;
  };
}

export interface AudioDiagnostics {
  state: 'not-started' | 'running' | 'suspended' | 'interrupted' | 'closed';
  enabled: boolean;
  active: number;
  queued: number;
  loaded: number;
  played: number;
  dropped: number;
  errors: number;
  lastCueAt: string | null;
  lastError: string | null;
  /** Sons simultâneos permitidos agora. */
  maxVoices?: number;
  /** Silêncio total pelo botão de mudo. */
  muted?: boolean;
  /** Trilha de fundo tocando neste momento. */
  music?: boolean;
  /** Últimas reproduções, para o painel de diagnóstico. */
  recent?: AudioLogEntry[];
  /** Modo seguro ativo nesta página. */
  safeMode?: boolean;
  /** Quantos AudioContext esta página criou desde que abriu. */
  contextsCreated?: number;
  /** Fontes de áudio tocando neste instante (osciladores e arquivos). */
  sources?: number;
  /** Nome de cada som tocando agora. */
  playing?: string[];
  /** Volume de saída efetivo (0 a 1). */
  masterVolume?: number;
  /** Autorização obtida por gesto dentro desta página do overlay. */
  authorized?: boolean;
  /** Rodadas distintas observadas pela mesma instância do mixer. */
  roundsObserved?: number;
  currentRound?: number;
  /** Último evento recebido, inclusive quando uma trava impede a reprodução. */
  lastEventAt?: string | null;
  lastEventName?: string | null;
  /** Último som que efetivamente começou a tocar. */
  lastPlayedAt?: string | null;
  lastPlayedName?: string | null;
  /** Identifica recarga/recriação real da página do overlay. */
  pageLoadId?: string;
  pageLoadedAt?: string;
  navigationType?: string;
}

export interface AudioLogEntry {
  at: string;
  name: string;
  group: AudioGroup;
  result: 'carregado' | 'iniciou' | 'tocou' | 'encerrou' | 'barrado' | 'erro';
  detail?: string;
}

export interface OverlayTelemetry {
  /** O overlay roda uma versão antiga do código (precisa ser recarregado). */
  outdated?: boolean;
  fps: number;
  memoryMb: number | null;
  audio: AudioDiagnostics;
  reportedAt: string;
}

export interface DiagnosticLog {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  details: string | null;
}

export interface SystemDiagnostics {
  generatedAt: string;
  engine: {
    eventsReceived: number;
    eventsAccepted: number;
    eventsDiscarded: number;
    discardReasons: Record<string, number>;
    eventsBySource: Record<string, number>;
    audioCues: number;
    gameTicks: number;
    gameRecoveries: number;
    lastGameTickMs: number;
    maxGameTickMs: number;
  };
  server: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    websocketClients: number;
    overlayConnections: number;
  };
  overlay: OverlayTelemetry | null;
  errors: DiagnosticLog[];
}
