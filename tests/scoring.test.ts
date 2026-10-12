import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateFromComment, candidateFromGift, DedupeCache } from '../server/scoring.js';
import { DEFAULT_CONFIG } from '../server/store.js';

test('comentários reconhecem palavras inteiras sem diferenciar maiúsculas ou acentos', () => {
  assert.equal(candidateFromComment('Meu apoio é LULA!', DEFAULT_CONFIG), 'lula');
  assert.equal(candidateFromComment('voto no bolsonaro hoje', DEFAULT_CONFIG), 'bolsonaro');
  assert.equal(candidateFromComment('a palavra lulapalooza não conta', DEFAULT_CONFIG), null);
});

test('presentes usam apenas os IDs configurados', () => {
  const config = { ...DEFAULT_CONFIG, lulaGiftId: '101', bolsonaroGiftId: '202' };
  assert.equal(candidateFromGift(101, config), 'lula');
  assert.equal(candidateFromGift('202', config), 'bolsonaro');
  assert.equal(candidateFromGift('303', config), null);
});

test('deduplicação rejeita repetição e aceita após expiração', () => {
  const cache = new DedupeCache(100);
  assert.equal(cache.accept('gift:1', 1_000), true);
  assert.equal(cache.accept('gift:1', 1_050), false);
  assert.equal(cache.accept('gift:1', 1_101), true);
});
