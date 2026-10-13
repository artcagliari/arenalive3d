import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';
import { catalogFrom, describeError, matchObservedGifts, normalizeGift, redact, suggestGiftIds, TikTokAdapter, type LiveConnection } from '../server/tiktok.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, ms = 3_000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await wait(10); } };

class FakeConnection extends EventEmitter implements LiveConnection {
  connects = 0; disconnects = 0;
  constructor(private behavior: { fail?: Error; roomId?: string; catalog?: unknown } = {}) { super(); }
  async connect() { this.connects += 1; if (this.behavior.fail) throw this.behavior.fail; return { roomId: this.behavior.roomId ?? 'room-1' }; }
  async disconnect() { this.disconnects += 1; }
  async fetchAvailableGifts() { return this.behavior.catalog ?? []; }
}

/** IDs de teste sintéticos (não são IDs reais do TikTok). */
const testId = (index: number) => `9${String(index).padStart(3, '0')}`;

async function setup(options: { factory?: () => FakeConnection; owner?: string; streakFlushMs?: number } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-listener-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  store.saveConfig({ ...store.getConfig(), openingDurationSec: 1, raceDurationSec: 120, roundDurationSec: 200, raceEventFrequency: 1 });
  const registry = store.raceGifts();
  registry.forEach((gift, index) => { const { imageUrl: _ignored, ...base } = gift; store.saveGift({ ...base, tiktokGiftId: testId(index) }); });
  const engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 20 });
  engine.start();
  await wait(1_200);
  assert.equal(engine.getState().phase, 'live');
  const connections: FakeConnection[] = [];
  const factory = options.factory ?? (() => new FakeConnection());
  const adapter = new TikTokAdapter(engine, store, '@arena_teste', {
    connectionFactory: () => { const connection = factory(); connections.push(connection); return connection; },
    owner: options.owner ?? 'owner-a', streakFlushMs: options.streakFlushMs ?? 80,
    errorRetryMs: { base: 30, max: 60 }, offlineRetryMs: { base: 30, max: 60 }, endedRetryMs: 40, leaseRetryMs: 40, leaseTtlMs: 600
  });
  const cleanup = async () => { await adapter.stop(); engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); };
  return { store, engine, adapter, connections, registry: store.raceGifts(), cleanup };
}

const giftEvent = (giftId: string, extra: Record<string, unknown> = {}) => ({
  giftId, repeatCount: 1, repeatEnd: 0, groupId: `g-${Math.random()}`,
  gift: { id: giftId, name: `Presente ${giftId}`, type: 0, combo: false, diamondCount: 1 },
  user: { id: 'u1', nickname: 'Ana', displayId: 'ana_x' }, common: { msgId: `m-${Math.random()}`, createTime: '1700000000000', roomId: 'room-1' }, ...extra
});

test('os 20 presentes cadastrados acionam o corredor e o poder corretos (ambos os lados)', async () => {
  const t = await setup();
  try {
    await t.adapter.start();
    assert.equal(t.engine.getState().connector.status, 'connected');
    assert.equal(t.engine.getState().connector.roomId, 'room-1');
    let updates = 0;
    t.engine.on('state', () => { updates += 1; });
    assert.equal(t.registry.length, 20);
    for (const [index, gift] of t.registry.entries()) {
      t.connections[0].emit('gift', giftEvent(testId(index), { user: { id: `u${index}`, displayId: `fa_${index}` } }));
    }
    const log = t.store.giftLog(100).reverse();
    assert.equal(log.length, 20);
    assert.ok(log.every(entry => entry.status === 'aplicado'), JSON.stringify(log.filter(entry => entry.status !== 'aplicado')));
    t.registry.forEach((gift, index) => {
      assert.equal(log[index].registryId, gift.id);
      assert.equal(log[index].runner, gift.side, 'target "own": o poder vai para o corredor da coluna');
      assert.equal(log[index].effect, gift.effect);
    });
    assert.equal(new Set(log.map(entry => entry.runner)).size, 2);
    assert.ok(updates >= 20, 'o estado hospedado foi atualizado pelo WebSocket a cada presente');
    const counts = t.engine.getState().gifts;
    assert.ok(counts.every(item => item.count === 1));
    assert.equal(t.engine.getState().connector.lastGift?.status, 'aplicado');
    const stored = JSON.stringify(t.store.recentEvents(50));
    assert.ok(stored.includes('"source":"tiktok"'));
  } finally { await t.cleanup(); }
});

