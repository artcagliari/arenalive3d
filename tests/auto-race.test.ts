import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { ArenaEngine } from '../server/engine.js';
import { validateGiftRegistry } from '../server/gift-registry.js';
import { Store } from '../server/store.js';
import { TikTokAdapter, type LiveConnection } from '../server/tiktok.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 8_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };

function rig(config: Record<string, unknown> = {}, prepare?: (store: Store) => void, options: ConstructorParameters<typeof ArenaEngine>[1] = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-auto-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  store.saveConfig({ ...store.getConfig(), autoMode: false, openingDurationSec: 1, raceDurationSec: 12, roundDurationSec: 12,
    resultsDurationSec: 1, intermissionDurationSec: 1, raceEventFrequency: 5, gameMode: 'race', ...config } as any);
  prepare?.(store);
  const engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 20, alwaysOn: true, ...options });
  return { store, engine, cleanup: () => { engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('o backend inicia sozinho a primeira rodada, com ambos em 0%, e os corredores avançam sem presentes', async () => {
  const t = rig();
  try {
    assert.equal(t.engine.getState().config.autoMode, true, 'autoMode é forçado no modo permanente');
    t.engine.bootAutomation();
    const opening = t.engine.getState();
    assert.equal(opening.phase, 'opening');
    assert.equal(opening.game.lula.raceProgress, 0);
    assert.equal(opening.game.bolsonaro.raceProgress, 0);
    await until(() => t.engine.getState().phase === 'live');
    await wait(1_500);
    const live = t.engine.getState();
    assert.ok(live.game.lula.raceProgress > 0 && live.game.bolsonaro.raceProgress > 0, 'ambos avançam sem nenhum presente');
    assert.equal(live.gifts.reduce((sum, gift) => sum + gift.count, 0), 0);
  } finally { t.cleanup(); }
});

test('eventos internos automáticos acontecem, são contados e não viram presentes nem eventos de público', async () => {
  const t = rig({ raceDurationSec: 40, roundDurationSec: 40 }, undefined, { autoEvents: true });
  try {
    t.engine.bootAutomation();
    await until(() => (t.engine.getState().automation?.autoEventsRound ?? 0) >= 2, 14_000);
    const state = t.engine.getState();
    assert.ok(state.automation!.autoEventsTotal >= 2);
    assert.equal(state.automation!.alwaysOn, true);
    assert.ok(state.automation!.lastAutoEvent);
    assert.equal(state.gifts.reduce((sum, gift) => sum + gift.count, 0), 0);
    assert.equal(state.lula.points + state.bolsonaro.points, 0);
    assert.ok(t.store.recentEvents(200).every(event => event.source === 'system'), 'nenhum evento de público foi fabricado');
  } finally { t.cleanup(); }
});

test('padrão de produção: sem comentários nem presentes a corrida anda normal, sem impulso, tropeço ou escudo aleatórios', async () => {
  const t = rig({ raceDurationSec: 40, roundDurationSec: 40 });
  try {
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'live');
    let effects = 0;
    t.engine.on('state', state => { if (state.game.effect && state.game.effect.kind !== 'overtake' && state.game.effect.kind !== 'crowd') effects += 1; });
    await wait(9_000);
    const state = t.engine.getState();
    assert.equal(state.automation!.autoEventsEnabled, false);
    assert.equal(state.automation!.autoEventsTotal, 0);
    assert.equal(effects, 0);
    assert.ok(state.game.lula.raceProgress > 0.1 && state.game.bolsonaro.raceProgress > 0.1, 'anda normalmente');
    // comentário continua gerando impulso
    t.engine.receive({ source: 'demo', type: 'comment', externalId: 'c1', username: 'ana', comment: '13' });
    assert.ok(t.engine.getState().game.lula.boost > 0);
  } finally { t.cleanup(); }
});

test('término aos 100%: encerra na hora e o vencedor está em 100%', async () => {
  const t = rig({ raceDurationSec: 2, roundDurationSec: 60 });
  try {
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'results', 9_000);
    const state = t.engine.getState();
    assert.ok(state.game.winner === 'lula' || state.game.winner === 'bolsonaro');
    assert.ok(state.game[state.game.winner as 'lula' | 'bolsonaro'].raceProgress >= 0.999);
    assert.ok(state.game.raceElapsedSec! < 12, 'terminou muito antes do limite de tempo');
  } finally { t.cleanup(); }
});

