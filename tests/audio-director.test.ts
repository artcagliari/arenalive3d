import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AudioDirector } from '../server/audio-director.js';
import { Store } from '../server/store.js';
import type { ArenaConfig, AudioAsset } from '../src/types.js';

function customAsset(id:string,name:string,trigger:AudioAsset['trigger'],category:AudioAsset['category']='satire_meme'):AudioAsset{return{id,name,category,trigger,candidate:null,sourceType:'synth',fileName:null,mimeType:null,synthPreset:'fanfare',volume:70,enabled:true,maxFrequencySec:0,playMode:'sequential',isSatire:true,licenseNote:'Conteúdo original de teste.',animation:'camera_flash',priority:60,createdAt:new Date().toISOString()}}

test('biblioteca inicial traz efeitos originais e vagas de bordão vazias',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-audio-seed-')),store=new Store(path.join(directory,'test.sqlite'));
  const assets=store.audioAssets();
  assert.ok(assets.length>=10);
  const effects=assets.filter(asset=>asset.sourceType==='synth');
  const slots=assets.filter(asset=>asset.sourceType==='upload');
  // Os efeitos que já tocam são procedurais, originais e nunca atribuídos a uma pessoa real.
  assert.ok(effects.length>=10);
  assert.ok(effects.every(asset=>asset.licenseNote.includes('original')));
  assert.ok(effects.every(asset=>!asset.category.includes('catchphrase')&&!asset.isSatire));
  // As vagas de bordão existem, mas nenhuma vem com arquivo: nada é inventado.
  assert.ok(slots.length>=6,'precisa haver vagas de bordão para Lula, Bolsonaro e memes');
  assert.ok(slots.every(asset=>asset.pending&&!asset.fileName&&!asset.enabled));
  assert.ok(slots.some(asset=>asset.category==='lula_catchphrase'));
  assert.ok(slots.some(asset=>asset.category==='bolsonaro_catchphrase'));
  assert.ok(slots.some(asset=>asset.category==='satire_meme'));
  assert.equal(slots.filter(asset=>asset.candidate==='lula').length,5);
  assert.equal(slots.filter(asset=>asset.candidate==='bolsonaro').length,5);
  assert.ok(slots.some(asset=>asset.candidate==='lula'&&asset.trigger==='overtake'));
  assert.ok(slots.some(asset=>asset.candidate==='bolsonaro'&&asset.trigger==='stumble'));
  // Uma vaga vazia nunca pode chegar ao overlay.
  assert.ok(store.playableAudioAssets().every(asset=>asset.sourceType==='synth'));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
});

test('duração detectada no upload fica persistida no catálogo',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-audio-duration-')),store=new Store(path.join(directory,'test.sqlite'));
  fs.mkdirSync(path.join(directory,'audio'),{recursive:true});
  fs.writeFileSync(path.join(directory,'audio','curto.ogg'),'conteudo de teste');
  store.attachAudioFile('slot-lula-impulso','curto.ogg','audio/ogg',1.37);
  const asset=store.audioAsset('slot-lula-impulso');
  assert.equal(asset?.durationSec,1.37);
  store.close();fs.rmSync(directory,{recursive:true,force:true});
});

