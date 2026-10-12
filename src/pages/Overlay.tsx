import { useEffect, useRef, useState } from 'react';
import { ArenaScene } from '../components/ArenaScene';
import { StatusBadge } from '../components/StatusBadge';
import { RaceCommands, RaceFlash, RaceRails, RaceScoreboard } from '../components/RaceHud';
import { useArena, useCountdown } from '../hooks/useArena';
import { getArenaAudio } from '../audio/arena-audio';
import { RaceOverlay } from '../race/RaceOverlay';
import { raceProgressPercent, type ArenaState, type AudioAsset, type AudioCue } from '../types';

function formatTime(total:number){return `${Math.floor(total/60).toString().padStart(2,'0')}:${(total%60).toString().padStart(2,'0')}`}
const actionLabel:Record<string,string>={idle:'observando',advance:'avançando',retreat:'recuando',attack:'golpe de energia',special:'especial',block:'defendendo',dodge:'esquivando',hit:'impacto',celebrate:'comemorando',drive:'acelerando',boost:'turbo',overtake:'ultrapassando',run:'correndo',sprint:'arrancada',stumble:'tropeçou',shielded:'escudo ativo'};

function phaseTitle(state:ArenaState){
  if(state.phase==='opening')return state.game.mode==='battle'?'BATALHA PREPARADA':'CORREDORES NA LARGADA';
  if(state.phase==='results')return state.game.winner==='tie'?'EMPATE':`${state.game.winner==='lula'?'LULA':'BOLSONARO'} VENCE`;
  if(state.phase==='intermission')return 'TROCA DE CENÁRIO';if(state.phase==='paused')return 'JOGO PAUSADO';
  if(state.phase==='emergency')return 'OPERAÇÃO SUSPENSA';if(state.phase==='idle')return 'AGUARDANDO INÍCIO';return '';
}

function CompetitorHud({state,candidate}:{state:ArenaState;candidate:'lula'|'bolsonaro'}){
  const game=state.game[candidate],isRace=state.game.mode==='race',value=isRace?game.raceProgress*100:game.energy;
  return <div className={`competitor-hud ${candidate}`}>
    <div className="hud-name"><span>{candidate==='lula'?'LADO VERMELHO':'LADO AZUL'}</span><b>{candidate==='lula'?'LULA':'BOLSONARO'}</b></div>
    <div className="energy-track"><i style={{width:`${Math.max(0,Math.min(100,value))}%`}} /></div>
    <div className="hud-meta"><span>{isRace?`${raceProgressPercent(game.raceProgress)}% DA PISTA`:`${Math.round(value)} ENERGIA`}</span><em>{actionLabel[game.action]}</em></div>
  </div>;
}

