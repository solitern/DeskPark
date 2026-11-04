import type { ZDecomp } from './analysis';
import { isSevenPairs, isThirteenOrphans, standardDecomps } from './analysis';
import {
  Z_DRAGON_START,
  Z_KINDS,
  Z_SUIT_KINDS,
  Z_WIND_START,
  isHonorKind,
  isTerminalKind,
  suitOfKind,
  type ZSuit,
} from './tiles';

/**
 * 广东麻将 · 字牌版（136 张）的番型与计分，番制可切换：
 *
 * - `jipinghu`：鸡平胡，1 番起胡，封顶 8 番（广州 / 佛山一带常见的简易番表）。
 * - `laozhang`：老章，3 番起胡，封顶 10 番（传统番数表，鸡胡本身不算番）。
 *
 * 两套番表都以数据形式写在 `Z_PRESETS` 里：以后要调数值、加番型，改这张表即可，
 * 规则状态机与界面不需要跟着改。番数相加（清一色 + 碰碰胡就是「清碰」），
 * 超过封顶按封顶算，分数 = 底分 × 2^(番 − 1)。
 */

export type ZFanId =
  | 'jihu'
  | 'pinghu'
  | 'pengpeng'
  | 'qidui'
  | 'haohuaqidui'
  | 'hunyise'
  | 'qingyise'
  | 'ziyise'
  | 'dasanyuan'
  | 'xiaosanyuan'
  | 'dasixi'
  | 'xiaosixi'
  | 'hunlaotou'
  | 'qinglaotou'
  | 'shisanyi'
  | 'menqing'
  | 'quanqiuren'
  | 'zimo'
  | 'gangshang'
  | 'qianggang'
  | 'haidi'
  | 'tianhu'
  | 'dihu';

export const Z_FAN_NAME: Record<ZFanId, string> = {
  jihu: '鸡胡',
  pinghu: '平胡',
  pengpeng: '碰碰胡',
  qidui: '七小对',
  haohuaqidui: '豪华七对',
  hunyise: '混一色',
  qingyise: '清一色',
  ziyise: '字一色',
  dasanyuan: '大三元',
  xiaosanyuan: '小三元',
  dasixi: '大四喜',
  xiaosixi: '小四喜',
  hunlaotou: '混老头',
  qinglaotou: '清老头',
  shisanyi: '十三幺',
  menqing: '门前清',
  quanqiuren: '全求人',
  zimo: '自摸',
  gangshang: '杠上开花',
  qianggang: '抢杠',
  haidi: '海底捞月',
  tianhu: '天胡',
  dihu: '地胡',
};

export type ZPreset = 'jipinghu' | 'laozhang';

export interface ZPresetRules {
  id: ZPreset;
  label: string;
  /** 起胡番数：不够不能胡 */
  minFan: number;
  /** 封顶番数 */
  cap: number;
  fan: Record<ZFanId, number>;
}

const COMMON_SPECIAL: Record<string, number> = {};

export const Z_PRESETS: Record<ZPreset, ZPresetRules> = {
  jipinghu: {
    id: 'jipinghu',
    label: '鸡平胡（1 番起胡）',
    minFan: 1,
    cap: 8,
    fan: {
      ...COMMON_SPECIAL,
      jihu: 1,
      pinghu: 1,
      pengpeng: 3,
      qidui: 4,
      haohuaqidui: 6,
      hunyise: 3,
      qingyise: 6,
      ziyise: 9,
      dasanyuan: 8,
      xiaosanyuan: 4,
      dasixi: 10,
      xiaosixi: 6,
      hunlaotou: 5,
      qinglaotou: 9,
      shisanyi: 13,
      menqing: 0,
      quanqiuren: 3,
      zimo: 1,
      gangshang: 1,
      qianggang: 1,
      haidi: 1,
      tianhu: 4,
      dihu: 2,
    } as Record<ZFanId, number>,
  },
  laozhang: {
    id: 'laozhang',
    label: '老章（3 番起胡）',
    minFan: 3,
    cap: 10,
    fan: {
      ...COMMON_SPECIAL,
      jihu: 0,
      pinghu: 1,
      pengpeng: 3,
      qidui: 4,
      haohuaqidui: 7,
      hunyise: 3,
      qingyise: 6,
      ziyise: 10,
      dasanyuan: 8,
      xiaosanyuan: 5,
      dasixi: 13,
      xiaosixi: 8,
      hunlaotou: 5,
      qinglaotou: 10,
      shisanyi: 13,
      menqing: 1,
      quanqiuren: 3,
      zimo: 1,
      gangshang: 1,
      qianggang: 1,
      haidi: 1,
      tianhu: 8,
      dihu: 4,
    } as Record<ZFanId, number>,
  },
};

export function presetOf(preset: ZPreset): ZPresetRules {
  return Z_PRESETS[preset] ?? Z_PRESETS.jipinghu;
}

