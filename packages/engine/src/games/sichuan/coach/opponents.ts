import type { MjSuit, Tile } from '../../../mahjong/tiles';
import { KINDS, MJ_SUITS, kindOf, kindRank, kindSuit } from '../../../mahjong/tiles';
import type { ScMeld, ScView } from '../index';
import { FAN_CAP, scoreOf } from '../scoring';
import { canonicalSuits, oppFeatures, toCanon } from './oppfeatures';
import { oppNetAvailable, predictOpp } from './oppnet';
import type { ScCoachParams } from './params';

/**
 * 对手模型（算法说明第 5 节）：只用玩家看得到的信息估计每个对手
 * 听牌了没有、可能在做什么、胡了有多大，进而算出「打出某张牌的放炮期望损失（分）」。
 */

export const POS = ['你', '下家', '对家', '上家'] as const;

export interface Opp {
  seat: number;
  /** 相对位置：下家 / 对家 / 上家 */
  pos: string;
  que: MjSuit | null;
  /** 估计已经听牌的程度 0–1 */
  ready: number;
  /** 疑似在做清一色的花色 */
  flush: MjSuit | null;
  /** 手里确定没有缺门牌：已定缺，且最后打出的不是缺门（规则强制先打缺门） */
  noQue: boolean;
  /** 胡牌时的估计番数：含清一色嫌疑 / 不含 */
  fan: number;
  fanPlain: number;
  /** 胡牌时收的分（已乘 λ） */
  pts: number;
  ptsPlain: number;
  /** 每种牌被他等着的概率（已归一化） */
  wait: number[];
  /** 学习到的对手模型：打出每种牌时他能胡的概率、胡了收的分（没有模型时为 null，用 ready × wait 与 pts） */
  net: { win: number[]; pts: number[] } | null;
  turns: number;
  melds: ScMeld[];
  river: Tile[];
}

export function readyOf(p: ScView['players'][number], wallCount: number, params: ScCoachParams) {
  const r = params.ready;
  const turns = p.river.length + p.melds.length;
  let ready = 1 / (1 + Math.exp(-(turns - r.mid) / r.scale)) + r.perMeld * p.melds.length;
  if (wallCount < r.lateWall) ready += r.late;
  return Math.max(0, Math.min(r.max, ready));
}

export function opponentsOf(v: ScView, me: number, params: ScCoachParams): Opp[] {
  const base = v.options.baseScore;
  const out: Opp[] = [];
  for (const d of [1, 2, 3]) {
    const s = (me + d) % 4;
    const p = v.players[s];
    if (p.won) continue;
    const river = p.river.map((r) => r.tile);
    const turns = river.length + p.melds.length;
    const ready = readyOf(p, v.wallCount, params);
    // 清一色嫌疑：碰杠都是一门、牌河里几乎没有这一门；或没碰杠但一直在打另一门
    let flush: MjSuit | null = null;
    const live = MJ_SUITS.filter((x) => x !== p.que);
    const inRiver = (x: MjSuit) => river.filter((t) => t.suit === x).length;
    const meldSuits = new Set(p.melds.map((x) => kindSuit(x.kind)));
    if (live.length === 2) {
      if (meldSuits.size === 1) {
        const x = [...meldSuits][0];
        const o = live.find((y) => y !== x)!;
        if (live.includes(x) && inRiver(x) <= 1 && inRiver(o) >= 2) flush = x;
      } else if (meldSuits.size === 0) {
        for (const x of live) {
          const o = live.find((y) => y !== x)!;
          if (inRiver(x) === 0 && inRiver(o) >= 5) flush = x;
        }
      }
    }
    const last = river.at(-1);
    const noQue = !!p.que && !!last && last.suit !== p.que;
    // 番数估计：起始 1；碰杠 ≥ 2 组（川麻只有刻子）有对对胡嫌疑 2；清一色 3；两者 4；每个杠 +1
    const duidui = p.melds.length >= 2;
    const kongs = p.melds.filter((m) => m.type === 'kong').length;
    const fanPlain = Math.min(FAN_CAP, (duidui ? 2 : 1) + kongs);
    const fan = flush ? Math.min(FAN_CAP, (duidui ? 4 : 3) + kongs) : fanPlain;
    const pts = scoreOf(fan, base) * params.lambda;
    const ptsPlain = scoreOf(fanPlain, base) * params.lambda;
    // 他等着哪些牌：经验权重，再归一化成「平均能胡 W 种」
    const dz = params.danger;
    const w = new Array<number>(KINDS).fill(0);
    for (let k = 0; k < KINDS; k++) {
      const suit = kindSuit(k);
      if (suit === p.que) continue;
      let f = 1;
      if (flush) f *= suit === flush ? dz.flushSuit : dz.offFlush;
      const r = kindRank(k);
      f *= r === 1 || r === 9 ? dz.terminal : r === 2 || r === 8 ? dz.twoEight : 1;
      if (v.visible[k] >= 3) f *= dz.seen3;
      if (river.some((t) => kindOf(t) === k)) f *= dz.ownRiver;
      w[k] = f;
    }
    const sum = w.reduce((a, b) => a + b, 0);
    const wait = w.map((x) => (sum > 0 ? Math.min(1, (params.waitKinds * x) / sum) : 0));
    const opp: Opp = {
      seat: s,
      pos: POS[d],
      que: p.que,
      ready,
      flush,
      noQue,
      fan,
      fanPlain,
      pts,
      ptsPlain,
      wait,
      net: null,
      turns,
      melds: p.melds,
      river,
    };
    if (params.opponentModel === 'net') applyNet(opp, v, base);
    out.push(opp);
  }
  return out;
}

