/**
 * 河洛杠次用的 136 张牌（带字牌、无花牌）。
 *
 * 牌 id 0..135，种类 kind = id // 4，取值 0..33：
 * 0–8 万、9–17 条、18–26 筒、27–30 东南西北、31–33 中发白。
 * 共用的 `mahjong/tiles` 只有 108 张序数牌，所以这里单独定义。
 */

export interface HlTile {
  id: number;
  kind: number;
}

export const HL_KINDS = 34;
/** 序数牌种类数（万条筒），27 及以上是字牌 */
export const HL_SUITED = 27;

export const HL_KIND_NAME: readonly string[] =
  '一万.二万.三万.四万.五万.六万.七万.八万.九万.一条.二条.三条.四条.五条.六条.七条.八条.九条.一筒.二筒.三筒.四筒.五筒.六筒.七筒.八筒.九筒.东.南.西.北.中.发.白'.split(
    '.',
  );

export function hlTileOf(id: number): HlTile {
  return { id, kind: Math.floor(id / 4) };
}

export function createHlTiles(): HlTile[] {
  return Array.from({ length: 136 }, (_, id) => hlTileOf(id));
}

export function hlKindName(kind: number): string {
  return HL_KIND_NAME[kind] ?? '?';
}

export function isHonor(kind: number): boolean {
  return kind >= HL_SUITED;
}

export function countHlKinds(tiles: readonly Pick<HlTile, 'kind'>[]): number[] {
  const c = new Array<number>(HL_KINDS).fill(0);
  for (const t of tiles) c[t.kind]++;
  return c;
}

export function sortHlTiles(tiles: readonly HlTile[]): HlTile[] {
  return [...tiles].sort((a, b) => a.kind - b.kind || a.id - b.id);
}

/**
 * 暗手（counts）能否和已有的 melds 组副露一起组成 4 面子 + 1 将。
 * 序数牌可组顺子；字牌只能组刻子/将。
 */
export function isHlWin(counts: readonly number[], meldCount: number): boolean {
  const need = 4 - meldCount;
  if (need < 0) return false;
  if (counts.reduce((a, b) => a + b, 0) !== need * 3 + 2) return false;
  const c = [...counts];
  const rec = (i: number, sets: number, hasPair: boolean): boolean => {
    while (i < HL_KINDS && c[i] === 0) i++;
    if (i === HL_KINDS) return hasPair && sets === need;
    if (!hasPair && c[i] >= 2) {
      c[i] -= 2;
      if (rec(i, sets, true)) return true;
      c[i] += 2;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      if (rec(i, sets + 1, hasPair)) return true;
      c[i] += 3;
    }
    if (i < HL_SUITED && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      if (rec(i, sets + 1, hasPair)) return true;
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
    return false;
  };
  return rec(0, 0, false);
}
