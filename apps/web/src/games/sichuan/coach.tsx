import type { mj as MJ, sc as SC } from '@park/engine';
import { mj, sc } from '@park/engine';
import { ChevronDown, ChevronUp, GraduationCap, MessageCircle, Send, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MahjongTile } from '../../components/MahjongTile';
import { askCoach, coachLlmReady, explainWithLlm } from '../../lib/coach/llm';
import '../shared/coach.css';

/**
 * 麻将导师面板：玩家需要时打开，随时可以收起或关闭。
 * 只给建议、讲原因，不替玩家出牌；点候选可以把那张牌选中。
 */

const RULES =
  '规则：成都血战到底，108 张只有万、条、筒；不能吃；开局换三张、定缺一门，缺门打完才能胡；' +
  '一家胡了其余继续，三家胡或摸完牌墙结束；流局时没听牌要赔听牌的人（查大叫），还拿着缺门赔最高番（查花猪）。';

const kindTile = (k: number): MJ.Tile => ({
  id: -k - 1,
  suit: mj.kindSuit(k),
  rank: mj.kindRank(k),
});

const TONE_ICON: Record<SC.ScCoachTone, string> = { best: '✓', good: '✓', warn: '!', bad: '✕' };

function verdictTone(c: SC.ScCoach): string {
  if (c.advice.action === 'hu') return 'is-best';
  if (c.stage === 'wait' || c.stage === 'won') return 'is-ok';
  if (c.defense || c.options[0]?.note === '缺门') return 'is-warn';
  return 'is-hint';
}

function optionText(o: SC.ScDiscardOption): string {
  if (o.note === '缺门') return '缺门，先打掉';
  if (o.shanten === 0 && o.waits.length) {
    const live = o.waits.reduce((a, w) => a + w.left, 0);
    return `听 ${o.waits.map((w) => mj.kindName(w.kind)).join(' ')} · 剩 ${live} 张`;
  }
  return `${o.note ? `${o.note} ` : ''}${sc.shantenName(o.shanten)} · 进 ${o.ukeire} 张`;
}

/** 第二行：胡牌率、胡了平均多少分（精算后加上模拟平均分） */
function optionSub(o: SC.ScDiscardOption): string {
  if (o.note === '缺门') return `放炮风险约 ${o.risk.toFixed(1)} 分`;
  const parts = [`胡牌率 ${Math.round(o.pWin * 100)}%`, `胡了约 ${o.value.toFixed(1)} 分`];
  if (o.fold) parts.unshift('先保守');
  if (o.mc) parts.push(`精算 ${o.mc.mean >= 0 ? '+' : ''}${o.mc.mean.toFixed(1)} 分`);
  return parts.join(' · ');
}