test('combo: poder aplicado uma única vez, com a contagem final', async () => {
  const t = await setup();
  try {
    await t.adapter.start();
    const base = { groupId: 'combo-1', gift: { id: testId(0), name: 'Rose', type: 1, combo: true, diamondCount: 1 } };
    for (const count of [1, 2, 3]) t.connections[0].emit('gift', giftEvent(testId(0), { ...base, repeatCount: count, repeatEnd: 0, common: { msgId: `c${count}` } }));
    assert.equal(t.store.giftLog().length, 0, 'combo em andamento não aciona nada');
    t.connections[0].emit('gift', giftEvent(testId(0), { ...base, repeatCount: 5, repeatEnd: 1, common: { msgId: 'c-end' } }));
    const log = t.store.giftLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].repeatCount, 5);
    assert.equal(t.engine.getState().gifts.find(item => item.id === t.registry[0].id)?.count, 5);
    // repeatEnd repetido (reenvio) não duplica
    t.connections[0].emit('gift', giftEvent(testId(0), { ...base, repeatCount: 5, repeatEnd: 1, common: { msgId: 'c-end-2' } }));
    assert.equal(t.store.giftLog().length, 1);
    assert.equal(t.engine.getState().gifts.find(item => item.id === t.registry[0].id)?.count, 5);
  } finally { await t.cleanup(); }
});

test('combo sem repeatEnd é fechado por tempo e o repeatEnd tardio só soma o que faltou', async () => {
  const t = await setup({ streakFlushMs: 40 });
  try {
    await t.adapter.start();
    const base = { groupId: 'combo-2', gift: { id: testId(3), name: 'Palmas', type: 1, combo: true, diamondCount: 30 }, user: { id: 'u9', displayId: 'fa' } };
    t.connections[0].emit('gift', giftEvent(testId(3), { ...base, repeatCount: 3, repeatEnd: 0 }));
    await until(() => t.store.giftLog().length === 1);
    assert.equal(t.store.giftLog()[0].repeatCount, 3);
    t.connections[0].emit('gift', giftEvent(testId(3), { ...base, repeatCount: 3, repeatEnd: 1 }));
    assert.equal(t.store.giftLog().length, 1, 'mesma contagem: duplicado');
    t.connections[0].emit('gift', giftEvent(testId(3), { ...base, repeatCount: 7, repeatEnd: 1 }));
    const log = t.store.giftLog();
    assert.equal(log.length, 2);
    assert.equal(log[0].repeatCount, 4);
  } finally { await t.cleanup(); }
});

test('deduplicação: o mesmo evento (msgId) não executa o poder duas vezes', async () => {
  const t = await setup();
  try {
    await t.adapter.start();
    const event = giftEvent(testId(2), { common: { msgId: 'same-msg', roomId: 'room-1' } });
    t.connections[0].emit('gift', event);
    t.connections[0].emit('gift', event);
    t.connections[0].emit('gift', structuredClone(event));
    assert.equal(t.store.giftLog().length, 1);
    assert.equal(t.engine.getState().gifts.find(item => item.id === t.registry[2].id)?.count, 1);
  } finally { await t.cleanup(); }
});

test('presente desconhecido fica pendente e não aciona nada; simulação nunca entra no histórico real', async () => {
  const t = await setup();
  try {
    await t.adapter.start();
    const before = JSON.stringify(t.engine.getState().gifts.map(item => item.count));
    const pointsBefore = t.engine.getState().lula.points + t.engine.getState().bolsonaro.points;
    t.connections[0].emit('gift', giftEvent('5655'));
    const log = t.store.giftLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].status, 'pendente');
    assert.equal(log[0].giftId, '5655');
    assert.equal(JSON.stringify(t.engine.getState().gifts.map(item => item.count)), before);
    assert.equal(t.engine.getState().lula.points + t.engine.getState().bolsonaro.points, pointsBefore);
    assert.equal(t.store.pendingGiftSummary()[0].giftId, '5655');
    assert.equal(t.engine.getState().connector.unknownGifts, 1);
    // simulação (Central de Testes) usa a mesma função de efeito, mas não grava histórico real
    const sim = t.engine.receive({ source: 'demo', type: 'gift', externalId: 'sim-1', username: 'teste', registryGiftId: t.registry[0].id, giftId: 'x' });
    assert.equal(sim.accepted, true);
    assert.equal(t.store.giftLog().length, 1);
  } finally { await t.cleanup(); }
});

