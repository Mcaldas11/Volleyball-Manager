import { useEffect, useState, type JSX, type ReactNode } from 'react';
import {
  BlockAssignment, DefensiveShape, DefensiveSystem, OffensiveSystem,
  ServeStrategy, ServeTarget, Tempo,
} from '../../engine/match/tactics.ts';
import {
  POSITION_NAMES, POSITION_SHORT, POSITIONS, type Position,
} from '../../engine/model/positions.ts';
import { STAFF_ROLE_NAMES, StaffRole, staffRating, type Staff } from '../../engine/model/staff.ts';
import { buildScoutReport, formatEstimate, totalMatchesWatched } from '../../engine/world/scouting.ts';
import { ATTR_LABELS } from '../../engine/model/attributes.ts';
import {
  abilityClass, Bar, Card, ChoiceField, ClubLink, Empty, Flag, KV, money, moneyShort, MoneyInput,
  parseMoneyShort, PlayerFace, Pos, Segmented, SortTh, StarMeter, StatTile, sortBy, useSort,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { DEFAULT_SCOUT_FILTERS, useGame, type ScoutFilters } from '../state.ts';

/** The team-instruction choices, shared by the Tactics screen and the
 *  in-match timeout panel so both always offer exactly the same options. */
export const OFFENSE_OPTIONS: Array<[OffensiveSystem, string]> = [
  [OffensiveSystem.Fast, 'Fast offence'],
  [OffensiveSystem.Balanced, 'Balanced'],
  [OffensiveSystem.OutsideFocused, 'Outside focused'],
  [OffensiveSystem.OppositeFocused, 'Opposite focused'],
  [OffensiveSystem.MiddleFocused, 'Middle focused'],
  [OffensiveSystem.PipeHeavy, 'Pipe heavy'],
  [OffensiveSystem.BackRowHeavy, 'Back-row heavy'],
];

export const TEMPO_OPTIONS: Array<[Tempo, string]> = [
  [Tempo.VeryFast, 'Very fast'],
  [Tempo.Fast, 'Fast'],
  [Tempo.Balanced, 'Balanced'],
  [Tempo.Slow, 'Slow'],
];

export const DEFENSE_OPTIONS: Array<[DefensiveSystem, string]> = [
  [DefensiveSystem.Conservative, 'Conservative'],
  [DefensiveSystem.Aggressive, 'Aggressive'],
  [DefensiveSystem.TripleBlockPriority, 'Triple block priority'],
  [DefensiveSystem.ServicePressure, 'Service pressure'],
  [DefensiveSystem.ReceptionStability, 'Reception stability'],
];

export const SERVE_OPTIONS: Array<[ServeStrategy, string]> = [
  [ServeStrategy.Risky, 'Risky'],
  [ServeStrategy.Balanced, 'Balanced'],
  [ServeStrategy.Conservative, 'Conservative'],
];

/** A team instruction as a row of toggle tiles — every option visible at
 *  once, the current one lit — rather than hidden behind a dropdown. */
function InstructionTiles<T extends number>({
  label, hint, value, options, onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="instr">
      <div className="instr-head">
        <span className="instr-label">{label}</span>
        <span className="instr-current">{options.find(([v]) => v === value)?.[1] ?? ''}</span>
      </div>
      <div className="instr-tiles">
        {options.map(([v, l]) => (
          <button key={v} className={`instr-tile${v === value ? ' active' : ''}`} onClick={() => onChange(v)}>
            {v === value && <Icon name="check" size={13} />}
            {l}
          </button>
        ))}
      </div>
      {hint !== undefined && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TacticsScreen(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const t = club.tactics;

  return (
    <>
      <p className="page-intro">
        These instructions feed straight into the rally engine — they change which attacker the
        setter picks and how the block forms, not a hidden team rating.
      </p>

      <div className="grid2">
        <Card title="In Possession" icon="ball">
          <InstructionTiles
            label="Offensive system"
            value={t.offense}
            onChange={(v) => { t.offense = v; g.touch(); }}
            hint="Determines how the setter distributes the ball across the available attack lanes."
            options={OFFENSE_OPTIONS}
          />
          <InstructionTiles
            label="Tempo"
            value={t.tempo}
            onChange={(v) => { t.tempo = v; g.touch(); }}
            hint="Faster tempo beats the block but demands a better pass and a better setter."
            options={TEMPO_OPTIONS}
          />
        </Card>

        <div className="stack">
          <Card title="Out of Possession" icon="club">
            <InstructionTiles
              label="Defensive system"
              value={t.defense}
              onChange={(v) => { t.defense = v; g.touch(); }}
              hint="Trades block pressure against floor coverage."
              options={DEFENSE_OPTIONS}
            />
          </Card>
          <Card title="Serving" icon="fastForward">
            <InstructionTiles
              label="Serve strategy"
              value={t.serve}
              onChange={(v) => { t.serve = v; g.touch(); }}
              hint="Risky serving buys aces and pays for them in errors."
              options={SERVE_OPTIONS}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

/** A slider with its current value spelled out beside it. */
function SliderField({
  label, value, onChange, left, right,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
}): JSX.Element {
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label">{label}</span>
        <span className="slider-value">{value}</span>
      </div>
      <input
        type="range" min={0} max={100} value={value} className="slider"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="slider-ends"><span>{left}</span><span>{right}</span></div>
    </div>
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

  // selection.lineup is the P1 reference (setter at zone index 0). A real
  // rotation moves each player from zone z+1 into zone z (court.ts's
  // rotate()), which walks the setter *down* through the zone numbers — so
  // reaching "setter in zone `rot`" means stepping the lineup back by `rot`,
  // not forward.
  const zones = Array.from({ length: 6 }, (_, z) => selection.lineup[(z - rot + 6) % 6]);
  const zoneOrder = [3, 2, 1, 4, 5, 0]; // display order: 4,3,2 front then 5,6,1 back
  const zoneLabels = ['1', '2', '3', '4', '5', '6'];
  const setterFront = rot >= 1 && rot <= 3;

  return (
    <>
      <p className="page-intro">
        Rotations are named for the zone the setter stands in. When the setter is front row only two
        attackers are available — those rotations score less and need different instructions.
      </p>

      <div className="rot-bar">
        <Segmented
          options={[0, 1, 2, 3, 4, 5].map((i) => [i, `P${i + 1}`] as const)}
          value={rot}
          onChange={setRot}
        />
        <span className={`rot-flag${setterFront ? ' warn' : ''}`}>
          {setterFront ? 'Setter front row · two attackers' : 'Setter back row · three attackers'}
        </span>
      </div>

      <div className="rot-layout">
        <Card title={`Rotation P${rot + 1}`} icon="tactics">
          <div className="rot-court">
            <div className="rot-net">Net</div>
            <div className="rot-grid">
              {zoneOrder.map((z) => {
                const p = zones[z];
                if (p === undefined) return <div className="rot-zone" key={z} />;
                const pos = store.position[p] as Position;
                const isSetter = POSITION_SHORT[pos] === 'S';
                return (
                  <div className={`rot-zone${isSetter ? ' setter' : ''}${z >= 1 && z <= 3 ? ' front' : ''}`} key={z}>
                    <span className="rot-zone-num">{zoneLabels[z]}</span>
                    <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={40} />
                    <span className="rot-zone-name">{store.shortName(p)}</span>
                    <Pos pos={pos} />
                  </div>
                );
              })}
            </div>
          </div>
          <p className="footnote">
            Libero replaces the middle blocker in zones 5 and 6. The middle serves from zone 1, since a
            libero may not serve.
          </p>
        </Card>

        <Card title={`Instructions for P${rot + 1}`} icon="whistle">
          <ChoiceField
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
          <ChoiceField
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
          <ChoiceField
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
          <ChoiceField
            label="Defensive shape"
            value={r.defensiveShape}
            onChange={(v) => { r.defensiveShape = v; g.touch(); }}
            options={[
              [DefensiveShape.PerimeterDefense, 'Perimeter'],
              [DefensiveShape.RotationDefense, 'Rotation'],
              [DefensiveShape.ManUpDefense, 'Man-up'],
            ]}
          />
          <SliderField
            label="Back-row transition"
            value={r.transitionBackRow}
            onChange={(v) => { r.transitionBackRow = v; g.touch(); }}
            left="Rarely"
            right="Often"
          />
          <SliderField
            label="Setter tempo bias"
            value={r.setterTempoBias}
            onChange={(v) => { r.setterTempoBias = v; g.touch(); }}
            left="Slower"
            right="Quicker"
          />
        </Card>
      </div>
    </>
  );
}

function outlook(age: number, headroom: number): { text: string; cls: string } {
  if (age <= 21 && headroom > 250) return { text: 'Rapid development expected', cls: 'good' };
  if (age <= 24 && headroom > 120) return { text: 'Still improving', cls: 'good' };
  if (age <= 30) return { text: 'At or near peak', cls: '' };
  if (age <= 33) return { text: 'Gradual decline', cls: 'warn' };
  return { text: 'In steep decline', cls: 'bad' };
}

export function TrainingScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const squad = g.squad();
  const improving = squad.filter((p) => {
    const age = store.ageOn(p, world.year, 181);
    return age <= 24 && store.potentialAbility[p] - store.currentAbility[p] > 120;
  }).length;

  return (
    <>
      <div className="tiles">
        <StatTile
          label="Training facilities"
          value={`${club.trainingFacilities}/20`}
          sub={<Bar value={club.trainingFacilities} max={20} wide />}
        />
        <StatTile label="Still developing" value={improving} sub="players with room to grow" tone="good" />
        <StatTile label="Squad" value={squad.length} sub="senior players training" />
      </div>
      <p className="page-intro">
        Development runs weekly and depends on age, potential, coaching, facilities and the player's
        own professionalism.
      </p>

      <Card title="Player Development" icon="training" flush>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <th>Player</th>
                <th>Pos</th>
                <th className="num">Age</th>
                <th className="num">Ability</th>
                <th className="num">Potential</th>
                <th>Headroom</th>
                <th>Condition</th>
                <th className="num" title="Professionalism and work ethic">Application</th>
                <th>Outlook</th>
              </tr>
            </thead>
            <tbody>
              {squad.map((p) => {
                const age = store.ageOn(p, world.year, 181);
                const ca = store.currentAbility[p];
                const pa = store.potentialAbility[p];
                const headroom = pa - ca;
                // Coachability deliberately excluded: it's a hidden attribute, and
                // averaging it in here would let a coach back-solve its value from
                // the two visible ones — breaking the "never shown as a number" rule.
                const application = Math.round(
                  (store.getAttr(p, 'professionalism') + store.getAttr(p, 'workEthic')) / 2,
                );
                const o = outlook(age, headroom);
                return (
                  <tr key={p} className="clickable" onClick={() => g.select(p)}>
                    <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                    <td className="strong">{store.fullName(p)}</td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{age}</td>
                    <td className={`num ${abilityClass(ca)}`}>{ca}</td>
                    <td className="num faint">{pa}</td>
                    <td>
                      <span className="headroom">
                        <span className="headroom-bar">
                          <span className="headroom-ca" style={{ width: `${(ca / 2000) * 100}%` }} />
                          <span
                            className="headroom-gap"
                            style={{ left: `${(ca / 2000) * 100}%`, width: `${(Math.max(0, headroom) / 2000) * 100}%` }}
                          />
                        </span>
                        <span className={headroom > 200 ? 'good' : 'dim'}>{headroom > 0 ? `+${headroom}` : '—'}</span>
                      </span>
                    </td>
                    <td><Bar value={store.condition[p]} /></td>
                    <td className={`num ${application >= 15 ? 'good' : application <= 8 ? 'bad' : ''}`}>
                      {application}
                    </td>
                    <td className={o.cls}>{o.text}</td>
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

/** A money line with a bar sized against the largest line in its card. */
function MoneyLine({
  label, value, max, tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'income' | 'cost';
}): JSX.Element {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="money-line">
      <span className="money-line-label">{label}</span>
      <span className={`money-line-bar ${tone}`}><span style={{ width: `${pct}%` }} /></span>
      <span className={`money-line-value ${tone === 'income' ? 'good' : 'bad'}`}>
        {tone === 'cost' && value !== 0 ? '-' : ''}{money(Math.abs(value))}
      </span>
    </div>
  );
}

export function FinancesScreen(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const store = g.world!.players;
  const f = club.finances;
  // Senior-squad wages only — matches the affordability check a transfer
  // negotiation actually runs (see submitTermsOffer), so this is "room left
  // to sign someone," not the club's total wage-type spend.
  const wages = club.players.reduce((s, p) => s + store.wage[p], 0);
  const youthWages = club.youthPlayers.reduce((s, p) => s + store.wage[p], 0);
  const staffWages = club.staff.reduce((s, id) => s + (g.world!.staff[id]?.wage ?? 0), 0);
  // Mirrors settleFinances() in rollover.ts exactly, so this is a true preview
  // of what rollover will do if the season ended today.
  const totalIncome = f.sponsorshipIncome + f.tvRightsIncome + f.merchandiseIncome + f.seasonIncome;
  const totalCosts = wages + youthWages + staffWages +
    f.arenaMaintenance + f.medicalCosts + f.youthAcademyCosts + f.seasonExpenditure;
  const result = totalIncome - totalCosts;
  const envelope = f.wageBudget + f.transferBudget;
  const wageShare = envelope > 0 ? (f.wageBudget / envelope) * 100 : 50;

  const incomeLines: Array<[string, number]> = [
    ['Sponsorship', f.sponsorshipIncome],
    ['TV rights', f.tvRightsIncome],
    ['Merchandise', f.merchandiseIncome],
    ['Gate receipts so far', f.seasonIncome],
  ];
  const costLines: Array<[string, number]> = [
    ['Player wages', wages],
    ['Youth wages', youthWages],
    ['Staff wages', staffWages],
    ['Arena maintenance', f.arenaMaintenance],
    ['Medical', f.medicalCosts],
    ['Youth academy', f.youthAcademyCosts],
    ['Travel so far', f.seasonExpenditure],
  ];
  const maxLine = Math.max(...incomeLines.map(([, v]) => v), ...costLines.map(([, v]) => v), 1);

  return (
    <>
      {f.seasonsInDebt > 0 && (
        <div className="alert alert-bad">
          <Icon name="alert" size={18} />
          <span>
            {f.seasonsInDebt} consecutive season(s) in the red — three means dissolution.
          </span>
        </div>
      )}

      <div className="tiles">
        <StatTile label="Balance" value={money(f.balance)} tone={f.balance < 0 ? 'bad' : 'good'} sub={`${club.arenaName}`} />
        <StatTile label="Wage budget" value={money(f.wageBudget)} sub={`${money(f.wageBudget - wages)} unused`} />
        <StatTile label="Transfer budget" value={money(f.transferBudget)} />
        <StatTile
          label="Projected result"
          value={`${result >= 0 ? '+' : ''}${money(result)}`}
          tone={result >= 0 ? 'good' : 'bad'}
          sub="if the season ended today"
        />
      </div>

      <div className="grid3">
        <Card title="Budgets" icon="finances">
          <KV k="Wage budget"><MoneyInput value={f.wageBudget} onChange={(v) => g.setWageBudget(v)} /></KV>
          <KV k="Transfer budget"><MoneyInput value={f.transferBudget} onChange={(v) => g.setTransferBudget(v)} /></KV>
          <div className="split-bar" title="Wage / transfer split">
            <span className="split-wage" style={{ width: `${wageShare}%` }} />
            <span className="split-transfer" style={{ width: `${100 - wageShare}%` }} />
          </div>
          <div className="split-legend">
            <span><i className="dot split-wage" /> Wages {wageShare.toFixed(0)}%</span>
            <span><i className="dot split-transfer" /> Transfers {(100 - wageShare).toFixed(0)}%</span>
          </div>
          <KV k="Committed wages (senior squad)" cls="bad">{money(-wages)}</KV>
          <KV k="Remaining for signings" cls={f.wageBudget - wages < 0 ? 'bad' : 'good'}>{money(f.wageBudget - wages)}</KV>
          <p className="footnote">
            The board sets {money(envelope)} to split between wages and transfers each season — moving
            money into one side takes it from the other.
          </p>
        </Card>

        <Card title="Income (annual)" icon="stats">
          {incomeLines.map(([k, v]) => <MoneyLine key={k} label={k} value={v} max={maxLine} tone="income" />)}
          {f.prizeMoney > 0 && <KV k="Of which prize money" cls="good">{money(f.prizeMoney)}</KV>}
          <KV k="Per match (full house)" cls="good">{money(f.ticketIncomePerMatch)}</KV>
          <div className="money-total"><span>Income so far</span><strong className="good">{money(totalIncome)}</strong></div>
        </Card>

        <Card title="Expenditure (annual)" icon="stats">
          {costLines.map(([k, v]) => <MoneyLine key={k} label={k} value={v} max={maxLine} tone="cost" />)}
          <div className="money-total"><span>Costs so far</span><strong className="bad">{money(-totalCosts)}</strong></div>
        </Card>
      </div>

      <Card title="Projection" icon="calendar" style={{ marginTop: 16 }}>
        <div className="projection">
          <div><span className="faint">Income so far</span><strong className="good">{money(totalIncome)}</strong></div>
          <span className="projection-op">−</span>
          <div><span className="faint">Costs so far</span><strong className="bad">{money(totalCosts)}</strong></div>
          <span className="projection-op">=</span>
          <div>
            <span className="faint">Result if the season ended today</span>
            <strong className={result < 0 ? 'bad' : 'good'}>{money(result)}</strong>
          </div>
        </div>
        <p className="footnote">
          Sponsorship and TV rights are locked in for the season; gate receipts and travel costs accrue
          match by match, so this figure moves as the season goes on.
        </p>
      </Card>
    </>
  );
}

function ratingCls(rating: number): string {
  return rating >= 15 ? 'good' : rating <= 8 ? 'bad' : '';
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

  const members = club.staff
    .map((id) => world.staff[id])
    .filter((s): s is Staff => s !== undefined && s.role !== StaffRole.HeadCoach);
  const wageTotal = members.reduce((s, m) => s + m.wage, 0);
  const avgRating = members.length > 0 ? members.reduce((s, m) => s + staffRating(m), 0) / members.length : 0;

  return (
    <>
      <div className="tiles">
        <StatTile label="Staff members" value={members.length} />
        <StatTile label="Average rating" value={avgRating.toFixed(1)} sub={<Bar value={avgRating} max={20} wide />} />
        <StatTile label="Staff wages" value={money(wageTotal)} sub="per season" />
      </div>
      <p className="page-intro">
        Coaching quality drives development; medical staff drive injury recovery; scouts determine
        how precise your reports are.
      </p>

      <Card title="Backroom Staff" icon="staff" flush>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Nat</th>
                <th className="num">Age</th>
                <th>Rating</th>
                <th className="num">Wage</th>
                <th>Best regions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((s) => {
                const rating = staffRating(s);
                const scoutsRegions = s.role === StaffRole.Scout || s.role === StaffRole.HeadScout ||
                  s.role === StaffRole.RecruitmentAnalyst;
                const regions = scoutsRegions
                  ? Object.entries(s.regionKnowledge)
                    .sort((a, b) => b[1] - a[1]).slice(0, 2)
                    .map(([k, v]) => `${k} ${v}`).join(', ')
                  : '';
                return (
                  <tr key={s.id}>
                    <td className="strong">{s.firstName} {s.lastName}</td>
                    <td><span className="role-chip">{STAFF_ROLE_NAMES[s.role]}</span></td>
                    <td><Flag nation={s.nation} /></td>
                    <td className="num">{world.year - s.birthYear}</td>
                    <td>
                      <span className="rating-cell">
                        <Bar value={rating} max={20} />
                        <span className={ratingCls(rating)}>{rating.toFixed(1)}</span>
                      </span>
                    </td>
                    <td className="num dim">{money(s.wage)}</td>
                    <td className="faint">{scoutsRegions ? regions : '—'}</td>
                    <td className="num">
                      <button
                        className="sm danger"
                        onClick={() => {
                          if (window.confirm(`Let ${s.firstName} ${s.lastName} go?`)) g.fireStaffMember(s.id);
                        }}
                      >
                        Fire
                      </button>
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && <tr><td colSpan={8}><Empty>No backroom staff employed.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Recruit Staff"
        icon="search"
        style={{ marginTop: 16 }}
        flush={candidates.length > 0}
        actions={(
          <div className="toolbar-inline">
            <select
              value={role}
              onChange={(e) => { setRole(Number(e.target.value) as StaffRole); setCandidates([]); }}
            >
              {hirableRoles.map((r) => <option key={r} value={r}>{STAFF_ROLE_NAMES[r]}</option>)}
            </select>
            <button className="accent" onClick={() => setCandidates(g.recruitStaffCandidates(role))}>
              <Icon name="search" size={14} /> Search candidates
            </button>
          </div>
        )}
      >
        {candidates.length === 0
          ? <Empty>Pick a role and search to see who is available.</Empty>
          : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Nat</th>
                  <th className="num">Age</th>
                  <th>Rating</th>
                  <th className="num">Wage</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((s) => {
                  const rating = staffRating(s);
                  return (
                    <tr key={s.id}>
                      <td className="strong">{s.firstName} {s.lastName}</td>
                      <td><Flag nation={s.nation} /></td>
                      <td className="num">{world.year - s.birthYear}</td>
                      <td>
                        <span className="rating-cell">
                          <Bar value={rating} max={20} />
                          <span className={ratingCls(rating)}>{rating.toFixed(1)}</span>
                        </span>
                      </td>
                      <td className="num dim">{money(s.wage)}</td>
                      <td className="num"><button className="sm primary" onClick={() => hire(s.id)}>Hire</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </Card>
    </>
  );
}

/** Bands offered by the scouting screen's "min potential" filter, on the
 *  same 0-2000 scale (and the same thresholds) as {@link abilityClass}. */
const POTENTIAL_BANDS: ReadonlyArray<[number, string]> = [
  [0, 'Any potential'],
  [800, 'Promising (800+)'],
  [1100, 'Good (1100+)'],
  [1400, 'Great (1400+)'],
  [1650, 'Elite (1650+)'],
];

/** An estimated range on the 0-2000 ability scale, drawn as a band. */
function RangeBar({ low, high }: { low: number; high: number }): JSX.Element {
  return (
    <span className="range-bar" title={`${low}–${high}`}>
      <span style={{ left: `${(low / 2000) * 100}%`, width: `${Math.max(1.2, ((high - low) / 2000) * 100)}%` }} />
    </span>
  );
}

function FilterField({ label, span, children }: { label: string; span?: number; children: ReactNode }): JSX.Element {
  return (
    <div className="filter-field" style={span !== undefined ? { gridColumn: `span ${span}` } : undefined}>
      <label>{label}</label>
      {children}
    </div>
  );
}

type ScoutSort = 'name' | 'pos' | 'age' | 'height' | 'value' | 'scouted';

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
  const [target, setTarget] = useState<number | null>(g.scoutingFocus);
  const [filters, setFilters] = useState<ScoutFilters>(DEFAULT_SCOUT_FILTERS);
  const [priceText, setPriceText] = useState('');
  const [sort, onSort] = useSort<ScoutSort | 'default'>('default');

  // Consume any pending scouting focus exactly once, right after mounting.
  useEffect(() => {
    if (g.scoutingFocus !== null) g.clearScoutingFocus();
  }, []);

  const setFilter = <K extends keyof ScoutFilters>(key: K, value: ScoutFilters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
  };
  const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const commitPrice = (): void => {
    const trimmed = priceText.trim();
    if (trimmed === '') { setFilter('valueMax', null); return; }
    const parsed = parseMoneyShort(trimmed);
    if (parsed !== null) { setFilter('valueMax', parsed); setPriceText(moneyShort(parsed)); }
    else setPriceText(filters.valueMax !== null ? moneyShort(filters.valueMax) : '');
  };

  const clearFilters = (): void => {
    setFilters(DEFAULT_SCOUT_FILTERS);
    setPriceText('');
  };
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_SCOUT_FILTERS);

  const pool = g.scoutingPool(filters);
  // The pool arrives best-first; only re-sort once a column is chosen.
  const targets = sort.key === 'default' ? pool : sortBy(pool, sort, (p, k) => {
    switch (k) {
      case 'name': return store.fullName(p);
      case 'pos': return store.position[p];
      case 'age': return store.ageOn(p, world.year, 181);
      case 'height': return store.heightCm[p];
      case 'value': return store.value[p];
      case 'scouted': return totalMatchesWatched(world, p);
      default: return 0;
    }
  });
  const matchesWatched = target !== null ? totalMatchesWatched(world, target) : 0;
  const report = target !== null && matchesWatched > 0
    ? buildScoutReport(world, world.userClubId, target, { matchesWatched })
    : null;

  const pending = target !== null
    ? world.scoutingQueue.find((t) => t.playerIdx === target)
    : undefined;

  return (
    <>
      <p className="page-intro">
        Reports show ranges, not numbers, and stay blank until your scouts have actually seen the
        player. Send a scout to watch more matches to narrow the estimate — potential is always harder
        to judge than current ability.
      </p>

      <Card
        title="Search Filters"
        icon="search"
        style={{ marginBottom: 16 }}
        actions={<button className="sm" disabled={!filtersActive} onClick={clearFilters}>Clear filters</button>}
      >
        <div className="filter-bar">
          <FilterField label="Name" span={2}>
            <input
              placeholder="Search by name…"
              value={filters.query}
              onChange={(e) => setFilter('query', e.target.value)}
            />
          </FilterField>

          <FilterField label="Position" span={3}>
            <Segmented
              size="sm"
              options={[[-1, 'Any'], ...POSITIONS.map((pos) => [pos, POSITION_NAMES[pos]] as const)]}
              value={filters.position ?? -1}
              onChange={(v) => setFilter('position', v < 0 ? null : (v as Position))}
            />
          </FilterField>

          <FilterField label="Age">
            <div className="filter-range">
              <input
                type="number" min={16} max={45} placeholder="Min"
                value={filters.ageMin ?? ''}
                onChange={(e) => setFilter('ageMin', toNum(e.target.value))}
              />
              <span>–</span>
              <input
                type="number" min={16} max={45} placeholder="Max"
                value={filters.ageMax ?? ''}
                onChange={(e) => setFilter('ageMax', toNum(e.target.value))}
              />
            </div>
          </FilterField>

          <FilterField label="Height (cm)">
            <div className="filter-range">
              <input
                type="number" min={150} max={230} placeholder="Min"
                value={filters.heightMin ?? ''}
                onChange={(e) => setFilter('heightMin', toNum(e.target.value))}
              />
              <span>–</span>
              <input
                type="number" min={150} max={230} placeholder="Max"
                value={filters.heightMax ?? ''}
                onChange={(e) => setFilter('heightMax', toNum(e.target.value))}
              />
            </div>
          </FilterField>

          <FilterField label="Potential">
            <select
              value={filters.potentialMin}
              onChange={(e) => setFilter('potentialMin', Number(e.target.value))}
            >
              {POTENTIAL_BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FilterField>

          <FilterField label="Max price">
            <input
              placeholder="No limit"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commitPrice(); (e.target as HTMLInputElement).blur(); }
              }}
            />
          </FilterField>

          <FilterField label="Contract">
            <label className="filter-check">
              <input
                type="checkbox"
                checked={filters.freeAgentOnly}
                onChange={(e) => setFilter('freeAgentOnly', e.target.checked)}
              />
              Free agents only
            </label>
          </FilterField>
        </div>
      </Card>

      <div className="scout-layout">
        <Card
          title="Players"
          icon="squad"
          flush
          actions={<span className="faint">{targets.length} found</span>}
        >
          <div className="table-wrap scout-table">
            <table className="data-table">
              <thead>
                <tr>
                  <SortTh k="name" sort={sort} onSort={onSort}>Name</SortTh>
                  <SortTh k="pos" sort={sort} onSort={onSort}>Pos</SortTh>
                  <SortTh k="age" sort={sort} onSort={onSort} num>Age</SortTh>
                  <SortTh k="height" sort={sort} onSort={onSort} num>Ht</SortTh>
                  <th>Nat</th>
                  <th>Club</th>
                  <SortTh k="value" sort={sort} onSort={onSort} num>Value</SortTh>
                  <SortTh k="scouted" sort={sort} onSort={onSort} num title="Matches watched">Scouted</SortTh>
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
                      <td className="strong">{store.fullName(p)}</td>
                      <td><Pos pos={store.position[p] as Position} /></td>
                      <td className="num">{store.ageOn(p, world.year, 181)}</td>
                      <td className="num dim">{store.heightCm[p]}</td>
                      <td><Flag nation={store.nation[p]} /></td>
                      <td className="dim">
                        {store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} short /> : <span className="free-tag">Free</span>}
                      </td>
                      <td className="num dim">{money(store.value[p])}</td>
                      <td className="num">
                        {known > 0 ? <span className="scouted-tag">{known}</span> : <span className="faint">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {targets.length === 0 && (
                  <tr><td colSpan={8}><Empty>No players match these filters.</Empty></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Scout Report" icon="scouting" className="scout-report">
          {target === null
            ? <Empty>Select a player to see what your scouts make of them.</Empty>
            : (
              <>
                <div className="report-head">
                  <PlayerFace playerId={store.id[target]} name={store.fullName(target)} size={56} />
                  <div className="report-head-text">
                    <strong className="report-name">{store.fullName(target)}</strong>
                    <span className="report-sub">
                      <Pos pos={store.position[target] as Position} />
                      <Flag nation={store.nation[target]} />
                      <span>Age {store.ageOn(target, world.year, 181)}</span>
                      <span>{store.heightCm[target]} cm</span>
                    </span>
                    <span className="report-sub">
                      {store.clubId[target] >= 0 ? <ClubLink id={store.clubId[target]} /> : 'Free agent'}
                    </span>
                  </div>
                </div>

                <KV k="Market value">{money(store.value[target])}</KV>
                <KV k="Matches watched">{matchesWatched}</KV>
                {pending !== undefined && (
                  <KV k="Scouting trip" cls="warn">Report due {g.dateLabelForDay(pending.completesOnDay)}</KV>
                )}
                <div className="report-actions">
                  <button disabled={pending !== undefined} onClick={() => g.scoutPlayer(target)}>
                    <Icon name="scouting" size={14} />
                    {pending !== undefined ? 'Scouting in progress…' : 'Scout this player'}
                  </button>
                  <button className="primary" onClick={() => g.startNegotiation(target)}>
                    <Icon name="transfers" size={14} /> Negotiate transfer
                  </button>
                </div>

                {report === null ? (
                  <Empty>
                    Your scouts have not seen this player yet — send a scout to watch a few matches
                    before any assessment is possible.
                  </Empty>
                ) : (
                  <>
                    <KV k="Scout">{report.scoutName ?? 'No specialist scout employed'}</KV>
                    <KV k="Confidence"><Bar value={report.confidence * 100} wide /></KV>

                    <h4 className="section-label">Assessment</h4>
                    <ul className="report-summary">
                      {report.summary.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>

                    <div className="range-row">
                      <span className="range-label">Estimated ability</span>
                      <RangeBar low={report.abilityLow} high={report.abilityHigh} />
                      <span className="range-value">{report.abilityLow}–{report.abilityHigh}</span>
                    </div>
                    <div className="range-row">
                      <span className="range-label">Estimated potential</span>
                      <RangeBar low={report.potentialLow} high={report.potentialHigh} />
                      <span className={`range-value ${abilityClass((report.potentialLow + report.potentialHigh) / 2)}`}>
                        {report.potentialLow}–{report.potentialHigh}
                      </span>
                    </div>
                    <div className="range-stars">
                      <StarMeter value={(report.potentialLow + report.potentialHigh) / 2} size={14} />
                      <span className="faint">scout's view of potential</span>
                    </div>

                    <h4 className="section-label">Attributes</h4>
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
              </>
            )}
        </Card>
      </div>
    </>
  );
}

type TransferSort = 'name' | 'pos' | 'age' | 'height' | 'ability' | 'value' | 'wage';

export function TransfersScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const targets = g.transferTargets(100);
  const committed = club.players.reduce((s, p) => s + store.wage[p], 0);
  const wageRoom = club.finances.wageBudget - committed;
  const offers = world.incomingOffers;
  const [sort, onSort] = useSort<TransferSort>('ability');

  const rows = sortBy(targets, sort, (p, k) => {
    switch (k) {
      case 'name': return store.fullName(p);
      case 'pos': return store.position[p];
      case 'age': return store.ageOn(p, world.year, 181);
      case 'height': return store.heightCm[p];
      case 'value': return store.value[p];
      case 'wage': return store.wage[p];
      default: return store.currentAbility[p];
    }
  });

  return (
    <>
      <div className="tiles">
        <StatTile label="Transfer budget" value={money(Math.min(club.finances.transferBudget, club.finances.balance))} sub="available to spend" />
        <StatTile label="Wage room" value={money(wageRoom)} tone={wageRoom < 0 ? 'bad' : 'good'} sub={`of ${money(club.finances.wageBudget)}`} />
        <StatTile label="Squad" value={`${club.players.length}/16`} tone={club.players.length >= 16 ? 'warn' : undefined} sub={club.players.length >= 16 ? 'full — release to sign' : 'places available'} />
        <StatTile label="Offers received" value={offers.length} tone={offers.length > 0 ? 'gold' : undefined} sub="awaiting a decision" />
      </div>

      {offers.length > 0 && (
        <Card title="Offers Received" icon="offer" flush style={{ marginBottom: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th><th>Pos</th><th>Bidding club</th>
                <th className="num">Offer</th><th className="num">Value</th><th>Expires</th><th />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td className="strong">{store.fullName(o.playerIdx)}</td>
                  <td><Pos pos={store.position[o.playerIdx] as Position} /></td>
                  <td><ClubLink id={o.buyingClubId} /></td>
                  <td className="num gold-text">{money(o.fee)}</td>
                  <td className="num dim">{money(store.value[o.playerIdx])}</td>
                  <td className="dim">{g.dateLabelForDay(o.expiresOnDay)}</td>
                  <td className="num"><button className="sm primary" onClick={() => g.openOffer(o.id)}>Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="page-intro">
        Volleyball moves happen mostly at contract expiry rather than for fees — these are the best
        unattached players available now. Use Scouting to approach players under contract elsewhere.
      </p>

      <Card title="Free Agents" icon="transfers" flush actions={<span className="faint">{targets.length} available</span>}>
        {targets.length === 0
          ? <Empty>No free agents available right now. More become available at the season rollover.</Empty>
          : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th />
                    <SortTh k="name" sort={sort} onSort={onSort}>Name</SortTh>
                    <SortTh k="pos" sort={sort} onSort={onSort}>Pos</SortTh>
                    <SortTh k="age" sort={sort} onSort={onSort} num>Age</SortTh>
                    <th>Nat</th>
                    <SortTh k="height" sort={sort} onSort={onSort} num>Height</SortTh>
                    <SortTh k="ability" sort={sort} onSort={onSort}>Ability</SortTh>
                    <SortTh k="value" sort={sort} onSort={onSort} num>Value</SortTh>
                    <SortTh k="wage" sort={sort} onSort={onSort} num>Wage</SortTh>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const affordable = store.wage[p] <= wageRoom;
                    return (
                      <tr key={p} className="clickable" onClick={() => g.select(p)}>
                        <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                        <td className="strong">{store.fullName(p)}</td>
                        <td><Pos pos={store.position[p] as Position} /></td>
                        <td className="num">{store.ageOn(p, world.year, 181)}</td>
                        <td><Flag nation={store.nation[p]} /></td>
                        <td className="num dim">{store.heightCm[p]}</td>
                        <td>
                          <span className="ability-cell">
                            <StarMeter value={store.currentAbility[p]} size={11} />
                            <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span>
                          </span>
                        </td>
                        <td className="num dim">{money(store.value[p])}</td>
                        <td className={`num ${affordable ? '' : 'bad'}`} title={affordable ? undefined : 'Over your remaining wage budget'}>
                          {money(store.wage[p])}
                        </td>
                        <td className="num">
                          <button className="sm primary" onClick={(e) => { e.stopPropagation(); g.startNegotiation(p); }}>
                            Negotiate
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
