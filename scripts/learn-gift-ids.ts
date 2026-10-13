/**
 * Aprende os IDs reais dos presentes SEM gastar moedas: escuta os eventos de presentes de uma LIVE pública
 * (qualquer sala com movimento) e casa por NOME + PREÇO com o cadastro do seu app.
 *
 *   ARENA_URL=https://seu-app.up.railway.app ARENA_TOKEN=<ADMIN_TOKEN> \
 *   node --import tsx scripts/learn-gift-ids.ts <usuario_ao_vivo> [minutos=10] [--apply]
 *
 * Sem --apply apenas mostra o que associaria. Só aplica correspondências "nome + preço"; "só nome" é listada para
 * conferência manual. Integração não oficial (tiktok-live-connector).
 */
import { TikTokLiveConnection } from 'tiktok-live-connector';
import { matchObservedGifts, normalizeGift, type ObservedGift } from '../server/tiktok.js';

const [username, minutesArg, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply') || minutesArg === '--apply';
const minutes = Number(minutesArg && minutesArg !== '--apply' ? minutesArg : 10);
const base = (process.env.ARENA_URL ?? '').replace(/\/$/, ''), token = process.env.ARENA_TOKEN ?? '';
if (!username || !base || !token) {
  console.error('Uso: ARENA_URL=... ARENA_TOKEN=... node --import tsx scripts/learn-gift-ids.ts <usuario_ao_vivo> [minutos] [--apply]');
  process.exit(1);
}
const api = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'x-admin-token': token, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${(body as any).error ?? response.status}`);
  return body as any;
};

const seen = new Map<string, ObservedGift & { count: number }>();
const connection = new TikTokLiveConnection(username.replace(/^@/, ''), { processInitialData: false });
connection.on('error', () => undefined);
connection.on('gift', (data: any) => {
  const gift = normalizeGift(data);
  if (!gift) return;
  const key = gift.giftId;
  const current = seen.get(key);
  seen.set(key, { giftId: key, name: gift.giftName ?? current?.name ?? null, diamonds: gift.diamonds ?? current?.diamonds ?? null, count: (current?.count ?? 0) + 1 });
});

async function report(final: boolean) {
  const registry = (await api('/api/gifts')) as any[];
  const observed = [...seen.values()];
  const matches = matchObservedGifts(registry, observed);
  const missing = registry.filter(gift => !gift.tiktokGiftId).length;
  console.log(`\n[${new Date().toLocaleTimeString('pt-BR')}] presentes distintos vistos: ${observed.length} | cadastrados sem ID: ${missing} | associações possíveis: ${matches.length}`);
  for (const m of matches) console.log(`  ${m.basis === 'exact' ? 'OK  nome+preço' : '?   só nome    '} ${m.side.padEnd(9)} ${m.name.padEnd(24)} -> ${m.giftId}`);
  if (!final) return;
  if (!apply) { console.log('\nSem --apply: nada foi alterado.'); return; }
  for (const m of matches.filter(item => item.basis === 'exact')) {
    try { await api(`/api/gifts/${m.registryId}`, { method: 'PATCH', body: JSON.stringify({ tiktokGiftId: m.giftId, confirmed: true }) }); console.log(`  aplicado: ${m.name} = ${m.giftId}`); }
    catch (error) { console.log(`  recusado: ${m.name}: ${(error as Error).message}`); }
  }
}

try {
  const state = await connection.connect();
  console.log(`Conectado à sala ${state.roomId}. Escutando presentes por ${minutes} min (Ctrl+C encerra e mostra o resultado)…`);
} catch (error: any) {
  console.error('Não foi possível conectar (a conta está em LIVE?):', error?.exception?.message ?? error?.message ?? error);
  process.exit(2);
}
const finish = async () => { await report(true).catch(error => console.error(error.message)); try { await connection.disconnect(); } catch { /* ok */ } process.exit(0); };
process.on('SIGINT', () => void finish());
const ticker = setInterval(() => void report(false).catch(() => undefined), 60_000);
setTimeout(() => { clearInterval(ticker); void finish(); }, minutes * 60_000);
