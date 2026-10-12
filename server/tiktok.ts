import { randomUUID } from 'node:crypto';
import type { ArenaEngine } from './engine.js';

type TikTokConnection = {
  connect(): Promise<{ roomId?: string }>;
  disconnect(): Promise<void>;
  on(event: string, listener: (data?: any) => void): void;
};

export class TikTokAdapter {
  private connection: TikTokConnection | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retries = 0;
  private stopped = true;
  private streamEnded = false;

  constructor(private engine: ArenaEngine, private username: string) {}

  async start() {
    if (!this.username) {
      this.engine.setConnector('disabled', 'Defina TIKTOK_USERNAME para habilitar a integração', null);
      return;
    }
    this.stopped = false;
    this.streamEnded = false;
    await this.connect();
  }

  async stop(manual = true) {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try { await this.connection?.disconnect(); } catch { /* já desconectado */ }
    this.connection = null;
    this.engine.setConnector('disconnected', manual ? 'Conector desligado manualmente' : 'Conector desligado', this.username);
  }

  private async connect() {
    if (this.stopped || this.streamEnded) return;
    this.engine.setConnector(this.retries ? 'reconnecting' : 'connecting', this.retries ? `Reconectando (tentativa ${this.retries + 1})` : 'Conectando…', this.username);
    try {
      const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
      const connection = new TikTokLiveConnection(this.username, { processInitialData: false }) as unknown as TikTokConnection;
      this.connection = connection;
      connection.on(WebcastEvent.CHAT, (data: any) => {
        const externalId = `chat:${data.msgId ?? data.messageId ?? randomUUID()}`;
        this.engine.receive({ source: 'tiktok', type: 'comment', externalId, username: data.user?.uniqueId ?? 'usuario', comment: data.comment, raw: data });
      });
      connection.on(WebcastEvent.GIFT, (data: any) => {
        if (data.gift?.streakable && !data.repeatEnd) return;
        const externalId = `gift:${data.msgId ?? data.messageId ?? `${data.user?.userId}:${data.giftId}:${data.repeatCount}`}`;
        this.engine.receive({ source: 'tiktok', type: 'gift', externalId, username: data.user?.uniqueId ?? 'usuario', giftId: data.giftId, repeatCount: data.repeatCount, raw: data });
      });
      connection.on(WebcastEvent.LIKE, (data: any) => {
        const externalId = `like:${data.msgId ?? data.messageId ?? randomUUID()}`;
        this.engine.receive({ source: 'tiktok', type: 'like', externalId, username: data.user?.uniqueId ?? 'usuario', likes: data.likeCount ?? 1, raw: data });
      });
      connection.on(WebcastEvent.STREAM_END, () => {
        this.streamEnded = true;
        this.engine.setConnector('ended', 'A LIVE foi encerrada pelo TikTok; reconexão automática bloqueada', this.username);
      });
      connection.on(ControlEvent.DISCONNECTED, () => {
        if (!this.stopped && !this.streamEnded) this.scheduleReconnect('Conexão interrompida');
      });
      connection.on(ControlEvent.ERROR, (error: any) => {
        this.engine.setConnector('error', `Falha no conector: ${error?.message ?? String(error)}`, this.username);
        this.scheduleReconnect(error?.message ?? String(error));
      });
      const state = await connection.connect();
      this.retries = 0;
      this.engine.setConnector('connected', `Conectado à sala ${state.roomId ?? ''}`.trim(), this.username);
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : String(error));
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.stopped || this.streamEnded || this.retryTimer) return;
    this.engine.setConnector('disconnected', `Sem conexão: ${reason}. A contagem real está suspensa.`, this.username);
    const delay = Math.min(60_000, 2_000 * (2 ** this.retries++));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    this.retryTimer.unref();
  }
}
