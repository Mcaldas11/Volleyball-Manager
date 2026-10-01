/**
 * The processing window: up while the days pass — the one a Continue moves
 * on, or the run of them on holiday — the way Football Manager shows time
 * going by. Down the left, the day as it turns, the next match coming up and
 * the post as it arrives; on the right, the latest news and the fortnight
 * around today on the calendar, results filling in as matches are played.
 */

import { useEffect, type CSSProperties, type JSX } from 'react';
import { messageSender } from '../engine/world/inbox.ts';
import { messageCategory, type Fixture, type GameMessage, type MessageCategory } from '../engine/world/world.ts';
import { ClubCrest } from './components.tsx';
import { Icon } from './icons.tsx';
import { notesOn, shortCompName } from './screens/Calendar.tsx';
import { CATEGORY_META, MessageAvatar } from './screens/Inbox.tsx';
import { NEWS_KIND, NewsVisual, useNewsDate } from './screens/News.tsx';
import type { NewsItem } from '../engine/world/news.ts';
import { useGame } from './state.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The kinds of post that make the news: results, the club, the media, the board. */
const NEWSWORTHY: ReadonlySet<MessageCategory> = new Set<MessageCategory>(['matchday', 'news', 'interview', 'career', 'board']);

export function ProcessingWindow(): JSX.Element | null {
  const g = useGame();
  const world = g.world;
  const view = g.processingView;

  useEffect(() => {
    if (view === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') g.closeProcessing();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view === null]);

  if (world === null || view === null) return null;
  const fresh = world.messages.slice(view.firstMessage).filter((m) => m.archived !== true).reverse();
  // The news: the latest story from around the world, or from the post — the
  // newsworthy first — or, before anything has come in, the latest there was.
  const story = [...world.news].reverse().find((n) => n.id >= view.firstNews);
  const featured = fresh.find((m) => NEWSWORTHY.has(messageCategory(m))) ?? fresh[0]
    ?? [...world.messages].reverse().find((m) => m.archived !== true);
  const lastStory = world.news[world.news.length - 1];
  const holiday = g.holiday;

  return (
    <div className="proc-overlay">
      <div className="proc-window" role="dialog" aria-label="Processing">
        <header className="proc-top">
          <span className="proc-title">{holiday !== null ? 'On holiday' : 'Processing'}</span>
          <button
            className="icon-btn"
            onClick={() => g.closeProcessing()}
            title={holiday !== null ? 'Return from holiday' : 'Close'}
            disabled={holiday?.cutShort === true}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="proc-body">
          <aside className="proc-left">
            <DayCard turning={view.kind === 'day'} />
            {holiday !== null && <HolidayBlock />}
            <section className="proc-msgs">
              <h4 className="proc-h">Messages received</h4>
              {fresh.length === 0 && <p className="proc-empty">Nothing new yet.</p>}
              <ul className="proc-msg-list">
                {fresh.map((m) => (
                  <li key={m.id} className="proc-msg">
                    <MessageAvatar message={m} size={30} />
                    <span className="proc-msg-text">
                      <small>{messageSender(m)}</small>
                      <b>{m.subject}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>

          <div className="proc-right">
            {story !== undefined ? <StoryCard item={story} />
              : fresh.length > 0 && featured !== undefined ? <NewsCard message={featured} />
                : lastStory !== undefined ? <StoryCard item={lastStory} />
                  : featured !== undefined ? <NewsCard message={featured} /> : <div className="proc-news proc-news-empty" />}
            <Fortnight />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Today, turning over — and the next match, counting down. On holiday the
 *  days go by too fast to turn each one over. */
function DayCard({ turning }: { turning: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const date = g.calendarDate(world.day);
  const next = g.nextFixture();
  const opp = next !== null ? world.clubs[next.home === world.userClubId ? next.away : next.home] : undefined;
  const comp = next !== null ? world.competitions[next.competitionId] : undefined;
  const days = next !== null ? next.day - world.day : 0;
  const when = days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
  const venue = next === null ? '' : next.neutralVenue ? 'Neutral' : next.home === world.userClubId ? 'Home' : 'Away';
  return (
    <section className="proc-day">
      <div className="proc-day-top">
        <strong key={turning ? world.day : 'date'} className={`proc-day-date${turning ? ' turning' : ''}`}>
          {g.weekdayLabelForDay(world.day)} {date?.getUTCDate()} {date?.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}
        </strong>
        <span className="spinner" />
      </div>
      <span className="proc-day-kicker">Next match</span>
      {next !== null && opp !== undefined ? (
        <>
          <span className="proc-day-line"><Icon name="trophy" size={14} /> {comp?.name ?? 'Match'}</span>
          <span className="proc-day-line">
            <ClubCrest club={opp} size={18} /> {opp.name} ({venue}) <span className="proc-day-when">{when}</span>
          </span>
        </>
      ) : (
        <span className="proc-day-line">No match scheduled</span>
      )}
    </section>
  );
}

/** Away: when he is back, how far through it, and the way back early. */
function HolidayBlock(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const h = g.holiday!;
  const away = world.day - h.since;
  const total = h.until === null ? null : h.until - h.since;
  return (
    <section className="proc-holiday">
      <span>
        {h.until === null ? 'Until something needs you' : `Back on ${g.longDateLabel(h.until)}`}
        {' · '}{away} day{away === 1 ? '' : 's'} away
      </span>
      {total !== null && (
        <div className="hol-bar"><span style={{ width: `${Math.min(100, (away / Math.max(1, total)) * 100)}%` }} /></div>
      )}
      <button className="sm" disabled={h.cutShort} onClick={() => g.returnFromHoliday()}>
        <Icon name="back" size={13} /> {h.cutShort ? 'Returning…' : 'Return from holiday'}
      </button>
    </section>
  );
}

/** The latest news, as the front page has it. */
function NewsCard({ message: m }: { message: GameMessage }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const cat = messageCategory(m);
  const when = m.day === world.day ? 'Today' : m.day === world.day - 1 ? 'Yesterday' : g.dateLabelForDay(m.day);
  return (
    <article key={m.id} className="proc-news" style={{ '--cat': CATEGORY_META[cat].color } as CSSProperties}>
      <div className="proc-news-text">
        <span className="proc-news-kicker"><Icon name={CATEGORY_META[cat].icon} size={13} /> {CATEGORY_META[cat].label}</span>
        <h3 className="proc-news-title">{m.subject}</h3>
        <p className="proc-news-body">{m.body}</p>
        <span className="proc-news-meta">{messageSender(m)} <i>|</i> {when}</span>
      </div>
      <div className="proc-news-face"><MessageAvatar message={m} size={118} /></div>
    </article>
  );
}

/** A story from the world's news, as the front page has it. */
function StoryCard({ item: n }: { item: NewsItem }): JSX.Element {
  const when = useNewsDate();
  return (
    <article key={n.id} className="proc-news" style={{ '--cat': NEWS_KIND[n.kind].color } as CSSProperties}>
      <div className="proc-news-text">
        <span className="proc-news-kicker"><Icon name={NEWS_KIND[n.kind].icon} size={13} /> {NEWS_KIND[n.kind].label}</span>
        <h3 className="proc-news-title">{n.headline}</h3>
        <p className="proc-news-body">{n.body}</p>
        <span className="proc-news-meta">World News <i>|</i> {when(n.day)}</span>
      </div>
      <div className="proc-news-face"><NewsVisual item={n} size={104} /></div>
    </article>
  );
}

/** This week and next on the calendar, today picked out. */
function Fortnight(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club;
  const today = world.day;
  const date = g.calendarDate(today);
  const monday = today - (((date?.getUTCDay() ?? 1) + 6) % 7);
  const days = Array.from({ length: 14 }, (_, i) => monday + i);
  const ownOn = (day: number): Fixture[] => club === null ? [] : (world.fixturesByDay.get(day) ?? [])
    .map((id) => world.fixtures[id])
    .filter((f) => f.home === club.id || f.away === club.id);
  return (
    <section className="proc-cal">
      <h4 className="proc-h proc-cal-title">Calendar {date?.getUTCFullYear()}</h4>
      <div className="proc-cal-week">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="proc-cal-grid">
        {days.map((day, i) => {
          const d = g.calendarDate(day);
          const label = i === 0 || d?.getUTCDate() === 1
            ? `${d?.getUTCDate()} ${d?.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`
            : `${d?.getUTCDate()}`;
          return (
            <div key={day} className={`proc-cell${day === today ? ' today' : ''}${day < today ? ' past' : ''}`}>
              <span className="proc-cell-day">{label}</span>
              {ownOn(day).map((f) => <MatchTag key={f.id} fixture={f} />)}
              {notesOn(day).map((n) => (
                <span key={n.label} className={`proc-note ${n.kind}`}>{n.kind === 'deadline' ? 'Deadline' : 'Window opens'}</span>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A match on the calendar: the opponent's crest, home or away, and the result once played. */
function MatchTag({ fixture: f }: { fixture: Fixture }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const home = f.home === world.userClubId;
  const opp = world.clubs[home ? f.away : f.home];
  const comp = world.competitions[f.competitionId];
  const tag = shortCompName(comp);
  const us = home ? f.homeSets : f.awaySets;
  const them = home ? f.awaySets : f.homeSets;
  const result = f.played ? (us > them ? 'win' : 'loss') : '';
  return (
    <span className={`proc-match ${result}`} title={`${comp?.name ?? ''}: ${opp?.name ?? ''}`}>
      {tag !== '' && <em>{tag}</em>}
      {opp !== undefined && <ClubCrest club={opp} size={16} />}
      <b>{f.neutralVenue ? 'N' : home ? 'H' : 'A'}</b>
      {f.played && <span className="proc-match-score">{us}-{them}</span>}
    </span>
  );
}
