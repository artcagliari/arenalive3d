import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { ArenaEngine } from './engine.js';
import { Store } from './store.js';
import { TikTokAdapter } from './tiktok.js';
import type { OverlayTelemetry, SystemDiagnostics } from '../src/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8787);
const remoteAccess = process.env.REMOTE_ACCESS === 'true';
const host = remoteAccess ? (process.env.HOST ?? '0.0.0.0') : '127.0.0.1';
const databasePath = path.resolve(root, process.env.DATABASE_PATH ?? './data/live-arena.sqlite');
const audioDirectory = path.join(path.dirname(databasePath), 'audio');
const characterDirectory = path.join(path.dirname(databasePath), 'characters');
const adminToken = process.env.ADMIN_TOKEN ?? 'arena-local-demo';
const publicRuntime = remoteAccess || Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.RENDER === 'true';

if (publicRuntime && (Buffer.byteLength(adminToken) < 32 || ['arena-local-demo','240784'].includes(adminToken))) {
  throw new Error('Publicação recusada: defina ADMIN_TOKEN com pelo menos 32 caracteres aleatórios.');
}
if (adminToken === 'arena-local-demo') {
  console.warn(`[SEGURANÇA] ADMIN_TOKEN não configurado: o token local é "${adminToken}". Use apenas localmente e defina um segredo em .env antes da transmissão.`);
  if (remoteAccess) throw new Error('REMOTE_ACCESS exige ADMIN_TOKEN seguro.');
}

const store = new Store(databasePath);
// AUDIO_SAFE_MODE: silêncio absoluto ao iniciar. Só AUDIO_SAFE_MODE=false no .env muda isso.
const engine = new ArenaEngine(store, { audioSafeMode: process.env.AUDIO_SAFE_MODE !== 'false' });
let adapter = new TikTokAdapter(engine, process.env.TIKTOK_USERNAME ?? '');

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: false } });
fs.mkdirSync(audioDirectory, { recursive: true });
fs.mkdirSync(characterDirectory, { recursive: true });

