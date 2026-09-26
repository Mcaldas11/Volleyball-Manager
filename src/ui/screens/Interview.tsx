import { useEffect, type JSX } from 'react';
import type { Club } from '../../engine/model/club.ts';
import type { ManagerProfile } from '../../engine/world/world.ts';
import type {
  AnswerCategory, BodyLanguage, InterviewQuestion, InterviewSession,
} from '../../engine/world/interviews.ts';
import { Card, ClubLink, managerPhotoUrl, PersonFace } from '../components.tsx';
import { portraitUrl } from '../faces.ts';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const CATEGORY_LABEL: Readonly<Record<AnswerCategory, string>> = {
  positive: 'Positive',
  neutral: 'Neutral',
  convince: 'Convince',
};

const CATEGORY_ORDER: readonly AnswerCategory[] = ['positive', 'neutral', 'convince'];

const BODY_LANGUAGE_LABEL: Readonly<Record<BodyLanguage, string>> = {
  hostile: 'Hostile',
  skeptical: 'Skeptical',
  neutral: 'Neutral',
  pleased: 'Slightly pleased',
  encouraged: 'Encouraged',
  delighted: 'Delighted',
};

function JournalistBadge({
  q, active,
}: {
  q: InterviewQuestion;
  active: boolean;
}): JSX.Element {
  const label = q.answeredIndex !== null
    ? BODY_LANGUAGE_LABEL[q.bodyLanguage]
    : active ? 'Speaking' : 'Waiting';
  const cls = q.answeredIndex !== null ? `pill bl-${q.bodyLanguage}` : 'pill bl-neutral';
  return (
    <div className={`interview-journo-card${active ? ' active' : ''}${q.answeredIndex !== null ? ' answered' : ''}`}>
      <PersonFace photoUrl={portraitUrl(q.journalist.photoId, q.journalist.gender)} name={q.journalist.name} size={40} />
      <div className="interview-journo-name">{q.journalist.name}</div>
      <div className="faint" style={{ fontSize: 10.5 }}>{q.journalist.outlet}</div>
      <span className={cls} style={{ fontSize: 10 }}>{label}</span>
    </div>
  );
}

/**
 * The current question: the journalist on the floor, their question as a
 * speech bubble, the room behind them, and the manager's own answer choices
 * grouped by tone. Answering advances the session to the next question.
 */
function QuestionView({
  g, session, manager,
}: {
  g: ReturnType<typeof useGame>;
  session: InterviewSession;
  manager: ManagerProfile;
}): JSX.Element {
  const question = session.questions[session.currentIndex];

  return (
    <div className="interview-layout">
      <Card className="interview-left" title="The Room" icon="press">
        <div className="interview-speaker">
          <PersonFace
            photoUrl={portraitUrl(question.journalist.photoId, question.journalist.gender)}
            name={question.journalist.name}
            size={56}
          />
          <div className="interview-speaker-info">
            <div className="interview-speaker-name">{question.journalist.name}</div>
            <div className="faint">{question.journalist.outlet}</div>
          </div>
          <div className="interview-body-language">
            <span className="faint" style={{ fontSize: 11 }}>Body Language</span>
            <span className={`pill bl-${question.bodyLanguage}`}>{BODY_LANGUAGE_LABEL[question.bodyLanguage]}</span>
          </div>
        </div>

        <div className="interview-bubble">{question.prompt}</div>

        <div className="interview-journo-grid">
          {session.questions.map((q, i) => (
            <JournalistBadge key={i} q={q} active={i === session.currentIndex} />
          ))}
        </div>
      </Card>

      <Card className="interview-right" title="Your Answer" icon="user">
        <div className="interview-manager">
          <PersonFace photoUrl={managerPhotoUrl(manager)} name={`${manager.firstName} ${manager.lastName}`} size={44} />
          <div>
            <div className="interview-speaker-name">{manager.firstName} {manager.lastName}</div>
            <div className="faint">Manager</div>
          </div>
        </div>

        {CATEGORY_ORDER.map((cat) => (
          <div key={cat}>
            <div className={`interview-category-label cat-${cat}`}>{CATEGORY_LABEL[cat]}</div>
            {question.options.map((o, i) => (o.category === cat ? (
              <button
                key={i}
                className="interview-answer"
                onClick={() => g.answerInterviewQuestion(session.fixtureId, i)}
              >
                {o.text}
              </button>
            ) : null))}
          </div>
        ))}
      </Card>
    </div>
  );
}

