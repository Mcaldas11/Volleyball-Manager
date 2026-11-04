/**
 * The national teams' tournaments. Across the top, the road ahead: what is
 * coming and when — the tournaments drawn this season and the ones the FIVB
 * cycle brings after them, each with how long until it starts. Down the side,
 * the manager's nation and where it stands, then this season's tournaments —
 * live, coming up, done — and the honours. The one picked out in full: where
 * it stands on its way from squads to final, how its field was made, the
 * manager's own players at it, the pools, the bracket, the results, and any
 * nation's squad.
 */

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { POSITION_NAMES, type Position } from '../../engine/model/positions.ts';
import {
  championsTitle, internationalCalendar, poolTable, userNation, worldRanking,
  type CalendarEvent, type IntlMatch, type Tournament, type TournamentKind,
} from '../../engine/world/internationals.ts';
import { competitionStats } from '../../engine/world/competitionStats.ts';
import { NATIONS, type Confederation } from '../../engine/world/nations.ts';
import { ClubLink, Empty, Flag, PlayerLink, Segmented, SortTh, sortBy, useListPages, useSort } from '../components.tsx';
import { NationCoachLine } from '../nationCoach.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';

const MEDALS = ['gold', 'silver', 'bronze'] as const;

function nationName(n: number): string {
  return NATIONS[n]?.name ?? '?';
}

function Nation({ n, bold = false }: { n: number; bold?: boolean }): JSX.Element {
  return <span className={`intl-nation${bold ? ' won' : ''}`}><Flag nation={n} /> {nationName(n)}</span>;
}

/** How long until a day: "Today", "In 5 days", "In 3 weeks", "In 4 months". */
function until(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.4);
  return `In ${months} month${months === 1 ? '' : 's'}`;
}

function live(t: Tournament): boolean {
  return t.status === 'pools' || t.status === 'knockout';
}

/** Where a tournament stands, in a few words. */
function statusLabel(t: Tournament, today: number): string {
  if (t.status === 'planned') return t.callUpDay > today ? `Squads named ${until(t.callUpDay - today).toLowerCase()}` : 'Squads due';
  if (t.status === 'called') return `Starts ${until(t.startDay - today).toLowerCase()}`;
  if (t.status === 'pools') return 'Live · pool stage';
  if (t.status === 'knockout') return 'Live · knockout rounds';
  if (t.kind === 'qualifier') return `${t.places ?? 0} nations through`;
  return `${nationName(t.placings[0])} ${championsTitle(t)}`;
}

/** How a tournament's places are earned — the FIVB's rules, as the game plays them. */
function qualificationRule(t: Tournament): string {
  const rules: Readonly<Record<TournamentKind, string>> = {
    worlds: 'The hosts, the holders, the top three of each continental championship the year before, and the rest by world ranking — 32 nations.',
    olympics: 'The hosts, the champions of each continental championship two years before, the best three at the World Championship the year before not yet in, and the rest by world ranking — 12 nations.',
    continental: t.confederation === 'CEV'
      ? 'The hosts, the top eight of the last European Championship, and the nations through the qualifiers the summer before — 24 nations.'
      : 'Every nation of the confederation plays.',
    nationsLeague: 'The same eighteen every year, bar one: the last-placed nation goes down, and the best-ranked nation outside the league comes up.',
    qualifier: `Pools of four: the winners, the runners-up and the best third-placed teams take the ${t.places ?? 0} places at the championship.`,
    friendly: 'Arranged between the two federations: one match, for the practice — it counts for caps, not for the ranking.',
  };
  return rules[t.kind];
}

/** The colour a kind of tournament is marked with. */
const KIND_CLASS: Readonly<Record<TournamentKind, string>> = {
  olympics: 'k-olympics', worlds: 'k-worlds', continental: 'k-continental', qualifier: 'k-qualifier', nationsLeague: 'k-vnl',
  friendly: 'k-qualifier',
};

/** The nation the manager follows: the one he coaches, or his own. */
function followedNation(g: ReturnType<typeof useGame>): number {
  const world = g.world!;
  const coached = userNation(world);
  return coached >= 0 ? coached : g.club?.nation ?? world.manager.nation;
}

