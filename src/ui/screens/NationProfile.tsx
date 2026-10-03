import { useMemo, type JSX } from 'react';
import type { Position } from '../../engine/model/positions.ts';
import {
  eligibleFor, nationResults, nationTournaments, userNation, worldRanking,
} from '../../engine/world/internationals.ts';
import { NATIONS, type Confederation } from '../../engine/world/nations.ts';
import { abilityClass, Card, ClubLink, Empty, Flag, KV, PlayerFace, Pos, StarMeter } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/** "1st", "2nd"… */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

const MEDAL = ['', 'gold', 'silver', 'bronze'] as const;

const REGION: Readonly<Record<Confederation, string>> = {
  CEV: 'Europe', CSV: 'South America', NORCECA: 'North & Central America', AVC: 'Asia & Oceania', CAVB: 'Africa',
};

/**
 * Any nation's national team, the way the club page shows a club: where it
 * stands in the world, who coaches it, its honours, the squad (or, between
 * tournaments, the best it can pick from), its tournaments and its results.
 */
export function NationProfile(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const n = g.selectedNation;
  const nation = n !== null ? NATIONS[n] : undefined;
  const team = world.nationalTeams.find((t) => t.nation === n);
  const pool = useMemo(() => (n !== null ? eligibleFor(world, n) : []), [world, n, world.day]);
  if (n === null || nation === undefined) return null;

  const rank = worldRanking(world).indexOf(n) + 1;
  const mine = userNation(world) === n;
  const vacant = world.internationals?.vacancies.some((v) => v.nation === n) ?? false;
  const squad = team !== undefined && team.squad.length > 0 ? team.squad : [];
  const players = (squad.length > 0 ? squad : [...pool].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 14))
    .filter((p) => store.isActive(p))
    .sort((a, b) => store.position[a] - store.position[b] || store.currentAbility[b] - store.currentAbility[a]);
  const tournaments = nationTournaments(world, n);
  const results = nationResults(world, n, 10);
  const medals = [1, 2, 3].map((place) => tournaments.filter((x) => x.place === place).length);

  return (
    <div className="club-profile nation-page">
      <div className="club-hero club-hero-ov nation-hero">
        <span className="nation-flag-lg"><Flag nation={n} /></span>
        <div className="club-hero-text">
          <h2 className="club-hero-name">{nation.name}</h2>
          <span className="club-hero-kicker">
            National team · {REGION[nation.confederation]} ({nation.confederation})
            {mine && <span className="your-club-tag">Your nation</span>}
          </span>
        </div>
        <div className="club-hero-fact">
          <span className="club-hero-fact-label">World ranking</span>
          <span className="club-hero-fact-value">{rank > 0 ? ordinal(rank) : '—'}<span className="dim"> · {Math.round(team?.rankingPoints ?? 0)} pts</span></span>
        </div>
        <div className="club-hero-fact">
          <span className="club-hero-fact-label">Head coach</span>
          <span className="club-hero-fact-value">
            {mine
              ? <span className="player-link" onClick={() => g.go('career')}>{world.manager.firstName} {world.manager.lastName}</span>
              : vacant ? <span className="dim">Vacant</span> : <span className="dim">Federation appointee</span>}
          </span>
        </div>
        <div className="club-hero-fact">
          <span className="club-hero-fact-label">Players eligible</span>
          <span className="club-hero-fact-value">{pool.length}</span>
        </div>
        <div className="club-hero-side">
          <button onClick={() => g.selectNation(null)}><Icon name="close" size={14} /> Close</button>
        </div>
      </div>

      <div className="nation-ov">
        <Card title="Honours" icon="trophy" className="ov-card nation-honours">
          <KV k="Olympic gold"><b className="gold-text">{team?.olympicGolds ?? 0}</b></KV>
          <KV k="World champions"><b className="gold-text">{team?.worldTitles ?? 0}</b></KV>
          <KV k="Continental champions"><b>{team?.continentalTitles ?? 0}</b></KV>
          <KV k="Nations League"><b>{team?.nationsLeagueTitles ?? 0}</b></KV>
          <div className="nation-medals">
            {medals.map((count, i) => (
              <span key={i} className={`nation-medal ${MEDAL[i + 1]}`} title={`${['Gold', 'Silver', 'Bronze'][i]} medals`}>
                <Icon name="trophy" size={14} /> {count}
              </span>
            ))}
            <span className="faint">medals in the tournaments on record</span>
          </div>
        </Card>

        <Card title="Tournaments" icon="world" className="ov-card nation-tournaments">
          {tournaments.length === 0 && <Empty>No tournaments on record.</Empty>}
          {tournaments.map(({ t, place }) => (
            <div key={t.id} className="ov-comp" onClick={() => g.openTournament(t.id)}>
              <span className="ov-comp-name">{t.name}</span>
              <span className={`ov-comp-stage${place >= 1 && place <= 3 ? ` medal-${MEDAL[place]}` : ''}`}>
                {place === 0 ? (t.status === 'planned' || t.status === 'called' ? 'To come' : 'In progress') : ordinal(place)}
              </span>
            </div>
          ))}
        </Card>

        <Card
          title={squad.length > 0 ? `Squad · ${players.length}` : 'Best players'}
          icon="squad"
          flush
          className="ov-card nation-squad"
          actions={squad.length === 0 ? <span className="faint">No squad named right now</span> : undefined}
        >
          {players.length === 0 ? <Empty>No players eligible.</Empty> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th /><th>Name</th><th>Pos</th><th>Club</th><th className="num">Age</th><th className="num">Caps</th><th>Ability</th></tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p} className="clickable" onClick={() => g.select(p)}>
                      <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={26} /></td>
                      <td className="strong">{store.fullName(p)}</td>
                      <td><Pos pos={store.position[p] as Position} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} /> : <span className="faint">Free agent</span>}
                      </td>
                      <td className="num dim">{store.ageOn(p, world.year, 181)}</td>
                      <td className="num dim">{store.nationalCaps[p]}</td>
                      <td>
                        <span className="ability-cell">
                          <StarMeter value={store.currentAbility[p]} size={10} />
                          <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Results" icon="calendar" className="ov-card nation-results">
          {results.length === 0 && <Empty>No matches played yet.</Empty>}
          {results.map(({ t, m }) => {
            const home = m.home === n;
            const opp = home ? m.away : m.home;
            const us = home ? m.homeSets : m.awaySets;
            const them = home ? m.awaySets : m.homeSets;
            return (
              <div key={`${t.id}-${m.id}`} className="nation-result" onClick={() => g.openTournament(t.id)}>
                <span className="nation-result-main">
                  <span className="nation-result-opp"><Flag nation={opp} /> {NATIONS[opp]?.name ?? '?'}</span>
                  <span className="faint">{t.name} · {m.stage}</span>
                </span>
                <span className={`ov-result ${us > them ? 'win' : 'loss'}`}>{us}-{them}</span>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
