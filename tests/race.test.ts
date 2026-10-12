import assert from 'node:assert/strict';
import test from 'node:test';
import { GameSimulation } from '../server/game-simulation.js';
import type { Candidate } from '../src/types.js';

function seeded(seed = 7) {
  return () => ((seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000);
}

function runRace(random: () => number, ticks = 3_000) {
  const game = new GameSimulation(undefined, random);
  game.reset('race', 1, { distanceM: 400, eventFrequency: 3 });
  game.start();
  for (let index = 0; index < ticks && !game.getState().winner; index++) game.tick(0.1, 3);
  return game;
}

test('a corrida roda sozinha, mantém os dois avançando e declara um vencedor', () => {
  const game = runRace(seeded(11));
  const state = game.getState();
  assert.ok(state.winner, 'a corrida precisa terminar sem nenhuma interação');
  assert.equal(state.active, false);
  assert.ok(Math.max(state.lula.raceProgress, state.bolsonaro.raceProgress) >= 1);
  assert.ok(Math.min(state.lula.raceProgress, state.bolsonaro.raceProgress) > 0.5, 'o perdedor também precisa correr');
  assert.equal(state.raceDistanceM, 400);
  assert.ok(state.finalSprint, 'a reta final precisa ser sinalizada');
});

test('eventos automáticos de pista acontecem mesmo sem público', () => {
  let items = { impulso: 0, arrancada: 0, turbo: 0, escudo: 0, tropeco: 0 };
  for (let seed = 1; seed <= 6; seed++) {
    const state = runRace(seeded(seed * 97)).getState();
    for (const candidate of ['lula', 'bolsonaro'] as Candidate[]) {
      for (const [key, value] of Object.entries(state[candidate].items)) {
        items[key as keyof typeof items] += value;
      }
    }
  }
  assert.ok(items.arrancada > 0, 'precisa haver super arrancada automática');
  assert.ok(items.tropeco > 0, 'precisa haver tropeço automático');
  assert.ok(items.impulso + items.escudo > 0, 'precisa haver impulso ou escudo automático');
});

test('a disputa fica equilibrada e ocorrem ultrapassagens', () => {
  let overtakes = 0, closeRaces = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const game = new GameSimulation(undefined, seeded(seed * 31));
    game.reset('race', 1, { distanceM: 400, eventFrequency: 4 });
    game.start();
    const leaders = new Set<string>();
    for (let index = 0; index < 3_000 && !game.getState().winner; index++) {
      game.tick(0.1, 3);
      const state = game.getState();
      if (state.lastOvertakeBy) leaders.add(state.lastOvertakeBy);
      if (state.effect?.kind === 'overtake') overtakes += 1;
    }
    const state = game.getState();
    if (Math.abs(state.lula.raceProgress - state.bolsonaro.raceProgress) < 0.35) closeRaces += 1;
  }
  assert.ok(overtakes > 0, 'a liderança precisa trocar de mãos');
  assert.ok(closeRaces >= 4, 'as corridas precisam terminar disputadas na maioria das vezes');
});

test('comentário dá impulso, presente dá turbo e o escudo anula o tropeço', () => {
  const game = new GameSimulation(undefined, () => 0.5);
  game.reset('race', 1, { distanceM: 400, eventFrequency: 1 });
  game.start();

  game.interaction('lula', 'comment', 18);
  assert.ok(game.getState().lula.boost > 0);
  assert.equal(game.getState().lula.items.impulso, 1);

  game.interaction('bolsonaro', 'gift', 100);
  const afterGift = game.getState();
  assert.equal(afterGift.bolsonaro.items.turbo, 1);
  assert.equal(afterGift.bolsonaro.boost, 100);
  assert.equal(afterGift.effect?.kind, 'turbo');

  assert.equal(game.raceItem('lula', 'escudo'), true);
  assert.ok(game.getState().lula.shield > 0);
  assert.equal(game.raceItem('lula', 'tropeco'), false, 'o escudo precisa anular o tropeço');
  assert.notEqual(game.getState().lula.action, 'stumble');
  assert.equal(game.raceItem('lula', 'tropeco'), true, 'sem escudo, o tropeço acontece');
  assert.equal(game.getState().lula.action, 'stumble');
  assert.equal(game.getState().effect?.kind, 'stumble');
});

