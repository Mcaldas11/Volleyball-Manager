import { useMemo, useState, type JSX } from 'react';
import type { Position } from '../engine/model/positions.ts';
import {
  competitionStats, efficiency, passing, type PlayerCompStats, type TeamCompStats,
} from '../engine/world/competitionStats.ts';
import type { Competition } from '../engine/world/world.ts';
import { ClubLink, Empty, PlayerFace, Pos, RatingBadge, Segmented, SortTh, sortBy, useSort } from './components.tsx';
import { useGame } from './state.ts';

type View = 'teams' | 'players';
type TeamKey = 'club' | 'm' | 'w' | 'sets' | 'pf' | 'pa' | 'kills' | 'eff' | 'aces' | 'blocks' | 'digs' | 'pass';
type PlayerKey = 'm' | 'rating' | 'points' | 'kills' | 'eff' | 'aces' | 'blocks' | 'digs' | 'pass' | 'assists';

/** Players listed, at most. */
const PLAYER_ROWS = 100;
/** Attacks or passes a rate needs before it can top the chart — fewer early on, this many a match played. */
const MIN_RATE_SAMPLE = 60;
const SAMPLE_PER_MATCH = 15;
const MIN_RATED_APPS = 5;

const perSet = (n: number, sets: number): number => (sets > 0 ? n / sets : 0);
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function teamValue(t: TeamCompStats, k: TeamKey, name: (id: number) => string): number | string {
  const sets = t.setsWon + t.setsLost;
  switch (k) {
    case 'club': return name(t.clubId);
    case 'm': return t.matches;
    case 'w': return t.won * 1000 + (t.setsWon - t.setsLost);
    case 'sets': return t.setsWon - t.setsLost;
    case 'pf': return perSet(t.pointsFor, sets);
    case 'pa': return -perSet(t.pointsAgainst, sets);
    case 'kills': return perSet(t.kills, sets);
    case 'eff': return efficiency(t);
    case 'aces': return perSet(t.aces, sets);
    case 'blocks': return perSet(t.blocks, sets);
    case 'digs': return perSet(t.digs, sets);
    case 'pass': return passing(t);
  }
}

