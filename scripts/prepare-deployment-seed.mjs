import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceDirectory=path.resolve(root,process.env.ARENA_SOURCE_DATA_DIR??'data');
const targetDirectory=path.join(root,'deployment','seed-data');
const sourceDatabase=path.join(sourceDirectory,'live-arena.sqlite');

if(!fs.existsSync(sourceDatabase))throw new Error(`Banco local não encontrado: ${sourceDatabase}`);
fs.rmSync(targetDirectory,{recursive:true,force:true});
fs.mkdirSync(targetDirectory,{recursive:true});

const database=new Database(sourceDatabase,{readonly:true,fileMustExist:true});
try{await database.backup(path.join(targetDirectory,'live-arena.sqlite'))}finally{database.close()}

// O snapshot pode ser versionado para inicializar a hospedagem. Mantém apenas
// configurações e catálogos; histórico operacional e estado de uma corrida
// local não pertencem ao código-fonte publicado.
const snapshot=new Database(path.join(targetDirectory,'live-arena.sqlite'));
try{
  snapshot.exec('DELETE FROM events; DELETE FROM logs; DELETE FROM rounds; DELETE FROM runtime;');
  snapshot.pragma('wal_checkpoint(TRUNCATE)');
  snapshot.exec('VACUUM');
}finally{snapshot.close()}
for(const suffix of ['-shm','-wal'])fs.rmSync(path.join(targetDirectory,`live-arena.sqlite${suffix}`),{force:true});

const directories=['audio','characters','gifts'];
const counts={};
for(const directory of directories){
  const source=path.join(sourceDirectory,directory),target=path.join(targetDirectory,directory);
  if(fs.existsSync(source))fs.cpSync(source,target,{recursive:true});else fs.mkdirSync(target,{recursive:true});
  counts[directory]=fs.readdirSync(target).filter(name=>!name.startsWith('.')).length;
}

const manifest={createdAt:new Date().toISOString(),database:'live-arena.sqlite',sanitizedHistory:true,files:counts};
fs.writeFileSync(path.join(targetDirectory,'seed-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
console.log(`Snapshot consistente preparado em ${path.relative(root,targetDirectory)}: ${counts.audio} áudio(s), ${counts.characters} personagem(ns), ${counts.gifts} imagem(ns) de presente.`);