test('a distância da pista é configurável e o item só existe no modo corrida', () => {
  const game = new GameSimulation(undefined, () => 0.5);
  game.reset('race', 1, { distanceM: 1_000, eventFrequency: 2 });
  assert.equal(game.getState().raceDistanceM, 1_000);

  game.reset('battle', 2, { distanceM: 1_000 });
  game.start();
  assert.equal(game.raceItem('lula', 'turbo'), false);
  assert.equal(game.getState().lula.items.turbo, 0);
});

test('fora de uma rodada, o cenário segue o modo configurado e não o da última rodada', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { ArenaEngine } = await import('../server/engine.js');
  const { Store } = await import('../server/store.js');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-mode-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  // Estado persistido de uma batalha encerrada, como fica depois de uma rodada antiga.
  const battle = new GameSimulation(undefined, () => 0.5);
  battle.reset('battle', 1);
  store.saveRuntime({
    phase: 'idle', roundNumber: 4, phaseEndsAt: null, roundStartedAt: null,
    lulaPoints: 0, bolsonaroPoints: 0, lulaInteractions: 0, bolsonaroInteractions: 0,
    lulaUsers: [], bolsonaroUsers: [], likes: 0, emergencyReason: null, game: battle.getState()
  });
  store.saveConfig({ ...store.getConfig(), gameMode: 'race', raceDistanceM: 800 });

  const engine = new ArenaEngine(store, { phaseIntervalMs: 50, gameIntervalMs: 50 });
  try {
    assert.equal(engine.getState().game.mode, 'race', 'o overlay parado precisa mostrar a corrida');
    assert.equal(engine.getState().game.raceDistanceM, 800);
    engine.updateConfig({ gameMode: 'battle' });
    assert.equal(engine.getState().game.mode, 'battle', 'trocar o modo deve atualizar o cenário na hora');
    engine.updateConfig({ gameMode: 'race' });
    assert.equal(engine.getState().game.mode, 'race');
  } finally {
    engine.shutdown(); store.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('comandos da central de testes passam pelo motor real', () => {
  const game = new GameSimulation(undefined, () => 0.5);
  game.reset('race', 1, { distanceM: 400, eventFrequency: 1, durationSec: 45 });

  // fora de uma corrida ativa, nada é aplicado
  assert.equal(game.forceOvertake('lula'), false);
  assert.equal(game.forceFinish('lula'), false);

  game.start();
  for (let index = 0; index < 60; index++) game.tick(0.1, 3);
  const before = game.getState();
  const trailing: Candidate = before.lula.raceProgress < before.bolsonaro.raceProgress ? 'lula' : 'bolsonaro';
  const leading: Candidate = trailing === 'lula' ? 'bolsonaro' : 'lula';

  // O caso difícil: o líder está com turbo ativo quando a ultrapassagem é forçada.
  game.raceItem(leading, 'turbo', 2);
  assert.ok(game.getState()[leading].boost > 90, 'o líder precisa estar realmente com turbo');
  assert.equal(game.forceOvertake(trailing), true);
  const armed = game.getState();
  assert.equal(armed[trailing].boost, 100);
  assert.ok(armed[trailing].raceProgress < armed[leading].raceProgress, 'o corredor fica logo atrás antes de passar');

  let overtook = false;
  for (let index = 0; index < 40 && !overtook; index++) {
    game.tick(0.1, 3);
    if (game.getState().lastOvertakeBy === trailing) overtook = true;
  }
  assert.ok(overtook, 'a ultrapassagem precisa acontecer pela detecção normal, em até 4 s');

  assert.equal(game.forceFinish(leading), true);
  assert.equal(game.getState()[leading].raceProgress, 1);
  assert.equal(game.getState().finalSprint, true);
  assert.equal(game.getState().winner,leading,'a chegada simulada encerra imediatamente');
  assert.equal(game.getState().active,false);
});

test('a corrida usa o tempo configurado como limite máximo, não como duração mínima', () => {
  const game = new GameSimulation(undefined, () => 0.5);
  game.reset('race', 1, { durationSec: 120, eventFrequency: 1 });
  game.start();
  game.raceItem('lula', 'turbo', 3, 30);
  for(let index=0;index<1200&&!game.getState().winner;index++)game.tick(0.1,3);
  const finished=game.getState();
  assert.equal(finished.winner,'lula');
  assert.equal(finished.lula.raceProgress,1);
  assert.ok((finished.raceElapsedSec??120)<120,'a chegada deve ocorrer com tempo restante');
});