const allowedAudioTypes = new Map([
  ['audio/mpeg', '.mp3'], ['audio/mp3', '.mp3'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'],
  ['audio/ogg', '.ogg'], ['application/ogg', '.ogg']
]);
const upload = multer({
  storage:multer.diskStorage({ destination:audioDirectory, filename:(_req,file,callback) => callback(null, `${crypto.randomUUID()}${allowedAudioTypes.get(file.mimetype) ?? path.extname(file.originalname).toLowerCase()}`) }),
  limits:{ fileSize:8 * 1024 * 1024, files:1 },
  fileFilter:(_req,file,callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const valid = allowedAudioTypes.has(file.mimetype) && ['.mp3','.wav','.ogg'].includes(extension);
    if (valid) callback(null, true);
    else callback(new Error('Formato não permitido. Use MP3, WAV ou OGG.'));
  }
});

const allowedCharacterTypes = new Map([
  ['image/png','.png'],['image/jpeg','.jpg'],['image/webp','.webp']
]);
const characterUpload = multer({
  storage:multer.diskStorage({ destination:characterDirectory, filename:(_req,file,callback)=>callback(null,`${crypto.randomUUID()}${allowedCharacterTypes.get(file.mimetype)??'.png'}`) }),
  limits:{fileSize:4*1024*1024,files:1},
  fileFilter:(_req,file,callback)=>{
    const extension=path.extname(file.originalname).toLowerCase();
    const valid=allowedCharacterTypes.has(file.mimetype)&&['.png','.jpg','.jpeg','.webp'].includes(extension);
    if(valid)callback(null,true);else callback(new Error('Formato de personagem não permitido. Use PNG, JPG ou WebP.'));
  }
});

const giftUpload = multer({
  storage:multer.diskStorage({ destination:store.giftDir, filename:(_req,file,callback)=>callback(null,`${crypto.randomUUID()}${allowedCharacterTypes.get(file.mimetype)??'.png'}`) }),
  limits:{fileSize:4*1024*1024,files:1},
  fileFilter:(_req,file,callback)=>{
    const extension=path.extname(file.originalname).toLowerCase();
    const valid=allowedCharacterTypes.has(file.mimetype)&&['.png','.jpg','.jpeg','.webp'].includes(extension);
    if(valid)callback(null,true);else callback(new Error('Imagem de presente: use PNG, JPG ou WebP.'));
  }
});

function hasValidAudioSignature(filePath:string,mimeType:string){
  const descriptor=fs.openSync(filePath,'r'),header=Buffer.alloc(12);
  try{fs.readSync(descriptor,header,0,12,0)}finally{fs.closeSync(descriptor)}
  if(mimeType.includes('wav'))return header.subarray(0,4).toString()==='RIFF'&&header.subarray(8,12).toString()==='WAVE';
  if(mimeType.includes('ogg'))return header.subarray(0,4).toString()==='OggS';
  return header.subarray(0,3).toString()==='ID3'||(header[0]===0xff&&(header[1]&0xe0)===0xe0);
}

function hasValidImageSignature(filePath:string,mimeType:string){
  const descriptor=fs.openSync(filePath,'r'),header=Buffer.alloc(12);
  try{fs.readSync(descriptor,header,0,12,0)}finally{fs.closeSync(descriptor)}
  if(mimeType==='image/png')return header.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(mimeType==='image/jpeg')return header[0]===0xff&&header[1]===0xd8&&header[2]===0xff;
  return header.subarray(0,4).toString()==='RIFF'&&header.subarray(8,12).toString()==='WEBP';
}

app.disable('x-powered-by');
app.set('trust proxy', remoteAccess ? 1 : 'loopback');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use('/admin', (_req,res,next) => { res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive'); next(); });

type AuthAttempt = { failures:number; resetAt:number };
const authAttempts = new Map<string,AuthAttempt>();
const AUTH_WINDOW_MS = 10 * 60_000;
const AUTH_MAX_FAILURES = 8;

function authAttempt(req:Request) {
  const key=req.ip || req.socket.remoteAddress || 'unknown',now=Date.now(),current=authAttempts.get(key);
  if(!current||current.resetAt<=now){const fresh={failures:0,resetAt:now+AUTH_WINDOW_MS};authAttempts.set(key,fresh);return{key,bucket:fresh}}
  return{key,bucket:current};
}

function refuseInvalidToken(req:Request,res:Response) {
  const{key,bucket}=authAttempt(req);bucket.failures+=1;
  if(authAttempts.size>1_000)for(const[candidate,value]of authAttempts)if(value.resetAt<=Date.now())authAttempts.delete(candidate);
  if(bucket.failures>=AUTH_MAX_FAILURES){res.setHeader('Retry-After',String(Math.ceil((bucket.resetAt-Date.now())/1_000)));return res.status(429).json({error:'Muitas tentativas. Aguarde antes de tentar novamente.'})}
  return res.status(401).json({ error:'Autenticação necessária.' });
}

function safeToken(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(adminToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-admin-token') ?? req.body?.token;
  const attempt=authAttempt(req);
  if(attempt.bucket.failures>=AUTH_MAX_FAILURES)return refuseInvalidToken(req,res);
  if (!safeToken(token)) return refuseInvalidToken(req,res);
  authAttempts.delete(attempt.key);
  next();
}

const configSchema = z.object({
  autoMode: z.boolean().optional(),
  roundDurationSec: z.number().int().min(60).max(3_600).optional(),
  openingDurationSec: z.number().int().min(1).max(300).optional(),
  resultsDurationSec: z.number().int().min(2).max(600).optional(),
  intermissionDurationSec: z.number().int().min(1).max(600).optional(),
  lulaKeyword: z.string().trim().min(1).max(40).optional(),
  bolsonaroKeyword: z.string().trim().min(1).max(40).optional(),
  lulaGiftId: z.string().trim().max(80).optional(),
  bolsonaroGiftId: z.string().trim().max(80).optional(),
  commentPoints: z.number().int().min(0).max(100_000).optional(),
  lulaGiftPoints: z.number().int().min(0).max(100_000).optional(),
  bolsonaroGiftPoints: z.number().int().min(0).max(100_000).optional(),
  likesGoal: z.number().int().min(1).max(100_000_000).optional(),
  soundEnabled: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
  staleEventThresholdSec: z.number().int().min(30).max(3_600).optional(),
  gameMode: z.enum(['battle', 'race', 'alternate']).optional(),
  gameDifficulty: z.number().int().min(1).max(5).optional(),
  cameraMode: z.enum(['dynamic', 'wide', 'close']).optional(),
  musicVolume: z.number().int().min(0).max(100).optional(),
  effectsVolume: z.number().int().min(0).max(100).optional(),
  animationIntensity: z.number().int().min(0).max(100).optional(),
  audioMode: z.enum(['discreet', 'memes', 'arena']).optional(),
  maxConcurrentSounds: z.number().int().min(1).max(3).optional(),
  minCatchphraseIntervalSec: z.number().int().min(1).max(300).optional(),
  lulaCharacterAsset:z.string().max(240).optional(),
  bolsonaroCharacterAsset:z.string().max(240).optional(),
  characterAssetVersion:z.number().int().min(1).optional(),
  raceDistanceM:z.number().int().min(50).max(5_000).optional(),
  raceDurationSec:z.number().int().min(60).max(3_600).optional(),
  raceEventFrequency:z.number().int().min(1).max(5).optional(),
  commentBoost:z.number().int().min(0).max(100).optional(),
  giftBoost:z.number().int().min(0).max(100).optional(),
  lulaCommandLabel:z.string().trim().min(1).max(60).optional(),
  bolsonaroCommandLabel:z.string().trim().min(1).max(60).optional(),
  runnerStyle:z.enum(['cartoon','classic']).optional(),
  powerShortcuts:z.object({
    impulso:z.string().trim().max(24), arrancada:z.string().trim().max(24), turbo:z.string().trim().max(24),
    escudo:z.string().trim().max(24), tropeco:z.string().trim().max(24)
  }).partial().optional(),
  musicEnabled:z.boolean().optional(),
  audioSafeMode:z.boolean().optional(),
  effectRepeatMs:z.number().int().min(100).max(5_000).optional(),
  dynamicMixingEnabled:z.boolean().optional(),
  maxCatchphraseDurationSec:z.number().min(.5).max(15).optional(),
  channelPriorities:z.object({music:z.number().int().min(0).max(110),voice:z.number().int().min(0).max(110),sfx:z.number().int().min(0).max(110),priority:z.number().int().min(0).max(110)}).partial().optional(),
  categoryVolumes:z.object({
    corrida:z.number().int().min(0).max(100), bordoes:z.number().int().min(0).max(100), memes:z.number().int().min(0).max(100),
    torcida:z.number().int().min(0).max(100), resultado:z.number().int().min(0).max(100)
  }).partial().optional()
}).strict();

const audioCategory = z.enum(['lula_catchphrase','bolsonaro_catchphrase','satire_meme','crowd','hit','defense','result','gift','alert','music']);
const audioTrigger = z.enum(['round_start','impact','special','defense','dodge','gift_received','comment_received','combo','scene_change','round_end','victory','defeat','race_start','boost','stumble','overtake','final_sprint','background_music']);
const audioMetadataSchema = z.object({
  name:z.string().trim().min(2).max(80), category:audioCategory, trigger:audioTrigger,
  candidate:z.union([z.enum(['lula','bolsonaro']),z.null()]).optional().default(null),
  volume:z.number().int().min(0).max(100), enabled:z.boolean(), maxFrequencySec:z.number().int().min(0).max(3600),
  playMode:z.enum(['random','sequential']), isSatire:z.boolean(), licenseNote:z.string().trim().min(3).max(300),
  animation:z.string().trim().min(1).max(50), priority:z.number().int().min(1).max(110),
  durationSec:z.number().min(0.01).max(3_600).nullable().optional()
});

const audioDiagnosticsSchema = z.object({
  state:z.enum(['not-started','running','suspended','interrupted','closed']), enabled:z.boolean(),
  active:z.number().int().min(0).max(20), queued:z.number().int().min(0).max(20),
  loaded:z.number().int().min(0).max(10_000), played:z.number().int().min(0),
  dropped:z.number().int().min(0), errors:z.number().int().min(0),
  lastCueAt:z.string().datetime().nullable(), lastError:z.string().max(300).nullable(),
  maxVoices:z.number().int().min(0).max(8).optional(), muted:z.boolean().optional(), music:z.boolean().optional(),
  safeMode:z.boolean().optional(), contextsCreated:z.number().int().min(0).max(1_000).optional(),
  sources:z.number().int().min(0).max(200).optional(), playing:z.array(z.string().max(120)).max(20).optional(),
  masterVolume:z.number().min(0).max(1).optional(),
  authorized:z.boolean().optional(), roundsObserved:z.number().int().min(0).optional(), currentRound:z.number().int().min(0).optional(),
  lastEventAt:z.string().datetime().nullable().optional(), lastEventName:z.string().max(120).nullable().optional(),
  lastPlayedAt:z.string().datetime().nullable().optional(), lastPlayedName:z.string().max(120).nullable().optional(),
  pageLoadId:z.string().max(80).optional(), pageLoadedAt:z.string().datetime().optional(), navigationType:z.string().max(30).optional(),
  recent:z.array(z.object({
    at:z.string().datetime(), name:z.string().max(120), group:z.enum(['corrida','bordoes','memes','torcida','resultado']),
    result:z.enum(['carregado','iniciou','tocou','encerrou','barrado','erro']), detail:z.string().max(200).optional()
  })).max(20).optional()
});
const overlayTelemetrySchema = z.object({
  fps:z.number().min(0).max(240), memoryMb:z.number().min(0).max(100_000).nullable(), audio:audioDiagnosticsSchema
});
const overlayTelemetry = new Map<string, OverlayTelemetry>();

/** Motivo para recusar um teste de som, ou null se o áudio está liberado. */
function audioBlocked(): string | null {
  const config = engine.getConfig();
  if (config.audioSafeMode) return 'AUDIO_SAFE_MODE ativo: o áudio está desligado. Use “ATIVAR ÁUDIO” na Central de Testes.';
  if (!config.soundEnabled) return 'O som está silenciado. Use “ATIVAR ÁUDIO” na Central de Testes.';
  // O som sai somente pela página /overlay; sem ela aberta, o teste não tem onde tocar.
  const overlayOpen = [...overlayTelemetry.values()].some(item => Date.now() - Date.parse(item.reportedAt) < 10_000);
  if (!overlayOpen) return 'Nenhum /overlay aberto: o som sai somente pelo overlay. Abra http://127.0.0.1:8787/overlay e clique uma vez nele.';
  return null;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, ...engine.getState().health }));
app.get('/api/state', (_req, res) => res.json(engine.getState()));
app.post('/api/auth', (req, res) => {
  const attempt=authAttempt(req);
  if(attempt.bucket.failures>=AUTH_MAX_FAILURES)return refuseInvalidToken(req,res);
  if(!safeToken(req.body?.token))return refuseInvalidToken(req,res);
  authAttempts.delete(attempt.key);return res.json({ok:true});
});
app.get('/robots.txt', (_req,res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\n'));
app.get('/api/events', requireAdmin, (req, res) => res.json(store.recentEvents(Number(req.query.limit ?? 100))));
app.get('/api/rounds', requireAdmin, (_req, res) => res.json(store.rounds()));
app.get('/api/diagnostics', requireAdmin, (_req, res) => {
  const memory = process.memoryUsage();
  const freshOverlay = [...overlayTelemetry.values()]
    .filter(item => Date.now() - Date.parse(item.reportedAt) < 10_000)
    .sort((a,b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt))[0] ?? null;
  const diagnostics:SystemDiagnostics = {
    generatedAt:new Date().toISOString(), engine:engine.getDiagnostics(),
    server:{
      rssMb:Math.round(memory.rss/1024/1024*10)/10,
      heapUsedMb:Math.round(memory.heapUsed/1024/1024*10)/10,
      heapTotalMb:Math.round(memory.heapTotal/1024/1024*10)/10,
      websocketClients:io.engine.clientsCount,
      overlayConnections:[...overlayTelemetry.values()].filter(item => Date.now()-Date.parse(item.reportedAt)<10_000).length
    },
    overlay:freshOverlay,
    errors:store.recentLogs(30)
  };
  res.json(diagnostics);
});
app.get('/api/audio/library', (_req, res) => res.json(store.playableAudioAssets()));
app.get('/api/audio/assets', requireAdmin, (_req, res) => res.json(store.audioAssets()));
app.get('/api/character-files/:file', (req,res)=>{
  const requested=path.basename(String(req.params.file));
  const config=engine.getState().config;
  const active=new Set([config.lulaCharacterAsset,config.bolsonaroCharacterAsset].filter(value=>value.startsWith('/api/character-files/')).map(value=>path.basename(value)));
  if(!active.has(requested))return res.status(404).json({error:'Asset de personagem não encontrado.'});
  res.setHeader('Cache-Control','no-cache');
  res.sendFile(requested,{root:characterDirectory});
});
app.post('/api/characters/:candidate',requireAdmin,characterUpload.single('image'),(req,res)=>{
  const candidate=req.params.candidate;
  if(candidate!=='lula'&&candidate!=='bolsonaro'){
    if(req.file)fs.unlinkSync(req.file.path);
    return res.status(404).json({error:'Personagem desconhecido.'});
  }
  if(!req.file)return res.status(400).json({error:'Selecione uma imagem PNG, JPG ou WebP.'});
  if(!hasValidImageSignature(req.file.path,req.file.mimetype)){
    fs.unlinkSync(req.file.path);return res.status(400).json({error:'O arquivo não contém uma imagem válida.'});
  }
  const asset=`/api/character-files/${req.file.filename}`;
  engine.updateConfig(candidate==='lula'?{lulaCharacterAsset:asset,characterAssetVersion:Date.now()}:{bolsonaroCharacterAsset:asset,characterAssetVersion:Date.now()});
  store.log('info','Asset de personagem atualizado',{candidate,file:req.file.filename,mimeType:req.file.mimetype});
  res.json(engine.getState().config);
});
app.post('/api/characters/:candidate/reset',requireAdmin,(req,res)=>{
  const candidate=req.params.candidate;
  if(candidate!=='lula'&&candidate!=='bolsonaro')return res.status(404).json({error:'Personagem desconhecido.'});
  const asset=`/characters/${candidate}-stylized.png`;
  engine.updateConfig(candidate==='lula'?{lulaCharacterAsset:asset,characterAssetVersion:Date.now()}:{bolsonaroCharacterAsset:asset,characterAssetVersion:Date.now()});
  res.json(engine.getState().config);
});
app.post('/api/characters/reload',requireAdmin,(_req,res)=>{
  engine.updateConfig({characterAssetVersion:Date.now()});
  res.json(engine.getState().config);
});
app.get('/api/audio/files/:id', (req, res) => {
  const asset = store.audioAsset(String(req.params.id));
  if (!asset || asset.sourceType !== 'upload' || !asset.fileName) return res.status(404).json({ error:'Áudio não encontrado.' });
  res.type(asset.mimeType ?? 'application/octet-stream').sendFile(path.basename(asset.fileName), { root:audioDirectory });
});

app.post('/api/audio/assets', requireAdmin, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error:'Selecione um arquivo MP3, WAV ou OGG.' });
  if (!hasValidAudioSignature(req.file.path,req.file.mimetype)) { fs.unlinkSync(req.file.path); return res.status(400).json({ error:'O conteúdo do arquivo não corresponde a um áudio MP3, WAV ou OGG válido.' }); }
  let raw:unknown;
  try { raw = JSON.parse(String(req.body.metadata ?? '{}')); }
  catch { fs.unlinkSync(req.file.path); return res.status(400).json({ error:'Metadados inválidos.' }); }
  const parsed = audioMetadataSchema.safeParse(raw);
  if (!parsed.success) { fs.unlinkSync(req.file.path); return res.status(400).json({ error:'Revise nome, licença e configurações do áudio.', details:z.treeifyError(parsed.error) }); }
  const asset = {
    id:crypto.randomUUID(), ...parsed.data, sourceType:'upload' as const, fileName:req.file.filename,
    mimeType:req.file.mimetype, synthPreset:null, durationSec:parsed.data.durationSec ?? null, createdAt:new Date().toISOString()
  };
  try { store.saveAudioAsset(asset); }
  catch (error) { fs.unlinkSync(req.file.path); throw error; }
  store.log('info', 'Áudio importado', { id:asset.id, name:asset.name, category:asset.category, licenseNote:asset.licenseNote });
  res.status(201).json(store.audioAsset(asset.id));
});

app.patch('/api/audio/assets/:id', requireAdmin, (req, res) => {
  const existing = store.audioAsset(String(req.params.id));
  if (!existing) return res.status(404).json({ error:'Áudio não encontrado.' });
  const parsed = audioMetadataSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Configuração de áudio inválida.', details:z.treeifyError(parsed.error) });
  // Só aplica o que veio no corpo: sem isso, um valor padrão do schema apagava
  // campos ausentes — era assim que mudar o volume zerava o personagem do bordão
  // e o bordão de um lado passava a tocar para o outro.
  const validated = parsed.data as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys((req.body ?? {}) as Record<string, unknown>)) {
    if (key in validated) patch[key] = validated[key];
  }
  store.saveAudioAsset({ ...existing, ...patch } as typeof existing);
  res.json(store.audioAsset(existing.id));
});