/** The conference is over: a recap of every question asked, what was said,
 *  and how each journalist took it. */
function SummaryView({
  g, session, opponent,
}: {
  g: ReturnType<typeof useGame>;
  session: InterviewSession;
  opponent: Club | undefined;
}): JSX.Element {
  return (
    <>
      <p className="page-intro">
        Conference complete{opponent !== undefined ? <> — ahead of the match with <ClubLink id={opponent.id} short /></> : null}.
      </p>
      <Card title="What You Told Them" icon="press" style={{ maxWidth: 720 }}>
        {session.questions.map((q, i) => (
          <div className="interview-summary-row" key={i}>
            <div className="kv">
              <strong>{q.journalist.name} <span className="faint">· {q.journalist.outlet}</span></strong>
              <span className={`pill bl-${q.bodyLanguage}`}>{BODY_LANGUAGE_LABEL[q.bodyLanguage]}</span>
            </div>
            <div className="dim" style={{ fontStyle: 'italic', margin: '4px 0 4px' }}>&ldquo;{q.prompt}&rdquo;</div>
            <div>{q.answeredIndex !== null ? q.options[q.answeredIndex].text : '—'}</div>
          </div>
        ))}
        <div className="toolbar" style={{ marginTop: 14 }}>
          <button className="primary" onClick={() => g.closeInterview()}>Done</button>
        </div>
      </Card>
    </>
  );
}

/**
 * The full-screen press conference — how the notification the manager
 * "Attends" from the inbox plays out. A short sequence of questions from
 * different journalists, each answered with a Positive, Neutral or Convince
 * tone; the tone chosen nudges morale on both sides and colours how that
 * journalist reads the room for the rest of the conversation.
 */
export function InterviewScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const fixtureId = g.activeInterviewFixtureId;
  const session = fixtureId !== null
    ? world.pendingInterviews.find((s) => s.fixtureId === fixtureId)
    : undefined;

  // Defensive: if the session vanished from under us (the fixture was played
  // before the manager finished, say), back out instead of rendering nothing
  // forever.
  useEffect(() => {
    if (fixtureId !== null && session === undefined) g.closeInterview();
  }, [fixtureId, session]);

  if (fixtureId === null || session === undefined) return null;

  const f = world.fixtures[fixtureId];
  const isHome = f.home === world.userClubId;
  const opponent = world.clubs[isHome ? f.away : f.home];

  return (
    <div className="interview-screen">
      {!session.finished && (
        <div className="interview-topline">
          <span className="interview-context">
            {opponent !== undefined
              ? <>Ahead of {isHome ? 'hosting' : 'facing'} <ClubLink id={opponent.id} short /></>
              : 'Pre-match'}
          </span>
          <span className="interview-progress">
            {session.questions.map((_, i) => (
              <span
                key={i}
                className={`interview-step${i < session.currentIndex ? ' done' : i === session.currentIndex ? ' current' : ''}`}
              />
            ))}
            <span className="faint">Question {session.currentIndex + 1} of {session.questions.length}</span>
          </span>
          <span className="flex-spacer" />
          <button onClick={() => g.closeInterview()}><Icon name="exit" size={14} /> Leave for now</button>
        </div>
      )}

      {session.finished
        ? <SummaryView g={g} session={session} opponent={opponent} />
        : <QuestionView g={g} session={session} manager={world.manager} />}
    </div>
  );
}
