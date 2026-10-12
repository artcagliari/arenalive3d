import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../server/store.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('assets padrão dos personagens são PNG leves e configuráveis',()=>{
  const assets=[DEFAULT_CONFIG.lulaCharacterAsset,DEFAULT_CONFIG.bolsonaroCharacterAsset];
  for(const asset of assets){
    assert.ok(asset.startsWith('/characters/'));
    const filename=path.join(root,'public',asset);
    const contents=fs.readFileSync(filename);
    assert.ok(contents.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])));
    assert.ok(contents.byteLength<500*1024,`${asset} excedeu 500 KB`);
  }
  assert.ok(DEFAULT_CONFIG.characterAssetVersion>=1);
});
