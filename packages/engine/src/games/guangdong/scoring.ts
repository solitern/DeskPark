import type { StdDecomp } from '../../mahjong/analysis';
import { isSevenPairs, standardDecomps } from '../../mahjong/analysis';
import { KINDS } from '../../mahjong/tiles';

/**
 * 广东麻将 · 推倒胡（规则版本 guangdong-tdh-1）番型与计分。
 *
 * - 只用万、条、筒 108 张，没有字牌，因此没有混一色 / 字一色 / 十三幺这类番型。
 * - 牌型番取最高、不叠加，只列并列最高的几个名字，收一次番。
 * - 无副露时标准型与七小对两种骨架都算，base 大者胜，相等时七小对优先。
 * - 8 番封顶；分 = 底分 × 2^(番 − 1)。
 */

export type GdFanId =
  | 'jihu'
  | 'pinghu'
  | 'duidui'
  | 'qidui'
  | 'haohuaqidui'
  | 'qingyise'
  | 'qingdui'
  | 'qingqidui'
  | 'qinghaohuaqidui'
  | 'gangshanghua'
  | 'qianggang'
  | 'haidi'
  | 'tianhu'
  | 'dihu';

export const GD_FAN_NAME: Record<GdFanId, string> = {
  jihu: '鸡胡',
  pinghu: '平胡',
  duidui: '碰碰胡',
  qidui: '七小对',
  haohuaqidui: '豪华七对',
  qingyise: '清一色',
  qingdui: '清对',
  qingqidui: '清七对',
  qinghaohuaqidui: '清豪华七对',
  gangshanghua: '杠上开花',
  qianggang: '抢杠',
  haidi: '海底捞月',
  tianhu: '天胡',
  dihu: '地胡',
};

export const GD_FAN_CAP = 8;

/** 副露形状：吃出的顺子也参与牌型判定 */
export interface GdMeldShape {
  type: 'chow' | 'pung' | 'kong';
  /** 顺子记最小牌；碰杠记该牌 */
  kind: number;
}

export interface GdHandValue {
  skeleton: 'standard' | 'qidui';
  patterns: GdFanId[];
  patternFan: number;
  base: number;
}

export interface GdWinContext {
  selfDrawn: boolean;
  afterKong: boolean;
  robbing: boolean;
  haidi: boolean;
  tianhu: boolean;
  dihu: boolean;
}

export interface GdFanItem {
  id: GdFanId;
  fan: number;
}

export interface GdWinScore {
  skeleton: 'standard' | 'qidui';
  items: GdFanItem[];
  fanRaw: number;
  fanCharged: number;
  points: number;
}

export function scoreOf(fan: number, baseScore: number, cap = GD_FAN_CAP): number {
  const f = Math.max(1, Math.min(fan, cap));
  return baseScore * 2 ** (f - 1);
}

function combinedCounts(concealed: readonly number[], melds: readonly GdMeldShape[]): number[] {
  const c = [...concealed];
  for (const m of melds) c[m.kind] += m.type === 'kong' ? 4 : 3;
  return c;
}

function standardValue(d: StdDecomp, melds: readonly GdMeldShape[], qingyise: boolean): GdHandValue {
  const sets = [
    ...d.sets,
    ...melds.map((m) => ({ type: m.type === 'chow' ? ('chow' as const) : ('pung' as const), kind: m.kind })),
  ];
  const duidui = sets.every((s) => s.type === 'pung');
  const pinghu = sets.every((s) => s.type === 'chow');
  const matched: [GdFanId, number][] = [['jihu', 1]];
  if (pinghu) matched.push(['pinghu', 1]);
  if (duidui) matched.push(['duidui', 2]);
  if (qingyise) matched.push(['qingyise', 4]);
  if (qingyise && duidui) matched.push(['qingdui', 5]);
  const top = Math.max(...matched.map((m) => m[1]));
  return {
    skeleton: 'standard',
    patterns: matched.filter((m) => m[1] === top).map((m) => m[0]),
    patternFan: top,
    base: top,
  };
}

/** 评估一手和牌（暗手计数已包含和进的那张）。形状不成立时返回 null。 */
export function evaluateHand(
  concealed: readonly number[],
  melds: readonly GdMeldShape[],
): GdHandValue | null {
  const all = combinedCounts(concealed, melds);
  const suits = [0, 1, 2].filter((s) => all.slice(s * 9, s * 9 + 9).some((n) => n > 0));
  if (suits.length === 0) return null;
  const qingyise = suits.length === 1;

  let best: GdHandValue | null = null;
  for (const d of standardDecomps(concealed, 4 - melds.length)) {
    const v = standardValue(d, melds, qingyise);
    if (!best || v.base > best.base) best = v;
  }

  if (isSevenPairs(concealed, melds.length)) {
    const has4 = concealed.some((n) => n === 4);
    let id: GdFanId = 'qidui';
    let fan = 3;
    if (has4) {
      id = 'haohuaqidui';
      fan = 4;
    }
    if (qingyise) {
      if (has4) {
        id = 'qinghaohuaqidui';
        fan = 7;
      } else {
        id = 'qingqidui';
        fan = 6;
      }
    }
    const v: GdHandValue = {
      skeleton: 'qidui',
      patterns: [id],
      patternFan: fan,
      base: fan,
    };
    if (!best || v.base >= best.base) best = v;
  }
  return best;
}

/** 加上过程番，得到最终番数与分数 */
export function scoreWin(value: GdHandValue, ctx: GdWinContext, baseScore: number): GdWinScore {
  const items: GdFanItem[] = value.patterns.map((id, i) => ({
    id,
    fan: i === 0 ? value.patternFan : 0,
  }));
  if (ctx.afterKong && ctx.selfDrawn) items.push({ id: 'gangshanghua', fan: 1 });
  if (ctx.robbing) items.push({ id: 'qianggang', fan: 1 });
  if (ctx.haidi && ctx.selfDrawn) items.push({ id: 'haidi', fan: 1 });
  if (ctx.tianhu) items.push({ id: 'tianhu', fan: 4 });
  if (ctx.dihu) items.push({ id: 'dihu', fan: 2 });
  const fanRaw = items.reduce((a, b) => a + b.fan, 0);
  return {
    skeleton: value.skeleton,
    items,
    fanRaw,
    fanCharged: Math.min(fanRaw, GD_FAN_CAP),
    points: scoreOf(fanRaw, baseScore),
  };
}

/** 手的骨架是否成立（用于 bot 判断"能不能胡"之外的地方） */
export function isWinningHand(concealed: readonly number[], melds: readonly GdMeldShape[]): boolean {
  return evaluateHand(concealed, melds) !== null;
}

export function describeScore(s: GdWinScore): string {
  return s.items.map((it) => GD_FAN_NAME[it.id]).join(' · ');
}

/** 参与清一色判定的牌种范围（108 张只有 27 种，全部是序数牌） */
export const GD_KINDS = KINDS;
