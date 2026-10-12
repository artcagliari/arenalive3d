import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaEngine } from '../server/engine.js';
import { GameSimulation } from '../server/game-simulation.js';
import { Store } from '../server/store.js';
import { raceProgressPercent } from '../src/types.js';

function runUntilWinner(game:GameSimulation,maxTicks=2_000){for(let i=0;i<maxTicks&&!game.getState().winner;i++)game.tick(.05,3);return game.getState()}

test('Lula chega a 100% com tempo restante e a corrida para imediatamente',()=>{
  const game=new GameSimulation(undefined,()=>.5);game.reset('race',1,{durationSec:20,eventFrequency:1});game.start();game.raceItem('lula','turbo',3,20);
  const state=runUntilWinner(game);
  assert.equal(state.winner,'lula');assert.equal(state.lula.raceProgress,1);assert.equal(state.active,false);assert.ok((state.raceElapsedSec??20)<20);
});

test('Bolsonaro chega a 100% com tempo restante e a corrida para imediatamente',()=>{
  const game=new GameSimulation(undefined,()=>.5);game.reset('race',1,{durationSec:20,eventFrequency:1});game.start();game.raceItem('bolsonaro','turbo',3,20);
  const state=runUntilWinner(game);
  assert.equal(state.winner,'bolsonaro');assert.equal(state.bolsonaro.raceProgress,1);assert.equal(state.active,false);assert.ok((state.raceElapsedSec??20)<20);
});

test('tempo máximo sem chegada decide pela distância, incluindo empate efetivo',()=>{
  const ahead=new GameSimulation(undefined,()=>.5);ahead.reset('race',1,{durationSec:120,eventFrequency:1});ahead.start();ahead.raceItem('lula','impulso',2);for(let i=0;i<20;i++)ahead.tick(.05,3);
  assert.equal(ahead.finish(),'lula');
  const tied=new GameSimulation(undefined,()=>.5);tied.reset('race',1,{durationSec:120,eventFrequency:1});tied.start();
  assert.equal(tied.finish(),'tie');
});

test('cruzamento no mesmo ciclo usa interpolação e registra empate quando indistinguível',()=>{
  const game=new GameSimulation(undefined,()=>.5);game.reset('race',1,{durationSec:1,eventFrequency:1});game.start();
  const state=runUntilWinner(game,100);
  assert.equal(state.lula.raceProgress,1);assert.equal(state.bolsonaro.raceProgress,1);assert.equal(state.winner,'tie');
});

test('presente que fornece turbo pode provocar chegada antes do limite',()=>{
  const game=new GameSimulation(undefined,()=>.5);game.reset('race',1,{durationSec:20,eventFrequency:1});game.start();game.interaction('lula','gift',100);
  const state=runUntilWinner(game);
  assert.equal(state.winner,'lula');assert.equal(state.lula.raceProgress,1);assert.ok((state.raceElapsedSec??20)<20);
});

test('percentual visual só mostra 100 quando o progresso interno chegou a 1',()=>{
  assert.equal(raceProgressPercent(.9999),99);assert.equal(raceProgressPercent(1),100);assert.equal(raceProgressPercent(1.2),100);
});

test('chegada salva uma vez e o ciclo automático abre nova corrida zerada com áudio',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-finish-cycle-'));const store=new Store(path.join(directory,'test.sqlite'));
  for(const asset of store.audioAssets().filter(item=>item.trigger==='race_start'))store.saveAudioAsset({...asset,maxFrequencySec:0});
  store.saveConfig({...store.getConfig(),autoMode:true,audioSafeMode:false,soundEnabled:true,gameMode:'race',openingDurationSec:.02,roundDurationSec:10,raceDurationSec:1,resultsDurationSec:.03,intermissionDurationSec:.03});
  const engine=new ArenaEngine(store,{phaseIntervalMs:5,gameIntervalMs:5,audioSafeMode:false,gameRandom:()=>.5});const starts:number[]=[];
  engine.on('audio',cue=>{if(cue.trigger==='race_start')starts.push(engine.getState().roundNumber)});
  try{
    engine.ensureAutomaticCycle();const deadline=Date.now()+3_000;let sawResults=false,sawReset=false;
    while(Date.now()<deadline&&!(sawResults&&sawReset&&starts.includes(2))){const state=engine.getState();
      if(state.roundNumber===1&&state.phase==='results'){sawResults=true;assert.ok(state.game.winner);assert.equal(state.game.active,false);assert.equal(store.rounds().length,1);assert.equal(engine.receive({source:'demo',type:'comment',externalId:'late',username:'late',comment:'13'}).accepted,false)}
      if(state.roundNumber===2&&state.phase==='opening'){sawReset=true;assert.equal(state.game.lula.raceProgress,0);assert.equal(state.game.bolsonaro.raceProgress,0);assert.equal(state.game.winner,null)}
      await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(sawResults,true);assert.equal(sawReset,true);assert.deepEqual(starts.slice(0,2),[1,2]);assert.equal(store.rounds().filter(round=>round.roundNumber===1).length,1);
  }finally{engine.shutdown();store.close();fs.rmSync(directory,{recursive:true,force:true})}
});
