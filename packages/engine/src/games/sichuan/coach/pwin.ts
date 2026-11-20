import { PWIN_TABLE } from './pwin-table';

/**
 * 胡牌概率查表（算法说明第 4.2 节）：P_win = Table_type(向听 s, 有效进张 u, 有效摸牌次数 T_eff)。
 * 表由 scripts/build-sc-pwin.ts 离线模拟生成；这里只做查表与插值。
 */

/** 有效进张分桶的左边界：第 i 桶为 [U_EDGES[i], U_EDGES[i+1]) */
export const U_EDGES = [0, 1, 3, 5, 7, 9, 11, 14, 18, 22, 27, 33, 40, 48, 56] as const;
/** 各桶的代表值（插值用） */
export const U_CENTERS = [0, 2, 4, 6, 8, 10, 12.5, 16, 20, 24.5, 30, 36.5, 44, 52, 60] as const;
/** 摸牌次数格点 */
export const T_GRID = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40] as const;
export const MAX_SHANTEN = 5;

export type PwinType = 'std' | 'qidui';

export function uBucket(u: number): number {
  let i = 0;
  while (i + 1 < U_EDGES.length && u >= U_EDGES[i + 1]) i++;
  return i;
}

/** 在升序格点上找插值位置：返回 [下标, 权重] */
function locate(grid: readonly number[], x: number): [number, number] {
  if (x <= grid[0]) return [0, 0];
  const last = grid.length - 1;
  if (x >= grid[last]) return [last, 0];
  let i = 0;
  while (grid[i + 1] <= x) i++;
  return [i, (x - grid[i]) / (grid[i + 1] - grid[i])];
}

/** 胡牌概率：s 向听、u 张有效进张、还有 tEff 次（含点炮折算）摸牌机会 */
export function pWin(type: PwinType, s: number, u: number, tEff: number): number {
  if (s < 0) return 1;
  if (!(tEff > 0)) return 0;
  if (s > MAX_SHANTEN) {
    // 表只到 5 向听：再往上按 P(5) / P(4) 的比例逐级递减，避免把 8 向听当成 5 向听
    const p5 = lookup(type, MAX_SHANTEN, u, tEff);
    const p4 = lookup(type, MAX_SHANTEN - 1, u, tEff);
    const r = p4 > 0 ? Math.min(1, p5 / p4) : 0;
    return p5 * Math.pow(r, s - MAX_SHANTEN);
  }
  return lookup(type, Math.round(s), u, tEff);
}

function lookup(type: PwinType, s: number, u: number, tEff: number): number {
  const table = PWIN_TABLE[type][s];
  const [ui, uw] = locate(U_CENTERS, u);
  const at = (ti: number) => {
    const row = table[ui];
    const a = row[ti];
    return uw ? a + (table[ui + 1][ti] - a) * uw : a;
  };
  if (tEff < T_GRID[0]) return at(0) * (tEff / T_GRID[0]);
  const [ti, tw] = locate(T_GRID, tEff);
  const a = at(ti);
  return tw ? a + (at(ti + 1) - a) * tw : a;
}
