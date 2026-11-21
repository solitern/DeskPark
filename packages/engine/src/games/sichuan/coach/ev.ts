import { shanten, shantenStandard, waitingKinds } from '../../../mahjong/analysis';
import type { MjSuit, Tile } from '../../../mahjong/tiles';
import { KINDS, countKinds, kindOf, kindSuit, tileOf } from '../../../mahjong/tiles';
import type { ScMeld, ScOptions, ScView } from '../index';
import type { HandValue, MeldShape } from '../scoring';
import { FAN_CAP, FAN_NAME, evaluateHand, scoreOf } from '../scoring';
import type { Opp } from './opponents';
import { opponentsOf, restLoss, riskTable } from './opponents';
import type { ScCoachParams } from './params';
import type { PwinType } from './pwin';
import { pWin } from './pwin';
import type { Route } from './routes';
import { routesOf } from './routes';

/**
 * 期望得分（算法说明第 3–6 节）：每个动作都换算成「从现在到本盘结束，我的分数变化的期望」，单位是分。
 *
 *   EV_push(d) = P_win (V_win + L_rest) − R_now(d) − R_later − C_end
 *   EV_fold    = −(之后每巡打最安全的牌的放炮损失) − C_end(没听牌)
 *
 * 所有算分都用 scoring.ts（evaluateHand / scoreOf），这里不另写番型表。
 */

export interface ScWait {
  kind: number;
  /** 还能摸到的张数 */
  left: number;
  fan: number;
  /** 番型说明，例如「清一色 · 根×1」 */
  label: string;
}

/** 一个局面（自己打出一张以后、等下一次摸牌时）的评估 */
export interface StateEval {
  /** 期望得分：P_win (V + L_rest) − R_later − C_end */
  ev: number;
  pWin: number;
  /** 胡了平均收多少分（点炮、自摸加权） */
  value: number;
  /** 走哪条路线：平胡、清一色·万……；听牌时是番型说明 */
  routeName: string;
  route: Route | null;
  shanten: number;
  ukeire: number;
  ukeireKinds: number;
  waits: ScWait[];
  rLater: number;
  cEnd: number;
  /** 流局时没听牌的概率 */
  pNoten: number;
}

export interface Env {
  v: ScView;
  me: number;
  params: ScCoachParams;
  base: number;
  que: MjSuit | null;
  meldsFull: ScMeld[];
  melds: MeldShape[];
  /** 每种牌还能摸到的张数（扣掉看得见的牌和换给别人的牌） */
  left: number[];
  unseen: number;
  /** 还没胡的人数（含自己）、还没胡的对手数 */
  active: number;
  nOpp: number;
  /** 自己还能摸几次；折算点炮机会后的有效次数 */
  T: number;
  tEff: number;
  /** 胡牌是自摸的比例 */
  rz: number;
  /** 胡了平均收几份：点炮 1 份，自摸每个未胡对手各 1 份 */
  payMult: number;
  opps: Opp[];
  risk: number[];
  dealIn: number[];
  /** 从没见过的牌里随机摸到一张废牌再打出去的平均放炮损失 */
  rbar: number;
  lRest: number;
  /** 流局没听牌时要赔的：查大叫 */
  chajiao: number;
  kongIncome: number;
  huazhu: number;
}

export function valueLabel(v: HandValue): string {
  const parts = v.patterns.map((p) => FAN_NAME[p]);
  if (v.roots) parts.push(`根×${v.roots}`);
  if (v.jingoudiao) parts.push('金钩钓');
  return parts.join(' · ');
}

/** 换三张给出去的牌：还没在牌河、碰杠里出现，就在接收者手里，我摸不到 */
export function hiddenGiven(v: ScView): number[] {
  const given = v.exchange?.given ?? [];
  if (!given.length) return [];
  const seen = new Set<number>();
  for (const p of v.players) {
    for (const r of p.river) seen.add(r.tile.id);
    for (const m of p.melds) for (const t of m.tiles) seen.add(t.id);
    for (const t of p.hand ?? []) seen.add(t.id);
  }
  return given.filter((t) => !seen.has(t.id)).map((t) => t.id);
}

export function leftOf(v: ScView): number[] {
  const left = v.visible.map((n) => Math.max(0, 4 - n));
  for (const id of hiddenGiven(v)) {
    const k = kindOf(tileOf(id));
    left[k] = Math.max(0, left[k] - 1);
  }
  return left;
}

