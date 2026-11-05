import { hi } from '@park/engine';
import type { ClientMessage, ServerMessage } from '@park/protocol';
import { AVATARS, CHAT_MAX_LENGTH, PROTOCOL_VERSION } from '@park/protocol';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/server';

type Srv = ReturnType<typeof startServer>;
let server: Srv;
let port = 0;

beforeAll(async () => {
  server = startServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: null,
    config: { turnTimeoutMs: 5000 },
  });
  port = await server.ready;
});
afterAll(async () => {
  await server.close();
});

class TestClient {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  opened: Promise<void>;

  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.opened = new Promise((r) => this.ws.once('open', () => r()));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.inbox.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.resolve(m);
          return false;
        }
        return true;
      });
    });
  }
  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }
  wait<T extends ServerMessage['t']>(
    t: T,
    pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    ms = 4000,
  ) {
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const found = this.inbox.find(
        (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
      );
      if (found) return resolve(found as Extract<ServerMessage, { t: T }>);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }
  close() {
    this.ws.close();
  }
}

describe('联机服务器', () => {
  it('创建房间、加入、补电脑并开局', async () => {
    const a = new TestClient();
    const b = new TestClient();
    await Promise.all([a.opened, b.opened]);
    a.send({
      t: 'hello',
      token: 'token-aaaaaaaaaaaaaaaa',
      name: '甲',
      avatar: 'hero-pig',
      v: PROTOCOL_VERSION,
    });
    b.send({ t: 'hello', token: 'token-bbbbbbbbbbbbbbbb', name: '乙', v: PROTOCOL_VERSION });
    await a.wait('welcome');
    await b.wait('welcome');

    a.send({ t: 'create', gameId: 'doudizhu' });
    const created = await a.wait('room');
    expect(created.you.isHost).toBe(true);
    const code = created.room.code;
    expect(code).toHaveLength(4);

    b.send({ t: 'join', code: code.toLowerCase() });
    const joined = await b.wait(
      'room',
      (m) => m.room.seats.filter((s) => s.kind === 'human').length === 2,
    );
    expect(joined.you.seat).toBe(1);

    a.send({ t: 'bot', seat: 2, add: true });
    const withBot = await a.wait('room', (m) => m.room.seats[2].kind === 'bot');
    // 电脑拿到一个形象，名字取自该形象；房主的形象同步给了其他人
    const bot = withBot.room.seats[2];
    expect(AVATARS.find((x) => x.id === bot.avatar)?.botName).toBe(bot.name);
    expect(withBot.room.seats[0].avatar).toBe('hero-pig');

    b.send({ t: 'start' });
    await b.wait('error', (m) => m.message.includes('房主'));

    a.send({ t: 'start' });
    const gameA = await a.wait('game');
    const gameB = await b.wait('game');
    expect(gameA.seat).toBe(0);
    expect(gameB.seat).toBe(1);
    const viewA = gameA.view as { hand: unknown[] };
    const viewB = gameB.view as { hand: { id: number }[] };
    expect(viewA.hand).toHaveLength(17);
    // 每个人只能看到自己的手牌
    expect(JSON.stringify(viewA)).not.toContain(`"id":${viewB.hand[0].id},"suit"`);

    // 断线重连后恢复座位与视图
    b.close();
    await a.wait('room', (m) => m.room.seats[1].connected === false);
    const b2 = new TestClient();
    await b2.opened;
    b2.send({ t: 'hello', token: 'token-bbbbbbbbbbbbbbbb', name: '乙', v: PROTOCOL_VERSION });
    const back = await b2.wait('room');
    expect(back.you.seat).toBe(1);
    await b2.wait('game');
    a.close();
    b2.close();
  });

  it('加入不存在的房间会报错', async () => {
    const c = new TestClient();
    await c.opened;
    c.send({ t: 'hello', token: 'token-cccccccccccccccc', name: '丙', v: PROTOCOL_VERSION });
    c.send({ t: 'join', code: 'ZZZZ' });
    const err = await c.wait('error');
    expect(err.message).toContain('不存在');
    c.close();
  });

  it('全电脑对手时对局会自动推进', async () => {
    const d = new TestClient();
    await d.opened;
    d.send({ t: 'hello', token: 'token-dddddddddddddddd', name: '丁', v: PROTOCOL_VERSION });
    d.send({ t: 'create', gameId: 'highcard', seats: 2 });
    await d.wait('room');
    d.send({ t: 'start' });
    const first = await d.wait('game');
    const view = first.view as { hand: { id: number }[] };
    d.send({ t: 'act', action: { type: 'choose', card: view.hand[0].id } });
    const later = await d.wait(
      'game',
      (m) => (m.view as { phase: string }).phase === 'reveal',
      5000,
    );
    expect(later.version).toBeGreaterThan(first.version);
    d.close();
  });

  it('广东推倒胡联机：只看得到自己的手牌，可以出牌并推进', async () => {
    type GdView = {
      phase: string;
      hand: { id: number }[];
      players: { hand: { id: number }[] | null }[];
      legal: { discard: number[] } | null;
    };
    const z = new TestClient();
    await z.opened;
    z.send({ t: 'hello', token: 'token-zzzzzzzzzzzzzzzz', name: '壬', v: PROTOCOL_VERSION });
    z.send({ t: 'create', gameId: 'guangdong' });
    await z.wait('room');
    for (const seat of [1, 2, 3]) z.send({ t: 'bot', seat, add: true });
    await z.wait('room', (m) => m.room.seats.filter((s) => s.kind === 'bot').length === 3);
    z.send({ t: 'start' });

    const first = await z.wait('game', (m) => (m.view as GdView).phase === 'play', 20000);
    const view = first.view as GdView;
    expect(view.hand.length).toBeGreaterThanOrEqual(13);
    // 每个人的手牌只在自己的 view.hand 里，players 上的 hand 一律不下发
    expect(view.players.every((p) => p.hand === null)).toBe(true);

    const mine = await z.wait(
      'game',
      (m) => ((m.view as GdView).legal?.discard.length ?? 0) > 0,
      20000,
    );
    const v2 = mine.view as GdView;
    z.send({ t: 'act', action: { type: 'discard', tile: v2.hand[0].id } });
    const after = await z.wait('game', (m) => m.version > mine.version, 20000);
    expect(after.version).toBeGreaterThan(mine.version);
    z.close();
  });

  it('魔法出包联机：看不到自己的石头，看得到别人的，可以施法', async () => {
    const e = new TestClient();
    await e.opened;
    e.send({ t: 'hello', token: 'token-ssssssssssssssss', name: '戊', v: PROTOCOL_VERSION });
    e.send({ t: 'create', gameId: 'spellstones', seats: 3 });
    await e.wait('room');
    e.send({ t: 'start' });
    type V = {
      turn: number | null;
      phase: string;
      players: { rack: unknown[] | null }[];
      myRack: number[];
    };
    const mine = await e.wait('game', (m) => (m.view as V).turn === 0, 9000);
    const view = mine.view as V;
    expect(view.players[0].rack).toBeNull();
    expect(view.myRack).toHaveLength(5);
    expect(view.players[1].rack).toHaveLength(5);
    e.send({ t: 'act', action: { type: 'cast', spell: 8 } });
    const after = await e.wait('game', (m) => m.version > mine.version);
    expect((after.view as { events: unknown[] }).events.length).toBeGreaterThan(0);
    e.close();
  }, 15000);

  it('UON 联机：只收到自己的手牌，可以摸牌', async () => {
    const f = new TestClient();
    await f.opened;
    f.send({ t: 'hello', token: 'token-oooooooooooooooo', name: '己', v: PROTOCOL_VERSION });
    f.send({ t: 'create', gameId: 'onecard', seats: 3 });
    await f.wait('room');
    f.send({ t: 'start' });
    type V = { turn: number | null; hand: unknown[]; counts: number[]; window: unknown };
    const mine = await f.wait(
      'game',
      (m) => (m.view as V).turn === 0 && !(m.view as V).window,
      9000,
    );
    const view = mine.view as V;
    expect(view.hand.length).toBe(view.counts[0]);
    expect(JSON.stringify(view)).not.toContain('"hands"');
    expect(JSON.stringify(view)).not.toContain('guilty');
    f.send({ t: 'act', action: { type: 'draw' } });
    const after = await f.wait('game', (m) => m.version > mine.version);
    expect((after.view as V).hand.length).toBeGreaterThanOrEqual(view.hand.length);
    f.close();
  }, 15000);

  it('卡旦岛联机：只看得到自己的手牌与发展卡，可以开局摆放', async () => {
    const g = new TestClient();
    await g.opened;
    g.send({ t: 'hello', token: 'token-hhhhhhhhhhhhhhhh', name: '庚', v: PROTOCOL_VERSION });
    g.send({ t: 'create', gameId: 'hexisle', seats: 3 });
    await g.wait('room');
    g.send({ t: 'start' });
    type P = { hand: unknown; devs: unknown; cards: number };
    type V = { turn: number; phase: string; setupVertex: number | null; players: P[] };
    const mine = await g.wait(
      'game',
      (m) => (m.view as V).turn === 0 && (m.view as V).phase === 'setup',
      15000,
    );
    const view = mine.view as V;
    expect(view.players[0].hand).not.toBeNull();
    expect(view.players[1].hand).toBeNull();
    expect(view.players[1].devs).toBeNull();
    expect(JSON.stringify(view)).not.toContain('devDeck');
    // 用规则引擎找一个满足距离规则的路口（先手是随机的，电脑可能已经放过村庄）
    const at = hi.settlementSpots(
      mine.view as unknown as Parameters<typeof hi.settlementSpots>[0],
      0,
      true,
    )[0];
    g.send({ t: 'act', action: { type: 'settle', at } });
    const after = await g.wait('game', (m) => m.version > mine.version);
    expect((after.view as V).setupVertex).toBe(at);
    g.close();
  }, 25000);

  it('宝石商会联机：盲抽预留的牌别人看不到，可以拿宝石', async () => {
    const h = new TestClient();
    await h.opened;
    h.send({ t: 'hello', token: 'token-gggggggggggggggg', name: '辛', v: PROTOCOL_VERSION });
    h.send({ t: 'create', gameId: 'gemguild', seats: 2 });
    await h.wait('room');
    h.send({ t: 'start' });
    type V = {
      turn: number;
      phase: string;
      players: { reserved: unknown[] }[];
      bank: Record<string, number>;
    };
    const mine = await h.wait(
      'game',
      (m) => (m.view as V).turn === 0 && (m.view as V).phase === 'play',
      15000,
    );
    expect(JSON.stringify(mine.view)).not.toContain('decks');
    h.send({ t: 'act', action: { type: 'reserve', level: 3 } });
    const after = await h.wait('game', (m) => m.version > mine.version);
    const me = (after.view as V).players[0].reserved;
    expect(me).toHaveLength(1);
    expect(me[0]).not.toBeNull();
    h.close();
  }, 25000);

  it('棋类联机：国际象棋与中国象棋都能开局走子，每步时限更长', async () => {
    for (const [gameId, from, to] of [
      ['chess', 12, 28],
      ['xiangqi', 25, 22],
    ] as const) {
      const c = new TestClient();
      await c.opened;
      c.send({
        t: 'hello',
        token: `token-${gameId}-aaaaaaaaaaaa`,
        name: '棋手',
        v: PROTOCOL_VERSION,
      });
      c.send({ t: 'create', gameId, seats: 2 });
      await c.wait('room');
      c.send({ t: 'start' });
      type V = { turn: number; legal: { from: number; to: number }[] };
      const first = await c.wait('game', (m) => (m.view as V).turn === 0, 9000);
      expect((first.view as V).legal.some((m) => m.from === from && m.to === to)).toBe(true);
      c.send({ t: 'act', action: { type: 'move', from, to } });
      const after = await c.wait('game', (m) => m.version > first.version);
      expect((after.view as { moves: unknown[] }).moves.length).toBeGreaterThan(0);
      c.close();
    }
  }, 30000);

  it('房间聊天：广播、系统消息、历史记录、文本清理与限流', async () => {
    const a = new TestClient();
    const b = new TestClient();
    await Promise.all([a.opened, b.opened]);
    a.send({
      t: 'hello',
      token: 'token-chat-aaaaaaaaaaaa',
      name: '阿甲',
      avatar: 'cute-frog',
      v: PROTOCOL_VERSION,
    });
    b.send({ t: 'hello', token: 'token-chat-bbbbbbbbbbbb', name: '阿乙', v: PROTOCOL_VERSION });
    a.send({ t: 'create', gameId: 'guandan' });
    const { room } = await a.wait('room');
    await a.wait('chatHistory', (m) => m.messages.length === 0);
    b.send({ t: 'join', code: room.code });
    const joined = await a.wait('chat', (m) => m.message.kind === 'system');
    expect(joined.message.text).toContain('阿乙 加入了房间');

    a.send({ t: 'chat', text: '  大家好\u0007   一起\n来玩  ' });
    const got = await b.wait('chat', (m) => m.message.kind === 'user');
    expect(got.message.text).toBe('大家好 一起 来玩');
    expect(got.message.name).toBe('阿甲');
    expect(got.message.avatar).toBe('cute-frog');
    expect(got.message.seat).toBe(0);

    // 超长消息按字符截断
    await new Promise((r) => setTimeout(r, 550));
    a.send({ t: 'chat', text: '哈'.repeat(300) });
    const long = await b.wait(
      'chat',
      (m) => m.message.kind === 'user' && m.message.text.startsWith('哈'),
    );
    expect([...long.message.text]).toHaveLength(CHAT_MAX_LENGTH);

    // 限流：连续刷屏会被拒绝
    for (let i = 0; i < 4; i++) a.send({ t: 'chat', text: `刷屏${i}` });
    const err = await a.wait('error', (m) => m.message.includes('太快'));
    expect(err).toBeTruthy();

    // 后加入的人收到历史记录
    const c = new TestClient();
    await c.opened;
    c.send({ t: 'hello', token: 'token-chat-cccccccccccc', name: '阿丙', v: PROTOCOL_VERSION });
    c.send({ t: 'join', code: room.code });
    const hist = await c.wait('chatHistory', (m) =>
      m.messages.some((x) => x.text === '大家好 一起 来玩'),
    );
    expect(hist.code).toBe(room.code);

    b.send({ t: 'leave' });
    const left = await a.wait('chat', (m) => m.message.text.includes('阿乙 离开了房间'));
    expect(left.message.kind).toBe('system');
    a.close();
    c.close();
    b.close();
  });
});

