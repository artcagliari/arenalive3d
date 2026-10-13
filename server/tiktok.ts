import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { ConnectorGift, RaceGift } from '../src/types.js';
import type { ArenaEngine } from './engine.js';
import { validateGiftRegistry } from './gift-registry.js';
import { candidateFromGift } from './scoring.js';
import type { Store } from './store.js';

/**
 * Listener de eventos do TikTok LIVE.
 *
 * Usa `tiktok-live-connector` (NÃO OFICIAL: engenharia reversa do WebSocket web do TikTok, com assinatura
 * por serviço de terceiros). Pode parar de funcionar a qualquer mudança da plataforma.
 * Campos conforme o schema `tiktok-live-proto/v3` da versão instalada (2.5.0):
 *   gift: giftId (string), repeatCount, repeatEnd, groupId, gift{id,name,type,combo,diamondCount}, user{id,nickname,displayId}, common{msgId,createTime,roomId}
 *   chat: content, user{displayId}; like: count, total.
 * Também aceita os nomes do formato anterior (giftDetails, uniqueId, comment) por tolerância.
 */

export interface LiveConnection {
  connect(): Promise<{ roomId?: string }>;
  disconnect(): Promise<void>;
  on(event: string, listener: (data?: any) => void): unknown;
  removeAllListeners?(): unknown;
  fetchAvailableGifts?(): Promise<unknown>;
}

export interface ListenerOptions {
  connectionFactory?: (username: string) => Promise<LiveConnection> | LiveConnection;
  /** Atraso base e teto das reconexões quando há erro. */
  errorRetryMs?: { base: number; max: number };
  /** Atraso base e teto quando a LIVE está offline. */
  offlineRetryMs?: { base: number; max: number };
  /** Espera mínima para tentar de novo depois que o TikTok encerrou a LIVE. */
  endedRetryMs?: number;
  /** Sem repeatEnd por este tempo, o combo é encerrado com a última contagem. */
  streakFlushMs?: number;
  leaseTtlMs?: number;
  leaseRetryMs?: number;
  owner?: string;
  now?: () => number;
}

export interface CatalogGift { id: string; name: string; diamonds: number | null }

export interface NormalizedGift {
  giftId: string; giftName: string | null; giftType: number | null; streakable: boolean;
  diamonds: number | null; repeatCount: number; repeatEnd: boolean; groupId: string | null; sender: string; senderKey: string;
  msgId: string | null; roomId: string | null; createTime: string | null;
}

