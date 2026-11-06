import { describe, expect, it } from 'vitest';
import { Rng, Table, createDeck, highcard, listGames, normalizeOptions, simulate } from '../src';

describe('基础设施', () => {
  it('牌堆与随机数', () => {
    expect(createDeck(1, true)).toHaveLength(54);
    expect(createDeck(2, true)).toHaveLength(108);
    const a = new Rng(123);
    const b = new Rng(123);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    const deck = new Rng(1).shuffle(createDeck(1, false));
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
  });

  it('注册表包含内置玩法，并能规范化设置', () => {
    const ids = listGames().map((g) => g.meta.id);
    expect(ids).toEqual([
      'doudizhu',
      'guandan',
      'shuangsheng',
      'texas',
      'sichuan',
      'heluogangci',
      'xiangqi',
      'chess',
      'spellstones',
      'onecard',
      'hexisle',
      'gemguild',
      'highcard',
    ]);
    const ddz = listGames()[0];
    expect(normalizeOptions(ddz, { baseScore: 999, rounds: 3 })).toEqual({
      baseScore: 1,
      rounds: 3,
    });
  });

  it('示例玩法（同时出牌 + 自动推进）可以完整模拟', () => {
    const { state } = simulate(highcard, 4, { rounds: 3 }, 77);
    expect(state.phase).toBe('matchOver');
    expect(state.scores.reduce((a: number, b: number) => a + b, 0)).toBeGreaterThanOrEqual(15);
  });

  it('Table 调度电脑玩家并通知订阅者', async () => {
    const table = new Table(
      highcard,
      [
        { name: '我', isBot: false },
        { name: 'B1', isBot: true },
        { name: 'B2', isBot: true },
      ],
      { rounds: 1 },
      { seed: 5 },
    );
    let updates = 0;
    table.subscribe(() => updates++);
    table.start();
    const mine = table.view(0).hand[0];
    expect(table.act(0, { type: 'choose', card: -1 })).toBe('请选择一张手牌');
    expect(table.act(0, { type: 'choose', card: mine.id })).toBeNull();
    await new Promise((r) => setTimeout(r, 1200));
    expect(updates).toBeGreaterThanOrEqual(3);
    table.dispose();
  });
});