export function Overlay(){
  const{state,connected,audioCue,sendTelemetry}=useArena();const[localMuted,setLocalMuted]=useState(false);const[callout,setCallout]=useState<AudioCue|null>(null);const seconds=useCountdown(state?.phaseEndsAt,state?.serverNow);
  const mixer=useRef(getArenaAudio((assetId,message)=>{void fetch('/api/audio/playback-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetId,message})})}));
  // Biblioteca recarregada quando a configuração muda (ex.: música enviada no painel).
  useEffect(()=>{fetch('/api/audio/library').then(response=>response.json()).then((assets:AudioAsset[])=>mixer.current?.setCatalog(assets)).catch(()=>undefined)},[state?.config.audioSafeMode,state?.config.musicEnabled]);
  // React StrictMode pode executar limpezas de efeito sem fechar a página. O
  // contexto só é destruído no pagehide real; trocar de rodada não passa aqui.
  useEffect(()=>{const shutdown=()=>mixer.current.shutdown();window.addEventListener('pagehide',shutdown,{once:true});return()=>window.removeEventListener('pagehide',shutdown)},[]);
  // Clique ou tecla na página libera o som dentro do gesto (exigência do navegador).
  const[needsClick,setNeedsClick]=useState(false);const[audioNotice,setAudioNotice]=useState('');
  useEffect(()=>{const unlock=()=>{mixer.current.unlock();window.setTimeout(()=>setNeedsClick(mixer.current.needsGesture()),300)};window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock)}},[]);
  useEffect(()=>{if(state)mixer.current?.configure(state.game,state.config,Boolean(state.config.soundEnabled&&!localMuted))},[state?.game.simulationTick,state?.game.mode,state?.config,localMuted]);
  useEffect(()=>{if(state)mixer.current.observeRound(state.roundNumber)},[state?.roundNumber]);
  useEffect(()=>{if(!audioCue)return;mixer.current?.enqueue(audioCue);setCallout(audioCue);const timer=window.setTimeout(()=>setCallout(null),2800);return()=>window.clearTimeout(timer)},[audioCue?.id]);
  useEffect(()=>{
    let animationFrame=0,frames=0,lastSample=performance.now(),fps=0;
    const measure=(now:number)=>{frames+=1;if(now-lastSample>=1000){fps=frames*1000/(now-lastSample);frames=0;lastSample=now}animationFrame=requestAnimationFrame(measure)};
    animationFrame=requestAnimationFrame(measure);
    const timer=window.setInterval(()=>{
      const memory=(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory;
      setNeedsClick(mixer.current.needsGesture());
      sendTelemetry({fps:Math.round(fps*10)/10,memoryMb:memory?Math.round(memory.usedJSHeapSize/1024/1024*10)/10:null,audio:mixer.current!.getDiagnostics()});
    },1000);
    return()=>{cancelAnimationFrame(animationFrame);window.clearInterval(timer)};
  },[sendTelemetry]);
  const toggleSound=()=>setLocalMuted(value=>{const next=!value;mixer.current.setMuted(next);return next});
  const authorizeAudio=async()=>{const result=await mixer.current.authorizeWithTest();setNeedsClick(!result.ok);setAudioNotice(result.message);window.setTimeout(()=>setAudioNotice(''),4_000)};
  if(!state)return <main className="loading-screen"><div className="loader"/><p>Preparando a arena…</p></main>;
  const showCurtain=state.phase!=='live',isRace=state.game.mode==='race';
  const audioAuthorization=<>{needsClick&&<button className="audio-unlock" onClick={()=>void authorizeAudio()}>🔊 HABILITAR ÁUDIO</button>}{audioNotice&&<div className="audio-enable-result">{audioNotice}</div>}</>;
  if(isRace)return <main className="overlay-shell"><RaceOverlay state={state} seconds={seconds} connected={connected} callout={callout} muted={localMuted} onToggleSound={toggleSound}/>{audioAuthorization}</main>;
  return <main className="overlay-shell"><section className={`broadcast-frame interactive-game mode-${state.game.mode}`}>
    <header className="game-header"><div className="brand-kicker"><span/> LIVE ARENA 3D</div><h1>{isRace?<>CORRIDA <em>PRESIDENCIAL</em></>:<>BATALHA <em>FICTÍCIA</em></>}</h1><div className="header-row"><div className="round-pill">RODADA {Math.max(1,state.roundNumber)}</div><div className="mode-chip">{isRace?`PISTA DE ${state.game.raceDistanceM||400} M`:'MODO BATALHA'}</div></div></header>
    <button className="sound-toggle" onClick={toggleSound}>{localMuted?'SOM OFF':'SOM ON'}</button>
    <div className="game-status"><StatusBadge state={state} socketConnected={connected}/></div>
    <div className="game-timer"><span>{state.phase==='live'?'TEMPO DA RODADA':'PRÓXIMA ETAPA'}</span><b>{formatTime(seconds)}</b></div>
    {isRace
      ? <><RaceScoreboard game={state.game}/><div className="race-wins"><span>{state.game.roundWins.lula}</span><b>×</b><span>{state.game.roundWins.bolsonaro}</span><small>CORRIDAS VENCIDAS</small></div></>
      : <section className="combat-hud"><CompetitorHud state={state} candidate="lula"/><div className="round-wins"><span>{state.game.roundWins.lula}</span><b>×</b><span>{state.game.roundWins.bolsonaro}</span><small>VITÓRIAS</small></div><CompetitorHud state={state} candidate="bolsonaro"/></section>}
    <ArenaScene game={state.game} reduced={state.config.reducedMotion} cameraMode={state.config.cameraMode} animationIntensity={state.config.animationIntensity} phase={state.phase} audioCue={audioCue} characterAssets={{lula:state.config.lulaCharacterAsset,bolsonaro:state.config.bolsonaroCharacterAsset}} assetVersion={state.config.characterAssetVersion} runnerStyle={state.config.runnerStyle}/>
    {isRace&&<><RaceRails game={state.game}/><RaceCommands config={state.config}/>{state.phase==='live'&&<RaceFlash game={state.game}/>}</>}
    <section className="interaction-hud">
      <div className="support-score red"><b>{state.lula.points}</b><span>APOIO DA LIVE</span><small>{state.lula.interactions} interações · {state.lula.uniqueUsers} pessoas</small></div>
      <div className="support-center"><span>{isRace?'COMENTE PARA EMPURRAR':'INTERAÇÕES ATIVAM EFEITOS'}</span><i>⌁</i><small>{isRace?'a corrida roda sozinha':'o jogo funciona sozinho'}</small></div>
      <div className="support-score blue"><b>{state.bolsonaro.points}</b><span>APOIO DA LIVE</span><small>{state.bolsonaro.interactions} interações · {state.bolsonaro.uniqueUsers} pessoas</small></div>
    </section>
    <section className="likes-goal game-likes"><div><span>♥</span><p>META COLETIVA<strong>{state.likes.toLocaleString('pt-BR')} / {state.config.likesGoal.toLocaleString('pt-BR')}</strong></p></div><div className="likes-track"><i style={{width:`${Math.min(100,state.likes/state.config.likesGoal*100)}%`}}/></div></section>
    {state.lastEvent&&<div className="event-ticker game-event"><span>{state.lastEvent.source==='demo'?'SIMULAÇÃO':state.lastEvent.type.toUpperCase()}</span>{state.lastEvent.summary}</div>}
    {callout&&<div key={callout.id} className={`audio-callout ${callout.candidate??'neutral'}`}><span>{callout.isSatire?'SÁTIRA / PARÓDIA':callout.category==='crowd'?'TORCIDA':'SOM DA ARENA'}</span><b>{callout.name}</b></div>}
    {showCurtain&&<div className={`phase-curtain game-curtain ${state.phase}`}><span>{isRace?`PISTA OFICIAL · ${state.game.raceDistanceM||400} METROS`:'ARENA DE ENERGIA'}</span><h3>{phaseTitle(state)}</h3>{state.phase==='results'&&<div className="result-score">{state.game.roundWins.lula} <i>×</i> {state.game.roundWins.bolsonaro}</div>}{state.phase==='emergency'&&<p>{state.emergencyReason}</p>}</div>}
    <footer className="disclaimer">SIMULAÇÃO FICTÍCIA DE ENTRETENIMENTO • NÃO É UM ACONTECIMENTO REAL • NÃO REPRESENTA PESQUISA ELEITORAL</footer>
  </section>{audioAuthorization}</main>;
}
