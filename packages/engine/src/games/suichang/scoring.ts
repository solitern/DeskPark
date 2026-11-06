import { KINDS, NUMBER_SUITS, kindSuit } from '../../mahjong/tiles136';
import { pungWinRaw, sevenPairsRaw, standardWinRaw, total } from '../../mahjong/analysis136';
import { BUDA_FAN, BUDA_NAME, isSevenWinds, nonMeldWin } from './analysis';
import type { BuDaClass } from './analysis';
import { splitTiles } from './tiles';
import type { Tile } from './tiles';

/**
 * 遂昌麻将的番型与计分。
 *
 * 平胡 = 0 番 = 1 倍；倍数 = 2^番；不封顶。
 * 牌型番相加，自摸 +1、杠上开花 +1、天胡 / 地胡 +2（不再叠自摸）、
 * 飞财自摸 +1（只有飞财者）、爆头 +1。
 * 付款基数：涉及庄家就用庄家底分（6/8/10…），两个闲家之间用 5。
 */

export type FanId =
  | 'pinghu'
  | 'pengpeng'
  | 'hunyise'
  | 'qidui'
  | 'haohua'
  | 'qingyise'
  | 'ziyise'
  | 'buda_regular'
  | 'buda_luxury'
  | 'buda_ultra'
  | 'qifeng'
  | 'quanluodi'
  | 'zimo'
  | 'gangshanghua'
  | 'tianhu'
  | 'dihu'
  | 'feicai'
  | 'baotou';

export const FAN_NAME: Record<FanId, string> = {
  pinghu: '平胡',
  pengpeng: '碰碰胡',
  hunyise: '混一色',
  qidui: '七对',
  haohua: '豪华七对',
  qingyise: '清一色',
  ziyise: '字一色',
  buda_regular: '正规不搭',
  buda_luxury: '豪华不搭',
  buda_ultra: '超豪华不搭',
  qifeng: '七风',
  quanluodi: '全落地',
  zimo: '自摸',
  gangshanghua: '杠上开花',
  tianhu: '天胡',
  dihu: '地胡',
  feicai: '飞财自摸',
  baotou: '爆头',
};

export interface MeldShape {
  type: 'chi' | 'pung' | 'kong';
  kind: number;
}

export interface WinContext {
  selfDrawn: boolean;
  afterKong: boolean;
  tianhu: boolean;
  dihu: boolean;
  /** 飞财者的下一次摸牌自摸 */
  flyBonus: boolean;
  /** 爆头（财神做将，听所有牌） */
  explosive: boolean;
}

export interface FanItem {
  id: FanId;
  fan: number;
}

export interface WinScore {
  patterns: FanItem[];
  fan: number;
  multiplier: number;
  /** 不搭档次（不是不搭时为 null） */
  buda: BuDaClass | null;
}

export const BASE_SCORE = 5;
export const DEALER_BASE = 6;
export const DEALER_STEP = 2;
export const START_CHIPS = 50;
export const ROB_BASE = 50;
export const THREE_CLEAR_BONUS = 50;
/** 留底：牌墙剩这么多张就不再摸，转荒庄 */
export const WALL_RESERVE = 34;

export const scoreOf = (fan: number): number => 2 ** fan;

/** 手牌与副露里出现的花色 */
function suitsOfHand(counts: readonly number[], melds: readonly MeldShape[]): Set<string> {
  const suits = new Set<string>();
  for (let k = 0; k < KINDS; k++) {
    if (counts[k] > 0) suits.add(kindSuit(k));
  }
  for (const m of melds) suits.add(kindSuit(m.kind));
  return suits;
}

/**
 * 评估一手和牌。`concealed` 已包含和进的那张牌；不能和牌返回 null。
 * 爆头、飞财、天胡 / 地胡由调用方在 ctx 里给出。
 */
