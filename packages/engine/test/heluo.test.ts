import { describe, expect, it } from 'vitest';
import { heluogangci, hl, simulate } from '../src';

type State = hl.HlState;
type Tile = hl.HlTile;

// 夹具：用 "123m456p78s1234z" 记法生成牌（m 万、s 条、p 筒、z 东南西北中发白），id 不重复
const SUIT_BASE: Record<string, number> = { m: 0, s: 9, p: 18, z: 27 };
class Pool {
  used = new Map<number, number>();
  tiles(spec: string): Tile[] {
    const out: Tile[] = [];
    let digits: number[] = [];
    for (const ch of spec.replace(/\s+/g, '')) {
      if (/\d/.test(ch)) digits.push(Number(ch));
      else {
        for (const r of digits) out.push(this.one(SUIT_BASE[ch] + r - 1));
        digits = [];
      }
    }
    return out;
  }
  one(kind: number): Tile {
    const copy = this.used.get(kind) ?? 0;
    if (copy >= 4) throw new Error(`more than 4 of kind ${kind}`);
    this.used.set(kind, copy + 1);
    return hl.hlTileOf(kind * 4 + copy);
  }
}

const counts = (spec: string) => hl.countHlKinds(new Pool().tiles(spec));

function base(): State {
  return heluogangci.setup({
    players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isBot: true })),
    options: heluogangci.defaultOptions,
    seed: 7,
  });
}

describe('河洛杠次 · 牌型', () => {
  it('标准胡牌：4 面子 + 1 将', () => {
    expect(hl.isHlWin(counts('123m456m789p111z22z'), 0)).toBe(true);
    expect(hl.isHlWin(counts('123m456m789p11z'), 1)).toBe(true);
    expect(hl.isHlWin(counts('123m456m789p12z33z'), 0)).toBe(false);
  });
  it('字牌不能组顺子', () => {
    expect(hl.isHlWin(counts('123z456z777z11m'), 1)).toBe(false);
  });
});

describe('河洛杠次 · 计分', () => {
  it('明次：出杠牌的人 -2，另外两家 -1，赢家 +4', () => {
    expect(hl.winDeltas('mingci', 0, 2, null)).toEqual([4, -1, -2, -1]);
  });
  it('暗次 / 屁次：每家 -2，赢家 +6', () => {
    expect(hl.winDeltas('anci', 1, null, null)).toEqual([-2, 6, -2, -2]);
    expect(hl.winDeltas('pici', 1, null, null)).toEqual([-2, 6, -2, -2]);
  });
  it('自摸：每家 -0.5，赢家 +1.5', () => {
    expect(hl.winDeltas('zimo', 3, null, null)).toEqual([-0.5, -0.5, -0.5, 1.5]);
  });
  it('包次：放张者 -4，赢家 +4', () => {
    expect(hl.winDeltas('baoci', 0, 3, 3)).toEqual([4, 0, 0, -4]);
  });
  it('杠分', () => {
    expect(hl.kongDeltas('ming', 0, 1)).toEqual([0.5, -0.5, 0, 0]);
    expect(hl.kongDeltas('an', 0, null)).toEqual([1.5, -0.5, -0.5, -0.5]);
  });
});

