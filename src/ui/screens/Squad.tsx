import type { JSX } from 'react';
import {
  ATTR_LABELS, HIDDEN_ATTR_SET, MENTAL_ATTRS, PHYSICAL_ATTRS, TECHNICAL_ATTRS,
  type AttributeName,
} from '../../engine/model/attributes.ts';
import { POSITION_NAMES, type Position } from '../../engine/model/positions.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { abilityClass, Bar, ClubLink, Empty, Flag, money, Pos, Status } from '../components.tsx';
import { useGame } from '../state.ts';

export function SquadScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const squad = g.squad();
  const selection = g.lineup();
  const starters = new Set(selection?.lineup ?? []);
  const libero = selection?.libero ?? -1;

  if (squad.length === 0) return <Empty>No players under contract.</Empty>;

  return (
    <>
      <h1>Squad</h1>
      <p className="subtitle">
        {squad.length} players · wage bill{' '}
        {money(squad.reduce((s, p) => s + store.wage[p], 0))} of{' '}
        {money(g.club!.finances.wageBudget)}
      </p>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Pos</th>
            <th className="num">Age</th>
            <th>Nat</th>
            <th className="num">Ht</th>
            <th className="num">Spike</th>
            <th className="num">Block</th>
            <th className="num">Ability</th>
            <th className="num">Potential</th>
            <th>Condition</th>
            <th>Morale</th>
            <th>Status</th>
            <th className="num">Wage</th>
          </tr>
        </thead>
        <tbody>
          {squad.map((p) => (
            <tr
              key={p}
              className={`clickable${g.selectedPlayer === p ? ' selected' : ''}`}
              onClick={() => g.select(p)}
            >
              <td>
                {starters.has(p) && <span className="good" title="In the starting six">● </span>}
                {p === libero && <span className="elite" title="Starting libero">◆ </span>}
                {store.fullName(p)}
              </td>
              <td><Pos pos={store.position[p] as Position} /></td>
              <td className="num">{store.ageOn(p, world.year, 181)}</td>
              <td><Flag nation={store.nation[p]} /></td>
              <td className="num dim">{store.heightCm[p]}</td>
              <td className="num dim">{store.spikeReachCm[p]}</td>
              <td className="num dim">{store.blockReachCm[p]}</td>
              <td className={`num ${abilityClass(store.currentAbility[p])}`}>
                {store.currentAbility[p]}
              </td>
              <td className="num faint">{store.potentialAbility[p]}</td>
              <td><Bar value={store.condition[p]} /></td>
              <td><Bar value={store.morale[p]} /></td>
              <td><Status store={store} i={p} /></td>
              <td className="num dim">{money(store.wage[p])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Full player profile.
 *
 * Own players are shown exact attributes — a coach knows their own squad.
 * Anyone else goes through the scouting screen, where the numbers are ranges.
 */
export function PlayerDetail(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const p = g.selectedPlayer;
  if (p === null) return null;

  const age = store.ageOn(p, world.year, 181);
  const club = store.clubId[p] >= 0 ? world.clubs[store.clubId[p]] : null;

  const group = (attrs: readonly AttributeName[], title: string): JSX.Element => (
    <div className="panel" style={{ flex: 1 }}>
      <h3>{title}</h3>
      {attrs.filter((a) => !HIDDEN_ATTR_SET.has(a)).map((a) => {
        const v = store.getAttr(p, a);
        return (
          <div className="attr" key={a}>
            <span className="name">{ATTR_LABELS[a]}</span>
            <span className={`val ${v >= 16 ? 'good' : v >= 12 ? '' : v >= 8 ? 'dim' : 'faint'}`}>
              {v}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {store.fullName(p)}
        <button onClick={() => g.select(null)}>Close</button>
      </h2>

      <div className="panels" style={{ marginBottom: 16 }}>
        <div className="panel" style={{ minWidth: 250 }}>
          <h3>Profile</h3>
          <div className="kv"><span className="k">Position</span>
            <span>{POSITION_NAMES[store.position[p] as Position]}</span></div>
          {store.secondary[p] >= 0 && (
            <div className="kv"><span className="k">Secondary</span>
              <span className="dim">{POSITION_NAMES[store.secondary[p] as Position]}</span></div>
          )}
          <div className="kv"><span className="k">Age</span><span>{age}</span></div>
          <div className="kv"><span className="k">Nationality</span>
            <span>{NATIONS[store.nation[p]].name}</span></div>
          <div className="kv"><span className="k">Club</span>
            <span>{club !== null ? <ClubLink id={club.id} /> : 'Free agent'}</span></div>
          <div className="kv"><span className="k">Value</span><span>{money(store.value[p])}</span></div>
          <div className="kv"><span className="k">Wage</span><span>{money(store.wage[p])}</span></div>
          {store.fivbId[p] > 0 && (
            <div className="kv"><span className="k">FIVB ID</span>
              <span className="mono faint">{store.fivbId[p]}</span></div>
          )}
        </div>

        <div className="panel" style={{ minWidth: 230 }}>
          <h3>Physical</h3>
          <div className="kv"><span className="k">Height</span><span>{store.heightCm[p]} cm</span></div>
          <div className="kv"><span className="k">Weight</span><span>{store.weightKg[p]} kg</span></div>
          <div className="kv"><span className="k">Spike reach</span>
            <span>{store.spikeReachCm[p]} cm</span></div>
          <div className="kv"><span className="k">Block reach</span>
            <span>{store.blockReachCm[p]} cm</span></div>
          <div className="kv"><span className="k">Ability</span>
            <span className={abilityClass(store.currentAbility[p])}>
              {store.currentAbility[p]}
            </span></div>
          <div className="kv"><span className="k">Potential</span>
            <span className="faint">{store.potentialAbility[p]}</span></div>
        </div>

        <div className="panel" style={{ minWidth: 230 }}>
          <h3>Career</h3>
          <div className="kv"><span className="k">Matches</span>
            <span>{store.careerMatches[p].toLocaleString()}</span></div>
          <div className="kv"><span className="k">Points</span>
            <span>{store.careerPoints[p].toLocaleString()}</span></div>
          <div className="kv"><span className="k">Aces</span>
            <span>{store.careerAces[p].toLocaleString()}</span></div>
          <div className="kv"><span className="k">Blocks</span>
            <span>{store.careerBlocks[p].toLocaleString()}</span></div>
          <div className="kv"><span className="k">Titles</span>
            <span>{store.careerTitles[p]}</span></div>
          <div className="kv"><span className="k">Caps</span>
            <span>{store.nationalCaps[p]}</span></div>
          {club?.id === g.world!.userClubId && (
            <button style={{ marginTop: 10 }} onClick={() => { g.releasePlayer(p); g.select(null); }}>
              Release
            </button>
          )}
        </div>
      </div>

      <div className="panels">
        {group(PHYSICAL_ATTRS, 'Physical')}
        {group(TECHNICAL_ATTRS, 'Technical')}
        {group(MENTAL_ATTRS, 'Mental')}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        Hidden attributes — injury proneness, consistency, big-match performance,
        loyalty, ambition and the rest — are never shown as numbers. They are
        inferred from scout reports and from how the player actually behaves.
      </p>
    </>
  );
}

export function YouthScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const youth = g.youthSquad();

  return (
    <>
      <h1>Youth Academy</h1>
      <p className="subtitle">
        Facilities {club.youthFacilities}/20 · Recruitment reach {club.youthRecruitment}/20 ·
        A new intake arrives each summer.
      </p>

      {youth.length === 0
        ? <Empty>No youth players yet. The next intake arrives at the end of the season.</Empty>
        : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Pos</th>
                <th className="num">Age</th>
                <th>Nat</th>
                <th className="num">Height</th>
                <th className="num">Ability</th>
                <th className="num">Potential</th>
                <th>Assessment</th>
              </tr>
            </thead>
            <tbody>
              {youth.map((p) => {
                const pa = store.potentialAbility[p];
                return (
                  <tr key={p} className="clickable" onClick={() => g.select(p)}>
                    <td>{store.fullName(p)}</td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{store.ageOn(p, world.year, 181)}</td>
                    <td><Flag nation={store.nation[p]} /></td>
                    <td className="num dim">{store.heightCm[p]}</td>
                    <td className={`num ${abilityClass(store.currentAbility[p])}`}>
                      {store.currentAbility[p]}
                    </td>
                    <td className="num faint">{pa}</td>
                    <td className={pa > 1550 ? 'elite' : pa > 1250 ? 'good' : 'dim'}>
                      {pa > 1550 ? 'Potentially exceptional'
                        : pa > 1250 ? 'Could play at the top level'
                          : pa > 950 ? 'Solid professional prospect'
                            : 'Unlikely to make the grade'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </>
  );
}
