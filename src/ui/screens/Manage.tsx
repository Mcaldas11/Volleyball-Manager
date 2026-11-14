import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { contractEndSeason } from '../../engine/world/world.ts';
import { receiveLineOf } from '../../engine/match/receiveLine.ts';
import type { PipeBall, ReceptionFormation, RotationPlay, RotationTactics } from '../../engine/match/tactics.ts';
import {
  BlockAssignment, Combinations, DefensiveShape, DefensiveSystem, Formation, formationOf, lineupSlotPositions,
  OffensiveSystem, PIPE_BALL_NAMES, ROTATION_PLAY_NAMES, ROTATION_PLAYS, ServeStrategy, ServeTarget, Tempo,
} from '../../engine/match/tactics.ts';
import {
  MAX_SQUAD, POSITION_NAMES, POSITION_SHORT, POSITIONS, Position,
} from '../../engine/model/positions.ts';
import { PlayDiagram, playDescription, playUnavailable, type PlayCast } from '../playDiagram.tsx';
import { buildScoutReport, formatEstimate, totalMatchesWatched } from '../../engine/world/scouting.ts';
import { clubBooks } from '../../engine/season/books.ts';
import { ATTR_LABELS } from '../../engine/model/attributes.ts';
import {
  abilityClass, Bar, Card, ChoiceField, ClubLink, Empty, Flag, KV, money, moneyShort, MoneyInput,
  parseMoneyShort, PlayerFace, Pos, Segmented, SortTh, StarMeter, StatTile, sortBy, useSort, WorkspaceHeading, useFitList, ListPager, Panel, Metric, StatusPill, EmptyState, Progress,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { DEFAULT_SCOUT_FILTERS, useGame, type ScoutFilters } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';
import { BlockPlanCard, TacticsBoard } from '../tacticsBoard.tsx';

export const FORMATION_OPTIONS: Array<[Formation, string]> = [
  [Formation.FiveOne, '5-1 (one setter)'],
  [Formation.FourTwo, '4-2 (two setters)'],
];

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

export const COMBINATION_OPTIONS: Array<[Combinations, string]> = [
  [Combinations.Off, 'Off'],
  [Combinations.Some, 'Now and then'],
  [Combinations.Often, 'Often'],
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

/** The per-rotation instruction choices, shared by the Rotations screen and the in-match tactics. */
export const ATTACKER_OPTIONS: Array<[Position | -1, string]> = [
  [-1, 'Automatic'],
  ...([0, 1, 2, 3] as Position[]).map((p) => [p, POSITION_NAMES[p]] as [Position, string]),
];

export const SERVE_TARGET_OPTIONS: Array<[ServeTarget, string]> = [
  [ServeTarget.Auto, 'Automatic'],
  [ServeTarget.WeakestPasser, 'Weakest passer'],
  [ServeTarget.Setter, 'The setter'],
  [ServeTarget.BestAttacker, 'Their best attacker'],
  [ServeTarget.DeepCorner, 'Deep corner'],
  [ServeTarget.ShortZone, 'Short zone'],
];

export const RECEPTION_OPTIONS: Array<[ReceptionFormation, string]> = [
  [3, 'Three passers'],
  [2, 'Two — hide an outside'],
  [4, 'Four — the opposite too'],
];

export const BLOCK_OPTIONS: Array<[BlockAssignment, string]> = [
  [BlockAssignment.ReadBlock, 'Read block'],
  [BlockAssignment.CommitMiddle, 'Commit on the middle'],
  [BlockAssignment.SpreadBlock, 'Spread block'],
  [BlockAssignment.ReleaseToLine, 'Release to line'],
];

export const SHAPE_OPTIONS: Array<[DefensiveShape, string]> = [
  [DefensiveShape.PerimeterDefense, 'Perimeter'],
  [DefensiveShape.RotationDefense, 'Rotation'],
  [DefensiveShape.ManUpDefense, 'Man-up'],
];

export function TacticsScreen(): JSX.Element {
  const g = useGame();
  const tactics = g.activeTactics();
  if (tactics === null) return <Empty>No team to instruct.</Empty>;
  return (
    <div className="tactics-page">
      <div className="strategy-ribbon">
        <div><span>System</span><strong>{FORMATION_OPTIONS.find(([f]) => f === formationOf(tactics))?.[1]}</strong></div>
        <div><span>Offence</span><strong>{OFFENSE_OPTIONS.find(([o]) => o === tactics.offense)?.[1]}</strong></div>
        <div><span>Tempo</span><strong>{TEMPO_OPTIONS.find(([o]) => o === tactics.tempo)?.[1]}</strong></div>
        <div><span>Defence</span><strong>{DEFENSE_OPTIONS.find(([o]) => o === tactics.defense)?.[1]}</strong></div>
        <button onClick={() => g.go('preplab')}><Icon name="stats" size={16} /> Compare tactical plans</button>
      </div>
      {g.nationalView() && <p className="nat-only">National team only — your club keeps its own.</p>}
      <TacticsBoard tactics={tactics} onChange={() => g.touch()} onFormation={(f) => g.setFormation(f)} />
    </div>
  );
}

/** A slider with its current value spelled out beside it. */
export function SliderField({
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
  const tactics = g.activeTactics();
  const store = world.players;
  const selection = g.lineup();
  const [rot, setRot] = useState(0);

  if (selection === null || tactics === null) return <Empty>No lineup available.</Empty>;
  const r = tactics.rotations[rot];

  // selection.lineup is the P1 reference (setter at zone index 0). A real
  // rotation moves each player from zone z+1 into zone z (court.ts's
  // rotate()), which walks the setter *down* through the zone numbers — so
  // reaching "setter in zone `rot`" means stepping the lineup back by `rot`,
  // not forward.
  const zones = Array.from({ length: 6 }, (_, z) => selection.lineup[(z - rot + 6) % 6]);
  const zoneOrder = [3, 2, 1, 4, 5, 0]; // display order: 4,3,2 front then 5,6,1 back
  const zoneLabels = ['1', '2', '3', '4', '5', '6'];
  const setterFront = rot >= 1 && rot <= 3;
  // What each zone's man plays — his slot's position — the libero in for the middle in the back row.
  const slots = lineupSlotPositions(formationOf(tactics));
  const zoneRoles = Array.from({ length: 6 }, (_, z) => {
    const role = slots[(z - rot + 6) % 6];
    const back = z === 0 || z >= 4;
    return back && role === Position.MiddleBlocker && (selection.libero ?? -1) >= 0 ? Position.Libero : role;
  });

  return (
    <div className="tactical-rotations">
      <WorkspaceHeading
        eyebrow="ROTATION WORKSHOP"
        title="A plan for every turn."
        description="Set the attack, reception and defence for each rotation."
        actions={<button onClick={() => g.go('lineup')}><Icon name="squad" size={15} /> Team sheet</button>}
      />
      <details className="tactical-rotation-help">
        <summary>Understanding the rotations</summary>
        <p>
          {g.nationalView() && <b className="nat-only">National team only — your club keeps its own. </b>}
          Rotations are named for the zone the setter stands in. When the setter is front row only two
          attackers are available — those rotations score less and need different instructions.
        </p>
      </details>

      <div className="rot-bar">
        <nav className="tactical-rotation-picker" aria-label="Rotations">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <button key={i} className={rot === i ? 'on' : ''} aria-pressed={rot === i} onClick={() => setRot(i)}>
              <b>P{i + 1}</b>
              <span>{i >= 1 && i <= 3 ? 'Setter front' : 'Setter back'}</span>
            </button>
          ))}
        </nav>
        <span className={`rot-flag${setterFront ? ' warn' : ''}`}>
          {setterFront ? 'Setter front row · two attackers' : 'Setter back row · three attackers'}
        </span>
      </div>

      <div className="tactical-rotation-workspace">
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
            Libero replaces the middle blocker in the back row. The middle serves from zone 1, since a
            libero may not serve — and the moment the serve is lost the libero comes on for him.
          </p>
        </Card>

        <PlayCard rotation={r} cast={{ roles: zoneRoles }} rot={rot} onChange={() => g.touch()} />

        <Card title={`Instructions for P${rot + 1}`} icon="whistle">
          <ChoiceField
            label="Preferred attacker"
            value={r.preferredAttacker}
            onChange={(v) => { r.preferredAttacker = v; g.touch(); }}
            options={ATTACKER_OPTIONS}
          />
          <ChoiceField
            label="Serve receive"
            value={r.receivers ?? 3}
            onChange={(v) => { r.receivers = v === 3 ? undefined : v; g.touch(); }}
            options={RECEPTION_OPTIONS}
          />
          <p className="rot-receive">
            <span className="faint">Taking the serve:</span>{' '}
            {receiveLineOf(store, zones, selection.libero, r.receivers ?? 3).map((p) => store.shortName(p)).join(', ')}
          </p>
          <ChoiceField
            label="Serve target"
            value={r.serveTarget}
            onChange={(v) => { r.serveTarget = v; g.touch(); }}
            options={SERVE_TARGET_OPTIONS}
          />
          <ChoiceField
            label="Block on the quick"
            value={r.blockAssignment}
            onChange={(v) => { r.blockAssignment = v; g.touch(); }}
            options={BLOCK_OPTIONS}
          />
          <div className="rot-blockplan">
            <BlockPlanCard tactics={tactics} onChange={() => g.touch()} slim />
          </div>
          <ChoiceField
            label="Defensive shape"
            value={r.defensiveShape}
            onChange={(v) => { r.defensiveShape = v; g.touch(); }}
            options={SHAPE_OPTIONS}
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
    </div>
  );
}