/** Cria uma vaga de bordão sem arquivo: aparece como "Áudio não cadastrado". */
app.post('/api/audio/slots', requireAdmin, (req, res) => {
  const parsed = audioMetadataSchema.partial({ volume:true, enabled:true, maxFrequencySec:true, playMode:true, isSatire:true, animation:true, priority:true })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Informe pelo menos nome, categoria e evento do bordão.', details:z.treeifyError(parsed.error) });
  const asset = {
    id:crypto.randomUUID(), ...parsed.data,
    candidate:parsed.data.candidate ?? null,
    volume:parsed.data.volume ?? 80, enabled:false,
    maxFrequencySec:parsed.data.maxFrequencySec ?? 15,
    playMode:parsed.data.playMode ?? 'random' as const,
    isSatire:parsed.data.isSatire ?? true,
    animation:parsed.data.animation ?? 'none',
    priority:parsed.data.priority ?? 65,
    sourceType:'upload' as const, fileName:null, mimeType:null, synthPreset:null, durationSec:null,
    createdAt:new Date().toISOString()
  };
  store.saveAudioAsset(asset);
  store.log('info', 'Vaga de bordão criada', { id:asset.id, name:asset.name });
  res.status(201).json(store.audioAsset(asset.id));
});

/** Envia (ou troca) o arquivo de um bordão já cadastrado. */
app.post('/api/audio/assets/:id/file', requireAdmin, upload.single('audio'), (req, res) => {
  const id = String(req.params.id);
  const existing = store.audioAsset(id);
  if (!existing) { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ error:'Bordão não encontrado.' }); }
  if (existing.id.startsWith('builtin-')) { if (req.file) fs.unlinkSync(req.file.path); return res.status(409).json({ error:'Os efeitos originais do app não aceitam troca de arquivo. Crie um novo bordão.' }); }
  if (!req.file) return res.status(400).json({ error:'Selecione um arquivo MP3, WAV ou OGG.' });
  if (!hasValidAudioSignature(req.file.path, req.file.mimetype)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error:'O conteúdo do arquivo não corresponde a um áudio MP3, WAV ou OGG válido.' });
  }
  const parsedDuration = Number(req.body.durationSec);
  const durationSec = Number.isFinite(parsedDuration) && parsedDuration > 0 && parsedDuration <= 3_600 ? parsedDuration : null;
  const previous = store.attachAudioFile(id, req.file.filename, req.file.mimetype, durationSec);
  if (previous) { try { fs.unlinkSync(path.join(audioDirectory, path.basename(previous))); } catch { /* arquivo já ausente */ } }
  store.log('info', 'Arquivo de bordão cadastrado', { id, fileName:req.file.filename, licenseNote:existing.licenseNote });
  res.json(store.audioAsset(id));
});

