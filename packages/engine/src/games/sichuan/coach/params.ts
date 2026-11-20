/**
 * 麻将导师的经验参数，集中在这里，方便用自对弈脚本调参（scripts/selfplay-sc.ts）。
 * 分数类的阈值都以「底分」为单位，使用时乘以 options.baseScore。
 */
export const SC_COACH_PARAMS = {
  /** κ：每个还没胡的对手打出的牌，折算成多少次自摸机会（点炮胡） */
  kappa: 0.35,
  /** W：听牌的人平均能胡几种牌 */
  waitKinds: 2.2,
  /** λ：对手牌值的补偿（看不到的根、七对） */
  lambda: 1.25,
  /** h：听牌的人每巡胡牌的概率 */
  huRate: 0.12,
  /** 对手听牌程度：按出牌巡数的 S 形曲线，碰杠和残局再加一点 */
  ready: { mid: 9, scale: 2.2, perMeld: 0.1, lateWall: 16, late: 0.1, max: 0.95 },
  /** 某张牌被某个对手等着的权重（相对值，会再归一化） */
  danger: {
    /** 对手疑似清一色的那一门 / 其他门 */
    flushSuit: 1.6,
    offFlush: 0.25,
    /** 1、9 / 2、8 */
    terminal: 0.6,
    twoEight: 0.8,
    /** 这张已经见了 3 张 */
    seen3: 0.55,
    /** 对手自己打过这张 */
    ownRiver: 0.75,
  },
  /** 危险三档：放炮期望损失低于 0.3 底「较安全」，低于 1.5 底「要小心」，否则「危险」 */
  dangerBands: [0.3, 1.5] as const,
  /** 胡还是过：过的期望至少要高出 max(abs 底, rel × 胡的分) 才建议过 */
  passMargin: { abs: 1, rel: 0.2 },
  /** 定缺：前两门期望相差不到这个比例时，用传统的「最弱一门」 */
  queTie: 0.05,
  /** 换三张：模拟换回来的牌多少组 */
  exchangeSamples: 30,
  /** 评价玩家选的牌：与推荐相比少的期望得分（底），分别对应 best / good / warn，再多为 bad */
  judgeBands: [0.1, 0.5, 1.5] as const,
  /** 精算（蒙特卡洛） */
  mc: {
    /** 参与精算的快速模式前几名 */
    candidates: 4,
    /** 每轮每个候选加多少局 */
    batch: 32,
    /** 每个候选最多多少局 */
    maxPerCandidate: 512,
    /** 时间预算（毫秒） */
    budgetMs: 800,
    /** 落后第一名超过几倍标准误就淘汰 */
    z: 2,
  },
};

export type ScCoachParams = typeof SC_COACH_PARAMS;

/** 用部分参数覆盖默认值（调参脚本用） */
export function withParams(over?: DeepPartial<ScCoachParams>): ScCoachParams {
  if (!over) return SC_COACH_PARAMS;
  const merge = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      out[k] =
        v && typeof v === 'object' && !Array.isArray(v)
          ? merge(a[k] as Record<string, unknown>, v as Record<string, unknown>)
          : v;
    }
    return out;
  };
  return merge(
    SC_COACH_PARAMS as unknown as Record<string, unknown>,
    over as Record<string, unknown>,
  ) as unknown as ScCoachParams;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};
