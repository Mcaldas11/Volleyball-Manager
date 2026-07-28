import { useState, type JSX } from 'react';
import {
  BlockAssignment, DefensiveShape, DefensiveSystem, OffensiveSystem,
  ServeStrategy, ServeTarget, Tempo,
} from '../../engine/match/tactics.ts';
import { POSITION_NAMES, POSITION_SHORT, type Position } from '../../engine/model/positions.ts';
import { STAFF_ROLE_NAMES, StaffRole, staffRating, type Staff } from '../../engine/model/staff.ts';
import { buildScoutReport, formatEstimate, totalMatchesWatched } from '../../engine/world/scouting.ts';
import { ATTR_LABELS } from '../../engine/model/attributes.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { abilityClass, Bar, ClubLink, Empty, Flag, money, Pos } from '../components.tsx';
import { useGame } from '../state.ts';

/** A labelled dropdown bound to a value on the club's tactics object. */
function Choice<T extends number>({
  label, value, options, onChange, hint,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  hint?: string;
}): JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="kv">
        <span className="k">{label}</span>
        <select value={value} onChange={(e) => onChange(Number(e.target.value) as T)}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {hint !== undefined && <div className="faint" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export function TacticsScreen(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const t = club.tactics;

  return (
    <>
      <h1>Tactics</h1>
      <p className="subtitle">
        These instructions feed straight into the rally engine — they change
        which attacker the setter picks and how the block forms, not a hidden
        team rating.
      </p>

      <div className="grid2">
        <div className="panel">
          <h3>Offence</h3>
          <Choice
            label="System"
            value={t.offense}
            onChange={(v) => { t.offense = v; g.touch(); }}
            hint="Determines how the setter distributes the ball across the available attack lanes."
            options={[
              [OffensiveSystem.Fast, 'Fast offence'],
              [OffensiveSystem.Balanced, 'Balanced'],
              [OffensiveSystem.OutsideFocused, 'Outside focused'],
              [OffensiveSystem.OppositeFocused, 'Opposite focused'],
              [OffensiveSystem.MiddleFocused, 'Middle focused'],
              [OffensiveSystem.PipeHeavy, 'Pipe heavy'],
              [OffensiveSystem.BackRowHeavy, 'Back-row heavy'],
            ]}
          />
          <Choice
            label="Tempo"
            value={t.tempo}
            onChange={(v) => { t.tempo = v; g.touch(); }}
            hint="Faster tempo beats the block but demands a better pass and a better setter."
            options={[
              [Tempo.VeryFast, 'Very fast'],
              [Tempo.Fast, 'Fast'],
              [Tempo.Balanced, 'Balanced'],
              [Tempo.Slow, 'Slow'],
            ]}
          />
        </div>

        <div className="panel">
          <h3>Defence and serve</h3>
          <Choice
            label="Defensive system"
            value={t.defense}
            onChange={(v) => { t.defense = v; g.touch(); }}
            hint="Trades block pressure against floor coverage."
            options={[
              [DefensiveSystem.Conservative, 'Conservative'],
              [DefensiveSystem.Aggressive, 'Aggressive'],
              [DefensiveSystem.TripleBlockPriority, 'Triple block priority'],
              [DefensiveSystem.ServicePressure, 'Service pressure'],
              [DefensiveSystem.ReceptionStability, 'Reception stability'],
            ]}
          />
          <Choice
            label="Serve strategy"
            value={t.serve}
            onChange={(v) => { t.serve = v; g.touch(); }}
            hint="Risky serving buys aces and pays for them in errors."
            options={[
              [ServeStrategy.Risky, 'Risky'],
              [ServeStrategy.Balanced, 'Balanced'],
              [ServeStrategy.Conservative, 'Conservative'],
            ]}
          />
        </div>
      </div>
    </>
  );
}

/**
 * Per-rotation instructions.
 *
 * In a 5-1 the setter is front row for three of the six rotations, which
 * leaves only two attackers available — so those rotations behave differently
 * and deserve different instructions. This screen is where that is managed.
 */
export function RotationsScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const selection = g.lineup();
  const [rot, setRot] = useState(0);
  const r = club.tactics.rotations[rot];

  if (selection === null) return <Empty>No lineup available.</Empty>;

  // Zone layout for this rotation: rotating the lineup left by `rot` steps.
  const zones = Array.from({ length: 6 }, (_, z) => selection.lineup[(z + rot) % 6]);
  const zoneOrder = [3, 2, 1, 4, 5, 0]; // display order: 4,3,2 front then 5,6,1 back
  const zoneLabels = ['1', '2', '3', '4', '5', '6'];

  return (
    <>
      <h1>Rotations</h1>
      <p className="subtitle">
        Rotations are named for the zone the setter stands in. When the setter is
        front row only two attackers are available — those rotations score less
        and need different instructions.
      </p>

      <div className="toolbar">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <button key={i} className={rot === i ? 'primary' : ''} onClick={() => setRot(i)}>
            P{i + 1}
          </button>
        ))}
      </div>

      <div className="panels">
        <div className="panel">
          <h3>Court — rotation P{rot + 1}</h3>
          <div className="court">
            {zoneOrder.map((z) => {
              const p = zones[z];
              if (p === undefined) return <div className="zone" key={z} />;
              const pos = store.position[p] as Position;
              const isSetter = POSITION_SHORT[pos] === 'S';
              return (
                <div className={`zone${isSetter ? ' setter' : ''}`} key={z}>
                  <div className="z">Zone {zoneLabels[z]}{z >= 1 && z <= 3 ? ' · front' : ''}</div>
                  <div>{store.shortName(p)}</div>
                  <div className="faint">{POSITION_SHORT[pos]}</div>
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            Libero replaces the middle blocker in zones 5 and 6. The middle
            serves from zone 1, since a libero may not serve.
          </p>
        </div>

        <div className="panel" style={{ flex: 1 }}>
          <h3>Instructions for P{rot + 1}</h3>
          <Choice
            label="Preferred attacker"
            value={r.preferredAttacker}
            onChange={(v) => { r.preferredAttacker = v as Position | -1; g.touch(); }}
            options={[
              [-1 as Position, 'Automatic'],
              ...([0, 1, 2, 3] as Position[]).map(
                (p) => [p, POSITION_NAMES[p]] as [Position, string],
              ),
            ]}
          />
          <Choice
            label="Serve target"
            value={r.serveTarget}
            onChange={(v) => { r.serveTarget = v; g.touch(); }}
            options={[
              [ServeTarget.Auto, 'Automatic'],
              [ServeTarget.WeakestPasser, 'Weakest passer'],
              [ServeTarget.Setter, 'The setter'],
              [ServeTarget.BestAttacker, 'Their best attacker'],
              [ServeTarget.DeepCorner, 'Deep corner'],
              [ServeTarget.ShortZone, 'Short zone'],
            ]}
          />
          <Choice
            label="Block assignment"
            value={r.blockAssignment}
            onChange={(v) => { r.blockAssignment = v; g.touch(); }}
            options={[
              [BlockAssignment.ReadBlock, 'Read block'],
              [BlockAssignment.CommitMiddle, 'Commit on the middle'],
              [BlockAssignment.SpreadBlock, 'Spread block'],
              [BlockAssignment.ReleaseToLine, 'Release to line'],
            ]}
          />
          <Choice
            label="Defensive shape"
            value={r.defensiveShape}
            onChange={(v) => { r.defensiveShape = v; g.touch(); }}
            options={[
              [DefensiveShape.PerimeterDefense, 'Perimeter'],
              [DefensiveShape.RotationDefense, 'Rotation'],
              [DefensiveShape.ManUpDefense, 'Man-up'],
            ]}
          />
          <div className="kv">
            <span className="k">Back-row transition</span>
            <input
              type="range" min={0} max={100} value={r.transitionBackRow}
              onChange={(e) => { r.transitionBackRow = Number(e.target.value); g.touch(); }}
            />
          </div>
          <div className="kv">
            <span className="k">Setter tempo bias</span>
            <input
              type="range" min={0} max={100} value={r.setterTempoBias}
              onChange={(e) => { r.setterTempoBias = Number(e.target.value); g.touch(); }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

export function TrainingScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const squad = g.squad();

  return (
    <>
      <h1>Training</h1>
      <p className="subtitle">
        Training facilities {club.trainingFacilities}/20. Development runs weekly
        and depends on age, potential, coaching, facilities and the player's own
        professionalism.
      </p>

      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th className="num">Age</th>
            <th className="num">Ability</th>
            <th className="num">Potential</th>
            <th className="num">Headroom</th>
            <th>Condition</th>
            <th className="num" title="Professionalism, work ethic and coachability">Application</th>
            <th>Outlook</th>
          </tr>
        </thead>
        <tbody>
          {squad.map((p) => {
            const age = store.ageOn(p, world.year, 181);
            const ca = store.currentAbility[p];
            const pa = store.potentialAbility[p];
            const headroom = pa - ca;
            const application = Math.round(
              (store.getAttr(p, 'professionalism') +
                store.getAttr(p, 'workEthic') +
                store.getAttr(p, 'coachability')) / 3,
            );
            return (
              <tr key={p} className="clickable" onClick={() => g.select(p)}>
                <td>{store.fullName(p)}</td>
                <td><Pos pos={store.position[p] as Position} /></td>
                <td className="num">{age}</td>
                <td className={`num ${abilityClass(ca)}`}>{ca}</td>
                <td className="num faint">{pa}</td>
                <td className={`num ${headroom > 200 ? 'good' : 'dim'}`}>
                  {headroom > 0 ? `+${headroom}` : '—'}
                </td>
                <td><Bar value={store.condition[p]} /></td>
                <td className={`num ${application >= 15 ? 'good' : application <= 8 ? 'bad' : ''}`}>
                  {application}
                </td>
                <td className="dim">
                  {age <= 21 && headroom > 250 ? 'Rapid development expected'
                    : age <= 24 && headroom > 120 ? 'Still improving'
                      : age <= 30 ? 'At or near peak'
                        : age <= 33 ? 'Gradual decline'
                          : 'In steep decline'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function FinancesScreen(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const store = g.world!.players;
  const f = club.finances;
  const wages = club.players.reduce((s, p) => s + store.wage[p], 0);
  const staffWages = club.staff.reduce((s, id) => s + (g.world!.staff[id]?.wage ?? 0), 0);

  const line = (k: string, v: number, good = false): JSX.Element => (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={good ? 'good' : v < 0 ? 'bad' : ''}>{money(v)}</span>
    </div>
  );

  return (
    <>
      <h1>Finances</h1>
      <p className="subtitle">
        {club.arenaName} · {club.arenaCapacity.toLocaleString()} seats.
        {f.seasonsInDebt > 0 && (
          <span className="bad"> {f.seasonsInDebt} consecutive season(s) in the red — three means dissolution.</span>
        )}
      </p>

      <div className="grid3">
        <div className="panel">
          <h3>Position</h3>
          {line('Balance', f.balance)}
          {line('Wage budget', f.wageBudget)}
          {line('Committed wages', -wages)}
          {line('Remaining', f.wageBudget - wages)}
          {line('Transfer budget', f.transferBudget)}
        </div>
        <div className="panel">
          <h3>Income (annual)</h3>
          {line('Sponsorship', f.sponsorshipIncome, true)}
          {line('TV rights', f.tvRightsIncome, true)}
          {line('Merchandise', f.merchandiseIncome, true)}
          {line('Gate receipts so far', f.seasonIncome, true)}
          {line('Per match (full house)', f.ticketIncomePerMatch, true)}
        </div>
        <div className="panel">
          <h3>Expenditure (annual)</h3>
          {line('Player wages', -wages)}
          {line('Staff wages', -staffWages)}
          {line('Arena maintenance', -f.arenaMaintenance)}
          {line('Medical', -f.medicalCosts)}
          {line('Youth academy', -f.youthAcademyCosts)}
          {line('Travel', -f.travelCosts)}
        </div>
      </div>

      <h2>Projection</h2>
      <div className="panel">
        {line(
          'Projected annual result',
          f.sponsorshipIncome + f.tvRightsIncome + f.merchandiseIncome -
          wages - staffWages - f.arenaMaintenance - f.medicalCosts -
          f.youthAcademyCosts - f.travelCosts,
        )}
      </div>
    </>
  );
}

export function StaffScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const [role, setRole] = useState<StaffRole>(StaffRole.AssistantCoach);
  const [candidates, setCandidates] = useState<Staff[]>([]);

  const hirableRoles = (Object.values(StaffRole) as Array<StaffRole | string>)
    .filter((r): r is StaffRole => typeof r === 'number' && r !== StaffRole.HeadCoach);

  const hire = (id: number): void => {
    g.hireStaffMember(id);
    setCandidates((cs) => cs.filter((c) => c.id !== id));
  };

  return (
    <>
      <h1>Staff</h1>
      <p className="subtitle">
        Coaching quality drives development; medical staff drive injury recovery;
        scouts determine how precise your reports are.
      </p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Nat</th>
            <th className="num">Age</th>
            <th className="num">Rating</th>
            <th className="num">Wage</th>
            <th>Best regions</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {club.staff
            .filter((id) => world.staff[id]?.role !== StaffRole.HeadCoach)
            .map((id) => {
              const s = world.staff[id];
              if (s === undefined) return null;
              const rating = staffRating(s);
              const regions = Object.entries(s.regionKnowledge)
                .sort((a, b) => b[1] - a[1]).slice(0, 2)
                .map(([k, v]) => `${k} ${v}`).join(', ');
              return (
                <tr key={id}>
                  <td>{s.firstName} {s.lastName}</td>
                  <td className="dim">{STAFF_ROLE_NAMES[s.role]}</td>
                  <td><Flag nation={s.nation} /></td>
                  <td className="num">{world.year - s.birthYear}</td>
                  <td className={`num ${rating >= 15 ? 'good' : rating <= 8 ? 'bad' : ''}`}>
                    {rating.toFixed(1)}
                  </td>
                  <td className="num dim">{money(s.wage)}</td>
                  <td className="faint">{regions}</td>
                  <td>
                    <button
                      onClick={() => {
                        if (window.confirm(`Let ${s.firstName} ${s.lastName} go?`)) g.fireStaffMember(id);
                      }}
                    >
                      Fire
                    </button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      <h2>Recruit staff</h2>
      <div className="toolbar">
        <select
          value={role}
          onChange={(e) => { setRole(Number(e.target.value) as StaffRole); setCandidates([]); }}
        >
          {hirableRoles.map((r) => <option key={r} value={r}>{STAFF_ROLE_NAMES[r]}</option>)}
        </select>
        <button onClick={() => setCandidates(g.recruitStaffCandidates(role))}>
          Search candidates
        </button>
      </div>
      {candidates.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Nat</th>
              <th className="num">Age</th>
              <th className="num">Rating</th>
              <th className="num">Wage</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {candidates.map((s) => {
              const rating = staffRating(s);
              return (
                <tr key={s.id}>
                  <td>{s.firstName} {s.lastName}</td>
                  <td><Flag nation={s.nation} /></td>
                  <td className="num">{world.year - s.birthYear}</td>
                  <td className={`num ${rating >= 15 ? 'good' : rating <= 8 ? 'bad' : ''}`}>
                    {rating.toFixed(1)}
                  </td>
                  <td className="num dim">{money(s.wage)}</td>
                  <td><button onClick={() => hire(s.id)}>Hire</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * Scouting.
 *
 * A player is a name on a list until a scout has actually watched them play —
 * attributes only appear once there is some matches-watched knowledge on
 * record, whether from dedicated scouting work or (for the genuinely famous)
 * from reputation alone. Ranges narrow as that knowledge accumulates.
 */
export function ScoutingScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const [target, setTarget] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const targets = g.scoutingPool(query);
  const matchesWatched = target !== null ? totalMatchesWatched(world, target) : 0;
  const report = target !== null && matchesWatched > 0
    ? buildScoutReport(world, world.userClubId, target, { confidence: 0, matchesWatched })
    : null;

  const committed = club.players.reduce((s, p) => s + store.wage[p], 0);
  const targetIsFreeAgent = target !== null && store.clubId[target] < 0;
  const affordable = target !== null && store.wage[target] <= club.finances.wageBudget - committed;
  const pending = target !== null
    ? world.scoutingQueue.find((t) => t.playerIdx === target)
    : undefined;

  return (
    <>
      <h1>Scouting</h1>
      <p className="subtitle">
        Reports show ranges, not numbers, and stay blank until your scouts have
        actually seen the player. Send a scout to watch more matches to narrow
        the estimate — potential is always harder to judge than current ability.
      </p>

      <div className="panels" style={{ alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Available players</h2>
          <input
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Pos</th><th className="num">Age</th><th>Nat</th>
                  <th>Club</th><th className="num">Scouted</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((p) => {
                  const known = totalMatchesWatched(world, p);
                  return (
                    <tr
                      key={p}
                      className={`clickable${target === p ? ' selected' : ''}`}
                      onClick={() => setTarget(p)}
                    >
                      <td>{store.fullName(p)}</td>
                      <td><Pos pos={store.position[p] as Position} /></td>
                      <td className="num">{store.ageOn(p, world.year, 181)}</td>
                      <td><Flag nation={store.nation[p]} /></td>
                      <td className="dim">
                        {store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} short /> : 'Free agent'}
                      </td>
                      <td className={`num ${known > 0 ? 'dim' : 'faint'}`}>{known > 0 ? known : '—'}</td>
                    </tr>
                  );
                })}
                {targets.length === 0 && (
                  <tr><td colSpan={6}><Empty>No matching players found.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ flex: 1.4, minWidth: 0 }}>
          <h2>Scout report</h2>
          {target === null
            ? <Empty>Select a player to see what your scouts make of them.</Empty>
            : (
              <div className="panel">
                <div className="kv">
                  <span className="k">Player</span>
                  <strong>{store.fullName(target)}</strong>
                </div>
                <div className="kv">
                  <span className="k">Club</span>
                  <span>
                    {store.clubId[target] >= 0 ? <ClubLink id={store.clubId[target]} /> : 'Free agent'}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Matches watched</span>
                  <span>{matchesWatched}</span>
                </div>
                {pending !== undefined && (
                  <div className="kv">
                    <span className="k">Scouting trip</span>
                    <span className="faint">Report due {g.dateLabelForDay(pending.completesOnDay)}</span>
                  </div>
                )}
                <div className="toolbar" style={{ margin: '8px 0' }}>
                  <button disabled={pending !== undefined} onClick={() => g.scoutPlayer(target)}>
                    {pending !== undefined ? 'Scouting in progress…' : 'Scout this player'}
                  </button>
                  {targetIsFreeAgent && (
                    <button
                      className="primary"
                      disabled={!affordable}
                      onClick={() => g.signPlayer(target)}
                    >
                      Sign
                    </button>
                  )}
                </div>

                {report === null ? (
                  <Empty>
                    Your scouts have not seen this player yet — send a scout to
                    watch a few matches before any assessment is possible.
                  </Empty>
                ) : (
                  <>
                    <div className="kv">
                      <span className="k">Scout</span>
                      <span>{report.scoutName ?? 'No specialist scout employed'}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Confidence</span>
                      <span><Bar value={report.confidence * 100} /></span>
                    </div>

                    <h3 style={{ marginTop: 14 }}>Assessment</h3>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
                      {report.summary.map((s, i) => <li key={i} className="dim">{s}</li>)}
                    </ul>

                    <div className="kv">
                      <span className="k">Estimated ability</span>
                      <span>{report.abilityLow}–{report.abilityHigh}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Estimated potential</span>
                      <span className="elite">{report.potentialLow}–{report.potentialHigh}</span>
                    </div>

                    <h3 style={{ marginTop: 14 }}>Attributes</h3>
                    <div className="attrs">
                      {report.attributes.slice(0, 24).map((a) => (
                        <div className="attr" key={a.attribute}>
                          <span className="name">{ATTR_LABELS[a.attribute]}</span>
                          <span className="val">{formatEstimate(a)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
        </div>
      </div>
    </>
  );
}

export function TransfersScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const targets = g.transferTargets(100);
  const committed = club.players.reduce((s, p) => s + store.wage[p], 0);

  return (
    <>
      <h1>Transfers</h1>
      <p className="subtitle">
        Volleyball moves happen mostly at contract expiry rather than for fees.
        Wage room: {money(club.finances.wageBudget - committed)} · Squad{' '}
        {club.players.length}/16
      </p>

      {targets.length === 0
        ? <Empty>No free agents available right now. More become available at the season rollover.</Empty>
        : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Pos</th><th className="num">Age</th><th>Nat</th>
                <th className="num">Height</th><th className="num">Ability</th>
                <th className="num">Value</th><th className="num">Wage</th><th />
              </tr>
            </thead>
            <tbody>
              {targets.map((p) => {
                const affordable = store.wage[p] <= club.finances.wageBudget - committed;
                return (
                  <tr key={p}>
                    <td className="clickable" onClick={() => g.select(p)}>{store.fullName(p)}</td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{store.ageOn(p, world.year, 181)}</td>
                    <td><Flag nation={store.nation[p]} /></td>
                    <td className="num dim">{store.heightCm[p]}</td>
                    <td className={`num ${abilityClass(store.currentAbility[p])}`}>
                      {store.currentAbility[p]}
                    </td>
                    <td className="num dim">{money(store.value[p])}</td>
                    <td className={`num ${affordable ? '' : 'bad'}`}>{money(store.wage[p])}</td>
                    <td>
                      <button disabled={!affordable} onClick={() => g.signPlayer(p)}>Sign</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
        Nationality codes follow FIVB federation codes: {NATIONS.slice(0, 6).map((n) => n.code).join(', ')}…
      </p>
    </>
  );
}
