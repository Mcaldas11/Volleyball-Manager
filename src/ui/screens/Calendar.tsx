import { useState, type JSX } from 'react';
import { internationalNotes } from '../../engine/world/internationals.ts';
import { stageLabel } from '../../engine/season/cups.ts';
import {
  FRIENDLY_NOTICE_DAYS, friendliesOf, friendlyRequests, friendlyWindow,
} from '../../engine/season/friendlies.ts';
import { contractEndSeason, DAYS_PER_SEASON, seasonEndDay, TRANSFER_WINDOWS, type Competition, type Fixture } from '../../engine/world/world.ts';
import { SESSIONS, weekPlan, weekStartOf } from '../../engine/world/training.ts';
import { youthRound, youthRoundDay } from '../../engine/world/youth.ts';
import { Icon } from '../icons.tsx';
import { formatDate, useGame } from '../state.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Something on the calendar besides a match. */
interface DayNote {
  label: string;
  kind: 'deadline' | 'window' | 'training' | 'youth' | 'academy' | 'club';
}

/** The calendar's layers: what can be shown on it besides the matches, each on or off. */
type Layer = 'windows' | 'training' | 'youth' | 'academy' | 'club';
const LAYERS: ReadonlyArray<[Layer, string]> = [
  ['windows', 'Windows & internationals'], ['training', 'Training'], ['youth', 'U19'], ['academy', 'Academy'], ['club', 'Contracts & club'],
];
const LAYERS_KEY = 'vm.calendarLayers';

