import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';

test('motor pontua, separa usuários únicos e persiste o estado', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-arena-test-'));
  const filename = path.join(directory, 'test.sqlite');
  const store = new Store(filename);
  store.saveConfig({ ...store.getConfig(), openingDurationSec: 0.05 });
  const engine = new ArenaEngine(store, { audioSafeMode: false });
  const audioCues: Array<{ trigger:string }> = [];
  engine.on('audio', cue => audioCues.push(cue));
  engine.start();
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(engine.getState().phase, 'live');
  assert.ok(audioCues.some(cue => cue.trigger === 'race_start'));
  assert.equal(engine.receive({ source: 'demo', type: 'comment', externalId: 'a', username: 'maria', comment: 'LULA' }).accepted, true);
  assert.equal(engine.receive({ source: 'demo', type: 'comment', externalId: 'b', username: 'maria', comment: 'LULA' }).accepted, true);
  assert.equal(engine.receive({ source: 'demo', type: 'comment', externalId: 'a', username: 'maria', comment: 'LULA' }).accepted, false);
  assert.equal(engine.receive({ source: 'demo', type: 'gift', externalId: 'gift-a', username: 'joao', giftId: '__demo', forcedCandidate: 'lula' }).accepted, true);
  assert.ok(audioCues.some(cue => cue.trigger === 'gift_received'));
  assert.equal(engine.getState().lula.points, 12);
  assert.equal(engine.getState().lula.uniqueUsers, 2);
  engine.shutdown();
  store.close();

  const reopened = new Store(filename);
  assert.equal(reopened.getRuntime<any>().lulaPoints, 12);
  const restoredEngine = new ArenaEngine(reopened, { phaseIntervalMs:20, gameIntervalMs:10 });
  assert.equal(restoredEngine.receive({ source:'demo', type:'comment', externalId:'a', username:'maria', comment:'LULA' }).accepted, false);
  assert.equal(restoredEngine.getState().lula.points, 12);
  assert.equal(restoredEngine.getDiagnostics().discardReasons.duplicado, 1);
  restoredEngine.shutdown();
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('modo automático encerra, salva e abre a rodada seguinte', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-arena-auto-test-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  store.saveConfig({
    ...store.getConfig(), autoMode: true, openingDurationSec: 0.01,
    roundDurationSec: 0.01, resultsDurationSec: 0.01, intermissionDurationSec: 0.01
  });
  const engine = new ArenaEngine(store, { phaseIntervalMs:10, gameIntervalMs:5 });
  engine.start();
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.ok(engine.getState().roundNumber >= 2);
  assert.ok(store.rounds().length >= 1);
  engine.shutdown();
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('central de testes: itens, áudio e trava durante transmissão real', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-testcenter-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  store.saveConfig({ ...store.getConfig(), openingDurationSec: 0.05, roundDurationSec: 600, gameMode: 'race' });
  const engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 20, audioSafeMode: false });
  const cues: Array<{ trigger: string }> = [];
  engine.on('audio', cue => cues.push(cue));
  try {
    assert.equal(engine.isBroadcasting(), false);
    assert.throws(() => engine.testRaceItem('lula', 'turbo'), /Inicie a corrida/);

    engine.start();
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(engine.getState().phase, 'live');

    assert.equal(engine.testRaceItem('lula', 'escudo').applied, true);
    assert.ok(engine.getState().game.lula.shield > 0);
    assert.equal(engine.testRaceItem('lula', 'tropeco').applied, false, 'escudo anula o tropeço');
    assert.equal(engine.testRaceItem('bolsonaro', 'turbo', 2).applied, true);
    assert.equal(engine.getState().game.bolsonaro.boost, 100);

    assert.equal(engine.testAudioTrigger('stumble', null).fired, true);
    assert.ok(cues.some(cue => cue.trigger === 'stumble'));

    assert.equal(engine.testFinish('lula').applied, true);
    assert.equal(engine.getState().phase, 'results');
    assert.equal(engine.getState().game.winner, 'lula');

    // com o conector ativo, a central bloqueia disparos em massa
    engine.setConnector('connected', 'teste', '@demo');
    assert.equal(engine.isBroadcasting(), true);
  } finally {
    engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('servidor inicia um único ciclo automático e mantém as durações sincronizadas', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-autostart-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  const engine = new ArenaEngine(store, { phaseIntervalMs: 10, gameIntervalMs: 10 });
  try {
    assert.equal(engine.getConfig().autoMode, true);
    assert.equal(engine.getConfig().raceDurationSec, 120);
    assert.equal(engine.getConfig().roundDurationSec, 120);
    assert.equal(engine.getConfig().resultsDurationSec, 10);

    engine.ensureAutomaticCycle();
    engine.ensureAutomaticCycle();
    assert.equal(engine.getState().roundNumber, 1, 'chamadas repetidas não podem abrir rodadas simultâneas');
    assert.equal(engine.getState().automationStage, 'countdown');

    engine.updateConfig({ raceDurationSec: 300 });
    assert.equal(engine.getConfig().roundDurationSec, 300);
    engine.updateConfig({ roundDurationSec: 420 });
    assert.equal(engine.getConfig().raceDurationSec, 420);

    engine.stopCycle();
    assert.equal(engine.getConfig().autoMode, false);
    assert.equal(engine.getState().automationStage, 'preparation');
  } finally {
    engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
