import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { ArenaConfig, AudioAsset, DiagnosticLog, GiftEffect, PublicEvent, RaceGift, RoundSummary } from '../src/types.js';

export const DEFAULT_CONFIG: ArenaConfig = {
  autoMode: true,
  roundDurationSec: 120,
  openingDurationSec: 5,
  resultsDurationSec: 10,
  intermissionDurationSec: 6,
  lulaKeyword: '13',
  bolsonaroKeyword: '22',
  lulaGiftId: '',
  bolsonaroGiftId: '',
  commentPoints: 1,
  lulaGiftPoints: 10,
  bolsonaroGiftPoints: 10,
  likesGoal: 1000,
  soundEnabled: true,
  reducedMotion: false,
  staleEventThresholdSec: 120,
  gameMode: 'race',
  gameDifficulty: 3,
  cameraMode: 'dynamic',
  musicVolume: 35,
  effectsVolume: 70,
  animationIntensity: 85,
  audioMode: 'arena',
  maxConcurrentSounds: 3,
  minCatchphraseIntervalSec: 1,
  lulaCharacterAsset: '/characters/lula-stylized.png',
  bolsonaroCharacterAsset: '/characters/bolsonaro-stylized.png',
  characterAssetVersion: 1,
  raceDistanceM: 400,
  raceDurationSec: 120,
  raceEventFrequency: 3,
  commentBoost: 18,
  giftBoost: 100,
  lulaCommandLabel: '13 PARA CORRER',
  bolsonaroCommandLabel: '22 PARA CORRER',
  runnerStyle: 'cartoon',
  powerShortcuts: { impulso: 'COMENTE {n}', arrancada: 'AUTOMÁTICO', turbo: 'PRESENTE', escudo: 'AUTOMÁTICO', tropeco: 'AUTOMÁTICO' },
  musicEnabled: false,
  categoryVolumes: { corrida: 70, bordoes: 90, memes: 80, torcida: 55, resultado: 75 },
  audioSafeMode: true,
  effectRepeatMs: 400,
  dynamicMixingEnabled:true,
  maxCatchphraseDurationSec:3,
  channelPriorities:{music:10,voice:60,sfx:40,priority:100}
};

export interface GiftLogEntry {
  id?: number; at: string; roomId?: string | null; giftId: string; giftName?: string | null; giftType?: number | null;
  repeatCount: number; sender?: string | null; groupId?: string | null; msgId?: string | null;
  status: 'aplicado' | 'pendente' | 'fora_da_rodada' | 'descartado';
  registryId?: string | null; registryName?: string | null; runner?: string | null; effect?: string | null;
  detail?: string | null; reason?: string | null;
}