app.delete('/api/audio/assets/:id', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  if (id.startsWith('builtin-')) return res.status(409).json({ error:'Os efeitos originais do app não podem ser removidos; desative-os se preferir.' });
  const removed = store.deleteAudioAsset(id);
  if (removed === null) return res.status(404).json({ error:'Áudio não encontrado.' });
  if (removed) { try { fs.unlinkSync(path.join(audioDirectory, path.basename(removed))); } catch { /* arquivo já ausente */ } }
  store.log('info', 'Áudio removido da biblioteca', { id });
  res.json({ ok:true });
});

app.post('/api/audio/assets/:id/test', requireAdmin, (req, res) => {
  const asset = store.audioAsset(String(req.params.id));
  if (!asset) return res.status(404).json({ error:'Áudio não encontrado.' });
  if (asset.pending) return res.status(409).json({ error:'Áudio não cadastrado: envie um arquivo MP3, WAV ou OGG para esta vaga.' });
  if (asset.fileMissing) return res.status(409).json({ error:'O arquivo deste bordão não está mais em data/audio. Envie o arquivo novamente.' });
  const blocked = audioBlocked();
  if (blocked) return res.status(409).json({ error: blocked });
  const cue = engine.testAudio(asset.id);
  if (!cue) return res.status(409).json({ error:'O áudio não pôde ser enviado ao overlay.' });
  res.json(cue);
});