export function buildEnv(v: ScView, params: ScCoachParams): Env {
  const me = v.seat ?? 0;
  const p = v.players[me];
  const base = v.options.baseScore;
  const left = leftOf(v);
  const unseen = Math.max(
    1,
    left.reduce((a, b) => a + b, 0),
  );
  const active = v.players.filter((x) => !x.won).length;
  const nOpp = Math.max(0, active - (p.won ? 0 : 1));
  const T = Math.ceil(v.wallCount / Math.max(1, active));
  const tEff = T * (1 + params.kappa * nOpp);
  const rz = 1 / (1 + params.kappa * nOpp);
  const opps = opponentsOf(v, me, params);
  const { risk, dealIn } = riskTable(opps, base, params, v.myAfterKong, T, rz);
  let rs = 0;
  for (let k = 0; k < KINDS; k++) rs += left[k] * risk[k];
  return {
    v,
    me,
    params,
    base,
    que: p.que,
    meldsFull: p.melds,
    melds: p.melds.map((x) => ({ type: x.type, kind: x.kind })),
    left,
    unseen,
    active,
    nOpp,
    T,
    tEff,
    rz,
    payMult: rz * nOpp + (1 - rz),
    opps,
    risk,
    dealIn,
    rbar: rs / unseen,
    lRest: restLoss(opps, T, rz, params),
    chajiao: opps.reduce((a, o) => a + o.ready * o.pts, 0),
    kongIncome: v.myKongIncome ?? 0,
    // 查花猪：赔给每个不是花猪的人 16 底（含已胡的）
    huazhu: scoreOf(FAN_CAP, base) * 3,
  };
}

const capPts = (env: Env, pts: number) => Math.min(pts, scoreOf(FAN_CAP, env.base));

/** 听牌时每种叫的剩余张数与番数 */
export function waitsOf(
  env: Env,
  counts: number[],
  melds: readonly MeldShape[],
  que: MjSuit | null,
): ScWait[] {
  const out: ScWait[] = [];
  for (const k of waitingKinds(counts, melds.length, (x) => kindSuit(x) !== que)) {
    counts[k]++;
    const v = evaluateHand(counts, melds, { jingoudiao: env.v.options.jingoudiao });
    counts[k]--;
    if (v) out.push({ kind: k, left: env.left[k], fan: v.base, label: valueLabel(v) });
  }
  return out;
}

export interface EvalOpts {
  /** 假设的定缺（定缺、换三张时用） */
  que?: MjSuit | null;
  /** 有效摸牌次数的修正（过水：少一轮点炮机会） */
  tEffDelta?: number;
}

/**
 * 局面评估：暗手计数（含缺门）+ 副露，处在「打完一张、等下一次摸牌」的状态。
 * 听牌时直接用每种叫的剩余张数与番数；没听牌时对每条牌型路线估期望，取最高的。
 */
