import { useEffect, useMemo, useState, type JSX } from 'react';
import type { ManagerProfile } from '../../engine/world/world.ts';
import {
  conferenceMatch,
  type AnswerCategory, type BodyLanguage, type ConferenceMatch, type InterviewKind, type InterviewOption, type InterviewQuestion,
  type InterviewSession,
} from '../../engine/world/interviews.ts';
import { VOICE_LABEL } from '../../engine/world/pressRoom.ts';
import { ClubCrest, Flag, managerPhotoUrl, PersonFace, PlayerFace } from '../components.tsx';
import { portraitUrl } from '../faces.ts';
import { Icon } from '../icons.tsx';
import { PRESS_MODELS, pressAiReady, type PressAiSettings } from '../pressWriter.ts';
import { useGame } from '../state.ts';

type Game = ReturnType<typeof useGame>;

/** The tones, as the press hear them before a match and after it — and what each tends to do. */
const TONE: Readonly<Record<InterviewKind, Record<AnswerCategory, { label: string; hint: string }>>> = {
  pre: {
    positive: { label: 'Positive', hint: 'Respectful · steadies the room' },
    neutral: { label: 'Neutral', hint: 'Measured · gives little away' },
    convince: { label: 'Convince', hint: 'Bold · fires up both dressing rooms' },
  },
  post: {
    positive: { label: 'Praise', hint: 'Lifts the dressing room' },
    neutral: { label: 'Measured', hint: 'Calm · no risk' },
    convince: { label: 'Demanding', hint: 'Sets the standard · can sting' },
  },
};

const TONES: readonly AnswerCategory[] = ['positive', 'neutral', 'convince'];

const MOOD: Readonly<Record<BodyLanguage, { label: string; level: number }>> = {
  hostile: { label: 'Hostile', level: 0 },
  skeptical: { label: 'Skeptical', level: 1 },
  neutral: { label: 'Neutral', level: 2 },
  pleased: { label: 'Pleased', level: 3 },
  encouraged: { label: 'Encouraged', level: 4 },
  delighted: { label: 'Delighted', level: 5 },
};

/** "after the 3-1 win over Skra" / "ahead of hosting Skra". */
function matchLine(session: InterviewSession, cm: ConferenceMatch): { lead: string; result: '' | 'won' | 'lost' } {
  if (session.kind === 'pre') return { lead: cm.home ? 'Ahead of hosting' : cm.neutral ? 'Ahead of facing' : 'Ahead of the trip to', result: '' };
  const won = cm.ownSets > cm.oppSets;
  return { lead: won ? 'After the win over' : 'After the defeat to', result: won ? 'won' : 'lost' };
}

/** A small badge for a side: a club's crest or a nation's flag. */
function SideMark({ g, club, nation, size = 22 }: { g: Game; club: number; nation: number; size?: number }): JSX.Element | null {
  const c = club >= 0 ? g.world!.clubs[club] : undefined;
  if (c !== undefined) return <ClubCrest club={c} size={size} />;
  return nation >= 0 ? <Flag nation={nation} /> : null;
}

/** The question appearing as it is asked — at once for anyone who'd rather no motion. */
function useReveal(text: string): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (still) { setShown(text); return; }
    let n = 0;
    const step = Math.max(2, Math.ceil(text.length / 38));
    setShown('');
    const id = window.setInterval(() => {
      n = Math.min(text.length, n + step);
      setShown(text.slice(0, n));
      if (n >= text.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [text]);
  return shown;
}

/** How far a journalist is warming to the manager: five bars. */
function MoodMeter({ mood }: { mood: BodyLanguage }): JSX.Element {
  const m = MOOD[mood];
  return (
    <span className={`press-mood mood-${mood}`} title={m.label}>
      <span className="press-mood-bars">
        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= m.level ? 'on' : ''} />)}
      </span>
      <span className="press-mood-label">{m.label}</span>
    </span>
  );
}