/** 副露形状：吃出的顺子也参与牌型判定 */
export interface ZMeldShape {
  type: 'chow' | 'pung' | 'kong';
  /** 顺子记最小牌；碰杠记该牌 */
  kind: number;
}

export interface ZHandValue {
  skeleton: 'standard' | 'qidui' | 'shisanyi';
  patterns: ZFanId[];
  /** 牌型番（不含自摸、杠上开花等过程番） */
  baseFan: number;
  /** 是否达到起胡番数（只看牌型番，过程番由调用方另算） */
  qualifies: boolean;
}

export interface ZWinContext {
  selfDrawn: boolean;
  afterKong: boolean;
  robbing: boolean;
  haidi: boolean;
  tianhu: boolean;
  dihu: boolean;
}

export interface ZFanItem {
  id: ZFanId;
  fan: number;
}

export interface ZWinScore {
  skeleton: ZHandValue['skeleton'];
  items: ZFanItem[];
  fanRaw: number;
  fanCharged: number;
  points: number;
  /** 番数是否够起胡（老章三番起胡时为 false 则不能胡） */
  qualifies: boolean;
  preset: ZPreset;
}

export function scoreOf(fan: number, baseScore: number, cap: number): number {
  const f = Math.max(1, Math.min(fan, cap));
  return baseScore * 2 ** (f - 1);
}

function combinedCounts(concealed: readonly number[], melds: readonly ZMeldShape[]): number[] {
  const c = [...concealed];
  for (const m of melds) c[m.kind] += m.type === 'kong' ? 4 : 3;
  return c;
}

interface Flags {
  allPungs: boolean;
  allChows: boolean;
  pair: number;
  suits: Set<ZSuit>;
  honors: boolean;
  dragonPungs: number;
  windPungs: number;
  dragonPair: boolean;
  windPair: boolean;
  /** 全部由 1、9、字牌组成 */
  allTerminalHonor: boolean;
  /** 全部由 1、9 组成（不含字牌） */
  allTerminal: boolean;
}

function colorFan(f: Flags, rules: ZPresetRules): { ids: ZFanId[]; fan: number } {
  if (f.suits.size === 0 && f.honors) return { ids: ['ziyise'], fan: rules.fan.ziyise };
  if (f.suits.size > 1) return { ids: [], fan: 0 };
  if (f.honors) return { ids: ['hunyise'], fan: rules.fan.hunyise };
  return { ids: ['qingyise'], fan: rules.fan.qingyise };
}

function specialFan(f: Flags, rules: ZPresetRules): { ids: ZFanId[]; fan: number } {
  const ids: ZFanId[] = [];
  let fan = 0;
  const add = (id: ZFanId) => {
    ids.push(id);
    fan += rules.fan[id];
  };
  if (f.dragonPungs === 3) add('dasanyuan');
  else if (f.dragonPungs === 2 && f.dragonPair) add('xiaosanyuan');
  if (f.windPungs === 4) add('dasixi');
  else if (f.windPungs === 3 && f.windPair) add('xiaosixi');
  if (f.allTerminal) add('qinglaotou');
  else if (f.allTerminalHonor) add('hunlaotou');
  return { ids, fan };
}

function structureFan(f: Flags, rules: ZPresetRules): { ids: ZFanId[]; fan: number } {
  if (f.allPungs) return { ids: ['pengpeng'], fan: rules.fan.pengpeng };
  if (f.allChows && !isHonorKind(f.pair)) return { ids: ['pinghu'], fan: rules.fan.pinghu };
  return { ids: ['jihu'], fan: rules.fan.jihu };
}

function decomposeValue(
  d: ZDecomp,
  all: readonly number[],
  melds: readonly ZMeldShape[],
  rules: ZPresetRules,
): ZHandValue {
  const sets = [
    ...d.sets,
    ...melds.map((m) => ({
      type: m.type === 'chow' ? ('chow' as const) : ('pung' as const),
      kind: m.kind,
    })),
  ];
  const pair = d.pair;
  const dragonPungs = sets.filter((s) => s.type === 'pung' && s.kind >= Z_DRAGON_START).length;
  const windPungs = sets.filter(
    (s) => s.type === 'pung' && s.kind >= Z_WIND_START && s.kind < Z_DRAGON_START,
  ).length;
  const flags: Flags = {
    allPungs: sets.every((s) => s.type === 'pung'),
    allChows: sets.every((s) => s.type === 'chow'),
    pair,
    suits: new Set(
      (() => {
        const used = new Set<ZSuit>();
        for (let k = 0; k < Z_SUIT_KINDS; k++) if (all[k] > 0) used.add(suitOfKind(k)!);
        return used;
      })(),
    ),
    honors: all.slice(Z_SUIT_KINDS).some((n) => n > 0),
    dragonPungs,
    windPungs,
    dragonPair: pair >= Z_DRAGON_START,
    windPair: pair >= Z_WIND_START && pair < Z_DRAGON_START,
    allTerminalHonor: all.every((n, k) => n === 0 || isTerminalKind(k) || isHonorKind(k)),
    allTerminal: all.every((n, k) => n === 0 || isTerminalKind(k)),
  };

  const structure = structureFan(flags, rules);
  const color = colorFan(flags, rules);
  const special = specialFan(flags, rules);
  const ids = [...structure.ids, ...color.ids, ...special.ids];
  let fan = structure.fan + color.fan + special.fan;
  if (melds.length === 0 && rules.fan.menqing > 0) {
    ids.push('menqing');
    fan += rules.fan.menqing;
  }
  return {
    skeleton: 'standard',
    patterns: ids,
    baseFan: fan,
    qualifies: fan >= rules.minFan,
  };
}

