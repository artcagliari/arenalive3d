import { useEffect, useState, type FormEvent } from 'react';
import type { AudioAsset, AudioCategory, AudioTrigger, Candidate } from '../types';

const categories:Record<AudioCategory,string>={lula_catchphrase:'Bordão associado ao 13',bolsonaro_catchphrase:'Bordão associado ao 22',satire_meme:'Meme / provocação satírica',crowd:'Grito de torcida',hit:'Golpe / tropeço',defense:'Defesa / escudo',result:'Vitória / derrota',gift:'Presente / turbo',alert:'Largada / transição',music:'Música de fundo'};
const triggers:Record<AudioTrigger,string>={round_start:'Início da rodada',impact:'Impacto comum',special:'Turbo / golpe especial',defense:'Escudo ativado',dodge:'Esquiva',gift_received:'Presente recebido',comment_received:'Comentário identificado',combo:'Sequência / torcida',scene_change:'Mudança de cenário',round_end:'Encerramento da rodada',victory:'Vitória',defeat:'Derrota',race_start:'Largada da corrida',boost:'Impulso / arrancada',stumble:'Tropeço',overtake:'Ultrapassagem',final_sprint:'Reta final',background_music:'Música de fundo (laço na corrida)'};
const animations:Record<string,string>={none:'Sem animação extra',camera_flash:'Flash de câmera',impact_burst:'Explosão de impacto',special_burst:'Aura especial',shield:'Escudo luminoso',speed_lines:'Linhas de velocidade',gift_glow:'Brilho de presente',crowd_lights:'Luzes da torcida',scene_wipe:'Transição de cena',victory_lights:'Luzes de vitória',lights_down:'Luzes baixas'};

/** As sete seções pedidas para a biblioteca, nesta ordem. */
const GROUPS:Array<{id:string;title:string;hint:string;match:(asset:AudioAsset)=>boolean}>=[
  {id:'musica',title:'Música de fundo',hint:'Arquivo próprio ou licenciado, em laço durante a corrida. Só toca com a trilha ligada.',match:a=>a.category==='music'||a.trigger==='background_music'},
  {id:'lula',title:'Bordões associados ao 13',hint:'Tocam quando o evento acontece do lado do 13.',match:a=>a.category==='lula_catchphrase'},
  {id:'bolsonaro',title:'Bordões associados ao 22',hint:'Tocam quando o evento acontece do lado do 22.',match:a=>a.category==='bolsonaro_catchphrase'},
  {id:'memes',title:'Memes e provocações satíricas',hint:'Sempre identificados como sátira ou paródia no overlay.',match:a=>a.category==='satire_meme'},
  {id:'corrida',title:'Sons de corrida',hint:'Largada, reta final e transições de cenário.',match:a=>['race_start','round_start','final_sprint','scene_change'].includes(a.trigger)&&!a.category.endsWith('catchphrase')&&a.category!=='satire_meme'},
  {id:'ultrapassagem',title:'Sons de ultrapassagem',hint:'Disparados quando a liderança troca de mãos.',match:a=>a.trigger==='overtake'&&a.category!=='satire_meme'},
  {id:'turbo',title:'Sons de turbo',hint:'Impulso de comentário, presente e turbo longo.',match:a=>['boost','special','gift_received'].includes(a.trigger)&&a.category!=='satire_meme'},
  {id:'vitoria',title:'Sons de vitória',hint:'Fim de corrida, vitória e derrota.',match:a=>['victory','defeat','round_end'].includes(a.trigger)&&!a.category.endsWith('catchphrase')},
  {id:'outros',title:'Outros efeitos da arena',hint:'Impacto, escudo, esquiva e torcida.',match:()=>true}
];

function groupOf(asset:AudioAsset){return GROUPS.find(group=>group.match(asset))!.id}
function fileLabel(asset:AudioAsset){
  if(asset.sourceType==='synth')return{text:'EFEITO ORIGINAL DO APP',tone:'synth'};
  if(asset.pending)return{text:'ÁUDIO NÃO CADASTRADO',tone:'pending'};
  if(asset.fileMissing)return{text:'ARQUIVO AUSENTE EM DATA/AUDIO',tone:'missing'};
  return{text:`ARQUIVO ENCONTRADO · ${asset.fileName}`,tone:'ok'};
}

