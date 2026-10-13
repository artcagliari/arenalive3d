import type { RaceGift } from '../src/types.js';

export interface RegistryProblem {
  type: 'custo_diferente' | 'id_repetido_no_par' | 'id_duplicado';
  gifts: string[];
  detail: string;
}

/** Pares = mesma posição (`order`) nas duas colunas; cada par deve ter custo igual e IDs do TikTok distintos. */
export function validateGiftRegistry(gifts: RaceGift[]): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const byOrder = new Map<number, RaceGift[]>();
  for (const gift of gifts) byOrder.set(gift.order, [...(byOrder.get(gift.order) ?? []), gift]);
  for (const pair of byOrder.values()) {
    const lula = pair.find(gift => gift.side === 'lula'), bolsonaro = pair.find(gift => gift.side === 'bolsonaro');
    if (!lula || !bolsonaro) continue;
    if (lula.costLabel !== bolsonaro.costLabel) {
      problems.push({ type: 'custo_diferente', gifts: [lula.id, bolsonaro.id], detail: `${lula.name} (${lula.costLabel}) × ${bolsonaro.name} (${bolsonaro.costLabel})` });
    }
    if (lula.tiktokGiftId && lula.tiktokGiftId === bolsonaro.tiktokGiftId) {
      problems.push({ type: 'id_repetido_no_par', gifts: [lula.id, bolsonaro.id], detail: `${lula.name} e ${bolsonaro.name} usam o mesmo ID ${lula.tiktokGiftId}` });
    }
  }
  const owners = new Map<string, RaceGift[]>();
  for (const gift of gifts) if (gift.tiktokGiftId) owners.set(gift.tiktokGiftId, [...(owners.get(gift.tiktokGiftId) ?? []), gift]);
  for (const [id, list] of owners) {
    if (list.length > 1 && !problems.some(p => p.type === 'id_repetido_no_par' && p.gifts.every(g => list.some(x => x.id === g)))) {
      problems.push({ type: 'id_duplicado', gifts: list.map(gift => gift.id), detail: `ID ${id} usado por ${list.map(gift => gift.name).join(', ')}` });
    }
  }
  return problems;
}