/** 评估一手和牌（暗手计数已包含和进的那张）。形状不成立时返回 null。 */
export function evaluateHand(
  concealed: readonly number[],
  melds: readonly ZMeldShape[],
  preset: ZPreset = 'jipinghu',
): ZHandValue | null {
  const rules = presetOf(preset);
  const all = combinedCounts(concealed, melds);

  if (isThirteenOrphans(concealed, melds.length)) {
    const fan = rules.fan.shisanyi;
    return { skeleton: 'shisanyi', patterns: ['shisanyi'], baseFan: fan, qualifies: true };
  }

  let best: ZHandValue | null = null;
  const better = (v: ZHandValue) => !best || v.baseFan > best.baseFan;

  for (const d of standardDecomps(concealed, 4 - melds.length)) {
    const v = decomposeValue(d, all, melds, rules);
    if (better(v)) best = v;
  }

  if (isSevenPairs(concealed, melds.length)) {
    const hasQuad = concealed.some((n) => n === 4);
    const ids: ZFanId[] = [hasQuad ? 'haohuaqidui' : 'qidui'];
    let fan = rules.fan[hasQuad ? 'haohuaqidui' : 'qidui'];
    const suits = new Set<ZSuit>();
    for (let k = 0; k < Z_SUIT_KINDS; k++) if (all[k] > 0) suits.add(suitOfKind(k)!);
    const honors = all.slice(Z_SUIT_KINDS).some((n) => n > 0);
    if (suits.size === 0 && honors) {
      ids.push('ziyise');
      fan += rules.fan.ziyise;
    } else if (suits.size === 1) {
      if (honors) {
        ids.push('hunyise');
        fan += rules.fan.hunyise;
      } else {
        ids.push('qingyise');
        fan += rules.fan.qingyise;
      }
    }
    const allTerminal = all.every((n, k) => n === 0 || isTerminalKind(k));
    const allTerminalHonor = all.every((n, k) => n === 0 || isTerminalKind(k) || isHonorKind(k));
    if (allTerminal) {
      ids.push('qinglaotou');
      fan += rules.fan.qinglaotou;
    } else if (allTerminalHonor) {
      ids.push('hunlaotou');
      fan += rules.fan.hunlaotou;
    }
    if (rules.fan.menqing > 0) {
      ids.push('menqing');
      fan += rules.fan.menqing;
    }
    const v: ZHandValue = {
      skeleton: 'qidui',
      patterns: ids,
      baseFan: fan,
      qualifies: fan >= rules.minFan,
    };
    if (!best || v.baseFan >= best.baseFan) best = v;
  }
  return best;
}

/** 加上过程番，得到最终番数与分数 */
export function scoreWin(
  value: ZHandValue,
  ctx: ZWinContext,
  baseScore: number,
  preset: ZPreset = 'jipinghu',
): ZWinScore {
  const rules = presetOf(preset);
  const items: ZFanItem[] = value.patterns.map((id) => ({ id, fan: rules.fan[id] }));
  if (ctx.selfDrawn && rules.fan.zimo > 0) items.push({ id: 'zimo', fan: rules.fan.zimo });
  if (ctx.afterKong && ctx.selfDrawn) items.push({ id: 'gangshang', fan: rules.fan.gangshang });
  if (ctx.robbing) items.push({ id: 'qianggang', fan: rules.fan.qianggang });
  if (ctx.haidi && ctx.selfDrawn) items.push({ id: 'haidi', fan: rules.fan.haidi });
  if (ctx.tianhu) items.push({ id: 'tianhu', fan: rules.fan.tianhu });
  if (ctx.dihu) items.push({ id: 'dihu', fan: rules.fan.dihu });
  const fanRaw = items.reduce((a, b) => a + b.fan, 0);
  return {
    skeleton: value.skeleton,
    items,
    fanRaw,
    fanCharged: Math.max(1, Math.min(fanRaw, rules.cap)),
    points: scoreOf(fanRaw, baseScore, rules.cap),
    qualifies: fanRaw >= rules.minFan,
    preset,
  };
}

export function describeScore(s: ZWinScore): string {
  return s.items.map((it) => Z_FAN_NAME[it.id]).join(' · ');
}

export const Z_KIND_COUNT = Z_KINDS;
