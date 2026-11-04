import type { Card } from '../../core/cards';

/**
 * 潮汕钓红点（捡红点）的配对与计分。
 *
 * 配对只跟点数有关，与花色无关：
 * - A 只和 9 配（A+9，双向）
 * - 2+8、3+7、4+6
 * - 5 只和 5 配；10、J、Q、K 各自同牌才配
 *
 * 计分只看红牌（红桃 / 方块），黑桃梅花一律 0 分。
 */

/** 同牌才能配的点数：5、10、J、Q、K */
const SELF_PAIRS = new Set([5, 10, 11, 12, 13]);

export function pairs(rankA: number, rankB: number): boolean {
  if (rankA === rankB) return SELF_PAIRS.has(rankA);
  if (rankA + rankB === 10) return rankA >= 2 && rankA <= 8 && rankB >= 2 && rankB <= 8;
  return (rankA === 14 && rankB === 9) || (rankA === 9 && rankB === 14);
}

/** 对手牌 rank 来说，台面上哪些 rank 能配 */
export function partners(rank: number): number[] {
  const out: number[] = [];
  for (let r = 2; r <= 14; r++) if (pairs(rank, r)) out.push(r);
  return out;
}

export const isRedCardSuit = (card: Card) => card.suit === 'H' || card.suit === 'D';

/** 单张牌的分值（红 A 的取值由房规决定，默认 10） */
export function cardPoints(card: Card, redAce: number): number {
  if (!isRedCardSuit(card)) return 0;
  if (card.rank <= 8) return card.rank;
  if (card.rank === 14) return redAce;
  return 10; // 9、10、J、Q、K
}

export const isRedFive = (card: Card) => isRedCardSuit(card) && card.rank === 5;

/** 一堆牌的分数（不含红 5 奖励） */
export function pilePoints(cards: readonly Card[], redAce: number): number {
  return cards.reduce((sum, c) => sum + cardPoints(c, redAce), 0);
}

/** 一堆牌里能凑成几对红 5 */
export function redFivePairs(cards: readonly Card[]): number {
  const n = cards.filter(isRedFive).length;
  return Math.floor(n / 2);
}

export interface DhOptions {
  /** 红 A 的分值 */
  redAce: number;
  /** 牌全打完后，台面剩下的牌怎么处理 */
  tableEnd: 'void' | 'last';
  /** 红 5 对子额外奖励（每对 +10） */
  redFiveBonus: boolean;
  rounds: number;
}

export const RED_FIVE_BONUS = 10;
