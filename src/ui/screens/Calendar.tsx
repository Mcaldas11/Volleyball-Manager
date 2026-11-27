import { useState, type JSX } from 'react';
import { internationalNotes, userNation, type IntlMatch, type Tournament } from '../../engine/world/internationals.ts';
import { sideCode, sideName } from '../../engine/world/sides.ts';
import { Flag, Segmented } from '../components.tsx';
import { stageLabel } from '../../engine/season/cups.ts';
import {
  FRIENDLY_NOTICE_DAYS, friendliesOf, friendlyRequests, friendlyWindow,
} from '../../engine/season/friendlies.ts';
import { openInvites, userCups } from '../../engine/season/preseasonCups.ts';
import { contractEndSeason, DAYS_PER_SEASON, seasonEndDay, TRANSFER_WINDOWS, type Competition, type Fixture } from '../../engine/world/world.ts';
import { SESSIONS, weekPlan, weekStartOf } from '../../engine/world/training.ts';
import { youthRound, youthRoundDay } from '../../engine/world/youth.ts';
import { Icon } from '../icons.tsx';
import { WatchLiveMenu } from '../watchLive.tsx';
import { formatDate, useGame, type ScreenId } from '../state.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Something on the calendar besides a match. */
interface DayNote {
  label: string;
  kind: 'deadline' | 'window' | 'training' | 'youth' | 'u21' | 'academy' | 'club';
}

/** The calendar's layers: what can be shown on it besides the matches, each on or off. */
type Layer = 'windows' | 'training' | 'youth' | 'u21' | 'academy' | 'club';
const LAYERS: ReadonlyArray<[Layer, string]> = [
  ['windows', 'Windows & internationals'], ['training', 'Training'], ['youth', 'U19'], ['u21', 'U21'], ['academy', 'Academy'], ['club', 'Contracts & club'],
];
const LAYERS_KEY = 'vm.calendarLayers';

/** Whose matches the calendar shows: the club's, the national team's, or both mixed. */
type TeamFilter = 'all' | 'club' | 'national';

/** One of the manager's national team's matches. */
interface NationalDate { t: Tournament; m: IntlMatch; side: number }

