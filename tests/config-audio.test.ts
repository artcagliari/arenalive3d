import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-config-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  const engine = new ArenaEngine(store, { phaseIntervalMs: 50, gameIntervalMs: 50 });
  return { store, engine, cleanup: () => { engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test('trilha de fundo começa desligada e os volumes por categoria têm padrão moderado', () => {
  const { engine, cleanup } = setup();
  try {
    const config = engine.getState().config;
    assert.equal(config.musicEnabled, false, 'a música não pode iniciar sozinha');
    for (const value of Object.values(config.categoryVolumes)) assert.ok(value > 0 && value <= 90);
    assert.equal(config.powerShortcuts.impulso, 'COMENTE {n}');
  } finally { cleanup(); }
});

test('mudar um volume de categoria preserva as demais, inclusive depois de reabrir o banco', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-config-merge-'));
  const file = path.join(directory, 'test.sqlite');
  let store = new Store(file);
  let engine = new ArenaEngine(store, { phaseIntervalMs: 50, gameIntervalMs: 50 });
  try {
    const before = engine.getState().config.categoryVolumes;
    engine.updateConfig({ categoryVolumes: { torcida: 10 } });
    engine.updateConfig({ powerShortcuts: { turbo: 'ROSA' } });
    const after = engine.getState().config;
    assert.equal(after.categoryVolumes.torcida, 10);
    assert.equal(after.categoryVolumes.bordoes, before.bordoes);
    assert.equal(after.powerShortcuts.turbo, 'ROSA');
    assert.equal(after.powerShortcuts.impulso, 'COMENTE {n}');
    engine.shutdown(); store.close();
    store = new Store(file);
    engine = new ArenaEngine(store, { phaseIntervalMs: 50, gameIntervalMs: 50 });
    assert.equal(engine.getState().config.categoryVolumes.torcida, 10);
    assert.equal(engine.getState().config.categoryVolumes.corrida, before.corrida);
  } finally { engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
