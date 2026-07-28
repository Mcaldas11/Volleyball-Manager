import type { JSX } from 'react';
import { compareTableRows, setRatio } from '../../engine/model/club.ts';
import type { Position } from '../../engine/model/positions.ts';
import { StaffRole } from '../../engine/model/staff.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { clubTrophies } from '../../engine/world/world.ts';
import { abilityClass, Empty, Flag, Pos } from '../components.tsx';
import { useGame } from '../state.ts';

/**
 * A read-only page for any club in the world — reachable by clicking its name
 * anywhere it appears. Mirrors PlayerDetail's in-flow panel structure.
 */
export function ClubDetail(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const clubId = g.selectedClub;
  if (clubId === null) return null;
  const club = world.clubs[clubId];
  if (club === undefined) return null;

  const store = world.players;
  const comp = world.competitions[club.leagueId];
  const sortedTable = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const position = sortedTable.findIndex((r) => r.clubId === club.id);
  const row = position >= 0 ? sortedTable[position] : null;

  const topPlayers = [...club.players]
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 8);

  const isUserClub = club.id === world.userClubId;
  const coach = world.staff.find((s) => s.clubId === club.id && s.role === StaffRole.HeadCoach);
  const trophies = clubTrophies(world, club.id);

  return (
    <>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {club.name}
        <button onClick={() => g.selectClub(null)}>Close</button>
      </h2>

      <div className="panels" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="panel" style={{ minWidth: 240 }}>
          <h3>Club info</h3>
          <div className="kv">
            <span className="k">Nation</span>
            <span><Flag nation={club.nation} /> {NATIONS[club.nation]?.name ?? '—'}</span>
          </div>
          <div className="kv">
            <span className="k">League</span>
            <span>{comp !== undefined ? `${comp.name} (Tier ${comp.tier})` : '—'}</span>
          </div>
          <div className="kv">
            <span className="k">Arena</span>
            <span>{club.arenaName} ({club.arenaCapacity.toLocaleString()})</span>
          </div>
          <div className="kv"><span className="k">Reputation</span><span>{club.reputation}</span></div>
          <div className="kv"><span className="k">Titles won</span><span>{club.titlesWon}</span></div>
        </div>

        <div className="panel" style={{ minWidth: 220 }}>
          <h3>League standing</h3>
          {row === null ? <p className="faint">No league assigned.</p> : (
            <>
              <div className="kv">
                <span className="k">Position</span><span>{position + 1} / {sortedTable.length}</span>
              </div>
              <div className="kv"><span className="k">Played</span><span>{row.played}</span></div>
              <div className="kv"><span className="k">Won — Lost</span><span>{row.won} — {row.lost}</span></div>
              <div className="kv"><span className="k">Points</span><span>{row.points}</span></div>
              <div className="kv"><span className="k">Set ratio</span><span>{setRatio(row).toFixed(2)}</span></div>
            </>
          )}
        </div>

        <div className="panel" style={{ minWidth: 220 }}>
          <h3>Head coach</h3>
          {isUserClub ? (
            <div className="kv">
              <span className="k">{world.manager.firstName} {world.manager.lastName}</span>
              <span><Flag nation={world.manager.nation} /> (You)</span>
            </div>
          ) : coach !== undefined ? (
            <div className="kv">
              <span className="k">{coach.firstName} {coach.lastName}</span>
              <span><Flag nation={coach.nation} /> {world.year - coach.birthYear}</span>
            </div>
          ) : (
            <p className="faint">Vacant.</p>
          )}
        </div>

        <div className="panel" style={{ minWidth: 240 }}>
          <h3>Trophies ({club.titlesWon})</h3>
          {trophies.length === 0
            ? <p className="faint">No trophies yet.</p>
            : trophies.map((t, i) => (
              <div className="kv" key={i}>
                <span className="k">{t.year}</span>
                <span>{t.competitionName}</span>
              </div>
            ))}
        </div>
      </div>

      <h3>Best players</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Pos</th>
            <th className="num">Age</th>
            <th className="num">Ability</th>
          </tr>
        </thead>
        <tbody>
          {topPlayers.map((i) => (
            <tr key={i} className="clickable" onClick={() => g.select(i)}>
              <td>{store.fullName(i)}</td>
              <td><Pos pos={store.position[i] as Position} /></td>
              <td className="num dim">{store.ageOn(i, world.year, 181)}</td>
              <td className={`num ${abilityClass(store.currentAbility[i])}`}>{store.currentAbility[i]}</td>
            </tr>
          ))}
          {topPlayers.length === 0 && (
            <tr><td colSpan={4}><Empty>No players registered.</Empty></td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