function readLayers(): Set<Layer> {
  try {
    const raw = window.localStorage.getItem(LAYERS_KEY);
    if (raw !== null) {
      const kept = new Set(JSON.parse(raw) as Layer[]);
      // The U21 layer came later: on for a calendar set up before it, once.
      if (window.localStorage.getItem('vm.calendarU21') === null) {
        kept.add('u21');
        window.localStorage.setItem('vm.calendarU21', '1');
      }
      return kept;
    }
  } catch {
    // Nothing kept: the usual layers.
  }
  return new Set<Layer>(['windows', 'youth', 'u21', 'academy', 'club']);
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
  const [selectedDay, setSelectedDay] = useState(today);
  const [view, setView] = useState<'month' | 'agenda'>('month');
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
  if (layers.has('u21')) {
    // The club's under-21 side: its league matches, the result once played.
    const side = world.clubs.find((c) => c.under21Of === club.id);
    if (side !== undefined) {
      for (const f of world.fixtures) {
        if (f.home !== side.id && f.away !== side.id) continue;
        const home = f.home === side.id;
        const opp = world.clubs[home ? f.away : f.home];
        const name = (opp?.shortName ?? '?').replace(/\s*U21$/, '');
        const score = f.played ? ` ${home ? f.homeSets : f.awaySets}-${home ? f.awaySets : f.homeSets}` : '';
        add(f.day, { kind: 'u21', label: `U21${score} ${home ? 'vs' : 'at'} ${name}` });
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

  // The club's matches and the national team's, mixed or one of the two.
  const [teams, setTeams] = useState<TeamFilter>('all');
  const showClub = teams !== 'national';
  const showNational = teams !== 'club';
  const ownOn = (day: number): Fixture[] => (!showClub ? [] :
    (world.fixturesByDay.get(day) ?? [])
      .map((id) => world.fixtures[id])
      .filter((f) => f.home === club.id || f.away === club.id));
  // The national team's matches across the seasons the six weeks on show and the next few months span.
  const nationalAll: NationalDate[] = [...new Set([
    Math.floor(gridStart / DAYS_PER_SEASON), Math.floor((gridStart + 41) / DAYS_PER_SEASON), world.season,
  ])].flatMap((s) => g.managerNationalMatches(s));
  const hasNational = nationalAll.length > 0 || userNation(world) >= 0;
  const nationalOn = (day: number): NationalDate[] => (showNational ? nationalAll.filter((x) => x.m.day === day) : []);
  // Its matches are chips of their own: not repeated among the international notes.
  const nationalLabels = new Set(nationalAll.map(({ m, side }) => `${sideName(side)} v ${sideName(m.home === side ? m.away : m.home)}`));
  const openNational = (x: NationalDate): void => {
    if (x.m.played) g.openIntlReport(x.m.id, true);
    else if (x.m.day === today && g.nationalMatchToday() !== null) g.openNationalMatchday();
    else g.openTournament(x.t.id);
  };

  const upcomingClub = showClub ? g.ownFixtures().filter((f) => !f.played && f.day >= today).slice(0, 5) : [];
  const upcomingNational = nationalAll.filter((x) => !x.m.played && x.m.day >= today).slice(0, 5);
  const upcoming: Array<{ day: number; f?: Fixture; n?: NationalDate }> = [
    ...upcomingClub.map((f) => ({ day: f.day, f })),
    ...upcomingNational.map((n) => ({ day: n.m.day, n })),
  ].sort((a, b) => a.day - b.day).slice(0, 5);
  const next = upcomingClub[0];
  const nextNat = upcomingNational[0];
  // The next date worth knowing: a match, or a window opening or shutting.
  let nextNote: { day: number; label: string } | null = null;
  for (let d = today; d < today + 200 && nextNote === null; d++) {
    const n = notesOn(d)[0];
    if (n !== undefined) nextNote = { day: d, label: n.label };
  }
  const clubStop = next !== undefined && (nextNote === null || next.day <= nextNote.day)
    ? { day: next.day, label: `${next.home === club.id ? 'vs' : 'at'} ${world.clubs[next.home === club.id ? next.away : next.home]?.name ?? '—'}` }
    : nextNote;
  const nextStop = nextNat !== undefined && (clubStop === null || nextNat.m.day < clubStop.day)
    ? { day: nextNat.m.day, label: `${sideName(nextNat.side)} v ${sideName(nextNat.m.home === nextNat.side ? nextNat.m.away : nextNat.m.home)}` }
    : clubStop;

  const monthTitle = formatDate(monthDate, 'monthYear');
  const notesFor = (day: number): Array<{ label: string; kind: string }> => (day >= 0
    ? [...(layers.has('windows') ? [...notesOn(day), ...internationalNotes(world, day).filter((n) => !nationalLabels.has(n.label))] : []), ...(layerNotes.get(day) ?? [])]
    : []);
  const selectedNotes = notesFor(selectedDay);
  const noteScreen = (n: { label: string; kind: string }): ScreenId => (n.kind === 'training' ? 'training'
    : n.kind === 'youth' || n.kind === 'u21' || n.kind === 'academy' ? 'youth'
      : n.kind === 'window' || n.kind === 'deadline' ? 'transfers'
        : /facilit|building/i.test(n.label) ? 'facilities' : 'squad');

  // The pre-season, while there is still time to fix up a friendly.
  const preSeason = today % DAYS_PER_SEASON <= friendlyWindow(world).last - FRIENDLY_NOTICE_DAYS;
  const friendlies = friendliesOf(world, club.id);
  const invitations = friendlyRequests(world);
  // Pre-season tournaments: the club's, and the invitations waiting.
  const cups = userCups(world);
  const cupInvites = openInvites(world).filter((i) => i.cupId !== undefined).length;
  const cupsOn = cups.length > 0 || cupInvites > 0;

  return (
    <div className="calendar-workspace">
      <header className="calendar-workspace-heading">
        <div>
          <span className="portal-eyebrow">The rhythm of your club</span>
          <h1>Make every day count.</h1>
          <p>Matches, preparation and commitments in one place.</p>
        </div>
        <div className="calendar-mode">
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button>
          <button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>Agenda</button>
        </div>
      </header>
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
          {(preSeason || cupsOn) && (
            <button className="cal-full" disabled={g.processing} onClick={() => g.openCupsDialog()}>
              <Icon name="trophy" size={14} /> Tournaments{cupInvites > 0 ? ` (${cupInvites})` : ''}
            </button>
          )}
          <button className="cal-full" disabled={g.processing} onClick={() => g.openHoliday()}>
            <Icon name="calendar" size={14} /> Go on holiday
          </button>
          <button className="cal-full" onClick={() => g.go('fixtures')}>Full schedule</button>
        </header>
        <div className="cal-layers" title="What the calendar shows besides the matches">
          {hasNational && (
            <Segmented<TeamFilter> size="sm" value={teams} onChange={setTeams}
              options={[['all', 'All matches'], ['club', 'Club'], ['national', 'National']]} />
          )}
          {LAYERS.map(([l, label]) => (
            <button key={l} className={`cal-layer ${l}${layers.has(l) ? ' on' : ''}`} onClick={() => toggle(l)} aria-pressed={layers.has(l)}>{label}</button>
          ))}
        </div>
        {view === 'month' ? (
          <>
            <div className="cal-weekdays">
              {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="cal-grid">
              {cells.map((day) => {
                const date = g.calendarDate(day);
                const inMonth = date !== null && date.getUTCMonth() === month;
                const fixtures = day >= 0 ? ownOn(day) : [];
                const notes = notesFor(day);
                return (
                  <div
                    key={day}
                    className={`cal-cell${inMonth ? '' : ' out'}${day === today ? ' today' : ''}${day < today ? ' past' : ''}${day > today ? ' ahead' : ''}${day === selectedDay ? ' selected' : ''}`}
                    title={g.dateLabelForDay(day)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={day === selectedDay}
                    onClick={() => setSelectedDay(day)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedDay(day); }
                    }}
                  >
                    <span className="cal-day">
                      {date?.getUTCDate()}
                      {day === today && <span className="cal-today">Today</span>}
                    </span>
                    {fixtures.map((f) => <FixtureChip key={f.id} fixture={f} />)}
                    {nationalOn(day).map((x) => <NationalChip key={`n${x.m.id}`} date={x} onOpen={() => openNational(x)} />)}
                    {notes.map((n, i) => <span key={`${n.label}-${i}`} className={`cal-note ${n.kind}`} title={n.label}>{n.label}</span>)}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="calendar-agenda">
            {cells.filter((day) => g.calendarDate(day)?.getUTCMonth() === month).map((day) => {
              const fixtures = day >= 0 ? ownOn(day) : [];
              const nats = nationalOn(day);
              const notes = notesFor(day);
              if (fixtures.length === 0 && nats.length === 0 && notes.length === 0 && day !== today) return null;
              const date = g.calendarDate(day);
              return (
                <section key={day} className={`calendar-agenda-day${day === today ? ' today' : ''}`}>
                  <button className="calendar-agenda-date" onClick={() => setSelectedDay(day)}>
                    <b>{date?.getUTCDate()}</b>
                    <span>{date !== null ? formatDate(date, 'weekday') : ''}</span>
                  </button>
                  <div className="calendar-agenda-content">
                    {fixtures.map((f) => <FixtureChip key={f.id} fixture={f} />)}
                    {nats.map((x) => <NationalChip key={`n${x.m.id}`} date={x} onOpen={() => openNational(x)} />)}
                    {notes.map((n, i) => <span key={i} className={`cal-note ${n.kind}`}>{n.label}</span>)}
                    {fixtures.length === 0 && nats.length === 0 && notes.length === 0 && <span className="faint">Nothing scheduled</span>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <aside className="cal-side">
        <section className="cal-card calendar-selected">
          <span className="portal-eyebrow">Selected day</span>
          <h2 className="calendar-selected-date">{g.longDateLabel(selectedDay)}</h2>
          <div className="calendar-selected-events">
            {ownOn(selectedDay).map((f) => {
              const opp = world.clubs[f.home === club.id ? f.away : f.home];
              return (
                <button key={f.id} className="calendar-event" onClick={() => (f.played ? g.openMatchReport(f.id, true) : g.go('lineup'))}>
                  <Icon name="ball" size={19} />
                  <span>
                    <b>{opp?.name ?? 'Match'}</b>
                    <small>{world.competitions[f.competitionId]?.name} · {f.home === club.id ? 'Home' : 'Away'}</small>
                    <small>{f.played ? `${f.homeSets}–${f.awaySets}` : 'Prepare match'}</small>
                  </span>
                </button>
              );
            })}
            {nationalOn(selectedDay).map((x) => {
              const opp = x.m.home === x.side ? x.m.away : x.m.home;
              const us = x.m.home === x.side ? x.m.homeSets : x.m.awaySets;
              const them = x.m.home === x.side ? x.m.awaySets : x.m.homeSets;
              return (
                <button key={`n${x.m.id}`} className="calendar-event national" onClick={() => openNational(x)}>
                  <Flag nation={x.side} />
                  <span>
                    <b>{sideName(x.side)} v {sideName(opp)}</b>
                    <small>{x.t.name} · {x.m.stage}</small>
                    <small>{x.m.played ? `${us > them ? 'Won' : 'Lost'} ${us}–${them} · match report` : x.m.day === today ? 'Prepare match' : 'Open the tournament'}</small>
                  </span>
                </button>
              );
            })}
            {selectedNotes.map((n, i) => (
              <button key={i} className="calendar-event" onClick={() => g.go(noteScreen(n))}>
                <Icon name={n.kind === 'training' ? 'training' : n.kind === 'youth' || n.kind === 'u21' || n.kind === 'academy' ? 'youth' : 'club'} size={18} />
                <span><b>{n.label}</b><small>Open workspace</small></span>
              </button>
            ))}
            {ownOn(selectedDay).length === 0 && nationalOn(selectedDay).length === 0 && selectedNotes.length === 0 && <p className="hm-empty">No events in the selected layers.</p>}
          </div>
          <div className="calendar-day-actions">
            <button onClick={() => g.go('training')}><Icon name="training" size={14} /> Training plan</button>
            {selectedDay === today && <WatchLiveMenu align="left" label="Other matches live" />}
            {selectedDay > today && (
              <button onClick={() => g.openHoliday(selectedDay)}><Icon name="calendar" size={14} /> Go on holiday until this day</button>
            )}
          </div>
        </section>

        <section className="cal-card cal-next">
          <span className="cal-card-kicker">Next stop</span>
          <strong className="cal-next-title">{nextStop?.label ?? 'Nothing scheduled'}</strong>
          {nextStop !== null && <span className="cal-next-date">{g.longDateLabel(nextStop.day)}</span>}
        </section>

        {(preSeason || invitations.length > 0) && (
          <section className="cal-card">
            <span className="cal-card-title">Pre-season friendlies</span>
            {friendlies.length === 0 && invitations.length === 0 && (
              <p className="hm-empty">None arranged yet, the board books a couple if you leave it.</p>
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

        {cupsOn && (
          <section className="cal-card">
            <span className="cal-card-title">Pre-season tournaments</span>
            {cupInvites > 0 && (
              <div className="cal-fr pending">
                <span className="cal-fr-main">
                  <strong>{cupInvites === 1 ? 'An invitation' : `${cupInvites} invitations`} to answer</strong>
                  <span>Accept or decline in Tournaments</span>
                </span>
                <button className="sm" onClick={() => g.openCupsDialog()}>Answer</button>
              </div>
            )}
            {cups.map((c) => (
              <div key={`cup-${c.id}`} className="cal-fr">
                <span className="cal-fr-date">{g.dateLabelForDay(c.startDay)}</span>
                <span className="cal-fr-main">
                  <strong className="club-link" onClick={() => g.openCupsDialog()}>{c.name}</strong>
                  <span>{c.size} teams · {c.stage === 'forming' ? `${c.teams.length} of ${c.size} in` : c.stage === 'done' ? `won by ${world.clubs[c.placings[0]]?.name ?? '—'}` : c.stage === 'groups' ? 'group stage' : c.stage === 'knockout' ? 'knockout' : 'called off'}</span>
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="cal-card">
          <span className="cal-card-title">Upcoming matches</span>
          {upcoming.length === 0 && <p className="hm-empty">No fixtures scheduled.</p>}
          {upcoming.map(({ f, n }) => {
            if (n !== undefined) {
              const date = g.calendarDate(n.m.day);
              const opp = n.m.home === n.side ? n.m.away : n.m.home;
              return (
                <div key={`n${n.m.id}`} className="cal-up national">
                  <span className="cal-up-date">
                    <b>{date?.getUTCDate()}</b>
                    <span>{date !== null ? formatDate(date, 'weekday') : ''}</span>
                  </span>
                  <span className="cal-up-main">
                    <strong className="club-link" onClick={() => g.openTournament(n.t.id)}>
                      <Flag nation={n.side} /> {sideCode(n.side)} v {sideName(opp)}
                    </strong>
                    <span>{n.t.name} · {n.m.stage}</span>
                  </span>
                  {n === nextNat && <span className="cal-up-next">Next</span>}
                </div>
              );
            }
            if (f === undefined) return null;
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
          {hasNational && <span><b className="lg-national">National</b>: your national team's match</span>}
          <span><b className="lg-deadline">Deadline</b>: transfer window closes</span>
          <span><b className="lg-training">Training</b>: the session planned</span>
          <span><b className="lg-youth">U19</b>: the academy side's match</span>
          <span><b className="lg-u21">U21</b>: the under-21 side's match</span>
          <span><b className="lg-academy">Academy</b>: programmes, reports, the scouts' finds</span>
          <span><b className="lg-club">Club</b>: contracts, loans, building work</span>
          <span><b className="lg-result">W / L</b>: final result</span>
        </section>
      </aside>
    </div>
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

/** One of the national team's matches on the calendar, its flag first: a result opens its report. */
function NationalChip({ date: { m, side }, onOpen }: { date: NationalDate; onOpen: () => void }): JSX.Element {
  const opp = m.home === side ? m.away : m.home;
  const us = m.home === side ? m.homeSets : m.awaySets;
  const them = m.home === side ? m.awaySets : m.homeSets;
  const name = `${sideCode(side)} v ${sideName(opp)}`;
  const won = us > them;
  return (
    <button className={`cal-chip national${m.played ? ` result ${won ? 'win' : 'loss'}` : ''}`}
      title={`${sideName(side)} v ${sideName(opp)}, ${m.stage}${m.played ? `: ${us}-${them}, open the match report` : ''}`}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      <Flag nation={side} />{m.played ? ` ${won ? 'W' : 'L'} ${us}-${them} · ` : ' '}{name}
    </button>
  );
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
      <button className={`cal-chip result ${won ? 'win' : 'loss'}`} title={`${comp?.name ?? ''}: ${opp?.name ?? ''} ${us}-${them}, open the match report`}
        onClick={(e) => { e.stopPropagation(); g.openMatchReport(f.id, true); }}>
        {won ? 'W' : 'L'} {us}-{them} · {name}
      </button>
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