/**
 * The combination a rotation runs, picked off the coach's clipboard: each play drawn for this rotation's
 * men — the setter, the middle as the decoy, the hitter — and, for the pipe, which of its three balls.
 */
export function PlayCard({ rotation, cast, rot, onChange }: {
  rotation: RotationTactics; cast: PlayCast; rot: number; onChange: () => void;
}): JSX.Element {
  const play = rotation.play ?? 'auto';
  const pipe = rotation.pipeBall ?? 'middle';
  const why = playUnavailable(play, cast);
  const pick = (p: RotationPlay): void => {
    rotation.play = p === 'auto' ? undefined : p;
    onChange();
  };
  return (
    <Card title={`Combination play — P${rot + 1}`} icon="tactics" className="rot-plays">
      <div className="play-picks" role="radiogroup" aria-label="Combination play">
        {ROTATION_PLAYS.map((p) => {
          const off = playUnavailable(p, cast);
          return (
            <button key={p} role="radio" aria-checked={p === play} className={`play-pick${p === play ? ' on' : ''}${off !== null ? ' off' : ''}`}
              title={off ?? playDescription(p, pipe)} onClick={() => pick(p)}>
              <PlayDiagram play={p} pipe={pipe} cast={cast} small />
              <span>{ROTATION_PLAY_NAMES[p]}</span>
            </button>
          );
        })}
      </div>
      <div className="play-main">
        <PlayDiagram play={play} pipe={pipe} cast={cast} />
        <div className="play-about">
          <b>{ROTATION_PLAY_NAMES[play]}</b>
          <p>{playDescription(play, pipe)}</p>
          {play === 'pipe' && (
            <div className="play-run">
              <span className="faint">The pipe ball</span>
              <Segmented<PipeBall> size="sm" value={pipe}
                options={(['left', 'middle', 'back'] as const).map((b) => [b, PIPE_BALL_NAMES[b]] as const)}
                onChange={(b) => { rotation.pipeBall = b === 'middle' ? undefined : b; onChange(); }} />
            </div>
          )}
          {why !== null && (
            <p className="play-warn"><Icon name="alert" size={13} /> <span>{why}</span> <span>{`Not run in P${rot + 1}: the setter's choice instead.`}</span></p>
          )}
          {play !== 'auto' && why === null && (
            <p className="faint play-note">Run off a good pass, a little more often than the side's other combinations — even with them off.</p>
          )}
        </div>
      </div>
      <div className="play-key faint">
        <span><i className="pd-key setter" /> Setter</span>
        <span><i className="pd-key decoy" /> Middle, the decoy</span>
        <span><i className="pd-key hitter" /> Hitter</span>
      </div>
    </Card>
  );
}


