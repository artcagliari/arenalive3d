/**
 * Busca UMA VEZ o catálogo de presentes de uma sala ao vivo (exige chave do Euler Stream com plano que inclua
 * a rota de presentes), salva uma cópia em arquivo e grava no app os IDs cujo NOME e PREÇO são idênticos.
 * A chave fica só no ambiente local; nunca é gravada em arquivo nem enviada ao app.
 *
 *   EULER_API_KEY=... ARENA_URL=https://seu-app.up.railway.app ARENA_TOKEN=<ADMIN_TOKEN> \
 *   node --import tsx scripts/fetch-gift-catalog.ts <usuario_ao_vivo> [--apply] [--out=arquivo.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { TikTokLiveConnection } from 'tiktok-live-connector';
import { catalogFrom, matchObservedGifts, redact } from '../server/tiktok.js';

const args = process.argv.slice(2);
const username = args.find(arg => !arg.startsWith('--'))?.replace(/^@/, '');
const apply = args.includes('--apply');
const out = path.resolve(args.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'data/tiktok-gift-catalog.json');
const key = process.env.EULER_API_KEY ?? '';
const base = (process.env.ARENA_URL ?? '').replace(/\/$/, ''), token = process.env.ARENA_TOKEN ?? '';
if (!username || !key || !base || !token) {
  console.error('Uso: EULER_API_KEY=... ARENA_URL=... ARENA_TOKEN=... node --import tsx scripts/fetch-gift-catalog.ts <usuario_ao_vivo> [--apply] [--out=arquivo.json]');
  process.exit(1);
}
const api = async (route: string, init: RequestInit = {}) => {
  const response = await fetch(`${base}${route}`, { ...init, headers: { 'x-admin-token': token, 'content-type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${route}: ${(body as any).error ?? response.status}`);
  return body as any;
};

const connection = new TikTokLiveConnection(username, { signApiKey: key, processInitialData: false, enableExtendedGiftInfo: true });
connection.on('error', () => undefined);
let raw: unknown;
try {
  const state = await connection.connect();
  console.log(`Conectado à sala ${state.roomId}.`);
  raw = connection.availableGifts ?? await connection.fetchAvailableGifts();
} catch (error: any) {
  console.error('Falha:', redact(error?.exception?.message ?? error?.info ?? error?.message ?? error));
  process.exit(2);
} finally {
  try { await connection.disconnect(); } catch { /* ok */ }
}

const catalog = catalogFrom(raw);
if (!catalog.length) { console.error('O catálogo veio vazio.'); process.exit(3); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(catalog, null, 2));
console.log(`Catálogo com ${catalog.length} presentes salvo em ${out}`);

const registry = (await api('/api/gifts')) as any[];
const matches = matchObservedGifts(registry, catalog.map(item => ({ giftId: item.id, name: item.name, diamonds: item.diamonds })));
const matched = new Set(matches.map(item => item.registryId));
console.log(`\nCadastrados: ${registry.length} | sem ID: ${registry.filter(g => !g.tiktokGiftId).length} | associações: ${matches.length}`);
for (const m of matches) console.log(`  ${m.basis === 'exact' ? 'OK  nome+preço' : '?   só nome    '} ${m.side.padEnd(9)} ${m.name.padEnd(24)} -> ${m.giftId}`);
for (const gift of registry.filter(g => !g.tiktokGiftId && !matched.has(g.id))) console.log(`  --  sem correspondência: ${gift.side} ${gift.name} (preço ${gift.costLabel})`);
if (!apply) { console.log('\nSem --apply: nada foi alterado no app.'); process.exit(0); }
for (const m of matches.filter(item => item.basis === 'exact')) {
  try { await api(`/api/gifts/${m.registryId}`, { method: 'PATCH', body: JSON.stringify({ tiktokGiftId: m.giftId, confirmed: true }) }); console.log(`  aplicado: ${m.name} = ${m.giftId}`); }
  catch (error) { console.log(`  recusado: ${m.name}: ${(error as Error).message}`); }
}
process.exit(0);
