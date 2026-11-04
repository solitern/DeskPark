import { cardLabel, dhd } from '@park/engine';
import { Hand } from '../../components/Hand';
import { PlayingCard } from '../../components/PlayingCard';
import { Avatar, Seat } from '../../components/Seat';
import { Button, Sheet, toast } from '../../components/ui';
import type { GameController } from '../../lib/controller';
import { useCompact, useSelection, useTurnCue } from '../shared/trick';
import './diaohongdian.css';

type Ctl = GameController<dhd.DhView, dhd.DhAction>;

/** 潮汕钓红点：出牌钓台面上的红牌，只有红牌计分。 */
export default function DiaohongdianBoard({ ctl }: { ctl: Ctl }) {
  const v = ctl.view!;
  const me = ctl.seat ?? 0;
  const spectator = ctl.seat === null;
  const others = ctl.players.map((_, s) => s).filter((s) => s !== me || spectator);
  const myTurn = !spectator && v.turn === me;
  const canPlay = myTurn && v.phase === 'play' && v.hand.length > 0;
  const canFlip = myTurn && (v.phase === 'flip' || (v.phase === 'play' && v.hand.length === 0));
  const canPick = myTurn && v.phase === 'pick' && !!v.pending;
  const [sel, setSel] = useSelection(v.hand, `${v.round}-${v.hand.length}`);
  useTurnCue(canPlay || canFlip || canPick);
  const compact = useCompact();

  const play = () => {
    const id = [...sel][0];
    if (id === undefined) return;
    const err = ctl.act({ type: 'play', card: id });
    if (err) toast(err, 'error');
    setSel(new Set());
  };

  const flip = () => {
    const err = ctl.act({ type: 'flip' });
    if (err) toast(err, 'error');
  };

  const pick = (id: number) => {
    const err = ctl.act({ type: 'pick', target: id });
    if (err) toast(err, 'error');
  };

  const seatEl = (s: number, side: 'top' | 'bottom' | 'left' | 'right' = 'top') => (
    <Seat
      player={ctl.players[s]}
      active={
        v.phase !== 'roundEnd' && v.phase !== 'matchOver' && v.turn === s && !ctl.players[s].isBot
      }
      size={compact ? 46 : 54}
      sub={
        <span className="num">
          {v.scores[s]} 分
          {v.pileScores[s] > 0 ? ` · 本局 ${v.pileScores[s]}` : ''}
        </span>
      }
      tag={v.turn === s && v.phase !== 'roundEnd' && v.phase !== 'matchOver' ? '钓' : undefined}
      bubbleSide={side}
    />
  );

  const lastText = () => {
    const last = v.last;
    if (!last) return '';
    const who = ctl.players[last.seat]?.name ?? '';
    if (last.captured.length === 2) {
      const [lead, target] = last.captured;
      const gain = dhd.cardPoints(lead, v.options.redAce) + dhd.cardPoints(target, v.options.redAce);
      const head = last.played ? `出 ${cardLabel(lead)}` : `翻到 ${cardLabel(lead)}`;
      return `${who} ${head}，钓走 ${cardLabel(target)}（这对红牌 ${gain} 分）`;
    }
    if (v.pending) {
      const head = v.pending.from === 'play' ? '出' : '翻到';
      return `${who} ${head} ${cardLabel(v.pending.card)}，可钓 ${v.pending.matches.length} 张，正在挑`;
    }
    if (last.flipped) return `${who} 翻出 ${cardLabel(last.flipped)}，配不上，留在台面`;
    if (last.played) return `${who} 出 ${cardLabel(last.played)}，配不上，留在台面`;
    return '';
  };

  const myMatches = canPick ? v.pending!.matches : [];
  const highlightIds = new Set(myMatches.map((c) => c.id));

  return (
    <div className="dh">
      <div className="info-chips top-info">
        <span className="chip">
          第 <b className="num">{v.round}</b> / {v.options.rounds} 局
        </span>
        <span className="chip">
          底牌 <b className="num">{v.stockCount}</b> 张
        </span>
        <span className="chip">红 A {v.options.redAce} 分</span>
        <span className="chip">{v.options.tableEnd === 'void' ? '残局作废' : '残局归最后钓牌者'}</span>
        {v.options.redFiveBonus && <span className="chip">红 5 对子 +10</span>}
      </div>

      <div className="dh__board">
        <div className="dh__opps">{others.map((s) => <div key={s}>{seatEl(s, 'bottom')}</div>)}</div>

        <div className="dh__middle">
          <div className="dh__table">
            <div className="dh__tablehead">
              <span>台面 {v.table.length} 张</span>
              {canPick && <span className="dh__hint">挑一张能配的牌钓走</span>}
            </div>
            <div className="dh__cards">
              {v.table.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`dh__slot ${highlightIds.has(c.id) ? 'is-match' : ''}`}
                  disabled={!highlightIds.has(c.id)}
                  onClick={() => pick(c.id)}
                  title={`${cardLabel(c)}（${dhd.cardPoints(c, v.options.redAce)} 分）`}
                >
                  <PlayingCard card={c} w={compact ? '34px' : 'min(7vw, 62px)'} />
                </button>
              ))}
              {v.table.length === 0 && <span className="dh__empty">台面空着，出牌只能往台面放</span>}
            </div>
          </div>

          <div className="dh__side">
            <div className="dh__stack">
              <PlayingCard faceDown w={compact ? '34px' : 'min(7vw, 62px)'} />
              <div className="dh__stacknum num">{v.stockCount}</div>
              <div className="dh__stackcap">底牌</div>
            </div>
            {v.pending && (
              <div className="dh__pending">
                <PlayingCard card={v.pending.card} w={compact ? '42px' : 'min(9vw, 78px)'} highlight />
                <div className="dh__pendingcap">待钓</div>
              </div>
            )}
          </div>
        </div>

        {lastText() && <div className="dh__last">{lastText()}</div>}
      </div>

      {!spectator && (
        <div className="dh__dock">
          <div className="dh__me">{seatEl(me, 'right')}</div>
          <div className="dh__hand">
            <div className="action-bar">
              {canPlay || canFlip ? (
                <Button
                  variant="felt-primary"
                  onClick={canPlay ? play : flip}
                  disabled={canPlay && sel.size === 0}
                >
                  {canPlay ? '钓这张' : '翻底牌'}
                </Button>
              ) : (
                <span className="action-hint">
                  {canPick
                    ? '点台面上高亮的牌钓走'
                    : v.phase === 'roundEnd' || v.phase === 'matchOver'
                      ? '本局结束'
                      : '等待其他玩家…'}
                </span>
              )}
            </div>
            <Hand
              cards={v.hand}
              selected={sel}
              onChange={canPlay ? setSel : undefined}
              single
              disabled={!canPlay}
              dealKey={v.round}
            />
          </div>
        </div>
      )}

      {v.phase === 'roundEnd' && v.lastRound && (
        <div className="dh__round">
          <div className="dh__roundtitle">第 {v.round} 局结算</div>
          {v.lastRound.gains.map((g, s) => (
            <div key={s} className={`dh__roundrow ${s === me && !spectator ? 'is-me' : ''}`}>
              <span>{ctl.players[s].name}</span>
              <span className="num">
                +{g} 分 <small>（累计 {v.scores[s]}）</small>
              </span>
            </div>
          ))}
          {v.lastRound.leftover.length > 0 && (
            <div className="dh__roundnote">
              台面还剩 {v.lastRound.leftover.length} 张
              {v.options.tableEnd === 'void' ? '，按房规作废' : '，已归最后钓牌的人'}
            </div>
          )}
        </div>
      )}

      {v.phase === 'matchOver' && (
        <Sheet
          open
          dismissible={false}
          footer={
            <>
              <Button onClick={() => ctl.leave()}>返回大厅</Button>
              {ctl.canRestart && (
                <Button variant="primary" onClick={() => ctl.restart()}>
                  再来一场
                </Button>
              )}
            </>
          }
        >
          <div className="result">
            <div className="result__title">
              {(() => {
                const best = Math.max(...v.scores);
                const winners = v.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
                return winners.length === 1
                  ? `${ctl.players[winners[0]].name} 获胜`
                  : `平局：${winners.map((i) => ctl.players[i].name).join('、')}`;
              })()}
            </div>
            <table className="result__table">
              <tbody>
                {ctl.players
                  .map((_, s) => s)
                  .sort((a, b) => v.scores[b] - v.scores[a])
                  .map((s) => (
                    <tr key={s} className={s === me && !spectator ? 'is-me' : ''}>
                      <td>
                        <span className="result__who">
                          <Avatar name={ctl.players[s].name} avatar={ctl.players[s].avatar} size={26} />
                          {ctl.players[s].name}
                        </span>
                      </td>
                      <td className="num">{v.scores[s]} 分</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="dh__roundnote">
              红 A 按 {v.options.redAce} 分；
              {v.options.tableEnd === 'void' ? '残局台面牌作废' : '残局台面牌归最后钓牌者'}
              {v.options.redFiveBonus ? '；红 5 对子每对 +10' : ''}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
