import type { hz as HZ } from '@park/engine';
import { Rng, hz } from '@park/engine';
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
import './hangzhou.css';

type Ctl = GameController<hz.HzView, hz.HzAction>;
type Tile = HZ.HzTile;

const WIND = ['东', '南', '西', '北'];
const EVENT_TEXT: Record<string, string> = {
  chi: '吃',
  peng: '碰',
  gang: '杠',
  hu: '胡',
  zimo: '自摸',
  rob: '抢杠',
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

function Melds({ melds, w }: { melds: HZ.HzMeldView[]; w: string }) {
  if (!melds.length) return null;
  return (
    <div className="hz-melds">
      {melds.map((m, i) => (
        <div key={i} className={`hz-meld ${m.kongType === 'an' ? 'is-an' : ''}`}>
          {m.tiles
            ? m.tiles.map((t) => <MahjongTile key={t.id} tile={t} w={w} />)
            : Array.from({ length: 4 }, (_, j) => <MahjongTile key={j} faceDown w={w} />)}
          {m.kongType === 'an' && <span className="hz-meld__tag">暗</span>}
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
  river: HZ.RiverTile[];
  pos: 'top' | 'bottom' | 'left' | 'right';
  lastId: number | null;
}) {
  return (
    <div className={`hz-river is-${pos}`}>
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

export default function HangzhouBoard({ ctl }: { ctl: Ctl }) {
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

  const phaseKey = `${v.round}-${v.phase}-${mine.handCount}-${v.drawn}`;
  useEffect(() => setSel([]), [phaseKey]);

  const myTurn = !!L && (L.discard.length > 0 || L.hu || L.gang.length > 0) && v.phase === 'play';
  useTurnCue(!!L && (myTurn || L.peng || L.chi.length > 0 || L.pass));

  // 手牌：摸到的牌单独放在最右
  const drawnTile = v.drawn !== null ? (v.hand.find((t) => t.id === v.drawn) ?? null) : null;
  const handMain = drawnTile ? v.hand.filter((t) => t.id !== drawnTile.id) : v.hand;

  const meldTiles = mine.melds.reduce((a, m) => a + (m.tiles?.length ?? 4), 0);
  const units = v.hand.length + (drawnTile ? 0.6 : 0) + meldTiles * 0.78 + mine.melds.length * 0.3 + 0.8;
  const maxByHeight = typeof window !== 'undefined' ? Math.min(64, window.innerHeight * 0.1) : 56;
  const tw = Math.max(21, Math.min(maxByHeight, (width - 24) / Math.max(units, 8)));

  // 碰杠胡的大字提示与音效
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
      else playSound(e.type === 'gang' ? 'bomb' : 'select');
    }
  }, [v.events, me]);

  // 听牌：只用自己看得到的信息
  const waitsNow = useMemo(() => {
    if (v.phase !== 'play' || v.window || v.hand.length % 3 !== 1) return [];
    return hz.waitingKinds(hz.countKinds(v.hand), jokerKind, mine.melds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version]);

  const previewWaits = useMemo(() => {
    if (sel.length !== 1) return waitsNow;
    const rest = v.hand.filter((t) => t.id !== sel[0]);
    return hz.waitingKinds(hz.countKinds(rest), jokerKind, mine.melds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, ctl.version]);

  const act = (a: hz.HzAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    else setSel([]);
  };

  const isJoker = (t: Tile) => jokerKind !== null && hz.hzKindOf(t) === jokerKind;

  const onTile = (t: Tile) => {
    if (!L || !L.discard.includes(t.id)) return;
    if (sel[0] === t.id) act({ type: 'discard', tile: t.id });
    else {
      setSel([t.id]);
      playSound('select');
    }
  };

  const recommend = () => {
    const a = ctl.def.bot(v, me, new Rng(3)) as hz.HzAction;
    if (a.type === 'discard') setSel([a.tile]);
    else if (a.type === 'hu' || a.type === 'peng' || a.type === 'gang' || a.type === 'chi')
      toast('这一步可以考虑：' + actionText(a));
  };

  const actionText = (a: hz.HzAction) => {
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

  const scoreOf = (s: number) => v.scores[s] + v.roundDeltas[s];
  const scoreLabel = (s: number) => (v.phase === 'play' ? scoreOf(s) : v.scores[s]);

  const renderHandTile = (t: Tile) => {
    const joker = isJoker(t);
    return (
      <div
        key={t.id}
        className={`hz-handtile ${joker ? 'is-joker' : ''}`}
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
      <div className={`hz-seat is-${where} ${p.won ? 'is-won' : ''}`}>
        <Seat
          player={ctl.players[s]}
          active={v.turn === s && !v.window && v.phase === 'play'}
          deadline={ctl.deadlines[s]}
          size={54}
          layout={where === 'top' ? 'row' : 'column'}
          tag={s === v.dealer ? '庄' : undefined}
          sub={<span className="num">{scoreLabel(s)}</span>}
        >
          {p.won && <span className="hz-wonbadge">胡</span>}
        </Seat>
        <div className="hz-oppo">
          <Melds melds={p.melds} w="var(--rw)" />
          <div className="hz-backs">
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
            <span key={x.id} className="hz-shout">
              {x.text}
            </span>
          ))}
      </div>
    );
  };

  const lastDiscard = v.window?.tile?.id ?? v.lastDiscard?.id ?? null;
  const turnPos = v.window ? pos(v.window.source ?? v.turn ?? me) : v.turn !== null ? pos(v.turn) : null;
  const jokerName = jokerKind !== null ? hz.kindName(jokerKind) : null;

  return (
    <div className="hz" ref={rootRef} style={{ '--tw': `${tw}px` } as CSSProperties}>
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>

      <div className="hz-info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b>
          {v.options.rounds ? ` / ${v.options.rounds}` : ''} 盘
        </span>
        <span className="chip">
          底分 <b className="num">{v.options.baseScore}</b>
        </span>
        {jokerName && (
          <span className="chip is-gold hz-jokerchip" title="四张白板为财神，可以当任意牌用">
            财神
            <MahjongTile tile={{ id: -1, suit: 'jian', rank: 3 }} w="16px" />
            <b>{jokerName}</b>
          </span>
        )}
      </div>

      <div className="hz-area is-top">{seatBlock(seatAt('top'))}</div>
      <div className="hz-area is-left">{seatBlock(seatAt('left'))}</div>
      <div className="hz-area is-right">{seatBlock(seatAt('right'))}</div>

      <div className="hz-center">
        <div className="hz-table">
          <River river={v.players[seatAt('top')].river} pos="top" lastId={lastDiscard} />
          <River river={v.players[seatAt('left')].river} pos="left" lastId={lastDiscard} />
          <div className="hz-compass">
            {(['bottom', 'right', 'top', 'left'] as const).map((p, i) => {
              const s = (me + i) % 4;
              return (
                <span
                  key={p}
                  className={`hz-wind is-${p} ${turnPos === p && v.phase === 'play' ? 'is-on' : ''} ${s === v.dealer ? 'is-dealer' : ''}`}
                >
                  {WIND[s]}
                </span>
              );
            })}
            <div className="hz-wall">
              <small>余</small>
              <b className="num">{v.wallCount}</b>
            </div>
          </div>
          <River river={v.players[seatAt('right')].river} pos="right" lastId={lastDiscard} />
          <River river={mine.river} pos="bottom" lastId={lastDiscard} />
        </div>
        {shouts
          .filter((x) => x.seat === me)
          .map((x) => (
            <span key={x.id} className="hz-shout is-me">
              {x.text}
            </span>
          ))}
      </div>

      <div className="hz-act" ref={actRef}>
        <div className="hz-me">
          <Seat
            player={ctl.players[me]}
            active={myTurn}
            deadline={ctl.deadlines[me]}
            size={48}
            layout="row"
            tag={me === v.dealer ? '庄' : undefined}
            sub={<span className="num">{scoreLabel(me)}</span>}
          />
        </div>
        <div className="hz-actions">
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
                    <span className="hz-chi">
                      {[...tiles, v.window!.tile!].map((t) => hz.tileName(t)).join('')}
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
                  {v.drawn === null && v.hand.length === 14 ? '天胡' : '自摸'}
                </Button>
              )}
              {L.gang.map((g) => {
                const t = hz.hzTileOf(g.tile);
                return (
                  <Button
                    key={`${g.type}-${g.tile}`}
                    variant="felt"
                    onClick={() => act({ type: 'gang', tile: g.tile })}
                  >
                    {g.type === 'an' ? '暗杠' : '补杠'} {hz.tileName(t)}
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
        {previewWaits.length > 0 && v.phase === 'play' && (
          <div className="hz-ting">
            <span>{sel.length === 1 ? '打出后听' : '听牌'}</span>
            {previewWaits.map((k) => {
              const left = Math.max(0, 4 - v.visible[k]);
              return (
                <span key={k} className={`hz-ting__tile ${left === 0 ? 'is-dead' : ''}`}>
                  <MahjongTile
                    tile={{ id: -k - 1, suit: hz.kindSuit(k), rank: hz.kindRank(k) }}
                    w="calc(var(--rw) * 0.95)"
                  />
                  <small className="num">{left}</small>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="hz-hand">
        {!spectator && (
          <>
            <Melds melds={mine.melds} w="calc(var(--tw) * 0.78)" />
            <div className="hz-hand__tiles">{handMain.map(renderHandTile)}</div>
            {drawnTile && <div className="hz-hand__drawn">{renderHandTile(drawnTile)}</div>}
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
  v: hz.HzView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const matchOver = v.phase === 'matchOver';
  const readyCount = v.ready.filter(Boolean).length;
  const myWin = r.wins.find((w) => w.seat === me);
  const order = matchOver ? [0, 1, 2, 3].sort((a, b) => v.scores[b] - v.scores[a]) : [0, 1, 2, 3];
  const title = matchOver
    ? order[0] === me && !spectator
      ? '本场第一'
      : '本场结束'
    : myWin
      ? myWin.selfDrawn
        ? '自摸'
        : '胡牌'
      : r.reason === 'wall'
        ? '荒庄'
        : '本盘结束';
  const fanText = (w: hz.HzWin) => w.score.items.map((it) => hz.FAN_NAME[it.id]).join(' · ');
  const status = (s: number) => {
    const w = r.wins.find((x) => x.seat === s);
    if (!w)
      return (
        <span className="mini-tag is-plain">{r.reason === 'wall' ? '荒庄' : '未胡'}</span>
      );
    const how = w.selfDrawn ? '自摸' : `胡 ${ctl.players[w.from!]?.name ?? ''}`;
    return (
      <>
        <span className="mini-tag">{how}</span> {fanText(w)} · {w.score.fanRaw}台
        {w.score.fanRaw > w.score.fanCharged ? '（封顶）' : ''}
      </>
    );
  };

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
            {v.ready[me] ? `等待其他玩家 ${readyCount}/4` : '继续下一盘'}
          </Button>
        )
      }
    >
      <div className="result">
        <div className={`result__title ${myWin || (matchOver && order[0] === me) ? 'is-win' : 'is-lose'}`}>
          {title}
        </div>
        <div className="result__sub">
          第 {r.round} 盘 · {r.reason === 'wall' ? '牌墙摸完' : `${r.wins.length} 家胡牌`}
          {r.jokerKind !== null ? ` · 财神 ${hz.kindName(r.jokerKind)}` : ''}
          {matchOver
            ? ''
            : ` · ${r.dealerKeeps ? `${ctl.players[r.nextDealer].name} 连庄` : `${ctl.players[r.nextDealer].name} 坐庄`}`}
        </div>
        <table className="result__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>结果</th>
              <th className="num">本盘</th>
              <th className="num">总分</th>
            </tr>
          </thead>
          <tbody>
            {order.map((s) => (
              <tr key={s} className={s === me && !spectator ? 'is-me' : ''}>
                <td>
                  <span className="result__who">
                    <Avatar name={ctl.players[s].name} avatar={ctl.players[s].avatar} size={26} />
                    {ctl.players[s].name}
                  </span>
                </td>
                <td className="hz-res-status">{status(s)}</td>
                <td className={`num ${r.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                  {signed(r.deltas[s])}
                </td>
                <td className="num">{v.scores[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hz-res-hands">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className="hz-res-hand">
              <span>{ctl.players[s].name}</span>
              <div>
                {r.melds[s]
                  .flatMap((m) => m.tiles)
                  .map((t) => (
                    <MahjongTile key={t.id} tile={t} w="var(--rw)" />
                  ))}
                {r.melds[s].length > 0 && <i className="hz-gap" />}
                {r.hands[s].map((t) => (
                  <MahjongTile key={t.id} tile={t} w="var(--rw)" />
                ))}
                {r.wins.map((w) =>
                  w.seat === s ? (
                    <span key={w.tile.id} className="hz-res-win">
                      <MahjongTile tile={w.tile} w="var(--rw)" />
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