describe('安全加固', () => {
  it('畸形 URL 返回 400，服务不受影响；网页带安全响应头', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deskpark-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>闲亭</title>');
    const web = startServer({ port: 0, host: '127.0.0.1', staticDir: dir });
    const base = `http://127.0.0.1:${await web.ready}`;
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    const page = await fetch(`${base}/room/ABCD`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const traversal = await (await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).text();
    expect(traversal).toContain('闲亭');
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    await web.close();
  });

  it('穷举房间号会被限制；表情只接受内置表情；伪造动作被拒绝', async () => {
    const x = new TestClient();
    await x.opened;
    x.send({ t: 'hello', token: 'token-sec-xxxxxxxxxxxx', name: '甲', v: PROTOCOL_VERSION });
    for (let i = 0; i < 9; i++) x.send({ t: 'join', code: `Q${i}ZZ` });
    expect(await x.wait('error', (m) => m.message.includes('太频繁'))).toBeTruthy();

    x.send({ t: 'create', gameId: 'highcard', seats: 2 });
    const room = (await x.wait('room')).room;
    const y = new TestClient();
    await y.opened;
    y.send({ t: 'hello', token: 'token-sec-yyyyyyyyyyyy', name: '乙', v: PROTOCOL_VERSION });
    y.send({ t: 'join', code: room.code });
    await y.wait('room', (m) => m.you.seat === 1);
    x.send({ t: 'emote', emote: '<b>垃圾广告</b>' });
    x.send({ t: 'emote', emote: '👍' });
    const e = await y.wait('emote');
    expect(e.emote).toBe('👍');

    x.send({ t: 'start' });
    const g = await x.wait('game', (m) => m.view !== null);
    x.send({
      t: 'act',
      action: { type: 'bogus', card: (g.view as { hand: { id: number }[] }).hand[0].id },
    });
    expect(await x.wait('error', (m) => m.message.includes('未知操作'))).toBeTruthy();
    x.send({ t: 'act', action: 'not-an-object' as never });
    expect(await x.wait('error', (m) => m.message.includes('无效操作'))).toBeTruthy();
    x.close();
    y.close();
  });

  it('同一连接换了身份：旧身份标记为离线', async () => {
    const x = new TestClient();
    await x.opened;
    x.send({ t: 'hello', token: 'token-swap-aaaaaaaaaa', name: '甲', v: PROTOCOL_VERSION });
    x.send({ t: 'create', gameId: 'doudizhu' });
    const room = (await x.wait('room')).room;
    const y = new TestClient();
    await y.opened;
    y.send({ t: 'hello', token: 'token-swap-bbbbbbbbbb', name: '乙', v: PROTOCOL_VERSION });
    y.send({ t: 'join', code: room.code });
    await y.wait('room', (m) => m.you.seat === 1);
    x.send({ t: 'hello', token: 'token-swap-cccccccccc', name: '丙', v: PROTOCOL_VERSION });
    const after = await y.wait('room', (m) => m.room.seats[0].connected === false);
    expect(after.room.seats[0].name).toBe('甲');
    x.close();
    y.close();
  });
});
