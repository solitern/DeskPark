import type { Seat } from '../../core/types';

/** 胡牌方式 */
export type WinKind = 'mingci' | 'anci' | 'pici' | 'zimo' | 'baoci';
/** 杠的类型：明杠（杠别人打出的牌）/ 暗杠 / 加杠（碰后补杠） */
export type KongType = 'ming' | 'an' | 'ba';

export const WIN_NAME: Record<WinKind, string> = {
  mingci: '明次',
  anci: '暗次',
  pici: '屁次',
  zimo: '自摸',
  baoci: '包次',
};

export const KONG_NAME: Record<KongType, string> = { ming: '明杠', an: '暗杠', ba: '加杠' };

/** 另外三家，按出牌顺序 */
export const othersOf = (seat: Seat): Seat[] => [1, 2, 3].map((d) => (seat + d) % 4);

/**
 * 胡牌分（不含杠分）。
 * - 明次：出杠牌的人 -2，另外两家各 -1，赢家 +4（加杠出的次，-2 由当初碰的出牌人出）；
 * - 暗次 / 屁次：每家 -2，赢家 +6；
 * - 自摸（软次）：每家 -0.5，赢家 +1.5；
 * - 包次：放张者 -4，赢家 +4。
 */
export function winDeltas(
  kind: WinKind,
  winner: Seat,
  from: Seat | null,
  baoFrom: Seat | null,
): number[] {
  const d = [0, 0, 0, 0];
  if (kind === 'baoci' && baoFrom !== null) {
    d[baoFrom] -= 4;
    d[winner] += 4;
    return d;
  }
  if (kind === 'mingci') {
    if (from !== null) {
      d[from] -= 2;
      for (const s of othersOf(winner)) if (s !== from) d[s] -= 1;
    } else {
      for (const s of othersOf(winner)) d[s] -= 4 / 3;
    }
    d[winner] += 4;
    return d;
  }
  if (kind === 'anci' || kind === 'pici') {
    for (const s of othersOf(winner)) d[s] -= 2;
    d[winner] += 6;
    return d;
  }
  for (const s of othersOf(winner)) d[s] -= 0.5;
  d[winner] += 1.5;
  return d;
}

/** 杠分：明杠由点杠者付 0.5；暗杠、加杠三家各付 0.5。 */
export function kongDeltas(type: KongType, seat: Seat, from: Seat | null): number[] {
  const d = [0, 0, 0, 0];
  if (type === 'ming' && from !== null) {
    d[from] -= 0.5;
    d[seat] += 0.5;
    return d;
  }
  for (const s of othersOf(seat)) d[s] -= 0.5;
  d[seat] += 1.5;
  return d;
}