/** Libera o servidor e envia um efeito curto, original e de baixo ganho. */
app.post('/api/audio/enable', requireAdmin, (_req, res) => {
  const playable = store.playableAudioAssets();
  engine.updateConfig({ audioSafeMode:false, soundEnabled:true });
  const overlayOpen = [...overlayTelemetry.values()].some(item => Date.now() - Date.parse(item.reportedAt) < 10_000);
  setTimeout(() => engine.testAudio('builtin-boost'), 250).unref();
  store.log('info', 'Áudio habilitado explicitamente pelo operador', { overlayOpen, playable:playable.length });
  res.json({ ok:true, filesAvailable:playable.length, overlayOpen,
    message:overlayOpen ? 'Liberação enviada. Se o navegador bloquear, clique em HABILITAR ÁUDIO no próprio overlay.' : 'Áudio liberado, mas nenhum overlay está aberto para reproduzir o teste.' });
});

/** Demonstra VOICE + SFX no mesmo AudioManager do overlay, sem criar contexto extra. */
app.post('/api/audio/test-overlap',requireAdmin,(_req,res)=>{
  const blocked=audioBlocked();if(blocked)return res.status(409).json({error:blocked});
  const phrases=store.playableAudioAssets().filter(asset=>['lula_catchphrase','bolsonaro_catchphrase','satire_meme'].includes(asset.category));
  if(!phrases.length)return res.status(409).json({error:'Cadastre pelo menos um bordão com arquivo para testar a sobreposição.'});
  engine.testAudio(phrases[0].id);
  setTimeout(()=>engine.testAudio('builtin-boost'),120).unref();
  if(phrases.length>1)setTimeout(()=>engine.testAudio(phrases[1].id),320).unref();
  res.json({ok:true,voice:phrases[0].name,replacement:phrases[1]?.name??null,sfx:'Impulso de corrida'});
});

