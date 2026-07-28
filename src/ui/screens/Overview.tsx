import type { JSX } from 'react';
import { compareTableRows } from '../../engine/model/club.ts';
import { ClubLink, Empty } from '../components.tsx';
import { useGame } from '../state.ts';

/**
 * The club's news hub — the landing page once you take charge. Messages,
 * what's coming up, where the club stands, and what happened elsewhere in
 * the league while time passed.
 */
export function OverviewScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;

  const messages = [...world.messages].reverse();
  const upcoming = g.ownFixtures().filter((f) => !f.played).slice(0, 5);

  const comp = world.competitions[club.leagueId];
  const sortedTable = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const position = sortedTable.findIndex((r) => r.clubId === club.id);
  const standingRows = position < 0 || position < 5
    ? sortedTable.slice(0, 5)
    : [...sortedTable.slice(0, 5), sortedTable[position]];

  const recentResults = comp !== undefined
    ? comp.fixtureIds
      .map((id) => world.fixtures[id])
      .filter((f) => f.played && f.day > world.day - 7 && f.day <= world.day)
      .sort((a, b) => b.day - a.day)
      .slice(0, 8)
    : [];

  return (
    <>
      <h1>Overview</h1>
      <p className="subtitle">{g.dateLabel()}</p>

      <div className="panels" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="panel" style={{ flex: 1.4, minWidth: 320 }}>
          <h3>Messages</h3>
          {messages.length === 0 ? (
            <Empty>No messages yet.</Empty>
          ) : (
            <div className="club-list" style={{ maxHeight: 320 }}>
              {messages.map((m) => (
                <div key={m.id} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
                  <div className="kv">
                    <strong>{m.subject}</strong>
                    <span className="faint">{g.dateLabelForDay(m.day)}</span>
                  </div>
                  <div className="dim">{m.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel" style={{ flex: 1, minWidth: 260 }}>
          <h3>Upcoming fixtures</h3>
          {upcoming.length === 0 ? <Empty>No fixtures scheduled.</Empty> : upcoming.map((f) => {
            const isHome = f.home === club.id;
            const opponent = world.clubs[isHome ? f.away : f.home];
            return (
              <div className="kv" key={f.id}>
                <span className="k">{g.dateLabelForDay(f.day)}</span>
                <span>
                  {isHome ? 'vs' : 'at'}{' '}
                  {opponent !== undefined ? <ClubLink id={opponent.id} short /> : '—'}
                </span>
              </div>
            );
          })}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button onClick={() => g.go('fixtures')}>View fixtures</button>
          </div>
        </div>
      </div>

      <div className="panels" style={{ alignItems: 'stretch', flexWrap: 'wrap', marginTop: 16 }}>
        <div className="panel" style={{ flex: 1, minWidth: 260 }}>
          <h3>League standing</h3>
          {comp === undefined ? <Empty>No league assigned.</Empty> : (
            <table>
              <thead>
                <tr>
                  <th className="num">#</th><th>Club</th><th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standingRows.map((r) => (
                  <tr key={r.clubId} className={r.clubId === club.id ? 'selected' : ''}>
                    <td className="num faint">
                      {sortedTable.findIndex((x) => x.clubId === r.clubId) + 1}
                    </td>
                    <td><ClubLink id={r.clubId} short /></td>
                    <td className="num"><strong>{r.points}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button onClick={() => g.go('table')}>View full table</button>
          </div>
        </div>

        <div className="panel" style={{ flex: 1.4, minWidth: 320 }}>
          <h3>Results this week</h3>
          {recentResults.length === 0 ? <Empty>No results in the last week.</Empty> : recentResults.map((f) => (
            <div className="kv" key={f.id}>
              <span><ClubLink id={f.home} short /> vs <ClubLink id={f.away} short /></span>
              <span className="mono">{f.homeSets}-{f.awaySets}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
