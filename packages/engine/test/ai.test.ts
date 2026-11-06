import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyGame } from '../src';
import {
  Rng,
  SYSTEM_SEAT,
  Table,
  chess,
  doudizhu,
  gemguild,
  guandan,
  heluogangci,
  hexisle,
  highcard,
  onecard,
  shuangsheng,
  sichuan,
  spellstones,
  texas,
  xiangqi,
} from '../src';

/** 用规则电脑把整局跑一遍，每一步都检查大模型候选动作是否全部合法 */
function checkPrompts(
  def: AnyGame,
  players: number,
  options: unknown,
  seed: number,
  maxSteps = 4000,
) {
  const rng = new Rng(seed);
  let state = def.setup({
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, isBot: true })),
    options,
    seed,
  });
  let prompts = 0;
  for (let step = 0; step < maxSteps && !def.isOver(state); step++) {
    const active = def.activeSeats(state);
    if (!active.length) {
      const auto = def.autoAdvance!(state)!;
      state = def.apply(state, SYSTEM_SEAT, auto.action);
      continue;
    }
    const seat = active[rng.int(active.length)];
    const view = def.view(state, seat);
    const prompt = def.aiPrompt?.(view, seat, new Rng(seed + step));
    if (prompt) {
      prompts++;
      expect(prompt.situation.length).toBeGreaterThan(10);
      expect(prompt.options.length).toBeGreaterThan(0);
      expect(prompt.options[0].label).toContain('规则电脑的建议');
      for (const o of prompt.options) {
        const err = def.validate(state, seat, o.action);
        if (err) throw new Error(`${def.meta.id} step ${step}: 候选「${o.label}」不合法：${err}`);
      }
    }
    // 偶尔走非推荐的候选，覆盖更多局面
    const pick =
      prompt && rng.next() < 0.3
        ? prompt.options[rng.int(prompt.options.length)].action
        : def.bot(view, seat, rng);
    state = def.apply(state, seat, pick);
  }
  return prompts;
}

describe('大模型接管：候选动作', () => {
  it('斗地主', () => {
    for (let seed = 1; seed <= 6; seed++)
      expect(checkPrompts(doudizhu, 3, { baseScore: 1, rounds: 1 }, seed)).toBeGreaterThan(10);
  });
  it('掼蛋', () => {
    for (let seed = 1; seed <= 3; seed++)
      expect(
        checkPrompts(guandan, 4, { ...guandan.defaultOptions, rounds: 1 }, seed),
      ).toBeGreaterThan(10);
  });
  it('德州扑克', () => {
    for (let seed = 1; seed <= 4; seed++)
      expect(
        checkPrompts(texas, 5, { ...texas.defaultOptions, hands: 3 }, seed, 600),
      ).toBeGreaterThan(5);
  });
  it('四川麻将', () => {
    for (let seed = 1; seed <= 4; seed++)
      expect(
        checkPrompts(sichuan, 4, { ...sichuan.defaultOptions, rounds: 1 }, seed),
      ).toBeGreaterThan(20);
  });
  it('魔法出包', () => {
    for (let seed = 1; seed <= 6; seed++)
      expect(checkPrompts(spellstones, 2 + (seed % 4), {}, seed)).toBeGreaterThan(10);
  });
  it('UON', () => {
    for (let seed = 1; seed <= 6; seed++)
      expect(
        checkPrompts(onecard, 2 + (seed % 7), { target: 0, stack: seed % 2 === 0 }, seed),
      ).toBeGreaterThan(5);
  });
  it('卡旦岛', () => {
    for (let seed = 1; seed <= 3; seed++)
      expect(
        checkPrompts(hexisle, 2 + (seed % 3), hexisle.defaultOptions, seed, 6000),
      ).toBeGreaterThan(20);
  });
  it('宝石商会', () => {
    for (let seed = 1; seed <= 4; seed++)
      expect(checkPrompts(gemguild, 2 + (seed % 3), { target: 15 }, seed)).toBeGreaterThan(20);
  });
  it('国际象棋', () => {
    expect(checkPrompts(chess, 2, { level: 1, side: 'w' }, 2, 160)).toBeGreaterThan(20);
  });
  it('中国象棋', () => {
    expect(checkPrompts(xiangqi, 2, { level: 1, side: 'r' }, 2, 160)).toBeGreaterThan(20);
  });
  it('双升', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 3; seed++)
      expect(checkPrompts(shuangsheng, 4, { startLevel: 2 }, seed, 3000)).toBeGreaterThan(30);
  });
  it('河洛杠次', () => {
    for (let seed = 1; seed <= 4; seed++)
      expect(
        checkPrompts(heluogangci, 4, { ...heluogangci.defaultOptions, rounds: 1 }, seed),
      ).toBeGreaterThan(20);
  });
  it('比大小', () => {
    expect(checkPrompts(highcard, 4, { rounds: 1 }, 3)).toBeGreaterThan(5);
  });
});

describe('Table 外部决策（delegate）', () => {
  afterEach(() => vi.useRealTimers());

  const seats = [
    { name: '我', isBot: false },
    { name: 'B1', isBot: true, ai: true },
    { name: 'B2', isBot: true },
  ];

  it('采用外部给出的合法动作，期间标记为思考中', async () => {
    vi.useFakeTimers();
    let resolve!: (a: unknown) => void;
    const calls: number[] = [];
    const table: Table = new Table(
      highcard,
      structuredClone(seats),
      { rounds: 1 },
      {
        seed: 9,
        delegate: (seat) => {
          if (seat !== 1) return null;
          calls.push(seat);
          return new Promise((r) => (resolve = r));
        },
      },
    );
    table.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual([1]);
    expect(table.thinking).toEqual([1]);
    // 思考期间不会重复调度
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([1]);
    const card = table.view(1).hand.at(-1)!;
    resolve({ type: 'choose', card: card.id });
    await vi.advanceTimersByTimeAsync(0);
    expect(table.thinking).toEqual([]);
    expect(table.view(1).myChoice?.id).toBe(card.id);
    table.dispose();
  });

  it('动作不合法或出错时退回规则电脑', async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    const table = new Table(
      highcard,
      structuredClone(seats),
      { rounds: 1 },
      {
        seed: 3,
        onError: (e) => errors.push(e),
        delegate: (seat) => (seat === 1 ? Promise.resolve({ type: 'choose', card: -1 }) : null),
      },
    );
    table.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(table.view(1).myChoice).not.toBeNull();
    expect(errors.length).toBeGreaterThan(0);
    table.dispose();
  });

  it('关闭 AI 接管：取消等待中的请求，并由规则电脑立即出手', async () => {
    vi.useFakeTimers();
    let cancelled = 0;
    let resolve!: (a: unknown) => void;
    const table = new Table(
      highcard,
      structuredClone(seats),
      { rounds: 1 },
      {
        seed: 4,
        delegate: (seat, ctx) => {
          if (seat !== 1) return null;
          ctx.onCancel(() => cancelled++);
          return new Promise((r) => (resolve = r));
        },
      },
    );
    table.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(table.thinking).toEqual([1]);
    expect(table.view(1).myChoice).toBeNull();
    table.setAi(1, false);
    // 不等任何定时器：已经出牌
    expect(cancelled).toBe(1);
    expect(table.thinking).toEqual([]);
    const chosen = table.view(1).myChoice;
    expect(chosen).not.toBeNull();
    // 迟到的结果被丢弃
    resolve({ type: 'choose', card: table.view(1).hand[0].id });
    await vi.advanceTimersByTimeAsync(0);
    expect(table.view(1).myChoice?.id).toBe(chosen!.id);
    table.dispose();
  });
});
