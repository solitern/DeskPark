import type { mj as MJ } from '@park/engine';
import { Rng, mj, sc } from '@park/engine';
import { GraduationCap, RotateCw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MahjongTile, SuitBadge } from '../../components/MahjongTile';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { settings } from '../../lib/store';
import { useTurnCue } from '../shared/trick';
import { cancelMahjongMc, mahjongMc } from '../../lib/coach/mahjong';
import { MahjongCoach } from './coach';
import './sichuan.css';

type Ctl = GameController<sc.ScView, sc.ScAction>;
type Tile = MJ.Tile;

const WIND = ['东', '南', '西', '北'];
const SUIT_CN: Record<MJ.MjSuit, string> = { wan: '万', tiao: '条', tong: '筒' };
const DIR_TEXT: Record<sc.ExchangeDir, string> = {
  next: '换给下家',
  prev: '换给上家',
  across: '换给对家',
};
const EVENT_TEXT: Record<string, string> = {
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

function Melds({ melds, w }: { melds: sc.ScMeld[]; w: string }) {
  if (!melds.length) return null;
  return (
    <div className="sc-melds">
      {melds.map((m, i) => (
        <div
          key={i}
          className={`sc-meld ${m.kongType === 'an' ? 'is-an' : ''}`}
          title={m.kongType === 'an' ? '暗杠' : undefined}
        >
          {m.tiles.map((t) => (
            <MahjongTile key={t.id} tile={t} w={w} />
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
  river: sc.RiverTile[];
  pos: 'top' | 'bottom' | 'left' | 'right';
  lastId: number | null;
}) {
  return (
    <div className={`sc-river is-${pos}`}>
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

export default function SichuanBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const pos = (s: number) => (['bottom', 'right', 'top', 'left'] as const)[(s - me + 4) % 4];
  const seatAt = (p: 'right' | 'top' | 'left') => (me + { right: 1, top: 2, left: 3 }[p]) % 4;
  const L = spectator ? null : v.legal;
  const mine = v.players[me];
  const que = mine.que;
  const [sel, setSel] = useState<number[]>([]);
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const actRef = useRef<HTMLDivElement>(null);

  // 导师：需要时打开，随时可以关；只用自己看得到的信息
  const { mjCoach, mjCoachMc } = settings.use();
  const coachOpen = mjCoach && !spectator;
  const fast = useMemo(
    () => (coachOpen ? sc.coachSichuan(v) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctl.version, coachOpen],
  );
  // 精算：快速建议先出来，后台模拟算完再修正（前几名候选 + 玩家选中的牌）
  const mcTiles = useMemo(() => {
    if (!fast || !mjCoachMc || fast.stage !== 'discard' || fast.advice.action !== 'discard')
      return null;
    if (fast.options.length < 2 || fast.options[0].note === '缺门') return null;
    const tiles = fast.options.slice(0, 4).map((o) => o.tile);
    const picked = sel.length === 1 ? v.hand.find((t) => t.id === sel[0]) : undefined;
    if (picked && !fast.options.slice(0, 4).some((o) => o.kind === mj.kindOf(picked))) {
      const o = fast.options.find((x) => x.kind === mj.kindOf(picked));
      if (o) tiles.push(o.tile);
    }
    return tiles;
  }, [fast, mjCoachMc, sel, v.hand]);
  const mcKey = mcTiles ? `${ctl.version}:${mcTiles.join(',')}` : null;
  const [mc, setMc] = useState<{ key: string; stats: Record<number, sc.ScMcStat> } | null>(null);
  useEffect(() => {
    if (!mcKey || !mcTiles) {
      cancelMahjongMc();
      return;
    }
    let alive = true;
    mahjongMc(v, mcTiles)
      .then((stats) => alive && setMc({ key: mcKey, stats }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcKey]);
  useEffect(() => () => cancelMahjongMc(), []);
  const mcStats = mc && mcKey && mc.key === mcKey ? mc.stats : null;
  const coach = useMemo(
    () => (fast && mcStats ? sc.coachSichuan(v, { mc: { stats: mcStats } }) : fast),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fast, mcStats],
  );
  const mcBusy = !!mcKey && !mcStats;
  const judge = useMemo(() => (coach ? sc.coachSelected(v, coach, sel) : null), [coach, sel, v]);
  const coachTiles = new Set(
    coach && ['discard', 'exchange', 'gang'].includes(coach.advice.action ?? '')
      ? coach.advice.tiles
      : [],
  );
  // 导师面板停在操作栏上方
  useLayoutEffect(() => {
    const root = rootRef.current;
    const actEl = actRef.current;
    if (root && actEl)
      root.style.setProperty('--coach-bottom', `${root.clientHeight - actEl.offsetTop + 6}px`);
  });

  const phaseKey = `${v.round}-${v.phase}-${v.players[me].handCount}-${v.drawn}`;
  useEffect(() => setSel([]), [phaseKey]);

  const myTurn =
    !!L &&
    (L.discard.length > 0 || L.hu || L.gang.length > 0 || L.peng || L.pass) &&
    v.phase === 'play';
  useTurnCue(!!L && (myTurn || L.exchange || L.que));

  // 手牌：摸到的牌单独放在最右
  const drawnTile = v.drawn !== null ? (v.hand.find((t) => t.id === v.drawn) ?? null) : null;
  const handMain = drawnTile ? v.hand.filter((t) => t.id !== drawnTile.id) : v.hand;
  const hasQue = !!que && v.hand.some((t) => t.suit === que);

  // 牌宽：根据宽度与张数计算
  const meldTiles = mine.melds.reduce((a, m) => a + m.tiles.length, 0);
  const units =
    v.hand.length + (drawnTile ? 0.6 : 0) + meldTiles * 0.78 + mine.melds.length * 0.3 + 0.8;
  const maxByHeight = typeof window !== 'undefined' ? Math.min(64, window.innerHeight * 0.1) : 56;
  const tw = Math.max(22, Math.min(maxByHeight, (width - 24) / Math.max(units, 8)));

  // 事件：碰 / 杠 / 胡 的大字提示与音效
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

  // 听牌提示
  const meldCount = mine.melds.length;
  const waitsAfter = useMemo(() => {
    const map = new Map<number, number[]>();
    if (!L || L.discard.length === 0) return map;
    const counts = mj.countKinds(v.hand);
    for (const id of L.discard) {
      const t = v.hand.find((x) => x.id === id)!;
      const k = mj.kindOf(t);
      if (map.has(k)) continue;
      const rest = v.hand.filter((x) => x.id !== id);
      if (que && rest.some((x) => x.suit === que)) {
        map.set(k, []);
        continue;
      }
      counts[k]--;
      map.set(
        k,
        mj.waitingKinds(counts, meldCount, (kk) => mj.kindSuit(kk) !== que),
      );
      counts[k]++;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version]);
  const currentWaits = useMemo(() => {
    if (v.phase !== 'play' || mine.won || hasQue || v.hand.length % 3 !== 1) return [];
    return mj.waitingKinds(mj.countKinds(v.hand), meldCount, (k) => mj.kindSuit(k) !== que);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version]);
  const selectedTile = sel.length === 1 ? v.hand.find((t) => t.id === sel[0]) : undefined;
  const previewWaits = selectedTile
    ? (waitsAfter.get(mj.kindOf(selectedTile)) ?? [])
    : currentWaits;

  const act = (a: sc.ScAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    else setSel([]);
  };

  const onTile = (t: Tile) => {
    if (!L) return;
    if (L.exchange) {
      setSel((cur) => {
        if (cur.includes(t.id)) return cur.filter((x) => x !== t.id);
        const curSuit = cur.length ? v.hand.find((x) => x.id === cur[0])!.suit : null;
        if (curSuit && curSuit !== t.suit) return [t.id];
        return cur.length >= 3 ? cur : [...cur, t.id];
      });
      playSound('select');
      return;
    }
    if (L.discard.includes(t.id)) {
      if (sel[0] === t.id) act({ type: 'discard', tile: t.id });
      else {
        setSel([t.id]);
        playSound('select');
      }
    } else if (hasQue && t.suit !== que && L.discard.length) {
      toast('手上有缺门，先打缺门的牌');
    }
  };

  // 「推荐 / 提示」和导师的建议保持一致
  const recommend = () => {
    const c = coach ?? sc.coachSichuan(v);
    if (c.stage === 'exchange') setSel(c.advice.tiles);
    else if (c.stage === 'discard' && c.options[0]) setSel([c.options[0].tile]);
  };

  const queHint = useMemo(() => {
    if (!L?.que) return null;
    const a = ctl.def.bot(v, me, new Rng(1)) as sc.ScAction;
    return a.type === 'que' ? a.suit : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version, L?.que]);

  const exchangeReady =
    sel.length === 3 && new Set(sel.map((id) => v.hand.find((t) => t.id === id)?.suit)).size === 1;

  const tileClass = (t: Tile) => {
    const disabled = L && L.discard.length > 0 && !L.discard.includes(t.id);
    return disabled ? 'is-locked' : '';
  };

  const renderHandTile = (t: Tile) => {
    const k = mj.kindOf(t);
    const ting = (waitsAfter.get(k)?.length ?? 0) > 0 && L?.discard.includes(t.id);
    return (
      <div
        key={t.id}
        className={`sc-handtile ${ting ? 'is-ting' : ''} ${coachTiles.has(t.id) ? 'is-coach' : ''} ${tileClass(t)}`}
        onClick={() => onTile(t)}
      >
        <MahjongTile tile={t} selected={sel.includes(t.id)} que={t.suit === que} />
      </div>
    );
  };

  const scoreOf = (s: number) => v.scores[s] + v.roundDeltas[s];

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
          sub={
            v.phase === 'exchange' && p.exchangeChosen ? (
              <span className="sc-chosen">已选牌</span>
            ) : v.phase === 'dingque' && p.queChosen ? (
              <span className="sc-chosen">已定缺</span>
            ) : (
              <span className="num">{scoreOf(s)}</span>
            )
          }
        >
          {p.que && <SuitBadge suit={p.que} className="sc-que" />}
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
              ? p.hand.map((t) => <MahjongTile key={t.id} tile={t} w="var(--rw)" />)
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
    <div
      className={`sc ${coach ? 'has-coach' : ''}`}
      ref={rootRef}
      style={{ '--tw': `${tw}px` } as CSSProperties}
    >
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
        {(v.options.chips ?? 0) > 0 && (
          <span className="chip is-gold">
            筹码 <b className="num">{v.options.chips}</b>
          </span>
        )}
        {v.exchangeDir && v.phase === 'exchange' && (
          <span className="chip is-gold">
            <b>{DIR_TEXT[v.exchangeDir]}</b>
          </span>
        )}
        {!spectator && (
          <button
            type="button"
            className={`chip sc-coach-chip ${coachOpen ? 'is-on' : ''}`}
            onClick={() => settings.set({ mjCoach: !mjCoach })}
            aria-pressed={coachOpen}
            title={coachOpen ? '关闭导师' : '打开导师：帮你看看这一步怎么打、为什么'}
          >
            <GraduationCap size={14} />
            导师
          </button>
        )}
      </div>

      {coach && (
        <div className="sc-coach-dock">
          <MahjongCoach
            view={v}
            coach={coach}
            mcBusy={mcBusy}
            judge={judge}
            selected={sel}
            onPick={(id) => {
              if (L?.discard.includes(id)) {
                setSel([id]);
                playSound('select');
              }
            }}
            onClose={() => settings.set({ mjCoach: false })}
          />
        </div>
      )}

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
        {v.phase === 'dingque' && v.exchange && (
          <div className="sc-notice">
            <span>换入</span>
            {v.exchange.received.map((t) => (
              <MahjongTile key={t.id} tile={t} w="var(--rw)" />
            ))}
          </div>
        )}
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
          >
            {que && <SuitBadge suit={que} className="sc-que" />}
          </Seat>
        </div>
        <div className="sc-actions">
          {L?.exchange && (
            <div className="action-bar">
              <span className="action-hint">
                选三张同花色的牌 · <b>{DIR_TEXT[v.exchangeDir!]}</b>
              </span>
              <Button variant="felt" onClick={recommend}>
                推荐
              </Button>
              <Button
                variant="felt-primary"
                disabled={!exchangeReady}
                onClick={() => act({ type: 'exchange', tiles: sel })}
              >
                换牌
              </Button>
            </div>
          )}
          {L?.que && (
            <div className="action-bar">
              <span className="action-hint">选择定缺</span>
              {mj.MJ_SUITS.map((s) => {
                const n = v.hand.filter((t) => t.suit === s).length;
                const rec = queHint === s;
                return (
                  <Button
                    key={s}
                    variant={rec ? 'felt-primary' : 'felt'}
                    onClick={() => act({ type: 'que', suit: s })}
                  >
                    缺{SUIT_CN[s]} <small className="sc-count">{n}</small>
                  </Button>
                );
              })}
            </div>
          )}
          {L && v.phase === 'play' && v.window && (
            <div className="action-bar">
              {v.window.tile && (
                <span className="action-hint">
                  {ctl.players[v.window.source!].name} {v.window.kind === 'rob' ? '补杠' : '打出'}
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
              {L.pass && (
                <Button variant="felt" onClick={() => act({ type: 'pass' })}>
                  过
                </Button>
              )}
            </div>
          )}
          {L && v.phase === 'play' && !v.window && (
            <div className="action-bar">
              {L.mustHu && <span className="action-hint">牌墙只剩 4 张，能胡必须胡</span>}
              {L.hu && (
                <Button variant="felt-primary" onClick={() => act({ type: 'hu' })}>
                  {v.drawn === null && v.hand.length === 14 ? '天胡' : '自摸'}
                </Button>
              )}
              {L.gang.map((g) => {
                const t = mj.tileOf(g.tile);
                return (
                  <Button
                    key={g.tile}
                    variant="felt"
                    onClick={() => act({ type: 'gang', tile: g.tile })}
                  >
                    {g.type === 'an' ? '暗杠' : '补杠'} {t.rank}
                    {SUIT_CN[t.suit]}
                  </Button>
                );
              })}
              {L.discard.length > 0 && (
                <>
                  {hasQue && <span className="action-hint">先打缺门</span>}
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
              {mine.won
                ? `你已${mine.won.selfDrawn ? '自摸' : '胡牌'}（${mine.won.score.fanRaw} 番），观看其他玩家继续`
                : v.phase === 'exchange'
                  ? '等待其他玩家选牌…'
                  : v.phase === 'dingque'
                    ? '等待其他玩家定缺…'
                    : v.window
                      ? '等待其他玩家表态…'
                      : `等待 ${ctl.players[v.turn ?? 0]?.name} 出牌`}
            </div>
          )}
        </div>
        {previewWaits.length > 0 && v.phase === 'play' && !mine.won && (
          <div className="sc-ting">
            <span>{selectedTile ? '打出后听' : '听牌'}</span>
            {previewWaits.map((k) => {
              const left = Math.max(0, 4 - v.visible[k]);
              return (
                <span key={k} className={`sc-ting__tile ${left === 0 ? 'is-dead' : ''}`}>
                  <MahjongTile
                    tile={{ id: -k - 1, suit: mj.kindSuit(k), rank: mj.kindRank(k) }}
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
  v: sc.ScView;
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
        ? '流局'
        : '本盘结束';
  const winText = (w: sc.ScWin) =>
    w.score.items.map((it) => (it.id === 'gen' ? `根×${it.fan}` : sc.FAN_NAME[it.id])).join(' · ');
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
    if (r.huazhu.includes(s)) return <span className="mini-tag is-plain">花猪</span>;
    const t = r.ting.find((x) => x.seat === s);
    if (t) return <span className="mini-tag is-plain">听牌 · {mj.kindName(t.kind)}</span>;
    if (r.notReady.includes(s)) return <span className="mini-tag is-plain">未听</span>;
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
          第 {r.round} 盘 · {r.reason === 'three' ? '三家胡牌' : '牌墙摸完'}
          {matchOver && broke.length > 0
            ? ` · ${broke.map((s) => ctl.players[s].name).join('、')} 筹码输光，本场结束`
            : ` · 下一盘 ${ctl.players[r.nextDealer].name} 坐庄`}
        </div>
        <table className="result__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>本盘</th>
              <th className="num">得分</th>
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
              {[...clauseSum.keys()].map((c) => sc.CLAUSE_NAME[c as sc.Clause]).join('、')}）
            </summary>
            <ul>
              {r.ledger.map((e, i) => (
                <li key={i}>
                  <span>{sc.CLAUSE_NAME[e.clause]}</span>
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
                    <MahjongTile key={t.id} tile={t} w="var(--rw)" />
                  ))}
                {v.players[s].melds.length > 0 && <i className="sc-gap" />}
                {r.hands[s].map((t) => (
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
