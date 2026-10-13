import { type FormEvent, useEffect, useState } from 'react';
import { AudioDiagnosticsPanel } from '../components/AudioDiagnosticsPanel';
import { AudioLibraryPanel } from '../components/AudioLibraryPanel';
import { useArena } from '../hooks/useArena';

/** Central dedicada: cadastro continua no servidor mesmo com /admin fechado. */
export function Catchphrases(){
  const{state,connected}=useArena();
  const[token,setToken]=useState(()=>sessionStorage.getItem('arena_token')??'');
  const[authenticated,setAuthenticated]=useState(false);
  const[checking,setChecking]=useState(Boolean(token));
  const[error,setError]=useState('');
  const[message,setMessage]=useState('');

  useEffect(()=>{
    if(!token){setChecking(false);return}
    fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})
      .then(response=>{if(response.ok)setAuthenticated(true);else sessionStorage.removeItem('arena_token')})
      .catch(()=>undefined).finally(()=>setChecking(false));
  },[]);

  async function login(event:FormEvent){
    event.preventDefault();setError('');
    const response=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    if(!response.ok){setError('Token recusado pelo servidor.');return}
    sessionStorage.setItem('arena_token',token);setAuthenticated(true);
  }

  if(checking)return <main className="loading-screen"><div className="loader"/><p>Validando acesso…</p></main>;
  if(!authenticated)return <main className="auth-page"><div className="auth-orbit"/><form className="auth-card" onSubmit={login}><div className="admin-logo"><span>LA</span><div><b>LIVE ARENA</b><small>ÁUDIO SEGURO</small></div></div><p className="eyebrow">ACESSO RESTRITO</p><h1>Central de Bordões</h1><p>Use o mesmo token administrativo. Nenhum áudio toca nesta página: a saída real permanece no overlay.</p><label>Token de acesso<input type="password" value={token} onChange={event=>setToken(event.target.value)} autoFocus/></label>{error&&<div className="form-error">{error}</div>}<button className="primary-button">Entrar com segurança →</button><a href="/admin">Voltar ao painel</a></form></main>;
  if(!state)return <main className="loading-screen"><div className="loader"/><p>Sincronizando biblioteca…</p></main>;

  return <main className="catchphrases-page">
    <header className="catchphrases-header"><div><p className="eyebrow">LIVE ARENA 3D · ÁUDIO DO OVERLAY</p><h1>Central de Bordões</h1><p>Duas bibliotecas independentes, com arquivos originais/licenciados e eventos reais do motor da corrida.</p></div><nav><span className={`mini-dot ${connected?'online':''}`}/> Servidor {connected?'online':'reconectando'}<a className="ghost-button" href="/admin">Painel</a><a className="ghost-button" href="/admin/testes">Testes</a><a className="primary-button" href="/overlay" target="_blank" rel="noreferrer">Abrir overlay ↗</a></nav></header>
    {message&&<button className="toast" onClick={()=>setMessage('')}>{message}<span>×</span></button>}
    <section className="catchphrase-sides"><article className="lula"><span>LADO 13</span><b>Bordões, memes, impulso, ultrapassagem e vitória</b><small>Todo item pode ser vinculado exclusivamente aos eventos do 13.</small></article><article className="bolsonaro"><span>LADO 22</span><b>Bordões, memes, impulso, ultrapassagem e vitória</b><small>Todo item pode ser vinculado exclusivamente aos eventos do 22.</small></article></section>
    <AudioDiagnosticsPanel config={state.config} token={token} onMessage={setMessage} onConfigChange={()=>undefined}/>
    <AudioLibraryPanel token={token} onMessage={setMessage} simple/>
  </main>;
}
