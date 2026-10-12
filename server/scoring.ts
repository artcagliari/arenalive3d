import type { ArenaConfig, Candidate } from '../src/types.js';

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR');
}

export function candidateFromComment(comment: string, config: ArenaConfig): Candidate | null {
  const text = normalizeText(comment);
  const candidates: Array<[Candidate, string]> = [
    ['lula', config.lulaKeyword],
    ['bolsonaro', config.bolsonaroKeyword]
  ];
  for (const [candidate, rawKeyword] of candidates) {
    // Aceita uma lista separada por vírgula, por exemplo "13, LULA".
    for (const part of rawKeyword.split(',')) {
      const keyword = normalizeText(part.trim());
      if (!keyword) continue;
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`, 'u').test(text)) return candidate;
    }
  }
  return null;
}

export function candidateFromGift(giftId: string | number, config: ArenaConfig): Candidate | null {
  const id = String(giftId);
  if (config.lulaGiftId && id === config.lulaGiftId) return 'lula';
  if (config.bolsonaroGiftId && id === config.bolsonaroGiftId) return 'bolsonaro';
  return null;
}

export class DedupeCache {
  private seen = new Map<string, number>();
  constructor(private readonly ttlMs = 10 * 60_000, private readonly max = 5_000) {}

  accept(key: string, now = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    if (this.seen.size > this.max) this.seen.delete(this.seen.keys().next().value as string);
    return true;
  }


  get size(): number { return this.seen.size; }

  private prune(now: number) {
    for (const [key, at] of this.seen) {
      if (now - at <= this.ttlMs) break;
      this.seen.delete(key);
    }
  }
}
