import type { Card, Suit } from '../../core/cards';
import { BIG_JOKER, SMALL_JOKER, SUITS } from '../../core/cards';

/**
 * 亮主 / 反主的强度：
 * 1 弱主（王 + 单张级牌）、2 强主（王 + 一对级牌）、
 * 3 小无主（双小王，或翻底翻出小王）、4 大无主（双大王，或翻底翻出大王）。
 * 反主必须更强；用花色反时必须换花色；无主之后不能再反回花色。
 */
export type Strength = 1 | 2 | 3 | 4;

export interface Declaration {
  seat: number;
  /** 主花色；null 为无主 */
  suit: Suit | null;
  strength: Strength;
  /** 亮出 / 翻出的牌（公开） */
  cards: Card[];
  /** 是否由翻底决定 */
  flip?: boolean;
  /** 翻底也没定出主时的兜底 */
  fallback?: boolean;
}

export interface DeclOption {
  suit: Suit | null;
  strength: Strength;
  cards: Card[];
}

/** 花色对应的同色王：♠♣ 配小王，♥♦ 配大王 */
export const jokerFor = (suit: Suit): number =>
  suit === 'S' || suit === 'C' ? SMALL_JOKER : BIG_JOKER;

export const STRENGTH_NAME: Record<Strength, string> = {
  1: '弱主',
  2: '强主',
  3: '小无主',
  4: '大无主',
};

/** 手里所有可能的亮法（不考虑当前局面） */
export function allDeclarations(hand: readonly Card[], level: number): DeclOption[] {
  const out: DeclOption[] = [];
  const small = hand.filter((c) => c.suit === 'J' && c.rank === SMALL_JOKER);
  const big = hand.filter((c) => c.suit === 'J' && c.rank === BIG_JOKER);
  for (const suit of SUITS) {
    const joker = jokerFor(suit) === SMALL_JOKER ? small : big;
    if (!joker.length) continue;
    const lv = hand.filter((c) => c.suit === suit && c.rank === level);
    if (lv.length >= 1) out.push({ suit, strength: 1, cards: [joker[0], lv[0]] });
    if (lv.length >= 2) out.push({ suit, strength: 2, cards: [joker[0], lv[0], lv[1]] });
  }
  if (small.length >= 2) out.push({ suit: null, strength: 3, cards: [small[0], small[1]] });
  if (big.length >= 2) out.push({ suit: null, strength: 4, cards: [big[0], big[1]] });
  return out;
}

/** 首次亮主：只能王 + 级牌（弱主或强主），不能直接亮无主 */
export function initialOptions(hand: readonly Card[], level: number): DeclOption[] {
  return allDeclarations(hand, level).filter((o) => o.strength <= 2);
}

/** 能否用 opt 反掉 current */
export function canOverride(current: Declaration, opt: DeclOption, seat: number): boolean {
  if (current.seat === seat) return false;
  if (opt.strength <= current.strength) return false;
  if (opt.suit !== null) {
    // 花色反主只能反弱主，且必须换花色（反到同一花色毫无意义）
    if (current.suit === null || current.strength !== 1) return false;
    if (opt.suit === current.suit) return false;
    if (opt.strength !== 2) return false;
  }
  return true;
}

export function overrideOptions(
  hand: readonly Card[],
  level: number,
  current: Declaration,
  seat: number,
): DeclOption[] {
  return allDeclarations(hand, level).filter((o) => canOverride(current, o, seat));
}

/** 由亮出的牌推断亮法；不是有效亮法时返回 null */
export function parseDeclaration(cards: readonly Card[], level: number): DeclOption | null {
  const jokers = cards.filter((c) => c.suit === 'J');
  const rest = cards.filter((c) => c.suit !== 'J');
  if (cards.length === 2 && jokers.length === 2 && jokers[0].rank === jokers[1].rank) {
    return { suit: null, strength: jokers[0].rank === BIG_JOKER ? 4 : 3, cards: [...cards] };
  }
  if (jokers.length !== 1 || rest.length < 1 || rest.length > 2) return null;
  const suit = rest[0].suit;
  if (!rest.every((c) => c.suit === suit && c.rank === level)) return null;
  if (jokers[0].rank !== jokerFor(suit)) return null;
  return { suit, strength: rest.length === 2 ? 2 : 1, cards: [...cards] };
}

export function declLabel(o: { suit: Suit | null; strength: Strength }): string {
  const sym = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' } as const;
  if (o.suit === null) return STRENGTH_NAME[o.strength];
  return `${sym[o.suit]} ${STRENGTH_NAME[o.strength]}`;
}
