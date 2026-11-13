import { sz } from '@park/engine';
import type { GameController } from '../../lib/controller';
import { signed } from '../../lib/format';

type Ctl = GameController<sz.SzView, sz.SzAction>;
type HistoryRound = sz.SzState['history'][number];

const SEATS = [0, 1, 2, 3];

/**
 * 计分面板：当前筹码、本盘待结算、每一局的流水与账目。
 * 数据全部来自 view（`chips` / `pending` / `history`），不额外请求。
 */
export function ScorePanel({ ctl, v }: { ctl: Ctl; v: sz.SzView }) {
  const me = ctl.seat;
  const name = (s: number) => ctl.players[s]?.name ?? `${s + 1} 号位`;
  const clause = (c: string) => sz.CLAUSE_NAME[c as sz.Clause] ?? c;
  const settled = !!v.sessionResult;
  // 盘末 pending 已经真正加减进筹码，不再作为「待结算」展示
  const pending = settled ? [] : v.pending;
  const pendingNet = SEATS.map(
    (s) =>
      pending.filter((e) => e.to === s).reduce((a, e) => a + e.actual, 0) -
      pending.filter((e) => e.from === s).reduce((a, e) => a + e.actual, 0),
  );
  const rounds = v.history.filter((h) => h.session === v.session);
  const settledPending = settled ? v.sessionResult!.pending : v.pending;

  const resultText = (h: HistoryRound) => {
    if (h.reason === 'wall') return '荒庄';
    return h.wins
      .map((w) => {
        const how = w.robbing ? '抢杠' : w.selfDrawn ? '自摸' : '胡';
        const patterns = (w.patterns ?? []).map((id) => sz.FAN_NAME[id]).filter(Boolean);
        return `${name(w.seat)} ${how}${patterns.length ? ` · ${patterns.join(' · ')}` : ''} · ${w.fan} 番`;
      })
      .join('；');
  };

  return (
    <div className="sz-score">
      <div className="sz-score__meta">
        <span>
          第 <b className="num">{v.session}</b>
          {v.options.sessions ? ` / ${v.options.sessions}` : ''} 盘
        </span>
        <span>
          第 <b className="num">{v.round}</b> 局
        </span>
        <span>
          庄家 <b>{name(v.dealer)}</b>（底分 <b className="num">{v.dealerBase}</b>）
        </span>
        {v.jokerKind !== null && (
          <span>
            财神 <b>{sz.kindName(v.jokerKind)}</b>
          </span>
        )}
      </div>

      <div className="sz-score__section">
        <h3>筹码</h3>
        <table className="result__table sz-score__table">
          <thead>
            <tr>
              <th>玩家</th>
              <th className="num">筹码</th>
              <th className="num">本盘</th>
              {pending.length > 0 && <th className="num">待结算</th>}
            </tr>
          </thead>
          <tbody>
            {SEATS.map((s) => {
              const delta = settled ? v.sessionResult!.deltas[s] : v.chips[s] - sz.START_CHIPS;
              return (
                <tr key={s} className={s === me ? 'is-me' : ''}>
                  <td>
                    <span className="result__who">
                      {name(s)}
                      {s === v.dealer && <span className="mini-tag">庄·{v.dealerBase}</span>}
                      {s === me && <span className="mini-tag is-plain">我</span>}
                    </span>
                  </td>
                  <td className="num">{v.chips[s]}</td>
                  <td className={`num ${delta >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                    {signed(delta)}
                  </td>
                  {pending.length > 0 && (
                    <td
                      className={`num ${pendingNet[s] === 0 ? '' : pendingNet[s] > 0 ? 'delta-pos' : 'delta-neg'}`}
                    >
                      {pendingNet[s] === 0 ? '—' : signed(pendingNet[s])}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sz-score__section">
        <h3>
          {settled ? '本盘结算（已入账）' : '本盘待结算'}
          <span className="sz-score__sum">
            {settledPending.length > 0
              ? `共 ${settledPending.reduce((a, e) => a + e.actual, 0)}`
              : ''}
          </span>
        </h3>
        {settledPending.length === 0 ? (
          <p className="sz-score__empty">
            {settled ? '本盘没有抢杠 / 三清待结算。' : '暂无（抢杠承包、三清会在盘末结算）。'}
          </p>
        ) : (
          <ul className="sz-score__list">
            {settledPending.map((e, i) => (
              <li key={i}>
                <span>{clause(e.clause)}</span>
                <span>
                  {name(e.from)} → {name(e.to)}
                </span>
                <b className="num">{e.due}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sz-score__section">
        <h3>每局流水</h3>
        {rounds.length === 0 && v.phase === 'play' && (
          <p className="sz-score__empty">本盘还没有打完的局。</p>
        )}
        <div className="sz-score__rounds">
          {rounds.map((h) => (
            <div key={`${h.session}-${h.round}`} className="sz-score__round">
              <div className="sz-score__roundhead">
                <b>第 {h.round} 局</b>
                <span className="sz-score__result">{resultText(h)}</span>
              </div>
              <div className="sz-score__deltas">
                {SEATS.map((s) => (
                  <span key={s} className={h.deltas[s] >= 0 ? 'delta-pos' : 'delta-neg'}>
                    <small>{name(s)}</small>
                    <b className="num">{signed(h.deltas[s])}</b>
                  </span>
                ))}
              </div>
              {((h.ledger?.length ?? 0) > 0 || (h.pending?.length ?? 0) > 0) && (
                <details className="sz-score__detail">
                  <summary>
                    账目 {h.ledger?.length ?? 0} 笔
                    {h.pending?.length ? ` · 待结算 ${h.pending.length} 笔` : ''}
                  </summary>
                  <ul className="sz-score__list">
                    {(h.ledger ?? []).map((e, i) => (
                      <li key={`l${i}`}>
                        <span>{clause(e.clause)}</span>
                        <span>
                          {name(e.from)} → {name(e.to)}
                        </span>
                        <b className="num">
                          {e.due}
                          {e.actual !== e.due ? `（实付 ${e.actual}）` : ''}
                        </b>
                      </li>
                    ))}
                    {(h.pending ?? []).map((e, i) => (
                      <li key={`p${i}`} className="is-pending">
                        <span>待结算 · {clause(e.clause)}</span>
                        <span>
                          {name(e.from)} → {name(e.to)}
                        </span>
                        <b className="num">{e.due}</b>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
          {v.phase === 'play' && (
            <div className="sz-score__round is-live">
              <div className="sz-score__roundhead">
                <b>第 {v.round} 局</b>
                <span className="sz-score__result">进行中</span>
              </div>
              <p className="sz-score__empty">胡牌 / 荒庄后才入账。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