test('desconexão e reconexão controladas, sem listener duplicado', async () => {
  let created = 0;
  const t = await setup({ factory: () => { created += 1; return new FakeConnection({ roomId: `room-${created}` }); } });
  try {
    await t.adapter.start();
    assert.equal(created, 1);
    t.connections[0].emit('disconnected');
    t.connections[0].emit('error', new Error('socket caiu'));
    assert.notEqual(t.engine.getState().connector.status, 'connected');
    await until(() => t.engine.getState().connector.status === 'connected');
    assert.equal(created, 2, 'uma única reconexão apesar de dois eventos de falha');
    // a conexão antiga não aciona mais nada
    t.connections[0].emit('gift', giftEvent(testId(1)));
    assert.equal(t.store.giftLog().length, 0);
    t.connections[1].emit('gift', giftEvent(testId(1)));
    assert.equal(t.store.giftLog().length, 1);
    await t.adapter.start();
    assert.equal(created, 2, 'start é idempotente');
  } finally { await t.cleanup(); }
});

test('LIVE offline é exibida e reconecta quando a transmissão começa', async () => {
  let created = 0;
  const offline = Object.assign(new Error('The requested user isn\'t online'), { name: 'UserOfflineError' });
  const t = await setup({ factory: () => new FakeConnection(++created < 3 ? { fail: offline } : {}) });
  try {
    await t.adapter.start();
    assert.equal(t.engine.getState().connector.status, 'offline');
    assert.match(t.engine.getState().connector.detail, /LIVE offline/);
    await until(() => t.engine.getState().connector.status === 'connected');
    assert.equal(created, 3);
  } finally { await t.cleanup(); }
});

test('um único listener ativo por sala: segunda instância fica em espera e assume depois', async () => {
  const first = await setup({ owner: 'owner-a' });
  try {
    await first.adapter.start();
    assert.equal(first.engine.getState().connector.status, 'connected');
    const secondAdapter = new TikTokAdapter(first.engine, first.store, 'ARENA_TESTE', {
      connectionFactory: () => new FakeConnection(), owner: 'owner-b', leaseRetryMs: 40, leaseTtlMs: 600
    });
    await secondAdapter.start();
    assert.equal(secondAdapter.snapshot().hasLease, false);
    assert.equal(first.engine.getState().connector.status, 'standby');
    await secondAdapter.stop();
  } finally { await first.cleanup(); }
});

test('normalização usa o schema v3 do conector 2.5.0 e tolera o formato antigo', () => {
  const v3 = normalizeGift({ giftId: '77', repeatCount: 2, repeatEnd: 1, groupId: 'gx', gift: { id: '77', name: 'Corgi', type: 1, combo: true },
    user: { id: '1', displayId: 'fulano', nickname: 'Fulano' }, common: { msgId: 'm', roomId: 'r', createTime: '1' } });
  assert.deepEqual([v3?.giftId, v3?.giftName, v3?.giftType, v3?.streakable, v3?.sender, v3?.msgId, v3?.roomId], ['77', 'Corgi', 1, true, 'fulano', 'm', 'r']);
  const old = normalizeGift({ giftId: 5, repeatCount: 1, giftDetails: { giftName: 'Rose', giftType: 1 }, user: { uniqueId: 'velho' }, msgId: 'x' });
  assert.deepEqual([old?.giftId, old?.giftName, old?.sender, old?.streakable], ['5', 'Rose', 'velho', true]);
  assert.equal(normalizeGift({ repeatCount: 1 }), null);
});

test('redação de segredos e sugestões de catálogo só por nome idêntico', () => {
  assert.equal(redact('falhou sessionid=abc123 e Bearer xyz.123'), 'falhou sessionid=[REDIGIDO] e Bearer [REDIGIDO]');
  assert.ok(!redact('cookie: ttwid=zzz').includes('zzz'));
  const catalog = catalogFrom([{ id: 1, name: 'Rose', diamond_count: 1 }, { id: 2, name: 'Corgi' }, { id: 3, name: 'corgi' }]);
  const registry = [{ id: 'a', name: 'Rose', side: 'lula', tiktokGiftId: null }, { id: 'b', name: 'Corgi', side: 'bolsonaro', tiktokGiftId: null },
    { id: 'c', name: 'Inexistente', side: 'lula', tiktokGiftId: null }] as any;
  const suggestions = suggestGiftIds(registry, catalog);
  assert.deepEqual(suggestions.map(item => item.suggestedGiftId), ['1', null, null]);
});

