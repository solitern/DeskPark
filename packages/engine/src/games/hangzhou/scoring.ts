import {
  isSevenPairs,
  pungWinWithJokers,
  sevenPairsWithJokers,
  winWithJokers,
} from './analysis';
import type { HzTile } from './tiles';
import { KINDS, NUMBER_SUITS, countKinds, kindSuit } from './tiles';

/**
 * 杭州麻将台数与计分（规则版本 hangzhou-cs-1）。
 *
 * 牌型台取最高、不叠加；过程台（自摸、杠上开花、抢杠、海底、天地胡）另加。
 * 分 = 底分 × 2^(台 − 1)，台数封顶 10 台。点炮只由点炮者付，自摸三家各付。
 */

export type HzFanId =
  | 'pinghu'
  | 'pengpeng'
  | 'qidui'
  | 'qingyise'
  | 'qingpeng'
  | 'haohuaqidui'
  | 'qingqidui'
  | 'qinghaohua'
  | 'zimo'
  | 'gangshanghua'
  | 'qianggang'
  | 'haidi'
  | 'tianhu'
  | 'dihu';

export const FAN_NAME: Record<HzFanId, string> = {
  pinghu: '平胡',
  pengpeng: '碰碰胡',
  qidui: '七对',
  qingyise: '清一色',
  qingpeng: '清碰',
  haohuaqidui: '豪华七对',
  qingqidui: '清七对',
  qinghaohua: '清豪华七对',
  zimo: '自摸',
  gangshanghua: '杠上开花',
  qianggang: '抢杠胡',
  haidi: '海底捞月',
  tianhu: '天胡',
  dihu: '地胡',
};

export const FAN_CAP = 10;

export interface MeldShape {
  type: 'chi' | 'pung' | 'kong';
  kind: number;
}

export interface WinContext {
  selfDrawn: boolean;
  afterKong: boolean;
  robbing: boolean;
  haidi: boolean;
  tianhu: boolean;
  dihu: boolean;
}

export interface FanItem {
  id: HzFanId;
  fan: number;
}

export interface WinScore {
  patterns: HzFanId[];
  items: FanItem[];
  fanRaw: number;
  fanCharged: number;
  points: number;
  qingyise: boolean;
  qidui: boolean;
  haohua: boolean;
  pengpeng: boolean;
}

export function scoreOf(fan: number, baseScore: number, cap = FAN_CAP): number {
  const f = Math.max(1, Math.min(fan, cap));
  return baseScore * 2 ** (f - 1);
}

/** 手牌（暗手 + 副露）是否清一色：非财神的牌全部是同一门序数牌（财神可以当这门牌用） */
function isQingyise(
  counts: readonly number[],
  melds: readonly MeldShape[],
  jokerKind: number | null,
): boolean {
  const suits = new Set<string>();
  for (let k = 0; k < KINDS; k++) {
    if (counts[k] > 0 && k !== jokerKind) suits.add(kindSuit(k));
  }
  for (const m of melds) suits.add(kindSuit(m.kind));
  if (suits.size !== 1) return false;
  const only = [...suits][0] as string;
  return (NUMBER_SUITS as readonly string[]).includes(only);
}

/** 七对里有没有四张相同（豪华七对） */
function hasLuxuryPair(counts: readonly number[], jokerKind: number | null): boolean {
  return counts.some((n, k) => n >= 4 && k !== jokerKind);
}

/**
 * 评估一手和牌。`concealed` 已包含和进的那张牌；`jokerKind` 为财神种类（null 表示这局没有财神）。
 * 不能和牌时返回 null。
 */
export function evaluateWin(
  concealed: readonly HzTile[],
  melds: readonly MeldShape[],
  jokerKind: number | null,
  ctx: WinContext,
  baseScore: number,
): WinScore | null {
  const counts = countKinds(concealed);
  const setsNeeded = 4 - melds.length;
  if (!winWithJokers(counts, jokerKind, setsNeeded)) return null;

  const qidui =
    jokerKind !== null
      ? sevenPairsWithJokers(counts, jokerKind)
      : isSevenPairs(counts, melds.length);
  const haohua = qidui && hasLuxuryPair(counts, jokerKind);
  const pengpeng = pungWinWithJokers(counts, jokerKind, setsNeeded);
  const qingyise = isQingyise(counts, melds, jokerKind);

  const matched: [HzFanId, number][] = [['pinghu', 1]];
  if (pengpeng) matched.push(['pengpeng', 2]);
  if (qidui) matched.push(['qidui', 4]);
  if (qingyise) matched.push(['qingyise', 4]);
  if (qingyise && pengpeng) matched.push(['qingpeng', 6]);
  if (qidui && haohua) matched.push(['haohuaqidui', 6]);
  if (qingyise && qidui) matched.push(['qingqidui', 8]);
  if (qingyise && qidui && haohua) matched.push(['qinghaohua', 10]);
  const top = Math.max(...matched.map((m) => m[1]));
  const patterns = matched.filter((m) => m[1] === top).map((m) => m[0]);

  const items: FanItem[] = patterns.map((id, i) => ({ id, fan: i === 0 ? top : 0 }));
  if (ctx.selfDrawn) items.push({ id: 'zimo', fan: 1 });
  if (ctx.afterKong && ctx.selfDrawn) items.push({ id: 'gangshanghua', fan: 1 });
  if (ctx.robbing) items.push({ id: 'qianggang', fan: 1 });
  if (ctx.haidi && ctx.selfDrawn) items.push({ id: 'haidi', fan: 1 });
  if (ctx.tianhu) items.push({ id: 'tianhu', fan: 8 });
  if (ctx.dihu) items.push({ id: 'dihu', fan: 8 });
  const fanRaw = items.reduce((a, b) => a + b.fan, 0);
  return {
    patterns,
    items,
    fanRaw,
    fanCharged: Math.min(fanRaw, FAN_CAP),
    points: scoreOf(fanRaw, baseScore),
    qingyise,
    qidui,
    haohua,
    pengpeng,
  };
}

export function describeScore(s: WinScore): string {
  return s.items.map((it) => FAN_NAME[it.id]).join(' · ');
}
