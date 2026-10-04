/**
 * The national teams' tournaments: this season's — the summer's major, the
 * Nations League — and every edition played, down the side; the one picked
 * out in full on the right: where it stands, the medals, the manager's own
 * players at it, the pools, the bracket, the results, and any nation's squad.
 */

import { useState, type JSX } from 'react';
import { POSITION_NAMES, type Position } from '../../engine/model/positions.ts';
import {
  championsTitle, poolTable, type IntlMatch, type Tournament, type TournamentKind,
} from '../../engine/world/internationals.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { ClubLink, Empty, Flag, PlayerLink } from '../components.tsx';
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

/** Where a tournament stands, in a few words. */
function statusLabel(t: Tournament, dateOf: (day: number) => string): string {
  if (t.status === 'planned') return `Squads named ${dateOf(t.callUpDay)}`;
  if (t.status === 'called') return `Starts ${dateOf(t.startDay)}`;
  if (t.status === 'pools') return 'Pool stage';
  if (t.status === 'knockout') return 'Knockout rounds';
  if (t.kind === 'qualifier') return `${t.places ?? 0} nations through`;
  return `${nationName(t.placings[0])} ${championsTitle(t)}`;
}

/** How a tournament's places are earned — the FIVB's rules, as the game plays them. */
function qualificationRule(t: Tournament): string {
  const rules: Readonly<Record<TournamentKind, string>> = {
    worlds: 'The hosts, the holders, the top three of each continental championship the year before, and the rest by world ranking — 32 nations.',
    olympics: 'The hosts, the champions of each continental championship two years before, the best three at the World Championship the year before not yet in, and the rest by world ranking — 12 nations.',
    continental: t.confederation === 'CEV'
      ? 'The hosts, the top eight of the last EuroVolley, and the nations through the qualifiers the summer before — 24 nations.'
      : 'Every nation of the confederation plays.',
    nationsLeague: 'The same eighteen every year, bar one: the last-placed nation goes down, and the best-ranked nation outside the league comes up.',
    qualifier: `Pools of four: the winners, the runners-up and the best third-placed teams take the ${t.places ?? 0} places at the championship.`,
  };
  return rules[t.kind];
}

/** Live first, then the ones to come, then the ones done — the latest first. */
function ordered(list: readonly Tournament[]): Tournament[] {
  const rank = (t: Tournament): number => (t.status === 'pools' || t.status === 'knockout' ? 0 : t.status === 'done' ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.startDay - a.startDay : a.startDay - b.startDay));
}

export function InternationalsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const I = world.internationals;
  const list = ordered(I?.tournaments ?? []);
  const [picked, setPicked] = useState<number | null>(g.focusTournament);
  const t = list.find((x) => x.id === picked) ?? list[0];
  const dateOf = (day: number): string => g.dateLabelForDay(day);

  return (
    <div className="intl">
      <aside className="intl-side">
        <h2 className="intl-title">International</h2>
        <div className="intl-list">
          {list.map((x) => (
            <button key={x.id} className={`intl-pick${t?.id === x.id ? ' on' : ''}`} onClick={() => setPicked(x.id)}>
              <b>{x.name}</b>
              <small>
                {x.status === 'done' && <Flag nation={x.placings[0]} />} {statusLabel(x, dateOf)}
              </small>
            </button>
          ))}
          {list.length === 0 && <p className="intl-none">No tournaments drawn yet.</p>}
        </div>
        <h3 className="intl-h">Honours</h3>
        <div className="intl-honours">
          {[...(I?.history ?? [])].reverse().map((h, i) => (
            <div key={`${h.name}-${i}`} className="intl-honour">
              <span className="faint">{h.name}</span>
              <Nation n={h.podium[0]} />
            </div>
          ))}
          {(I?.history.length ?? 0) === 0 && <p className="intl-none">No tournament finished yet.</p>}
        </div>
      </aside>
      <section className="intl-main">
        {t !== undefined ? <TournamentView key={t.id} t={t} /> : <Empty>Nothing on the international calendar yet.</Empty>}
      </section>
    </div>
  );
}

function TournamentView({ t }: { t: Tournament }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const finalDay = t.knockoutDays[t.knockoutDays.length - 1];
  const ours = world.userClubId < 0 ? [] : t.squads.flatMap(([n, squad]) =>
    squad.filter((p) => store.clubId[p] === world.userClubId).map((p) => [p, n] as const));
  const homeNation = g.club?.nation ?? world.manager.nation;
  const [squadNation, setSquadNation] = useState(t.teams.includes(homeNation) ? homeNation : t.teams[0]);
  const squad = t.squads.find(([n]) => n === squadNation)?.[1] ?? [];

  return (
    <div className="intl-view">
      <header className="intl-head">
        <span className="intl-kicker">
          <Icon name="world" size={14} /> {t.confederation ?? 'FIVB'} · {t.teams.length} nations
        </span>
        <h1 className="intl-name">{t.name}</h1>
        <span className="faint">
          Squads named {g.dateLabelForDay(t.callUpDay)} · {g.dateLabelForDay(t.startDay)} – {g.dateLabelForDay(finalDay)} ·{' '}
          <b className="intl-status">{statusLabel(t, (d) => g.dateLabelForDay(d))}</b>
        </span>
        {t.status === 'done' && t.kind !== 'qualifier' && (
          <div className="intl-podium">
            {t.placings.slice(0, 3).map((n, i) => (
              <span key={n} className={`intl-medal ${MEDALS[i]}`}><Icon name="trophy" size={14} /> <Nation n={n} /></span>
            ))}
            {t.mvp >= 0 && <span className="intl-mvp">MVP <PlayerLink idx={t.mvp} /></span>}
          </div>
        )}
      </header>

      <div className="intl-grid">
        <Qualification t={t} home={homeNation} />

        {ours.length > 0 && (
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
        )}

        <section className="intl-card intl-pools">
          <h3 className="intl-h">Pools</h3>
          <div className="intl-pool-grid">
            {t.pools.map((pool) => (
              <table key={pool.name} className="data-table intl-pool">
                <thead><tr><th colSpan={2}>{pool.name}</th><th className="num">P</th><th className="num">W</th><th className="num">Sets</th><th className="num">Pts</th></tr></thead>
                <tbody>
                  {poolTable(t, pool).map((r, i) => (
                    <tr key={r.clubId} className={`${through(t, r.clubId, i) && t.status !== 'planned' ? 'intl-through' : ''}${r.clubId === homeNation ? ' me' : ''}`}>
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
      </div>
    </div>
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