const RING_COLOURS = ['#f5c542', '#6aa8d8', '#9aa9bb', '#58b98a', '#c38be0', '#e08a5a'];

/** The season's books as three bars: income, expenditure, and what is left. */
function BooksChart({ income, costs, result }: { income: number; costs: number; result: number }): JSX.Element {
  const top = Math.max(income, costs, result, 1) * 1.2;
  const bottom = Math.min(0, result) * 1.3;
  const y = (v: number): number => 210 - ((v - bottom) / (top - bottom)) * 180;
  const zero = y(0);
  const bars = [
    { label: 'Season income', value: income, color: '#f5c542' },
    { label: 'Season expenditure', value: costs, color: '#6298c1' },
    { label: 'Result so far', value: result, color: result >= 0 ? 'var(--good)' : 'var(--bad)' },
  ];
  return (
    <div className="finance-books-chart">
      <svg viewBox="0 0 800 255" role="img" aria-label="Season income, expenditure and result">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = bottom + f * (top - bottom);
          return (
            <g key={f}>
              <line x1="75" x2="770" y1={y(v)} y2={y(v)} stroke="#294159" strokeDasharray="3 4" />
              <text x="61" y={y(v) + 4} textAnchor="end" className="finance-axis">{moneyShort(v)}</text>
            </g>
          );
        })}
        <line x1="75" x2="770" y1={zero} y2={zero} stroke="#71869c" />
        {bars.map((b, i) => {
          const top = y(b.value);
          const x = 135 + i * 225;
          return (
            <g key={b.label}>
              <rect x={x} y={Math.min(top, zero)} width="132" height={Math.max(1, Math.abs(top - zero))} rx="3" fill={b.color} opacity=".9">
                <title>{b.label}: {money(b.value)}</title>
              </rect>
              <text x={x + 66} y={b.value >= 0 ? Math.max(16, top - 9) : top + 21} textAnchor="middle" className="finance-bar-value">{moneyShort(b.value)}</text>
              <text x={x + 66} y="245" textAnchor="middle" className="finance-bar-label">{b.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The balance at each monthly statement, as a line. */
function BalanceChart({ points }: { points: Array<{ label: string; value: number }> }): JSX.Element {
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 1);
  const min = lo - pad;
  const max = hi + pad;
  const x = (i: number): number => (points.length === 1 ? 420 : 85 + (i / (points.length - 1)) * 660);
  const y = (v: number): number => 205 - ((v - min) / (max - min)) * 170;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  return (
    <svg viewBox="0 0 800 255" role="img" aria-label="Recorded monthly balance history" className="finance-balance-chart">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1="80" x2="760" y1={205 - f * 170} y2={205 - f * 170} stroke="#294159" />
          <text x="65" y={209 - f * 170} className="finance-axis" textAnchor="end">{moneyShort(min + f * (max - min))}</text>
        </g>
      ))}
      {points.length > 1 && (
        <>
          <path d={`${path} L${x(points.length - 1)},205 L${x(0)},205 Z`} fill="#f5c5420d" />
          <path d={path} stroke="#f5c542" strokeWidth="3" fill="none" />
        </>
      )}
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle cx={x(i)} cy={y(p.value)} r="5" fill="#f5c542"><title>{p.label}: {money(p.value)}</title></circle>
          <text x={x(i)} y="237" className="finance-axis" textAnchor="middle">{p.label.slice(0, 3)}</text>
        </g>
      ))}
    </svg>
  );
}

