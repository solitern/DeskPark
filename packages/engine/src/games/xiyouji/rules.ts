import type { Card } from '../../core/cards';
import { createDeck } from '../../core/cards';

/**
 * 西游记的牌与大小。
 *
 * 用两副牌中的 3、5、8、10、J、Q、K 和大小王，共 60 张。
 * 10 师傅；5 悟空、8 八戒、3 沙僧（徒弟）；K 大妖、Q 中妖、J 小妖（妖怪）；大小王为万能牌。
 * 师傅压徒弟，徒弟压妖怪，妖怪压师傅；徒弟内 5 > 8 > 3，妖怪内 K > Q > J。
 */

export const XYJ_RANKS = [10, 5, 8, 3, 13, 12, 11] as const;
export type XyjRank = (typeof XYJ_RANKS)[number];

export const XYJ_NAME: Record<number, string> = {
  10: '师傅',
  5: '悟空',
  8: '八戒',
  3: '沙僧',
  13: '大妖',
  12: '中妖',
  11: '小妖',
};

export const XYJ_WILD_NAME = '万能牌';

/** 0 师傅，1 徒弟，2 妖怪 */
export function groupOf(rank: number): 0 | 1 | 2 {
  if (rank === 10) return 0;
  if (rank === 5 || rank === 8 || rank === 3) return 1;
  return 2;
}

const INNER: Record<number, number> = { 10: 1, 5: 3, 8: 2, 3: 1, 13: 3, 12: 2, 11: 1 };

export function isXyjRank(r: unknown): r is XyjRank {
  return typeof r === 'number' && (XYJ_RANKS as readonly number[]).includes(r);
}

/** a 能否压过 b（同点不能压） */
export function beats(a: number, b: number): boolean {
  if (a === b) return false;
  const ga = groupOf(a);
  const gb = groupOf(b);
  if (ga === gb) return INNER[a] > INNER[b];
  // 师傅→徒弟→妖怪→师傅
  return (ga + 1) % 3 === gb;
}

export const isWildCard = (c: Card) => c.suit === 'J';

/** 手牌排序用：师傅、悟空、八戒、沙僧、大妖、中妖、小妖，万能牌放最前 */
export function sortValue(c: Card): number {
  if (isWildCard(c)) return 100 + c.rank;
  return 90 - XYJ_RANKS.indexOf(c.rank as XyjRank) * 10;
}

export function createXyjDeck(): Card[] {
  const keep = new Set<number>(XYJ_RANKS);
  return createDeck(2, true)
    .filter((c) => c.suit === 'J' || keep.has(c.rank))
    .map((c, i) => ({ ...c, id: i }));
}

export const MAX_PLAY = 8;

/** 解析一手牌：同点数（王可补任意点）。全是王时用 declared 指定点数。不合法返回 null。 */
export function resolvePlay(cards: readonly Card[], declared?: unknown): number | null {
  if (cards.length < 1 || cards.length > MAX_PLAY) return null;
  const naturals = cards.filter((c) => !isWildCard(c));
  if (naturals.length === 0) return isXyjRank(declared) ? declared : null;
  const r = naturals[0].rank;
  if (!naturals.every((c) => c.rank === r)) return null;
  return r;
}

export interface XyjOption {
  rank: XyjRank;
  /** 选用的牌 id（先用本点数的牌，不够再补王） */
  cards: number[];
  wilds: number;
}

/**
 * 列出能出的牌：count 为必须的张数（领出时为 null，表示 1..8 张都可以），
 * top 为要压过的点数（领出时为 null）。每个点数只给出用王最少的一组。
 */
export function playOptions(
  hand: readonly Card[],
  count: number | null,
  top: number | null,
): XyjOption[] {
  const wild = hand.filter(isWildCard);
  const out: XyjOption[] = [];
  for (const rank of XYJ_RANKS) {
    if (top !== null && !beats(rank, top)) continue;
    const nat = hand.filter((c) => !isWildCard(c) && c.rank === rank);
    const sizes = count !== null ? [count] : Array.from({ length: MAX_PLAY }, (_, i) => i + 1);
    for (const n of sizes) {
      const useNat = Math.min(nat.length, n);
      const needWild = n - useNat;
      if (needWild > wild.length) continue;
      out.push({
        rank,
        cards: [...nat.slice(0, useNat), ...wild.slice(0, needWild)].map((c) => c.id),
        wilds: needWild,
      });
    }
  }
  return out;
}

const CN_NUM = ['', '一', '两', '三', '四', '五', '六', '七', '八'];

/** 语音报牌：单张报名字，两张报「对X」，三张及以上报「N个X」 */
export function callOut(rank: number, count: number): string {
  const name = XYJ_NAME[rank] ?? '';
  if (count <= 1) return name;
  if (count === 2) return `对${name}`;
  return `${CN_NUM[count] ?? count}个${name}`;
}