/** Every side in the competition: results, then what they did a set. */
function TeamsTable({ teams }: { teams: TeamCompStats[] }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [sort, onSort] = useSort<TeamKey>('w');
  const name = (id: number): string => world.clubs[id]?.name ?? '';
  const rows = sortBy(teams, sort, (t, k) => teamValue(t, k, name));
  const th = (k: TeamKey, label: string, title?: string, num = true): JSX.Element => (
    <SortTh k={k} sort={sort} onSort={onSort} num={num} title={title}>{label}</SortTh>
  );
  return (
    <section className="card comp-stats-card">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">#</th>
              {th('club', 'Club', undefined, false)}
              {th('m', 'M', 'Matches')}
              {th('w', 'W', 'Wins')}
              {th('sets', 'Sets', 'Sets won–lost')}
              {th('pf', 'Pts/set', 'Points scored a set')}
              {th('pa', 'Conc/set', 'Points conceded a set — fewest first')}
              {th('kills', 'Kills/set')}
              {th('eff', 'Eff', 'Attack efficiency: kills less errors, over attacks')}
              {th('aces', 'Aces/set')}
              {th('blocks', 'Blocks/set')}
              {th('digs', 'Digs/set')}
              {th('pass', 'Pass+', 'Perfect and positive passes')}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const sets = t.setsWon + t.setsLost;
              return (
                <tr key={t.clubId} className={t.clubId === world.userClubId ? 'me' : ''}>
                  <td className="num dim">{i + 1}</td>
                  <td className="strong"><ClubLink id={t.clubId} /></td>
                  <td className="num dim">{t.matches}</td>
                  <td className="num"><b>{t.won}</b><span className="faint">–{t.matches - t.won}</span></td>
                  <td className="num dim">{t.setsWon}–{t.setsLost}</td>
                  <td className="num">{sets > 0 ? perSet(t.pointsFor, sets).toFixed(1) : '—'}</td>
                  <td className="num">{sets > 0 ? perSet(t.pointsAgainst, sets).toFixed(1) : '—'}</td>
                  <td className="num">{sets > 0 ? perSet(t.kills, sets).toFixed(1) : '—'}</td>
                  <td className="num">{t.attacks > 0 ? efficiency(t).toFixed(3) : '—'}</td>
                  <td className="num">{sets > 0 ? perSet(t.aces, sets).toFixed(2) : '—'}</td>
                  <td className="num">{sets > 0 ? perSet(t.blocks, sets).toFixed(2) : '—'}</td>
                  <td className="num dim">{sets > 0 ? perSet(t.digs, sets).toFixed(1) : '—'}</td>
                  <td className="num dim">{t.receptions > 0 ? pct(passing(t)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The competition's players, led by whatever the user ranks them on. */
function PlayersTable({ players }: { players: PlayerCompStats[] }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [sort, onSort] = useSort<PlayerKey>('points');
  // A rate needs a fair sample to top the chart — a smaller one early in the season.
  const mostApps = players.reduce((m, s) => Math.max(m, s.apps), 1);
  const minSample = Math.min(MIN_RATE_SAMPLE, SAMPLE_PER_MATCH * mostApps);
  const minApps = Math.min(MIN_RATED_APPS, mostApps);
  const value = (s: PlayerCompStats, k: PlayerKey): number => {
    switch (k) {
      case 'm': return s.apps;
      case 'rating': return (s.apps >= minApps ? 100 : 0) + s.ratingSum / s.apps;
      case 'points': return s.points;
      case 'kills': return s.kills;
      case 'eff': return (s.attacks >= minSample ? 10 : 0) + efficiency(s);
      case 'aces': return s.aces;
      case 'blocks': return s.blocks;
      case 'digs': return s.digs;
      case 'pass': return (s.receptions >= minSample ? 10 : 0) + passing(s);
      case 'assists': return s.assists;
    }
  };
  const rows = sortBy(players, sort, value).slice(0, PLAYER_ROWS);
  const th = (k: PlayerKey, label: string, title?: string): JSX.Element => (
    <SortTh k={k} sort={sort} onSort={onSort} num title={title}>{label}</SortTh>
  );
  return (
    <section className="card comp-stats-card">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th />
              <th>Player</th><th>Pos</th><th>Club</th>
              {th('m', 'M', 'Matches')}
              {th('rating', 'Av Rat', 'Average match rating')}
              {th('points', 'Pts')}
              {th('kills', 'Kills')}
              {th('eff', 'Eff', 'Attack efficiency: kills less errors, over attacks')}
              {th('aces', 'Aces')}
              {th('blocks', 'Blocks')}
              {th('digs', 'Digs')}
              {th('pass', 'Rec+', 'Perfect and positive passes')}
              {th('assists', 'Ast', 'Set assists')}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.p} className={`clickable${s.clubId === world.userClubId && s.clubId >= 0 ? ' me' : ''}`} onClick={() => g.select(s.p)}>
                <td className="num"><span className={`rank-badge${i < 3 ? ` rank-${i + 1}` : ''}`}>{i + 1}</span></td>
                <td className="face-cell"><PlayerFace playerId={store.id[s.p]} name={store.fullName(s.p)} size={26} /></td>
                <td className="strong">{store.fullName(s.p)}</td>
                <td><Pos pos={store.position[s.p] as Position} /></td>
                <td className="dim">{s.clubId >= 0 ? <ClubLink id={s.clubId} short /> : '—'}</td>
                <td className="num dim">{s.apps}</td>
                <td className="num"><RatingBadge value={s.ratingSum / s.apps} size="sm" /></td>
                <td className="num"><strong>{s.points}</strong></td>
                <td className="num">{s.kills}</td>
                <td className="num">{s.attacks > 0 ? efficiency(s).toFixed(3) : '—'}</td>
                <td className="num">{s.aces}</td>
                <td className="num">{s.blocks}</td>
                <td className="num dim">{s.digs}</td>
                <td className="num dim">{s.receptions > 0 ? pct(passing(s)) : '—'}</td>
                <td className="num dim">{s.assists}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A competition's statistics this season: its sides, and its players. */
export function CompetitionStatsView({ comp }: { comp: Competition }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [view, setView] = useState<View>('teams');
  const [mine, setMine] = useState(false);
  const played = comp.fixtureIds.reduce((n, id) => n + (world.fixtures[id]?.played === true ? 1 : 0), 0);
  const stats = useMemo(() => competitionStats(world, comp.id), [world, comp.id, world.day, played]);
  const inIt = world.userClubId >= 0 && stats.teams.some((t) => t.clubId === world.userClubId);
  const players = mine && inIt ? stats.players.filter((s) => s.clubId === world.userClubId) : stats.players;
  const empty = stats.teams.every((t) => t.matches === 0);
  return (
    <div className="comp-stats">
      <div className="comp-stats-bar">
        <Segmented options={[['teams', 'Teams'], ['players', 'Players']] as const} value={view} onChange={setView} />
        {view === 'players' && inIt && (
          <Segmented size="sm" options={[[0, 'Everyone'], [1, 'My club']] as const} value={mine ? 1 : 0} onChange={(v) => setMine(v === 1)} />
        )}
        <span className="faint">
          {empty ? 'No matches played yet this season.'
            : view === 'teams' ? 'Results and what each side did a set — click a heading to rank on it.'
              : 'Everyone who has played in it this season — click a heading to rank on it.'}
        </span>
      </div>
      {empty
        ? <Empty>The statistics fill in as the matches are played.</Empty>
        : view === 'teams' ? <TeamsTable teams={stats.teams} /> : <PlayersTable players={players} />}
    </div>
  );
}
