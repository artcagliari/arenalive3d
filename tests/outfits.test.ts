import assert from 'node:assert/strict';
import test from 'node:test';
import { OUTFITS, RACE_OUTFITS } from '../src/outfits.js';

test('figurinos de Lula e Bolsonaro são visualmente distintos',()=>{
  const l=OUTFITS.lula,b=OUTFITS.bolsonaro;
  assert.notEqual(l.jacket,b.jacket);assert.notEqual(l.tie,b.tie);assert.notEqual(l.pin,b.pin);
  assert.ok(l.build.width>b.build.width,'Lula deve ter silhueta mais larga');
  assert.ok(b.build.tieLength>l.build.tieLength,'Bolsonaro deve ter silhueta mais alongada');
  for(const o of [l,b]){assert.match(o.jacket,/^#[0-9a-f]{6}$/i);assert.notEqual(o.jacket.toLowerCase(),o.shirt.toLowerCase())}
});

test('os corredores têm identidade visual própria e distinta', () => {
  const l = RACE_OUTFITS.lula, b = RACE_OUTFITS.bolsonaro;
  assert.equal(l.number, '13');
  assert.equal(b.number, '22');
  assert.notEqual(l.jersey, b.jersey);
  assert.notEqual(l.trim, b.trim);
  assert.notEqual(l.legStyle, b.legStyle, 'calça comprida x bermuda separam as silhuetas');
  assert.ok(l.build.width > b.build.width, 'Lula mais largo');
  assert.ok(b.build.stride > l.build.stride, 'Bolsonaro com passada mais longa');
  for (const outfit of [l, b]) {
    for (const [field, value] of Object.entries(outfit)) {
      if (typeof value === 'string' && value.startsWith('#')) {
        assert.match(value, /^#[0-9a-f]{6}$/i, `${field} precisa ser uma cor hexadecimal`);
      }
    }
    assert.notEqual(outfit.jersey.toLowerCase(), outfit.shorts.toLowerCase());
    assert.notEqual(outfit.jersey.toLowerCase(), outfit.ink.toLowerCase());
  }
});