export function evalState(
  env: Env,
  concealed: readonly number[],
  melds: readonly MeldShape[],
  opts: EvalOpts = {},
): StateEval {
  const que = opts.que === undefined ? env.que : opts.que;
  const tEff = Math.max(0, env.tEff + (opts.tEffDelta ?? 0));
  const T = env.T;
  const q = que ? concealed.reduce((a, n, k) => a + (kindSuit(k) === que ? n : 0), 0) : 0;
  const c = concealed.map((n, k) => (que && kindSuit(k) === que ? 0 : n));
  const m = melds.length;
  const huazhu = q > T ? env.huazhu : 0;
  const lose = env.chajiao + env.kongIncome;

  if (q === 0 && shanten(c, m) === 0) {
    const waits = waitsOf(env, c, melds, que);
    const live = waits.filter((w) => w.left > 0);
    const u = live.reduce((a, w) => a + w.left, 0);
    const type: PwinType = m === 0 && shantenStandard(c, 0) > 0 ? 'qidui' : 'std';
    let pw: number;
    let value: number;
    let pNoten: number;
    if (u > 0) {
      pw = pWin(type, 0, u, tEff);
      value = (live.reduce((a, w) => a + w.left * scoreOf(w.fan, env.base), 0) / u) * env.payMult;
      pNoten = 0;
    } else {
      // 死叫：只能等换叫
      pw = 0.5 * pWin('std', 0, 4, tEff);
      value =
        (waits.reduce((a, w) => a + scoreOf(w.fan, env.base), 0) / Math.max(1, waits.length)) *
        env.payMult;
      pNoten = 1 - pWin('std', 0, 4, T);
    }
    const rLater = T * (1 - pw / 2) * env.rbar;
    const cEnd = pNoten * lose + huazhu;
    const top = [...live].sort((a, b) => b.fan - a.fan)[0] ?? waits[0];
    return {
      ev: pw * (value + env.lRest) - rLater - cEnd,
      pWin: pw,
      value,
      routeName: top ? top.label : '听牌',
      route: null,
      shanten: 0,
      ukeire: u,
      ukeireKinds: live.length,
      waits,
      rLater,
      cEnd,
      pNoten,
    };
  }

  let best: StateEval | null = null;
  for (const r of routesOf({ concealed, melds, que, left: env.left })) {
    // 别人打出的牌只能用来胡最后一张（点炮），前面的进张只能靠自己摸：
    // 点炮折算按「听牌以后的那段时间」摊薄，向听越多摊得越薄
    const tR = Math.max(
      0,
      env.T * (1 + (env.params.kappa * env.nOpp) / (r.shanten + 1)) + (opts.tEffDelta ?? 0),
    );
    const pw = pWin(r.table, r.shanten, r.ukeire, tR);
    // 以后还可能多出来的根：每个根让分数翻倍
    let mult = 1;
    for (const k of r.rootChances) mult *= 1 + Math.min(1, (env.left[k] * T) / env.unseen);
    const value = capPts(env, scoreOf(r.fan, env.base) * mult) * env.payMult;
    const pTen = r.shanten >= 1 ? pWin(r.table, r.shanten - 1, r.ukeire, T) : 1;
    const pNoten = 1 - pTen;
    let junkRisk = 0;
    for (const k of r.junk) junkRisk += env.risk[k];
    const rLater = junkRisk + T * (1 - pw / 2) * env.rbar;
    const cEnd = pNoten * lose + huazhu;
    const ev = pw * (value + env.lRest) - rLater - cEnd;
    if (!best || ev > best.ev)
      best = {
        ev,
        pWin: pw,
        value,
        routeName: r.name,
        route: r,
        shanten: r.shanten,
        ukeire: r.ukeire,
        ukeireKinds: r.ukeireKinds.length,
        waits: [],
        rLater,
        cEnd,
        pNoten,
      };
  }
  return best!;
}

/** 普通路线的向听与进张（给文案用：路线不同时也要说清楚牌效） */
export function plainEfficiency(
  env: Env,
  concealed: readonly number[],
  melds: readonly MeldShape[],
) {
  const r = routesOf({ concealed, melds, que: env.que, left: env.left })[0];
  return { shanten: r.shanten, ukeire: r.ukeire, ukeireKinds: r.ukeireKinds.length };
}

/** 弃和：之后每巡都打手里最安全的牌，流局时按没听牌算 */
export function evFold(env: Env, hand: readonly Tile[]): { ev: number; minRisk: number } {
  const risks = hand.map((t) => env.risk[kindOf(t)]).sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < env.T; i++) sum += i < risks.length ? risks[i] : env.rbar;
  const q = env.que ? hand.filter((t) => t.suit === env.que).length : 0;
  const cEnd = env.chajiao + env.kongIncome + (q > env.T ? env.huazhu : 0);
  return { ev: -sum - cEnd, minRisk: risks[0] ?? 0 };
}

/** 一手牌是否下叫、查叫分多少（与 tingOf 相同的口径，只用 view 里的信息） */
export function tingOfView(
  hand: readonly Tile[],
  melds: readonly ScMeld[],
  que: MjSuit | null,
  visible: readonly number[],
  options: ScOptions,
): { kind: number; points: number } | null {
  if (que !== null && hand.some((t) => t.suit === que)) return null;
  const counts = countKinds(hand);
  const shapes = melds.map((m) => ({ type: m.type, kind: m.kind }));
  const waits = waitingKinds(counts, shapes.length, (k) => kindSuit(k) !== que);
  let best: { kind: number; points: number } | null = null;
  for (const k of waits) {
    if (visible[k] >= 4) continue; // 死叫
    const c = [...counts];
    c[k]++;
    const v = evaluateHand(c, shapes, { jingoudiao: options.jingoudiao });
    if (!v) continue;
    const points = scoreOf(v.base, options.baseScore);
    if (!best || points > best.points) best = { kind: k, points };
  }
  return best;
}
