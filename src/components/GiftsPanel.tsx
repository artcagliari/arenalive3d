import { useEffect, useState } from 'react';
import { GIFT_EFFECTS, type Candidate, type GiftEffect, type RaceGift } from '../types';

const SIDES: Array<{ id: Candidate; title: string }> = [
  { id: 'lula', title: 'Coluna esquerda · Lula' },
  { id: 'bolsonaro', title: 'Coluna direita · Bolsonaro' }
];
const ICONS: Record<GiftEffect, string> = { impulso: '»', arrancada: '↟', turbo: '⚡', escudo: '◈', tropeco: '✖', especial: '★', aleatorio: '?', recuperacao: '♥' };

/**
 * PRESENTES DA CORRIDA: cada presente tem coluna, efeito real no motor, alvo
 * (o próprio corredor ou o rival), intensidade, duração, imagem e ID do TikTok.
 */
export function GiftsPanel({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const [gifts, setGifts] = useState<RaceGift[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const headers = { 'x-admin-token': token };

  const load = async () => {
    const response = await fetch('/api/gifts', { headers });
    if (!response.ok) throw new Error('Falha ao carregar os presentes.');
    setGifts(await response.json());
  };
  useEffect(() => { void load().catch(error => onMessage(error.message)); }, [token]);

  function change(id: string, patch: Partial<RaceGift>) {
    setGifts(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  async function request(path: string, method: string, body?: object) {
    const response = await fetch(path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? 'Falha na operação.');
    return data;
  }

  async function save(gift: RaceGift) {
    setBusy(gift.id);
    try {
      await request(`/api/gifts/${gift.id}`, 'PATCH', {
        name: gift.name, tiktokGiftId: gift.tiktokGiftId ?? '', side: gift.side, effect: gift.effect, target: gift.target,
        label: gift.label, costLabel: gift.costLabel, intensity: gift.intensity, durationSec: gift.durationSec,
        points: gift.points, enabled: gift.enabled, order: gift.order, confirmed: gift.confirmed, note: gift.note
      });
      onMessage(`“${gift.name}” salvo. O overlay já mostra a mudança.`);
      await load();
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Falha ao salvar.'); }
    finally { setBusy(null); }
  }

  async function add(side: Candidate) {
    setBusy(side);
    try {
      const order = Math.max(0, ...gifts.filter(gift => gift.side === side).map(gift => gift.order)) + 1;
      await request('/api/gifts', 'POST', {
        name: 'Novo presente', tiktokGiftId: '', side, effect: 'impulso', target: 'own', label: 'IMPULSO', costLabel: '',
        intensity: 1, durationSec: 0, points: 10, enabled: false, order, confirmed: false, note: 'Cadastro manual pendente.'
      });
      onMessage('Presente criado (desativado). Preencha os dados, envie a imagem e ative.');
      await load();
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Falha ao criar.'); }
    finally { setBusy(null); }
  }

  async function remove(gift: RaceGift) {
    setBusy(gift.id);
    try { await request(`/api/gifts/${gift.id}`, 'DELETE'); onMessage(`“${gift.name}” removido.`); await load(); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'Falha ao remover.'); }
    finally { setBusy(null); }
  }

  async function move(gift: RaceGift, direction: -1 | 1) {
    const column = gifts.filter(item => item.side === gift.side).sort((a, b) => a.order - b.order);
    const index = column.findIndex(item => item.id === gift.id), other = column[index + direction];
    if (!other) return;
    setBusy(gift.id);
    try {
      await request(`/api/gifts/${gift.id}`, 'PATCH', { order: other.order });
      await request(`/api/gifts/${other.id}`, 'PATCH', { order: gift.order === other.order ? gift.order + direction : gift.order });
      await load();
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Falha ao reordenar.'); }
    finally { setBusy(null); }
  }

  async function upload(gift: RaceGift, file: File) {
    setBusy(gift.id);
    try {
      const data = new FormData();
      data.append('image', file);
      const response = await fetch(`/api/gifts/${gift.id}/image`, { method: 'POST', headers, body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Falha ao enviar a imagem.');
      onMessage(`Imagem de “${gift.name}” enviada.`);
      await load();
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Falha ao enviar a imagem.'); }
    finally { setBusy(null); }
  }

  async function test(gift: RaceGift) {
    try {
      const result = await request('/api/simulate', 'POST', { type: 'gift', candidate: gift.side, registryGiftId: gift.id, repeatCount: 1 });
      const refused = result.results?.find((item: { accepted: boolean }) => !item.accepted);
      onMessage(refused ? refused.reason ?? 'Recusado.' : `“${gift.name}” simulado: ${gift.label}.`);
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Falha no teste.'); }
  }

  return <section className="panel gifts-panel" id="gifts">
    <div className="panel-heading">
      <div><p className="eyebrow">COLUNAS LATERAIS</p><h2>PRESENTES DA CORRIDA</h2></div>
      <span className="demo-chip">{gifts.filter(gift => gift.tiktokGiftId).length}/{gifts.length} COM ID DO TIKTOK</span>
    </div>
    <div className="audio-legal"><b>Cadastro honesto</b><span>Nomes, valores e efeitos vêm da sua cartela. Os ícones foram recortados dela (não são as imagens oficiais do TikTok; troque se quiser). Nenhum ID foi inventado: informe o ID numérico de cada presente. Sem ID, o presente funciona só nos testes. Quando o mesmo presente está nas duas colunas, ele vai para o time do último comentário de quem enviou (13 ou 22).</span></div>

    <div className="gifts-columns">{SIDES.map(side => <div key={side.id} className={`gifts-column ${side.id}`}>
      <div className="gifts-column-head"><b>{side.title}</b><button type="button" className="ghost-button" disabled={busy !== null} onClick={() => void add(side.id)}>+ Adicionar presente</button></div>
      {gifts.filter(gift => gift.side === side.id).sort((a, b) => a.order - b.order).map(gift => <article key={gift.id} className={`gift-row ${gift.enabled ? '' : 'disabled'}`}>
        <div className="gift-image">
          {gift.imageUrl ? <img src={gift.imageUrl} alt={gift.name} /> : <i>{ICONS[gift.effect]}</i>}
          <label className="audio-file-button">{gift.imageUrl ? 'Trocar' : '⬆ Imagem'}
            <input type="file" accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg" disabled={busy !== null}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(gift, file); }} /></label>
        </div>
        <div className="gift-fields">
          <label>Nome<input value={gift.name} maxLength={60} onChange={event => change(gift.id, { name: event.target.value })} /></label>
          <label>ID do TikTok<input value={gift.tiktokGiftId ?? ''} placeholder="a identificar" inputMode="numeric" onChange={event => change(gift.id, { tiktokGiftId: event.target.value.replace(/\D/g, '') })} /></label>
          <label>Texto no overlay<input value={gift.label} maxLength={28} onChange={event => change(gift.id, { label: event.target.value.toUpperCase() })} /></label>
          <label>Valor em moedas<input value={gift.costLabel} maxLength={24} placeholder="opcional" onChange={event => change(gift.id, { costLabel: event.target.value })} /></label>
          <label>Coluna<select value={gift.side} onChange={event => change(gift.id, { side: event.target.value as Candidate })}><option value="lula">Lula (esquerda)</option><option value="bolsonaro">Bolsonaro (direita)</option></select></label>
          <label>Efeito<select value={gift.effect} onChange={event => change(gift.id, { effect: event.target.value as GiftEffect })}>{GIFT_EFFECTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Quem recebe<select value={gift.target} onChange={event => change(gift.id, { target: event.target.value as RaceGift['target'] })}><option value="own">O corredor da coluna</option><option value="rival">O rival</option></select></label>
          <label>Pontos<input type="number" min="0" value={gift.points} onChange={event => change(gift.id, { points: Number(event.target.value) })} /></label>
          <label>Intensidade {gift.intensity.toFixed(1)}×<input type="range" min="0.2" max="3" step="0.1" value={gift.intensity} onChange={event => change(gift.id, { intensity: Number(event.target.value) })} /></label>
          <label>Duração {gift.durationSec ? `${gift.durationSec}s` : 'padrão'}<input type="range" min="0" max="15" step="0.5" value={gift.durationSec} onChange={event => change(gift.id, { durationSec: Number(event.target.value) })} /></label>
        </div>
        <div className="gift-actions">
          <label className="switch"><input type="checkbox" checked={gift.enabled} onChange={event => change(gift.id, { enabled: event.target.checked })} /><span /><b>{gift.enabled ? 'Ativo' : 'Inativo'}</b></label>
          <label className="audio-check"><input type="checkbox" checked={gift.confirmed} onChange={event => change(gift.id, { confirmed: event.target.checked })} /> nome confirmado</label>
          <div className="gift-order"><button type="button" className="ghost-button" onClick={() => void move(gift, -1)}>↑</button><button type="button" className="ghost-button" onClick={() => void move(gift, 1)}>↓</button></div>
          <button type="button" className="ghost-button" onClick={() => void test(gift)}>▶ Testar</button>
          <button type="button" className="primary-button" disabled={busy === gift.id} onClick={() => void save(gift)}>Salvar</button>
          <button type="button" className="ghost-button danger-lite" onClick={() => void remove(gift)}>Excluir</button>
          <small className={gift.tiktokGiftId ? 'slot-state ok' : 'slot-state pending'}>{gift.tiktokGiftId ? `ID ${gift.tiktokGiftId}` : 'ID a identificar'}{gift.imageUrl ? '' : ' · sem imagem'}{gift.confirmed ? '' : ' · nome a confirmar'}</small>
        </div>
      </article>)}
    </div>)}</div>
  </section>;
}
