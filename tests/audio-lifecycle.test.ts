import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaAudio } from '../src/audio/arena-audio.js';
import type { ArenaConfig, AudioCue, GameState } from '../src/types.js';
import { ArenaEngine } from '../server/engine.js';
import { Store } from '../server/store.js';

class FakeParam {
  value = 1;
  cancelScheduledValues() {}
  setValueAtTime(value:number) { this.value = value; }
  setTargetAtTime(value:number) { this.value = value; }
  exponentialRampToValueAtTime(value:number) { this.value = value; }
}
class FakeNode {
  onended: (()=>void) | null = null;
  connect() { return this; }
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  state:AudioContextState = 'running';
  currentTime = 0;
  destination = new FakeNode();
  listeners = 0;
  createGain() { return Object.assign(new FakeNode(), { gain:new FakeParam() }); }
  createDynamicsCompressor() { return Object.assign(new FakeNode(), { threshold:new FakeParam(), knee:new FakeParam(), ratio:new FakeParam(), attack:new FakeParam(), release:new FakeParam() }); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type:'lowpass', frequency:new FakeParam(), Q:new FakeParam() }); }
  createOscillator() { return Object.assign(new FakeNode(), { type:'sine', frequency:new FakeParam() }); }
  addEventListener() { this.listeners += 1; }
  resume() { this.state='running'; return Promise.resolve(); }
  close() { this.state='closed'; return Promise.resolve(); }
}

const config = { audioSafeMode:false, soundEnabled:true, maxConcurrentSounds:2, effectRepeatMs:100,
  effectsVolume:80, musicVolume:25, categoryVolumes:{ corrida:70, bordoes:90, memes:80, torcida:55, resultado:75 },
  musicEnabled:false, audioMode:'arena' } as ArenaConfig;
const game = { mode:'race', active:true, winner:null } as GameState;
const cue = (round:number):AudioCue => ({ id:`round-${round}`, assetId:`effect-${round}`, name:`Efeito rodada ${round}`,
  category:'alert', trigger:'race_start', candidate:null, sourceType:'synth', url:null, synthPreset:'whistle',
  volume:30, isSatire:false, animation:'none', priority:90, queuedAt:new Date().toISOString() });

test('AudioManager preserva contexto, autorização, volume e buffers por cinco rodadas', async () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable:true, value:{ setTimeout, clearTimeout } });
  const context = new FakeAudioContext();
  const mixer = new ArenaAudio(() => undefined, () => context as unknown as AudioContext);
  try {
    mixer.configure(game, config, true);
    assert.equal((await mixer.authorizeWithTest()).ok, true);
    for (let round=1; round<=5; round++) {
      mixer.observeRound(round);
      mixer.configure(game, config, true);
      mixer.enqueue(cue(round));
      await new Promise(resolve => setTimeout(resolve, 5));
      const diagnostics = mixer.getDiagnostics();
      assert.equal(diagnostics.contextsCreated, 1, `rodada ${round} não pode recriar o AudioContext`);
      assert.equal(diagnostics.authorized, true, `rodada ${round} deve preservar autorização`);
      assert.equal(diagnostics.muted, false);
      assert.equal(diagnostics.masterVolume, 0.4);
    }
    const beforeSafe = mixer.getDiagnostics();
    mixer.configure(game, { ...config, audioSafeMode:true }, false);
    assert.equal(context.state, 'running', 'modo seguro silencia, mas não fecha o contexto da página');
    mixer.configure(game, config, true);
    const after = mixer.getDiagnostics();
    assert.equal(after.contextsCreated, 1);
    assert.equal(after.authorized, true);
    assert.equal(after.roundsObserved, 5);
    assert.ok((after.played ?? 0) >= 5);
    assert.equal(after.errors, 0);
    assert.equal(context.listeners, 1, 'um único listener de estado deve existir');
    assert.equal(beforeSafe.pageLoadId, after.pageLoadId, 'a sessão do overlay não pode mudar entre rodadas');
  } finally {
    mixer.shutdown();
    Object.defineProperty(globalThis, 'window', { configurable:true, value:originalWindow });
  }
});

test('integração mantém eventos sonoros em cinco corridas automáticas consecutivas', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-audio-five-rounds-'));
  const store = new Store(path.join(directory, 'test.sqlite'));
  fs.mkdirSync(path.join(directory,'audio'),{recursive:true});
  fs.writeFileSync(path.join(directory,'audio','bordao-teste.mp3'),Buffer.from('ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000'));
  store.attachAudioFile('slot-lula-impulso','bordao-teste.mp3','audio/mpeg',.5);
  store.saveAudioAsset({ ...store.audioAsset('slot-lula-impulso')!, name:'Bordão cadastrado de teste', enabled:true, maxFrequencySec:0 });
  store.saveConfig({ ...store.getConfig(), autoMode:true, audioSafeMode:false, soundEnabled:true,
    gameMode:'race', openingDurationSec:.02, roundDurationSec:.06, raceDurationSec:1,
    resultsDurationSec:.02, intermissionDurationSec:.02 });
  const engine = new ArenaEngine(store, { phaseIntervalMs:5, gameIntervalMs:5, audioSafeMode:false });
  const tested = new Set<number>();
  const cues:Array<{ round:number; name:string }> = [];
  engine.on('audio', item => cues.push({ round:engine.getState().roundNumber, name:item.name }));
  try {
    engine.ensureAutomaticCycle();
    const deadline = Date.now()+3_000;
    while ((tested.size<5 || store.rounds().length<5) && Date.now()<deadline) {
      const state=engine.getState();
      if (state.phase==='live' && !tested.has(state.roundNumber) && state.roundNumber<=5) {
        tested.add(state.roundNumber);
        engine.receive({ source:'demo', type:'gift', externalId:`gift-round-${state.roundNumber}`,
          username:`tester-${state.roundNumber}`, giftId:'__demo', forcedCandidate:state.roundNumber%2?'lula':'bolsonaro' });
        assert.ok(engine.testAudio('builtin-boost'), `efeito da rodada ${state.roundNumber}`);
        assert.ok(engine.testAudio('slot-lula-impulso'), `bordão cadastrado da rodada ${state.roundNumber}`);
      }
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(tested.size,5);
    assert.ok(store.rounds().length>=5);
    for(let round=1;round<=5;round++) {
      assert.ok(cues.some(item=>item.round===round),`rodada ${round} deve emitir áudio`);
      assert.ok(cues.some(item=>item.round===round&&item.name==='Bordão cadastrado de teste'),`rodada ${round} deve emitir o bordão cadastrado`);
    }
    assert.equal(engine.getConfig().audioSafeMode,false);
    assert.equal(engine.getConfig().soundEnabled,true);
    assert.equal(engine.listenerCount('audio'),1,'listener de áudio não pode duplicar');
  } finally {
    engine.shutdown(); store.close(); fs.rmSync(directory,{recursive:true,force:true});
  }
});