test('término por tempo: vence quem está mais à frente', async () => {
  const t = rig({ raceDurationSec: 20, roundDurationSec: 4 });
  try {
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'live');
    let leader: string | null = null;
    t.engine.on('state', state => {
      if (state.phase === 'live') leader = state.game.lula.raceProgress >= state.game.bolsonaro.raceProgress ? 'lula' : 'bolsonaro';
    });
    await until(() => t.engine.getState().phase === 'results', 8_000);
    const state = t.engine.getState();
    assert.ok(Math.max(state.game.lula.raceProgress, state.game.bolsonaro.raceProgress) < 0.6, 'o tempo acabou antes de alguém chegar');
    assert.equal(state.game.winner, leader);
  } finally { t.cleanup(); }
});

test('resultado por 10 s, depois nova rodada automática com ambos em 0% e sem timers duplicados', async () => {
  const t = rig({ raceDurationSec: 2, roundDurationSec: 60, resultsDurationSec: 10, intermissionDurationSec: 2, openingDurationSec: 1 });
  const realSetInterval = globalThis.setInterval;
  let created = 0;
  try {
    t.engine.bootAutomation();
    (globalThis as any).setInterval = (...args: Parameters<typeof setInterval>) => { created += 1; return realSetInterval(...args); };
    await until(() => t.engine.getState().phase === 'results', 9_000);
    const startedAt = Date.now();
    const round = t.engine.getState().roundNumber;
    await until(() => t.engine.getState().phase !== 'results', 13_000);
    const elapsed = (Date.now() - startedAt) / 1000;
    assert.ok(elapsed >= 9.3 && elapsed <= 11, `resultado exibido por ~10 s (foi ${elapsed.toFixed(1)} s)`);
    await until(() => t.engine.getState().phase === 'opening', 6_000);
    const next = t.engine.getState();
    assert.equal(next.roundNumber, round + 1);
    assert.equal(next.game.lula.raceProgress, 0);
    assert.equal(next.game.bolsonaro.raceProgress, 0);
    assert.equal(next.game.winner, null);
    await until(() => t.engine.getState().phase === 'live', 4_000);
    assert.equal(created, 0, 'ciclos de rodada não criam novos intervalos');
    assert.equal(ArenaEngine.activeEngines(), 1);
  } finally { globalThis.setInterval = realSetInterval; t.cleanup(); }
  assert.equal(ArenaEngine.activeEngines(), 0, 'shutdown libera o único motor');
});

test('estado herdado do volume (pausado, ciclo desligado, emergência) é descartado no início do backend', async () => {
  for (const phase of ['paused', 'emergency', 'live'] as const) {
    const t = rig({}, store => {
      store.saveRuntime({ phase, roundNumber: 4, phaseEndsAt: null, roundStartedAt: null, lulaPoints: 3, bolsonaroPoints: 2, lulaInteractions: 0, bolsonaroInteractions: 0,
        lulaUsers: [], bolsonaroUsers: [], likes: 0, emergencyReason: phase === 'emergency' ? 'teste' : null, previousPhase: phase === 'paused' ? 'live' : undefined });
    });
    try {
      t.engine.bootAutomation();
      const state = t.engine.getState();
      assert.equal(state.phase, 'opening', `herdado ${phase}`);
      assert.equal(state.roundNumber, 5);
      assert.equal(state.lula.points + state.bolsonaro.points, 0);
      assert.equal(state.game.lula.raceProgress, 0);
      await until(() => t.engine.getState().phase === 'live');
    } finally { t.cleanup(); }
  }
});