export function MahjongCoach({
  view,
  coach,
  mcBusy,
  judge,
  selected,
  onPick,
  onClose,
}: {
  view: SC.ScView;
  coach: SC.ScCoach;
  /** 后台精算还在算 */
  mcBusy?: boolean;
  judge: SC.ScCoachJudge | null;
  selected: readonly number[];
  onPick: (tile: number) => void;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const llmOn = coachLlmReady();
  const [llm, setLlm] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; text: string }>({
    status: 'idle',
    text: '',
  });
  const [chat, setChat] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState('');
  const token = useRef(0);

  // 手牌或要做的决定变了，讲解和追问重新开始
  const situation = `${view.round}-${coach.stage}-${view.hand.map((t) => t.id).join(',')}-${view.window?.tile?.id ?? ''}`;
  useEffect(() => {
    token.current++;
    setLlm({ status: 'idle', text: '' });
    setChat([]);
    setAsking(false);
  }, [situation]);

  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && (chat.length || llm.status === 'done')) el.scrollTop = el.scrollHeight;
  }, [chat.length, llm.status, asking]);

  const facts = () => coach.facts + (judge ? `学生选中了一张牌，导师的评价：${judge.text}。` : '');

  const explain = () => {
    const my = ++token.current;
    setLlm({ status: 'loading', text: '' });
    explainWithLlm('sichuan', RULES, facts())
      .then((text) => token.current === my && setLlm({ status: 'done', text }))
      .catch(() => token.current === my && setLlm({ status: 'error', text: '' }));
  };
  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    const my = token.current;
    setAsking(true);
    askCoach('sichuan', RULES, facts(), chat, text)
      .then((a) => {
        if (token.current !== my) return;
        setAsking(false);
        setChat((c) => [...c, { q: text, a }]);
      })
      .catch(() => {
        if (token.current !== my) return;
        setAsking(false);
        setChat((c) => [...c, { q: text, a: '（大模型没有回应，稍后再试）' }]);
      });
  };

  // 只剩缺门可打时，候选都是「缺门」，不用列出来
  const showOptions =
    coach.stage === 'discard' && coach.options.length > 1 && coach.options[0].note !== '缺门';
  const top = coach.options.slice(0, 4);
  const selKind =
    selected.length === 1
      ? (() => {
          const t = view.hand.find((x) => x.id === selected[0]);
          return t ? mj.kindOf(t) : null;
        })()
      : null;
  const extra =
    selKind !== null && !top.some((o) => o.kind === selKind)
      ? coach.options.find((o) => o.kind === selKind)
      : undefined;
  const rows = extra ? [...top, extra] : top;
  const adviceTiles =
    coach.advice.action === 'discard' ||
    coach.advice.action === 'exchange' ||
    coach.advice.action === 'gang'
      ? coach.advice.tiles
      : [];

  return (
    <section className={`coach sc-coach ${collapsed ? 'is-collapsed' : ''}`} aria-label="导师">
      <header className="coach__head">
        <GraduationCap size={16} />
        <b>导师</b>
        {collapsed ? (
          <span className="sc-coach__mini">{coach.title || coach.status}</span>
        ) : (
          coach.status && <span className="coach__src">{coach.status}</span>
        )}
        {coach.mode === 'mc' ? (
          <span className="sc-coach__mc" title="已在后台模拟几百局，按模拟的平均得分修正了排序">
            精算
          </span>
        ) : (
          mcBusy && (
            <span className="sc-coach__mc is-busy" title="正在后台模拟，算完会修正建议">
              精算中
            </span>
          )
        )}
        <button
          type="button"
          className="coach__x sc-coach__fold"
          onClick={() => setCollapsed((x) => !x)}
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button type="button" className="coach__x" onClick={onClose} title="关闭导师">
          <X size={14} />
        </button>
      </header>

      {!collapsed && (
        <>
          <div className="coach__body" ref={body}>
            {coach.stage === 'none' ? (
              <p className="coach__lead is-dim">这一盘结束了，下一盘开始后我再帮你看。</p>
            ) : (
              <>
                {coach.title && (
                  <div className={`coach__verdict sc-coach__verdict ${verdictTone(coach)}`}>
                    <span>{coach.title}</span>
                    {adviceTiles.length > 0 && (
                      <span className="sc-coach__tiles">
                        {adviceTiles.map((id) => (
                          <MahjongTile key={id} tile={mj.tileOf(id)} w="20px" />
                        ))}
                      </span>
                    )}
                  </div>
                )}
                {judge && (
                  <p className={`sc-coach__judge is-${judge.tone}`}>
                    <i>{TONE_ICON[judge.tone]}</i>
                    {judge.text}
                  </p>
                )}
                {coach.points.length > 0 && (
                  <ul className="coach__points">
                    {coach.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {showOptions && (
                  <div className="sc-coach__opts" role="list" aria-label="候选出牌">
                    {rows.map((o, i) => (
                      <button
                        key={o.kind}
                        type="button"
                        role="listitem"
                        className={`sc-coach__opt ${i === 0 ? 'is-rec' : ''} ${o.kind === selKind ? 'is-sel' : ''}`}
                        onClick={() => onPick(o.tile)}
                        title="点一下选中这张牌"
                      >
                        <MahjongTile tile={kindTile(o.kind)} w="20px" />
                        <span>
                          {optionText(o)}
                          <small>{optionSub(o)}</small>
                        </span>
                        {coach.showDanger && o.note !== '缺门' && (
                          <em className={`sc-coach__danger is-${o.danger}`}>
                            {sc.DANGER_NAME[o.danger]}
                          </em>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {coach.tips.map((t) => (
                  <p key={t} className="coach__warn">
                    ⚠ {t}
                  </p>
                ))}
                {llm.status === 'loading' && (
                  <p className="coach__llm is-loading">
                    <span className="coach__dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    导师正在组织语言…
                  </p>
                )}
                {llm.status === 'done' && <p className="coach__llm">{llm.text}</p>}
                {llm.status === 'error' && <p className="coach__warn">大模型没有回应，稍后再试</p>}
                {chat.map((c, i) => (
                  <div key={i} className="coach__qa">
                    <p className="coach__q">{c.q}</p>
                    <p className="coach__a">{c.a}</p>
                  </div>
                ))}
              </>
            )}
          </div>
          {llmOn && coach.stage !== 'none' && (
            <footer className="coach__foot">
              {llm.status === 'idle' && (
                <button type="button" className="sc-coach__explain" onClick={explain}>
                  <MessageCircle size={13} /> 让导师用大白话讲讲
                </button>
              )}
              <form
                className="coach__ask"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(q);
                  setQ('');
                }}
              >
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={asking ? '导师正在回答…' : '有不懂的，问问导师'}
                  disabled={asking}
                  maxLength={120}
                />
                <button type="submit" disabled={asking || !q.trim()} aria-label="发送">
                  <Send size={14} />
                </button>
              </form>
            </footer>
          )}
        </>
      )}
    </section>
  );
}
