import { useState, type JSX } from 'react';
import { attackEfficiency, receptionPositivity } from '../../engine/match/stats.ts';
import type { Position } from '../../engine/model/positions.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { abilityClass, Empty, Flag, Pos } from '../components.tsx';
import { useGame } from '../state.ts';

type StatKey = 'points' | 'kills' | 'efficiency' | 'aces' | 'blocks' | 'digs' | 'reception';

const STAT_COLUMNS: Array<[StatKey, string]> = [
  ['points', 'Points'],
  ['kills', 'Kills'],
  ['efficiency', 'Attack efficiency'],
  ['aces', 'Aces'],
  ['blocks', 'Blocks'],
  ['digs', 'Digs'],
  ['reception', 'Reception'],
];

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
    .map((s) => ({
      s,
      points: s.attackKills + s.serveAces + s.blockPoints,
      efficiency: attackEfficiency(s),
      reception: receptionPositivity(s),
    }))
    .sort((a, b) => {
      switch (sort) {
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
      <h1>Statistics</h1>
      <p className="subtitle">
        Season {world.year} · accumulated rally by rally from every match played.
      </p>

      <div className="toolbar">
        {STAT_COLUMNS.map(([k, label]) => (
          <button key={k} className={sort === k ? 'primary' : ''} onClick={() => setSort(k)}>
            {label}
          </button>
        ))}
        <button onClick={() => setOwnLeagueOnly(!ownLeagueOnly)}>
          {ownLeagueOnly ? 'My league' : 'Whole world'}
        </button>
      </div>

      {rows.length === 0
        ? <Empty>No statistics yet — play some matches first.</Empty>
        : (
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Player</th><th>Pos</th><th>Club</th>
                <th className="num">M</th><th className="num">Pts</th>
                <th className="num">Kills</th><th className="num">Eff</th>
                <th className="num">Aces</th><th className="num">Blocks</th>
                <th className="num">Digs</th><th className="num">Rec+</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.s.playerIdx} className="clickable" onClick={() => g.select(r.s.playerIdx)}>
                  <td className="num faint">{i + 1}</td>
                  <td>{store.fullName(r.s.playerIdx)}</td>
                  <td><Pos pos={store.position[r.s.playerIdx] as Position} /></td>
                  <td className="dim">
                    {world.clubs[store.clubId[r.s.playerIdx]]?.shortName ?? '—'}
                  </td>
                  <td className="num dim">{r.s.matches}</td>
                  <td className="num"><strong>{r.points}</strong></td>
                  <td className="num">{r.s.attackKills}</td>
                  <td className={`num ${r.efficiency > 0.35 ? 'good' : ''}`}>
                    {r.s.attacksTotal > 0 ? r.efficiency.toFixed(3) : '—'}
                  </td>
                  <td className="num">{r.s.serveAces}</td>
                  <td className="num">{r.s.blockPoints}</td>
                  <td className="num dim">{r.s.digsTotal}</td>
                  <td className="num dim">
                    {r.s.receptionsTotal > 0 ? `${(r.reception * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
      <h1>World Rankings</h1>
      <p className="subtitle">
        Ranked by the average ability of each nation's current best fourteen.
      </p>
      <table>
        <thead>
          <tr>
            <th className="num">#</th><th>Nation</th><th>Confederation</th>
            <th className="num">Squad strength</th><th className="num">Best player</th>
            <th className="num">Olympic golds</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((r, i) => {
            const best = [...r.squad].sort(
              (a, b) => store.currentAbility[b] - store.currentAbility[a],
            )[0];
            return (
              <tr key={r.team.nation}>
                <td className="num faint">{i + 1}</td>
                <td>{NATIONS[r.team.nation].name}</td>
                <td className="dim">{NATIONS[r.team.nation].confederation}</td>
                <td className={`num ${abilityClass(r.strength)}`}>{r.strength.toFixed(0)}</td>
                <td className="num dim">
                  {best !== undefined ? store.fullName(best) : '—'}
                </td>
                <td className="num">{r.team.olympicGolds}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <h1>Hall of Fame</h1>
      <p className="subtitle">
        {entries.length} inductees. Admission is strict — a career of sustained
        excellence, not merely a long one.
      </p>

      {entries.length === 0
        ? (
          <Empty>
            Nobody has been inducted yet. The Hall of Fame fills as the first
            generation of players reaches the end of their careers — usually a
            decade or so into a save.
          </Empty>
        )
        : (
          <table>
            <thead>
              <tr>
                <th>Player</th><th>Nat</th><th>Pos</th>
                <th className="num">Inducted</th><th className="num">Career points</th>
                <th className="num">Titles</th><th className="num">Caps</th>
                <th>Citation</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.player} className="clickable" onClick={() => g.select(e.player)}>
                  <td className="elite">{store.fullName(e.player)}</td>
                  <td><Flag nation={store.nation[e.player]} /></td>
                  <td><Pos pos={store.position[e.player] as Position} /></td>
                  <td className="num dim">{e.inductedYear}</td>
                  <td className="num">{e.careerPoints.toLocaleString()}</td>
                  <td className="num">{e.titles}</td>
                  <td className="num dim">{e.caps}</td>
                  <td className="faint">{e.citation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  );
}
