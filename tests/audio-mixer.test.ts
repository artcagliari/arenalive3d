import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaAudioMixer } from '../src/audio/arena-audio.js';
import type { AudioCue } from '../src/types.js';

const cue:AudioCue={
  id:'muted-cue',assetId:'builtin-impact',name:'Impacto',category:'hit',trigger:'impact',
  candidate:null,sourceType:'synth',url:null,synthPreset:'impact',volume:70,isSatire:false,
  animation:'impact_burst',priority:50,queuedAt:new Date().toISOString()
};

test('mixer silenciado descarta sons em vez de criar fila atrasada',()=>{
  const mixer=new ArenaAudioMixer();
  mixer.enqueue(cue);
  const diagnostics=mixer.getDiagnostics();
  assert.equal(diagnostics.enabled,false);
  assert.equal(diagnostics.queued,0);
  assert.equal(diagnostics.dropped,1);
  assert.equal(diagnostics.state,'not-started');
});