export function InternationalsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const I = world.internationals;
  const today = world.day;
  const tournaments = I?.tournaments ?? [];
  const nowOn = tournaments.filter(live).sort((a, b) => a.startDay - b.startDay);
  const coming = tournaments.filter((t) => t.status === 'planned' || t.status === 'called').sort((a, b) => a.startDay - b.startDay);
  const done = tournaments.filter((t) => t.status === 'done').sort((a, b) => b.startDay - a.startDay);
  const [picked, setPicked] = useState<number | null>(g.focusTournament);
  /** A competition open on a page of its own: a tournament, or the past editions of one long gone. */
  const [opened, setOpened] = useState<{ id: number | null; name: string; kind: TournamentKind; confederation: Confederation | null } | null>(null);
  const t = tournaments.find((x) => x.id === picked) ?? nowOn[0] ?? coming[0] ?? done[0];
  const home = followedNation(g);
  const conf = NATIONS[home]?.confederation ?? 'CEV';
  const calendar = internationalCalendar(world, conf).slice(0, 5);

  const pick = (x: Tournament): JSX.Element => (
    <button key={x.id} className={`intl-pick ${KIND_CLASS[x.kind]}${t?.id === x.id ? ' on' : ''}`} onClick={() => setPicked(x.id)}>
      <b>{x.name}</b>
      <small>
        {x.status === 'done' && x.kind !== 'qualifier' && <Flag nation={x.placings[0]} />}
        {statusLabel(x, today)}
        {x.teams.includes(home) && x.status !== 'done' && <span className="intl-in">{NATIONS[home]?.code ?? ''} in</span>}
      </small>
    </button>
  );

  if (opened !== null) {
    return (
      <div className="intl intl-open">
        <CompetitionPage key={`${opened.id}-${opened.name}`} t={tournaments.find((x) => x.id === opened.id)} series={opened}
          onBack={() => setOpened(null)} />
      </div>
    );
  }

  return (
    <div className="intl">
      <aside className="intl-side">
        <h2 className="intl-title">International</h2>
        <NationCard nation={home} calendar={calendar} onPick={setPicked} />
        <div className="intl-list">
          {nowOn.length > 0 && <span className="intl-group live"><i /> Live now</span>}
          {nowOn.map(pick)}
          {coming.length > 0 && <span className="intl-group">Coming up</span>}
          {coming.map(pick)}
          {done.length > 0 && <span className="intl-group">Finished</span>}
          {done.map(pick)}
          {tournaments.length === 0 && <p className="intl-none">No tournaments drawn yet.</p>}
        </div>
        <h3 className="intl-h">Honours</h3>
        <div className="intl-honours">
          {[...(I?.history ?? [])].reverse().map((h, i) => (
            <button key={`${h.name}-${i}`} className="intl-honour" title="Open this competition"
              onClick={() => setOpened({ id: tournaments.find((x) => x.name === h.name)?.id ?? null, name: h.name, kind: h.kind, confederation: h.confederation })}>
              <span className="faint">{h.name}</span>
              <Nation n={h.podium[0]} />
            </button>
          ))}
          {(I?.history.length ?? 0) === 0 && <p className="intl-none">No tournament finished yet.</p>}
        </div>
      </aside>
      <section className="intl-main">
        <RoadAhead events={calendar} picked={t?.id ?? null} onPick={setPicked} />
        {t !== undefined ? <TournamentView key={t.id} t={t} onOpen={() => setOpened({ id: t.id, name: t.name, kind: t.kind, confederation: t.confederation })} /> : <Empty>Nothing on the international calendar yet.</Empty>}
      </section>
    </div>
  );
}

