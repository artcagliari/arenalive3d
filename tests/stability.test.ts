import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';

const delay = (ms:number) => new Promise(resolve => setTimeout(resolve, ms));

test('ensaio contínuo executa rodadas silenciosas e rajadas sem crescimento descontrolado', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-stability-'));
  const store=new Store(path.join(directory,'test.sqlite'));
  store.saveConfig({...store.getConfig(),autoMode:true,gameMode:'alternate',openingDurationSec:.015,roundDurationSec:.035,resultsDurationSec:.015,intermissionDurationSec:.015,maxConcurrentSounds:2});
  const engine=new ArenaEngine(store,{phaseIntervalMs:5,gameIntervalMs:3,audioSafeMode:false});
  const injected=new Set<number>(),memorySamples:number[]=[];
  engine.start();
  const deadline=Date.now()+4_000;
  try {
    while((engine.getState().roundNumber<15||store.rounds().length<13)&&Date.now()<deadline){
      const state=engine.getState();
      memorySamples.push(process.memoryUsage().heapUsed);
      if(state.phase==='live'&&state.roundNumber>1&&!injected.has(state.roundNumber)){
        injected.add(state.roundNumber);
        engine.receive({source:'demo',type:'comment',externalId:`comment-${state.roundNumber}`,username:'teste_comentario',comment:state.config.lulaKeyword});
        for(let index=0;index<24;index++)engine.receive({source:'demo',type:'gift',externalId:`gift-${state.roundNumber}-${index}`,username:`teste_${index}`,giftId:'demo',forcedCandidate:index%2?'lula':'bolsonaro'});
        engine.receive({source:'demo',type:'gift',externalId:`gift-${state.roundNumber}-0`,username:'duplicado',giftId:'demo',forcedCandidate:'lula'});
      }
      await delay(4);
    }
    const diagnostics=engine.getDiagnostics();
    assert.ok(engine.getState().roundNumber>=15,'o ciclo automático não completou rodadas suficientes');
    assert.ok(store.rounds().length>=13,'resultados consecutivos não foram persistidos');
    assert.ok(diagnostics.eventsAccepted>=25,'comentários e rajadas não foram processados');
    assert.ok(diagnostics.eventsDiscarded>=1,'evento duplicado não foi descartado');
    assert.ok(diagnostics.audioCues>0,'gatilhos de áudio não foram emitidos');
    const spread=(Math.max(...memorySamples)-Math.min(...memorySamples))/1024/1024;
    assert.ok(spread<64,`variação de heap acima do limite do ensaio: ${spread.toFixed(1)} MB`);
  } finally {
    engine.shutdown();store.close();fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('watchdog do motor restaura o último estado após uma falha isolada', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-recovery-'));
  const store=new Store(path.join(directory,'test.sqlite'));
  store.saveConfig({...store.getConfig(),openingDurationSec:.01,roundDurationSec:.5});
  let shouldFail=true;
  const engine=new ArenaEngine(store,{phaseIntervalMs:5,gameIntervalMs:5,gameRandom:()=>{if(shouldFail){shouldFail=false;throw new Error('falha injetada pelo teste')}return .5}});
  try {
    engine.start();await delay(350);
    assert.ok(engine.getDiagnostics().gameRecoveries>=1);
    assert.equal(engine.getState().phase,'live');
    assert.equal(engine.getState().game.active,true);
    assert.ok(store.recentLogs(5).some(log=>log.message.includes('estado persistido restaurado')));
  } finally {
    engine.shutdown();store.close();fs.rmSync(directory,{recursive:true,force:true});
  }
});
