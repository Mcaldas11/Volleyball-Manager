import { useState, type JSX } from 'react';
import { internationalNotes } from '../../engine/world/internationals.ts';
import { stageLabel } from '../../engine/season/cups.ts';
import { DAYS_PER_SEASON, TRANSFER_WINDOWS, type Competition, type Fixture } from '../../engine/world/world.ts';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Something on the calendar besides a match. */
interface DayNote {
  label: string;
  kind: 'deadline' | 'window';
}

/** Transfer windows opening and closing — the dates a manager plans around. */
export function notesOn(day: number): DayNote[] {
  const d = ((day % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON;
  const out: DayNote[] = [];
  for (const w of TRANSFER_WINDOWS) {
    const name = w.name === 'summer' ? 'Summer' : 'January';
    if (d === w.opens) out.push({ label: `${name} window opens`, kind: 'window' });
    if (d === w.closes) out.push({ label: `${name} window closes`, kind: 'deadline' });
  }
  return out;
}

/**
 * The month at a glance: every one of the club's matches — results on the
 * days behind, fixtures on the days ahead — and the transfer deadlines, with
 * what is coming up next down the side.
 */
export function CalendarScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const today = world.day;

  // Which month is on show, as the absolute day of its 1st.
  const firstOf = (day: number): number => day - ((g.calendarDate(day)?.getUTCDate() ?? 1) - 1);
  const [monthStart, setMonthStart] = useState(() => firstOf(today));
  const monthDate = g.calendarDate(monthStart)!;
  const month = monthDate.getUTCMonth();

  const prevMonth = (): void => setMonthStart(firstOf(monthStart - 1));
  const nextMonth = (): void => {
    let d = monthStart;
    while (g.calendarDate(d)?.getUTCMonth() === month) d++;
    setMonthStart(d);
  };

  // Monday on or before the 1st, then six weeks.
  const lead = (monthDate.getUTCDay() + 6) % 7;
  const gridStart = monthStart - lead;
  const cells = Array.from({ length: 42 }, (_, i) => gridStart + i);

  const ownOn = (day: number): Fixture[] =>
    (world.fixturesByDay.get(day) ?? [])
      .map((id) => world.fixtures[id])
      .filter((f) => f.home === club.id || f.away === club.id);

  const upcoming = g.ownFixtures().filter((f) => !f.played && f.day >= today).slice(0, 5);
  const next = upcoming[0];
  // The next date worth knowing: a match, or a window opening or shutting.
  let nextNote: { day: number; label: string } | null = null;
  for (let d = today; d < today + 200 && nextNote === null; d++) {
    const n = notesOn(d)[0];
    if (n !== undefined) nextNote = { day: d, label: n.label };
  }
  const nextStop = next !== undefined && (nextNote === null || next.day <= nextNote.day)
    ? { day: next.day, label: `${next.home === club.id ? 'vs' : 'at'} ${world.clubs[next.home === club.id ? next.away : next.home]?.name ?? '—'}` }
    : nextNote;

  const monthTitle = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="cal">
      <div className="cal-main">
        <header className="cal-head">
          <button className="cal-nav" onClick={prevMonth} title="Previous month"><Icon name="chevronLeft" size={16} /></button>
          <h2 className="cal-title">{monthTitle}</h2>
          <button className="cal-nav" onClick={nextMonth} title="Next month"><Icon name="chevronRight" size={16} /></button>
          {firstOf(today) !== monthStart && (
            <button className="cal-today-btn" onClick={() => setMonthStart(firstOf(today))}>Today</button>
          )}
          <span className="flex-spacer" />
          <button className="cal-full" disabled={g.processing} onClick={() => g.openHoliday()}>
            <Icon name="calendar" size={14} /> Go on holiday
          </button>
          <button className="cal-full" onClick={() => g.go('fixtures')}>Full schedule</button>
        </header>
        <div className="cal-weekdays">
          {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="cal-grid">
          {cells.map((day) => {
            const date = g.calendarDate(day);
            const inMonth = date !== null && date.getUTCMonth() === month;
            const fixtures = day >= 0 ? ownOn(day) : [];
            const notes = day >= 0 ? [...notesOn(day), ...internationalNotes(world, day)] : [];
            return (
              <div
                key={day}
                className={`cal-cell${inMonth ? '' : ' out'}${day === today ? ' today' : ''}${day < today ? ' past' : ''}${day > today ? ' ahead' : ''}`}
                // A day ahead: go on holiday until it.
                title={day > today ? `Go on holiday until ${g.dateLabelForDay(day)}` : undefined}
                onClick={day > today ? () => g.openHoliday(day) : undefined}
              >
                <span className="cal-day">
                  {date?.getUTCDate()}
                  {day === today && <span className="cal-today">Today</span>}
                </span>
                {fixtures.map((f) => <FixtureChip key={f.id} fixture={f} />)}
                {notes.map((n) => <span key={n.label} className={`cal-note ${n.kind}`}>{n.label}</span>)}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="cal-side">
        <section className="cal-card cal-next">
          <span className="cal-card-kicker">Next stop</span>
          <strong className="cal-next-title">{nextStop?.label ?? 'Nothing scheduled'}</strong>
          {nextStop !== null && <span className="cal-next-date">{g.longDateLabel(nextStop.day)}</span>}
        </section>

        <section className="cal-card">
          <span className="cal-card-title">Upcoming matches</span>
          {upcoming.length === 0 && <p className="hm-empty">No fixtures scheduled.</p>}
          {upcoming.map((f) => {
            const isHome = f.home === club.id;
            const opp = world.clubs[isHome ? f.away : f.home];
            const comp = world.competitions[f.competitionId];
            const date = g.calendarDate(f.day);
            return (
              <div key={f.id} className="cal-up">
                <span className="cal-up-date">
                  <b>{date?.getUTCDate()}</b>
                  <span>{date?.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                </span>
                <span className="cal-up-main">
                  <strong className="club-link" onClick={() => opp !== undefined && g.selectClub(opp.id)}>
                    {opp?.name ?? '—'} ({isHome ? 'H' : 'A'})
                  </strong>
                  <span>
                    {comp?.name ?? ''} · {stageLabel(world, f)}
                  </span>
                </span>
                {f === next && <span className="cal-up-next">Next</span>}
              </div>
            );
          })}
        </section>

        <section className="cal-card cal-legend">
          <span className="cal-card-title">Legend</span>
          <span><b className="lg-league">League</b>: domestic match</span>
          <span><b className="lg-cup">Cup</b>: national cup and super cup</span>
          <span><b className="lg-continental">Continental</b>: Champions League and the like</span>
          <span><b className="lg-world">World</b>: Club World Championship</span>
          <span><b className="lg-deadline">Deadline</b>: transfer window closes</span>
          <span><b className="lg-result">W / L</b>: final result</span>
        </section>
      </aside>
    </div>
  );
}

/** A short tag for a chip — empty for the league, whose matches are most of the calendar. */
export function shortCompName(comp: Competition | undefined): string {
  if (comp === undefined || comp.kind === 'league') return '';
  if (comp.key === 'cont:CEV:1') return 'CL';
  if (comp.key === 'cont:CEV:2') return 'CEV Cup';
  if (comp.kind === 'clubworld') return 'CWC';
  if (comp.kind === 'supercup') return 'Super Cup';
  if (comp.kind === 'cup') return 'Cup';
  return comp.organizer ?? 'Cont.';
}

function FixtureChip({ fixture: f }: { fixture: Fixture }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const isHome = f.home === club.id;
  const opp = world.clubs[isHome ? f.away : f.home];
  const comp = world.competitions[f.competitionId];
  const kind = comp?.kind === 'league' ? 'league'
    : comp?.kind === 'continental' ? 'continental' : comp?.kind === 'clubworld' ? 'world' : 'cup';
  const tag = shortCompName(comp);
  const name = `${tag !== '' ? `${tag} · ` : ''}${opp?.name ?? '—'} (${f.neutralVenue ? 'N' : isHome ? 'H' : 'A'})`;
  if (f.played) {
    const us = isHome ? f.homeSets : f.awaySets;
    const them = isHome ? f.awaySets : f.homeSets;
    const won = us > them;
    return (
      <span className={`cal-chip result ${won ? 'win' : 'loss'}`} title={`${comp?.name ?? ''}: ${opp?.name ?? ''} ${us}-${them}`}>
        {won ? 'W' : 'L'} {us}-{them} · {name}
      </span>
    );
  }
  return (
    <button
      className={`cal-chip ${kind}`}
      title={`${comp?.name ?? ''}: ${opp?.name ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (opp !== undefined) g.selectClub(opp.id);
      }}
    >
      {name}
    </button>
  );
}
