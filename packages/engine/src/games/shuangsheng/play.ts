import type { Card } from '../../core/cards';
import type { Comp, ESuit, SsCtx } from './cards';
import { compBeatenBy, decompose, esuit, followScore, seq, shapeValue, sortComps } from './cards';

/** 领出：必须同一门；多于一个组件即为甩牌 */
export function leadError(cards: readonly Card[], ctx: SsCtx): string | null {
  if (cards.length === 0) return '请选择要出的牌';
  const s = esuit(cards[0], ctx);
  if (!cards.every((c) => esuit(c, ctx) === s)) return '领出的牌必须是同一门（甩牌也只能同门）';
  return null;
}

export const isThrow = (cards: readonly Card[], ctx: SsCtx) => decompose(cards, ctx).length > 1;

/**
 * 甩牌检查：每个组件都必须不被其他任何一家（单独一家的同门牌）压过。
 * 成功返回 null；失败返回要强制出的那一组（失败组件中最小的：先比对子数再比大小）。
 */
export function throwFailure(
  cards: readonly Card[],
  others: readonly (readonly Card[])[],
  ctx: SsCtx,
): Comp | null {
  const comps = decompose(cards, ctx);
  if (comps.length <= 1) return null;
  const suit = esuit(cards[0], ctx);
  const failing = comps.filter((comp) =>
    others.some((h) =>
      compBeatenBy(
        comp,
        h.filter((c) => esuit(c, ctx) === suit),
        ctx,
      ),
    ),
  );
  if (!failing.length) return null;
  return [...failing].sort((a, b) => a.pairs - b.pairs || a.top - b.top)[0];
}

/** 跟牌合法性 */
export function followError(
  hand: readonly Card[],
  lead: readonly Card[],
  play: readonly Card[],
  ctx: SsCtx,
): string | null {
  if (play.length !== lead.length) return `需要出 ${lead.length} 张牌`;
  const suit = esuit(lead[0], ctx);
  const inSuit = hand.filter((c) => esuit(c, ctx) === suit);
  const playIn = play.filter((c) => esuit(c, ctx) === suit);
  const name = suit === 'T' ? '主牌' : '该花色';
  if (inSuit.length >= lead.length) {
    if (playIn.length !== lead.length) return `有${name}必须跟${name}`;
  } else {
    if (playIn.length !== inSuit.length) return `${name}不够时必须先把${name}全部跟出`;
    return null;
  }
  const comps = decompose(lead, ctx);
  const [ht, hp] = followScore(inSuit, comps, ctx);
  const [pt, pp] = followScore(playIn, comps, ctx);
  if (pt < ht) return '有拖拉机（连对）须跟拖拉机';
  if (pp < hp) return '有对子须跟对子';
  return null;
}

export interface TrickPlay {
  seat: number;
  cards: Card[];
}

/** 一墩里最大的出牌（下标）。同样大时先出者大。 */
export function trickWinnerIndex(plays: readonly TrickPlay[], ctx: SsCtx): number {
  if (!plays.length) return -1;
  const lead = plays[0].cards;
  const comps = decompose(lead, ctx);
  const leadSuit = esuit(lead[0], ctx);
  let best = 0;
  let bestTier = 0;
  let bestValue = shapeValue(lead, comps, ctx) ?? -1;
  for (let i = 1; i < plays.length; i++) {
    const cards = plays[i].cards;
    const s = suitOf(cards, ctx);
    let tier: number;
    if (s === leadSuit) tier = 0;
    else if (s === 'T') tier = 1;
    else continue;
    const v = shapeValue(cards, comps, ctx);
    if (v === null) continue;
    if (tier > bestTier || (tier === bestTier && v > bestValue)) {
      best = i;
      bestTier = tier;
      bestValue = v;
    }
  }
  return best;
}

/** 一组牌若同属一门则返回该门，否则 null */
export function suitOf(cards: readonly Card[], ctx: SsCtx): ESuit | null {
  if (!cards.length) return null;
  const s = esuit(cards[0], ctx);
  return cards.every((c) => esuit(c, ctx) === s) ? s : null;
}

export function leadComps(cards: readonly Card[], ctx: SsCtx): Comp[] {
  return sortComps(decompose(cards, ctx));
}

export { seq };