test('ciclo permanente: ocioso volta a correr, "encerrar ciclo" é ignorado e pausa esquecida é retomada', async () => {
  const t = rig({ raceDurationSec: 60, roundDurationSec: 60 }, undefined, { pauseMaxSec: 0.4 });
  try {
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'live');
    t.engine.stopCycle();
    assert.equal(t.engine.getState().config.autoMode, true);
    assert.equal(t.engine.getState().phase, 'live');
    t.engine.updateConfig({ autoMode: false });
    assert.equal(t.engine.getState().config.autoMode, true);
    t.engine.pause();
    assert.equal(t.engine.getState().phase, 'paused');
    await until(() => t.engine.getState().phase === 'live', 3_000);
    t.engine.finish();
    await until(() => ['opening', 'live'].includes(t.engine.getState().phase), 3_000);
  } finally { t.cleanup(); }
});

test('presentes simulados (Lula e Bolsonaro) e reais convivem com a corrida automática sem mexer no cronômetro', async () => {
  const t = rig({ raceDurationSec: 60, roundDurationSec: 60 });
  class Fake extends EventEmitter implements LiveConnection {
    async connect() { return { roomId: 'sala-1' }; }
    async disconnect() { /* nada */ }
  }
  const fake = new Fake();
  const adapter = new TikTokAdapter(t.engine, t.store, 'arena_teste', { connectionFactory: () => fake, owner: 'a' });
  try {
    const registry = t.store.raceGifts();
    const lulaGift = registry.find(gift => gift.side === 'lula' && gift.effect === 'turbo')!;
    const bolsonaroGift = registry.find(gift => gift.side === 'bolsonaro' && gift.effect === 'turbo')!;
    { const { imageUrl: _i, ...base } = lulaGift; t.store.saveGift({ ...base, tiktokGiftId: '90001' }); }
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'live');
    await adapter.start();
    await wait(300);
    const endsAt = t.engine.getState().phaseEndsAt;
    const before = t.engine.getState().game.bolsonaro.raceProgress;

    // presente REAL (via conector) para Lula e SIMULADO (Central de Testes) para Bolsonaro
    fake.emit('gift', { giftId: '90001', repeatCount: 1, repeatEnd: 0, gift: { id: '90001', name: 'Rosquinha', type: 0 }, user: { id: '7', displayId: 'fa' }, common: { msgId: 'x1' } });
    const sim = t.engine.receive({ source: 'demo', type: 'gift', externalId: 'sim-b', username: 'teste', registryGiftId: bolsonaroGift.id });
    assert.equal(sim.accepted, true);
    const log = t.store.giftLog();
    assert.equal(log[0].runner, 'lula');
    assert.equal(log[0].status, 'aplicado');
    const counts = Object.fromEntries(t.engine.getState().gifts.map(gift => [gift.id, gift.count]));
    assert.equal(counts[lulaGift.id], 1);
    assert.equal(counts[bolsonaroGift.id], 1);
    await wait(800);
    const after = t.engine.getState();
    assert.equal(after.phase, 'live');
    assert.equal(after.phaseEndsAt, endsAt, 'cronômetro intacto');
    assert.ok(after.game.bolsonaro.raceProgress > before, 'a corrida continua');
    assert.equal(t.store.giftLog().length, 1, 'simulação não entra no histórico de presentes reais');
  } finally { await adapter.stop(); t.cleanup(); }
});

test('conector TikTok indisponível nunca interrompe a corrida', async () => {
  const t = rig({ raceDurationSec: 60, roundDurationSec: 60 });
  const adapter = new TikTokAdapter(t.engine, t.store, 'arena_teste', {
    connectionFactory: () => { throw Object.assign(new Error('sem rede'), { name: 'Error' }); },
    errorRetryMs: { base: 30, max: 60 }, owner: 'a'
  });
  try {
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'live');
    await adapter.start();
    const first = t.engine.getState().game.lula.raceProgress;
    await wait(1_200);
    const state = t.engine.getState();
    assert.equal(state.connector.status, 'error');
    assert.equal(state.phase, 'live');
    assert.ok(state.game.lula.raceProgress > first);
    assert.ok(adapter.snapshot().retries >= 3, 'tentativas continuam em segundo plano');
  } finally { await adapter.stop(); t.cleanup(); }
});

