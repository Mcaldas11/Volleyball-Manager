import { useState, type JSX } from 'react';
import {
  ATTR_LABELS, HIDDEN_ATTR_SET, MENTAL_ATTRS, PHYSICAL_ATTRS, TECHNICAL_ATTRS,
  type AttributeName,
} from '../../engine/model/attributes.ts';
import {
  POSITION_NAMES, POSITIONS, positionalEffectiveness, type Position,
} from '../../engine/model/positions.ts';
import type { PlayerStore } from '../../engine/model/players.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import {
  abilityClass, attrClass, Bar, Card, ClubLink, Empty, Flag, KV, money, Morale, PlayerFace, Pos,
  Segmented, SortTh, StarMeter, StatTile, Status, sortBy, useSort,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

type SquadSort =
  | 'name' | 'pos' | 'age' | 'height' | 'spike' | 'block' | 'ability' | 'potential'
  | 'condition' | 'morale' | 'wage';

const POSITION_FILTERS: ReadonlyArray<readonly [number, string]> = [
  [-1, 'All'],
  ...POSITIONS.map((p) => [p, `${POSITION_NAMES[p]}s`] as const),
];

export function SquadScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const squad = g.squad();
  const selection = g.lineup();
  const starters = new Set(selection?.lineup ?? []);
  const libero = selection?.libero ?? -1;
  const [posFilter, setPosFilter] = useState(-1);
  const [sort, onSort] = useSort<SquadSort>('ability');

  if (squad.length === 0) return <Empty>No players under contract.</Empty>;

  const age = (p: number): number => store.ageOn(p, world.year, 181);
  const wageBill = squad.reduce((s, p) => s + store.wage[p], 0);
  const avgAbility = Math.round(squad.reduce((s, p) => s + store.currentAbility[p], 0) / squad.length);
  const avgAge = squad.reduce((s, p) => s + age(p), 0) / squad.length;
  const injured = squad.filter((p) => store.injuryDaysLeft[p] > 0).length;

  const filtered = posFilter < 0 ? squad : squad.filter((p) => store.position[p] === posFilter);
  const rows = sortBy(filtered, sort, (p, k) => {
    switch (k) {
      case 'name': return store.fullName(p);
      case 'pos': return store.position[p];
      case 'age': return age(p);
      case 'height': return store.heightCm[p];
      case 'spike': return store.spikeReachCm[p];
      case 'block': return store.blockReachCm[p];
      case 'potential': return store.potentialAbility[p];
      case 'condition': return store.condition[p];
      case 'morale': return store.morale[p];
      case 'wage': return store.wage[p];
      default: return store.currentAbility[p];
    }
  });

  return (
    <>
      <div className="tiles">
        <StatTile label="Squad size" value={`${squad.length}/16`} sub={`${16 - squad.length} places free`} />
        <StatTile label="Average age" value={avgAge.toFixed(1)} sub="years" />
        <StatTile
          label="Average ability"
          value={<span className={abilityClass(avgAbility)}>{avgAbility}</span>}
          sub={<StarMeter value={avgAbility} size={12} />}
        />
        <StatTile
          label="Wage bill"
          value={money(wageBill)}
          sub={`of ${money(club.finances.wageBudget)} budget`}
          tone={wageBill > club.finances.wageBudget ? 'bad' : undefined}
        />
        <StatTile
          label="Unavailable"
          value={injured}
          sub={injured === 1 ? 'player injured' : 'players injured'}
          tone={injured > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card
        title="Players"
        icon="squad"
        flush
        actions={<Segmented size="sm" options={POSITION_FILTERS} value={posFilter} onChange={setPosFilter} />}
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <SortTh k="name" sort={sort} onSort={onSort}>Name</SortTh>
                <SortTh k="pos" sort={sort} onSort={onSort}>Pos</SortTh>
                <SortTh k="age" sort={sort} onSort={onSort} num>Age</SortTh>
                <th>Nat</th>
                <SortTh k="height" sort={sort} onSort={onSort} num title="Height (cm)">Ht</SortTh>
                <SortTh k="spike" sort={sort} onSort={onSort} num title="Spike reach (cm)">Spike</SortTh>
                <SortTh k="block" sort={sort} onSort={onSort} num title="Block reach (cm)">Block</SortTh>
                <SortTh k="ability" sort={sort} onSort={onSort}>Ability</SortTh>
                <SortTh k="potential" sort={sort} onSort={onSort} num>Potential</SortTh>
                <SortTh k="condition" sort={sort} onSort={onSort}>Condition</SortTh>
                <SortTh k="morale" sort={sort} onSort={onSort}>Morale</SortTh>
                <th>Status</th>
                <SortTh k="wage" sort={sort} onSort={onSort} num>Wage</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p} className="clickable" onClick={() => g.select(p)}>
                  <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                  <td>
                    <span className="name-cell">
                      <span className="strong">{store.fullName(p)}</span>
                      {starters.has(p) && <span className="role-tag starter" title="In the starting six">XI</span>}
                      {p === libero && <span className="role-tag libero" title="Starting libero">L</span>}
                    </span>
                  </td>
                  <td><Pos pos={store.position[p] as Position} /></td>
                  <td className="num">{age(p)}</td>
                  <td><Flag nation={store.nation[p]} /></td>
                  <td className="num dim">{store.heightCm[p]}</td>
                  <td className="num dim">{store.spikeReachCm[p]}</td>
                  <td className="num dim">{store.blockReachCm[p]}</td>
                  <td>
                    <span className="ability-cell">
                      <StarMeter value={store.currentAbility[p]} size={11} />
                      <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span>
                    </span>
                  </td>
                  <td className={`num ${abilityClass(store.potentialAbility[p])}`}>{store.potentialAbility[p]}</td>
                  <td><span className="cond-cell"><Bar value={store.condition[p]} /><span className="dim">{store.condition[p]}%</span></span></td>
                  <td><Morale value={store.morale[p]} /></td>
                  <td><Status store={store} i={p} /></td>
                  <td className="num dim">{money(store.wage[p])}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={14}><Empty>No players in this position.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="legend">
        <span className="role-tag starter">XI</span> starting six
        <span className="role-tag libero">L</span> starting libero
        <span className="faint">· Click a column heading to sort, a player to open their profile.</span>
      </p>
    </>
  );
}

