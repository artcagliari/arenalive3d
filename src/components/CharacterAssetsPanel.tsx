import { useState, type ChangeEvent } from 'react';
import type { ArenaConfig, Candidate } from '../types';
import { OUTFITS, RACE_OUTFITS, type Outfit } from '../outfits';
import { RunnerPreview } from './RunnerPreview';

/** Prévia 2D do figurino, desenhada a partir da mesma definição usada na cena 3D. */
function OutfitPreview({outfit,face,name}:{outfit:Outfit;face:string;name:string}){
  const w=outfit.build.width,half=36*w,l=60-half,r=60+half,tieLen=46*outfit.build.tieLength/.5;
  return <svg className="outfit-svg" viewBox="0 0 120 168" role="img" aria-label={`Figurino de ${name}: ${outfit.label}`}>
    <rect x={60-half*.62} y="112" width={half*.62*.9} height="52" rx="5" fill={outfit.trousers}/><rect x="60.5" y="112" width={half*.62*.9} height="52" rx="5" fill={outfit.trousers}/>
    <path d={`M${l} 150 L${l-3} 74 Q${l} 56 ${l+14} 54 L${r-14} 54 Q${r} 56 ${r+3} 74 L${r} 150 Z`} fill={outfit.jacket}/>
    {outfit.build.belly>0&&<ellipse cx="60" cy="128" rx={half*.8} ry="16" fill={outfit.jacket}/>}
    <polygon points="48,54 72,54 60,106" fill={outfit.shirt}/>
    <polygon points={`${l+14},54 49,54 60,108 ${60-half*.55},96`} fill={outfit.lapel}/><polygon points={`${r-14},54 71,54 60,108 ${60+half*.55},96`} fill={outfit.lapel}/>
    <polygon points="51,52 60,60 57,50" fill={outfit.shirt}/><polygon points="69,52 60,60 63,50" fill={outfit.shirt}/>
    <polygon points="57,60 63,60 66,66 55,66" fill={outfit.tie}/><polygon points={`55,66 65,66 68,${66+tieLen*.85} 60,${70+tieLen} 52,${66+tieLen*.85}`} fill={outfit.tie}/>
    {outfit.tieStripe&&<><polygon points={`54,${72+tieLen*.15} 66,${68+tieLen*.15} 66,${74+tieLen*.15} 54,${78+tieLen*.15}`} fill={outfit.tieStripe}/><polygon points={`53,${78+tieLen*.4} 67,${74+tieLen*.4} 67,${80+tieLen*.4} 53,${84+tieLen*.4}`} fill={outfit.tieStripe}/></>}
    {outfit.pin==='star'?<><circle cx={60-half*.5} cy="68" r="4.2" fill="#f4f7fa"/><polygon points="0,-3.4 1,-1 3.4,-1 1.5,.6 2.1,3 0,1.6 -2.1,3 -1.5,.6 -3.4,-1 -1,-1" transform={`translate(${60-half*.5} 68)`} fill="#e1281f"/></>:<><rect x={60-half*.5-5} y="64" width="10" height="7" fill="#1f9a4a"/><polygon points={`${60-half*.5},65 ${60-half*.5+3.2},67.5 ${60-half*.5},70 ${60-half*.5-3.2},67.5`} fill="#f4c91d"/></>}
    <rect x={60+half*.5} y="78" width="8" height="5" fill={outfit.pocketSquare}/>
    <rect x={l-9*outfit.build.limb} y="60" width={11*outfit.build.limb} height="68" rx="5" fill={outfit.jacket}/><rect x={r-2*outfit.build.limb} y="60" width={11*outfit.build.limb} height="68" rx="5" fill={outfit.jacket}/>
    <rect x={l-9*outfit.build.limb} y="124" width={11*outfit.build.limb} height="4" fill={outfit.shirt}/><rect x={r-2*outfit.build.limb} y="124" width={11*outfit.build.limb} height="4" fill={outfit.shirt}/>
    <circle cx={l-3.5*outfit.build.limb} cy="133" r="5" fill="#d6a073"/><circle cx={r+3.5*outfit.build.limb} cy="133" r="5" fill="#d6a073"/>
    <image href={face} x="22" y="-4" width="76" height="68" preserveAspectRatio="xMidYMid meet"/>
  </svg>;
}