/** The manager's nation: its place in the world, and its next date. */
function NationCard({ nation, calendar, onPick }: {
  nation: number; calendar: CalendarEvent[]; onPick: (id: number) => void;
}): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  if (NATIONS[nation] === undefined) return null;
  const rank = worldRanking(world).indexOf(nation) + 1;
  const coached = userNation(world) === nation;
  // Its next tournament: one it is in, or — not drawn yet — the next it could be.
  const next = calendar.find((e) => e.tournament === undefined || e.tournament.teams.includes(nation));
  const inIt = next?.tournament?.teams.includes(nation) ?? false;
  return (
    <div className="intl-nation-card">
      <div className="intl-nation-top">
        <Flag nation={nation} />
        <div>
          <b>{nationName(nation)}</b>
          <span className="faint">{coached ? 'Your national team' : 'Your nation'} · #{rank} in the world</span>
        </div>
      </div>
      {!coached && <NationCoachLine nation={nation} />}
      {next !== undefined && (
        <button
          className="intl-nation-next"
          disabled={next.tournament === undefined}
          onClick={() => next.tournament !== undefined && onPick(next.tournament.id)}
        >
          <span className="intl-nation-next-label">Next</span>
          <b>{next.name}</b>
          <span className="faint">
            {g.dateLabelForDay(next.startDay)} · {until(next.startDay - world.day)}
            {next.tournament !== undefined ? (inIt ? ' · in the field' : '') : ` · field drawn ${g.dateLabelForDay(next.drawDay)}`}
          </span>
        </button>
      )}
    </div>
  );
}