/** What an answer tends to do, as arrows: one to three up or down. */
function Effect({ label, value, theirs = false }: { label: string; value: number; theirs?: boolean }): JSX.Element | null {
  if (value === 0) return null;
  const n = Math.min(3, Math.max(1, Math.ceil(Math.abs(value) / 2)));
  // The other side's spirits going up is no good thing.
  const good = (value > 0) !== theirs;
  return (
    <span className={`press-effect ${good ? 'up' : 'down'}`}>
      {(value > 0 ? '▲' : '▼').repeat(n)} {label}
    </span>
  );
}

function OptionEffects({ g, o, kind }: { g: Game; o: InterviewOption; kind: InterviewKind }): JSX.Element {
  const store = g.world!.players;
  return (
    <span className="press-effects">
      <Effect label="Squad" value={o.ownMorale} />
      {kind === 'pre' && <Effect label="Opponents" value={o.opponentMorale} theirs />}
      {o.playerIdx !== undefined && o.playerMorale !== undefined && store.isActive(o.playerIdx) && (
        <Effect label={store.shortName(o.playerIdx)} value={o.playerMorale} />
      )}
    </span>
  );
}

/** The AI press setting: a key, a model, on or off — kept in this browser. */
function AiPanel({ g, onClose }: { g: Game; onClose: () => void }): JSX.Element {
  const [s, setS] = useState<PressAiSettings>(g.pressAi);
  return (
    <div className="press-ai-panel" role="dialog" aria-label="AI press settings">
      <div className="press-ai-head">
        <Icon name="spark" size={15} /> <b>AI press room</b>
        <span className="flex-spacer" />
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      <p className="press-ai-note">
        Claude writes every question and answer from what the press know — the box score, the table, what you said last time.
        What each tone does stays the game's.
      </p>
      <label className="press-ai-row">
        <input type="checkbox" checked={s.on} onChange={(e) => setS({ ...s, on: e.target.checked })} />
        <span>Write press conferences with AI</span>
      </label>
      <label className="press-ai-field">
        <span>Anthropic API key</span>
        <input type="password" value={s.key} placeholder="sk-ant-…" autoComplete="off" spellCheck={false}
          onChange={(e) => setS({ ...s, key: e.target.value })} />
      </label>
      <label className="press-ai-field">
        <span>Model</span>
        <select value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })}>
          {PRESS_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <p className="press-ai-note faint">
        The key is kept in this browser only and sent only to Anthropic. Each conference uses a little of your API credit.
        Without it, the game writes its own.
      </p>
      <div className="toolbar">
        <button className="primary" onClick={() => { g.setPressAi(s); onClose(); }}>Save</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** The conference's top bar: the occasion, the match, the room, how far through, the AI and the way out. */
function TopBar({ g, session, cm }: { g: Game; session: InterviewSession; cm: ConferenceMatch | null }): JSX.Element {
  const [aiOpen, setAiOpen] = useState(false);
  const own = g.world!.userClubId;
  const { lead, result } = cm !== null ? matchLine(session, cm) : { lead: '', result: '' as const };
  const ai = pressAiReady(g.pressAi);
  return (
    <div className="press-top">
      <span className={`press-occasion stakes-${session.stakes}`}>
        <Icon name={session.stakes === 'huge' ? 'trophy' : 'press'} size={13} /> {session.occasion}
      </span>
      {cm !== null && (
        <span className={`press-match ${result}`}>
          <span className="faint">{lead}</span>
          <SideMark g={g} club={cm.oppClub} nation={cm.oppNation} />
          <b>{cm.oppName}</b>
          {session.kind === 'post' && (
            <span className="press-score">
              <SideMark g={g} club={session.national !== undefined ? -1 : own} nation={session.national?.nation ?? -1} size={18} />
              {cm.ownSets}–{cm.oppSets}
            </span>
          )}
        </span>
      )}
      <span className="press-crowd" title={`${session.crowd} journalists in the room`}>
        <Icon name="squad" size={13} /> {session.crowd}
      </span>
      <span className="flex-spacer" />
      <span className="press-steps" aria-label={`Question ${Math.min(session.currentIndex + 1, session.questions.length)} of ${session.questions.length}`}>
        {session.questions.map((q, i) => (
          <span key={i} className={`press-step${i < session.currentIndex ? ` done mood-${q.bodyLanguage}` : i === session.currentIndex ? ' current' : ''}${q.followUp === true ? ' follow' : ''}`} />
        ))}
      </span>
      <div className="press-ai-wrap">
        <button className={`press-ai-btn${ai ? ' on' : ''}`} onClick={() => setAiOpen((v) => !v)} title="Write the press with AI">
          <Icon name="spark" size={13} /> {ai ? 'AI press' : 'AI off'}
        </button>
        {aiOpen && <AiPanel g={g} onClose={() => setAiOpen(false)} />}
      </div>
      <button onClick={() => g.closeInterview()}><Icon name="exit" size={14} /> Leave for now</button>
    </div>
  );
}

/** One exchange, once it's done: the question, what was said, how it landed. */
function Exchange({ q }: { q: InterviewQuestion }): JSX.Element {
  const o = q.answeredIndex !== null ? q.options[q.answeredIndex] : null;
  return (
    <li className={`press-x tone-${o?.category ?? 'none'}`}>
      <PersonFace photoUrl={portraitUrl(q.journalist.photoId, q.journalist.gender)} name={q.journalist.name} size={26} />
      <div className="press-x-body">
        <div className="press-x-q"><b>{q.journalist.name.split(' ')[0]}</b>{q.followUp === true ? <span className="press-tag">follow-up</span> : null} {q.prompt}</div>
        {o !== null && <div className="press-x-a">“{o.text}”</div>}
        {q.reaction !== undefined && <div className="press-x-r">{q.reaction}</div>}
      </div>
    </li>
  );
}

/**
 * The room: the press row, the journalist on the floor and the question, the room's reaction to
 * the last answer, what they have in their notebooks, and everything said so far.
 */
function Room({ g, session }: { g: Game; session: InterviewSession }): JSX.Element {
  const q = session.questions[session.currentIndex];
  const writing = g.pressWriting && q.written !== true && pressAiReady(g.pressAi);
  const shown = useReveal(writing ? '' : q.prompt);
  const store = g.world!.players;
  const about = q.options.find((o) => o.playerIdx !== undefined)?.playerIdx;
  const last = session.currentIndex > 0 ? session.questions[session.currentIndex - 1] : null;
  const done = session.questions.slice(0, session.currentIndex).filter((x) => x.answeredIndex !== null);
  const notes = (session.brief ?? []).slice(1);
  const fresh = done.length === 0;
  // The row: everyone who asks, once, in the order they ask.
  const row = useMemo(() => {
    const seen = new Map<string, { q: InterviewQuestion; at: number }>();
    session.questions.forEach((x, i) => {
      const was = seen.get(x.journalist.name);
      if (was === undefined || i <= session.currentIndex) seen.set(x.journalist.name, { q: x, at: i });
    });
    return [...seen.values()].sort((a, b) => a.at - b.at);
  }, [session, session.currentIndex, session.questions.length]);
  const others = Math.max(0, session.crowd - row.length);

  return (
    <section className="card press-room">
      <div className="press-row">
        {row.map(({ q: x }) => {
          const now = x.journalist.name === q.journalist.name;
          const asked = x.answeredIndex !== null;
          return (
            <span key={x.journalist.name} className={`press-seat${now ? ' now' : ''}${asked && !now ? ` asked mood-${x.bodyLanguage}` : ''}`} title={`${x.journalist.name} · ${x.journalist.outlet}`}>
              <PersonFace photoUrl={portraitUrl(x.journalist.photoId, x.journalist.gender)} name={x.journalist.name} size={now ? 34 : 28} />
            </span>
          );
        })}
        {others > 0 && <span className="press-more faint">+{others} more</span>}
      </div>

      <div className="press-floor">
        <PersonFace photoUrl={portraitUrl(q.journalist.photoId, q.journalist.gender)} name={q.journalist.name} size={64} />
        <div className="press-who">
          <div className="press-name">{q.journalist.name}</div>
          <div className="faint">{q.journalist.outlet}</div>
          {q.journalist.voice !== undefined && <span className="press-voice">{VOICE_LABEL[q.journalist.voice]}</span>}
        </div>
        <MoodMeter mood={q.bodyLanguage} />
      </div>

      {last?.reaction !== undefined && <div className="press-reaction" key={`r${session.currentIndex}`}>{last.reaction}</div>}

      <blockquote className={`press-question${writing ? ' writing' : ''}`} key={`q${session.currentIndex}`}>
        {writing
          ? <span className="press-typing">{q.journalist.name.split(' ')[0]} is finding the words<span className="dots"><i /><i /><i /></span></span>
          : <>{shown}<span className="press-caret" aria-hidden={shown.length >= q.prompt.length} /></>}
        {q.followUp === true && !writing && <span className="press-tag">follow-up</span>}
      </blockquote>
      {about !== undefined && store.isActive(about) && (
        <div className="press-about">
          <PlayerFace playerId={store.id[about]} name={store.fullName(about)} size={24} />
          <span><b>{store.fullName(about)}</b> will read what you say — praise lifts him, criticism stings.</span>
        </div>
      )}
      {g.pressError !== null && <div className="press-ai-error"><Icon name="alert" size={13} /> {g.pressError} The game wrote these instead.</div>}

      <div className={`press-lower${fresh ? ' fresh' : ''}`}>
        {notes.length > 0 && (
          <div className="press-notes">
            <div className="press-sub">In their notebooks</div>
            <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        <div className="press-transcript">
          <div className="press-sub">So far</div>
          {done.length === 0
            ? <p className="faint press-empty">The first question is on the floor.</p>
            : <ol>{[...done].reverse().map((x, i) => <Exchange key={i} q={x} />)}</ol>}
        </div>
      </div>
    </section>
  );
}

/** The manager's side: the answers, by tone, with what each tends to do. */
function Answers({ g, session, manager }: { g: Game; session: InterviewSession; manager: ManagerProfile }): JSX.Element {
  const q = session.questions[session.currentIndex];
  const writing = g.pressWriting && q.written !== true && pressAiReady(g.pressAi);
  return (
    <section className="card press-answers">
      <div className="press-me">
        <PersonFace photoUrl={managerPhotoUrl(manager)} name={`${manager.firstName} ${manager.lastName}`} size={38} />
        <div>
          <div className="press-name">{manager.firstName} {manager.lastName}</div>
          <div className="faint">Your answer</div>
        </div>
        {session.ai === true && <span className="press-ai-badge" title="Written by AI"><Icon name="spark" size={12} /> AI</span>}
      </div>
      <div className="press-tones">
        {TONES.map((tone) => (
          <div key={tone} className={`press-tone tone-${tone}`}>
            <div className="press-tone-head">
              <b>{TONE[session.kind][tone].label}</b>
              <span className="faint">{TONE[session.kind][tone].hint}</span>
            </div>
            {q.options.map((o, i) => (o.category === tone ? (
              <button key={`${session.currentIndex}-${i}`} className="press-answer" disabled={writing}
                onClick={() => g.answerInterviewQuestion(session.id, i)}>
                <span className="press-answer-text">{writing ? '…' : o.text}</span>
                {!writing && <OptionEffects g={g} o={o} kind={session.kind} />}
              </button>
            ) : null))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The conference is over: tomorrow's back page, how the room took it, and what it did. */
function BackPage({ g, session, cm }: { g: Game; session: InterviewSession; cm: ConferenceMatch | null }): JSX.Element {
  const world = g.world!;
  const store = world.players;
  const answered = session.questions.filter((q) => q.answeredIndex !== null);
  let squad = 0;
  let opp = 0;
  const players = new Map<number, number>();
  for (const q of answered) {
    const o = q.options[q.answeredIndex!];
    squad += o.ownMorale + (q.bodyLanguage === 'encouraged' ? 1 : q.bodyLanguage === 'skeptical' ? -1 : 0);
    opp += o.opponentMorale;
    if (o.playerIdx !== undefined && o.playerMorale !== undefined) players.set(o.playerIdx, (players.get(o.playerIdx) ?? 0) + o.playerMorale);
  }
  const paper = answered.find((q) => q.answeredIndex !== null && q.options[q.answeredIndex].category === 'convince')?.journalist.outlet
    ?? answered[0]?.journalist.outlet ?? 'The Daily Volley';
  const won = cm !== null && cm.ownSets > cm.oppSets;
  return (
    <div className="press-done">
      <article className="press-paper">
        <header className="press-mast">
          <span>{paper}</span>
          <span className="press-mast-sub">{session.kind === 'pre' ? 'Preview' : won ? 'Match report' : 'Reaction'} · {session.occasion}</span>
        </header>
        <h2 className="press-headline">{session.headline ?? 'No comment'}</h2>
        <p className="press-standfirst">
          {world.manager.firstName} {world.manager.lastName} faced {answered.length} questions
          {cm !== null ? <> {session.kind === 'pre' ? 'ahead of the match against' : `after the ${cm.ownSets}-${cm.oppSets} against`} {cm.oppName}</> : null}
          {session.ai === true ? ' — the room as the AI wrote it.' : '.'}
        </p>
        <ol className="press-paper-x">{answered.map((q, i) => <Exchange key={i} q={q} />)}</ol>
      </article>
      <aside className="press-side">
        <section className="card">
          <header className="card-head"><Icon name="press" size={15} /><h3 className="card-title">How the room took it</h3></header>
          <div className="card-body press-took">
            {answered.map((q, i) => (
              <div key={i} className="press-took-row">
                <PersonFace photoUrl={portraitUrl(q.journalist.photoId, q.journalist.gender)} name={q.journalist.name} size={26} />
                <span className="press-took-name">{q.journalist.name}</span>
                <MoodMeter mood={q.bodyLanguage} />
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <header className="card-head"><Icon name="squad" size={15} /><h3 className="card-title">What it did</h3></header>
          <div className="card-body press-did">
            <div className="kv"><span>Your squad</span><Effect label={squad === 0 ? '' : `${squad > 0 ? '+' : ''}${squad} morale`} value={squad} />{squad === 0 && <span className="faint">No change</span>}</div>
            {session.kind === 'pre' && <div className="kv"><span>{cm?.oppName ?? 'Opponents'}</span><Effect label={`+${opp} morale`} value={opp} theirs />{opp === 0 && <span className="faint">No change</span>}</div>}
            {[...players].map(([p, v]) => store.isActive(p) && (
              <div className="kv" key={p}><span>{store.shortName(p)}</span><Effect label={`${v > 0 ? '+' : ''}${v} morale`} value={v} /></div>
            ))}
          </div>
        </section>
        <button className="primary press-done-btn" onClick={() => g.closeInterview()}>Done</button>
      </aside>
    </div>
  );
}

/**
 * The full-screen press conference — how the notification the manager "Attends" from the inbox
 * plays out. Journalists put their questions one by one, each in their own voice, from what is in
 * their notebooks; the manager answers in one of three tones, which nudges morale on both sides
 * and colours how that journalist reads him. A bold answer may draw a follow-up. At the end, the
 * line the papers lead with. With the AI press setting on, Claude writes the words.
 */
export function InterviewScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const sessionId = g.activeInterviewId;
  const session = sessionId !== null ? world.pendingInterviews.find((s) => s.id === sessionId) : undefined;

  // Defensive: if the session vanished from under us (the fixture was played before the manager
  // finished, say), back out instead of rendering nothing forever.
  useEffect(() => {
    if (sessionId !== null && session === undefined) g.closeInterview();
  }, [sessionId, session]);

  // With the AI press on, whatever is still in the game's words is sent to be written — the
  // conference as it opens, and a follow-up as it is put.
  const pending = session !== undefined && !session.finished
    ? session.questions.slice(session.currentIndex).filter((q) => q.written !== true).length
    : 0;
  useEffect(() => {
    if (session !== undefined && pending > 0 && pressAiReady(g.pressAi) && !g.pressWriting && g.pressError === null) {
      void g.writePress(session.id);
    }
  }, [session?.id, pending, g.pressAi, g.pressWriting, g.pressError]);

  if (sessionId === null || session === undefined) return null;
  const cm = conferenceMatch(world, session);

  return (
    <div className="press">
      {!session.finished && <TopBar g={g} session={session} cm={cm} />}
      {session.finished
        ? <BackPage g={g} session={session} cm={cm} />
        : (
          <div className="press-stage">
            <Room g={g} session={session} />
            <Answers g={g} session={session} manager={world.manager} />
          </div>
        )}
    </div>
  );
}
