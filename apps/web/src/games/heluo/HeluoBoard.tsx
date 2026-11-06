import type { hl } from '@park/engine';
import { RotateCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MahjongTile } from '../../components/MahjongTile';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { speak } from '../../lib/speech';
import { useTurnCue } from '../shared/trick';
import '../sichuan/sichuan.css';
import './heluo.css';

type Ctl = GameController<hl.HlView, hl.HlAction>;
type Tile = hl.HlTile;

const WIND = ['东', '南', '西', '北'];
const SUITS = ['wan', 'tiao', 'tong'] as const;
const KIND_NAME =
  '一万.二万.三万.四万.五万.六万.七万.八万.九万.一条.二条.三条.四条.五条.六条.七条.八条.九条.一筒.二筒.三筒.四筒.五筒.六筒.七筒.八筒.九筒.东.南.西.北.中.发.白'.split(
    '.',
  );
const WIN_NAME: Record<hl.WinKind, string> = {
  mingci: '明次',
  anci: '暗次',
  pici: '屁次',
  zimo: '自摸',
  baoci: '包次',
};
const EVENT_TEXT: Record<string, string> = {
  peng: '碰',
  gang: '杠',
  ci: '次',
  pici: '屁次',
  zimo: '自摸',
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

/** 序数牌复用矢量牌面；字牌用文字牌面 */
function HlTileView({
  tile,
  w,
  faceDown,
  highlight,
  selected,
  className = '',
  onClick,
}: {
  tile?: Tile | null;
  w?: string;
  faceDown?: boolean;
  highlight?: boolean;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  if (faceDown || !tile) return <MahjongTile faceDown w={w} onClick={onClick} />;
  if (tile.kind < 27) {
    const suit = SUITS[Math.floor(tile.kind / 9)];
    return (
      <MahjongTile
        tile={{ id: tile.id, suit, rank: (tile.kind % 9) + 1 }}
        w={w}
        highlight={highlight}
        selected={selected}
        className={className}
        onClick={onClick}
      />
    );
  }
  const cls = [
    'mjtile',
    'hl-honor',
    tile.kind >= 31 ? `is-dragon is-d${tile.kind - 30}` : 'is-wind',
    selected ? 'is-selected' : '',
    highlight ? 'is-highlight' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      style={{ '--w': w ?? 'var(--tw)' } as CSSProperties}
      role="img"
      aria-label={KIND_NAME[tile.kind]}
      onClick={onClick}
    >
      <span className="hl-honor__txt">{KIND_NAME[tile.kind]}</span>
    </div>
  );
}

/**
 * 碰牌标记：把来源方向的那张翻成背面，一眼看出碰的是谁。
 * 下家（出牌顺序下一位）翻最右，对家翻中间，上家翻最左；加杠后标记保留。
 */
function pengFlipIndex(m: hl.HlMeld, owner: number): number {
  const from = m.type === 'pung' ? m.from : m.kongType === 'ba' ? m.pengFrom : null;
  if (from === null) return -1;
  const rel = (from - owner + 4) % 4;
  return rel === 1 ? m.tiles.length - 1 : rel === 2 ? 1 : rel === 3 ? 0 : -1;
}

function Melds({ melds, w, owner }: { melds: hl.HlMeld[]; w: string; owner: number }) {
  if (!melds.length) return null;
  return (
    <div className="sc-melds">
      {melds.map((m, i) => {
        const flip = pengFlipIndex(m, owner);
        const title =
          m.type === 'kong'
            ? m.kongType === 'an'
              ? '暗杠'
              : m.kongType === 'ba'
                ? '加杠'
                : `明杠${m.from === null ? '' : ` ←${WIND[m.from]}`}`
            : `碰${m.from === null ? '' : ` ←${WIND[m.from]}`}`;
        return (
          <div key={i} className={`sc-meld ${m.kongType === 'an' ? 'is-an' : ''}`} title={title}>
            {m.tiles.map((t, k) => (
              <HlTileView key={t.id} tile={t} w={w} faceDown={k === flip} />
            ))}
            {m.kongType === 'an' && <span className="sc-meld__tag">暗</span>}
          </div>
        );
      })}
    </div>
  );
}

function River({
  river,
  pos,
  lastId,
}: {
  river: hl.HlRiverTile[];
  pos: 'top' | 'bottom' | 'left' | 'right';
  lastId: number | null;
}) {
  return (
    <div className={`sc-river is-${pos}`}>
      {river.map((r) => (
        <HlTileView
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

export default function HeluoBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const pos = (s: number) => (['bottom', 'right', 'top', 'left'] as const)[(s - me + 4) % 4];
  const seatAt = (p: 'right' | 'top' | 'left') => (me + { right: 1, top: 2, left: 3 }[p]) % 4;
  const L = spectator ? null : v.legal;
  const mine = v.players[me];
  const [sel, setSel] = useState<number[]>([]);
  const [rootRef, width] = useWidth<HTMLDivElement>();

  const phaseKey = `${v.round}-${v.phase}-${mine.handCount}-${v.drawn}`;
  useEffect(() => setSel([]), [phaseKey]);

  const myTurn =
    !!L &&
    (L.discard.length > 0 || L.hu || L.gang.length > 0 || L.peng || L.pass) &&
    v.phase === 'play';
  useTurnCue(!!L && myTurn);

  // 手牌：摸到的牌单独放在最右
  const drawnTile = v.drawn !== null ? (v.hand.find((t) => t.id === v.drawn) ?? null) : null;
  const handMain = drawnTile ? v.hand.filter((t) => t.id !== drawnTile.id) : v.hand;

  // 牌宽：根据宽度与张数计算
  const meldTiles = mine.melds.reduce((a, m) => a + m.tiles.length, 0);
  const units =
    v.hand.length + (drawnTile ? 0.6 : 0) + meldTiles * 0.78 + mine.melds.length * 0.3 + 0.8;
  const maxByHeight = typeof window !== 'undefined' ? Math.min(64, window.innerHeight * 0.1) : 56;
  const tw = Math.max(22, Math.min(maxByHeight, (width - 24) / Math.max(units, 8)));

  // 事件：碰 / 杠 / 次 的大字提示、音效与语音
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
      if (e.type === 'ci' || e.type === 'pici' || e.type === 'zimo')
        playSound(e.seat === me ? 'win' : 'chip');
      else playSound(e.type === 'gang' ? 'bomb' : 'select');
      window.setTimeout(() => speak(text), 450);
    }
  }, [v.events, me]);

  // 次牌亮相动画：进入牌桌及每盘开始时弹出一次
  const [ciReveal, setCiReveal] = useState<number | null>(null);
  useEffect(() => {
    if (v.phase !== 'play' || !v.ciTile) return;
    setCiReveal(v.round);
    playSound('deal');
    const t1 = window.setTimeout(() => speak(`次牌，${KIND_NAME[v.ciKind]}`), 300);
    const t2 = window.setTimeout(() => setCiReveal(null), 2400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.round]);

  // 进入包次区：弹一次提醒（每盘一次）
  const [baoReveal, setBaoReveal] = useState(false);
  const baoShown = useRef(-1);
  useEffect(() => {
    if (v.phase !== 'play' || !v.baoActive || baoShown.current === v.round) return;
    baoShown.current = v.round;
    setBaoReveal(true);
    playSound('deal');
    speak('进入包次区');
    const t = window.setTimeout(() => setBaoReveal(false), 2400);
    return () => {
      window.clearTimeout(t);
      setBaoReveal(false);
    };
  }, [v.baoActive, v.round, v.phase]);

  // 报牌
  const spoken = useRef('');
  useEffect(() => {
    if (!v.lastDiscard) return;
    const key = `${v.round}-${v.lastDiscard.id}`;
    if (spoken.current === key) return;
    spoken.current = key;
    speak(KIND_NAME[Math.floor(v.lastDiscard.id / 4)] ?? '');
  }, [v.lastDiscard, v.round]);

  const act = (a: hl.HlAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    else setSel([]);
  };

  // 打次牌前二次确认
  const [confirmCi, setConfirmCi] = useState<number | null>(null);
  useEffect(() => setConfirmCi(null), [phaseKey]);
  const discard = (id: number) => {
    const t = v.hand.find((x) => x.id === id);
    if (t && t.kind === v.ciKind) setConfirmCi(id);
    else act({ type: 'discard', tile: id });
  };

  const onTile = (t: Tile) => {
    if (!L || !L.discard.includes(t.id)) return;
    if (sel[0] === t.id) discard(t.id);
    else {
      setSel([t.id]);
      playSound('select');
    }
  };

  const renderHandTile = (t: Tile) => {
    const locked = L && L.discard.length > 0 && !L.discard.includes(t.id);
    return (
      <div
        key={t.id}
        className={`sc-handtile ${t.kind === v.ciKind ? 'is-ci' : ''} ${locked ? 'is-locked' : ''}`}
        onClick={() => onTile(t)}
      >
        <HlTileView tile={t} selected={sel.includes(t.id)} />
        {t.kind === v.ciKind && <span className="hl-ci-mark">次</span>}
      </div>
    );
  };

  const seatBlock = (s: number) => {
    const p = v.players[s];
    const where = pos(s);
    return (
      <div className={`sc-seat is-${where} ${p.won ? 'is-won' : ''}`}>
        <Seat
          player={ctl.players[s]}
          active={v.turn === s && !v.window && v.phase === 'play' && !p.won}
          deadline={ctl.deadlines[s]}
          size={54}
          layout={where === 'top' ? 'row' : 'column'}
          tag={s === v.dealer ? '庄' : undefined}
          sub={<span className="num">{v.scores[s]}</span>}
        />
        {p.won && <span className="sc-wonbadge">{WIN_NAME[p.won.kind]}</span>}
        <div className="sc-oppo">
          <Melds melds={p.melds} w="var(--rw)" owner={s} />
          <div className="sc-backs">
            {p.hand
              ? p.hand.map((t) => <HlTileView key={t.id} tile={t} w="var(--rw)" />)
              : Array.from({ length: p.handCount }, (_, i) => (
                  <HlTileView key={i} faceDown w="calc(var(--rw) * 0.86)" />
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
    <div className="sc hl" ref={rootRef} style={{ '--tw': `${tw}px` } as CSSProperties}>
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>
      <div className="sc-info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b>
          {v.options.rounds ? ` / ${v.options.rounds}` : ''} 盘
        </span>
        <span className="chip hl-ci-chip">
          次牌 <HlTileView tile={v.ciTile} w="calc(var(--rw) * 0.9)" />
        </span>
        {v.baoActive && <span className="chip is-gold">已进入包次区</span>}
        <span className="chip">{v.options.mode === 'hard' ? '硬次' : '软次'}</span>
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

      <div className="sc-act">
        <div className="sc-me">
          <Seat
            player={ctl.players[me]}
            active={myTurn}
            deadline={ctl.deadlines[me]}
            size={48}
            layout="row"
            tag={me === v.dealer ? '庄' : undefined}
            sub={<span className="num">{v.scores[me]}</span>}
          />
        </div>
        <div className="sc-actions">
          {L && v.phase === 'play' && v.window && (
            <div className="action-bar">
              <span className="action-hint">
                {ctl.players[v.window.source].name} 打出
                <HlTileView tile={v.window.tile} w="calc(var(--rw) * 1.1)" />
              </span>
              {L.gang.length > 0 && (
                <Button
                  variant={L.gang[0].ci ? 'felt-primary' : 'felt'}
                  onClick={() => act({ type: 'gang' })}
                >
                  {L.gang[0].ci ? '杠次' : '杠'}
                </Button>
              )}
              {L.peng && (
                <Button variant="felt" onClick={() => act({ type: 'peng' })}>
                  碰
                </Button>
              )}
              {L.pass && (
                <Button variant="felt" onClick={() => act({ type: 'pass' })}>
                  过
                </Button>
              )}
            </div>
          )}
          {L && v.phase === 'play' && !v.window && (
            <div className="action-bar">
              {L.gang.map((g) => (
                <Button
                  key={g.tile}
                  variant={g.ci ? 'felt-primary' : 'felt'}
                  onClick={() => act({ type: 'gang', tile: g.tile })}
                >
                  {g.ci ? (g.type === 'an' ? '暗次' : '加杠次') : g.type === 'an' ? '暗杠' : '加杠'}{' '}
                  {KIND_NAME[v.hand.find((t) => t.id === g.tile)?.kind ?? 0]}
                </Button>
              ))}
              {L.pici && (
                <Button variant="felt-primary" onClick={() => act({ type: 'pici' })}>
                  屁次
                </Button>
              )}
              {L.hu && (
                <Button variant="felt-primary" onClick={() => act({ type: 'hu' })}>
                  自摸
                </Button>
              )}
              {L.discard.length > 0 && (
                <Button
                  variant="felt-primary"
                  disabled={!(sel.length === 1 && L.discard.includes(sel[0]))}
                  onClick={() => discard(sel[0])}
                >
                  出牌
                </Button>
              )}
            </div>
          )}
          {!L?.discard.length &&
            !L?.pass &&
            !spectator &&
            v.phase !== 'roundOver' &&
            v.phase !== 'matchOver' && (
              <div className="action-hint">
                {mine.won
                  ? `你已${WIN_NAME[mine.won.kind]}`
                  : v.window
                    ? '等待其他玩家表态…'
                    : `等待 ${ctl.players[v.turn ?? 0]?.name} 出牌`}
              </div>
            )}
        </div>
      </div>

      <div className="sc-hand">
        {!spectator && (
          <>
            <Melds melds={mine.melds} w="calc(var(--tw) * 0.78)" owner={me} />
            <div className="sc-hand__tiles">{handMain.map(renderHandTile)}</div>
            {drawnTile && <div className="sc-hand__drawn">{renderHandTile(drawnTile)}</div>}
          </>
        )}
        {spectator && <div className="action-hint">观战中</div>}
      </div>

      {ciReveal !== null && v.ciTile && (
        <div
          className="hl-reveal"
          onClick={() => setCiReveal(null)}
          role="dialog"
          aria-label="本盘次牌"
        >
          <div className="hl-reveal__card">
            <div className="hl-reveal__rays" />
            <div className="hl-reveal__tile">
              <HlTileView tile={v.ciTile} w="clamp(64px, 14vmin, 120px)" />
            </div>
            <div className="hl-reveal__title">本盘次牌</div>
            <div className="hl-reveal__name">{KIND_NAME[v.ciKind]}</div>
          </div>
        </div>
      )}

      {baoReveal && ciReveal === null && (
        <div
          className="hl-reveal"
          onClick={() => setBaoReveal(false)}
          role="dialog"
          aria-label="进入包次区"
        >
          <div className="hl-reveal__card">
            <div className="hl-reveal__rays is-bao" />
            <div className="hl-reveal__tile">
              <div className="hl-bao-badge">包</div>
            </div>
            <div className="hl-reveal__title">进入包次区</div>
            <div className="hl-reveal__name">打生张小心被杠次</div>
          </div>
        </div>
      )}

      {confirmCi !== null && (
        <Sheet
          open
          onClose={() => setConfirmCi(null)}
          title="此为次牌，请确认打出"
          footer={
            <>
              <Button onClick={() => setConfirmCi(null)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const id = confirmCi;
                  setConfirmCi(null);
                  act({ type: 'discard', tile: id });
                }}
              >
                确认打出
              </Button>
            </>
          }
        >
          <div className="hl-confirm">
            <HlTileView tile={v.hand.find((t) => t.id === confirmCi)} w="56px" />
            <p>打出次牌后，自己就少了一张次牌，也可能让别人拿去碰杠。</p>
          </div>
        </Sheet>
      )}

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
  v: hl.HlView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const matchOver = v.phase === 'matchOver';
  const readyCount = v.ready.filter(Boolean).length;
  const order = matchOver ? [0, 1, 2, 3].sort((a, b) => v.scores[b] - v.scores[a]) : [0, 1, 2, 3];
  const title = matchOver
    ? order[0] === me && !spectator
      ? '本场第一'
      : '本场结束'
    : r.reason === 'wall'
      ? '荒庄（庄家不换，杠分作废）'
      : r.win!.seat === me && !spectator
        ? WIN_NAME[r.win!.kind]
        : '本盘结束';
  const won = r.win?.seat === me || (matchOver && order[0] === me);

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
        <div className={`result__title ${won ? 'is-win' : 'is-lose'}`}>{title}</div>
        <div className="result__sub">
          第 {r.round} 盘{r.win ? ` · ${ctl.players[r.win.seat].name} ${WIN_NAME[r.win.kind]}` : ''}
          {!matchOver && ` · 下一盘 ${ctl.players[r.nextDealer].name} 坐庄`}
        </div>
        <table className="result__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>本盘</th>
              <th className="num">杠分</th>
              <th className="num">得分</th>
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
                <td>
                  {r.win?.seat === s ? (
                    <span className="mini-tag">{WIN_NAME[r.win.kind]}</span>
                  ) : r.win?.from === s ? (
                    <span className="mini-tag is-plain">
                      {r.win.kind === 'baoci' ? '包次' : '点杠'}
                    </span>
                  ) : null}
                </td>
                <td className="num">
                  {r.gangCounted ? signed(r.gangDeltas[s]) : <s>{signed(r.gangDeltas[s])}</s>}
                </td>
                <td className={`num ${r.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                  {signed(r.deltas[s])}
                </td>
                <td className="num">{v.scores[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sc-res-hands">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className="sc-res-hand">
              <span>{ctl.players[s].name}</span>
              <div>
                {v.players[s].melds
                  .flatMap((m) => m.tiles)
                  .map((t) => (
                    <HlTileView key={t.id} tile={t} w="var(--rw)" />
                  ))}
                {v.players[s].melds.length > 0 && <i className="sc-gap" />}
                {r.hands[s].map((t) => (
                  <HlTileView key={t.id} tile={t} w="var(--rw)" />
                ))}
                {r.win?.seat === s && r.win.tile && r.win.kind !== 'zimo' && (
                  <>
                    <i className="sc-gap" />
                    <HlTileView tile={r.win.tile} w="var(--rw)" highlight />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
