import { Rng, sz } from '@park/engine';
import type { sz as SZ } from '@park/engine';
import { RotateCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MahjongTile } from '../../components/MahjongTile';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { useTurnCue } from '../shared/trick';
import './suichang.css';

type Ctl = GameController<sz.SzView, sz.SzAction>;
type Tile = SZ.Tile;

const WIND = ['东', '南', '西', '北'];
const EVENT_TEXT: Record<string, string> = {
  chi: '吃',
  peng: '碰',
  gang: '杠',
  hu: '胡',
  zimo: '自摸',
  rob: '抢杠',
  fly: '飞财',
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Melds({ melds, w }: { melds: SZ.SzMeldView[]; w: string }) {
  if (!melds.length) return null;
  return (
    <div className="sz-melds">
      {melds.map((m, i) => (
        <div key={i} className={`sz-meld ${m.kongType === 'an' ? 'is-an' : ''}`}>
          {m.tiles
            ? m.tiles.map((t) => <MahjongTile key={t.id} tile={t} w={w} />)
            : Array.from({ length: 4 }, (_, j) => <MahjongTile key={j} faceDown w={w} />)}
          {m.kongType === 'an' && <span className="sz-meld__tag">暗</span>}
        </div>
      ))}
    </div>
  );
}

function River({
  river,
  pos,
  lastId,
}: {
  river: SZ.RiverTile[];
  pos: 'top' | 'bottom' | 'left' | 'right';
  lastId: number | null;
}) {
  return (
    <div className={`sz-river is-${pos}`}>
      {river.map((r) => (
        <MahjongTile
          key={r.tile.id}
          tile={r.tile}
          w="var(--rw)"
          highlight={r.tile.id === lastId}
          className={r.claimedBy?.length ? 'is-claimed' : ''}
        />
      ))}
    </div>
  );
}

export default function SuichangBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const pos = (s: number) => (['bottom', 'right', 'top', 'left'] as const)[(s - me + 4) % 4];
  const seatAt = (p: 'right' | 'top' | 'left') => (me + { right: 1, top: 2, left: 3 }[p]) % 4;
  const L = spectator ? null : v.legal;
  const mine = v.players[me];
  const jokerKind = v.jokerKind;
  const [sel, setSel] = useState<number[]>([]);
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const actRef = useRef<HTMLDivElement>(null);

  const phaseKey = `${v.session}-${v.round}-${v.phase}-${mine.handCount}-${v.drawn}`;
  useEffect(() => setSel([]), [phaseKey]);

  const myTurn =
    !!L && (L.discard.length > 0 || L.hu || L.gang.length > 0 || L.peng || L.chi.length > 0);
  useTurnCue(!!L && (myTurn || L.pass));

  const drawnTile = v.drawn !== null ? (v.hand.find((t) => t.id === v.drawn) ?? null) : null;
  const handMain = drawnTile ? v.hand.filter((t) => t.id !== drawnTile.id) : v.hand;

  const meldTiles = mine.melds.reduce((a, m) => a + (m.tiles?.length ?? 4), 0);
  const units =
    v.hand.length + (drawnTile ? 0.6 : 0) + meldTiles * 0.78 + mine.melds.length * 0.3 + 0.8;
  const maxByHeight = typeof window !== 'undefined' ? Math.min(64, window.innerHeight * 0.1) : 56;
  const tw = Math.max(21, Math.min(maxByHeight, (width - 24) / Math.max(units, 8)));

  const seen = useRef(v.events.at(-1)?.seq ?? 0);
  const [shouts, setShouts] = useState<{ id: number; seat: number; text: string }[]>([]);
  useEffect(() => {
    const fresh = v.events.filter((e) => e.seq > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].seq;
    for (const e of fresh) {
      const text = EVENT_TEXT[e.type];
      if (!text) continue;
      const id = e.seq;
      setShouts((list) => [...list, { id, seat: e.seat, text }]);
      window.setTimeout(() => setShouts((list) => list.filter((x) => x.id !== id)), 1500);
      if (e.type === 'hu' || e.type === 'zimo' || e.type === 'rob')
        playSound(e.seat === me ? 'win' : 'chip');
      else playSound(e.type === 'gang' || e.type === 'fly' ? 'bomb' : 'select');
    }
  }, [v.events, me]);

  const explosiveNow = useMemo(() => {
    if (v.phase !== 'play') return false;
    if (v.hand.length % 3 === 1)
      return sz.explosiveWait(sz.countKinds(v.hand), jokerKind, mine.melds.length);
    if (drawnTile) {
      const pre = v.hand.filter((t) => t.id !== drawnTile.id);
      return sz.explosiveWait(sz.countKinds(pre), jokerKind, mine.melds.length);
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version, drawnTile]);

  const waitsNow = useMemo(() => {
    if (v.phase !== 'play' || v.window || v.hand.length % 3 !== 1) return [];
    return sz.waits(sz.countKinds(v.hand), jokerKind, mine.melds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version]);

  const previewWaits = useMemo(() => {
    if (sel.length !== 1) return waitsNow;
    const rest = v.hand.filter((t) => t.id !== sel[0]);
    return sz.waits(sz.countKinds(rest), jokerKind, mine.melds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, ctl.version]);

  const act = (a: sz.SzAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    else setSel([]);
  };

  const isJoker = (t: Tile) => jokerKind !== null && sz.hzKindOf(t) === jokerKind;

  const onTile = (t: Tile) => {
    if (!L || !L.discard.includes(t.id)) return;
    if (sel[0] === t.id) act({ type: 'discard', tile: t.id });
    else {
      setSel([t.id]);
      playSound('select');
    }
  };

  const recommend = () => {
    const a = ctl.def.bot(v, me, new Rng(3)) as sz.SzAction;
    if (a.type === 'discard') setSel([a.tile]);
    else toast('这一步可以考虑：' + actionText(a));
  };

  const actionText = (a: sz.SzAction) => {
    switch (a.type) {
      case 'hu':
        return '胡牌';
      case 'peng':
        return '碰';
      case 'gang':
        return '杠';
      case 'chi':
        return '吃';
      case 'pass':
        return '过';
      default:
        return '出牌';
    }
  };

  const renderHandTile = (t: Tile) => {
    const joker = isJoker(t);
    return (
      <div
        key={t.id}
        className={`sz-handtile ${joker ? 'is-joker' : ''}`}
        onClick={() => onTile(t)}
      >
        <MahjongTile tile={t} selected={sel.includes(t.id)} />
      </div>
    );
  };

  const seatBlock = (s: number) => {
    const p = v.players[s];
    const where = pos(s);
    return (
      <div className={`sz-seat is-${where} ${p.won ? 'is-won' : ''}`}>
        <Seat
          player={ctl.players[s]}
          active={v.turn === s && !v.window && v.phase === 'play'}
          deadline={ctl.deadlines[s]}
          size={54}
          layout={where === 'top' ? 'row' : 'column'}
          tag={s === v.dealer ? (v.dealerStreak > 0 ? `庄×${v.dealerStreak + 1}` : '庄') : undefined}
          sub={<span className="num">{v.chips[s]}</span>}
        >
          {p.won && <span className="sz-wonbadge">胡</span>}
        </Seat>
        <div className="sz-oppo">
          <Melds melds={p.melds} w="var(--rw)" />
          <div className="sz-backs">
            {p.hand
              ? p.hand.map((t) => <MahjongTile key={t.id} tile={t} w="var(--rw)" />)
              : Array.from({ length: p.handCount }, (_, i) => (
                  <MahjongTile key={i} faceDown w="calc(var(--rw) * 0.86)" />
                ))}
          </div>
        </div>
        {shouts
          .filter((x) => x.seat === s)
          .map((x) => (
            <span key={x.id} className="sz-shout">
              {x.text}
            </span>
          ))}
      </div>
    );
  };

  const lastDiscard = v.window?.tile?.id ?? v.lastDiscard?.id ?? null;
  const turnPos = v.window ? pos(v.window.source ?? v.turn ?? me) : v.turn !== null ? pos(v.turn) : null;
  const jokerName = jokerKind !== null ? sz.kindName(jokerKind) : null;
  const flySeat = v.fly?.seat ?? null;

  return (
    <div className="sz" ref={rootRef} style={{ '--tw': `${tw}px` } as CSSProperties}>
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>

      <div className="sz-info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.session}</b>
          {v.options.sessions ? ` / ${v.options.sessions}` : ''} 盘 · 第{' '}
          <b className="num">{v.round}</b> 局
        </span>
        <span className="chip">
          底分 <b className="num">{v.dealerBase}</b>
        </span>
        {v.flip && jokerName && (
          <span className="chip is-gold sz-jokerchip" title={`翻出 ${sz.tileName(v.flip)}，${jokerName}为财神`}>
            财神
            <MahjongTile tile={v.flip} w="16px" />
            <b>{jokerName}</b>
          </span>
        )}
        {v.fly && (
          <span className="chip is-gold sz-flychip">
            飞财 · {ctl.players[v.fly.seat].name}（剩 {v.fly.left} 家）
          </span>
        )}
      </div>

      <div className="sz-area is-top">{seatBlock(seatAt('top'))}</div>
      <div className="sz-area is-left">{seatBlock(seatAt('left'))}</div>
      <div className="sz-area is-right">{seatBlock(seatAt('right'))}</div>

      <div className="sz-center">
        <div className="sz-table">
          <River river={v.players[seatAt('top')].river} pos="top" lastId={lastDiscard} />
          <River river={v.players[seatAt('left')].river} pos="left" lastId={lastDiscard} />
          <div className="sz-compass">
            {(['bottom', 'right', 'top', 'left'] as const).map((p, i) => {
              const s = (me + i) % 4;
              return (
                <span
                  key={p}
                  className={`sz-wind is-${p} ${turnPos === p && v.phase === 'play' ? 'is-on' : ''} ${s === v.dealer ? 'is-dealer' : ''}`}
                >
                  {WIND[s]}
                </span>
              );
            })}
            <div className="sz-wall">
              <small>余</small>
              <b className="num">{v.wallCount}</b>
            </div>
          </div>
          <River river={v.players[seatAt('right')].river} pos="right" lastId={lastDiscard} />
          <River river={mine.river} pos="bottom" lastId={lastDiscard} />
        </div>
        {flySeat !== null && (
          <div className="sz-notice">
            <span>飞财</span>
            {ctl.players[flySeat].name} 打出财神，这一圈只能自摸
          </div>
        )}
        {shouts
          .filter((x) => x.seat === me)
          .map((x) => (
            <span key={x.id} className="sz-shout is-me">
              {x.text}
            </span>
          ))}
      </div>

      <div className="sz-act" ref={actRef}>
        <div className="sz-me">
          <Seat
            player={ctl.players[me]}
            active={myTurn}
            deadline={ctl.deadlines[me]}
            size={48}
            layout="row"
            tag={me === v.dealer ? (v.dealerStreak > 0 ? `庄×${v.dealerStreak + 1}` : '庄') : undefined}
            sub={<span className="num">{v.chips[me]}</span>}
          />
        </div>
        <div className="sz-actions">
          {L && v.phase === 'play' && v.window && (
            <div className="action-bar">
              {v.window.tile && (
                <span className="action-hint">
                  {v.window.source !== null ? ctl.players[v.window.source].name : '有人'}
                  {v.window.kind === 'rob' ? '补杠' : '打出'}
                  <MahjongTile tile={v.window.tile} w="calc(var(--rw) * 1.1)" />
                </span>
              )}
              {L.hu && (
                <Button variant="felt-primary" onClick={() => act({ type: 'hu' })}>
                  {v.window.kind === 'rob' ? '抢杠胡' : '胡'}
                </Button>
              )}
              {L.gang.length > 0 && (
                <Button variant="felt" onClick={() => act({ type: 'gang' })}>
                  杠
                </Button>
              )}
              {L.peng && (
                <Button variant="felt" onClick={() => act({ type: 'peng' })}>
                  碰
                </Button>
              )}
              {L.chi.map((pair) => {
                const tiles = pair
                  .map((id) => v.hand.find((t) => t.id === id))
                  .filter((t): t is Tile => !!t);
                return (
                  <Button
                    key={pair.join(',')}
                    variant="felt"
                    onClick={() => act({ type: 'chi', tiles: pair })}
                  >
                    吃
                    <span className="sz-chi">
                      {[...tiles, v.window!.tile!].map((t) => sz.tileName(t)).join('')}
                    </span>
                  </Button>
                );
              })}
              {L.pass && (
                <Button variant="felt" onClick={() => act({ type: 'pass' })}>
                  过
                </Button>
              )}
            </div>
          )}
          {L && v.phase === 'play' && !v.window && (
            <div className="action-bar">
              {L.hu && (
                <Button variant="felt-primary" onClick={() => act({ type: 'hu' })}>
                  {explosiveNow ? '爆头' : '自摸'}
                </Button>
              )}
              {L.gang.map((g) => {
                const t = sz.hzTileOf(g.tile);
                return (
                  <Button
                    key={`${g.type}-${g.tile}`}
                    variant="felt"
                    onClick={() => act({ type: 'gang', tile: g.tile })}
                  >
                    {g.type === 'an' ? '暗杠' : '补杠'} {sz.tileName(t)}
                  </Button>
                );
              })}
              {L.discard.length > 0 && (
                <>
                  <Button variant="felt" onClick={recommend}>
                    提示
                  </Button>
                  <Button
                    variant="felt-primary"
                    disabled={!(sel.length === 1 && L.discard.includes(sel[0]))}
                    onClick={() => act({ type: 'discard', tile: sel[0] })}
                  >
                    出牌
                  </Button>
                </>
              )}
            </div>
          )}
          {!L && !spectator && v.phase === 'play' && (
            <div className="action-hint">
              {v.window
                ? '等待其他玩家表态…'
                : `等待 ${ctl.players[v.turn ?? 0]?.name ?? ''} 出牌`}
            </div>
          )}
          {spectator && <div className="action-hint">观战中</div>}
        </div>
        {(previewWaits.length > 0 || explosiveNow) && v.phase === 'play' && (
          <div className="sz-ting">
            <span>{explosiveNow ? '爆头·听所有牌' : sel.length === 1 ? '打出后听' : '听牌'}</span>
            {previewWaits.slice(0, 12).map((k) => {
              const left = Math.max(0, 4 - v.visible[k]);
              return (
                <span key={k} className={`sz-ting__tile ${left === 0 ? 'is-dead' : ''}`}>
                  <MahjongTile
                    tile={{ id: -k - 1, suit: sz.kindSuit(k), rank: sz.kindRank(k) }}
                    w="calc(var(--rw) * 0.95)"
                  />
                  <small className="num">{left}</small>
                </span>
              );
            })}
            {previewWaits.length > 12 && <small>…</small>}
          </div>
        )}
      </div>

      <div className="sz-hand">
        {!spectator && (
          <>
            <Melds melds={mine.melds} w="calc(var(--tw) * 0.78)" />
            <div className="sz-hand__tiles">{handMain.map(renderHandTile)}</div>
            {drawnTile && <div className="sz-hand__drawn">{renderHandTile(drawnTile)}</div>}
          </>
        )}
      </div>

      {(v.phase === 'roundOver' || v.phase === 'matchOver') && v.result && (
        <RoundResult ctl={ctl} v={v} me={me} spectator={spectator} />
      )}
    </div>
  );
}

function RoundResult({
  ctl,
  v,
  me,
  spectator,
}: {
  ctl: Ctl;
  v: sz.SzView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const matchOver = v.phase === 'matchOver';
  const readyCount = v.ready.filter(Boolean).length;
  const myWin = r.wins.find((w) => w.seat === me);
  const order = matchOver ? [0, 1, 2, 3].sort((a, b) => v.chips[b] - v.chips[a]) : [0, 1, 2, 3];
  const title = matchOver
    ? order[0] === me && !spectator
      ? '本盘第一'
      : '本盘结束'
    : myWin
      ? myWin.selfDrawn
        ? '自摸'
        : myWin.robbing
          ? '抢杠胡'
          : '胡牌'
      : r.reason === 'wall'
        ? '荒庄'
        : '本局结束';
  const fanText = (w: sz.SzWin) =>
    w.score.patterns.map((p) => sz.FAN_NAME[p.id]).join(' · ');
  const status = (s: number) => {
    const w = r.wins.find((x) => x.seat === s);
    if (!w)
      return (
        <span className="mini-tag is-plain">{r.reason === 'wall' ? '荒庄' : '未胡'}</span>
      );
    const how = w.robbing
      ? `抢杠 ${ctl.players[w.from!]?.name ?? ''}`
      : w.selfDrawn
        ? '自摸'
        : `胡 ${ctl.players[w.from!]?.name ?? ''}`;
    return (
      <>
        <span className="mini-tag">{how}</span> {fanText(w)} · {w.score.fan} 番
        {w.robbing ? `（承包 ${sz.robAmount(w.score)}）` : ''}
      </>
    );
  };
  const pending = r.pending;
  const clauseText = (c: string) => sz.CLAUSE_NAME[c as sz.Clause] ?? c;

  return (
    <Sheet
      open
      dismissible={false}
      wide
      footer={
        matchOver ? (
          <>
            <Button onClick={() => ctl.leave()}>返回大厅</Button>
            {ctl.canRestart && (
              <Button variant="primary" onClick={() => ctl.restart()}>
                再来一场
              </Button>
            )}
          </>
        ) : spectator ? undefined : (
          <Button variant="primary" disabled={v.ready[me]} onClick={() => ctl.act({ type: 'ready' })}>
            {v.ready[me]
              ? `等待其他玩家 ${readyCount}/4`
              : r.sessionEnded
                ? '继续下一盘'
                : '继续下一局'}
          </Button>
        )
      }
    >
      <div className="result">
        <div className={`result__title ${myWin || (matchOver && order[0] === me) ? 'is-win' : 'is-lose'}`}>
          {title}
        </div>
        <div className="result__sub">
          第 {r.session} 盘 · 第 {r.round} 局 ·{' '}
          {r.reason === 'wall' ? `荒庄（庄家 ${ctl.players[r.dealer].name} 赔 5）` : `${r.wins.length} 家胡牌`}
          {r.jokerKind !== null ? ` · 财神 ${sz.kindName(r.jokerKind)}` : ''}
          {r.sessionEnded ? ` · 本盘结束（${r.sanqing ? '三清' : '有人清袋'}）` : ` · ${ctl.players[r.nextDealer].name} 坐庄`}
        </div>
        <table className="result__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>结果</th>
              <th className="num">本局</th>
              <th className="num">筹码</th>
            </tr>
          </thead>
          <tbody>
            {order.map((s) => (
              <tr key={s} className={s === me && !spectator ? 'is-me' : ''}>
                <td>
                  <span className="result__who">
                    <Avatar name={ctl.players[s].name} avatar={ctl.players[s].avatar} size={26} />
                    {ctl.players[s].name}
                    {s === v.dealer && <span className="mini-tag">庄</span>}
                  </span>
                </td>
                <td className="sz-res-status">{status(s)}</td>
                <td className={`num ${r.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                  {signed(r.deltas[s])}
                </td>
                <td className="num">{v.chips[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pending.length > 0 && (
          <div className="sz-pending">
            <b>待结算</b>
            {pending.map((e, i) => (
              <span key={i}>
                {ctl.players[e.from].name} → {ctl.players[e.to].name} {e.due}（{clauseText(e.clause)}）
              </span>
            ))}
          </div>
        )}
        {v.sessionResult && (
          <div className="sz-session">
            <div className="sz-session__title">
              第 {v.sessionResult.session} 盘结算（{v.sessionResult.rounds} 局）
              {v.sessionResult.sanqing ? ' · 三清' : ''}
            </div>
            <table className="result__table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th className="num">筹码</th>
                  <th className="num">本盘</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3].map((s) => (
                  <tr key={s}>
                    <td>{ctl.players[s].name}</td>
                    <td className="num">{v.sessionResult!.chips[s]}</td>
                    <td className={`num ${v.sessionResult!.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                      {signed(v.sessionResult!.deltas[s])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="sz-res-hands">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className="sz-res-hand">
              <span>{ctl.players[s].name}</span>
              <div>
                {r.wins
                  .filter((w) => w.seat === s)
                  .flatMap((w) => [w.tile])
                  .map((t) => (
                    <MahjongTile key={`w-${t.id}`} tile={t} w="var(--rw)" highlight />
                  ))}
                {v.players[s].melds
                  .flatMap((m) => m.tiles ?? [])
                  .map((t) => (
                    <MahjongTile key={t.id} tile={t} w="var(--rw)" />
                  ))}
                {v.players[s].melds.length > 0 && <i className="sz-gap" />}
                {v.players[s].hand?.map((t) => (
                  <MahjongTile key={t.id} tile={t} w="var(--rw)" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