/** What is coming, and when: the next events on the international calendar, drawn or still to be. */
function RoadAhead({ events, picked, onPick }: {
  events: CalendarEvent[]; picked: number | null; onPick: (id: number) => void;
}): JSX.Element {
  const g = useGame();
  const today = g.world!.day;
  return (
    <section className="intl-road">
      <h3 className="intl-h">The road ahead</h3>
      <div className="intl-road-line">
        {events.map((e) => {
          const t = e.tournament;
          const isLive = t !== undefined && live(t);
          const when = isLive ? 'Live now' : until(e.startDay - today);
          return (
            <button
              key={`${e.kind}-${e.year}-${e.confederation ?? ''}`}
              className={`intl-road-stop ${KIND_CLASS[e.kind]}${t !== undefined && t.id === picked ? ' on' : ''}${isLive ? ' live' : ''}`}
              disabled={t === undefined}
              onClick={() => t !== undefined && onPick(t.id)}
              title={t === undefined ? `Drawn on ${g.dateLabelForDay(e.drawDay)}` : undefined}
            >
              <span className="intl-road-dot" />
              <span className="intl-road-when">{when}</span>
              <b>{e.name}</b>
              <span className="faint">
                {t !== undefined
                  ? `${g.dateLabelForDay(e.startDay)} – ${g.dateLabelForDay(e.endDay)}`
                  : `From ${g.dateLabelForDay(e.startDay)} · not drawn yet`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** A tournament's way from squads to final, with today on it. */
function Stepper({ t }: { t: Tournament }): JSX.Element {
  const g = useGame();
  const pools = t.matches.filter((m) => m.round < 0).map((m) => m.day);
  const lastPool = pools.length > 0 ? Math.max(...pools) : t.startDay;
  const finalDay = t.knockoutDays[t.knockoutDays.length - 1];
  const order = ['planned', 'called', 'pools', 'knockout', 'done'];
  const at = order.indexOf(t.status);
  const steps: Array<{ label: string; when: string; from: number }> = [
    { label: 'Squads named', when: g.dateLabelForDay(t.callUpDay), from: 1 },
    { label: 'Pool stage', when: `${g.dateLabelForDay(t.startDay)} – ${g.dateLabelForDay(lastPool)}`, from: 2 },
    ...(t.kind === 'qualifier'
      ? [{ label: 'Places decided', when: g.dateLabelForDay(lastPool), from: 4 }]
      : [
        { label: 'Knockout', when: `${g.dateLabelForDay(t.knockoutDays[0])} – ${g.dateLabelForDay(finalDay)}`, from: 3 },
        { label: 'Final', when: g.dateLabelForDay(finalDay), from: 4 },
      ]),
  ];
  return (
    <ol className="intl-steps">
      {steps.map((s, i) => {
        const doneStep = at > s.from || (at === 4 && s.from === 4);
        const current = !doneStep && (at === s.from || (i === 0 && at === 0));
        return (
          <li key={s.label} className={`${doneStep ? 'done' : ''}${current ? ' current' : ''}`}>
            <span className="intl-step-dot">{doneStep ? <Icon name="check" size={11} /> : i + 1}</span>
            <span className="intl-step-text"><b>{s.label}</b><span className="faint">{s.when}</span></span>
          </li>
        );
      })}
    </ol>
  );
}

/** A tournament's headline: what it is, where it stands, its way to the final and its medals. */
function TournamentHead({ t, action }: { t: Tournament; action?: ReactNode }): JSX.Element {
  const g = useGame();
  const today = g.world!.day;
  const chip = live(t) ? 'Live'
    : t.status === 'done' ? 'Finished'
      : until(t.startDay - today);
  return (
    <header className={`intl-head ${KIND_CLASS[t.kind]}`}>
      <div className="intl-head-top">
        <span className="intl-kicker">
          <Icon name="world" size={14} /> {t.confederation ?? 'FIVB'} · {t.teams.length} nations
          {t.host >= 0 && <> · Hosts <Flag nation={t.host} /> {nationName(t.host)}</>}
        </span>
        <span className="intl-head-actions">
          {action}
          <span className={`intl-chip${live(t) ? ' live' : t.status === 'done' ? ' done' : ''}`}>
            {live(t) && <i />}{chip}
          </span>
        </span>
      </div>
      <h1 className="intl-name">{t.name}</h1>
      <span className="intl-head-status">{statusLabel(t, today)}</span>
      <Stepper t={t} />
      {t.status === 'done' && t.kind !== 'qualifier' && (
        <div className="intl-podium">
          {t.placings.slice(0, 3).map((n, i) => (
            <span key={n} className={`intl-medal ${MEDALS[i]}`}><Icon name="trophy" size={14} /> <Nation n={n} /></span>
          ))}
          {t.mvp >= 0 && <span className="intl-mvp">MVP <PlayerLink idx={t.mvp} /></span>}
        </div>
      )}
    </header>
  );
}

/** The manager's own club players at a tournament, if any are. */
function OursCard({ t }: { t: Tournament }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const ours = world.userClubId < 0 ? [] : t.squads.flatMap(([n, squad]) =>
    squad.filter((p) => store.clubId[p] === world.userClubId).map((p) => [p, n] as const));
  if (ours.length === 0) return null;
  return (
    <section className="intl-card intl-ours">
      <h3 className="intl-h">Your players</h3>
      <table className="data-table">
        <thead><tr><th>Player</th><th>Nation</th><th className="num">Apps</th><th className="num">Pts</th><th className="num">Avg</th><th>Status</th></tr></thead>
        <tbody>
          {ours.map(([p, n]) => {
            const s = t.stats.get(p);
            const home = t.out.includes(n) || t.status === 'done';
            return (
              <tr key={p}>
                <td><PlayerLink idx={p} /></td>
                <td><Nation n={n} /></td>
                <td className="num">{s?.[0] ?? 0}</td>
                <td className="num">{s?.[1] ?? 0}</td>
                <td className="num">{s !== undefined && s[0] > 0 ? (s[2] / s[0]).toFixed(2) : '—'}</td>
                <td>{t.status === 'planned' ? <span className="faint">Not yet named</span>
                  : home ? <span className="faint">Back at the club</span>
                    : <span className="status-tag status-duty">With the squad</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PoolsCard({ t, home }: { t: Tournament; home: number }): JSX.Element {
  return (
    <section className="intl-card intl-pools">
      <h3 className="intl-h">Pools</h3>
      <div className="intl-pool-grid">
        {t.pools.map((pool) => (
          <table key={pool.name} className="data-table intl-pool">
            <thead><tr><th colSpan={2}>{pool.name}</th><th className="num">P</th><th className="num">W</th><th className="num">Sets</th><th className="num">Pts</th></tr></thead>
            <tbody>
              {poolTable(t, pool).map((r, i) => (
                <tr key={r.clubId} className={`${through(t, r.clubId, i) && t.status !== 'planned' ? 'intl-through' : ''}${r.clubId === home ? ' me' : ''}`}>
                  <td className="num faint">{i + 1}</td>
                  <td><Nation n={r.clubId} /></td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.won}</td>
                  <td className="num">{r.setsFor}:{r.setsAgainst}</td>
                  <td className="num strong">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}

function SquadCard({ t, home }: { t: Tournament; home: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [squadNation, setSquadNation] = useState(t.teams.includes(home) ? home : t.teams[0]);
  const squad = t.squads.find(([n]) => n === squadNation)?.[1] ?? [];
  return (
    <section className="intl-card intl-squad">
      <h3 className="intl-h">
        Squad
        <Dropdown
          size="sm"
          value={squadNation}
          onChange={setSquadNation}
          options={[...t.teams].sort((a, b) => nationName(a).localeCompare(nationName(b))).map((n) => ({
            value: n, label: nationName(n), icon: <Flag nation={n} />,
          }))}
        />
      </h3>
      <NationCoachLine nation={squadNation} />
      {squad.length === 0 ? <p className="intl-none">The squads are named on {g.dateLabelForDay(t.callUpDay)}.</p> : (
        <table className="data-table">
          <thead><tr><th>Player</th><th>Position</th><th>Club</th><th className="num">Caps</th><th className="num">Apps</th><th className="num">Avg</th></tr></thead>
          <tbody>
            {squad.map((p) => {
              const s = t.stats.get(p);
              const club = store.clubId[p];
              return (
                <tr key={p} className={club === world.userClubId ? 'me' : ''}>
                  <td><PlayerLink idx={p} /></td>
                  <td className="dim">{POSITION_NAMES[store.position[p] as Position]}</td>
                  <td>{club >= 0 ? <ClubLink id={club} /> : <span className="faint">Free agent</span>}</td>
                  <td className="num">{store.nationalCaps[p]}</td>
                  <td className="num">{s?.[0] ?? 0}</td>
                  <td className="num">{s !== undefined && s[0] > 0 ? (s[2] / s[0]).toFixed(2) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TournamentView({ t, onOpen }: { t: Tournament; onOpen: () => void }): JSX.Element {
  const g = useGame();
  const homeNation = followedNation(g);
  return (
    <div className="intl-view">
      <TournamentHead t={t} action={<button className="sm primary" onClick={onOpen}><Icon name="expand" size={13} /> Open competition</button>} />
      <div className="intl-grid">
        <Qualification t={t} home={homeNation} />
        <OursCard t={t} />
        <PoolsCard t={t} home={homeNation} />
        {t.kind !== 'qualifier' && (
          <section className="intl-card intl-bracket-card">
            <h3 className="intl-h">Knockout</h3>
            <Bracket t={t} />
          </section>
        )}
        <section className="intl-card intl-results">
          <h3 className="intl-h">Results</h3>
          <Results t={t} />
        </section>
        <SquadCard t={t} home={homeNation} />
      </div>
    </div>
  );
}

type CompTab = 'overview' | 'pools' | 'knockout' | 'results' | 'squads' | 'stats' | 'past';

/**
 * One competition, on a page of its own: the tournament being looked at —
 * its pools, knockout, results, squads and statistics, nothing of any other —
 * and its past editions and how they finished. A competition whose last
 * tournament is long gone has its past editions alone.
 */
function CompetitionPage({ t, series, onBack }: {
  t?: Tournament;
  series: { name: string; kind: TournamentKind; confederation: Confederation | null };
  onBack: () => void;
}): JSX.Element {
  const g = useGame();
  const home = followedNation(g);
  const tabs: Array<[CompTab, string]> = t !== undefined
    ? [
      ['overview', 'Overview'], ['pools', 'Pools'],
      ...(t.kind !== 'qualifier' ? [['knockout', 'Knockout'] as [CompTab, string]] : []),
      ['results', 'Results'], ['squads', 'Squads'], ['stats', 'Stats'], ['past', 'Past editions'],
    ]
    : [['past', 'Past editions']];
  const [picked, setTab] = useState<CompTab>(tabs[0][0]);
  const tab = tabs.some(([k]) => k === picked) ? picked : tabs[0][0];
  return (
    <section className="intl-main">
      <div className="intl-view">
        <button className="sm intl-back" onClick={onBack}><Icon name="back" size={13} /> All competitions</button>
        {t !== undefined ? <TournamentHead t={t} /> : (
          <header className={`intl-head ${KIND_CLASS[series.kind]}`}>
            <span className="intl-kicker"><Icon name="world" size={14} /> {series.confederation ?? 'FIVB'}</span>
            <h1 className="intl-name">{series.name}</h1>
          </header>
        )}
        <div className="intl-tabs" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" className={`hdr-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="intl-grid">
          {t !== undefined && tab === 'overview' && (
            <>
              <Qualification t={t} home={home} />
              <OursCard t={t} />
              <section className="intl-card intl-results">
                <h3 className="intl-h">Standings</h3>
                <NationsTable t={t} home={home} />
              </section>
            </>
          )}
          {t !== undefined && tab === 'pools' && <PoolsCard t={t} home={home} />}
          {t !== undefined && tab === 'knockout' && (
            <section className="intl-card intl-bracket-card">
              <h3 className="intl-h">Knockout</h3>
              <Bracket t={t} />
            </section>
          )}
          {t !== undefined && tab === 'results' && (
            <section className="intl-card intl-results">
              <h3 className="intl-h">Results</h3>
              <Results t={t} />
            </section>
          )}
          {t !== undefined && tab === 'squads' && <SquadCard t={t} home={home} />}
          {t !== undefined && tab === 'stats' && <TournamentStats t={t} home={home} />}
          {tab === 'past' && <PastEditions kind={series.kind} confederation={series.confederation} />}
        </div>
      </div>
    </section>
  );
}

/** Every nation at a tournament: its record, and where it finished once it is over. */
function NationsTable({ t, home }: { t: Tournament; home: number }): JSX.Element {
  const rows = t.teams.map((n) => {
    let won = 0;
    let lost = 0;
    let setsFor = 0;
    let setsAgainst = 0;
    for (const m of t.matches) {
      if (!m.played || (m.home !== n && m.away !== n)) continue;
      const us = m.home === n ? m.homeSets : m.awaySets;
      const them = m.home === n ? m.awaySets : m.homeSets;
      setsFor += us;
      setsAgainst += them;
      if (us > them) won++;
      else lost++;
    }
    return { n, won, lost, setsFor, setsAgainst, place: t.placings.indexOf(n) };
  });
  const ranked = t.status === 'done' && t.placings.length > 0;
  rows.sort((a, b) => (ranked && a.place >= 0 && b.place >= 0 ? a.place - b.place : 0)
    || b.won - a.won || (b.setsFor - b.setsAgainst) - (a.setsFor - a.setsAgainst));
  return (
    <table className="data-table">
      <thead>
        <tr><th className="num">{ranked ? 'Place' : '#'}</th><th>Nation</th><th className="num">P</th><th className="num">W</th><th className="num">L</th><th className="num">Sets</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.n} className={r.n === home ? 'me' : ''}>
            <td className="num strong">{ranked && r.place >= 0 ? r.place + 1 : i + 1}</td>
            <td><Nation n={r.n} /></td>
            <td className="num">{r.won + r.lost}</td>
            <td className="num">{r.won}</td>
            <td className="num">{r.lost}</td>
            <td className="num dim">{r.setsFor}:{r.setsAgainst}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type StatKey = 'name' | 'apps' | 'points' | 'perApp' | 'kills' | 'aces' | 'blocks' | 'digs' | 'assists' | 'avg' | 'mvps';

/** A tournament's numbers: its nations, and every player who played at it. */
function TournamentStats({ t, home }: { t: Tournament; home: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [view, setView] = useState<'players' | 'nations'>('players');
  const [sort, onSort] = useSort<StatKey>('points');
  const lines = useMemo(() => {
    const nationOf = new Map(t.squads.flatMap(([n, squad]) => squad.map((p) => [p, n] as const)));
    const box = new Map(competitionStats(world, t.competitionId, t.season).players.map((s) => [s.p, s]));
    const out: Array<{ p: number; nation: number; apps: number; points: number; ratingSum: number; mvps: number; kills: number; aces: number; blocks: number; digs: number; assists: number }> = [];
    for (const [p, [apps, points, ratingSum, mvps]] of t.stats) {
      if (apps <= 0) continue;
      const b = box.get(p);
      out.push({
        p, nation: nationOf.get(p) ?? -1, apps, points, ratingSum, mvps,
        kills: b?.kills ?? 0, aces: b?.aces ?? 0, blocks: b?.blocks ?? 0, digs: b?.digs ?? 0, assists: b?.assists ?? 0,
      });
    }
    return out;
  }, [t, t.stats.size, world.day]);
  const rows = sortBy(lines, sort, (l, k) => (k === 'name' ? store.shortName(l.p)
    : k === 'perApp' ? l.points / l.apps : k === 'avg' ? l.ratingSum / l.apps : l[k]));
  const { shown, more } = useListPages(rows, `${sort.key}/${sort.dir}`, -1, 11);
  const col = (k: StatKey, label: string, title?: string): JSX.Element => (
    <SortTh k={k} sort={sort} onSort={onSort} num title={title}>{label}</SortTh>
  );
  return (
    <section className="intl-card intl-results">
      <h3 className="intl-h">
        Statistics
        <Segmented size="sm" value={view} onChange={setView} options={[['players', 'Players'], ['nations', 'Nations']]} />
      </h3>
      {view === 'nations' ? <NationsTable t={t} home={home} /> : lines.length === 0 ? <p className="intl-none">No matches played yet.</p> : (
        <table className="data-table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} onSort={onSort}>Player</SortTh>
              <th>Nation</th>
              {col('apps', 'Apps')}{col('points', 'Pts')}{col('perApp', 'Pts/G', 'Points a game')}{col('kills', 'Kills')}{col('aces', 'Aces')}
              {col('blocks', 'Blk', 'Blocks')}{col('digs', 'Digs')}{col('assists', 'Ast', 'Assists')}{col('avg', 'Avg', 'Average match rating')}{col('mvps', 'MVP')}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.p} className={l.nation === home ? 'me' : ''}>
                <td><PlayerLink idx={l.p} /></td>
                <td>{l.nation >= 0 ? <Nation n={l.nation} /> : '—'}</td>
                <td className="num">{l.apps}</td>
                <td className="num strong">{l.points}</td>
                <td className="num">{(l.points / l.apps).toFixed(1)}</td>
                <td className="num">{l.kills}</td>
                <td className="num">{l.aces}</td>
                <td className="num">{l.blocks}</td>
                <td className="num">{l.digs}</td>
                <td className="num">{l.assists}</td>
                <td className="num">{(l.ratingSum / l.apps).toFixed(2)}</td>
                <td className="num">{l.mvps}</td>
              </tr>
            ))}
            {more}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** A competition's finished editions, the latest first, and any one's final placings. */
function PastEditions({ kind, confederation }: { kind: TournamentKind; confederation: Confederation | null }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const home = followedNation(g);
  const records = (world.internationals?.history ?? [])
    .filter((h) => h.kind === kind && h.confederation === confederation)
    .sort((a, b) => b.year - a.year);
  const [year, setYear] = useState<number | null>(null);
  const r = records.find((x) => x.year === year) ?? records[0];
  if (r === undefined) return <section className="intl-card intl-results"><p className="intl-none">No edition has finished yet.</p></section>;
  const placings = r.placings ?? r.podium;
  return (
    <>
      <section className="intl-card">
        <h3 className="intl-h">Editions</h3>
        <div className="intl-editions">
          {records.map((x) => (
            <button key={x.year} className={`intl-edition${x === r ? ' on' : ''}`} onClick={() => setYear(x.year)}>
              <b>{x.year}</b>
              <Nation n={x.podium[0]} />
            </button>
          ))}
        </div>
      </section>
      <section className="intl-card">
        <h3 className="intl-h">{r.name} · final placings</h3>
        {r.mvp >= 0 && <p className="intl-rule">MVP: <PlayerLink idx={r.mvp} /></p>}
        <table className="data-table">
          <thead><tr><th className="num">Place</th><th>Nation</th></tr></thead>
          <tbody>
            {placings.map((n, i) => (
              <tr key={n} className={n === home ? 'me' : ''}>
                <td className="num strong">{i < 3 ? <span className={`intl-place ${MEDALS[i]}`}>{i + 1}</span> : i + 1}</td>
                <td><Nation n={n} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.placings === undefined && <p className="intl-none">Only the top four of this edition were kept.</p>}
      </section>
    </>
  );
}

/** Whether a pool row is going through: into the knockout rounds — or, in qualifiers, to the championship. */
function through(t: Tournament, nation: number, row: number): boolean {
  if (t.kind !== 'qualifier') return row < t.advance;
  if (t.status === 'done') return t.placings.indexOf(nation) < (t.places ?? 0);
  return row < 2;
}

/** How the field was made: the rule, and each nation's route in — or, for qualifiers, who went through. */
function Qualification({ t, home }: { t: Tournament; home: number }): JSX.Element {
  const qualifier = t.kind === 'qualifier';
  const list: Array<[number, string]> = qualifier
    ? t.status === 'done'
      ? t.placings.slice(0, t.places ?? 0).map((n) => [n, 'Through'])
      : []
    : t.entry ?? [];
  return (
    <section className="intl-card intl-qualify">
      <h3 className="intl-h">{qualifier ? 'Who goes through' : 'Qualification'}</h3>
      <p className="intl-rule">{qualificationRule(t)}</p>
      {list.length > 0 ? (
        <div className="intl-entry">
          {list.map(([n, why]) => (
            <span key={n} className={`intl-entry-row${n === home ? ' me' : ''}`}>
              <Nation n={n} />
              <span className="faint">{why}</span>
            </span>
          ))}
        </div>
      ) : qualifier ? (
        <p className="intl-none">The places are decided when the pools are over.</p>
      ) : (
        <p className="intl-none">Drawn before qualification was kept — every nation here came in on the world ranking.</p>
      )}
    </section>
  );
}

function MatchRow({ m }: { m: IntlMatch }): JSX.Element {
  const homeWon = m.played && m.homeSets > m.awaySets;
  const awayWon = m.played && m.awaySets > m.homeSets;
  return (
    <div className={`intl-match${m.bronze ? ' bronze' : ''}`}>
      <span className="intl-match-stage">{m.stage}</span>
      <Nation n={m.home} bold={homeWon} />
      <b className="intl-score">{m.played ? `${m.homeSets}-${m.awaySets}` : 'v'}</b>
      <Nation n={m.away} bold={awayWon} />
    </div>
  );
}

/** The knockout rounds, a column each. */
function Bracket({ t }: { t: Tournament }): JSX.Element {
  const g = useGame();
  const rounds = [...new Set(t.matches.filter((m) => m.round >= 0).map((m) => m.round))].sort((a, b) => a - b);
  if (rounds.length === 0) {
    return <p className="intl-none">The top {t.advance} in each pool go through. The knockout rounds start on {g.dateLabelForDay(t.knockoutDays[0])}.</p>;
  }
  return (
    <div className="intl-bracket">
      {rounds.map((r) => (
        <div key={r} className="intl-round">
          {t.matches.filter((m) => m.round === r).sort((a, b) => Number(a.bronze) - Number(b.bronze) || a.slot - b.slot)
            .map((m) => <MatchRow key={m.id} m={m} />)}
        </div>
      ))}
    </div>
  );
}

/** Every match by day — the latest first — and the next day's to come. */
function Results({ t }: { t: Tournament }): JSX.Element {
  const g = useGame();
  const played = t.matches.filter((m) => m.played);
  const next = t.matches.filter((m) => !m.played).sort((a, b) => a.day - b.day);
  const nextDay = next[0]?.day;
  const days = [...new Set(played.map((m) => m.day))].sort((a, b) => b - a);
  return (
    <div className="intl-days">
      {nextDay !== undefined && (
        <div className="intl-day">
          <span className="intl-day-label">Next · {g.dateLabelForDay(nextDay)}</span>
          {next.filter((m) => m.day === nextDay).map((m) => <MatchRow key={m.id} m={m} />)}
        </div>
      )}
      {days.map((d) => (
        <div key={d} className="intl-day">
          <span className="intl-day-label">{g.dateLabelForDay(d)}</span>
          {played.filter((m) => m.day === d).map((m) => <MatchRow key={m.id} m={m} />)}
        </div>
      ))}
      {played.length === 0 && nextDay === undefined && <p className="intl-none">No matches yet.</p>}
    </div>
  );
}
