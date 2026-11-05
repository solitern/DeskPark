/**
 * 广东麻将 · 字牌版（136 张）的牌张定义。
 *
 * 与共用模块 `mahjong/tiles` 的 108 张序数牌不同，这里没有花牌、但有字牌，
 * 因此单独定义一套 34 种的牌模型，避免改动四川麻将依赖的共用模块。
 *
 * 牌 id 0..135：kind = id // 4，copy = id % 4。
 * kind 0..26 为序数牌：万 0–8、条 9–17、筒 18–26（kind % 9 为点数 − 1）。
 * kind 27..30 为风牌：东 南 西 北；kind 31..33 为箭牌：中 发 白。
 */

export type ZSuit = 'wan' | 'tiao' | 'tong' | 'wind' | 'dragon';

export interface Tile {
  id: number;
  kind: number;
}

export const Z_KINDS = 34;
export const Z_SUIT_KINDS = 27;
export const Z_WIND_START = 27;
export const Z_DRAGON_START = 31;

export const Z_SUITS: readonly ZSuit[] = ['wan', 'tiao', 'tong'];
export const Z_SUIT_LABEL: Record<'wan' | 'tiao' | 'tong', string> = {
  wan: '万',
  tiao: '条',
  tong: '筒',
};
export const WIND_LABEL = ['東', '南', '西', '北'] as const;
export const DRAGON_LABEL = ['中', '發', '白'] as const;

export function tileOfId(id: number): Tile {
  return { id, kind: Math.floor(id / 4) };
}

export function createTiles(): Tile[] {
  return Array.from({ length: Z_KINDS * 4 }, (_, id) => tileOfId(id));
}

export const isSuitKind = (kind: number): boolean => kind < Z_SUIT_KINDS;
export const isWindKind = (kind: number): boolean => kind >= Z_WIND_START && kind < Z_DRAGON_START;
export const isDragonKind = (kind: number): boolean => kind >= Z_DRAGON_START;
export const isHonorKind = (kind: number): boolean => kind >= Z_SUIT_KINDS;

export function suitOfKind(kind: number): ZSuit | null {
  if (!isSuitKind(kind)) return null;
  return Z_SUITS[Math.floor(kind / 9)];
}

/** 序数牌点数 1–9；字牌返回 0 */
export function rankOfKind(kind: number): number {
  return isSuitKind(kind) ? (kind % 9) + 1 : 0;
}

/** 是否可以作为顺子的起点（序数牌 1–7） */
export function canStartChow(kind: number): boolean {
  return isSuitKind(kind) && kind % 9 <= 6;
}

/** 一万、九万、一条、九条、一筒、九筒 */
export function isTerminalKind(kind: number): boolean {
  if (!isSuitKind(kind)) return false;
  const r = kind % 9;
  return r === 0 || r === 8;
}

export function kindLabel(kind: number): string {
  if (isWindKind(kind)) return WIND_LABEL[kind - Z_WIND_START];
  if (isDragonKind(kind)) return DRAGON_LABEL[kind - Z_DRAGON_START];
  return `${rankOfKind(kind)}${Z_SUIT_LABEL[suitOfKind(kind) as 'wan' | 'tiao' | 'tong']}`;
}

export function tileLabel(t: Tile): string {
  return kindLabel(t.kind);
}

export function countKinds(tiles: readonly Pick<Tile, 'kind'>[]): number[] {
  const c = new Array<number>(Z_KINDS).fill(0);
  for (const t of tiles) c[t.kind]++;
  return c;
}

/** 手牌排序：万 → 条 → 筒 → 风 → 箭，同种按 id */
export function sortTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a.kind - b.kind || a.id - b.id);
}

export function suitsUsed(counts: readonly number[]): Set<ZSuit> {
  const out = new Set<ZSuit>();
  for (let k = 0; k < Z_SUIT_KINDS; k++) if (counts[k] > 0) out.add(suitOfKind(k)!);
  return out;
}

export function honorsUsed(counts: readonly number[]): boolean {
  for (let k = Z_SUIT_KINDS; k < Z_KINDS; k++) if (counts[k] > 0) return true;
  return false;
}