/** Remove segredos prováveis de qualquer texto que vá para log ou painel. */
export function redact(text: unknown): string {
  return String(text ?? '')
    .replace(/(sessionid|sessionid_ss|sid_tt|ttwid|tt-target-idc|msToken|x-tt-token|api[_-]?key|authorization|cookie|token|secret|password)(["']?\s*[:=]\s*)[^\s,;&"']+/gi, '$1$2[REDIGIDO]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDIGIDO]')
    .slice(0, 240);
}

/** O evento `error` do conector entrega `{ info, exception }`; as exceções comuns têm `message`. */
export function describeError(error: unknown): string {
  const e = error as any;
  const parts = [e?.exception?.message, e?.message, typeof e?.info === 'string' ? e.info : null,
    typeof error === 'string' ? error : null].filter((part, index, all) => part && all.indexOf(part) === index);
  return redact(parts.join(' — ') || 'erro desconhecido');
}

const clean = (value: unknown, max = 60) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const text = (value: unknown): string | null => { const out = clean(value, 120); return out && out !== '0' ? out : null; };

export function senderOf(user: any): { name: string; key: string } {
  const name = clean(user?.uniqueId ?? user?.displayId ?? user?.nickname) || 'usuario';
  return { name, key: clean(user?.id ?? user?.userId ?? user?.secUid ?? name, 80) };
}

export function normalizeGift(data: any): NormalizedGift | null {
  const giftId = text(data?.giftId ?? data?.gift?.id);
  if (!giftId) return null;
  const details = data?.giftDetails ?? data?.gift ?? {};
  const rawType = details.giftType ?? details.type;
  const giftType = typeof rawType === 'number' ? rawType : null;
  const sender = senderOf(data?.user);
  const repeatCount = Math.max(1, Math.min(10_000, Math.trunc(Number(data?.repeatCount ?? data?.comboCount ?? 1)) || 1));
  return {
    giftId,
    giftName: text(details.giftName ?? details.name ?? data?.extendedGiftInfo?.name),
    giftType,
    diamonds: (() => { const n = Number(details.diamondCount ?? details.diamond_count ?? data?.extendedGiftInfo?.diamond_count); return Number.isFinite(n) && n > 0 ? n : null; })(),
    // Regra documentada pelo conector: presentes giftType 1 chegam em sequência e fecham com repeatEnd.
    streakable: giftType === 1 || details.combo === true,
    repeatCount,
    repeatEnd: Boolean(data?.repeatEnd),
    groupId: text(data?.groupId),
    sender: sender.name,
    senderKey: sender.key,
    msgId: text(data?.common?.msgId ?? data?.msgId ?? data?.messageId),
    roomId: text(data?.common?.roomId ?? data?.roomId),
    createTime: text(data?.common?.createTime ?? data?.createTime)
  };
}

const normalizeName = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function catalogFrom(payload: unknown): CatalogGift[] {
  const list: any[] = Array.isArray(payload) ? payload
    : Array.isArray((payload as any)?.gifts) ? (payload as any).gifts
    : Array.isArray((payload as any)?.data?.gifts) ? (payload as any).data.gifts : [];
  const out: CatalogGift[] = [];
  for (const item of list) {
    const id = text(item?.id ?? item?.giftId), name = text(item?.name ?? item?.giftName);
    if (!id || !name) continue;
    const diamonds = Number(item?.diamond_count ?? item?.diamondCount);
    out.push({ id, name, diamonds: Number.isFinite(diamonds) ? diamonds : null });
  }
  return out;
}

/** Sugestão só quando o nome é idêntico (sem acento/caixa) a exatamente UM item do catálogo. Nunca é aplicada sozinha. */
export function suggestGiftIds(registry: RaceGift[], catalog: CatalogGift[]) {
  return registry.map(gift => {
    const matches = catalog.filter(item => normalizeName(item.name) === normalizeName(gift.name));
    return { registryId: gift.id, name: gift.name, side: gift.side, currentGiftId: gift.tiktokGiftId,
      suggestedGiftId: matches.length === 1 ? matches[0].id : null, candidates: matches.length };
  });
}

export interface ObservedGift { giftId: string; name: string | null; diamonds: number | null }

/**
 * Associa presentes OBSERVADOS (id, nome e preço vindos de eventos reais do TikTok) aos cadastrados sem ID.
 * `exact` exige nome idêntico E preço igual; sem preço conhecido vira `name` (só nome, a confirmar).
 */
export function matchObservedGifts(registry: RaceGift[], observed: ObservedGift[]) {
  const out: Array<{ registryId: string; name: string; side: RaceGift['side']; giftId: string; basis: 'exact' | 'name' }> = [];
  for (const gift of registry) {
    if (gift.tiktokGiftId) continue;
    const cost = Number(gift.costLabel);
    const hits = observed.filter(item => item.name && normalizeName(item.name) === normalizeName(gift.name));
    const priced = hits.filter(item => item.diamonds != null && Number.isFinite(cost) && gift.costLabel !== '' && item.diamonds === cost);
    const ids = (list: ObservedGift[]) => [...new Set(list.map(item => item.giftId))];
    if (ids(priced).length === 1) out.push({ registryId: gift.id, name: gift.name, side: gift.side, giftId: ids(priced)[0], basis: 'exact' });
    else if (!priced.length && ids(hits).length === 1 && hits[0].diamonds == null) out.push({ registryId: gift.id, name: gift.name, side: gift.side, giftId: ids(hits)[0], basis: 'name' });
  }
  return out;
}

type Streak = { gift: NormalizedGift; timer: NodeJS.Timeout };

export class TikTokAdapter {
  private connection: LiveConnection | null = null;
  private generation = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private retries = 0;
  private stopped = true;
  private attempting = false;
  private hasLease = false;
  private roomId: string | null = null;
  private catalog: CatalogGift[] = [];
  private streaks = new Map<string, Streak>();
  private settled = new Map<string, { applied: number; until: number }>();
  private lastGift: ConnectorGift | null = null;
  private counters = { received: 0, applied: 0, pending: 0, ignored: 0, duplicates: 0 };
  readonly owner: string;
  private readonly opt: Required<Omit<ListenerOptions, 'connectionFactory' | 'owner'>> & Pick<ListenerOptions, 'connectionFactory'>;

  constructor(private engine: ArenaEngine, private store: Store, private username: string, options: ListenerOptions = {}) {
    this.owner = options.owner ?? `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.opt = {
      connectionFactory: options.connectionFactory,
      errorRetryMs: options.errorRetryMs ?? { base: 5_000, max: 120_000 },
      offlineRetryMs: options.offlineRetryMs ?? { base: 15_000, max: 120_000 },
      endedRetryMs: options.endedRetryMs ?? 60_000,
      streakFlushMs: options.streakFlushMs ?? 6_000,
      leaseTtlMs: options.leaseTtlMs ?? 45_000,
      leaseRetryMs: options.leaseRetryMs ?? 20_000,
      now: options.now ?? Date.now
    };
    this.username = username.replace(/^@/, '').trim();
  }

  get roomKey() { return this.username.toLowerCase(); }
  get currentUsername() { return this.username; }
  get running() { return !this.stopped; }

  getCatalog() { return [...this.catalog]; }

  snapshot() {
    return { username: this.username || null, running: !this.stopped, hasLease: this.hasLease, owner: this.owner,
      roomId: this.roomId, retries: this.retries, pendingStreaks: this.streaks.size, catalogSize: this.catalog.length,
      counters: { ...this.counters }, lastGift: this.lastGift };
  }

  /** Idempotente: chamar duas vezes não cria um segundo listener. */
  async start() {
    if (!this.username) {
      this.engine.setConnector('disabled', 'Defina TIKTOK_USERNAME para habilitar a integração', null);
      return;
    }
    if (!this.stopped) return;
    this.stopped = false;
    this.retries = 0;
    await this.attempt();
  }

  async stop(manual = true) {
    this.stopped = true;
    this.generation += 1;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.flushStreaks('encerramento do listener');
    await this.dropConnection();
    if (this.hasLease) this.store.releaseListenerLease(this.roomKey, this.owner);
    this.hasLease = false;
    this.roomId = null;
    this.engine.setConnectorInfo({ roomId: null });
    this.engine.setConnector('disconnected', manual ? 'Conector desligado manualmente' : 'Conector desligado', this.username);
  }

  private async dropConnection() {
    const connection = this.connection;
    this.connection = null;
    if (!connection) return;
    // 'error' sem ouvinte derrubaria o processo (EventEmitter): mantém um ouvinte inerte na conexão descartada.
    try { connection.removeAllListeners?.(); connection.on('error', () => undefined); } catch { /* ignorado */ }
    try { await connection.disconnect(); } catch { /* já desconectado */ }
  }

  private async attempt() {
    if (this.stopped || this.attempting) return;
    this.attempting = true;
    const generation = ++this.generation;
    try {
      if (!this.acquireLease()) {
        this.engine.setConnector('standby', 'Outro processo mantém o listener desta sala; aguardando', this.username);
        this.schedule(this.opt.leaseRetryMs);
        return;
      }
      this.engine.setConnector(this.retries ? 'reconnecting' : 'connecting', this.retries ? `Reconectando (tentativa ${this.retries + 1})` : 'Conectando…', this.username);
      await this.dropConnection();
      const connection = await (this.opt.connectionFactory ?? defaultFactory)(this.username);
      if (this.stopped || generation !== this.generation) { try { await connection.disconnect(); } catch { /* ignorado */ } return; }
      this.connection = connection;
      this.attachHandlers(connection, generation);
      const state = await connection.connect();
      if (this.stopped || generation !== this.generation) return;
      this.retries = 0;
      this.roomId = text(state?.roomId);
      this.engine.setConnectorInfo({ roomId: this.roomId });
      this.engine.setConnector('connected', `Conectado${this.roomId ? ` à sala ${this.roomId}` : ''}`, this.username);
      // O catálogo exige plano pago do serviço de assinatura; só tenta se TIKTOK_FETCH_CATALOG=true.
      if (process.env.TIKTOK_FETCH_CATALOG === 'true') void this.syncCatalog(connection, generation);
    } catch (error) {
      if (this.stopped || generation !== this.generation) return;
      this.failed(error);
    } finally {
      this.attempting = false;
    }
  }

  private acquireLease(): boolean {
    const ok = this.store.acquireListenerLease(this.roomKey, this.owner, this.opt.leaseTtlMs, this.opt.now());
    this.hasLease = ok;
    if (ok && !this.heartbeat) {
      this.heartbeat = setInterval(() => {
        if (this.stopped) return;
        const kept = this.store.acquireListenerLease(this.roomKey, this.owner, this.opt.leaseTtlMs, this.opt.now());
        if (!kept) void this.loseLease();
      }, Math.max(1_000, Math.floor(this.opt.leaseTtlMs / 3)));
      this.heartbeat.unref();
    }
    return ok;
  }

  private async loseLease() {
    this.hasLease = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.flushStreaks('lease perdido');
    this.generation += 1;
    await this.dropConnection();
    this.engine.setConnector('standby', 'Outro processo assumiu o listener desta sala', this.username);
    this.schedule(this.opt.leaseRetryMs);
  }

  private failed(error: unknown) {
    if (this.stopped || this.retryTimer) return;
    this.generation += 1;
    void this.dropConnection();
    const name = (error as any)?.name ?? (error as any)?.exception?.name ?? '';
    const message = describeError(error);
    // Sem Room ID a conta quase sempre não está em LIVE (a sala só existe durante a transmissão).
    const offline = name === 'UserOfflineError' || /offline|not live|isn't live|is not currently live|isn't online|retrieve room id/i.test(message);
    this.flushStreaks('conexão interrompida');
    const cfg = offline ? this.opt.offlineRetryMs : this.opt.errorRetryMs;
    const delay = Math.min(cfg.max, cfg.base * (2 ** Math.min(this.retries, 10)));
    this.retries += 1;
    this.engine.setConnector(offline ? 'offline' : 'error',
      `${offline ? 'LIVE offline (ou sala não localizada)' : `Falha no conector: ${message}`}. Nova tentativa em ${Math.round(delay / 1000)} s. A contagem real está suspensa.`, this.username);
    this.schedule(delay);
  }

  private schedule(delay: number) {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.attempt(); }, delay);
    this.retryTimer.unref();
  }

  private attachHandlers(connection: LiveConnection, generation: number) {
    const live = <T>(handler: (data: T) => void) => (data?: any) => {
      if (this.stopped || generation !== this.generation) return;
      try { handler(data); } catch (error) { this.store.log('error', 'Falha ao processar evento do TikTok', { error: redact(error) }); }
    };
    connection.on('chat', live((data: any) => {
      const comment = String(data?.content ?? data?.comment ?? '');
      if (!comment) return;
      const user = senderOf(data?.user);
      const id = text(data?.common?.msgId ?? data?.msgId ?? data?.messageId) ?? `${user.key}:${data?.common?.createTime ?? ''}:${comment}`;
      this.engine.receive({ source: 'tiktok', type: 'comment', externalId: `chat:${id}`, username: user.name, comment });
    }));
    connection.on('like', live((data: any) => {
      const user = senderOf(data?.user);
      const id = text(data?.common?.msgId ?? data?.msgId) ?? randomUUID();
      this.engine.receive({ source: 'tiktok', type: 'like', externalId: `like:${id}`, username: user.name, likes: Math.max(1, Number(data?.count ?? data?.likeCount ?? 1) || 1) });
    }));
    connection.on('gift', live((data: any) => this.handleGift(data)));
    connection.on('streamEnd', live(() => {
      this.flushStreaks('LIVE encerrada');
      this.engine.setConnector('offline', 'A LIVE foi encerrada pelo TikTok; aguardando nova transmissão', this.username);
      this.generation += 1;
      void this.dropConnection();
      this.schedule(this.opt.endedRetryMs);
    }));
    connection.on('disconnected', live(() => this.failed(new Error('Conexão interrompida'))));
    // O evento `error` do conector também reporta falhas pontuais (ex.: catálogo de presentes exige plano pago
    // no serviço de assinatura). Elas NÃO derrubam a conexão; quedas reais chegam por `disconnected`.
    connection.on('error', live((error: any) => this.store.log('warn', 'TikTok: aviso do conector', { error: describeError(error) })));
  }

  // ---- presentes -------------------------------------------------------------------------------------------

  private streakKey(gift: NormalizedGift) {
    return `${gift.senderKey}:${gift.groupId ?? 'sem-grupo'}:${gift.giftId}`;
  }

  handleGift(data: unknown) {
    const gift = normalizeGift(data);
    if (!gift) return;
    if (!gift.streakable) {
      const identity = gift.msgId ?? `${this.streakKey(gift)}:${gift.repeatCount}:${gift.createTime ?? ''}`;
      this.dispatch(gift, gift.repeatCount, `gift:msg:${identity}`);
      return;
    }
    const key = this.streakKey(gift);
    const pending = this.streaks.get(key);
    if (pending) clearTimeout(pending.timer);
    if (!gift.repeatEnd) {
      // Combo em andamento: só guarda; o poder é aplicado uma única vez no fechamento.
      const timer = setTimeout(() => this.settleStreak(key, 'combo sem fechamento'), this.opt.streakFlushMs);
      timer.unref();
      this.streaks.set(key, { gift, timer });
      return;
    }
    this.streaks.delete(key);
    this.apply(key, gift);
  }

  private settleStreak(key: string, why: string) {
    const pending = this.streaks.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.streaks.delete(key);
    this.store.log('info', `TikTok: combo fechado por tempo (${why})`, { giftId: pending.gift.giftId, repeatCount: pending.gift.repeatCount });
    this.apply(key, pending.gift);
  }

  private flushStreaks(why: string) {
    for (const key of [...this.streaks.keys()]) this.settleStreak(key, why);
  }

  /** Aplica só o que ainda não foi aplicado deste combo (repeatEnd tardio não duplica). */
  private apply(key: string, gift: NormalizedGift) {
    const now = this.opt.now();
    for (const [k, v] of this.settled) if (v.until < now) this.settled.delete(k);
    const previous = this.settled.get(key)?.applied ?? 0;
    const delta = gift.repeatCount - previous;
    if (delta <= 0) { this.counters.duplicates += 1; return; }
    this.settled.set(key, { applied: gift.repeatCount, until: now + 10 * 60_000 });
    this.dispatch(gift, delta, `gift:streak:${key}:${previous}-${gift.repeatCount}`);
  }

  private dispatch(gift: NormalizedGift, quantity: number, externalId: string) {
    const at = new Date(this.opt.now()).toISOString();
    this.counters.received += 1;
    let mapped = this.engine.findRaceGiftsByTikTokId(gift.giftId);
    if (!mapped.length) mapped = this.learnGiftId(gift);
    const legacy = candidateFromGift(gift.giftId, this.engine.getConfig());
    const roomId = gift.roomId ?? this.roomId;
    // `raw` guarda só campos de negócio: nada de cookies, tokens, avatares ou o objeto bruto do TikTok.
    const raw = { giftId: gift.giftId, giftName: gift.giftName, giftType: gift.giftType, repeatCount: quantity,
      repeatEnd: gift.repeatEnd, groupId: gift.groupId, sender: gift.sender, roomId, msgId: gift.msgId, createTime: gift.createTime };
    const result = this.engine.receive({ source: 'tiktok', type: 'gift', externalId, username: gift.sender, giftId: gift.giftId, repeatCount: quantity, raw });
    if (!result.accepted && result.reasonCode && result.reasonCode.startsWith('duplicado')) { this.counters.duplicates += 1; return; }

    let status: ConnectorGift['status'];
    if (!mapped.length && !legacy) status = 'pendente';
    else if (result.accepted) status = 'aplicado';
    else if (result.reasonCode === 'fora_da_rodada' || result.reasonCode === 'conector_indisponivel') status = 'fora_da_rodada';
    else status = 'descartado';

    const g = result.gift;
    this.store.addGiftLog({ at, roomId, giftId: gift.giftId, giftName: gift.giftName, giftType: gift.giftType, repeatCount: quantity,
      sender: gift.sender, groupId: gift.groupId, msgId: gift.msgId, status, registryId: g?.registryId ?? null, registryName: g?.name ?? mapped[0]?.name ?? null,
      runner: g?.runner ?? null, effect: g?.effect ?? null, detail: g?.detail ?? null, reason: result.accepted ? null : result.reason ?? null });
    if (status === 'aplicado') this.counters.applied += 1;
    else if (status === 'pendente') this.counters.pending += 1;
    else this.counters.ignored += 1;

    this.lastGift = { at, giftId: gift.giftId, giftName: gift.giftName ?? g?.name ?? null, repeatCount: quantity, sender: gift.sender,
      runner: g?.runner ?? null, power: g ? `${g.label}${g.detail ? ` (${g.detail})` : ''}` : null, status };
    this.store.log(status === 'pendente' ? 'warn' : 'info', `TikTok: presente ${status}`, {
      giftId: gift.giftId, giftName: gift.giftName, giftType: gift.giftType, repeatCount: quantity, sender: gift.sender,
      runner: g?.runner ?? null, power: g?.label ?? null, reason: result.reason ?? null });
    this.engine.setConnectorInfo({ lastGift: this.lastGift, unknownGifts: this.store.pendingGiftSummary().length, appliedGifts: this.counters.applied });
  }

  /**
   * Aprendizado automático: um presente real ainda sem ID cujo NOME e PREÇO (diamantes) são idênticos
   * aos de exatamente um presente cadastrado passa a usar esse ID. Sem preço conhecido, não associa.
   */
  private learnGiftId(gift: NormalizedGift): RaceGift[] {
    if (process.env.AUTO_LEARN_GIFT_IDS === 'false' || !gift.giftName || gift.diamonds == null) return [];
    const registry = this.store.raceGifts();
    const [match] = matchObservedGifts(registry, [{ giftId: gift.giftId, name: gift.giftName, diamonds: gift.diamonds }]).filter(item => item.basis === 'exact');
    if (!match) return [];
    const target = registry.find(item => item.id === match.registryId)!;
    const after = registry.map(item => item.id === target.id ? { ...item, tiktokGiftId: gift.giftId } : item);
    if (validateGiftRegistry(after).some(problem => problem.type !== 'custo_diferente' && problem.gifts.includes(target.id))) return [];
    const { imageUrl: _ignored, ...base } = target;
    this.store.saveGift({ ...base, tiktokGiftId: gift.giftId, note: `${base.note} ID ${gift.giftId} aprendido de evento real (nome e preço idênticos) em ${new Date().toISOString().slice(0, 10)}.`.trim() });
    this.store.log('info', 'TikTok: ID de presente associado automaticamente', { giftId: gift.giftId, giftName: gift.giftName, diamonds: gift.diamonds, registryId: target.id });
    this.engine.giftsChanged();
    return this.engine.findRaceGiftsByTikTokId(gift.giftId);
  }

  // ---- catálogo --------------------------------------------------------------------------------------------

  private async syncCatalog(connection: LiveConnection, generation: number) {
    if (!connection.fetchAvailableGifts) return;
    try {
      const payload = await connection.fetchAvailableGifts();
      if (generation !== this.generation) return;
      this.catalog = catalogFrom(payload);
      this.store.log('info', `TikTok: catálogo de presentes da sala com ${this.catalog.length} itens`);
    } catch (error) {
      this.store.log('warn', 'TikTok: catálogo de presentes indisponível', { error: describeError(error) });
    }
  }
}

async function defaultFactory(username: string): Promise<LiveConnection> {
  const { TikTokLiveConnection } = await import('tiktok-live-connector');
  return new TikTokLiveConnection(username, { processInitialData: false }) as unknown as LiveConnection;
}
