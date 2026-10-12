import assert from 'node:assert/strict';
import test from 'node:test';
import { GameSimulation, modeForRound } from '../server/game-simulation.js';

test('modo alternado começa pela corrida, o modo principal', () => {
  assert.equal(modeForRound('alternate', 1), 'race');
  assert.equal(modeForRound('alternate', 2), 'battle');
  assert.equal(modeForRound('battle', 8), 'battle');
  assert.equal(modeForRound('race', 3), 'race');
});

test('batalha autônoma movimenta personagens, detecta alcance e causa impacto', () => {
  const game = new GameSimulation(undefined, () => 0.1);
  game.reset('battle', 1);
  game.start();
  for (let index = 0; index < 900 && !game.getState().winner; index++) game.tick(0.1, 3);
  const state = game.getState();
  assert.ok(state.lula.energy < 100 || state.bolsonaro.energy < 100);
  assert.ok(state.simulationTick > 10);
  assert.ok(state.winner || state.lula.energy !== state.bolsonaro.energy || state.effect?.kind === 'impact');
});

test('lutadores permanecem dentro da arena e não atravessam um ao outro', () => {
  let seed = 42;
  const random = () => ((seed = seed * 1_664_525 + 1_013_904_223 >>> 0) / 0x1_0000_0000);
  const game = new GameSimulation(undefined, random);
  const actions = new Set<string>();
  for (let round = 1; round <= 40; round++) {
    game.reset('battle', round); game.start();
    for (let tick = 0; tick < 1_200 && !game.getState().winner; tick++) {
      game.tick(0.1, 5);
      const state = game.getState();
      actions.add(state.lula.action); actions.add(state.bolsonaro.action);
      assert.ok(state.lula.x >= -3.1 && state.lula.x <= 3.1);
      assert.ok(state.bolsonaro.x >= -3.1 && state.bolsonaro.x <= 3.1);
      assert.ok(state.bolsonaro.x - state.lula.x >= 0.899);
      assert.ok(Math.abs(state.lula.z) <= 0.36 && Math.abs(state.bolsonaro.z) <= 0.36);
    }
  }
  assert.ok(actions.has('attack'));
  assert.ok(actions.has('block'));
  assert.ok(actions.has('dodge'));
});

test('presente ativa especial real no simulador e altera energia do oponente', () => {
  const game = new GameSimulation(undefined, () => 0.5);
  game.reset('battle', 1);
  game.start();
  game.interaction('lula', 'gift', 50);
  const state = game.getState();
  assert.equal(state.lula.action, 'special');
  assert.equal(state.effect?.kind, 'special');
  assert.ok(state.bolsonaro.energy < 100);
});

test('corrida progride, acelera e declara vencedor sem interações', () => {
  const game = new GameSimulation(undefined, () => 0.35);
  game.reset('race', 2);
  game.start();
  for (let index = 0; index < 2_000 && !game.getState().winner; index++) game.tick(0.1, 3);
  const state = game.getState();
  assert.ok(state.lula.raceProgress > 0.9 || state.bolsonaro.raceProgress > 0.9);
  assert.ok(state.winner);
  assert.equal(state.active, false);
});