/** Where the money comes from, as a ring. */
function IncomeRing({ lines, total }: { lines: Array<[string, number]>; total: number }): JSX.Element {
  let at = 0;
  const stops = lines.map(([, v], i) => {
    const from = at;
    at += total > 0 ? (v / total) * 100 : 0;
    return `${RING_COLOURS[i % RING_COLOURS.length]} ${from}% ${at}%`;
  });
  return (
    <div className="finance-ring" role="img" aria-label="Income distribution"
      style={{ '--ring': stops.length > 0 ? `conic-gradient(${stops.join(',')})` : 'var(--surface-3)' } as CSSProperties}>
      <div><strong>{moneyShort(total)}</strong><span>Season income</span></div>
    </div>
  );
}

export function FinancesScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const f = club.finances;
  // Senior-squad wages only — what a transfer negotiation checks: room left to sign someone.
  const wages = g.wageBill();
  // The season's books exactly as the rollover settles them: a true preview of the result if it ended today.
  const books = clubBooks(world, club);
  const result = books.totalIncome - books.totalCosts;
  const envelope = f.wageBudget + f.transferBudget;
  const wageUse = f.wageBudget > 0 ? (wages / f.wageBudget) * 100 : wages > 0 ? 100 : 0;
  const statements = world.messages
    .filter((m) => m.statement !== undefined && (m.clubId === undefined || m.clubId === club.id))
    .sort((a, b) => a.day - b.day)
    .slice(-8)
    .map((m) => m.statement!);
  const [chart, setChart] = useState<'books' | 'history'>(statements.length > 1 ? 'history' : 'books');
  const store = world.players;
  const topWages = [...club.players].sort((a, b) => store.wage[b] - store.wage[a]).slice(0, 4);
  const expiring = club.players.filter((p) => contractEndSeason(store.contractUntil[p]) <= world.season);
  const income = books.income.filter(([, v]) => v > 0);
  const costs = books.costs.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="finance-workspace">
      <WorkspaceHeading
        eyebrow="The business behind the club"
        title="Build a future worth playing for."
        description={`${world.year}/${String(world.year + 1).slice(-2)} · ${club.name}`}
        actions={(
          <>
            <StatusPill tone={f.balance < 0 ? 'bad' : 'good'}>{f.balance < 0 ? 'Negative balance' : 'Positive balance'}</StatusPill>
            <button onClick={() => g.go('commercial')}>Tickets & Sponsors <Icon name="arrowRight" size={14} /></button>
          </>
        )}
      />
      {f.seasonsInDebt > 0 && (
        <div className="alert alert-bad">
          <Icon name="alert" size={18} />
          <span>{f.seasonsInDebt} consecutive season(s) in the red — three means dissolution.</span>
        </div>
      )}
      <section className="finance-headlines" aria-label="Financial overview">
        <Metric label="Club balance" value={moneyShort(f.balance)} detail={club.arenaName} tone={f.balance < 0 ? 'bad' : 'neutral'} />
        <Metric label="Transfer budget" value={moneyShort(f.transferBudget)} detail="Available for player transfers" />
        <Metric label="Annual wage budget" value={moneyShort(f.wageBudget)} detail={<><span>{money(wages)}</span> <span>committed per season</span></>} />
        <Metric label="Projected result" value={`${result >= 0 ? '+' : ''}${moneyShort(result)}`} detail="if the season ended today" tone={result >= 0 ? 'good' : 'bad'} />
      </section>
      <div className="finance-layout">
        <div className="finance-analytics">
          <Panel
            className="finance-main-chart"
            title="The financial picture"
            eyebrow="Real books. Clear decisions."
            action={(
              <div className="seg">
                <button className={chart === 'books' ? 'on' : ''} onClick={() => setChart('books')}>Season overview</button>
                <button className={chart === 'history' ? 'on' : ''} onClick={() => setChart('history')}>Balance history</button>
              </div>
            )}
          >
            {chart === 'history'
              ? statements.length > 0
                ? <BalanceChart points={statements.map((s) => ({ label: s.month, value: s.balance }))} />
                : <EmptyState icon="stats" title="Your history starts here." description="Monthly financial statements will build the balance history as the season progresses."
                  action={<button onClick={() => g.go('inbox')}>Inbox <Icon name="arrowRight" size={14} /></button>} />
              : <BooksChart income={books.totalIncome} costs={books.totalCosts} result={result} />}
            <div className="finance-chart-caption">
              <span>{chart === 'history' ? 'Recorded monthly statements' : 'Sponsorship and TV rights are seasonal. Gate receipts and travel accrue match by match.'}</span>
              <span>{g.dateLabel()}</span>
            </div>
          </Panel>
          <div className="finance-distributions">
            <Panel title="Where income comes from" action={<strong>{moneyShort(books.totalIncome)}</strong>}>
              <div className="finance-income-body">
                <IncomeRing lines={income} total={books.totalIncome} />
                <div className="finance-legend">
                  {income.map(([k, v], i) => (
                    <div key={k}><i style={{ background: RING_COLOURS[i % RING_COLOURS.length] }} /><span>{k}</span><b>{moneyShort(v)}</b></div>
                  ))}
                </div>
              </div>
              <p className="finance-note"><span>Per match (full house)</span> <b>{money(f.ticketIncomePerMatch)}</b></p>
            </Panel>
            <Panel title="Where the money goes" action={<strong>{moneyShort(books.totalCosts)}</strong>}>
              <div className="finance-costs">
                {costs.map(([k, v]) => (
                  <div key={k} className="finance-cost">
                    <span>{k}</span>
                    <b>{moneyShort(v)}</b>
                    <div><i style={{ width: `${Math.min(100, (v / Math.max(1, costs[0]?.[1] ?? 1)) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
        <aside className="finance-control">
          <Panel title="Every euro has a purpose." eyebrow="Budgets and commitments">
            <div className="finance-wage-head">
              <span>Committed wages (senior squad)</span>
              <strong className={wageUse > 100 ? 'bad' : ''}>{Math.round(wageUse)}%</strong>
            </div>
            <Progress label="Annual wage budget used" value={wages} max={Math.max(f.wageBudget, wages)} tone={wages > f.wageBudget ? 'bad' : 'gold'} />
            <p className="finance-budget-caption"><b>{money(wages)}</b> / {money(f.wageBudget)} <span>per season</span></p>
            <div className="finance-remaining">
              <span>Remaining for signings</span>
              <strong className={f.wageBudget - wages < 0 ? 'bad' : 'good'}>{money(f.wageBudget - wages)}</strong>
            </div>
            <div className="finance-budget-slider">
              <div className="finance-split-heading">
                <strong>Budget split</strong>
                <span>Total available: {money(envelope)}</span>
              </div>
              <div className="finance-split-sides">
                <div className="finance-split-side transfers">
                  <span>Transfers</span>
                  <strong>{money(f.transferBudget)}</strong>
                  <small>{envelope > 0 ? Math.round((f.transferBudget / envelope) * 100) : 0} %</small>
                </div>
                <div className="finance-split-side wages">
                  <span>Wages</span>
                  <strong>{money(f.wageBudget)}</strong>
                  <small>{envelope > 0 ? Math.round((f.wageBudget / envelope) * 100) : 0} %</small>
                </div>
              </div>
              <input
                className="finance-split-range"
                type="range"
                min={0}
                max={Math.max(0, envelope)}
                step={1000}
                value={f.transferBudget}
                disabled={envelope <= 0}
                onChange={(e) => g.setTransferBudget(Number(e.currentTarget.value))}
                aria-label="Share the budget between transfers and wages"
                style={{ '--vm-split': `${envelope > 0 ? (f.transferBudget / envelope) * 100 : 0}%` } as CSSProperties}
              />
              <p className="finance-split-hint">Move the bar to share the money between transfers and wages. The club's total does not change.</p>
            </div>
            <div className="finance-budget-controls">
              <label><span>Wage budget</span><MoneyInput value={f.wageBudget} onChange={(v) => g.setWageBudget(v)} /></label>
              <label><span>Transfer budget</span><MoneyInput value={f.transferBudget} onChange={(v) => g.setTransferBudget(v)} /></label>
            </div>
          </Panel>
          <Panel title="Key contracts" action={<button className="vm-text-action" onClick={() => g.go('squad')}>Squad <Icon name="arrowRight" size={13} /></button>}>
            <div className="finance-contracts">
              {topWages.map((p) => (
                <button key={p} className="finance-contract" onClick={() => g.select(p)}>
                  <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={36} />
                  <span>
                    <b translate="no">{store.fullName(p)}</b>
                    <small>{money(store.wage[p])} <span>per season</span></small>
                  </span>
                  <strong className={contractEndSeason(store.contractUntil[p]) <= world.season ? 'warn' : ''}>
                    {world.startYear + contractEndSeason(store.contractUntil[p]) + 1}
                  </strong>
                </button>
              ))}
            </div>
            {expiring.length > 0 && (
              <button className="finance-renewal" onClick={() => g.select(expiring[0])}>
                <Icon name="contract" size={17} />
                <span>
                  <b>{expiring.length} <span>contracts expire this season</span></b>
                  <small>Review your renewal priorities</small>
                </span>
                <Icon name="chevronRight" size={14} />
              </button>
            )}
          </Panel>
        </aside>
      </div>
    </div>
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

  // The whole world searched: again when the filters or the game change, not each time a row is picked.
  const version = g.getSnapshot();
  const pool = useMemo(() => g.scoutingPool(filters), [filters, version]);
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
  // Drawn a page at a time — always as far down as the player picked.
  // As many rows as the panel holds, a page at a time — no scrolling.
  const listRef = useRef<HTMLDivElement>(null);
  const fit = useFitList(listRef, targets.length, { min: 28, max: 36 });
  const listKey = `${JSON.stringify(filters)}/${JSON.stringify(sort)}`;
  useEffect(() => { fit.setPage(0); }, [listKey]);
  const shown = targets.slice(fit.from, fit.to);
  const matchesWatched = target !== null ? totalMatchesWatched(world, target) : 0;
  const report = target !== null && matchesWatched > 0
    ? buildScoutReport(world, world.userClubId, target, { matchesWatched })
    : null;

  const pending = target !== null
    ? world.scoutingQueue.find((t) => t.playerIdx === target)
    : undefined;

  return (
    <div className="recruitment-workspace">
      <div className="recruitment-toolbar">
        <div>
          <strong>{targets.length}</strong> <span>players found</span>
          <span className="recruitment-divider" />
          <b>{world.scoutingQueue.length}</b> <span>reports in progress</span>
        </div>
        <div>
          <button onClick={() => g.go('shortlist')}>Shortlist <Icon name="arrowRight" size={13} /></button>
          <button onClick={() => g.go('missions')}>Scout Missions <Icon name="arrowRight" size={13} /></button>
        </div>
      </div>
      <details className="recruitment-explainer">
        <summary>How scouting knowledge works</summary>
        <p className="page-intro">
          Reports show ranges, not numbers, and stay blank until your scouts have actually seen the
          player. Send a scout to watch more matches to narrow the estimate — potential is always harder
          to judge than current ability.
        </p>
      </details>

      <Card
        title="Search Filters"
        className="recruitment-filters"
        icon="search"
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
            <Dropdown
              value={filters.potentialMin}
              onChange={(v) => setFilter('potentialMin', v)}
              options={POTENTIAL_BANDS.map(([v, l]) => ({ value: v, label: l }))}
            />
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
          actions={<span className="faint"><ListPager page={fit.page} pages={fit.pages} setPage={fit.setPage} /> {targets.length} found</span>}
        >
          <div className="table-wrap scout-table" ref={listRef}>
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
                {shown.map((p) => {
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
                  <button
                    className="primary"
                    title={g.joinDay(target) > world.day
                      ? `The window is shut — agree a deal now and he joins on ${g.dateLabelForDay(g.joinDay(target))}`
                      : undefined}
                    onClick={() => g.startNegotiation(target)}
                  >
                    <Icon name="transfers" size={14} />
                    {g.talksWith(target, 'transfer') !== null ? 'View talks' : 'Negotiate transfer'}
                  </button>
                  {store.clubId[target] >= 0 && (
                    <button
                      disabled={!g.canBorrow(target) && g.talksWith(target, 'loan') === null}
                      title={!g.canBorrow(target) ? 'Not available for loan right now'
                        : g.joinDay(target) > world.day
                          ? `The window is shut — a loan agreed now starts on ${g.dateLabelForDay(g.joinDay(target))}`
                          : 'Borrow him until the end of the season'}
                      onClick={() => g.startLoanRequest(target)}
                    >
                      <Icon name="swap" size={14} />
                      {g.talksWith(target, 'loan') !== null ? 'Loan talks' : 'Request loan'}
                    </button>
                  )}
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
    </div>
  );
}

type TransferSort = 'name' | 'pos' | 'age' | 'height' | 'ability' | 'value' | 'wage';

export function TransfersScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const targets = g.transferTargets(100);
  const wageRoom = g.wageRoom();
  const squadSize = g.squadSize();
  const offers = world.incomingOffers;
  const [sort, onSort] = useSort<TransferSort>('ability');
  const txWindow = g.transferWindowStatus();

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
        <StatTile label="Squad" value={`${squadSize}/${MAX_SQUAD}`} tone={squadSize >= MAX_SQUAD ? 'warn' : undefined} sub={squadSize >= MAX_SQUAD ? 'full — release to sign' : 'places available'} />
        <StatTile label="Offers received" value={offers.length} tone={offers.length > 0 ? 'gold' : undefined} sub="awaiting a decision" />
        <StatTile
          label="Transfer window"
          value={txWindow.open ? (txWindow.untilDay === g.world!.day ? 'Deadline day' : 'Open') : 'Closed'}
          sub={txWindow.open
            ? txWindow.untilDay === g.world!.day ? `${txWindow.label} shuts tonight` : `${txWindow.label} · until ${g.dateLabelForDay(txWindow.untilDay)}`
            : `${txWindow.label} opens ${g.dateLabelForDay(txWindow.untilDay)}`}
          tone={txWindow.open ? 'good' : 'bad'}
        />
      </div>

      {world.talks.length > 0 && (
        <Card title="Negotiations" icon="transfers" flush style={{ marginBottom: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th><th>Pos</th><th>Talks</th><th>Status</th><th>Rivals</th><th />
              </tr>
            </thead>
            <tbody>
              {world.talks.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => g.openTalksView(t.id)}>
                  <td className="strong">{store.fullName(t.playerIdx)}</td>
                  <td><Pos pos={store.position[t.playerIdx] as Position} /></td>
                  <td className="dim">
                    {t.kind === 'renewal'
                      ? 'Contract renewal'
                      : t.stage === 'fee'
                        ? <>Fee with <ClubLink id={t.sellingClubId} short /></>
                        : t.sellingClubId >= 0 ? 'Personal terms' : 'Free agent terms'}
                  </td>
                  <td>
                    {t.pending !== null
                      ? <span className="warn-text">Reply due {g.dateLabelForDay(t.pending.resolvesOn)}</span>
                      : <span className="good">Your move</span>}
                  </td>
                  <td className="dim">{t.rivals.length > 0 ? t.rivals.length : '—'}</td>
                  <td className="num"><button className="sm primary">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {offers.length > 0 && (
        <Card title="Offers Received" icon="offer" flush style={{ marginBottom: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th><th>Pos</th><th>Bidding club</th>
                <th className="num">Offer</th><th className="num">Value</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const status = o.status ?? 'open';
                return (
                  <tr key={o.id}>
                    <td className="strong">{store.fullName(o.playerIdx)}</td>
                    <td><Pos pos={store.position[o.playerIdx] as Position} /></td>
                    <td><ClubLink id={o.buyingClubId} /></td>
                    <td className="num gold-text">
                      {o.loan !== undefined ? `Loan · ${Math.round(o.loan.wageShare * 100)}% wage` : money(o.fee)}
                    </td>
                    <td className="num dim">{money(store.value[o.playerIdx])}</td>
                    <td className="dim">
                      {status === 'open' && <>Expires {g.dateLabelForDay(o.expiresOnDay)}</>}
                      {status === 'countered' && <span className="warn-text">Answer due {g.dateLabelForDay(o.resolvesOn ?? world.day)}</span>}
                      {status === 'accepted' && <span className="warn-text">Player decides by {g.dateLabelForDay(o.resolvesOn ?? world.day)}</span>}
                    </td>
                    <td className="num"><button className="sm primary" onClick={() => g.openOffer(o.id)}>Review</button></td>
                  </tr>
                );
              })}
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
                          <button
                            className="sm primary"
                            onClick={(e) => { e.stopPropagation(); g.startNegotiation(p); }}
                          >
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
