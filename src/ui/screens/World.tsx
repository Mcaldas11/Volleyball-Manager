import { useState, type JSX } from 'react';
import { attackEfficiency, receptionPositivity } from '../../engine/match/stats.ts';
import type { Position } from '../../engine/model/positions.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { averageRating, seasonTotals } from '../../engine/world/records.ts';
import {
  abilityClass, Card, ClubLink, Empty, Flag, PlayerFace, PlayerLink, Pos, RatingBadge, Segmented, StarMeter,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

type StatKey = 'rating' | 'points' | 'kills' | 'efficiency' | 'aces' | 'blocks' | 'digs' | 'reception';

/** Appearances needed before an average rating can top the chart. */
const MIN_RATED_APPS = 5;

const STAT_COLUMNS: ReadonlyArray<readonly [StatKey, string]> = [
  ['rating', 'Av rating'],
  ['points', 'Points'],
  ['kills', 'Kills'],
  ['efficiency', 'Attack efficiency'],
  ['aces', 'Aces'],
  ['blocks', 'Blocks'],
  ['digs', 'Digs'],
  ['reception', 'Reception'],
];

/** Highlights the column the leaderboard is currently ranked by. */
function col(key: StatKey, sort: StatKey, extra = ''): string {
  return `num${extra !== '' ? ` ${extra}` : ''}${key === sort ? ' col-sorted' : ''}`;
}

/**
 * Season statistics.
 *
 * These are accumulated rally by rally across the whole world, so the leaders
 * are genuinely the players who performed, not a lookup of who has the highest
 * ability rating.
 */
export function StatsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const [sort, setSort] = useState<StatKey>('points');
  const [ownLeagueOnly, setOwnLeagueOnly] = useState(true);

  const club = g.club!;
  const leagueClubs = new Set(world.competitions[club.leagueId]?.participants ?? []);

  const rows = [...g.ctx.stats.values()]
    .filter((s) => s.matches >= 3)
    .filter((s) => !ownLeagueOnly || leagueClubs.has(store.clubId[s.playerIdx]))
    .map((s) => {
      const season = seasonTotals(world, s.playerIdx);
      return {
        s,
        points: s.attackKills + s.serveAces + s.blockPoints,
        efficiency: attackEfficiency(s),
        reception: receptionPositivity(s),
        rating: averageRating(season),
        rated: season.apps >= MIN_RATED_APPS,
      };
    })
    .sort((a, b) => {
      switch (sort) {
        case 'rating':
          if (a.rated !== b.rated) return a.rated ? -1 : 1;
          return b.rating - a.rating;
        case 'kills': return b.s.attackKills - a.s.attackKills;
        case 'efficiency':
          // Require a real sample before an efficiency rate can top the chart.
          if (a.s.attacksTotal < 60 || b.s.attacksTotal < 60) {
            return (b.s.attacksTotal < 60 ? -1 : 0) - (a.s.attacksTotal < 60 ? -1 : 0);
          }
          return b.efficiency - a.efficiency;
        case 'aces': return b.s.serveAces - a.s.serveAces;
        case 'blocks': return b.s.blockPoints - a.s.blockPoints;
        case 'digs': return b.s.digsTotal - a.s.digsTotal;
        case 'reception':
          if (a.s.receptionsTotal < 60 || b.s.receptionsTotal < 60) {
            return (b.s.receptionsTotal < 60 ? -1 : 0) - (a.s.receptionsTotal < 60 ? -1 : 0);
          }
          return b.reception - a.reception;
        default: return b.points - a.points;
      }
    })
    .slice(0, 50);

  return (
    <>
      <div className="comp-bar">
        <div className="comp-bar-title">
          <span className="comp-bar-name">Season {world.year} leaders</span>
          <span className="faint">Accumulated rally by rally from every match played · minimum 3 matches</span>
        </div>
        <Segmented
          options={[[1, 'My league'], [0, 'Whole world']] as const}
          value={ownLeagueOnly ? 1 : 0}
          onChange={(v) => setOwnLeagueOnly(v === 1)}
        />
      </div>

      <Card
        title="Leaderboard"
        icon="stats"
        flush
        actions={<Segmented size="sm" options={STAT_COLUMNS} value={sort} onChange={setSort} />}
      >
        {rows.length === 0
          ? <Empty>No statistics yet — play some matches first.</Empty>
          : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th />
                    <th>Player</th><th>Pos</th><th>Club</th>
                    <th className="num">M</th>
                    <th className={col('rating', sort)} title="Average match rating this season">Av Rat</th>
                    <th className={col('points', sort)}>Pts</th>
                    <th className={col('kills', sort)}>Kills</th>
                    <th className={col('efficiency', sort)}>Eff</th>
                    <th className={col('aces', sort)}>Aces</th>
                    <th className={col('blocks', sort)}>Blocks</th>
                    <th className={col('digs', sort)}>Digs</th>
                    <th className={col('reception', sort)}>Rec+</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.s.playerIdx}
                      className={`clickable${store.clubId[r.s.playerIdx] === club.id ? ' me' : ''}`}
                      onClick={() => g.select(r.s.playerIdx)}
                    >
                      <td className="num">
                        <span className={`rank-badge${i < 3 ? ` rank-${i + 1}` : ''}`}>{i + 1}</span>
                      </td>
                      <td className="face-cell">
                        <PlayerFace playerId={store.id[r.s.playerIdx]} name={store.fullName(r.s.playerIdx)} size={26} />
                      </td>
                      <td className="strong">{store.fullName(r.s.playerIdx)}</td>
                      <td><Pos pos={store.position[r.s.playerIdx] as Position} /></td>
                      <td className="dim">
                        {store.clubId[r.s.playerIdx] >= 0
                          ? <ClubLink id={store.clubId[r.s.playerIdx]} short />
                          : '—'}
                      </td>
                      <td className="num dim">{r.s.matches}</td>
                      <td className={col('rating', sort)}><RatingBadge value={r.rating} size="sm" /></td>
                      <td className={col('points', sort)}><strong>{r.points}</strong></td>
                      <td className={col('kills', sort)}>{r.s.attackKills}</td>
                      <td className={col('efficiency', sort, r.efficiency > 0.35 ? 'good' : '')}>
                        {r.s.attacksTotal > 0 ? r.efficiency.toFixed(3) : '—'}
                      </td>
                      <td className={col('aces', sort)}>{r.s.serveAces}</td>
                      <td className={col('blocks', sort)}>{r.s.blockPoints}</td>
                      <td className={col('digs', sort, 'dim')}>{r.s.digsTotal}</td>
                      <td className={col('reception', sort, 'dim')}>
                        {r.s.receptionsTotal > 0 ? `${(r.reception * 100).toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </>
  );
}

/**
 * World rankings.
 *
 * National team strength, derived from the players each nation can actually
 * call on right now — so it moves as generations turn over, which is the point
 * of watching it across a long career.
 */
export function RankingsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const userNation = g.club !== null ? g.club.nation : -1;

  const ranked = world.nationalTeams
    .map((t) => {
      const squad = t.squad.filter((p) => store.isActive(p));
      const strength = squad.length > 0
        ? squad.reduce((s, p) => s + store.currentAbility[p], 0) / squad.length
        : 0;
      return { team: t, strength, squad };
    })
    .filter((r) => r.squad.length >= 8)
    .sort((a, b) => b.strength - a.strength);

  return (
    <>
      <p className="page-intro">Ranked by the average ability of each nation's current best fourteen.</p>
      <Card title="National Teams" icon="world" flush>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">#</th><th>Nation</th><th>Confederation</th>
                <th>Squad strength</th><th>Best player</th>
                <th className="num">Olympic golds</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const best = [...r.squad].sort(
                  (a, b) => store.currentAbility[b] - store.currentAbility[a],
                )[0];
                return (
                  <tr key={r.team.nation} className={r.team.nation === userNation ? 'me' : ''}>
                    <td className="num">
                      <span className={`rank-badge${i < 3 ? ` rank-${i + 1}` : ''}`}>{i + 1}</span>
                    </td>
                    <td className="strong"><Flag nation={r.team.nation} /> {NATIONS[r.team.nation].name}</td>
                    <td className="dim">{NATIONS[r.team.nation].confederation}</td>
                    <td>
                      <span className="ability-cell">
                        <StarMeter value={r.strength} size={11} />
                        <span className={abilityClass(r.strength)}>{r.strength.toFixed(0)}</span>
                      </span>
                    </td>
                    <td className="dim">{best !== undefined ? <PlayerLink idx={best} /> : '—'}</td>
                    <td className="num">
                      {r.team.olympicGolds > 0
                        ? <span className="gold-text"><Icon name="trophy" size={13} /> {r.team.olympicGolds}</span>
                        : <span className="faint">0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function HallOfFameScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const entries = [...world.hallOfFame].sort((a, b) => b.careerPoints - a.careerPoints);

  return (
    <>
      <p className="page-intro">
        {entries.length} inductees. Admission is strict — a career of sustained excellence, not merely
        a long one.
      </p>

      {entries.length === 0
        ? (
          <Card title="Hall of Fame" icon="trophy">
            <div className="hof-empty">
              <Icon name="trophy" size={44} />
              <Empty>
                Nobody has been inducted yet. The Hall of Fame fills as the first generation of players
                reaches the end of their careers — usually a decade or so into a save.
              </Empty>
            </div>
          </Card>
        )
        : (
          <Card title="Inductees" icon="trophy" flush>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th />
                    <th>Player</th><th>Nat</th><th>Pos</th>
                    <th className="num">Inducted</th><th className="num">Career points</th>
                    <th className="num">Titles</th><th className="num">Caps</th>
                    <th>Citation</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.player} className="clickable" onClick={() => g.select(e.player)}>
                      <td className="face-cell"><PlayerFace playerId={store.id[e.player]} name={store.fullName(e.player)} size={28} /></td>
                      <td className="elite strong">{store.fullName(e.player)}</td>
                      <td><Flag nation={store.nation[e.player]} /></td>
                      <td><Pos pos={store.position[e.player] as Position} /></td>
                      <td className="num dim">{e.inductedYear}</td>
                      <td className="num">{e.careerPoints.toLocaleString()}</td>
                      <td className="num gold-text">{e.titles}</td>
                      <td className="num dim">{e.caps}</td>
                      <td className="faint citation">{e.citation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
    </>
  );
}