async function audioDuration(file:File):Promise<number|null>{
  const url=URL.createObjectURL(file);
  try{return await new Promise(resolve=>{const audio=new Audio();const done=(value:number|null)=>{audio.removeAttribute('src');resolve(value)};audio.preload='metadata';audio.onloadedmetadata=()=>done(Number.isFinite(audio.duration)?Math.round(audio.duration*100)/100:null);audio.onerror=()=>done(null);audio.src=url})}
  finally{URL.revokeObjectURL(url)}
}

export function AudioLibraryPanel({token,onMessage,simple=false}:{token:string;onMessage:(message:string)=>void;simple?:boolean}){
  const[assets,setAssets]=useState<AudioAsset[]>([]);
  const[file,setFile]=useState<File|null>(null);
  const[busy,setBusy]=useState(false);
  const[showNew,setShowNew]=useState(false);
  const[slot,setSlot]=useState({name:'',category:'lula_catchphrase' as AudioCategory,trigger:'boost' as AudioTrigger,candidate:'lula' as ''|Candidate,volume:80,isSatire:false,licenseNote:'Gravação própria ou áudio licenciado pelo operador.'});
  const[form,setForm]=useState({name:'',category:'satire_meme' as AudioCategory,trigger:'comment_received' as AudioTrigger,candidate:'' as ''|Candidate,volume:80,maxFrequencySec:15,playMode:'random' as 'random'|'sequential',isSatire:true,licenseNote:'Conteúdo original/licenciado pelo proprietário.',animation:'camera_flash',priority:65});
  const headers={'x-admin-token':token};

  const load=async()=>{const response=await fetch('/api/audio/assets',{headers});if(!response.ok)throw new Error('Falha ao carregar a biblioteca.');setAssets(await response.json())};
  useEffect(()=>{void load().catch(error=>onMessage(error.message))},[token]);

  async function upload(event:FormEvent){
    event.preventDefault();
    if(!file)return onMessage('Selecione um arquivo MP3, WAV ou OGG.');
    setBusy(true);
    try{
      const durationSec=await audioDuration(file);
      const data=new FormData();data.append('audio',file);data.append('metadata',JSON.stringify({...form,candidate:form.candidate||null,enabled:true,durationSec}));
      const response=await fetch('/api/audio/assets',{method:'POST',headers,body:data});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'Falha na importação.');
      onMessage(`“${body.name}” importado e disponível no overlay.`);setFile(null);setForm(value=>({...value,name:''}));await load();
    }catch(error){onMessage(error instanceof Error?error.message:'Falha na importação.')}finally{setBusy(false)}
  }

  async function createSlot(event:FormEvent){
    event.preventDefault();setBusy(true);
    try{
      if(simple){
        if(!file)throw new Error('Selecione um arquivo MP3, WAV ou OGG.');
        const durationSec=await audioDuration(file);
        const category:AudioCategory=slot.candidate==='lula'?'lula_catchphrase':slot.candidate==='bolsonaro'?'bolsonaro_catchphrase':'satire_meme';
        const data=new FormData();data.append('audio',file);data.append('metadata',JSON.stringify({name:slot.name,category,trigger:slot.trigger,candidate:slot.candidate||null,volume:slot.volume,enabled:true,maxFrequencySec:15,playMode:'random',isSatire:slot.isSatire,licenseNote:slot.licenseNote,animation:'speed_lines',priority:70,durationSec}));
        const response=await fetch('/api/audio/assets',{method:'POST',headers,body:data});const body=await response.json();
        if(!response.ok)throw new Error(body.error??'Falha ao importar o bordão.');
        const testResponse=await fetch(`/api/audio/assets/${body.id}/test`,{method:'POST',headers});
        onMessage(testResponse.ok?`“${body.name}” salvo e enviado ao overlay.`:`“${body.name}” salvo. Use Tocar quando o áudio do overlay estiver habilitado.`);
        setFile(null);setShowNew(false);setSlot(value=>({...value,name:''}));await load();return;
      }
      const response=await fetch('/api/audio/slots',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({...slot,candidate:slot.candidate||null})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'Falha ao criar a vaga.');
      onMessage(`Vaga “${body.name}” criada. Envie o arquivo de áudio para ativá-la.`);
      setShowNew(false);setSlot(value=>({...value,name:''}));await load();
    }catch(error){onMessage(error instanceof Error?error.message:'Falha ao criar a vaga.')}finally{setBusy(false)}
  }

  async function attach(asset:AudioAsset,chosen:File){
    setBusy(true);
    try{
      const durationSec=await audioDuration(chosen);
      const data=new FormData();data.append('audio',chosen);if(durationSec)data.append('durationSec',String(durationSec));
      const response=await fetch(`/api/audio/assets/${asset.id}/file`,{method:'POST',headers,body:data});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'Falha ao enviar o arquivo.');
      onMessage(`Arquivo cadastrado em “${asset.name}”. Ative o bordão para usá-lo na corrida.`);await load();
    }catch(error){onMessage(error instanceof Error?error.message:'Falha ao enviar o arquivo.')}finally{setBusy(false)}
  }

  async function remove(asset:AudioAsset){
    setBusy(true);
    try{
      const response=await fetch(`/api/audio/assets/${asset.id}`,{method:'DELETE',headers});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error??'Falha ao remover.');
      onMessage(`“${asset.name}” removido da biblioteca.`);await load();
    }catch(error){onMessage(error instanceof Error?error.message:'Falha ao remover.')}finally{setBusy(false)}
  }

  function change(id:string,patch:Partial<AudioAsset>){setAssets(items=>items.map(item=>item.id===id?{...item,...patch}:item))}

  async function save(asset:AudioAsset){
    const response=await fetch(`/api/audio/assets/${asset.id}`,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({name:asset.name,category:asset.category,trigger:asset.trigger,candidate:asset.candidate,volume:asset.volume,
        enabled:asset.enabled,maxFrequencySec:asset.maxFrequencySec,playMode:asset.playMode,isSatire:asset.isSatire,
        licenseNote:asset.licenseNote,animation:asset.animation,priority:asset.priority})});
    const body=await response.json();
    if(!response.ok)return onMessage(body.error??'Falha ao salvar.');
    change(asset.id,body);onMessage('Configuração do áudio salva.');
  }

  async function play(asset:AudioAsset){
    if(asset.pending)return onMessage('Áudio não cadastrado: envie um arquivo MP3, WAV ou OGG para esta vaga.');
    if(asset.fileMissing)return onMessage('O arquivo deste bordão não está mais em data/audio. Envie novamente.');
    const response=await fetch(`/api/audio/assets/${asset.id}/test`,{method:'POST',headers});
    const body=await response.json().catch(()=>({}));
    onMessage(response.ok?'Som enviado ao overlay aberto.':(body.error??'O overlay não recebeu o som.'));
  }

  const pending=assets.filter(asset=>asset.sourceType==='upload'&&asset.trigger!=='background_music'&&asset.pending).length;
  const ready=assets.filter(asset=>asset.sourceType==='upload'&&asset.trigger!=='background_music'&&!asset.pending&&!asset.fileMissing).length;
  const displayAssets=simple?assets.filter(asset=>asset.sourceType==='upload'&&asset.trigger!=='background_music'):assets;

  return <section className="panel audio-library-panel" id="audio-library">
    <div className="panel-heading">
      <div><p className="eyebrow">BIBLIOTECA DE ÁUDIO</p><h2>BORDÕES — 13 X 22</h2></div>
      <span className="demo-chip">{ready} COM ARQUIVO · {pending} VAGAS VAZIAS</span>
    </div>
    <div className="audio-legal"><b>Conteúdo responsável</b><span>Importe somente áudio original, paródia própria ou material licenciado, e marque as paródias como sátira. Não use clonagem de voz dos políticos nem apresente montagens como falas autênticas. As vagas sem arquivo aparecem como “Áudio não cadastrado” e não tocam na corrida.</span></div>

    <div className="audio-slot-actions">
      <button className="primary-button add-catchphrase" type="button" onClick={()=>setShowNew(value=>!value)}>{showNew?'× CANCELAR':'+ ADICIONAR BORDÃO'}</button>
      <span className="helper-text">{simple?'Escolha o lado, o arquivo e o evento. O sistema salva e testa no overlay.':'Cria a vaga primeiro; o arquivo pode ser enviado depois, direto na linha do bordão.'}</span>
    </div>

    {showNew&&<form className="audio-new-slot" onSubmit={createSlot}>
      <label>Nome do bordão<input value={slot.name} required minLength={2} onChange={event=>setSlot({...slot,name:event.target.value})} placeholder="ex.: Bordão de largada"/></label>
      {simple?<><label>Lado<select value={slot.candidate||''} onChange={event=>setSlot({...slot,candidate:event.target.value as ''|Candidate})}><option value="lula">13</option><option value="bolsonaro">22</option><option value="">Geral</option></select></label><label>Arquivo MP3, WAV ou OGG<input type="file" required accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg" onChange={event=>setFile(event.target.files?.[0]??null)}/></label><label>Volume: {slot.volume}%<input type="range" min="0" max="100" value={slot.volume} onChange={event=>setSlot({...slot,volume:Number(event.target.value)})}/></label></>:<label>Seção<select value={slot.category} onChange={event=>setSlot({...slot,category:event.target.value as AudioCategory})}>{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
      <label>Evento disparador<select value={slot.trigger} onChange={event=>setSlot({...slot,trigger:event.target.value as AudioTrigger})}>{Object.entries(triggers).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {!simple&&<label>Personagem<select value={slot.candidate} onChange={event=>setSlot({...slot,candidate:event.target.value as ''|Candidate})}><option value="">Neutro / ambos</option><option value="lula">13</option><option value="bolsonaro">22</option></select></label>}
      {simple&&<label className="audio-check"><input type="checkbox" checked={slot.isSatire} onChange={event=>setSlot({...slot,isSatire:event.target.checked})}/> Identificar como sátira/paródia</label>}
      <label className="wide">Licença / origem<input required value={slot.licenseNote} onChange={event=>setSlot({...slot,licenseNote:event.target.value})}/></label>
      <button className="primary-button" disabled={busy}>{busy?'Salvando…':simple?'Salvar e testar no overlay':'Criar vaga'}</button>
    </form>}

    {simple&&ready===0&&<div className="audio-empty"><b>Nenhum bordão com áudio cadastrado.</b><span>Clique em + ADICIONAR BORDÃO e escolha um arquivo do Mac. As vagas vazias abaixo nunca são reproduzidas.</span></div>}
    {GROUPS.map(group=>{
      const items=displayAssets.filter(asset=>groupOf(asset)===group.id);
      if(!items.length)return null;
      return <div className="audio-group" key={group.id}>
        <div className="audio-group-head"><b>{group.title}</b><small>{group.hint}</small><em>{items.length}</em></div>
        {items.map(asset=>{
          const state=fileLabel(asset);
          return <article key={asset.id} className={`audio-row ${asset.enabled?'':'disabled'}`}>
            <div className="audio-row-title">
              <span className={`source ${asset.sourceType==='synth'?'system':asset.pending||asset.fileMissing?'tiktok':'demo'}`}>{asset.sourceType==='synth'?'ORIGINAL':'ARQUIVO'}</span>
              <input value={asset.name} onChange={event=>change(asset.id,{name:event.target.value})}/>
              <small className={`slot-state ${state.tone}`}>{state.text}{asset.durationSec?` · ${asset.durationSec.toFixed(1)} s`:''}{asset.isSatire?' · SÁTIRA':''}</small>
            </div>
            <div className="audio-row-controls">
              <select value={asset.trigger} onChange={event=>change(asset.id,{trigger:event.target.value as AudioTrigger})}>{Object.entries(triggers).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
              <select value={asset.candidate??''} onChange={event=>change(asset.id,{candidate:(event.target.value||null) as Candidate|null})}><option value="">Neutro</option><option value="lula">13</option><option value="bolsonaro">22</option></select>
              <select value={asset.animation} onChange={event=>change(asset.id,{animation:event.target.value})}>{Object.entries(animations).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
              <label>Vol. {asset.volume}%<input type="range" min="0" max="100" value={asset.volume} onChange={event=>change(asset.id,{volume:Number(event.target.value)})}/></label>
              <label>Máx. 1/{asset.maxFrequencySec}s<input type="range" min="0" max="60" value={asset.maxFrequencySec} onChange={event=>change(asset.id,{maxFrequencySec:Number(event.target.value)})}/></label>
            </div>
            <div className="audio-row-actions">
              <label className="switch"><input type="checkbox" checked={asset.enabled} disabled={asset.pending||asset.fileMissing}
                onChange={event=>change(asset.id,{enabled:event.target.checked})}/><span/><b>{asset.enabled?'Ativo':'Inativo'}</b></label>
              <button className="ghost-button" type="button" onClick={()=>void play(asset)}>▶ Tocar</button>
              {asset.sourceType==='upload'&&<label className="audio-file-button">{asset.pending?'⬆ Enviar áudio':'⬆ Trocar'}
                <input type="file" accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg" disabled={busy}
                  onChange={event=>{const chosen=event.target.files?.[0];event.target.value='';if(chosen)void attach(asset,chosen)}}/></label>}
              <button className="primary-button" type="button" onClick={()=>void save(asset)}>Salvar</button>
              {!asset.id.startsWith('builtin-')&&<button className="ghost-button danger-lite" type="button" onClick={()=>void remove(asset)}>Excluir</button>}
            </div>
          </article>;
        })}
      </div>;
    })}

    {!simple&&<form className="audio-upload" onSubmit={upload}>
      <h3>Importar bordão completo (MP3, WAV ou OGG)</h3>
      <div className="audio-form-grid">
        <label>Arquivo<input type="file" accept="audio/mpeg,audio/wav,audio/ogg,.mp3,.wav,.ogg" onChange={event=>setFile(event.target.files?.[0]??null)}/></label>
        <label>Nome do bordão<input value={form.name} required onChange={event=>setForm({...form,name:event.target.value})}/></label>
        <label>Seção<select value={form.category} onChange={event=>setForm({...form,category:event.target.value as AudioCategory})}>{Object.entries(categories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Evento<select value={form.trigger} onChange={event=>setForm({...form,trigger:event.target.value as AudioTrigger})}>{Object.entries(triggers).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Personagem<select value={form.candidate} onChange={event=>setForm({...form,candidate:event.target.value as ''|Candidate})}><option value="">Neutro / ambos</option><option value="lula">13</option><option value="bolsonaro">22</option></select></label>
        <label>Animação<select value={form.animation} onChange={event=>setForm({...form,animation:event.target.value})}>{Object.entries(animations).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label>Volume: {form.volume}%<input type="range" min="0" max="100" value={form.volume} onChange={event=>setForm({...form,volume:Number(event.target.value)})}/></label>
        <label>Intervalo mínimo (seg)<input type="number" min="0" max="3600" value={form.maxFrequencySec} onChange={event=>setForm({...form,maxFrequencySec:Number(event.target.value)})}/></label>
        <label>Seleção<select value={form.playMode} onChange={event=>setForm({...form,playMode:event.target.value as 'random'|'sequential'})}><option value="random">Aleatória</option><option value="sequential">Sequencial</option></select></label>
        <label>Prioridade<input type="number" min="1" max="110" value={form.priority} onChange={event=>setForm({...form,priority:Number(event.target.value)})}/></label>
        <label className="wide">Licença / origem<input required value={form.licenseNote} onChange={event=>setForm({...form,licenseNote:event.target.value})}/></label>
        <label className="audio-check"><input type="checkbox" checked={form.isSatire} onChange={event=>setForm({...form,isSatire:event.target.checked})}/> Identificar como sátira/paródia</label>
      </div>
      <button className="primary-button" disabled={busy}>{busy?'Importando…':'Importar áudio'}</button>
    </form>}
  </section>;
}
