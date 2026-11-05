import type { mj as MJ } from '@park/engine';
import { Rng, gd136 } from '@park/engine';
import { RotateCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MahjongTile } from '../../components/MahjongTile';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { useTurnCue } from '../shared/trick';
// 牌桌皮肤与四川麻将共用（同样是四人麻将桌的布局）
import '../sichuan/sichuan.css';
import './guangdong136.css';

type Ctl = GameController<gd136.GdView, gd136.GdAction>;
type Tile = gd136.Tile;
/** 牌面组件需要 suit/rank，字牌额外传 honor */
type Face = { id: number; suit: MJ.MjSuit; rank: number; honor?: string };

function face(t: { id: number; kind: number }): Face {
  const suit = gd136.suitOfKind(t.kind) ?? 'wan';
  return {
    id: t.id,
    suit: suit as MJ.MjSuit,
    rank: gd136.rankOfKind(t.kind) || 1,
    honor: gd136.isHonorKind(t.kind) ? gd136.kindLabel(t.kind) : undefined,
  };
}

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

function Melds({ melds, w }: { melds: gd136.GdMeld[]; w: string }) {
  if (!melds.length) return null;
  return (
    <div className="sc-melds">
      {melds.map((m, i) => (
        <div
          key={i}
          className={`sc-meld ${m.kongType === 'an' ? 'is-an' : ''}`}
          title={m.kongType === 'an' ? '暗杠' : m.kongType === 'ba' ? '补杠' : undefined}
        >
          {m.tiles.map((t) => (
            <MahjongTile key={t.id} tile={face(t)} honor={face(t).honor} w={w} />
          ))}
          {m.kongType === 'an' && <span className="sc-meld__tag">暗</span>}
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
  river: gd136.GdRiverTile[];
  pos: 'top' | 'bottom' | 'left' | 'right';
  lastId: number | null;
}) {
  return (
    <div className={`sc-river is-${pos}`}>
      {river.map((r) => (
        <MahjongTile
          key={r.tile.id}
          tile={face(r.tile)}
          honor={face(r.tile).honor}
          w="var(--rw)"
          highlight={r.tile.id === lastId}
          className={r.claimedBy?.length ? 'is-claimed' : ''}
        />
      ))}
    </div>
  );
}

export default function Gd136Board({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const pos = (s: number) => (['bottom', 'right', 'top', 'left'] as const)[(s - me + 4) % 4];
  const seatAt = (p: 'right' | 'top' | 'left') => (me + { right: 1, top: 2, left: 3 }[p]) % 4;
  const L = spectator ? null : v.legal;
  const mine = v.players[me];
  const [sel, setSel] = useState<number[]>([]);
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const actRef = useRef<HTMLDivElement>(null);

  const phaseKey = `${v.round}-${v.phase}-${v.players[me].handCount}-${v.drawn}`;
  useEffect(() => setSel([]), [phaseKey]);

  const myTurn =
    !!L &&
    (L.discard.length > 0 || L.hu || L.gang.length > 0 || L.peng || L.chi.length > 0 || L.pass) &&
    v.phase === 'play';
  useTurnCue(!!L && v.phase === 'play');

  // 手牌：摸到的牌单独放在最右
  const drawnTile = v.drawn !== null ? (v.hand.find((t) => t.id === v.drawn) ?? null) : null;
  const handMain = drawnTile ? v.hand.filter((t) => t.id !== drawnTile.id) : v.hand;

  // 牌宽：根据宽度与张数计算
  const meldTiles = mine.melds.reduce((a, m) => a + m.tiles.length, 0);
  const units =
    v.hand.length + (drawnTile ? 0.6 : 0) + meldTiles * 0.78 + mine.melds.length * 0.3 + 0.8;
  const maxByHeight = typeof window !== 'undefined' ? Math.min(64, window.innerHeight * 0.1) : 56;
  const tw = Math.max(22, Math.min(maxByHeight, (width - 24) / Math.max(units, 8)));

  // 事件：吃 / 碰 / 杠 / 胡 的大字提示与音效
  const seen = useRef(v.events.at(-1)?.seq ?? 0);
  const [shouts, setShouts] = useState<{ id: number; seat: number; text: string }[]>([]);
  useEffect(() => {
    const fresh = v.events.filter((e) => e.seq > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].seq;
    for (const e of fresh) {
      if (!('seat' in e)) continue;
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

  const meldCount = mine.melds.length;
  const currentWaits = (() => {
    if (v.phase !== 'play' || mine.won || v.hand.length % 3 !== 1) return [];
    return gd136.waitingKinds(gd136.countKinds(v.hand), meldCount);
  })();

  const selectedTile = sel.length === 1 ? v.hand.find((t) => t.id === sel[0]) : undefined;
  const previewWaits = (() => {
    if (!selectedTile || !L || !L.discard.includes(selectedTile.id)) return currentWaits;
    const counts = gd136.countKinds(v.hand);
    counts[selectedTile.kind]--;
    return gd136.waitingKinds(counts, meldCount);
  })();

  const act = (a: gd136.GdAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    else setSel([]);
  };

  const onTile = (t: Tile) => {
    if (!L) return;
    if (L.discard.includes(t.id)) {
      if (sel[0] === t.id) act({ type: 'discard', tile: t.id });
      else {
        setSel([t.id]);
        playSound('select');
      }
    }
  };

  // 「提示」和电脑玩家用同一套判断
  const recommend = () => {
    const a = ctl.def.bot(v, me, new Rng(1)) as gd136.GdAction;
    if (a.type === 'discard') setSel([a.tile]);
  };

  const tileClass = (t: Tile) => {
    const disabled = L && L.discard.length > 0 && !L.discard.includes(t.id);
    return disabled ? 'is-locked' : '';
  };

  const renderHandTile = (t: Tile) => (
    <div key={t.id} className={`sc-handtile ${tileClass(t)}`} onClick={() => onTile(t)}>
      <MahjongTile tile={face(t)} honor={face(t).honor} selected={sel.includes(t.id)} />
    </div>
  );

  const scoreOf = (s: number) => v.scores[s] + v.roundDeltas[s];

  const seatBlock = (s: number) => {
    const p = v.players[s];
    const where = pos(s);
    return (
      <div className={`sc-seat is-${where} ${p.won ? 'is-won' : ''}`}>
        <Seat
          player={ctl.players[s]}
          active={v.turn === s && !v.window && v.phase === 'play'}
          deadline={ctl.deadlines[s]}
          size={54}
          layout={where === 'top' ? 'row' : 'column'}
          tag={s === v.dealer ? '庄' : undefined}
          sub={<span className="num">{scoreOf(s)}</span>}
        >
          {p.won && <span className="gd-fan">{p.won.score.fanRaw}番</span>}
        </Seat>
        {p.won && (
          <span className="sc-wonbadge">
            {p.won.selfDrawn ? '自摸' : '胡'} · {p.won.score.fanRaw}番
          </span>
        )}
        <div className="sc-oppo">
          <Melds melds={p.melds} w="var(--rw)" />
          <div className="sc-backs">
            {p.hand
              ? p.hand.map((t) => (
                  <MahjongTile key={t.id} tile={face(t)} honor={face(t).honor} w="var(--rw)" />
                ))
              : Array.from({ length: p.handCount }, (_, i) => (
                  <MahjongTile key={i} faceDown w="calc(var(--rw) * 0.86)" />
                ))}
          </div>
        </div>
        {shouts
          .filter((x) => x.seat === s)
          .map((x) => (
            <span key={x.id} className="sc-shout">
              {x.text}
            </span>
          ))}
      </div>
    );
  };

  const lastDiscard = v.window?.tile?.id ?? v.lastDiscard?.id ?? null;

  const turnPos = v.window
    ? pos(v.window.source ?? v.turn ?? me)
    : v.turn !== null
      ? pos(v.turn)
      : null;

  return (
    <div className="sc gd" ref={rootRef} style={{ '--tw': `${tw}px` } as CSSProperties}>
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>
      <div className="sc-info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b>
          {v.options.rounds ? ` / ${v.options.rounds}` : ''} 盘
        </span>
        <span className="chip">
          底分 <b className="num">{v.options.baseScore}</b>
        </span>
        <span className={`chip ${v.preset === 'laozhang' ? 'is-gold' : ''}`}>
          {v.preset === 'laozhang' ? '老章' : '鸡平胡'} <b className="num">{v.minFan}</b> 番起胡
        </span>
        {(v.options.chips ?? 0) > 0 && (
          <span className="chip is-gold">
            筹码 <b className="num">{v.options.chips}</b>
          </span>
        )}
        {!v.options.allowChi && <span className="chip">不吃牌</span>}
      </div>

      <div className="sc-area is-top">{seatBlock(seatAt('top'))}</div>
      <div className="sc-area is-left">{seatBlock(seatAt('left'))}</div>
      <div className="sc-area is-right">{seatBlock(seatAt('right'))}</div>

      <div className="sc-center">
        <div className="sc-table">
          <River river={v.players[seatAt('top')].river} pos="top" lastId={lastDiscard} />
          <River river={v.players[seatAt('left')].river} pos="left" lastId={lastDiscard} />
          <div className="sc-compass">
            {(['bottom', 'right', 'top', 'left'] as const).map((p, i) => {
              const s = (me + i) % 4;
              return (
                <span
                  key={p}
                  className={`sc-wind is-${p} ${turnPos === p && v.phase === 'play' ? 'is-on' : ''} ${s === v.dealer ? 'is-dealer' : ''}`}
                >
                  {WIND[s]}
                </span>
              );
            })}
            <div className="sc-wall">
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
            <span key={x.id} className="sc-shout is-me">
              {x.text}
            </span>
          ))}
      </div>

      <div className="sc-act" ref={actRef}>
        <div className="sc-me">
          <Seat
            player={ctl.players[me]}
            active={myTurn}
            deadline={ctl.deadlines[me]}
            size={48}
            layout="row"
            tag={me === v.dealer ? '庄' : undefined}
            sub={<span className="num">{scoreOf(me)}</span>}
          />
        </div>
        {v.nearWin && v.phase === 'play' && !mine.won && (
          <div className="gd-nearwin">
            这手牌已经是和牌形状（{v.nearWin.patterns.join('、')} {v.nearWin.fan} 番），但
            {v.preset === 'laozhang' ? '老章' : '鸡平胡'}要 {v.nearWin.need} 番起胡，还不能胡
          </div>
        )}
        <div className="sc-actions">
          {L && v.phase === 'play' && v.window && (
            <div className="action-bar">
              {v.window.tile && (
                <span className="action-hint">
                  {ctl.players[v.window.source!].name} {v.window.kind === 'rob' ? '补杠' : '打出'}
                  <MahjongTile
                    tile={face(v.window.tile)}
                    honor={face(v.window.tile).honor}
                    w="calc(var(--rw) * 1.1)"
                  />
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
              {L.chi.map((ids, i) => {
                const tiles = ids
                  .map((id) => v.hand.find((t) => t.id === id))
                  .filter(Boolean) as Tile[];
                return (
                  <Button key={i} variant="felt" onClick={() => act({ type: 'chi', tiles: ids })}>
                    吃 {tiles.map((t) => gd136.kindLabel(t.kind)).join(' + ')}
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
                const t = v.hand.find((x) => x.id === g.tile);
                return (
                  <Button
                    key={g.tile}
                    variant="felt"
                    onClick={() => act({ type: 'gang', tile: g.tile })}
                  >
                    {g.type === 'an' ? '暗杠' : '补杠'} {t ? gd136.kindLabel(t.kind) : ''}
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
          {!L && !spectator && v.phase !== 'roundOver' && v.phase !== 'matchOver' && (
            <div className="action-hint">
              {v.window ? '等待其他玩家表态…' : `等待 ${ctl.players[v.turn ?? 0]?.name} 出牌`}
            </div>
          )}
        </div>
        {previewWaits.length > 0 && v.phase === 'play' && !mine.won && (
          <div className="sc-ting">
            <span>{selectedTile ? '打出后听' : '听牌'}</span>
            {previewWaits.map((k) => {
              const left = Math.max(0, 4 - v.visible[k]);
              return (
                <span
                  key={k}
                  className={`sc-ting__tile ${left === 0 ? 'is-dead' : ''}`}
                  title={gd136.kindLabel(k)}
                >
                  <MahjongTile
                    tile={face({ id: -k - 1, kind: k })}
                    honor={face({ id: -k - 1, kind: k }).honor}
                    w="calc(var(--rw) * 0.95)"
                  />
                  <small className="num">{left}</small>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="sc-hand">
        {!spectator && (
          <>
            <Melds melds={mine.melds} w="calc(var(--tw) * 0.78)" />
            <div className="sc-hand__tiles">{handMain.map(renderHandTile)}</div>
            {drawnTile && <div className="sc-hand__drawn">{renderHandTile(drawnTile)}</div>}
          </>
        )}
        {spectator && <div className="action-hint">观战中</div>}
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
  v: gd136.GdView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const matchOver = v.phase === 'matchOver';
  const chipMode = (v.options.chips ?? 0) > 0;
  const broke = chipMode ? [0, 1, 2, 3].filter((s) => v.scores[s] <= 0) : [];
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
      : r.wins.length === 0
        ? '荒庄'
        : '本盘结束';
  const winText = (w: gd136.GdWin) =>
    w.score.items.map((it) => gd136.Z_FAN_NAME[it.id]).join(' · ');
  const status = (s: number) => {
    const w = r.wins.find((x) => x.seat === s);
    if (w) {
      const how = w.selfDrawn ? '自摸' : `胡 ${ctl.players[w.from!].name}`;
      return (
        <>
          <span className="mini-tag">{how}</span> {winText(w)} · {w.score.fanRaw}番
          {w.score.fanRaw > w.score.fanCharged ? '（封顶）' : ''}
        </>
      );
    }
    return null;
  };
  const clauseSum = new Map<string, number>();
  for (const e of r.ledger) clauseSum.set(e.clause, (clauseSum.get(e.clause) ?? 0) + e.amount);

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
          <Button
            variant="primary"
            disabled={v.ready[me]}
            onClick={() => ctl.act({ type: 'ready' })}
          >
            {v.ready[me] ? `等待其他玩家 ${readyCount}/4` : '继续下一盘'}
          </Button>
        )
      }
    >
      <div className="result">
        <div
          className={`result__title ${myWin || (matchOver && order[0] === me) ? 'is-win' : 'is-lose'}`}
        >
          {title}
        </div>
        <div className="result__sub">
          第 {r.round} 盘 · {r.reason === 'hu' ? '有人胡牌' : '牌墙摸完'} ·{' '}
          {v.preset === 'laozhang' ? '老章' : '鸡平胡'}
          {matchOver && broke.length > 0
            ? ` · ${broke.map((s) => ctl.players[s].name).join('、')} 筹码输光，本场结束`
            : ` · 下一盘 ${ctl.players[r.nextDealer].name} 坐庄`}
        </div>
        <table className="result__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>本盘</th>
              <th className="num">本盘得分</th>
              <th className="num">{chipMode ? '筹码' : '总分'}</th>
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
                <td className="sc-res-status">{status(s)}</td>
                <td className={`num ${r.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                  {signed(r.deltas[s])}
                </td>
                <td className="num">{v.scores[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.ledger.length > 0 && (
          <details className="sc-ledger">
            <summary>
              账目明细（
              {[...clauseSum.keys()]
                .map((c) => gd136.GD_CLAUSE_NAME[c as gd136.GdClause])
                .join('、')}
              ）
            </summary>
            <ul>
              {r.ledger.map((e, i) => (
                <li key={i}>
                  <span>{gd136.GD_CLAUSE_NAME[e.clause]}</span>
                  {ctl.players[e.from].name} → {ctl.players[e.to].name}
                  <b className="num">{e.amount}</b>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="sc-res-hands">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className="sc-res-hand">
              <span>{ctl.players[s].name}</span>
              <div>
                {v.players[s].melds
                  .flatMap((m) => m.tiles)
                  .map((t) => (
                    <MahjongTile key={t.id} tile={face(t)} honor={face(t).honor} w="var(--rw)" />
                  ))}
                {v.players[s].melds.length > 0 && <i className="sc-gap" />}
                {r.hands[s].map((t) => (
                  <MahjongTile key={t.id} tile={face(t)} honor={face(t).honor} w="var(--rw)" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
