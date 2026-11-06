import type { Rng } from '../../core/rng';
import type { Seat } from '../../core/types';
import type { HlAction, HlView } from './index';
import { HL_SUITED } from './tiles';

/**
 * 河洛杠次规则电脑（只读 view）：
 * 能屁次就屁次，能自摸就自摸；表态时能杠就杠、能碰就碰；
 * 自己回合有杠先杠（杠才有机会次）；出牌时打最孤立的牌，尽量留住次牌。
 */
export function heluoBot(v: HlView, _seat: Seat, rng: Rng): HlAction {
  const L = v.legal;
  if (!L) return { type: 'pass' };
  if (L.ready) return { type: 'ready' };
  if (L.pici) return { type: 'pici' };
  if (L.hu) return { type: 'hu' };
  if (v.window) {
    if (L.gang.length) return { type: 'gang' };
    if (L.peng) return { type: 'peng' };
    return { type: 'pass' };
  }
  if (L.gang.length) return { type: 'gang', tile: L.gang[0].tile };
  if (!L.discard.length) return { type: 'pass' };

  const hand = v.hand;
  const cnt = (k: number) => hand.filter((t) => t.kind === k).length;
  // 序数牌与相邻牌的关联度，越高越不该打
  const near = (k: number) => {
    let n = 0;
    if (k < HL_SUITED) {
      if (k % 9 > 0) n += cnt(k - 1);
      if (k % 9 < 8) n += cnt(k + 1);
      if (k % 9 > 1) n += cnt(k - 2) * 0.5;
      if (k % 9 < 7) n += cnt(k + 2) * 0.5;
    }
    return n;
  };

  let best = L.discard[0];
  let bestScore = Infinity;
  const seen = new Set<number>();
  for (const id of L.discard) {
    const t = hand.find((x) => x.id === id);
    if (!t || seen.has(t.kind)) continue;
    seen.add(t.kind);
    let score = cnt(t.kind) * 10 + near(t.kind);
    if (t.kind === v.ciKind) score += 20;
    score += rng.next();
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return { type: 'discard', tile: best };
}
