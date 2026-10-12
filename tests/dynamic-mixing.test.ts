import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaAudio } from '../src/audio/arena-audio.js';
import type { AudioCue, GameState } from '../src/types.js';
import { DEFAULT_CONFIG } from '../server/store.js';

class Param{value=1;cancelScheduledValues(){}setValueAtTime(v:number){this.value=v}setTargetAtTime(v:number){this.value=v}exponentialRampToValueAtTime(v:number){this.value=v}}
class Node{onended:(()=>void)|null=null;connect(){return this}disconnect(){}start(){}stop(){}}
class Context{state:AudioContextState='running';currentTime=0;destination=new Node();
  createGain(){return Object.assign(new Node(),{gain:new Param()})}createDynamicsCompressor(){return Object.assign(new Node(),{threshold:new Param(),knee:new Param(),ratio:new Param(),attack:new Param(),release:new Param()})}
  createBiquadFilter(){return Object.assign(new Node(),{type:'lowpass',frequency:new Param(),Q:new Param()})}createOscillator(){return Object.assign(new Node(),{type:'sine',frequency:new Param()})}
  addEventListener(){}resume(){this.state='running';return Promise.resolve()}close(){this.state='closed';return Promise.resolve()}}

const game={mode:'race',active:true,winner:null} as GameState;
const wait=(ms=15)=>new Promise(resolve=>setTimeout(resolve,ms));
const make=(id:string,name:string,category:AudioCue['category'],trigger:AudioCue['trigger'],priority=70,preset='crowd'):AudioCue=>({id,assetId:id,name,category,trigger,candidate:'lula',sourceType:'synth',url:null,synthPreset:preset,volume:45,isSatire:false,animation:'none',priority,queuedAt:new Date().toISOString()});
const voice=(id:string,priority=70)=>make(id,`Bordão ${id}`,'lula_catchphrase','boost',priority,'crowd');
const sfx=(id:string)=>make(id,`SFX ${id}`,'gift','gift_received',55,'gift');
const finish=()=>make('finish','Chegada','result','round_end',110,'fanfare');

async function mixer(){
  const original=globalThis.window;Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout,clearTimeout}});
  const context=new Context();const audio=new ArenaAudio(()=>undefined,()=>context as unknown as AudioContext);
  audio.configure(game,{...DEFAULT_CONFIG,audioSafeMode:false,soundEnabled:true,dynamicMixingEnabled:true,maxConcurrentSounds:3,minCatchphraseIntervalSec:1,maxCatchphraseDurationSec:3},true);
  assert.equal((await audio.authorizeWithTest()).ok,true);audio.observeRound(1);audio.observeRound(2);await wait();
  return{audio,context,restore:()=>{audio.shutdown();Object.defineProperty(globalThis,'window',{configurable:true,value:original})}};
}

test('A: bordão igual ou mais prioritário substitui o anterior com canal VOICE único',async()=>{const{audio,restore}=await mixer();try{
  audio.enqueue(voice('um',60));await wait();audio.enqueue(voice('dois',60));await wait(130);
  const d=audio.getDiagnostics();assert.ok(d.playing?.includes('Bordão dois'));assert.ok(!d.playing?.includes('Bordão um'));assert.equal(d.errors,0);
  audio.enqueue(voice('atrasado',40));await wait();const afterLowPriority=audio.getDiagnostics();
  assert.ok(!afterLowPriority.playing?.includes('Bordão atrasado'),'bordão menos prioritário perdeu relevância e deve ser descartado');
}finally{restore()}});

test('B: turbo SFX toca junto com um bordão sem criar outro AudioContext',async()=>{const{audio,restore}=await mixer();try{
  audio.enqueue(voice('principal'));await wait();audio.enqueue(make('turbo','Turbo','gift','special',65,'boost'));await wait();
  const d=audio.getDiagnostics();assert.ok(d.playing?.includes('Bordão principal'));assert.ok(d.playing?.includes('Turbo'));assert.equal(d.contextsCreated,1);assert.equal(d.errors,0);
}finally{restore()}});

test('C: cinco presentes rápidos respeitam máximo de três SFX e não acumulam fila',async()=>{const{audio,restore}=await mixer();try{
  for(let i=1;i<=5;i++)audio.enqueue(sfx(String(i)));await wait();const d=audio.getDiagnostics();
  assert.ok((d.playing??[]).filter(name=>name.startsWith('SFX ')).length<=3);assert.equal(d.queued,0);assert.ok(d.dropped>=2);assert.equal(d.errors,0);
}finally{restore()}});

test('D: chegada interrompe VOICE/SFX antigos e assume PRIORITY',async()=>{const{audio,restore}=await mixer();try{
  audio.enqueue(voice('antes'));audio.enqueue(sfx('antigo'));await wait();audio.enqueue(finish());await wait(130);const d=audio.getDiagnostics();
  assert.ok(d.playing?.includes('Chegada'));assert.ok(!d.playing?.includes('Bordão antes'));assert.ok(!d.playing?.includes('SFX antigo'));assert.equal(d.errors,0);
}finally{restore()}});

test('F: Silenciar Tudo encerra todos os canais e esvazia a fila imediatamente',async()=>{const{audio,restore}=await mixer();try{
  audio.enqueue(voice('mute'));audio.enqueue(sfx('mute'));audio.enqueue(finish());await wait();audio.muteAll();const d=audio.getDiagnostics();
  assert.equal(d.active,0);assert.equal(d.queued,0);assert.equal(d.muted,true);assert.equal(d.masterVolume,0);
}finally{restore()}});
