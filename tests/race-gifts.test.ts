import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';

const LULA = ['Rose', 'Heart Me', 'Rosa', 'Rosquinha', 'Chapéu e Bigode', 'Ney místico', 'Coroa', 'Luvas de boxe', 'Dança do Cacto', 'Pistola de dinheiro'];
const BOLSONARO = ['Rosa branca', 'Palmas', 'Mini dino', 'Capybara', 'Grou de papel', 'Clarinete do groove', 'Coqueiro', 'Corgi', 'Boa noite', 'Você é demais'];
const LABELS = ['IMPULSO', 'ACELERAÇÃO LEVE', 'SUPER IMPULSO', 'TURBO', 'ESCUDO', 'RECUPERAÇÃO', 'ULTRA TURBO', 'SUPER TURBO', 'EFEITO ALEATÓRIO', 'PODER ESPECIAL'];

async function liveEngine() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-gifts-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  store.saveConfig({ ...store.getConfig(), openingDurationSec: 1, raceDurationSec: 120, roundDurationSec: 200, raceEventFrequency: 1 });
  const engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 20 });
  engine.start();
  await new Promise(resolve => setTimeout(resolve, 1_200));
  assert.equal(engine.getState().phase, 'live');
  const gift = (id: string, user = 'teste') => engine.receive({ source: 'demo', type: 'gift', externalId: `${id}-${Math.random()}`, username: user, registryGiftId: id, giftId: 'x' });
  return { store, engine, gift, cleanup: () => { engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('infográfico: 10 pares de mesmo valor, um presente diferente por coluna, sem ID inventado', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-gifts-seed-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  try {
    const gifts = store.raceGifts();
    const column = (side: string) => gifts.filter(gift => gift.side === side).sort((a, b) => a.order - b.order);
    assert.deepEqual(column('lula').map(gift => gift.name), LULA);
    assert.deepEqual(column('bolsonaro').map(gift => gift.name), BOLSONARO);
    for (const side of ['lula', 'bolsonaro']) {
      assert.deepEqual(column(side).map(gift => gift.label), LABELS);
      assert.deepEqual(column(side).map(gift => gift.costLabel), ['1', '1', '10', '30', '99', '149', '199', '299', '399', '500']);
    }
    // pares: mesmo valor e mesma funcionalidade dos dois lados
    column('lula').forEach((gift, index) => {
      const pair = column('bolsonaro')[index];
      assert.equal(gift.points, pair.points);
      assert.equal(gift.effect, pair.effect);
    });
    assert.ok(gifts.every(gift => gift.tiktokGiftId === null), 'nenhum ID do TikTok inventado');
    for (const gift of gifts) assert.ok(fs.existsSync(path.join('public', gift.imageUrl!)), `ícone ${gift.imageUrl} existe`);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('migração troca só os presentes provisórios intocados; nunca apaga o que o operador editou', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-gifts-migrate-'));
  const file = path.join(directory, 'test.sqlite');
  try {
    // banco com os 10 provisórios da etapa anterior
    let store = new Store(file);
    const db = new Database(file);
    db.prepare('DELETE FROM race_gifts').run();
    const insert = db.prepare(`INSERT INTO race_gifts(id,name,tiktok_gift_id,side,effect,target,label,cost_label,intensity,duration_sec,points,enabled,sort_order,image_file,confirmed,note,created_at)
      VALUES(?,?,NULL,?,'impulso','own','X','',1,0,10,1,1,NULL,0,'',?)`);
    for (const side of ['lula', 'bolsonaro']) for (let n = 1; n <= 5; n++) insert.run(`gift-${side}-${n}`, 'provisório', side, new Date().toISOString());
    db.close(); store.close();
    store = new Store(file);
    assert.equal(store.raceGifts().length, 20, 'provisórios intocados viram o infográfico');
    store.close();

    // a cartela anterior, intocada, também é trocada
    const db1 = new Database(file);
    db1.prepare('DELETE FROM race_gifts').run();
    const insertCard = db1.prepare(`INSERT INTO race_gifts(id,name,tiktok_gift_id,side,effect,target,label,cost_label,intensity,duration_sec,points,enabled,sort_order,image_file,confirmed,note,created_at)
      VALUES(?,?,NULL,?,'impulso','own','X','',1,0,10,1,1,?,1,'',?)`);
    for (const side of ['lula', 'bolsonaro']) for (const slug of ['rosa', 'coracao', 'donut', 'universo', 'confete']) insertCard.run(`gift-${side}-${slug}`, slug, side, `bundled:${slug}.png`, new Date().toISOString());
    db1.close();
    store = new Store(file);
    assert.deepEqual(store.raceGifts().filter(gift => gift.side === 'lula').sort((a, b) => a.order - b.order).map(gift => gift.name), LULA);
    store.close();

    // agora um banco em que o operador editou um provisório: nada é apagado
    const db2 = new Database(file);
    db2.prepare('DELETE FROM race_gifts').run();
    const insert2 = db2.prepare(`INSERT INTO race_gifts(id,name,tiktok_gift_id,side,effect,target,label,cost_label,intensity,duration_sec,points,enabled,sort_order,image_file,confirmed,note,created_at)
      VALUES(?,?,?,?,'impulso','own','X','',1,0,10,1,1,NULL,0,'',?)`);
    for (const side of ['lula', 'bolsonaro']) for (let n = 1; n <= 5; n++) insert2.run(`gift-${side}-${n}`, 'provisório', side === 'lula' && n === 1 ? '777' : null, side, new Date().toISOString());
    db2.close();
    store = new Store(file);
    assert.equal(store.raceGifts().length, 10, 'com um ID preenchido pelo operador, a tabela fica como está');
    store.close();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Pistola de dinheiro (PODER ESPECIAL): combinação poderosa, pontos de 500', async () => {
  const { engine, gift, cleanup } = await liveEngine();
  try {
    assert.equal(gift('gift-lula-pistola-de-dinheiro').accepted, true);
    const state = engine.getState();
    assert.match(state.lastEvent!.summary, /PODER ESPECIAL \((turbo \+ escudo|turbo \+ rival tropeçou|arrancada \+ escudo \+ rival tropeçou)\)/);
    assert.ok(state.game.lula.boost > 50, 'o corredor ganhou velocidade');
    assert.equal(state.lula.points, 500);
    assert.equal(state.gifts.find(item => item.id === 'gift-lula-pistola-de-dinheiro')!.count, 1);
    assert.equal(state.lastEvent!.source, 'demo');
  } finally { cleanup(); }
});

test('Boa noite (EFEITO ALEATÓRIO) aplica um efeito diferente e diz qual foi', async () => {
  const { engine, gift, cleanup } = await liveEngine();
  try {
    for (let index = 0; index < 4; index++) {
      assert.equal(gift('gift-bolsonaro-boa-noite').accepted, true);
      assert.match(engine.getState().lastEvent!.summary, /sorteio: (impulso|turbo|super arrancada|escudo|rival tropeçou)/);
    }
    assert.equal(engine.getState().gifts.find(item => item.id === 'gift-bolsonaro-boa-noite')!.count, 4);
  } finally { cleanup(); }
});

test('Ney místico (RECUPERAÇÃO) tira o Lula do tropeço na hora', async () => {
  const { engine, gift, cleanup } = await liveEngine();
  try {
    engine.testRaceItem('lula', 'tropeco', 2);
    assert.equal(engine.getState().game.lula.action, 'stumble');
    gift('gift-lula-ney-mistico');
    const lula = engine.getState().game.lula;
    assert.notEqual(lula.action, 'stumble');
    assert.ok(lula.boost >= 30);
    assert.match(engine.getState().lastEvent!.summary, /RECUPERAÇÃO \(saiu do tropeço\)/);
  } finally { cleanup(); }
});

test('duração muda o motor: Grou de papel dá escudo de 8 s, Corgi mantém o turbo', async () => {
  const { engine, gift, cleanup } = await liveEngine();
  try {
    gift('gift-bolsonaro-grou-de-papel');
    assert.ok(engine.getState().game.bolsonaro.shield > 7);
    gift('gift-bolsonaro-corgi');
    const right = engine.getState().game.bolsonaro.boost;
    await new Promise(resolve => setTimeout(resolve, 1_200));
    assert.ok(engine.getState().game.bolsonaro.boost >= right - 1, 'durante os 8 s o turbo não cai');
  } finally { cleanup(); }
});

test('presente real casa pelo ID cadastrado e vai para a coluna dele', async () => {
  const { engine, store, cleanup } = await liveEngine();
  try {
    (engine as unknown as { connector: { status: string } }).connector.status = 'connected';
    store.saveGift({ ...store.raceGift('gift-bolsonaro-palmas')!, tiktokGiftId: '88888' });
    const result = engine.receive({ source: 'tiktok', type: 'gift', externalId: 'p1', username: 'fã', giftId: 88888, repeatCount: 2 });
    assert.equal(result.accepted, true);
    assert.equal(engine.getState().gifts.find(item => item.id === 'gift-bolsonaro-palmas')!.count, 2);
    assert.equal(engine.getState().bolsonaro.points, 2);
  } finally { cleanup(); }
});

test('presente real nas duas colunas vai para o time do último comentário; sem comentário, é recusado', async () => {
  const { engine, store, cleanup } = await liveEngine();
  try {
    (engine as unknown as { connector: { status: string } }).connector.status = 'connected';
    // mesmo ID nas duas colunas (caso o operador repita um presente): vale o time do comentário
    store.saveGift({ ...store.raceGift('gift-lula-rose')!, tiktokGiftId: '99999' });
    store.saveGift({ ...store.raceGift('gift-bolsonaro-rosa-branca')!, tiktokGiftId: '99999' });

    const noTeam = engine.receive({ source: 'tiktok', type: 'gift', externalId: 't1', username: 'sem_time', giftId: 99999 });
    assert.equal(noTeam.accepted, false);
    assert.match(noTeam.reason!, /13 ou 22/);

    engine.receive({ source: 'tiktok', type: 'comment', externalId: 't2', username: 'fã', comment: '22' });
    const routed = engine.receive({ source: 'tiktok', type: 'gift', externalId: 't3', username: 'fã', giftId: 99999 });
    assert.equal(routed.accepted, true);
    const state = engine.getState();
    assert.equal(state.gifts.find(item => item.id === 'gift-bolsonaro-rosa-branca')!.count, 1);
    assert.equal(state.gifts.find(item => item.id === 'gift-lula-rose')!.count, 0);

    engine.receive({ source: 'tiktok', type: 'comment', externalId: 't4', username: 'fã', comment: '13' });
    engine.receive({ source: 'tiktok', type: 'gift', externalId: 't5', username: 'fã', giftId: 99999 });
    assert.equal(engine.getState().gifts.find(item => item.id === 'gift-lula-rose')!.count, 1, 'mudou de time, o presente acompanha');

    // simulados nunca entram na contagem de reais
    const before = engine.getDiagnostics().eventsBySource.tiktok;
    engine.receive({ source: 'demo', type: 'gift', externalId: 'd1', username: 'demo', registryGiftId: 'gift-lula-rose', giftId: 'x' });
    assert.equal(engine.getDiagnostics().eventsBySource.tiktok, before);
  } finally { cleanup(); }
});

test('presente personalizado com alvo no rival derruba o adversário', async () => {
  const { engine, store, gift, cleanup } = await liveEngine();
  try {
    store.saveGift({ ...store.raceGift('gift-lula-rose')!, id: 'casca', name: 'Casca', effect: 'tropeco', target: 'rival', label: '22 TROPEÇA', durationSec: 1.5 });
    assert.equal(gift('casca').accepted, true);
    assert.equal(engine.getState().game.bolsonaro.action, 'stumble');
  } finally { cleanup(); }
});