test('vaga sem arquivo nunca toca, e passa a tocar depois do upload',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-audio-slot-')),store=new Store(path.join(directory,'test.sqlite'));
  const director=new AudioDirector(store,()=>({...store.getConfig(),audioSafeMode:false,audioMode:'arena',minCatchphraseIntervalSec:0}),()=>0);

  const slot=store.audioAsset('slot-lula-impulso');
  assert.ok(slot&&slot.pending,'a vaga de impulso do Lula precisa existir vazia');
  store.saveAudioAsset({...slot!,enabled:true});
  assert.equal(director.test('slot-lula-impulso'),null,'sem arquivo, o teste manual não emite som');
  assert.ok(!store.playableAudioAssets().some(asset=>asset.id==='slot-lula-impulso'));

  // Simula o upload: o arquivo precisa existir em data/audio para valer.
  fs.mkdirSync(path.join(directory,'audio'),{recursive:true});
  fs.writeFileSync(path.join(directory,'audio','bordao.mp3'),'conteudo de teste');
  store.attachAudioFile('slot-lula-impulso','bordao.mp3','audio/mpeg');
  const ready=store.audioAsset('slot-lula-impulso')!;
  assert.equal(ready.pending,false);
  assert.equal(ready.fileMissing,false);
  assert.equal(ready.url,'/api/audio/files/slot-lula-impulso');
  assert.ok(store.playableAudioAssets().some(asset=>asset.id==='slot-lula-impulso'));
  // Isolando o efeito original, o bordão do Lula sai no impulso do Lula
  // e nunca no impulso do adversário.
  store.saveAudioAsset({...store.audioAsset('builtin-boost')!,enabled:false});
  assert.equal(director.trigger('boost','lula')?.assetId,'slot-lula-impulso');
  assert.equal(director.trigger('boost','bolsonaro'),null,'bordão de um lado não toca para o outro');

  // Arquivo apagado por fora: volta a ser inaudível e é sinalizado no painel.
  fs.rmSync(path.join(directory,'audio','bordao.mp3'));
  assert.equal(store.audioAsset('slot-lula-impulso')!.fileMissing,true);
  assert.ok(!store.playableAudioAssets().some(asset=>asset.id==='slot-lula-impulso'));
  store.close();fs.rmSync(directory,{recursive:true,force:true});
});

test('diretor respeita modo discreto e libera substituição por sátira de mesma prioridade',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-audio-mode-')),store=new Store(path.join(directory,'test.sqlite'));
  store.saveAudioAsset(customAsset('satire-a','Sátira A','comment_received'));
  store.saveAudioAsset(customAsset('satire-b','Sátira B','comment_received'));
  let config:ArenaConfig={...store.getConfig(),audioSafeMode:false,audioMode:'discreet',minCatchphraseIntervalSec:30};
  const director=new AudioDirector(store,()=>config,()=>0);
  assert.equal(director.trigger('comment_received'),null);
  config={...config,audioMode:'memes'};
  assert.equal(director.trigger('comment_received')?.assetId,'satire-a');
  // A segunda deixa o servidor para que o canal VOICE substitua suavemente a
  // anterior; o intervalo continua bloqueando apenas eventos menos prioritários.
  assert.equal(director.trigger('comment_received')?.assetId,'satire-b');
  store.close();fs.rmSync(directory,{recursive:true,force:true});
});

test('diretor alterna sons sequenciais e preserva prioridade/animacao',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-audio-sequence-')),store=new Store(path.join(directory,'test.sqlite'));
  const first={...customAsset('voice-a','A','comment_received','alert'),isSatire:false,priority:72,animation:'shield'};
  const second={...customAsset('voice-b','B','comment_received','alert'),isSatire:false,priority:55,animation:'speed_lines'};
  store.saveAudioAsset(first);store.saveAudioAsset(second);
  const director=new AudioDirector(store,()=>({...store.getConfig(),audioSafeMode:false,audioMode:'arena'}),()=>0);
  const a=director.trigger('comment_received'),b=director.trigger('comment_received');
  assert.ok(a&&b);assert.notEqual(a.assetId,b.assetId);assert.equal(a.priority,72);assert.equal(a.animation,'shield');
  store.close();fs.rmSync(directory,{recursive:true,force:true});
});

test('impacto, defesa e esquiva emitem efeitos próprios',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arena-audio-effects-')),store=new Store(path.join(directory,'test.sqlite'));
  const director=new AudioDirector(store,()=>({...store.getConfig(),audioSafeMode:false,audioMode:'arena'}),()=>0);
  const triggers:string[]=[];director.on('cue',cue=>triggers.push(cue.trigger));
  director.recordGameEffect({id:1,kind:'impact',candidate:'lula',intensity:1});
  director.recordGameEffect({id:2,kind:'shield',candidate:'bolsonaro',intensity:1});
  director.recordGameEffect({id:3,kind:'dodge',candidate:'lula',intensity:1});
  director.recordGameEffect({id:4,kind:'impact',candidate:'bolsonaro',intensity:1});
  director.recordGameEffect({id:5,kind:'impact',candidate:'lula',intensity:1});
  assert.deepEqual(triggers,['impact','defense','dodge','combo']);
  store.close();fs.rmSync(directory,{recursive:true,force:true});
});
