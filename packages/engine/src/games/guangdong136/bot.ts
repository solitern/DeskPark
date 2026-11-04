import type { Rng } from '../../core/rng';
import type { Seat } from '../../core/types';
import { shanten } from './analysis';
import { Z_KINDS, countKinds, isHonorKind, isTerminalKind } from './tiles';
import type { GdAction, GdView } from './index';

/**
 * 广东麻将 · 字牌版的电脑玩家：
 * - 能胡就胡（不够起胡番数的牌型引擎不会给出「胡」）；
 * - 碰 / 吃 / 杠只在能让向听不变差时进行（吃会额外比较「吃后打哪张」）；
 * - 出牌选使向听数最小、有效进张最多的一张，孤张字牌与幺九略降权。
 */

/** 打掉一张后最好的向听数 */
function bestDiscardShanten(counts: number[], melds: number): number {
  let best = 99;
  for (let k = 0; k < Z_KINDS; k++) {
    if (!counts[k]) continue;
    counts[k]--;
    const s = shanten(counts, melds);
    counts[k]++;
    if (s < best) best = s;
  }
  return best;
}

/** 有效进张数（还没摸到的张数） */
function ukeire(counts: number[], melds: number, visible: number[]): number {
  const base = shanten(counts, melds);
  let n = 0;
  for (let k = 0; k < Z_KINDS; k++) {
    if (counts[k] >= 4) continue;
    const left = 4 - visible[k];
    if (left <= 0) continue;
    counts[k]++;
    if (shanten(counts, melds) < base) n += left;
    counts[k]--;
  }
  return n;
}

export function gd136Bot(view: GdView, seat: Seat, rng: Rng): GdAction {
  const L = view.legal;
  if (!L) return { type: 'pass' };
  if (L.ready) return { type: 'ready' };
  if (L.hu) return { type: 'hu' };

  const me = view.players[seat];
  const melds = me.melds.length;
  const counts = countKinds(view.hand);

  if (view.window) {
    const tile = view.window.tile;
    if (!tile) return { type: 'pass' };
    const kind = tile.kind;
    const now = shanten(counts, melds);
    if (L.gang.length) {
      const c = [...counts];
      c[kind] -= 3;
      if (shanten(c, melds + 1) <= now) return { type: 'gang' };
    }
    if (L.peng) {
      const c = [...counts];
      c[kind] -= 2;
      const after = bestDiscardShanten(c, melds + 1);
      if (after < now || (after === now && rng.next() < 0.4)) return { type: 'peng' };
    }
    if (L.chi.length) {
      let pick: { ids: number[]; after: number } | null = null;
      for (const ids of L.chi) {
        const c = [...counts];
        for (const id of ids) {
          const t = view.hand.find((x) => x.id === id);
          if (t) c[t.kind]--;
        }
        const after = bestDiscardShanten(c, melds + 1);
        if (!pick || after < pick.after) pick = { ids, after };
      }
      if (pick && (pick.after < now || (pick.after === now && rng.next() < 0.3)))
        return { type: 'chi', tiles: pick.ids };
    }
    return { type: 'pass' };
  }

  // 自己的回合：先看要不要杠
  const base = shanten(counts, melds);
  for (const g of L.gang) {
    const t = view.hand.find((x) => x.id === g.tile);
    if (!t) continue;
    const k = t.kind;
    const c = [...counts];
    if (g.type === 'an') {
      c[k] = 0;
      if (shanten(c, melds + 1) <= base) return { type: 'gang', tile: g.tile };
    } else {
      c[k] -= 1;
      if (shanten(c, melds) <= base) return { type: 'gang', tile: g.tile };
    }
  }

  let best: { id: number; score: number } | null = null;
  const tried = new Set<number>();
  for (const id of L.discard) {
    const t = view.hand.find((x) => x.id === id);
    if (!t) continue;
    const k = t.kind;
    if (tried.has(k)) continue;
    tried.add(k);
    const c = [...counts];
    c[k]--;
    const s = shanten(c, melds);
    const u = ukeire(c, melds, view.visible);
    let score = s * 1000 - u * 10;
    if (isTerminalKind(k)) score -= 3;
    // 孤张字牌没有搭子价值，先打掉
    if (isHonorKind(k) && counts[k] === 1) score -= 4;
    score += rng.next();
    if (!best || score < best.score) best = { id, score };
  }
  if (!best) return { type: 'discard', tile: view.hand[0].id };
  return { type: 'discard', tile: best.id };
}
