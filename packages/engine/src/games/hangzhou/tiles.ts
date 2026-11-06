/**
 * 杭州麻将的牌：136 张（万、条、筒各 36 张，风牌东南西北 16 张，箭牌中发白 12 张）。
 *
 * 与四川麻将的 108 张不同，这里多出 7 种字牌，所以单独定义「种类」：
 * kind = 0..26 对应万条筒（同四川），27..30 对应东南西北，31..33 对应中发白。
 * 牌 id 0..135：id // 4 即种类。
 */

export type HzSuit = 'wan' | 'tiao' | 'tong' | 'feng' | 'jian';

export interface HzTile {
  id: number;
  suit: HzSuit;
  rank: number;
}

export const HZ_SUITS: readonly HzSuit[] = ['wan', 'tiao', 'tong', 'feng', 'jian'];
export const NUMBER_SUITS: readonly HzSuit[] = ['wan', 'tiao', 'tong'];
export const HZ_SUIT_LABEL: Record<HzSuit, string> = {
  wan: '万',
  tiao: '条',
  tong: '筒',
  feng: '风',
  jian: '箭',
};

export const KINDS = 34;
/** 字牌（风、箭）的起始种类：字牌不能吃 */
export const HONOR_START = 27;

const FENG = ['东', '南', '西', '北'];
const JIAN = ['中', '发', '白'];

export function hzTileOf(id: number): HzTile {
  if (id < 108) {
    const suit = NUMBER_SUITS[Math.floor(id / 36)];
    return { id, suit, rank: Math.floor((id % 36) / 4) + 1 };
  }
  if (id < 124) return { id, suit: 'feng', rank: Math.floor((id - 108) / 4) + 1 };
  return { id, suit: 'jian', rank: Math.floor((id - 124) / 4) + 1 };
}

/** 136 张牌 */
export function createTiles(): HzTile[] {
  return Array.from({ length: 136 }, (_, id) => hzTileOf(id));
}

export function hzKindOf(t: Pick<HzTile, 'suit' | 'rank'>): number {
  if (t.suit === 'wan' || t.suit === 'tiao' || t.suit === 'tong') {
    return NUMBER_SUITS.indexOf(t.suit) * 9 + t.rank - 1;
  }
  if (t.suit === 'feng') return HONOR_START + t.rank - 1;
  return HONOR_START + 4 + t.rank - 1;
}

export function kindSuit(kind: number): HzSuit {
  if (kind < 27) return NUMBER_SUITS[Math.floor(kind / 9)];
  return kind < 31 ? 'feng' : 'jian';
}

export function kindRank(kind: number): number {
  if (kind < 27) return (kind % 9) + 1;
  return kind < 31 ? kind - 27 + 1 : kind - 31 + 1;
}

export const isHonor = (kind: number): boolean => kind >= HONOR_START;

export function kindName(kind: number): string {
  if (kind < 27) return `${kindRank(kind)}${HZ_SUIT_LABEL[kindSuit(kind)]}`;
  if (kind < 31) return `${FENG[kind - 27]}风`;
  return JIAN[kind - 31];
}

export function tileName(t: Pick<HzTile, 'suit' | 'rank'>): string {
  return kindName(hzKindOf(t));
}

export function countKinds(tiles: readonly Pick<HzTile, 'suit' | 'rank'>[]): number[] {
  const c = new Array<number>(KINDS).fill(0);
  for (const t of tiles) c[hzKindOf(t)]++;
  return c;
}

/** 财神：固定为白板（箭牌的第三张），共 4 张。 */
export const JOKER_KIND = 31 + 3 - 1;

/** 手牌排序：万条筒在前、字牌在后；同一门按点数与 id。财神始终放在最后，便于辨认。 */
export function sortTiles(tiles: readonly HzTile[], jokerKind: number | null = null): HzTile[] {
  const order = (t: HzTile) => {
    const k = hzKindOf(t);
    if (jokerKind !== null && k === jokerKind) return 2;
    return isHonor(k) ? 1 : 0;
  };
  return [...tiles].sort(
    (a, b) =>
      order(a) - order(b) || hzKindOf(a) - hzKindOf(b) || a.rank - b.rank || a.id - b.id,
  );
}

export function suitsOf(tiles: readonly Pick<HzTile, 'suit'>[]): Set<HzSuit> {
  return new Set(tiles.map((t) => t.suit));
}
