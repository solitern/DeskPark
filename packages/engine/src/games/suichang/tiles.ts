import { hzKindOf, type HzSuit, type HzTile } from '../../mahjong/tiles136';

export * from '../../mahjong/tiles136';

export type Suit = HzSuit;
export type Tile = HzTile & {
  /** 真正的财神（翻出的那 3 张），可以当任意牌 */
  joker?: boolean;
  /** 由白板替身来的普通牌（这一轮当作翻出的那张，例如一万） */
  sub?: boolean;
};

/** 白板：除翻出的牌之外，白板替身成翻出的那张牌（普通牌，不是万能牌）。 */
export const JIAN_BAI = 33;

/** 手里这张牌是不是真财神（万能牌） */
export const isJokerTile = (t: Pick<Tile, 'joker'>): boolean => !!t.joker;

export function countKinds(tiles: readonly Tile[]): number[] {
  const c = new Array<number>(34).fill(0);
  for (const t of tiles) c[hzKindOf(t)]++;
  return c;
}

/** 拆成「真实牌计数 + 财神张数」：白板替身算真实牌，真财神单列 */
export function splitTiles(
  tiles: readonly Tile[],
  jokerKind: number | null,
): { real: number[]; jokers: number } {
  const real = new Array<number>(34).fill(0);
  let jokers = 0;
  for (const t of tiles) {
    if (jokerKind !== null && t.joker) jokers++;
    else real[hzKindOf(t)]++;
  }
  return { real, jokers };
}

/**
 * 不搭专用计数：白板替身在「不搭」里算白板字牌，不算它替代的那张牌；
 * 真财神仍然是万能牌。
 */
export function splitTilesForBuDa(
  tiles: readonly Tile[],
  jokerKind: number | null,
): { real: number[]; jokers: number } {
  const real = new Array<number>(34).fill(0);
  let jokers = 0;
  for (const t of tiles) {
    if (jokerKind !== null && t.joker) jokers++;
    else if (t.sub) real[JIAN_BAI]++;
    else real[hzKindOf(t)]++;
  }
  return { real, jokers };
}

/** 手牌排序：财神放最左；白板替身放在它代替的那张牌的位置（按有效牌种排）。 */
export function sortTiles(tiles: readonly Tile[], jokerKind: number | null = null): Tile[] {
  const group = (t: Tile) => (jokerKind !== null && t.joker ? 0 : 1);
  return [...tiles].sort(
    (a, b) =>
      group(a) - group(b) ||
      hzKindOf(a) - hzKindOf(b) ||
      a.rank - b.rank ||
      a.id - b.id,
  );
}