describe('河洛杠次 · 流程', () => {
  it('开局：庄家 14 张、其余 13 张，次牌不在牌墙里', () => {
    const s = base();
    expect(s.players.map((p) => p.hand.length)).toEqual([14, 13, 13, 13]);
    expect(s.wall.length).toBe(136 - 53 - 1);
    expect(s.wall.some((t) => t.id === s.ciTile!.id)).toBe(false);
  });

  it('暗杠能用次牌胡 → 暗次，且这一杠不另算杠分', () => {
    const s = base();
    const pool = new Pool();
    // 次牌 9 筒；1111m 暗杠后剩 234s 567s 888p 9p，加上次牌 9p 正好胡
    s.ciTile = pool.tiles('9p')[0];
    s.ciKind = s.ciTile.kind;
    s.players[0].hand = pool.tiles('1111m234s567s888p9p');
    s.turn = 0;
    s.turnDrawn = true;
    const gangTile = s.players[0].hand[0].id;
    const L = hl.legalOf(s, 0);
    expect(L.gang.some((g) => g.type === 'an' && g.ci)).toBe(true);
    const next = heluogangci.apply(s, 0, { type: 'gang', tile: gangTile });
    expect(next.phase).toBe('roundOver');
    expect(next.result?.win?.kind).toBe('anci');
    expect(next.result?.deltas).toEqual([6, -2, -2, -2]);
  });

  it('别人打出的牌能杠且次牌能胡：杠按钮标记为次，杠下去就是明次', () => {
    const s = base();
    const pool = new Pool();
    // 次牌西风；下家手里 444m 888s 666p 999p 西，单吊西。上家打出 9 筒 → 明杠 → 次牌西胡
    s.ciTile = pool.tiles('3z')[0];
    s.ciKind = s.ciTile.kind;
    s.players[1].hand = pool.tiles('444m888s666p999p3z');
    s.players[0].hand = pool.tiles('9p123m1s5z');
    s.players[2].hand = pool.tiles('147m258s');
    s.players[3].hand = pool.tiles('369m147s');
    s.turn = 0;
    s.turnDrawn = true;
    const nine = s.players[0].hand[0].id;
    const after = heluogangci.apply(s, 0, { type: 'discard', tile: nine });
    const L = hl.legalOf(after, 1);
    expect(L.gang).toEqual([{ tile: nine, type: 'ming', ci: true }]);
    const next = heluogangci.apply(after, 1, { type: 'gang' });
    expect(next.result?.win?.kind).toBe('mingci');
    expect(next.result?.win?.seat).toBe(1);
  });

  it('杠了次不上时，杠按钮不标记为次', () => {
    const s = base();
    const pool = new Pool();
    s.ciTile = pool.tiles('7z')[0];
    s.ciKind = s.ciTile.kind;
    s.players[0].hand = pool.tiles('1111m258s147p1357z');
    s.turn = 0;
    s.turnDrawn = true;
    expect(hl.legalOf(s, 0).gang.every((g) => !g.ci)).toBe(true);
  });

  it('杠后次不上：记杠分，从牌墙尾补牌', () => {
    const s = base();
    const pool = new Pool();
    pool.tiles('9p');
    s.ciTile = hl.hlTileOf(26 * 4);
    s.ciKind = 26;
    s.players[0].hand = pool.tiles('1111m258s147p1357z');
    s.turn = 0;
    s.turnDrawn = true;
    const tail = s.wall[s.wall.length - 1];
    const next = heluogangci.apply(s, 0, { type: 'gang', tile: s.players[0].hand[0].id });
    expect(next.phase).toBe('play');
    expect(next.gangDeltas).toEqual([1.5, -0.5, -0.5, -0.5]);
    expect(next.drawnThisTurn).toBe(tail.id);
  });

  it('手里三张次牌可以屁次', () => {
    const s = base();
    const pool = new Pool();
    s.ciTile = pool.one(31);
    s.ciKind = 31;
    s.players[0].hand = pool.tiles('555z123m456m789p1z22z');
    s.turn = 0;
    expect(hl.legalOf(s, 0).pici).toBe(true);
    const next = heluogangci.apply(s, 0, { type: 'pici' });
    expect(next.result?.win?.kind).toBe('pici');
  });

  it('屁次不看其余手牌：散牌也算', () => {
    const s = base();
    const pool = new Pool();
    s.ciTile = pool.one(9);
    s.ciKind = 9;
    s.players[0].hand = pool.tiles('111s 19m 19p 1234567z');
    s.turn = 0;
    s.turnDrawn = false;
    expect(hl.legalOf(s, 0).pici).toBe(true);
    s.players[0].hand = s.players[0].hand.slice(1);
    expect(hl.legalOf(s, 0).pici).toBe(false);
  });

  it('硬次不能自摸', () => {
    const s = base();
    s.options = { ...s.options, mode: 'hard' };
    s.players[0].hand = new Pool().tiles('123m456m789p111z22z');
    s.turn = 0;
    s.turnDrawn = true;
    expect(hl.legalOf(s, 0).hu).toBe(false);
    s.options = { ...s.options, mode: 'soft' };
    expect(hl.legalOf(s, 0).hu).toBe(true);
  });

  it('view 不泄露别人的手牌和牌墙', () => {
    const s = base();
    const v = heluogangci.view(s, 1);
    expect(v.players[0].hand).toBeNull();
    expect(v.hand.length).toBe(13);
    expect(JSON.stringify(v)).not.toContain('"wall"');
  });
});

describe('河洛杠次 · 模拟', () => {
  it('软次 / 硬次都能完整打完，电脑从不出非法动作', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const mode = seed % 2 ? 'soft' : 'hard';
      const { state } = simulate(
        heluogangci,
        4,
        { ...heluogangci.defaultOptions, mode, rounds: 4 },
        seed,
      );
      expect(state.phase).toBe('matchOver');
      const sum = state.scores.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum)).toBeLessThan(1e-9);
    }
  });
});