/**
 * 用学习到的对手模型（ml/sc-opponent）替换经验估计：听牌概率、打出每种牌能胡的概率、胡了的分数。
 * 模型直接估计真实番数（含根），所以不再乘 λ。清一色嫌疑等仍保留，用于讲解文案。
 */
function applyNet(o: Opp, v: ScView, base: number): void {
  if (!oppNetAvailable()) return;
  const f = oppFeatures(v, o.seat);
  if (!f) return;
  const pred = predictOpp(f);
  const order = canonicalSuits(o.que!);
  const C = pred.fanClasses;
  const win = new Array<number>(KINDS).fill(0);
  const ptsOn = new Array<number>(KINDS).fill(0);
  let wsum = 0;
  let psum = 0;
  for (let k = 0; k < KINDS; k++) {
    if (kindSuit(k) === o.que) continue;
    const ck = toCanon(k, order);
    win[k] = pred.win[ck];
    let e = 0;
    for (let c = 0; c < C; c++) e += pred.fan[ck * C + c] * scoreOf(c + 1, base);
    ptsOn[k] = e;
    wsum += win[k];
    psum += win[k] * e;
  }
  o.net = { win, pts: ptsOn };
  o.ready = pred.tenpai;
  // 他胡牌时平均收的分：按能胡的牌加权
  if (wsum > 0) o.pts = o.ptsPlain = psum / wsum;
}

/** 打出 k 时，这个对手胡了收多少分（k 在他的清一色嫌疑门里按清一色算；自己刚杠完要加杠上炮和呼叫转移） */
export function ptsFor(
  o: Opp,
  k: number,
  base: number,
  params: ScCoachParams,
  afterKong: number | null,
): number {
  if (o.net) {
    const p = o.net.pts[k];
    // 杠上炮多 1 番（分数翻倍，封顶），还要把这次杠的钱转给他
    return afterKong === null ? p : Math.min(2 * p, scoreOf(FAN_CAP, base)) + afterKong;
  }
  const fan = o.flush && kindSuit(k) === o.flush ? o.fan : o.fanPlain;
  if (afterKong === null) return o.flush && kindSuit(k) === o.flush ? o.pts : o.ptsPlain;
  return scoreOf(Math.min(FAN_CAP, fan + 1), base) * params.lambda + afterKong;
}

/** 每种牌的放炮期望损失 R_now(k)（分）与放炮概率 */
export function riskTable(
  opps: readonly Opp[],
  base: number,
  params: ScCoachParams,
  afterKong: number | null,
  T = 0,
  rz = 0,
): { risk: number[]; dealIn: number[] } {
  const risk = new Array<number>(KINDS).fill(0);
  const dealIn = new Array<number>(KINDS).fill(0);
  // 血战里，听牌的对手就算这张不胡，之后也常会自摸，那时自己照样要付一份：
  // 点炮真正多付的只是「他本来不会自摸到」的那部分
  const carry = params.marginalDealIn ? 1 - rz * (1 - Math.pow(1 - params.huRate, T)) : 1;
  for (let k = 0; k < KINDS; k++)
    for (const o of opps) {
      const p = o.net ? o.net.win[k] : o.ready * o.wait[k];
      if (p <= 0) continue;
      dealIn[k] += p;
      risk[k] += p * ptsFor(o, k, base, params, afterKong) * carry;
    }
  return { risk, dealIn };
}

/** 先胡先走的价值 L_rest：留在场上的话，对手自摸时还要付的分 */
export function restLoss(opps: readonly Opp[], T: number, rz: number, params: ScCoachParams) {
  let sum = 0;
  for (const o of opps) {
    const pWin = 1 - Math.pow(1 - o.ready * params.huRate, T);
    sum += pWin * rz * o.pts;
  }
  return sum;
}
