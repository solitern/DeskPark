import type { Card } from '@park/engine';
import { Rng, xyj } from '@park/engine';
import { RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CardRow, Hand } from '../../components/Hand';
import { PlayingCard } from '../../components/PlayingCard';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';
import { playSound } from '../../lib/sound';
import { settings } from '../../lib/store';
import { CountChip, MoveZone, useHintCycle, useSelection, useTurnCue } from '../shared/trick';
import './xiyouji.css';

type Ctl = GameController<xyj.XyjView, xyj.XyjAction>;

/** 用系统语音报牌（跟随「音效」开关） */
function speak(text: string) {
  if (!text || !settings.get().sound) return;
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang === 'zh-CN') ?? voices.find((v) => v.lang.startsWith('zh'));
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (voice) u.voice = voice;
    synth.speak(u);
  } catch {
    // 语音不可用时静默
  }
}

const isWild = (c: Card) => c.suit === 'J';
const rankName = (r: number) => xyj.XYJ_NAME[r] ?? '';

export default function XiyoujiBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const players = ctl.players;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const right = (me + 1) % 4;
  const top = (me + 2) % 4;
  const left = (me + 3) % 4;

  const over = v.phase === 'roundOver' || v.phase === 'matchOver';
  const playing = v.phase === 'play';
  const myTurn = !spectator && playing && v.turn === me;
  const leading = playing && v.top === null;

  const [sel, setSel] = useSelection(v.hand, v.round);
  const [declare, setDeclare] = useState(false);
  useTurnCue(myTurn);

  // 提示候选：领出时先给电脑建议；跟牌时少用王、不拆牌的在前
  const candidates = useMemo(() => {
    if (!myTurn) return [] as number[][];
    const opts = xyj.playOptions(v.hand, leading ? null : v.count, leading ? null : v.top!.rank);
    opts.sort((a, b) => a.wilds - b.wilds || b.cards.length - a.cards.length);
    const list = opts.filter((o) => o.wilds < o.cards.length).map((o) => o.cards);
    const a = ctl.def.bot(v, me, new Rng(7)) as xyj.XyjAction;
    if (a.type === 'play') list.unshift(a.cards);
    const seen = new Set<string>();
    return list.filter((ids) => {
      const k = [...ids].sort((x, y) => x - y).join(',');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.version, myTurn]);
  const canBeat = useMemo(
    () => (myTurn && !leading ? xyj.playOptions(v.hand, v.count, v.top!.rank).length > 0 : true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctl.version, myTurn],
  );
  const nextHint = useHintCycle(candidates, `${ctl.version}`);

  const selected = v.hand.filter((c) => sel.has(c.id));
  const allWild = selected.length > 0 && selected.every(isWild);
  const rank = myTurn && selected.length && !allWild ? xyj.resolvePlay(selected) : null;
  const countOk = leading || selected.length === v.count;
  const playable =
    myTurn &&
    selected.length > 0 &&
    selected.length <= 8 &&
    countOk &&
    (allWild || (rank !== null && (leading || xyj.beats(rank, v.top!.rank))));
  // 全王时可选的点数
  const wildRanks = xyj.XYJ_RANKS.filter((r) => leading || (v.top && xyj.beats(r, v.top.rank)));

  // 语音报牌
  const lastSeq = useRef(0);
  useEffect(() => {
    const e = v.event;
    if (!e || e.seq === lastSeq.current) return;
    const first = lastSeq.current === 0;
    lastSeq.current = e.seq;
    if (first && e.kind !== 'lead') return;
    if (e.kind === 'play') speak(xyj.callOut(e.rank!, e.count!));
    else if (e.kind === 'pass') speak('不要');
    else if (e.kind === 'lead' && v.flip) {
      speak(
        `翻到${rankName(v.flip.card.rank) || '万能牌'}，${players[v.flip.seat]?.name ?? ''}坐庄`,
      );
    }
  }, [v.event, v.flip, players]);

  const resultRound = useRef(0);
  useEffect(() => {
    const r = v.result;
    if (!r || resultRound.current === r.round || spectator) return;
    resultRound.current = r.round;
    playSound(r.winner === me ? 'win' : 'lose');
  }, [v.result, me, spectator]);

  const act = (a: xyj.XyjAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    return !err;
  };
  const doPlay = (as?: number) => {
    if (act({ type: 'play', cards: [...sel], ...(as !== undefined ? { as } : {}) })) {
      setSel(new Set());
      setDeclare(false);
    }
  };
  const onPlay = () => {
    if (allWild) setDeclare(true);
    else doPlay();
  };
  const doPass = () => {
    if (act({ type: 'pass' })) setSel(new Set());
  };

  const moveOf = (s: number) => (playing ? v.lastMoves[s] : null);
  const moveTag = (s: number) => {
    const m = moveOf(s);
    return m && m.type === 'play' && m.cards.every(isWild) ? (
      <span className="xyj__as">当 {rankName(m.rank)}</span>
    ) : null;
  };

  const seatEl = (s: number, side: 'left' | 'right' | 'top') => (
    <Seat
      player={players[s]}
      active={v.turn === s && playing}
      deadline={ctl.deadlines[s]}
      tag={s === v.dealer ? '庄' : undefined}
      tagTone="gold"
      sub={
        <span className="xyj__sub">
          <CountChip n={v.handCounts[s]} warnAt={3} />
          <em>{v.scores[s]}</em>
        </span>
      }
      layout={side === 'top' ? 'row' : 'column'}
    />
  );

  const showFlip = playing && v.flip && v.lastMoves.every((m) => !m) && v.top === null;
  const pickedLabel = allWild
    ? `万能牌 ×${selected.length}`
    : rank !== null
      ? xyj.callOut(rank, selected.length)
      : '';

  return (
    <div className="xyj">
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>
      <div className="xyj__info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b> 盘{v.options.rounds ? ` / ${v.options.rounds}` : ''}
        </span>
        <span className="chip is-gold">
          庄 <b>{players[v.dealer]?.name}</b>
        </span>
        {playing && v.count !== null && (
          <span className="chip">
            本轮 <b className="num">{v.count}</b> 张
          </span>
        )}
        <span className="chip xyj__law">师傅 › 徒弟 › 妖怪 › 师傅</span>
      </div>

      <div className="xyj__seat is-left">{seatEl(left, 'left')}</div>
      <div className="xyj__seat is-right">{seatEl(right, 'right')}</div>

      <div className="xyj__center">
        <div className="xyj__top">{seatEl(top, 'top')}</div>
        {(
          [
            [top, 'top'],
            [left, 'left'],
            [right, 'right'],
            [me, 'bottom'],
          ] as const
        ).map(([s, from]) => (
          <div key={from} className={`xyj__zone is-${from === 'bottom' ? 'me' : from}`}>
            <MoveZone move={moveOf(s)} from={from} passText="不要" />
            {moveTag(s)}
          </div>
        ))}
        {showFlip && v.flip && (
          <div className="xyj__flip">
            <span>翻牌定庄</span>
            <PlayingCard card={v.flip.card} w="var(--cw-sm, 52px)" />
            <span>
              <b>{players[v.flip.seat]?.name}</b> 坐庄先出
            </span>
          </div>
        )}
      </div>

      <div className="xyj__me">
        <div className="xyj__myseat">
          <Seat
            player={players[me]}
            active={myTurn}
            deadline={ctl.deadlines[me]}
            tag={me === v.dealer ? '庄' : undefined}
            tagTone="gold"
            layout="row"
            size={52}
            sub={<span className="xyj__score">积分 {v.scores[me]}</span>}
          />
        </div>
        {myTurn && (
          <div className="action-bar">
            {!leading && !canBeat ? (
              <Button variant="felt-primary" onClick={doPass}>
                要不起
              </Button>
            ) : (
              <>
                {!leading && (
                  <Button variant="felt" onClick={doPass}>
                    不要
                  </Button>
                )}
                <Button
                  variant="felt"
                  onClick={() => {
                    const h = nextHint();
                    if (h) setSel(new Set(h));
                    else toast('没有能压过的牌');
                  }}
                >
                  提示
                </Button>
                <Button variant="felt-primary" disabled={!playable} onClick={onPlay}>
                  出牌
                </Button>
                {pickedLabel && <span className="pattern-tag">{pickedLabel}</span>}
              </>
            )}
          </div>
        )}
        {!myTurn && playing && !spectator && v.turn !== null && (
          <div className="action-hint">
            等待 <b>{players[v.turn]?.name}</b> 出牌
          </div>
        )}
        {spectator && <div className="action-hint spectate">观战中</div>}
      </div>

      <div className="xyj__hand">
        {!spectator && (
          <Hand
            cards={v.hand}
            selected={sel}
            onChange={playing ? setSel : undefined}
            disabled={!playing}
            dealKey={v.round}
          />
        )}
      </div>

      <Sheet
        open={declare && allWild && myTurn}
        onClose={() => setDeclare(false)}
        title="万能牌当作"
        subtitle={`出 ${selected.length} 张万能牌，选择它们代表的点数`}
      >
        <div className="xyj-declare">
          {xyj.XYJ_RANKS.map((r) => {
            const ok = wildRanks.includes(r);
            return (
              <button
                key={r}
                type="button"
                className="xyj-declare__btn"
                disabled={!ok}
                onClick={() => doPlay(r)}
              >
                <b>{rankName(r)}</b>
                <small>{r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : r}</small>
              </button>
            );
          })}
        </div>
      </Sheet>

      {over && v.result && <RoundResult ctl={ctl} v={v} me={me} spectator={spectator} />}
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
  v: xyj.XyjView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const matchOver = v.phase === 'matchOver';
  const readyCount = v.ready.filter(Boolean).length;
  const ranking = matchOver ? [0, 1, 2, 3].sort((a, b) => v.scores[b] - v.scores[a]) : [0, 1, 2, 3];
  const win = r.winner === me;
  const title = matchOver
    ? ranking[0] === me && !spectator
      ? '本场冠军'
      : '本场结束'
    : spectator
      ? `${ctl.players[r.winner].name} 先出完`
      : win
        ? '先出完了'
        : r.losers.includes(me)
          ? '手牌最多'
          : '本盘结束';

  return (
    <Sheet
      open
      dismissible={false}
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
          className={`result__title ${win || (matchOver && ranking[0] === me) ? 'is-win' : 'is-lose'}`}
        >
          {title}
        </div>
        <div className="result__sub">
          第 {r.round} 盘 · {ctl.players[r.winner].name} 先出完，下盘坐庄
        </div>
        <table className="result__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th className="num">剩牌</th>
              <th className="num">本盘</th>
              <th className="num">总分</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((s) => (
              <tr key={s} className={s === me && !spectator ? 'is-me' : ''}>
                <td>
                  <span className="result__who">
                    <Avatar name={ctl.players[s].name} avatar={ctl.players[s].avatar} size={26} />
                    {ctl.players[s].name}
                    {s === r.winner && <span className="mini-tag">出完</span>}
                    {r.losers.includes(s) && <span className="mini-tag is-plain">最多</span>}
                  </span>
                </td>
                <td className="num">{r.left[s]}</td>
                <td
                  className={`num ${r.deltas[s] > 0 ? 'delta-pos' : r.deltas[s] < 0 ? 'delta-neg' : ''}`}
                >
                  {r.deltas[s] === 0 ? '0' : signed(r.deltas[s])}
                </td>
                <td className="num">{v.scores[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="result__hands">
          {[0, 1, 2, 3]
            .filter((s) => s !== me && r.hands[s].length > 0)
            .map((s) => (
              <div className="result__hand" key={s}>
                <span>{ctl.players[s].name}</span>
                <CardRow cards={r.hands[s]} w="var(--cw-xs)" overlap={0.5} />
              </div>
            ))}
        </div>
      </div>
    </Sheet>
  );
}