export function CharacterAssetsPanel({config,token,onMessage}:{config:ArenaConfig;token:string;onMessage:(message:string)=>void}){
  const[busy,setBusy]=useState<Candidate|null>(null);
  const versioned=(url:string)=>`${url}${url.includes('?')?'&':'?'}v=${config.characterAssetVersion}`;
  async function upload(candidate:Candidate,event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];if(!file)return;setBusy(candidate);
    try{const data=new FormData();data.append('image',file);const response=await fetch(`/api/characters/${candidate}`,{method:'POST',headers:{'x-admin-token':token},body:data});const body=await response.json();if(!response.ok)throw new Error(body.error??'Falha ao atualizar personagem.');onMessage(`${candidate==='lula'?'Lula':'Bolsonaro'} atualizado no overlay.`)}catch(error){onMessage(error instanceof Error?error.message:'Falha ao atualizar personagem.')}finally{setBusy(null);event.target.value=''}
  }
  async function setStyle(runnerStyle:'cartoon'|'classic'){
    try{const response=await fetch('/api/config',{method:'PATCH',headers:{'Content-Type':'application/json','x-admin-token':token},body:JSON.stringify({runnerStyle})});
      if(!response.ok)throw new Error((await response.json()).error??'Falha ao trocar o conjunto visual.');
      onMessage(runnerStyle==='cartoon'?'Corredores cartoon 2.5D ativados.':'Corredores em volumes 3D ativados.')}
    catch(error){onMessage(error instanceof Error?error.message:'Falha ao trocar o conjunto visual.')}
  }
  async function command(path:string,message:string){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-admin-token':token},body:'{}'});const body=await response.json();if(!response.ok)throw new Error(body.error??'Falha ao recarregar personagens.');onMessage(message)}
  return <section className="panel character-assets-panel" id="characters">
    <div className="panel-heading"><div><p className="eyebrow">IDENTIDADE VISUAL</p><h2>Personagens da arena</h2></div><button type="button" className="ghost-button" onClick={()=>void command('/api/characters/reload','Texturas recarregadas no overlay.')}>↻ Recarregar personagens</button></div>
    <p className="character-help">Corpo 3D animado com rosto estilizado em textura 2D. Prefira PNG ou WebP transparente, rosto centralizado e arquivo de até 4 MB.</p>
    <div className="character-preview-grid">{(['lula','bolsonaro'] as Candidate[]).map(candidate=>{
      const name=candidate==='lula'?'Lula':'Bolsonaro',url=candidate==='lula'?config.lulaCharacterAsset:config.bolsonaroCharacterAsset;
      return <article key={candidate} className={`character-preview ${candidate}`}><div className="character-portrait"><span>{candidate==='lula'?'LADO VERMELHO':'LADO AZUL'}</span><img src={versioned(url)} alt={`Pré-visualização estilizada de ${name}`}/></div><div><h3>{name}</h3><p>{candidate==='lula'?'Rosto arredondado · barba e cabelo grisalhos':'Rosto alongado · cabelo curto · sem barba'}</p><div className="character-actions"><label className="primary-button">{busy===candidate?'Enviando…':'Trocar asset'}<input disabled={Boolean(busy)} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={event=>void upload(candidate,event)}/></label><button type="button" className="ghost-button" onClick={()=>void command(`/api/characters/${candidate}/reset`,`${name} restaurado para o asset estilizado padrão.`)}>Restaurar padrão</button></div><small>{url}</small></div></article>;
    })}</div>
    <div className="outfit-section">
      <div className="panel-heading"><div><p className="eyebrow">CORREDORES · MODO PRINCIPAL</p><h2>Bonecos da corrida</h2></div><span className="demo-chip">CARTOON VETORIAL · SEM FOTO</span></div>
      <div className="runner-preview-grid">{(['lula','bolsonaro'] as Candidate[]).map(candidate=>{
        const outfit=RACE_OUTFITS[candidate],name=candidate==='lula'?'Lula':'Bolsonaro';
        const url=candidate==='lula'?config.lulaCharacterAsset:config.bolsonaroCharacterAsset;
        return <article key={candidate} className={`runner-card ${candidate}`}>
          <RunnerPreview candidate={candidate} faceUrl={versioned(url)} />
          <div><span className="runner-number">{outfit.number}</span><h3>{name}</h3><p>{outfit.description}</p>
          <div className="outfit-swatches">{[['Camisa',outfit.jersey],['Detalhe',outfit.trim],['Calça',outfit.shorts],['Tênis',outfit.shoe]].map(([label,color])=><span key={label} title={label}><i style={{background:color}}/>{label}</span>)}</div>
          <small>{outfit.id}</small></div>
        </article>;})}</div>
      <p className="character-help">Os corredores da corrida são caricaturas desenhadas em vetor, com corpo, rosto e animações próprios: correndo, turbo, tropeço, reta final, vitória, derrota e largada. Não usam foto. O rosto enviado acima continua valendo para o modo batalha.</p>
    </div>

    <div className="outfit-section"><div className="panel-heading"><div><p className="eyebrow">FIGURINO</p><h2>Roupa dos lutadores (modo batalha)</h2></div></div>
      <div className="character-preview-grid">{(['lula','bolsonaro'] as Candidate[]).map(candidate=>{const outfit=OUTFITS[candidate],name=candidate==='lula'?'Lula':'Bolsonaro',url=candidate==='lula'?config.lulaCharacterAsset:config.bolsonaroCharacterAsset;
        return <article key={candidate} className={`character-preview outfit-preview ${candidate}`}><div className="character-portrait"><span>{outfit.label.toUpperCase()}</span><OutfitPreview outfit={outfit} face={versioned(url)} name={name}/></div><div><h3>{name}</h3><p>{outfit.description}</p><div className="outfit-swatches">{[['Paletó',outfit.jacket],['Gravata',outfit.tie],['Calça',outfit.trousers],['Lenço',outfit.pocketSquare]].map(([label,color])=><span key={label} title={label}><i style={{background:color}}/>{label}</span>)}</div><small>{outfit.id}</small></div></article>;})}</div>
    </div>
    <div className="character-note"><b>SIMULAÇÃO FICTÍCIA</b><span>Estas são representações estilizadas para entretenimento, não imagens de acontecimentos reais.</span></div>
  </section>;
}