/** Interrompe filas e fontes em todos os overlays; o contexto só fecha ao descarregar a página. */
app.post('/api/audio/silence', requireAdmin, (_req, res) => {
  engine.updateConfig({ audioSafeMode:true, soundEnabled:false });
  store.log('info', 'SILENCIAR TUDO acionado pelo operador');
  res.json({ ok:true, message:'Todas as filas e fontes dos overlays foram interrompidas.' });
});

const playbackErrors = new Map<string, { at:number; count:number }>();
app.post('/api/audio/playback-error', (req, res) => {
  const parsed = z.object({ assetId:z.string().max(80), message:z.string().max(300) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Relato inválido.' });
  const key = req.ip ?? 'local', current = playbackErrors.get(key), now = Date.now();
  const bucket = !current || now-current.at>60_000 ? { at:now,count:0 } : current;
  if (bucket.count >= 10) return res.status(429).json({ error:'Limite de registros atingido.' });
  bucket.count += 1; playbackErrors.set(key,bucket);
  store.log('error', 'Falha na reprodução de áudio', parsed.data);
  res.json({ ok:true });
});

app.patch('/api/config', requireAdmin, (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Configuração inválida.', details: z.treeifyError(parsed.error) });
  engine.updateConfig(parsed.data);
  res.json(engine.getState());
});

app.post('/api/control/:action', requireAdmin, async (req, res) => {
  try {
    const action = req.params.action;
    if (action === 'start') engine.start();
    else if (action === 'restart') engine.restart();
    else if (action === 'pause') engine.pause();
    else if (action === 'resume') engine.resume();
    else if (action === 'finish') engine.finish();
    else if (action === 'stop-cycle') engine.stopCycle();
    else if (action === 'reset') engine.resetScore();
    else if (action === 'emergency') { engine.emergencyStop(String(req.body?.reason ?? 'Acionada pelo operador')); await adapter.stop(); }
    else if (action === 'release-emergency') engine.releaseEmergency();
    else return res.status(404).json({ error: 'Ação desconhecida.' });
    res.json(engine.getState());
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/simulate', requireAdmin, (req, res) => {
  const parsed = z.object({
    type: z.enum(['comment', 'gift', 'like']),
    candidate: z.enum(['lula', 'bolsonaro']).optional(),
    count: z.number().int().min(1).max(100).default(1),
    comment: z.string().trim().min(1).max(120).optional(),
    giftId: z.string().trim().max(80).optional(),
    giftName: z.string().trim().max(60).optional(),
    repeatCount: z.number().int().min(1).max(200).optional(),
    likes: z.number().int().min(1).max(100_000).optional(),
    registryGiftId: z.string().trim().max(80).optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Evento de teste inválido.' });
  // Durante uma transmissão real, só o disparo unitário é liberado.
  if (parsed.data.count > 1 && engine.isBroadcasting()) {
    return res.status(409).json({ error: 'Conector do TikTok ativo: rajadas e testes de carga ficam bloqueados durante a transmissão.' });
  }
  const config = engine.getState().config;
  const results = [];
  for (let index = 0; index < parsed.data.count; index++) {
    const id = `demo:${crypto.randomUUID()}`;
    const username = `demo_${Math.floor(Math.random() * 900 + 100)}`;
    const candidate = parsed.data.candidate ?? 'lula';
    const keyword = (candidate === 'lula' ? config.lulaKeyword : config.bolsonaroKeyword).split(',')[0].trim();
    results.push(engine.receive({
      source: 'demo', type: parsed.data.type, externalId: id, username,
      comment: parsed.data.type === 'comment' ? (parsed.data.comment ?? keyword) : undefined,
      giftId: parsed.data.type === 'gift'
        ? (parsed.data.giftId || (candidate === 'lula' ? config.lulaGiftId || '__demo_lula' : config.bolsonaroGiftId || '__demo_bolsonaro'))
        : undefined,
      forcedCandidate: parsed.data.type === 'gift' && !parsed.data.registryGiftId ? candidate : undefined,
      registryGiftId: parsed.data.type === 'gift' ? parsed.data.registryGiftId : undefined,
      repeatCount: parsed.data.type === 'gift' ? parsed.data.repeatCount : undefined,
      likes: parsed.data.type === 'like' ? (parsed.data.likes ?? 10) : undefined,
      raw: { simulated: true, giftName: parsed.data.giftName }
    }));
  }
  res.json({ ok: results.some(result => result.accepted), results });
});

// ---------------------------------------------------------------- presentes da corrida
const giftSchema = z.object({
  name:z.string().trim().min(1).max(60),
  tiktokGiftId:z.union([z.string().trim().regex(/^\d{1,20}$/, 'O ID do TikTok é numérico.'), z.literal(''), z.null()]).optional(),
  side:z.enum(['lula','bolsonaro']),
  effect:z.enum(['impulso','arrancada','turbo','escudo','tropeco','especial','aleatorio','recuperacao']),
  target:z.enum(['own','rival']),
  label:z.string().trim().min(1).max(28),
  costLabel:z.string().trim().max(24).optional(),
  intensity:z.number().min(0.2).max(3),
  durationSec:z.number().min(0).max(30),
  points:z.number().int().min(0).max(100_000),
  enabled:z.boolean(),
  order:z.number().int().min(0).max(999),
  confirmed:z.boolean().optional(),
  note:z.string().max(300).optional()
});

app.get('/api/gifts', requireAdmin, (_req, res) => res.json(store.raceGifts()));

app.post('/api/gifts', requireAdmin, (req, res) => {
  const parsed = giftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Revise os dados do presente.', details:z.treeifyError(parsed.error) });
  const gift = { id:crypto.randomUUID(), ...parsed.data, tiktokGiftId:parsed.data.tiktokGiftId || null, costLabel:parsed.data.costLabel ?? '',
    confirmed:parsed.data.confirmed ?? false, note:parsed.data.note ?? '', imageFile:null, createdAt:new Date().toISOString() };
  store.saveGift(gift);
  engine.giftsChanged();
  res.status(201).json(store.raceGift(gift.id));
});

app.patch('/api/gifts/:id', requireAdmin, (req, res) => {
  const existing = store.raceGift(String(req.params.id));
  if (!existing) return res.status(404).json({ error:'Presente não encontrado.' });
  const parsed = giftSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:'Revise os dados do presente.', details:z.treeifyError(parsed.error) });
  // Só aplica o que veio no corpo (mesma proteção do PATCH de áudio).
  const validated = parsed.data as Record<string, unknown>, patch: Record<string, unknown> = {};
  for (const key of Object.keys((req.body ?? {}) as Record<string, unknown>)) if (key in validated) patch[key] = validated[key];
  if ('tiktokGiftId' in patch) patch.tiktokGiftId = patch.tiktokGiftId || null;
  const { imageUrl: _ignored, ...base } = existing;
  store.saveGift({ ...base, ...patch } as typeof base);
  engine.giftsChanged();
  res.json(store.raceGift(existing.id));
});

app.delete('/api/gifts/:id', requireAdmin, (req, res) => {
  const removed = store.deleteGift(String(req.params.id));
  if (removed === undefined) return res.status(404).json({ error:'Presente não encontrado.' });
  if (removed) { try { fs.unlinkSync(path.join(store.giftDir, path.basename(removed))); } catch { /* já ausente */ } }
  engine.giftsChanged();
  res.json({ ok:true });
});

app.post('/api/gifts/:id/image', requireAdmin, giftUpload.single('image'), (req, res) => {
  const existing = store.raceGift(String(req.params.id));
  if (!existing) { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ error:'Presente não encontrado.' }); }
  if (!req.file) return res.status(400).json({ error:'Selecione uma imagem PNG, JPG ou WebP.' });
  if (!hasValidImageSignature(req.file.path, req.file.mimetype)) { fs.unlinkSync(req.file.path); return res.status(400).json({ error:'O arquivo não contém uma imagem válida.' }); }
  if (existing.imageFile) { try { fs.unlinkSync(path.join(store.giftDir, path.basename(existing.imageFile))); } catch { /* já ausente */ } }
  const { imageUrl: _ignored, ...base } = existing;
  store.saveGift({ ...base, imageFile:req.file.filename });
  store.log('info', 'Imagem de presente cadastrada', { id:existing.id, name:existing.name, file:req.file.filename });
  engine.giftsChanged();
  res.json(store.raceGift(existing.id));
});

app.get('/api/gift-files/:file', (req, res) => {
  const requested = path.basename(String(req.params.file));
  if (!store.raceGifts().some(gift => gift.imageFile === requested)) return res.status(404).json({ error:'Imagem não encontrada.' });
  res.setHeader('Cache-Control','no-cache');
  res.sendFile(requested, { root:store.giftDir });
});

app.post('/api/race/test', requireAdmin, (req, res) => {
  const parsed = z.object({
    candidate: z.enum(['lula', 'bolsonaro']),
    item: z.enum(['impulso', 'arrancada', 'turbo', 'escudo', 'tropeco']),
    strength: z.number().min(0.2).max(3).optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Item de corrida inválido.' });
  try {
    const result = engine.testRaceItem(parsed.data.candidate, parsed.data.item, parsed.data.strength ?? 1);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const candidateSchema = z.object({ candidate: z.enum(['lula', 'bolsonaro']) });

app.post('/api/race/overtake', requireAdmin, (req, res) => {
  const parsed = candidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe o corredor.' });
  try { res.json({ ok: true, ...engine.testOvertake(parsed.data.candidate) }); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.post('/api/race/finish', requireAdmin, (req, res) => {
  const parsed = candidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe o corredor.' });
  try { res.json({ ok: true, ...engine.testFinish(parsed.data.candidate) }); }
  catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.post('/api/audio/trigger', requireAdmin, (req, res) => {
  const parsed = z.object({
    trigger: audioTrigger,
    candidate: z.union([z.enum(['lula', 'bolsonaro']), z.null()]).optional().default(null)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Gatilho de áudio inválido.' });
  const blocked = audioBlocked();
  if (blocked) return res.status(409).json({ error: blocked });
  res.json({ ok: true, ...engine.testAudioTrigger(parsed.data.trigger, parsed.data.candidate ?? null) });
});

app.post('/api/tiktok/connect', requireAdmin, async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(2).max(80).transform(value => value.replace(/^@/, '')) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Informe o nome de usuário do TikTok.' });
  await adapter.stop(false);
  adapter = new TikTokAdapter(engine, parsed.data.username);
  void adapter.start();
  res.json({ ok: true, status: 'connecting' });
});

app.post('/api/tiktok/disconnect', requireAdmin, async (_req, res) => {
  await adapter.stop();
  res.json({ ok: true });
});

io.on('connection', socket => {
  socket.emit('arena:state', engine.getState());
  socket.on('arena:telemetry', payload => {
    const parsed = overlayTelemetrySchema.safeParse(payload);
    // O mixer atual sempre informa `safeMode`. Sem esse campo, a página roda um código antigo.
    if (parsed.success) overlayTelemetry.set(socket.id, { ...parsed.data, outdated: parsed.data.audio.safeMode === undefined, reportedAt:new Date().toISOString() });
  });
  socket.on('disconnect', () => overlayTelemetry.delete(socket.id));
});
let lastAudioTransition = '';
engine.on('state', (state, event) => {
  io.emit('arena:state', state);
  if (event) io.emit('arena:event', event);
  const transition = `${state.roundNumber}:${state.phase}`;
  if (transition !== lastAudioTransition && ['opening','results'].includes(state.phase)) {
    lastAudioTransition = transition;
    const overlays = [...overlayTelemetry.values()].filter(item => Date.now()-Date.parse(item.reportedAt)<10_000);
    store.log('info', 'Continuidade de áudio na transição de rodada', {
      round:state.roundNumber, phase:state.phase, audioSafeMode:state.config.audioSafeMode,
      soundEnabled:state.config.soundEnabled, overlays:overlays.map(item => ({
        pageLoadId:item.audio.pageLoadId, contexts:item.audio.contextsCreated,
        authorized:item.audio.authorized, state:item.audio.state, played:item.audio.played
      }))
    });
  }
});
engine.on('audio', cue => io.emit('arena:audio', cue));

const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', etag: true }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  store.log('error', 'Erro HTTP não tratado', { error: String(error) });
  if (error instanceof multer.MulterError || (error instanceof Error && error.message.includes('não permitido'))) {
    return res.status(400).json({ error:error instanceof multer.MulterError && error.code==='LIMIT_FILE_SIZE' ? `O arquivo excede o limite de ${error.field==='image'?'4':'8'} MB.` : error.message });
  }
  res.status(500).json({ error: 'Erro interno.' });
});

server.listen(port, host, () => {
  console.log(`LIVE ARENA 3D em http://${host}:${port}`);
  store.log('info', 'Servidor iniciado', { host, port, remoteAccess });
  if (process.env.TIKTOK_AUTO_CONNECT === 'true') void adapter.start();
  else engine.setConnector(process.env.TIKTOK_USERNAME ? 'disconnected' : 'disabled', process.env.TIKTOK_USERNAME ? 'Pronto para conexão manual' : 'Conector não configurado', process.env.TIKTOK_USERNAME ?? null);
  engine.ensureAutomaticCycle();
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Encerramento seguro solicitado (${signal})…`);
  store.log('info', 'Encerramento seguro', { signal });
  await adapter.stop(false);
  engine.shutdown();
  io.close();
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 8_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', error => { store.log('error', 'Exceção não tratada', { message: error.message, stack: error.stack }); void shutdown('uncaughtException'); });
process.on('unhandledRejection', reason => store.log('error', 'Promise rejeitada', { reason: String(reason) }));