/** Axes of the attribute polygon: each one a volleyball skill rolled up from
 *  the raw attributes that feed it. Serving takes the player's best serve
 *  type rather than averaging all three — a float specialist isn't a weak
 *  server just because they never jump-serve. */
const RADAR_AXES: ReadonlyArray<readonly [string, (a: (n: AttributeName) => number) => number]> = [
  ['Serving', (a) => (Math.max(a('floatServe'), a('jumpServe'), a('powerServe')) + a('servingAccuracy') + a('servingPower')) / 3],
  ['Attacking', (a) => (a('spikeTechnique') * 2 + Math.max(a('quickAttack'), a('backRowAttack'), a('pipeAttack'))) / 3],
  ['Blocking', (a) => a('blocking')],
  ['Reception', (a) => (a('reception') * 2 + a('ballControl')) / 3],
  ['Defence', (a) => a('digging')],
  ['Setting', (a) => (a('setting') * 2 + a('ballControl')) / 3],
  ['Athleticism', (a) => (a('verticalJump') + a('acceleration') + a('agility')) / 3],
  ['Mentality', (a) => (a('composure') + a('concentration') + a('determination') + a('pressureHandling')) / 4],
];

/** The attribute polygon: one spoke per skill on the 1-20 scale. */
function AttributeRadar({ store, p }: { store: PlayerStore; p: number }): JSX.Element {
  const size = 280;
  const c = size / 2;
  const r = 92;
  const n = RADAR_AXES.length;
  const get = (name: AttributeName): number => store.getAttr(p, name);
  const values = RADAR_AXES.map(([, f]) => Math.max(1, Math.min(20, f(get))));
  const point = (i: number, v: number): [number, number] => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(angle) * r * (v / 20), c + Math.sin(angle) * r * (v / 20)];
  };
  const ring = (v: number): string => Array.from({ length: n }, (_, i) => point(i, v).join(',')).join(' ');
  const shape = values.map((v, i) => point(i, v).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar" role="img" aria-label="Attribute profile">
      {[5, 10, 15, 20].map((v) => <polygon key={v} points={ring(v)} className="radar-ring" />)}
      {RADAR_AXES.map((_, i) => {
        const [x, y] = point(i, 20);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="radar-spoke" />;
      })}
      <polygon points={shape} className="radar-shape" />
      {values.map((v, i) => {
        const [x, y] = point(i, v);
        return <circle key={i} cx={x} cy={y} r={2.6} className="radar-dot" />;
      })}
      {RADAR_AXES.map(([label], i) => {
        const [x, y] = point(i, 25.5);
        return (
          <text key={label} x={x} y={y} className="radar-label" textAnchor="middle" dominantBaseline="middle">
            {label}
            <tspan x={x} dy="12" className="radar-value">{values[i].toFixed(0)}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** How comfortable a player is in a role, in the words a coach would use. */
function familiarity(eff: number): { label: string; cls: string } {
  if (eff >= 0.999) return { label: 'Natural', cls: 'fam-natural' };
  if (eff >= 0.85) return { label: 'Accomplished', cls: 'fam-accomplished' };
  if (eff >= 0.7) return { label: 'Competent', cls: 'fam-competent' };
  if (eff >= 0.55) return { label: 'Unconvincing', cls: 'fam-unconvincing' };
  if (eff >= 0.4) return { label: 'Awkward', cls: 'fam-awkward' };
  return { label: 'Ineffectual', cls: 'fam-awkward' };
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
  const natural = store.position[p] as Position;
  const secondary = store.secondary[p] as Position | -1;
  const ca = store.currentAbility[p];
  const pa = store.potentialAbility[p];
  const isOwn = club?.id === world.userClubId;
  const isYouth = isOwn && club !== null && club.youthPlayers.includes(p);

  const group = (attrs: readonly AttributeName[], title: string): JSX.Element => (
    <div className="attr-col">
      <h4 className="attr-col-title">{title}</h4>
      {attrs.filter((a) => !HIDDEN_ATTR_SET.has(a)).map((a) => {
        const v = store.getAttr(p, a);
        return (
          <div className="attr" key={a}>
            <span className="name">{ATTR_LABELS[a]}</span>
            <span className={`attr-val ${attrClass(v)}`}>{v}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="profile">
      <div className="profile-hero">
        <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={104} />
        <div className="profile-id">
          <div className="profile-tags">
            <Pos pos={natural} />
            <span className="profile-role">{POSITION_NAMES[natural]}</span>
            {secondary !== -1 && <span className="faint">· also {POSITION_NAMES[secondary]}</span>}
          </div>
          <h2 className="profile-name">{store.fullName(p)}</h2>
          <div className="profile-sub">
            <span><Flag nation={store.nation[p]} /> {NATIONS[store.nation[p]].name}</span>
            <span>{age} years old</span>
            <span>{store.heightCm[p]} cm</span>
            <span>{club !== null ? <ClubLink id={club.id} /> : 'Free agent'}</span>
          </div>
        </div>
        <div className="profile-ratings">
          <div className="profile-rating">
            <span className="profile-rating-label">Current ability</span>
            <StarMeter value={ca} size={20} />
            <span className={`profile-rating-num ${abilityClass(ca)}`}>{ca}</span>
          </div>
          <div className="profile-rating">
            <span className="profile-rating-label">Potential</span>
            <StarMeter value={pa} size={20} />
            <span className={`profile-rating-num ${abilityClass(pa)}`}>{pa}</span>
          </div>
        </div>
        <div className="profile-actions">
          {isYouth && (
            <button className="primary" onClick={() => { g.promotePlayer(p); g.select(null); }}>
              Promote to first team
            </button>
          )}
          {isOwn && !isYouth && (
            <button className="danger" onClick={() => { g.releasePlayer(p); g.select(null); }}>
              Release
            </button>
          )}
          <button onClick={() => g.select(null)}><Icon name="close" size={14} /> Close</button>
        </div>
      </div>

      <div className="tiles">
        <StatTile label="Value" value={money(store.value[p])} />
        <StatTile label="Wage" value={money(store.wage[p])} sub="per season" />
        <StatTile label="Condition" value={`${store.condition[p]}%`} sub={<Bar value={store.condition[p]} wide />} />
        <StatTile label="Morale" value={<Morale value={store.morale[p]} />} sub={<Bar value={store.morale[p]} wide />} />
        <StatTile label="Status" value={<Status store={store} i={p} />} />
      </div>

      <div className="profile-grid">
        <Card title="Attributes" icon="stats">
          <div className="attr-cols">
            {group(TECHNICAL_ATTRS, 'Technical')}
            {group(MENTAL_ATTRS, 'Mental')}
            {group(PHYSICAL_ATTRS, 'Physical')}
          </div>
          <p className="footnote">
            Hidden attributes — injury proneness, consistency, big-match performance,
            loyalty, ambition and the rest — are never shown as numbers. They are
            inferred from scout reports and from how the player actually behaves.
          </p>
        </Card>

        <div className="stack">
          <Card title="Attribute Profile" icon="star">
            <AttributeRadar store={store} p={p} />
          </Card>
          <Card title="Positions" icon="tactics">
            {POSITIONS.map((pos) => {
              const eff = positionalEffectiveness(natural, secondary, pos);
              const fam = familiarity(eff);
              return (
                <div className="fam-row" key={pos}>
                  <Pos pos={pos} />
                  <span className="fam-name">{POSITION_NAMES[pos]}</span>
                  <span className={`fam-bar ${fam.cls}`}><span style={{ width: `${eff * 100}%` }} /></span>
                  <span className={`fam-label ${fam.cls}`}>{fam.label}</span>
                </div>
              );
            })}
          </Card>
        </div>
      </div>

      <div className="grid3">
        <Card title="Physical Profile" icon="user">
          <KV k="Height">{store.heightCm[p]} cm</KV>
          <KV k="Weight">{store.weightKg[p]} kg</KV>
          <KV k="Spike reach">{store.spikeReachCm[p]} cm</KV>
          <KV k="Block reach">{store.blockReachCm[p]} cm</KV>
        </Card>
        <Card title="Career" icon="trophy">
          <KV k="Matches">{store.careerMatches[p].toLocaleString()}</KV>
          <KV k="Points">{store.careerPoints[p].toLocaleString()}</KV>
          <KV k="Aces">{store.careerAces[p].toLocaleString()}</KV>
          <KV k="Blocks">{store.careerBlocks[p].toLocaleString()}</KV>
          <KV k="Titles">{store.careerTitles[p]}</KV>
          <KV k="International caps">{store.nationalCaps[p]}</KV>
        </Card>
        <Card title="Contract" icon="finances">
          <KV k="Club">{club !== null ? <ClubLink id={club.id} /> : 'Free agent'}</KV>
          <KV k="Market value">{money(store.value[p])}</KV>
          <KV k="Wage">{money(store.wage[p])}</KV>
          <KV k="Nationality"><Flag nation={store.nation[p]} /> {NATIONS[store.nation[p]].name}</KV>
          {store.fivbId[p] > 0 && <KV k="FIVB ID" cls="mono faint">{store.fivbId[p]}</KV>}
        </Card>
      </div>
    </div>
  );
}

function assessment(pa: number): { text: string; cls: string } {
  if (pa > 1550) return { text: 'Potentially exceptional', cls: 'elite' };
  if (pa > 1250) return { text: 'Could play at the top level', cls: 'good' };
  if (pa > 950) return { text: 'Solid professional prospect', cls: '' };
  return { text: 'Unlikely to make the grade', cls: 'dim' };
}

export function YouthScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const youth = g.youthSquad();
  const bestPotential = youth.length > 0 ? store.potentialAbility[youth[0]] : 0;

  return (
    <>
      <div className="tiles">
        <StatTile label="Youth facilities" value={`${club.youthFacilities}/20`} sub={<Bar value={club.youthFacilities} max={20} wide />} />
        <StatTile label="Recruitment reach" value={`${club.youthRecruitment}/20`} sub={<Bar value={club.youthRecruitment} max={20} wide />} />
        <StatTile label="Prospects" value={youth.length} sub="in the academy" />
        <StatTile
          label="Best potential"
          value={youth.length > 0 ? <span className={abilityClass(bestPotential)}>{bestPotential}</span> : '—'}
          sub={youth.length > 0 ? <StarMeter value={bestPotential} size={12} /> : 'no prospects yet'}
        />
      </div>

      <Card title="Academy Players" icon="youth" flush actions={<span className="faint">A new intake arrives each summer</span>}>
        {youth.length === 0
          ? <Empty>No youth players yet. The next intake arrives at the end of the season.</Empty>
          : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th />
                    <th>Name</th>
                    <th>Pos</th>
                    <th className="num">Age</th>
                    <th>Nat</th>
                    <th className="num">Height</th>
                    <th className="num">Ability</th>
                    <th>Potential</th>
                    <th>Assessment</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {youth.map((p) => {
                    const pa = store.potentialAbility[p];
                    const a = assessment(pa);
                    return (
                      <tr key={p} className="clickable" onClick={() => g.select(p)}>
                        <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                        <td className="strong">{store.fullName(p)}</td>
                        <td><Pos pos={store.position[p] as Position} /></td>
                        <td className="num">{store.ageOn(p, world.year, 181)}</td>
                        <td><Flag nation={store.nation[p]} /></td>
                        <td className="num dim">{store.heightCm[p]}</td>
                        <td className={`num ${abilityClass(store.currentAbility[p])}`}>
                          {store.currentAbility[p]}
                        </td>
                        <td>
                          <span className="ability-cell">
                            <StarMeter value={pa} size={11} />
                            <span className={abilityClass(pa)}>{pa}</span>
                          </span>
                        </td>
                        <td className={a.cls}>{a.text}</td>
                        <td className="num">
                          <button className="sm" onClick={(e) => { e.stopPropagation(); g.promotePlayer(p); }}>
                            Promote
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </>
  );
}