test('reconexão WebSocket: o cliente volta sozinho e a rodada continua (recarregar não reinicia)', async () => {
  const t = rig({ raceDurationSec: 60, roundDurationSec: 60 });
  let http = createServer();
  let server = new Server(http, { cors: { origin: false } });
  const wire = (srv: Server) => {
    srv.on('connection', socket => socket.emit('arena:state', t.engine.getState()));
  };
  wire(server);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const client = connect(`http://127.0.0.1:${port}`, { reconnection: true, reconnectionDelay: 50, reconnectionDelayMax: 150 });
  const received: any[] = [];
  client.on('arena:state', state => received.push(state));
  try {
    t.engine.bootAutomation();
    await until(() => t.engine.getState().phase === 'live');
    await until(() => received.length >= 1);
    const roundBefore = t.engine.getState().roundNumber;
    const endsAtBefore = t.engine.getState().phaseEndsAt;
    // derruba o servidor de sockets e sobe outro na mesma porta
    await server.close();
    http = createServer();
    server = new Server(http, { cors: { origin: false } });
    wire(server);
    await new Promise<void>(resolve => http.listen(port, '127.0.0.1', resolve));
    const count = received.length;
    await until(() => received.length > count, 6_000);
    const latest = received[received.length - 1];
    assert.equal(latest.roundNumber, roundBefore);
    assert.equal(latest.phaseEndsAt, endsAtBefore);
    assert.equal(latest.phase, 'live');
  } finally { client.close(); await server.close(); t.cleanup(); }
});

test('cadastro: 10 pares com custo igual, sem IDs inventados; validação acusa repetição no par', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-registry-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  try {
    const gifts = store.raceGifts();
    assert.equal(gifts.length, 20);
    assert.equal(gifts.filter(gift => gift.tiktokGiftId).length, 0);
    assert.deepEqual(validateGiftRegistry(gifts), []);
    const lula = gifts.find(gift => gift.side === 'lula' && gift.order === 1)!;
    const bolsonaro = gifts.find(gift => gift.side === 'bolsonaro' && gift.order === 1)!;
    const clash = gifts.map(gift => gift.id === lula.id || gift.id === bolsonaro.id ? { ...gift, tiktokGiftId: '123' } : gift);
    assert.equal(validateGiftRegistry(clash)[0].type, 'id_repetido_no_par');
    const costly = gifts.map(gift => gift.id === bolsonaro.id ? { ...gift, costLabel: '999' } : gift);
    assert.equal(validateGiftRegistry(costly)[0].type, 'custo_diferente');
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('processo real do backend: corrida começa sozinha, avança sem ninguém no painel e simulação exige token', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-proc-'));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const token = 'a'.repeat(40);
  const root = path.resolve(import.meta.dirname, '..');
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: path.join(directory, 'live.sqlite'), ADMIN_TOKEN: token,
      TIKTOK_USERNAME: '', TIKTOK_AUTO_CONNECT: 'false', REMOTE_ACCESS: 'false', AUDIO_SAFE_MODE: 'true' }
  });
  const base = `http://127.0.0.1:${port}`;
  const state = async () => (await fetch(`${base}/api/state`)).json() as Promise<any>;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) { try { ready = (await fetch(`${base}/api/health`)).ok; } catch { await wait(150); } }
    assert.ok(ready, 'servidor subiu');
    await wait(8_000);
    const first = await state();
    assert.equal(first.config.autoMode, true);
    assert.equal(first.config.raceDurationSec, 300);
    assert.equal(first.config.resultsDurationSec, 10);
    assert.ok(['opening', 'live'].includes(first.phase), `fase ${first.phase}`);
    assert.equal(first.automation.alwaysOn, true);
    await wait(2_000);
    const second = await state();
    assert.equal(second.phase, 'live');
    assert.ok(second.game.lula.raceProgress > first.game.lula.raceProgress || first.game.lula.raceProgress === 0 && second.game.lula.raceProgress > 0);
    assert.equal(second.roundNumber, first.roundNumber, 'ler o estado (recarregar o overlay) não reinicia a rodada');
    // simulação protegida
    const denied = await fetch(`${base}/api/simulate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'comment', candidate: 'lula', comment: '13' }) });
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${base}/api/simulate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify({ type: 'comment', candidate: 'lula', comment: '13' }) });
    assert.equal(allowed.status, 200);
  } finally { child.kill('SIGTERM'); await wait(300); fs.rmSync(directory, { recursive: true, force: true }); }
});
