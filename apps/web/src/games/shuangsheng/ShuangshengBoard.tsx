import { Rng, SUIT_SYMBOL, sh } from '@park/engine';
import { RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { CardRow, Hand } from '../../components/Hand';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { playSound } from '../../lib/sound';
import { CountChip, MoveZone, useSelection, useTurnCue } from '../shared/trick';
import './shuangsheng.css';
import { useShuangshengVoice } from './voice';

type Ctl = GameController<sh.SsView, sh.SsAction>;

const lv = (n: number) => sh.LEVEL_LABEL(n);

function trumpText(v: sh.SsView): string {
  if (!v.decl) return '未定';
  if (v.decl.suit === null) return v.decl.fallback ? '无主' : sh.STRENGTH_NAME[v.decl.strength];
  return `${SUIT_SYMBOL[v.decl.suit]} ${sh.STRENGTH_NAME[v.decl.strength]}`;
}

export default function ShuangshengBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const players = ctl.players;
  const spectator = ctl.seat === null;
  const me = ctl.seat ?? 0;
  const right = (me + 1) % 4;
  const top = (me + 2) % 4;
  const left = (me + 3) % 4;
  const myTeam = sh.teamOf(me);
  const ctx: sh.SsCtx = { level: v.level, trump: v.decl ? v.decl.suit : null };

  const over = v.phase === 'roundOver' || v.phase === 'matchOver';
  const playing = v.phase === 'play';
  const myTurn = !spectator && playing && v.waiting === me;
  const myBury = !spectator && v.phase === 'bury' && v.burier === me;
  const myChoice = !spectator && (v.phase === 'declare' || v.phase === 'fan') && v.waiting === me;
  const canDeclare = !spectator && v.declOptions.length > 0;

  const [sel, setSel] = useSelection(v.hand, `${v.round}-${v.phase}-${v.burier}`);
  useTurnCue(myTurn || myBury || myChoice);
  useShuangshengVoice(v, players);

  const act = (a: sh.SsAction) => {
    const err = ctl.act(a);
    if (err) toast(err, 'error');
    return !err;
  };

  const resultRound = useRef(0);
  useEffect(() => {
    const r = v.result;
    if (!r || resultRound.current === r.round || spectator) return;
    resultRound.current = r.round;
    const winTeam = r.side === 'dealer' ? r.dealerTeam : 1 - r.dealerTeam;
    playSound(winTeam === myTeam ? 'win' : 'lose');
  }, [v.result, myTeam, spectator]);

  const selected = v.hand.filter((c) => sel.has(c.id));
  const lead = v.trick?.plays[0]?.cards ?? null;
  const playError = useMemo(() => {
    if (!myTurn) return null;
    if (!selected.length) return '';
    return lead ? sh.followError(v.hand, lead, selected, ctx) : sh.leadError(selected, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, sel, ctl.version]);
  const throwing = myTurn && !lead && !playError && sh.isThrow(selected, ctx);

  const hint = () => {
    const a = ctl.def.bot(v, me, new Rng(ctl.version + 7)) as sh.SsAction;
    if (a.type === 'play' || a.type === 'bury') setSel(new Set(a.cards));
  };

  const fromBottom = useMemo(() => new Set(v.fromBottom), [v.fromBottom]);

  const trickMove = (s: number) => {
    const p = v.trick?.plays.find((x) => x.seat === s);
    return p ? { type: 'play' as const, cards: p.cards } : null;
  };

  const bubbleOf = (s: number) => {
    if (v.throwFail && v.throwFail.seat === s && playing) return '甩牌失败';
    if (v.phase === 'trickEnd' && v.trick?.winner === s)
      return v.trick.points ? `最大 · ${v.trick.points} 分` : '最大';
    if ((v.phase === 'declare' || v.phase === 'fan') && v.waiting === s)
      return v.phase === 'fan' ? '考虑反主' : '考虑亮主';
    if (v.phase === 'bury' && v.burier === s) return '扣底中';
    return undefined;
  };

  const tagOf = (s: number) => (v.dealer === s ? '庄' : undefined);

  const seatEl = (s: number, side: 'left' | 'right' | 'top') => (
    <Seat
      player={players[s]}
      active={v.waiting === s && (playing || v.phase === 'bury' || myChoiceFor(v, s))}
      deadline={ctl.deadlines[s]}
      tag={tagOf(s)}
      sub={<CountChip n={v.handCounts[s]} warnAt={0} />}
      layout={side === 'top' ? 'row' : 'column'}
      bubble={bubbleOf(s)}
      bubbleSide={side === 'left' ? 'right' : side === 'right' ? 'left' : 'bottom'}
      className={sh.teamOf(s) === myTeam ? 'is-ally' : ''}
    />
  );

  const dealerName = v.dealer !== null ? players[v.dealer]?.name : null;
  const showDeclBox =
    v.phase === 'deal' ||
    v.phase === 'declare' ||
    v.phase === 'flip' ||
    v.phase === 'bury' ||
    v.phase === 'fan' ||
    (playing && !!v.trick && v.trick.plays.length === 0 && !v.lastTrick);

  return (
    <div className="sj">
      <div className="rotate-tip">
        <RotateCw size={12} /> 横屏体验更佳
      </div>
      <div className="sj__info info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b> 局
        </span>
        <span className="chip is-gold">
          打 <b>{lv(v.level)}</b>
        </span>
        <span className={`chip ${v.trumpKnown ? 'is-gold' : ''}`}>
          主 <b>{trumpText(v)}</b>
        </span>
        {dealerName && (
          <span className="chip">
            庄 <b>{dealerName}</b>
          </span>
        )}
        <span className="chip">
          闲家得分 <b className="num">{v.points}</b>
        </span>
        <span className={`chip ${v.dealerTeam === myTeam ? 'is-gold' : ''}`}>
          {spectator ? '南北' : '我方'} <b>{lv(v.levels[myTeam])}</b>
        </span>
        <span className={`chip ${v.dealerTeam !== myTeam ? 'is-gold' : ''}`}>
          {spectator ? '东西' : '对方'} <b>{lv(v.levels[1 - myTeam])}</b>
        </span>
      </div>

      <div className="sj__seat is-left">{seatEl(left, 'left')}</div>
      <div className="sj__seat is-right">{seatEl(right, 'right')}</div>

      <div className="sj__center">
        <div className="sj__top">{seatEl(top, 'top')}</div>
        <div className="sj__zone is-top">
          <MoveZone move={trickMove(top)} from="top" />
        </div>
        <div className="sj__zone is-left">
          <MoveZone move={trickMove(left)} from="left" />
        </div>
        <div className="sj__zone is-right">
          <MoveZone move={trickMove(right)} from="right" />
        </div>
        <div className="sj__zone is-me">
          <MoveZone move={trickMove(me)} from="bottom" />
        </div>
        {showDeclBox && <DeclBox v={v} players={players} />}
        {playing && v.throwFail && (
          <div className="sj-throw">
            <span>{players[v.throwFail.seat]?.name} 甩牌失败，只能出最小的一组</span>
            <CardRow cards={v.throwFail.tried} w="var(--cw-xs)" overlap={0.5} />
          </div>
        )}
      </div>

      <div className="sj__me">
        <div className="sj__myseat">
          <Seat
            player={players[me]}
            active={myTurn || myBury || myChoice}
            deadline={ctl.deadlines[me]}
            tag={tagOf(me)}
            layout="row"
            size={52}
            sub={<CountChip n={v.handCounts[me]} warnAt={0} />}
          />
        </div>

        {canDeclare && (
          <div className="action-bar">
            <span className="action-hint">
              {v.phase === 'fan' ? '可以反主' : v.phase === 'deal' ? '可以亮主' : '轮到你亮主'}
            </span>
            {v.declOptions.map((o, i) => (
              <Button
                key={i}
                variant="felt-primary"
                onClick={() => act({ type: 'declare', cards: o.cards.map((c) => c.id) })}
              >
                {v.phase === 'fan' ? '反' : '亮'} {sh.declLabel(o)}
              </Button>
            ))}
            <Button variant="felt" onClick={() => act({ type: 'pass' })}>
              {v.phase === 'fan' ? '不反' : '不亮'}
            </Button>
          </div>
        )}

        {myBury && (
          <div className="action-bar">
            <span className="action-hint">
              选择 <b>8</b> 张牌扣底（已选 {selected.length}）
            </span>
            <Button variant="felt" onClick={hint}>
              提示
            </Button>
            <Button
              variant="felt-primary"
              disabled={selected.length !== 8}
              onClick={() => act({ type: 'bury', cards: [...sel] }) && setSel(new Set())}
            >
              扣底
            </Button>
          </div>
        )}

        {myTurn && (
          <div className="action-bar">
            <Button variant="felt" onClick={hint}>
              提示
            </Button>
            <Button
              variant="felt-primary"
              disabled={playError !== null}
              onClick={() => act({ type: 'play', cards: [...sel] }) && setSel(new Set())}
            >
              出牌
            </Button>
            {throwing && <span className="pattern-tag">甩牌</span>}
            {playError && <span className="action-hint">{playError}</span>}
          </div>
        )}

        {!myTurn && !myBury && !canDeclare && !spectator && !over && (
          <div className="action-hint">{waitingText(v, players)}</div>
        )}
      </div>

      <div className="sj__hand">
        {!spectator && (
          <Hand
            cards={v.hand}
            selected={sel}
            onChange={myTurn || myBury ? setSel : playing ? setSel : undefined}
            highlight={fromBottom}
            dealKey={v.round}
          />
        )}
      </div>

      {over && v.result && <RoundResult ctl={ctl} v={v} me={me} spectator={spectator} />}
    </div>
  );
}

function myChoiceFor(v: sh.SsView, s: number) {
  return (v.phase === 'declare' || v.phase === 'fan') && v.waiting === s;
}

function waitingText(v: sh.SsView, players: { name: string }[]): string {
  const name = (s: number | null) => (s === null ? '' : (players[s]?.name ?? ''));
  switch (v.phase) {
    case 'deal':
      return `发牌中 ${v.dealt}/100${v.round === 1 && !v.decl ? '，可随时亮主' : ''}`;
    case 'declare':
      return `等待 ${name(v.waiting)} 亮主`;
    case 'flip':
      return '无人亮主，翻底定主…';
    case 'bury':
      return `等待 ${name(v.burier)} 扣底`;
    case 'fan':
      return `等待 ${name(v.waiting)} 决定是否反主`;
    case 'play':
      return `等待 ${name(v.waiting)} 出牌`;
    case 'trickEnd':
      return v.trick?.winner != null ? `${name(v.trick.winner)} 这一墩最大` : '';
    default:
      return '';
  }
}

function DeclBox({ v, players }: { v: sh.SsView; players: { name: string }[] }) {
  const d = v.decl;
  if (!d && !v.flipped.length) {
    if (v.phase !== 'deal' && v.phase !== 'declare') return null;
    return (
      <div className="sj-decl">
        <span className="sj-decl__title">
          {v.phase === 'deal' ? `发牌中 ${v.dealt}/100` : '亮主中'}
        </span>
        <span className="sj-decl__sub">级牌 + 同色王亮主：♠♣ 配小王，♥♦ 配大王</span>
      </div>
    );
  }
  return (
    <div className="sj-decl">
      {d && (
        <span className="sj-decl__title">
          {d.fallback
            ? `翻完底牌未定主，${players[d.seat]?.name} 坐庄打无主`
            : d.flip
              ? `翻底定主：${trumpText(v)}，${players[d.seat]?.name} 坐庄`
              : `${players[d.seat]?.name} ${v.dealer !== null && v.dealer !== d.seat ? '反' : '亮'}主：${trumpText(v)}`}
        </span>
      )}
      {d && !d.flip && d.cards.length > 0 && (
        <CardRow cards={d.cards} w="var(--cw-xs)" overlap={0.3} />
      )}
      {v.flipped.length > 0 && (
        <>
          <span className="sj-decl__sub">翻出的底牌</span>
          <CardRow cards={v.flipped} w="var(--cw-xs)" overlap={0.3} />
        </>
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
  v: sh.SsView;
  me: number;
  spectator: boolean;
}) {
  const r = v.result!;
  const myTeam = sh.teamOf(me);
  const matchOver = v.phase === 'matchOver';
  const winTeam = r.side === 'dealer' ? r.dealerTeam : 1 - r.dealerTeam;
  const win = winTeam === myTeam;
  const readyCount = v.ready.filter(Boolean).length;
  const teamName = (t: number) =>
    spectator ? (t === 0 ? '南北' : '东西') : t === myTeam ? '我方' : '对方';
  const title = matchOver
    ? spectator
      ? `${teamName(winTeam)}获胜`
      : win
        ? '打过 A，赢得整场'
        : '对方打过 A'
    : r.side === 'dealer'
      ? `${teamName(r.dealerTeam)}守庄`
      : `${teamName(1 - r.dealerTeam)}上台`;
  const sub = r.matchWon
    ? '赢得整场'
    : r.up > 0
      ? `${teamName(winTeam)}升 ${r.up} 级`
      : `${teamName(winTeam)}上台，不升级`;

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
            {v.ready[me] ? `等待其他玩家 ${readyCount}/4` : '继续下一局'}
          </Button>
        )
      }
    >
      <div className="result">
        <div className={`result__title ${win || spectator ? 'is-win' : 'is-lose'}`}>{title}</div>
        <div className="result__sub">
          第 {r.round} 局 · 打 {lv(r.level)} · 庄家 {ctl.players[r.dealer]?.name} · {sub}
        </div>
        <div className="sj-score">
          <div>
            <span>闲家得分</span>
            <b className="num">{r.defenderPoints}</b>
          </div>
          <div>
            <span>底牌分</span>
            <b>
              {r.bottomPoints}
              {r.scored && r.bottomPoints > 0
                ? ` × ${r.multiplier}（抠底）`
                : r.scored
                  ? ''
                  : '（庄方守底）'}
            </b>
          </div>
        </div>
        <div className="sj-bottom">
          <span>底牌</span>
          <CardRow cards={r.bottom} w="var(--cw-xs)" overlap={0.4} />
        </div>
        <div className="sj-levels">
          {[myTeam, 1 - myTeam].map((t) => (
            <div key={t}>
              <span>
                <Avatar
                  name={ctl.players[t === myTeam ? me : (me + 1) % 4].name}
                  avatar={ctl.players[t === myTeam ? me : (me + 1) % 4].avatar}
                  size={22}
                />
                {teamName(t)}
              </span>
              <b>
                {lv(r.levelsBefore[t])}
                {r.levelsAfter[t] !== r.levelsBefore[t] && <> → {lv(r.levelsAfter[t])}</>}
              </b>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