export class Store {
  private db: Database.Database;
  /** Mesma pasta usada pelo servidor para guardar os uploads de áudio. */
  private audioDir: string;
  /** Pasta das imagens de presentes enviadas pelo operador. */
  readonly giftDir: string;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.audioDir = path.join(path.dirname(filename), 'audio');
    this.giftDir = path.join(path.dirname(filename), 'gifts');
    fs.mkdirSync(this.giftDir, { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, round_number INTEGER NOT NULL, started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL, lula_points INTEGER NOT NULL, bolsonaro_points INTEGER NOT NULL,
        lula_interactions INTEGER NOT NULL, bolsonaro_interactions INTEGER NOT NULL, winner TEXT NOT NULL,
        game_mode TEXT, lula_energy REAL, bolsonaro_energy REAL, lula_progress REAL, bolsonaro_progress REAL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT UNIQUE, at TEXT NOT NULL, source TEXT NOT NULL,
        type TEXT NOT NULL, candidate TEXT, points INTEGER, username TEXT, summary TEXT NOT NULL, payload TEXT
      );
      CREATE INDEX IF NOT EXISTS events_at_idx ON events(at DESC);
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, details TEXT
      );
      CREATE TABLE IF NOT EXISTS audio_assets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, trigger_name TEXT NOT NULL,
        candidate TEXT, source_type TEXT NOT NULL, file_name TEXT, mime_type TEXT, synth_preset TEXT,
        volume INTEGER NOT NULL DEFAULT 80, enabled INTEGER NOT NULL DEFAULT 1,
        max_frequency_sec INTEGER NOT NULL DEFAULT 8, play_mode TEXT NOT NULL DEFAULT 'random',
        is_satire INTEGER NOT NULL DEFAULT 0, license_note TEXT NOT NULL DEFAULT '',
        animation TEXT NOT NULL DEFAULT 'none', priority INTEGER NOT NULL DEFAULT 50,
        duration_sec REAL, created_at TEXT NOT NULL
      );
    `);
    const roundColumns = new Set((this.db.prepare('PRAGMA table_info(rounds)').all() as Array<{ name: string }>).map(column => column.name));
    const additions: Array<[string, string]> = [
      ['game_mode', 'TEXT'], ['lula_energy', 'REAL'], ['bolsonaro_energy', 'REAL'],
      ['lula_progress', 'REAL'], ['bolsonaro_progress', 'REAL']
    ];
    for (const [name, type] of additions) {
      if (!roundColumns.has(name)) this.db.exec(`ALTER TABLE rounds ADD COLUMN ${name} ${type}`);
    }
    const audioColumns = new Set((this.db.prepare('PRAGMA table_info(audio_assets)').all() as Array<{ name:string }>).map(column => column.name));
    if (!audioColumns.has('duration_sec')) this.db.exec('ALTER TABLE audio_assets ADD COLUMN duration_sec REAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS race_gifts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, tiktok_gift_id TEXT, side TEXT NOT NULL, effect TEXT NOT NULL,
        target TEXT NOT NULL, label TEXT NOT NULL, cost_label TEXT NOT NULL DEFAULT '', intensity REAL NOT NULL DEFAULT 1,
        duration_sec REAL NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 10, enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0, image_file TEXT, confirmed INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tiktok_gift_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, room_id TEXT, gift_id TEXT NOT NULL, gift_name TEXT,
        gift_type INTEGER, repeat_count INTEGER NOT NULL DEFAULT 1, sender TEXT, group_id TEXT, msg_id TEXT,
        status TEXT NOT NULL, registry_id TEXT, registry_name TEXT, runner TEXT, effect TEXT, detail TEXT, reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tiktok_gift_log_gift ON tiktok_gift_log(gift_id);
      CREATE TABLE IF NOT EXISTS listener_lease (
        room_key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
    `);
    this.seedAudioLibrary();
    this.seedGifts();
    this.applyStage614Defaults();
    this.applyStage6143Defaults();
  }

  /** Executa `apply` uma única vez por chave, registrando a marca em `settings`. */
  applyOnce(key: string, apply: (current: ArenaConfig) => ArenaConfig): boolean {
    if (this.db.prepare('SELECT 1 FROM settings WHERE key=?').get(key)) return false;
    this.saveConfig(apply(this.getConfig()));
    this.db.prepare("INSERT INTO settings(key,value) VALUES(?,'applied')").run(key);
    return true;
  }

  /** Troca os nomes de personagem pelos números nos nomes das vagas de bordão (idempotente). */
  renameBuiltinAudioSlots() {
    this.db.prepare(`UPDATE audio_assets SET name = REPLACE(REPLACE(name, 'de Lula', 'do 13'), 'de Bolsonaro', 'do 22')
      WHERE id LIKE 'slot-lula-%' OR id LIKE 'slot-bolsonaro-%'`).run();
  }

  /** Migração única: ativa o ciclo local e unifica cronômetro e motor. */
  private applyStage614Defaults() {
    if (this.db.prepare("SELECT 1 FROM settings WHERE key='stage_6_14_defaults'").get()) return;
    const current = this.getConfig();
    const duration = Math.max(120, current.roundDurationSec || 0, current.raceDurationSec || 0);
    this.saveConfig({ ...current, autoMode:true, gameMode:'race', openingDurationSec:5,
      resultsDurationSec:10, roundDurationSec:duration, raceDurationSec:duration });
    this.db.prepare("INSERT INTO settings(key,value) VALUES('stage_6_14_defaults','applied')").run();
  }

  /** Migração única dos limites seguros da mixagem dinâmica. */
  private applyStage6143Defaults(){
    if(this.db.prepare("SELECT 1 FROM settings WHERE key='stage_6_14_3_defaults'").get())return;
    const current=this.getConfig();
    this.saveConfig({...current,dynamicMixingEnabled:true,maxCatchphraseDurationSec:3,maxConcurrentSounds:3,
      minCatchphraseIntervalSec:current.minCatchphraseIntervalSec===12?1:current.minCatchphraseIntervalSec,
      channelPriorities:{music:10,voice:60,sfx:40,priority:100}});
    this.db.prepare("INSERT INTO settings(key,value) VALUES('stage_6_14_3_defaults','applied')").run();
  }

  /**
   * Presentes do infográfico neon enviado pelo operador: 10 pares de mesmo
   * valor, um presente diferente em cada coluna. Nomes e preços conferem com
   * as capturas do painel de presentes do TikTok; os ícones são recortes do
   * infográfico. IDs do TikTok ficam vazios até o operador informar.
   *
   * Migração: troca apenas conjuntos anteriores que ninguém tocou (os 10
   * provisórios ou a cartela de 22, sem ID e sem imagem enviada). Nada que o
   * operador editou é apagado.
   */
  private seedGifts() {
    const rows = this.db.prepare('SELECT id, tiktok_gift_id AS tiktokGiftId, image_file AS imageFile FROM race_gifts').all() as Array<{ id:string; tiktokGiftId:string|null; imageFile:string|null }>;
    const previousSeed = /^gift-(lula|bolsonaro)-([1-5]|rosa|coracao|maos-de-coracao|donut|galaxia|leao|carro-esportivo|foguete|coroa|universo|confete)$/;
    const untouched = rows.length > 0 && rows.every(row => previousSeed.test(row.id) && !row.tiktokGiftId && (!row.imageFile || row.imageFile.startsWith('bundled:')));
    if (rows.length > 0 && !untouched) return;
    const now = new Date().toISOString();
    const note = 'Do infográfico neon do operador (nome e preço conferem com o painel de presentes do TikTok). Ícone recortado do infográfico, não é a imagem oficial. Falta o ID do TikTok.';
    // [efeito, texto, intensidade, duração em s] — a coluna do meio do infográfico
    const effects: Array<[GiftEffect, string, number, number]> = [
      ['impulso', 'IMPULSO', 1.2, 2],
      ['impulso', 'ACELERAÇÃO LEVE', 0.7, 1.5],
      ['arrancada', 'SUPER IMPULSO', 1.3, 2.5],
      ['turbo', 'TURBO', 1, 3],
      ['escudo', 'ESCUDO', 1, 8],
      ['recuperacao', 'RECUPERAÇÃO', 1.5, 2],
      ['turbo', 'ULTRA TURBO', 3, 4],
      ['turbo', 'SUPER TURBO', 2, 8],
      ['aleatorio', 'EFEITO ALEATÓRIO', 2.2, 5],
      ['especial', 'PODER ESPECIAL', 3, 8]
    ];
    const coins = [1, 1, 10, 30, 99, 149, 199, 299, 399, 500];
    const pairs: Array<[lulaSlug:string, lulaName:string, bolsonaroSlug:string, bolsonaroName:string]> = [
      ['rose', 'Rose', 'rosa-branca', 'Rosa branca'],
      ['heart-me', 'Heart Me', 'palmas', 'Palmas'],
      ['rosa', 'Rosa', 'mini-dino', 'Mini dino'],
      ['rosquinha', 'Rosquinha', 'capybara', 'Capybara'],
      ['chapeu-e-bigode', 'Chapéu e Bigode', 'grou-de-papel', 'Grou de papel'],
      ['ney-mistico', 'Ney místico', 'clarinete-do-groove', 'Clarinete do groove'],
      ['coroa', 'Coroa', 'coqueiro', 'Coqueiro'],
      ['luvas-de-boxe', 'Luvas de boxe', 'corgi', 'Corgi'],
      ['danca-do-cacto', 'Dança do Cacto', 'boa-noite', 'Boa noite'],
      ['pistola-de-dinheiro', 'Pistola de dinheiro', 'voce-e-demais', 'Você é demais']
    ];
    const transaction = this.db.transaction(() => {
      if (untouched) this.db.prepare('DELETE FROM race_gifts').run();
      pairs.forEach(([lulaSlug, lulaName, bolsonaroSlug, bolsonaroName], index) => {
        const [effect, label, intensity, durationSec] = effects[index];
        for (const [side, slug, name] of [['lula', lulaSlug, lulaName], ['bolsonaro', bolsonaroSlug, bolsonaroName]] as const) {
          this.saveGift({
            id:`gift-${side}-${slug}`, name, tiktokGiftId:null, side, effect, target:'own', label,
            costLabel:String(coins[index]), intensity, durationSec, points:coins[index], enabled:true, order:index + 1,
            imageFile:`bundled:${slug}.png`, confirmed:true, note, createdAt:now
          });
        }
      });
    });
    transaction();
  }

  raceGifts(): RaceGift[] {
    const rows = this.db.prepare(`SELECT id,name,tiktok_gift_id AS tiktokGiftId,side,effect,target,label,cost_label AS costLabel,
      intensity,duration_sec AS durationSec,points,enabled,sort_order AS "order",image_file AS imageFile,confirmed,note,created_at AS createdAt
      FROM race_gifts ORDER BY side,sort_order,created_at`).all() as Array<Omit<RaceGift,'enabled'|'confirmed'> & { enabled:number; confirmed:number }>;
    return rows.map(row => {
      // `bundled:arquivo.png` = ícone que acompanha o projeto (public/presentes); senão, upload do operador.
      if (row.imageFile?.startsWith('bundled:')) {
        return { ...row, enabled:Boolean(row.enabled), confirmed:Boolean(row.confirmed), imageUrl:`/presentes/${path.basename(row.imageFile.slice(8))}` };
      }
      const present = Boolean(row.imageFile) && fs.existsSync(path.join(this.giftDir, path.basename(row.imageFile!)));
      return { ...row, enabled:Boolean(row.enabled), confirmed:Boolean(row.confirmed), imageUrl: present ? `/api/gift-files/${path.basename(row.imageFile!)}` : null };
    });
  }

  raceGift(id: string): RaceGift | null {
    return this.raceGifts().find(gift => gift.id === id) ?? null;
  }

  saveGift(gift: Omit<RaceGift, 'imageUrl'>) {
    this.db.prepare(`INSERT INTO race_gifts(id,name,tiktok_gift_id,side,effect,target,label,cost_label,intensity,duration_sec,points,enabled,sort_order,image_file,confirmed,note,created_at)
      VALUES(@id,@name,@tiktokGiftId,@side,@effect,@target,@label,@costLabel,@intensity,@durationSec,@points,@enabled,@order,@imageFile,@confirmed,@note,@createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,tiktok_gift_id=excluded.tiktok_gift_id,side=excluded.side,effect=excluded.effect,
      target=excluded.target,label=excluded.label,cost_label=excluded.cost_label,intensity=excluded.intensity,duration_sec=excluded.duration_sec,
      points=excluded.points,enabled=excluded.enabled,sort_order=excluded.sort_order,image_file=excluded.image_file,confirmed=excluded.confirmed,note=excluded.note`)
      .run({ ...gift, tiktokGiftId: gift.tiktokGiftId || null, enabled: gift.enabled ? 1 : 0, confirmed: gift.confirmed ? 1 : 0 });
  }

  deleteGift(id: string): string | null | undefined {
    const row = this.db.prepare('SELECT image_file AS imageFile FROM race_gifts WHERE id=?').get(id) as { imageFile: string | null } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM race_gifts WHERE id=?').run(id);
    return row.imageFile;
  }

  private seedAudioLibrary() {
    const existing = new Set((this.db.prepare('SELECT id FROM audio_assets').all() as Array<{ id: string }>).map(row => row.id));
    const now = new Date().toISOString();
    const builtins: Array<Omit<AudioAsset, 'createdAt' | 'url'>> = [
      { id:'builtin-round-start', name:'Sirene de abertura', category:'alert', trigger:'round_start', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'fanfare', volume:78, enabled:true, maxFrequencySec:3, playMode:'sequential', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'camera_flash', priority:95 },
      { id:'builtin-impact', name:'Impacto de energia', category:'hit', trigger:'impact', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'impact', volume:72, enabled:true, maxFrequencySec:1, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'impact_burst', priority:45 },
      { id:'builtin-special', name:'Golpe especial', category:'hit', trigger:'special', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'special', volume:86, enabled:true, maxFrequencySec:3, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'special_burst', priority:80 },
      { id:'builtin-defense', name:'Escudo ativado', category:'defense', trigger:'defense', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'shield', volume:65, enabled:true, maxFrequencySec:2, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'shield', priority:50 },
      { id:'builtin-dodge', name:'Esquiva veloz', category:'defense', trigger:'dodge', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'dodge', volume:64, enabled:true, maxFrequencySec:2, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'speed_lines', priority:48 },
      { id:'builtin-gift', name:'Presente especial', category:'gift', trigger:'gift_received', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'gift', volume:80, enabled:true, maxFrequencySec:2, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'gift_glow', priority:85 },
      { id:'builtin-crowd', name:'Torcida da arena', category:'crowd', trigger:'combo', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'crowd', volume:55, enabled:true, maxFrequencySec:10, playMode:'random', isSatire:false, licenseNote:'Ruído de torcida procedural original, sem vozes identificáveis.', animation:'crowd_lights', priority:55 },
      { id:'builtin-scene', name:'Transição de cenário', category:'alert', trigger:'scene_change', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'transition', volume:70, enabled:true, maxFrequencySec:4, playMode:'sequential', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'scene_wipe', priority:75 },
      { id:'builtin-victory', name:'Vitória na arena', category:'result', trigger:'victory', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'victory', volume:82, enabled:true, maxFrequencySec:5, playMode:'sequential', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'victory_lights', priority:100 },
      { id:'builtin-race-start', name:'Tiro de largada', category:'alert', trigger:'race_start', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'whistle', volume:84, enabled:true, maxFrequencySec:3, playMode:'sequential', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'camera_flash', priority:98 },
      { id:'builtin-boost', name:'Impulso da torcida', category:'gift', trigger:'boost', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'boost', volume:70, enabled:true, maxFrequencySec:1, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'speed_lines', priority:52 },
      { id:'builtin-stumble', name:'Tropeço na pista', category:'hit', trigger:'stumble', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'stumble', volume:74, enabled:true, maxFrequencySec:2, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'impact_burst', priority:62 },
      { id:'builtin-overtake', name:'Ultrapassagem', category:'crowd', trigger:'overtake', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'overtake', volume:76, enabled:true, maxFrequencySec:3, playMode:'random', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'speed_lines', priority:72 },
      { id:'builtin-final-sprint', name:'Reta final', category:'crowd', trigger:'final_sprint', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'crowd', volume:72, enabled:true, maxFrequencySec:8, playMode:'sequential', isSatire:false, licenseNote:'Ruído de torcida procedural original, sem vozes identificáveis.', animation:'crowd_lights', priority:86 },
      // Vagas de bordão: ficam sem arquivo e desativadas até o operador enviar
      // um áudio próprio. Nenhum som é inventado e nada entra no overlay vazio.
      { id:'slot-lula-largada', name:'Bordão do 13 na largada', category:'lula_catchphrase', trigger:'race_start', candidate:'lula', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:80, enabled:false, maxFrequencySec:20, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'camera_flash', priority:70 },
      { id:'slot-lula-impulso', name:'Bordão do 13 no impulso', category:'lula_catchphrase', trigger:'boost', candidate:'lula', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:80, enabled:false, maxFrequencySec:15, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'speed_lines', priority:68 },
      { id:'slot-lula-vitoria', name:'Bordão do 13 na vitória', category:'lula_catchphrase', trigger:'victory', candidate:'lula', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:84, enabled:false, maxFrequencySec:10, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'victory_lights', priority:99 },
      { id:'slot-lula-ultrapassagem', name:'Bordão do 13 na ultrapassagem', category:'lula_catchphrase', trigger:'overtake', candidate:'lula', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:80, enabled:false, maxFrequencySec:15, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'speed_lines', priority:74 },
      { id:'slot-lula-meme', name:'Meme satírico do 13', category:'lula_catchphrase', trigger:'stumble', candidate:'lula', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:76, enabled:false, maxFrequencySec:20, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'impact_burst', priority:64 },
      { id:'slot-bolsonaro-largada', name:'Bordão do 22 na largada', category:'bolsonaro_catchphrase', trigger:'race_start', candidate:'bolsonaro', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:80, enabled:false, maxFrequencySec:20, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'camera_flash', priority:70 },
      { id:'slot-bolsonaro-impulso', name:'Bordão do 22 no impulso', category:'bolsonaro_catchphrase', trigger:'boost', candidate:'bolsonaro', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:80, enabled:false, maxFrequencySec:15, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'speed_lines', priority:68 },
      { id:'slot-bolsonaro-vitoria', name:'Bordão do 22 na vitória', category:'bolsonaro_catchphrase', trigger:'victory', candidate:'bolsonaro', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:84, enabled:false, maxFrequencySec:10, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'victory_lights', priority:99 },
      { id:'slot-bolsonaro-ultrapassagem', name:'Bordão do 22 na ultrapassagem', category:'bolsonaro_catchphrase', trigger:'overtake', candidate:'bolsonaro', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:80, enabled:false, maxFrequencySec:15, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'speed_lines', priority:74 },
      { id:'slot-bolsonaro-meme', name:'Meme satírico do 22', category:'bolsonaro_catchphrase', trigger:'stumble', candidate:'bolsonaro', sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:76, enabled:false, maxFrequencySec:20, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'impact_burst', priority:64 },
      { id:'slot-meme-ultrapassagem', name:'Provocação na ultrapassagem', category:'satire_meme', trigger:'overtake', candidate:null, sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:78, enabled:false, maxFrequencySec:18, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'speed_lines', priority:66 },
      { id:'slot-meme-tropeco', name:'Provocação no tropeço', category:'satire_meme', trigger:'stumble', candidate:null, sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:78, enabled:false, maxFrequencySec:18, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'impact_burst', priority:66 },
      { id:'slot-meme-turbo', name:'Provocação no turbo', category:'satire_meme', trigger:'special', candidate:null, sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:78, enabled:false, maxFrequencySec:18, playMode:'random', isSatire:true, licenseNote:'Vaga livre: envie gravação própria, paródia ou áudio licenciado.', animation:'special_burst', priority:66 },
      { id:'slot-musica', name:'Música de fundo', category:'music', trigger:'background_music', candidate:null, sourceType:'upload', fileName:null, mimeType:null, synthPreset:null, volume:60, enabled:false, maxFrequencySec:0, playMode:'random', isSatire:false, licenseNote:'Vaga livre: envie uma faixa própria ou licenciada. Toca em laço durante a corrida, se a trilha estiver ligada.', animation:'none', priority:10 },
      { id:'builtin-defeat', name:'Encerramento da rodada', category:'result', trigger:'defeat', candidate:null, sourceType:'synth', fileName:null, mimeType:null, synthPreset:'defeat', volume:55, enabled:true, maxFrequencySec:5, playMode:'sequential', isSatire:false, licenseNote:'Efeito procedural original do LIVE ARENA 3D.', animation:'lights_down', priority:90 }
    ];
    const insert = this.db.prepare(`INSERT INTO audio_assets(id,name,category,trigger_name,candidate,source_type,file_name,mime_type,synth_preset,volume,enabled,max_frequency_sec,play_mode,is_satire,license_note,animation,priority,created_at)
      VALUES(@id,@name,@category,@trigger,@candidate,@sourceType,@fileName,@mimeType,@synthPreset,@volume,@enabled,@maxFrequencySec,@playMode,@isSatire,@licenseNote,@animation,@priority,@createdAt)`);
    const missing = builtins.filter(item => !existing.has(item.id));
    if (!missing.length) return;
    const transaction = this.db.transaction(() => {
      for (const item of missing) insert.run({ ...item, enabled:item.enabled?1:0, isSatire:item.isSatire?1:0, createdAt:now });
    });
    transaction();
  }

  getConfig(): ArenaConfig {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'config'").get() as { value: string } | undefined;
    const saved = row ? JSON.parse(row.value) as Partial<ArenaConfig> : {};
    return {
      ...DEFAULT_CONFIG, ...saved,
      powerShortcuts: { ...DEFAULT_CONFIG.powerShortcuts, ...(saved.powerShortcuts ?? {}) },
      categoryVolumes: { ...DEFAULT_CONFIG.categoryVolumes, ...(saved.categoryVolumes ?? {}) }
    };
  }

  saveConfig(config: ArenaConfig) {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config));
  }

  getRuntime<T>(): T | null {
    const row = this.db.prepare('SELECT value FROM runtime WHERE id=1').get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : null;
  }

  saveRuntime(value: unknown) {
    this.db.prepare("INSERT INTO runtime(id,value,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
      .run(JSON.stringify(value), new Date().toISOString());
  }

  addEvent(event: PublicEvent, externalId?: string, payload?: unknown): boolean {
    try {
      this.db.prepare(`INSERT INTO events(external_id,at,source,type,candidate,points,username,summary,payload)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(externalId ?? null, event.at, event.source, event.type, event.candidate ?? null,
        event.points ?? null, event.username ?? null, event.summary, this.safeJson(payload));
      return true;
    } catch (error) {
      if (String(error).includes('UNIQUE')) return false;
      throw error;
    }
  }

  hasExternalEvent(externalId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM events WHERE external_id=? LIMIT 1').get(externalId));
  }

  recentEvents(limit = 100): PublicEvent[] {
    return this.db.prepare(`SELECT id, at, source, type, candidate, points, username, summary FROM events ORDER BY id DESC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 500)) as PublicEvent[];
  }

  /** Histórico de presentes REAIS recebidos do TikTok (simulações nunca entram aqui). */
  addGiftLog(entry: GiftLogEntry): number {
    const result = this.db.prepare(`INSERT INTO tiktok_gift_log(at,room_id,gift_id,gift_name,gift_type,repeat_count,sender,group_id,msg_id,status,registry_id,registry_name,runner,effect,detail,reason)
      VALUES(@at,@roomId,@giftId,@giftName,@giftType,@repeatCount,@sender,@groupId,@msgId,@status,@registryId,@registryName,@runner,@effect,@detail,@reason)`).run({
        roomId: null, giftName: null, giftType: null, sender: null, groupId: null, msgId: null, registryId: null,
        registryName: null, runner: null, effect: null, detail: null, reason: null, ...entry });
    this.db.prepare('DELETE FROM tiktok_gift_log WHERE id <= ?').run(Number(result.lastInsertRowid) - 2000);
    return Number(result.lastInsertRowid);
  }

  giftLog(limit = 100, onlyPending = false): GiftLogEntry[] {
    return this.db.prepare(`SELECT id,at,room_id AS roomId,gift_id AS giftId,gift_name AS giftName,gift_type AS giftType,repeat_count AS repeatCount,
      sender,group_id AS groupId,msg_id AS msgId,status,registry_id AS registryId,registry_name AS registryName,runner,effect,detail,reason
      FROM tiktok_gift_log ${onlyPending ? "WHERE status='pendente'" : ''} ORDER BY id DESC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 500)) as GiftLogEntry[];
  }

  /** Presentes pendentes agrupados por giftId (para o operador cadastrar o ID). */
  pendingGiftSummary(): Array<{ giftId: string; giftName: string | null; count: number; lastAt: string }> {
    return this.db.prepare(`SELECT gift_id AS giftId, MAX(gift_name) AS giftName, SUM(repeat_count) AS count, MAX(at) AS lastAt
      FROM tiktok_gift_log WHERE status='pendente' GROUP BY gift_id ORDER BY lastAt DESC LIMIT 100`).all() as any[];
  }

  /** Lease de um único listener por sala: o dono renova; outro processo só assume após expirar. */
  acquireListenerLease(roomKey: string, owner: string, ttlMs: number, now = Date.now()): boolean {
    const run = this.db.transaction(() => {
      const row = this.db.prepare('SELECT owner, expires_at AS expiresAt FROM listener_lease WHERE room_key=?').get(roomKey) as { owner: string; expiresAt: number } | undefined;
      if (row && row.owner !== owner && row.expiresAt > now) return false;
      this.db.prepare(`INSERT INTO listener_lease(room_key,owner,expires_at) VALUES(?,?,?)
        ON CONFLICT(room_key) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at`).run(roomKey, owner, now + ttlMs);
      return true;
    });
    return run();
  }

  releaseListenerLease(roomKey: string, owner: string) {
    this.db.prepare('DELETE FROM listener_lease WHERE room_key=? AND owner=?').run(roomKey, owner);
  }

  saveRound(round: Omit<RoundSummary, 'id'>) {
    this.db.prepare(`INSERT INTO rounds(round_number,started_at,ended_at,lula_points,bolsonaro_points,lula_interactions,bolsonaro_interactions,winner,
      game_mode,lula_energy,bolsonaro_energy,lula_progress,bolsonaro_progress)
      VALUES(@roundNumber,@startedAt,@endedAt,@lulaPoints,@bolsonaroPoints,@lulaInteractions,@bolsonaroInteractions,@winner,
      @gameMode,@lulaEnergy,@bolsonaroEnergy,@lulaProgress,@bolsonaroProgress)`).run({
        ...round,
        gameMode: round.gameMode ?? null,
        lulaEnergy: round.lulaEnergy ?? null,
        bolsonaroEnergy: round.bolsonaroEnergy ?? null,
        lulaProgress: round.lulaProgress ?? null,
        bolsonaroProgress: round.bolsonaroProgress ?? null
      });
  }

  rounds(limit = 50): RoundSummary[] {
    return this.db.prepare(`SELECT id, round_number AS roundNumber, started_at AS startedAt, ended_at AS endedAt,
      lula_points AS lulaPoints, bolsonaro_points AS bolsonaroPoints, lula_interactions AS lulaInteractions,
      bolsonaro_interactions AS bolsonaroInteractions, winner, game_mode AS gameMode,
      lula_energy AS lulaEnergy, bolsonaro_energy AS bolsonaroEnergy,
      lula_progress AS lulaProgress, bolsonaro_progress AS bolsonaroProgress
      FROM rounds ORDER BY id DESC LIMIT ?`).all(limit) as RoundSummary[];
  }

  log(level: 'info' | 'warn' | 'error', message: string, details?: unknown) {
    this.db.prepare('INSERT INTO logs(at,level,message,details) VALUES(?,?,?,?)')
      .run(new Date().toISOString(), level, message, details ? JSON.stringify(details) : null);
  }

  recentLogs(limit = 50, levels: Array<DiagnosticLog['level']> = ['warn', 'error']): DiagnosticLog[] {
    const safeLevels = levels.filter(level => ['info', 'warn', 'error'].includes(level));
    if (!safeLevels.length) return [];
    const placeholders = safeLevels.map(() => '?').join(',');
    return this.db.prepare(`SELECT id,at,level,message,details FROM logs WHERE level IN (${placeholders}) ORDER BY id DESC LIMIT ?`)
      .all(...safeLevels, Math.min(Math.max(limit, 1), 200)) as DiagnosticLog[];
  }

  audioAssets(enabledOnly = false): AudioAsset[] {
    const rows = this.db.prepare(`SELECT id,name,category,trigger_name AS trigger,candidate,source_type AS sourceType,
      file_name AS fileName,mime_type AS mimeType,synth_preset AS synthPreset,volume,enabled,
      max_frequency_sec AS maxFrequencySec,play_mode AS playMode,is_satire AS isSatire,
      license_note AS licenseNote,animation,priority,duration_sec AS durationSec,created_at AS createdAt
      FROM audio_assets ${enabledOnly ? 'WHERE enabled=1' : ''} ORDER BY category,name`).all() as Array<Omit<AudioAsset,'enabled'|'isSatire'> & { enabled:number; isSatire:number }>;
    return rows.map(row => {
      const pending = row.sourceType === 'upload' && !row.fileName;
      const fileMissing = row.sourceType === 'upload' && Boolean(row.fileName)
        && !fs.existsSync(path.join(this.audioDir, path.basename(row.fileName!)));
      return {
        ...row, enabled:Boolean(row.enabled), isSatire:Boolean(row.isSatire), pending, fileMissing,
        url: row.sourceType === 'upload' && row.fileName && !fileMissing ? `/api/audio/files/${row.id}` : undefined
      };
    });
  }

  /** Só entram na fila do overlay os áudios que existem de verdade. */
  playableAudioAssets(): AudioAsset[] {
    return this.audioAssets(true).filter(asset => asset.sourceType === 'synth' || (!asset.pending && !asset.fileMissing));
  }

  /** Associa (ou troca) o arquivo de uma vaga de bordão já cadastrada. */
  attachAudioFile(id: string, fileName: string, mimeType: string, durationSec: number | null = null): string | null {
    const previous = this.db.prepare('SELECT file_name AS fileName FROM audio_assets WHERE id=?').get(id) as { fileName:string|null } | undefined;
    if (!previous) return null;
    this.db.prepare("UPDATE audio_assets SET source_type='upload', file_name=?, mime_type=?, synth_preset=NULL, duration_sec=? WHERE id=?")
      .run(fileName, mimeType, durationSec, id);
    return previous.fileName;
  }

  deleteAudioAsset(id: string): string | null {
    const row = this.db.prepare('SELECT file_name AS fileName FROM audio_assets WHERE id=?').get(id) as { fileName:string|null } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM audio_assets WHERE id=?').run(id);
    return row.fileName;
  }

  audioAsset(id: string): AudioAsset | null {
    return this.audioAssets().find(asset => asset.id === id) ?? null;
  }

  saveAudioAsset(asset: AudioAsset) {
    this.db.prepare(`INSERT INTO audio_assets(id,name,category,trigger_name,candidate,source_type,file_name,mime_type,synth_preset,volume,enabled,max_frequency_sec,play_mode,is_satire,license_note,animation,priority,duration_sec,created_at)
      VALUES(@id,@name,@category,@trigger,@candidate,@sourceType,@fileName,@mimeType,@synthPreset,@volume,@enabled,@maxFrequencySec,@playMode,@isSatire,@licenseNote,@animation,@priority,@durationSec,@createdAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,trigger_name=excluded.trigger_name,
      candidate=excluded.candidate,volume=excluded.volume,enabled=excluded.enabled,max_frequency_sec=excluded.max_frequency_sec,
      play_mode=excluded.play_mode,is_satire=excluded.is_satire,license_note=excluded.license_note,
      animation=excluded.animation,priority=excluded.priority,duration_sec=excluded.duration_sec`).run({ ...asset, durationSec:asset.durationSec ?? null, enabled:asset.enabled?1:0, isSatire:asset.isSatire?1:0 });
  }

  close() { this.db.close(); }

  private safeJson(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    try {
      return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
    } catch {
      return JSON.stringify({ note: 'Payload não serializável; metadados essenciais preservados no evento.' });
    }
  }
}