test('erro do evento do conector ({info, exception}) vira mensagem legível e conta sem sala é tratada como offline', async () => {
  assert.equal(describeError({ info: 'Error while connecting', exception: new Error('Failed to retrieve Room ID from all sources.') }),
    'Failed to retrieve Room ID from all sources. — Error while connecting');
  let created = 0;
  const t = await setup({ factory: () => { created += 1; const c = new FakeConnection({ fail: Object.assign(new Error('x'), { name: 'Error' }) }); (c as any).connect = async () => { throw { info: 'Error while connecting', exception: new Error('Failed to retrieve Room ID from all sources.') }; }; return c; } });
  try {
    await t.adapter.start();
    assert.equal(t.engine.getState().connector.status, 'offline');
    assert.ok(!t.engine.getState().connector.detail.includes('[object Object]'));
  } finally { await t.cleanup(); }
});

test('aprendizado de ID sem gastar moedas: nome + preço idênticos associam o ID e o poder já dispara no mesmo evento', async () => {
  const t = await setup();
  try {
    const target = t.registry.find(gift => gift.name === 'Corgi')!;
    { const { imageUrl: _i, ...base } = target; t.store.saveGift({ ...base, tiktokGiftId: null }); }
    await t.adapter.start();
    // mesmo nome, preço diferente: NÃO associa
    t.connections[0].emit('gift', giftEvent('7001', { gift: { id: '7001', name: 'Corgi', type: 0, diamondCount: 5 } }));
    assert.equal(t.store.giftLog()[0].status, 'pendente');
    assert.equal(t.store.raceGift(target.id)!.tiktokGiftId, null);
    // nome e preço idênticos: associa e aplica
    t.connections[0].emit('gift', giftEvent('7002', { gift: { id: '7002', name: 'corgi', type: 0, diamondCount: Number(target.costLabel) } }));
    assert.equal(t.store.raceGift(target.id)!.tiktokGiftId, '7002');
    const entry = t.store.giftLog()[0];
    assert.equal(entry.status, 'aplicado');
    assert.equal(entry.registryId, target.id);
    // sem preço conhecido: não associa
    const other = t.registry.find(gift => gift.name === 'Capybara')!;
    { const { imageUrl: _i, ...base } = other; t.store.saveGift({ ...base, tiktokGiftId: null }); }
    t.connections[0].emit('gift', giftEvent('7003', { gift: { id: '7003', name: 'Capybara', type: 0 } }));
    assert.equal(t.store.raceGift(other.id)!.tiktokGiftId, null);
  } finally { await t.cleanup(); }
});

test('falha pontual reportada pelo conector (evento error) não derruba uma conexão saudável', async () => {
  let created = 0;
  const t = await setup({ factory: () => { created += 1; return new FakeConnection(); } });
  try {
    await t.adapter.start();
    t.connections[0].emit('error', { info: 'Failed to fetch room gifts.', exception: new Error('This endpoint requires a Business plan.') });
    await wait(150);
    assert.equal(t.engine.getState().connector.status, 'connected');
    assert.equal(created, 1);
  } finally { await t.cleanup(); }
});

test('matchObservedGifts: só nome+preço é "exact"; ambíguo não associa', () => {
  const registry = [
    { id: 'a', name: 'Rose', side: 'lula', costLabel: '1', tiktokGiftId: null },
    { id: 'b', name: 'Corgi', side: 'bolsonaro', costLabel: '299', tiktokGiftId: null },
    { id: 'c', name: 'Coroa', side: 'lula', costLabel: '99', tiktokGiftId: null }
  ] as any;
  const result = matchObservedGifts(registry, [
    { giftId: '1', name: 'Rose', diamonds: 1 }, { giftId: '2', name: 'Corgi', diamonds: 10 },
    { giftId: '3', name: 'Coroa', diamonds: 99 }, { giftId: '4', name: 'Coroa', diamonds: 99 }
  ]);
  assert.deepEqual(result.map(item => [item.registryId, item.giftId, item.basis]), [['a', '1', 'exact']]);
});
