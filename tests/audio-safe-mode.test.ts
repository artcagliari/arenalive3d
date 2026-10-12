import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';

test('AUDIO_SAFE_MODE: o servidor sempre inicia em silêncio, mesmo que o áudio tenha sido ativado antes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-safe-'));
  const file = path.join(directory, 'test.sqlite');
  let store = new Store(file);
  let engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 20 });
  try {
    assert.equal(engine.getConfig().audioSafeMode, true, 'padrão precisa ser modo seguro');
    assert.equal(engine.getState().config.soundEnabled, false, 'clientes recebem som desligado');
    engine.updateConfig({ audioSafeMode: false, soundEnabled: true });
    assert.equal(engine.getState().config.soundEnabled, true);
    engine.shutdown(); store.close();
    // reinicia: o que ficou salvo não importa, volta ao modo seguro
    store = new Store(file);
    engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 20 });
    assert.equal(engine.getConfig().audioSafeMode, true);
    assert.equal(engine.getState().config.soundEnabled, false);
  } finally { engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('AUDIO_SAFE_MODE: uma corrida inteira, com eventos e itens, não emite nenhum som', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-safe-race-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  store.saveConfig({ ...store.getConfig(), raceDurationSec: 15, openingDurationSec: 1, roundDurationSec: 20 });
  const engine = new ArenaEngine(store, { phaseIntervalMs: 20, gameIntervalMs: 10 });
  const cues: string[] = [];
  engine.on('audio', cue => cues.push(cue.trigger));
  try {
    engine.start();
    await new Promise(resolve => setTimeout(resolve, 1_300));
    assert.equal(engine.getState().phase, 'live');
    for (let index = 0; index < 20; index++) engine.receive({ source: 'demo', type: 'comment', externalId: `c${index}`, username: `u${index}`, comment: index % 2 ? '13' : '22' });
    engine.testRaceItem('lula', 'turbo');
    engine.testRaceItem('bolsonaro', 'tropeco');
    assert.equal(engine.testAudio('builtin-boost'), null, 'teste manual também fica mudo');
    assert.equal(engine.testAudioTrigger('overtake', null).fired, false);
    await new Promise(resolve => setTimeout(resolve, 600));
    engine.testFinish('lula');
    assert.equal(engine.getState().phase, 'results', 'a chegada encerra imediatamente mesmo no modo seguro');
    assert.ok(engine.getState().game.winner, 'a corrida precisa terminar normalmente');
    assert.deepEqual(cues, [], 'nenhum som pode ser emitido no modo seguro');

    // ação explícita do operador libera o áudio
    engine.updateConfig({ audioSafeMode: false, soundEnabled: true });
    assert.ok(engine.testAudio('builtin-boost'), 'depois de ATIVAR ÁUDIO o teste toca');
    assert.ok(cues.length >= 1);
  } finally { engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