function readLayers(): Set<Layer> {
  try {
    const raw = window.localStorage.getItem(LAYERS_KEY);
    if (raw !== null) return new Set(JSON.parse(raw) as Layer[]);
  } catch {
    // Nothing kept: the usual layers.
  }
  return new Set<Layer>(['windows', 'youth', 'academy', 'club']);
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

  const [layers, setLayers] = useState<Set<Layer>>(readLayers);
  const toggle = (l: Layer): void => {
    const next = new Set(layers);
    if (next.has(l)) next.delete(l); else next.add(l);
    setLayers(next);
    try {
      window.localStorage.setItem(LAYERS_KEY, JSON.stringify([...next]));
    } catch {
      // A private window: the choice lasts the visit.
    }
  };

  // Everything the layers put on the calendar, by day — worked out once for the six weeks on show.
  const layerNotes = new Map<number, DayNote[]>();
  const add = (day: number, n: DayNote): void => {
    if (day < gridStart || day >= gridStart + 42) return;
    const list = layerNotes.get(day) ?? [];
    list.push(n);
    layerNotes.set(day, list);
  };
  if (layers.has('training')) {
    // The weeks ahead as planned — the sessions the coach sees on the Training screen.
    for (let monday = weekStartOf(world, Math.max(today, gridStart)); monday < gridStart + 42; monday += 7) {
      for (const d of weekPlan(world, club, monday)) {
        if (d.day < today || d.session === 'match') continue;
        add(d.day, { kind: 'training', label: SESSIONS[d.session].label + (d.session === 'rest' || d.session === 'recovery' ? '' : ` · ${d.intensity}`) });
      }
    }
  }
  if (layers.has('youth')) {
    const league = g.youthLeague();
    if (league !== undefined) {
      for (let round = 0; round < league.rounds; round++) {
        const day = youthRoundDay(world, round);
        const pair = youthRound(league, round).find(([h, a]) => h === club.id || a === club.id);
        if (pair === undefined) continue;
        const opp = world.clubs[pair[0] === club.id ? pair[1] : pair[0]];
        add(day, { kind: 'youth', label: `U19 ${pair[0] === club.id ? 'vs' : 'at'} ${opp?.shortName ?? '?'}` });
      }
    }
  }
  if (layers.has('academy')) {
    const a = world.academy;
    for (const p of a?.programmes ?? []) {
      add(p.endDay, { kind: 'academy', label: `Programme ends · ${world.players.shortName(p.playerIdx)}` });
      for (let w = 4; w < 12; w += 4) add(p.startDay + w * 7, { kind: 'academy', label: `Training report · ${world.players.shortName(p.playerIdx)}` });
    }
    if (a?.search !== undefined) add(a.search.endDay, { kind: 'academy', label: 'Youth search report' });
    for (const c of a?.candidates ?? []) add(c.expiresOn, { kind: 'academy', label: `Last day to sign ${world.players.shortName(c.playerIdx)}` });
  }
  if (layers.has('club')) {
    const end = seasonEndDay(world.season);
    const expiring = club.players.filter((p) => contractEndSeason(world.players.contractUntil[p]) <= world.season).length;
    if (expiring > 0) add(end, { kind: 'club', label: `${expiring} contract${expiring === 1 ? '' : 's'} end` });
    const project = club.facilityProject;
    if (project !== undefined) add(project.until, { kind: 'club', label: project.stage === 'asked' ? 'Board answers on facilities' : 'Building work done' });
    for (const l of world.loans) if (l.parentClubId === club.id || l.loanClubId === club.id) add(l.endsOn, { kind: 'club', label: `Loan ends · ${world.players.shortName(l.playerIdx)}` });
  }

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

  const monthTitle = formatDate(monthDate, 'monthYear');

  // The pre-season, while there is still time to fix up a friendly.
  const preSeason = today % DAYS_PER_SEASON <= friendlyWindow(world).last - FRIENDLY_NOTICE_DAYS;
  const friendlies = friendliesOf(world, club.id);
  const invitations = friendlyRequests(world);

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
          {preSeason && (
            <button className="cal-full" disabled={g.processing} onClick={() => g.openFriendlyDialog()}>
              <Icon name="ball" size={14} /> Arrange friendly
            </button>
          )}
          <button className="cal-full" disabled={g.processing} onClick={() => g.openHoliday()}>
            <Icon name="calendar" size={14} /> Go on holiday
          </button>
          <button className="cal-full" onClick={() => g.go('fixtures')}>Full schedule</button>
        </header>
        <div className="cal-layers" title="What the calendar shows besides the matches">
          {LAYERS.map(([l, label]) => (
            <button key={l} className={`cal-layer ${l}${layers.has(l) ? ' on' : ''}`} onClick={() => toggle(l)} aria-pressed={layers.has(l)}>{label}</button>
          ))}
        </div>
        <div className="cal-weekdays">
          {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="cal-grid">
          {cells.map((day) => {
            const date = g.calendarDate(day);
            const inMonth = date !== null && date.getUTCMonth() === month;
            const fixtures = day >= 0 ? ownOn(day) : [];
            const notes = day >= 0 ? [...(layers.has('windows') ? [...notesOn(day), ...internationalNotes(world, day)] : []), ...(layerNotes.get(day) ?? [])] : [];
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
                {notes.map((n, i) => <span key={`${n.label}-${i}`} className={`cal-note ${n.kind}`} title={n.label}>{n.label}</span>)}
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

        {(preSeason || invitations.length > 0) && (
          <section className="cal-card">
            <span className="cal-card-title">Pre-season friendlies</span>
            {friendlies.length === 0 && invitations.length === 0 && (
              <p className="hm-empty">None arranged yet — the board books a couple if you leave it.</p>
            )}
            {friendlies.map((f) => {
              const isHome = f.home === club.id;
              const opp = world.clubs[isHome ? f.away : f.home];
              return (
                <div key={f.id} className="cal-fr">
                  <span className="cal-fr-date">{g.dateLabelForDay(f.day)}</span>
                  <strong className="club-link" onClick={() => opp !== undefined && g.selectClub(opp.id)}>
                    {opp?.name ?? '—'} ({isHome ? 'H' : 'A'})
                  </strong>
                  {f.played && <span className="faint">{isHome ? f.homeSets : f.awaySets}-{isHome ? f.awaySets : f.homeSets}</span>}
                </div>
              );
            })}
            {invitations.map((r) => (
              <div key={`req-${r.id}`} className="cal-fr pending">
                <span className="cal-fr-date">{g.dateLabelForDay(r.day)}</span>
                <span className="cal-fr-main">
                  <strong>{world.clubs[r.clubId]?.name ?? '—'} ({r.home ? 'H' : 'A'})</strong>
                  <span>Invited · answer by {g.dateLabelForDay(r.answerOn)}</span>
                </span>
                <button className="icon-btn" title="Withdraw the invitation" onClick={() => g.withdrawFriendly(r.id)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </section>
        )}

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
                  <span>{date !== null ? formatDate(date, 'weekday') : ''}</span>
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
          <span><b className="lg-continental">Continental</b>: Champions Cup and the like</span>
          <span><b className="lg-world">World</b>: World Club Cup</span>
          <span><b className="lg-friendly">Friendly</b>: pre-season friendly</span>
          <span><b className="lg-deadline">Deadline</b>: transfer window closes</span>
          <span><b className="lg-training">Training</b>: the session planned</span>
          <span><b className="lg-youth">U19</b>: the academy side's match</span>
          <span><b className="lg-academy">Academy</b>: programmes, reports, the scouts' finds</span>
          <span><b className="lg-club">Club</b>: contracts, loans, building work</span>
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
  if (comp.key === 'cont:CEV:2') return 'Continental Cup';
  if (comp.kind === 'clubworld') return 'CWC';
  if (comp.kind === 'friendly') return 'Friendly';
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
    : comp?.kind === 'continental' ? 'continental' : comp?.kind === 'clubworld' ? 'world'
      : comp?.kind === 'friendly' ? 'friendly' : 'cup';
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
