import type { Rng } from '../../core/rng';
import type { Seat } from '../../core/types';
import { KINDS, countKinds, hzKindOf, kindRank } from '../../mahjong/tiles136';
import { assignJokers, shanten } from './analysis';
import type { SzAction, SzView } from './index';

/**
 * 遂昌麻将电脑玩家：
 * - 胡就胡；碰 / 杠 / 吃只在不拖慢向听时进行；
 * - 出牌时把财神安排到最合适的位置再算向听，选向听最小、有效进张最多的一张；
 * - 财神绝不主动打出（不飞财）。
 */

function bestAfterDiscard(c: number[], melds: number): number {
  let best = 99;
  for (let k = 0; k < KINDS; k++) {
    if (c[k] <= 0) continue;
    c[k]--;
    best = Math.min(best, shanten(c, melds));
    c[k]++;
  }
  return best;
}

export function suichangBot(view: SzView, seat: Seat, rng: Rng): SzAction {
  const L = view.legal;
  if (!L) return { type: 'pass' };
  if (L.ready) return { type: 'ready' };
  if (L.hu) return { type: 'hu' };

  const me = view.players[seat];
  const melds = me.melds.length;
  const jokerKind = view.jokerKind;
  const virtual = assignJokers(countKinds(view.hand), jokerKind, melds);
  const now = shanten(virtual, melds);
  const isJoker = (kind: number) => jokerKind !== null && kind === jokerKind;

  if (view.window) {
    const tile = view.window.tile!;
    const kind = hzKindOf(tile);
    for (const g of L.gang) {
      if (g.type !== 'zhi' || virtual[kind] < 3) continue;
      const c = [...virtual];
      c[kind] -= 3;
      if (shanten(c, melds + 1) <= now) return { type: 'gang' };
    }
    if (L.peng && virtual[kind] >= 2) {
      const c = [...virtual];
      c[kind] -= 2;
      const s = bestAfterDiscard(c, melds + 1);
      if (s < now || (s === now && rng.next() < 0.45)) return { type: 'peng' };
    }
    if (L.chi.length) {
      let best: { tiles: number[]; s: number } | null = null;
      for (const pair of L.chi) {
        const c = [...virtual];
        let ok = true;
        for (const id of pair) {
          const t = view.hand.find((x) => x.id === id);
          if (!t) {
            ok = false;
            break;
          }
          const k = hzKindOf(t);
          if (c[k] <= 0) {
            ok = false;
            break;
          }
          c[k]--;
        }
        if (!ok) continue;
        const s = bestAfterDiscard(c, melds + 1);
        if (!best || s < best.s) best = { tiles: pair, s };
      }
      if (best && (best.s < now || (best.s === now && rng.next() < 0.35)))
        return { type: 'chi', tiles: best.tiles };
    }
    return { type: 'pass' };
  }

  for (const g of L.gang) {
    const t = view.hand.find((x) => x.id === g.tile);
    if (!t) continue;
    const k = hzKindOf(t);
    if (isJoker(k) || virtual[k] <= 0) continue;
    if (g.type === 'an') {
      if (virtual[k] < 4) continue;
      const c = [...virtual];
      c[k] -= 4;
      if (shanten(c, melds + 1) <= now) return { type: 'gang', tile: g.tile };
    } else {
      const c = [...virtual];
      c[k] -= 1;
      if (shanten(c, melds) <= now) return { type: 'gang', tile: g.tile };
    }
  }

  const seen = new Set<number>();
  let best: { id: number; score: number } | null = null;
  for (const id of L.discard) {
    const t = view.hand.find((x) => x.id === id);
    if (!t) continue;
    const k = hzKindOf(t);
    if (isJoker(k) || seen.has(k) || virtual[k] <= 0) continue;
    seen.add(k);
    const c = [...virtual];
    c[k]--;
    const s = shanten(c, melds);
    let ukeire = 0;
    for (let j = 0; j < KINDS; j++) {
      const left = 4 - view.visible[j];
      if (left <= 0 || c[j] >= 4) continue;
      c[j]++;
      if (shanten(c, melds) < s) ukeire += left;
      c[j]--;
    }
    const r = kindRank(k);
    let score = s * 1000 - ukeire * 8;
    if (r === 1 || r === 9) score -= 2;
    if (k >= 27) score -= 4;
    score += rng.next();
    if (!best || score < best.score) best = { id, score };
  }
  if (best) return { type: 'discard', tile: best.id };
  const any = L.discard[0] ?? view.hand[0]?.id;
  return { type: 'discard', tile: any };
}