export function evaluateWin(
  concealed: readonly Tile[],
  melds: readonly MeldShape[],
  jokerKind: number | null,
  ctx: WinContext,
): WinScore | null {
  const { real, jokers } = splitTiles(concealed, jokerKind);
  const meldCount = melds.length;
  const setsNeeded = 4 - meldCount;
  const items: FanItem[] = [];
  let buda: BuDaClass | null = null;

  if (meldCount === 0) {
    buda = nonMeldWin(real, jokers);
  }

  if (!buda) {
    const qidui = meldCount === 0 && sevenPairsRaw(real, jokers);
    if (!standardWinRaw(real, jokers, setsNeeded) && !qidui) return null;
    const haohua = qidui && real.some((n) => n >= 4);
    const pengpeng =
      melds.every((m) => m.type !== 'chi') && pungWinRaw(real, jokers, setsNeeded);
    const suits = suitsOfHand(real, melds);
    const numberSuits = [...suits].filter((s) =>
      (NUMBER_SUITS as readonly string[]).includes(s),
    );
    const honors = suits.has('feng') || suits.has('jian');
    const qing = numberSuits.length === 1 && !honors;
    const zi = numberSuits.length === 0 && honors;
    const hun = numberSuits.length === 1 && honors;

    // 标准型与七对分别算分，取高的
    const standard: [FanId, number][] = [];
    if (pengpeng) standard.push(['pengpeng', 1]);
    if (qing) standard.push(['qingyise', 2]);
    else if (hun) standard.push(['hunyise', 1]);
    if (zi) standard.push(['ziyise', 3]);
    if (!standard.length) standard.push(['pinghu', 0]);
    const qiduiItems: [FanId, number][] = [];
    if (qidui) {
      qiduiItems.push(['qidui', 1]);
      if (haohua) qiduiItems.push(['haohua', 1]);
      if (qing) qiduiItems.push(['qingyise', 2]);
      else if (hun) qiduiItems.push(['hunyise', 1]);
      if (zi) qiduiItems.push(['ziyise', 3]);
    }
    const sum = (arr: [FanId, number][]) => arr.reduce((a, b) => a + b[1], 0);
    const chosen = qiduiItems.length && sum(qiduiItems) > sum(standard) ? qiduiItems : standard;
    for (const [id, fan] of chosen) items.push({ id, fan });
  } else {
    items.push({
      id: buda === 'ordinary' ? 'pinghu' : `buda_${buda}`,
      fan: BUDA_FAN[buda],
    });
    // 七风：不搭手里东南西北中发白七张字牌齐全
    if (buda === 'ordinary' && isSevenWinds(real, jokers, jokerKind))
      items.push({ id: 'qifeng', fan: 1 });
  }

  // 全落地：吃碰杠之后手牌只剩一张（4 组副露 + 将）
  if (meldCount === 4) items.push({ id: 'quanluodi', fan: 1 });

  if (ctx.explosive) items.push({ id: 'baotou', fan: 1 });
  if (ctx.tianhu) items.push({ id: 'tianhu', fan: 2 });
  else if (ctx.dihu) items.push({ id: 'dihu', fan: 2 });
  else if (ctx.selfDrawn) items.push({ id: 'zimo', fan: 1 });
  if (ctx.afterKong && ctx.selfDrawn) items.push({ id: 'gangshanghua', fan: 1 });
  if (ctx.flyBonus) items.push({ id: 'feicai', fan: 1 });

  const fan = items.reduce((a, b) => a + b.fan, 0);
  return { patterns: items, fan, multiplier: 2 ** fan, buda };
}

export function describeFan(score: WinScore): string {
  return score.patterns
    .filter((p) => p.id !== 'pinghu' || score.patterns.length === 1)
    .map((p) => FAN_NAME[p.id])
    .join(' · ');
}

/** 抢杠承包的金额：底分 50，按牌型番翻倍 */
export function robAmount(score: WinScore): number {
  return ROB_BASE * 2 ** score.fan;
}

/** 不搭展示名 */
export const budaName = (cls: BuDaClass) => BUDA_NAME[cls];

export { total };
