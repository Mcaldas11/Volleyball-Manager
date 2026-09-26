import type { JSX } from 'react';
import { compareTableRows, setRatio } from '../../engine/model/club.ts';
import type { Position } from '../../engine/model/positions.ts';
import { StaffRole } from '../../engine/model/staff.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { clubTrophies } from '../../engine/world/world.ts';
import {
  abilityClass, Card, ClubCrest, clubThemeStyle, Empty, Flag, KV, managerPhotoUrl, money, PersonFace,
  PlayerFace, Pos, StarMeter, StatTile,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/**
 * A read-only page for any club in the world — reachable by clicking its name
 * anywhere it appears. Mirrors PlayerDetail's hero-then-cards structure.
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
    .slice(0, 10);
  const avgAbility = club.players.length > 0
    ? Math.round(club.players.reduce((s, p) => s + store.currentAbility[p], 0) / club.players.length)
    : 0;

  const isUserClub = club.id === world.userClubId;
  const coach = world.staff.find((s) => s.clubId === club.id && s.role === StaffRole.HeadCoach);
  const trophies = clubTrophies(world, club.id);

  return (
    <div className="club-profile">
      <div className="club-hero themed" style={clubThemeStyle(club)}>
        <ClubCrest club={club} size={92} />
        <div className="club-hero-text">
          <span className="club-hero-kicker">
            <Flag nation={club.nation} /> {NATIONS[club.nation]?.name ?? '—'}
            {comp !== undefined && <> · {comp.name}</>}
          </span>
          <h2 className="club-hero-name">{club.name}</h2>
          <span className="club-hero-sub">
            {isUserClub && <span className="your-club-tag">Your club</span>}
            <span>{club.arenaName} · {club.arenaCapacity.toLocaleString()} seats</span>
          </span>
        </div>
        <div className="club-hero-rep">
          <span className="profile-rating-label">Reputation</span>
          <StarMeter value={club.reputation} max={10000} size={20} />
          <span className="dim">{club.reputation.toLocaleString()}</span>
        </div>
        <button onClick={() => g.selectClub(null)}><Icon name="close" size={14} /> Close</button>
      </div>

      <div className="tiles">
        <StatTile
          label="League position"
          value={row !== null ? `${position + 1}/${sortedTable.length}` : '—'}
          sub={row !== null ? `${row.points} pts · ${row.won}W ${row.lost}L` : 'No league'}
        />
        <StatTile label="Titles won" value={club.titlesWon} tone={club.titlesWon > 0 ? 'gold' : undefined} />
        <StatTile label="Squad size" value={club.players.length} sub="senior players" />
        <StatTile
          label="Average ability"
          value={<span className={abilityClass(avgAbility)}>{avgAbility}</span>}
          sub={<StarMeter value={avgAbility} size={12} />}
        />
        <StatTile label="Wage budget" value={money(club.finances.wageBudget)} />
      </div>

      <div className="club-grid">
        <Card title="Best Players" icon="squad" flush>
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Pos</th>
                <th>Nat</th>
                <th className="num">Age</th>
                <th>Ability</th>
              </tr>
            </thead>
            <tbody>
              {topPlayers.map((i) => (
                <tr key={i} className="clickable" onClick={() => g.select(i)}>
                  <td className="face-cell"><PlayerFace playerId={store.id[i]} name={store.fullName(i)} size={28} /></td>
                  <td className="strong">{store.fullName(i)}</td>
                  <td><Pos pos={store.position[i] as Position} /></td>
                  <td><Flag nation={store.nation[i]} /></td>
                  <td className="num dim">{store.ageOn(i, world.year, 181)}</td>
                  <td>
                    <span className="ability-cell">
                      <StarMeter value={store.currentAbility[i]} size={11} />
                      <span className={abilityClass(store.currentAbility[i])}>{store.currentAbility[i]}</span>
                    </span>
                  </td>
                </tr>
              ))}
              {topPlayers.length === 0 && (
                <tr><td colSpan={6}><Empty>No players registered.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </Card>

        <div className="stack">
          <Card title="Club Info" icon="club">
            <KV k="Nation"><Flag nation={club.nation} /> {NATIONS[club.nation]?.name ?? '—'}</KV>
            <KV k="League">{comp !== undefined ? `${comp.name} (Tier ${comp.tier})` : '—'}</KV>
            <KV k="Arena">{club.arenaName} ({club.arenaCapacity.toLocaleString()})</KV>
            <KV k="Reputation">{club.reputation.toLocaleString()}</KV>
            {row !== null && <KV k="Set ratio">{setRatio(row).toFixed(2)}</KV>}
          </Card>

          <Card title="Head Coach" icon="user">
            {isUserClub ? (
              <div className="coach-row">
                <PersonFace
                  photoUrl={managerPhotoUrl(world.manager)}
                  name={`${world.manager.firstName} ${world.manager.lastName}`}
                  size={40}
                />
                <div className="coach-row-text">
                  <strong>{world.manager.firstName} {world.manager.lastName}</strong>
                  <span className="faint"><Flag nation={world.manager.nation} /> You</span>
                </div>
              </div>
            ) : coach !== undefined ? (
              <div className="coach-row">
                <span className="coach-avatar"><Icon name="user" size={20} /></span>
                <div className="coach-row-text">
                  <strong>{coach.firstName} {coach.lastName}</strong>
                  <span className="faint"><Flag nation={coach.nation} /> Age {world.year - coach.birthYear}</span>
                </div>
              </div>
            ) : (
              <Empty>Vacant.</Empty>
            )}
          </Card>

          <Card title={`Trophy Cabinet (${club.titlesWon})`} icon="trophy">
            {trophies.length === 0
              ? <Empty>No trophies yet.</Empty>
              : trophies.map((t, i) => (
                <div className="trophy-line" key={i}>
                  <Icon name="trophy" size={15} />
                  <span className="trophy-line-year">{t.year}</span>
                  <span>{t.competitionName}</span>
                </div>
              ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
