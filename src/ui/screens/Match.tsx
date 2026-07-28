import { useState, type JSX } from 'react';
import { compareTableRows, setRatio } from '../../engine/model/club.ts';
import type { RallyContact, RallyLogEntry } from '../../engine/match/engine.ts';
import { aggregateTeam, sideOutPct, breakPointPct } from '../../engine/match/stats.ts';
import { ClubLink, Empty } from '../components.tsx';
import { useGame } from '../state.ts';

export function FixturesScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const fixtures = g.ownFixtures();
  const watched = g.reviewLast();

  return (
    <>
      <h1>Fixtures</h1>
      <p className="subtitle">
        {fixtures.filter((f) => f.played).length} of {fixtures.length} played
      </p>

      {watched !== null && <MatchScreen />}

      <h2>Schedule</h2>
      <table>
        <thead>
          <tr>
            <th className="num">Rd</th>
            <th>Opponent</th>
            <th>Venue</th>
            <th>Competition</th>
            <th className="num">Result</th>
            <th>Sets</th>
          </tr>
        </thead>
        <tbody>
          {fixtures.map((f) => {
            const isHome = f.home === world.userClubId;
            const opponent = world.clubs[isHome ? f.away : f.home];
            const comp = world.competitions[f.competitionId];
            const won = f.played && ((isHome && f.homeSets > f.awaySets) || (!isHome && f.awaySets > f.homeSets));
            return (
              <tr key={f.id}>
                <td className="num faint">{f.round >= 1000 ? 'PO' : f.round + 1}</td>
                <td>{opponent !== undefined ? <ClubLink id={opponent.id} /> : '—'}</td>
                <td className="dim">{isHome ? 'Home' : 'Away'}</td>
                <td className="faint">{comp?.name ?? ''}</td>
                <td className={`num ${f.played ? (won ? 'good' : 'bad') : 'faint'}`}>
                  {f.played ? `${isHome ? f.homeSets : f.awaySets}-${isHome ? f.awaySets : f.homeSets}` : '—'}
                </td>
                <td className="faint mono">
                  {f.setScores.map(([h, a]) => `${isHome ? h : a}-${isHome ? a : h}`).join('  ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/**
 * The match viewer.
 *
 * This is where the rally engine earns its keep: every point can be read back
 * contact by contact, with the running win probability and the full box score
 * alongside. If a set was lost in rotation 3, the rotation table says so.
 */
export function MatchScreen(): JSX.Element {
  const g = useGame();
  const watched = g.reviewLast();
  const [tab, setTab] = useState<'log' | 'box' | 'rotations'>('log');
  if (watched === null) return <Empty>No match has been played yet.</Empty>;

  const { result, homeName, awayName } = watched;
  const store = g.world!.players;

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="scoreline">
        <span className="team"><ClubLink id={watched.fixture.home} /></span>
        <span className="sets">{result.homeSets} — {result.awaySets}</span>
        <span className="team"><ClubLink id={watched.fixture.away} /></span>
        <span className="mono faint">
          {result.setScores.map(([h, a]) => `${h}-${a}`).join('   ')}
        </span>
        {result.mvp >= 0 && (
          <span className="dim">MVP: {store.fullName(result.mvp)}</span>
        )}
      </div>

      <div className="toolbar">
        <button className={tab === 'log' ? 'primary' : ''} onClick={() => setTab('log')}>
          Rally log
        </button>
        <button className={tab === 'box' ? 'primary' : ''} onClick={() => setTab('box')}>
          Box score
        </button>
        <button className={tab === 'rotations' ? 'primary' : ''} onClick={() => setTab('rotations')}>
          Rotation analysis
        </button>
        <span className="faint">{result.totalRallies} rallies simulated</span>
      </div>

      {tab === 'log' && <RallyLog log={result.log ?? []} home={homeName} away={awayName} />}
      {tab === 'box' && <BoxScore />}
      {tab === 'rotations' && <RotationAnalysis />}
    </div>
  );
}

function RallyLog({ log, home, away }: { log: RallyLogEntry[]; home: string; away: string }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  // Only the last set is shown by default; a full five-setter is 200+ rallies.
  const [setFilter, setSetFilter] = useState<number>(-1);
  const sets = [...new Set(log.map((r) => r.set))];
  const shown = setFilter < 0 ? log.slice(-60) : log.filter((r) => r.set === setFilter);

  return (
    <>
      <div className="toolbar">
        <button className={setFilter === -1 ? 'primary' : ''} onClick={() => setSetFilter(-1)}>
          Last 60
        </button>
        {sets.map((s) => (
          <button key={s} className={setFilter === s ? 'primary' : ''} onClick={() => setSetFilter(s)}>
            Set {s + 1}
          </button>
        ))}
      </div>
      <div className="rally-log">
        {shown.map((r, i) => (
          <div key={i} className={`rally ${r.winner === 0 ? 'home-point' : 'away-point'}`}>
            <span className="score mono">
              {r.scoreBefore[0]}-{r.scoreBefore[1]}
            </span>
            <span className="desc">{describeRally(r, store)}</span>
            <span className="faint" title="Home win probability">
              {(r.homeWinProb * 100).toFixed(0)}%
            </span>
          </div>
        ))}
        {shown.length === 0 && <div className="rally dim">No rallies recorded.</div>}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
        Blue = point to {home}, amber = point to {away}. The percentage is {home}'s
        win probability after that rally.
      </p>
    </>
  );
}

/** Turn a rally's contacts into a sentence a volleyball person would recognise. */
function describeRally(r: RallyLogEntry, store: { shortName: (i: number) => string }): string {
  const parts: string[] = [];
  for (const c of r.contacts) {
    parts.push(describeContact(c, store));
  }
  const text = parts.filter((p) => p !== '').join(' → ');
  return text === '' ? 'Rally' : text;
}

function describeContact(
  c: RallyContact,
  store: { shortName: (i: number) => string },
): string {
  const who = store.shortName(c.player);
  switch (c.kind) {
    case 'serve': return `${who} serves (${c.detail})`;
    case 'ace': return `ACE ${who}`;
    case 'serveError': return `${who} serve error`;
    case 'reception': return `${who} passes ${c.detail}`;
    case 'receptionError': return `${who} shanks the pass`;
    case 'setError': return `${who} setting error`;
    case 'attack': return `${who} attacks (${c.detail})`;
    case 'kill': return `KILL ${who} (${c.detail})`;
    case 'attackError': return `${who} attack error`;
    case 'blocked': return `${who} STUFFED`;
    case 'blockTouch': return `${who} touch`;
    case 'dig': return `${who} digs`;
    case 'freeball': return 'free ball over';
    default: return '';
  }
}

function BoxScore(): JSX.Element {
  const g = useGame();
  const watched = g.reviewLast()!;
  const store = g.world!.players;

  const table = (label: string, teamStats: typeof watched.result.stats.home): JSX.Element => {
    const rows = [...teamStats.players.values()]
      .filter((s) => s.attacksTotal > 0 || s.servesTotal > 0 || s.receptionsTotal > 0)
      .sort((a, b) =>
        (b.attackKills + b.serveAces + b.blockPoints) - (a.attackKills + a.serveAces + a.blockPoints));
    const total = aggregateTeam(teamStats);
    return (
      <div>
        <h2>{label}</h2>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th className="num" title="Total points">Pts</th>
              <th className="num" title="Kills / attempts">K/Att</th>
              <th className="num" title="Attack efficiency">Eff</th>
              <th className="num" title="Aces">Ace</th>
              <th className="num" title="Block points">Blk</th>
              <th className="num" title="Errors">Err</th>
              <th className="num" title="Reception positivity">Rec+</th>
              <th className="num" title="Digs">Dig</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const eff = s.attacksTotal > 0
                ? (s.attackKills - s.attackErrors - s.attackBlocked) / s.attacksTotal : 0;
              const recPos = s.receptionsTotal > 0
                ? (s.receptionPerfect + s.receptionPositive) / s.receptionsTotal : 0;
              return (
                <tr key={s.playerIdx}>
                  <td>{store.fullName(s.playerIdx)}</td>
                  <td className="num">{s.attackKills + s.serveAces + s.blockPoints}</td>
                  <td className="num dim">{s.attackKills}/{s.attacksTotal}</td>
                  <td className={`num ${eff > 0.3 ? 'good' : eff < 0.1 ? 'bad' : ''}`}>
                    {s.attacksTotal > 0 ? eff.toFixed(3) : '—'}
                  </td>
                  <td className="num">{s.serveAces}</td>
                  <td className="num">{s.blockPoints}</td>
                  <td className="num bad">{s.attackErrors + s.serveErrors + s.receptionErrors}</td>
                  <td className="num dim">
                    {s.receptionsTotal > 0 ? `${(recPos * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="num dim">{s.digsTotal}</td>
                </tr>
              );
            })}
            <tr>
              <td className="dim">Team</td>
              <td className="num">{total.attackKills + total.serveAces + total.blockPoints}</td>
              <td className="num dim">{total.attackKills}/{total.attacksTotal}</td>
              <td className="num">
                {total.attacksTotal > 0
                  ? ((total.attackKills - total.attackErrors - total.attackBlocked) / total.attacksTotal).toFixed(3)
                  : '—'}
              </td>
              <td className="num">{total.serveAces}</td>
              <td className="num">{total.blockPoints}</td>
              <td className="num bad">{total.attackErrors + total.serveErrors + total.receptionErrors}</td>
              <td className="num dim">
                {total.receptionsTotal > 0
                  ? `${(((total.receptionPerfect + total.receptionPositive) / total.receptionsTotal) * 100).toFixed(0)}%`
                  : '—'}
              </td>
              <td className="num dim">{total.digsTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="grid2">
      {table(watched.homeName, watched.result.stats.home)}
      {table(watched.awayName, watched.result.stats.away)}
    </div>
  );
}

/**
 * Per-rotation breakdown — the screen that tells a coach *where* a match was
 * lost, rather than merely that it was.
 */
function RotationAnalysis(): JSX.Element {
  const g = useGame();
  const watched = g.reviewLast()!;

  const table = (label: string, stats: typeof watched.result.stats.home): JSX.Element => (
    <div>
      <h2>{label}</h2>
      <table>
        <thead>
          <tr>
            <th>Rotation</th>
            <th className="num" title="Rallies played receiving">Rec</th>
            <th className="num" title="Side-out percentage">Side-out</th>
            <th className="num" title="Rallies played serving">Srv</th>
            <th className="num" title="Break-point percentage">Break</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {stats.rotations.map((r, i) => {
            const so = sideOutPct(r);
            const bp = breakPointPct(r);
            const net = (r.sideOutsWon + r.servePointsWon) -
              ((r.receiveRallies - r.sideOutsWon) + (r.serveRallies - r.servePointsWon));
            return (
              <tr key={i}>
                <td>P{i + 1}</td>
                <td className="num dim">{r.receiveRallies}</td>
                <td className={`num ${so > 0.68 ? 'good' : so < 0.55 ? 'bad' : ''}`}>
                  {r.receiveRallies > 0 ? `${(so * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="num dim">{r.serveRallies}</td>
                <td className={`num ${bp > 0.42 ? 'good' : bp < 0.30 ? 'bad' : ''}`}>
                  {r.serveRallies > 0 ? `${(bp * 100).toFixed(0)}%` : '—'}
                </td>
                <td className={`num ${net > 0 ? 'good' : net < 0 ? 'bad' : 'dim'}`}>
                  {net > 0 ? `+${net}` : net}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="grid2">
        {table(watched.homeName, watched.result.stats.home)}
        {table(watched.awayName, watched.result.stats.away)}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        Rotations are named for the zone the setter occupies. Side-out above 68%
        is strong; below 55% is a rotation that needs a different first-ball
        option — change it on the Rotations screen.
      </p>
    </>
  );
}

export function TableScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  if (comp === undefined) return <Empty>No league assigned.</Empty>;

  const rows = [...comp.table].sort(compareTableRows);

  return (
    <>
      <h1>{comp.name}</h1>
      <p className="subtitle">
        3 points for a 3-0 or 3-1 win, 2 for a 3-2 win, 1 for losing 2-3.
      </p>
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Club</th>
            <th className="num">P</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">Pts</th>
            <th className="num">Sets</th>
            <th className="num">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId} className={r.clubId === club.id ? 'selected' : ''}>
              <td className="num faint">{i + 1}</td>
              <td><ClubLink id={r.clubId} /></td>
              <td className="num dim">{r.played}</td>
              <td className="num">{r.won}</td>
              <td className="num">{r.lost}</td>
              <td className="num"><strong>{r.points}</strong></td>
              <td className="num dim">{r.setsFor}:{r.setsAgainst}</td>
              <td className="num dim">{setRatio(r).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
