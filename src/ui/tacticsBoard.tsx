/**
 * The team instructions, the way a coach thinks of them: with the ball and
 * without it.
 *
 * In possession, the setter's options depend on where the pass comes down —
 * within 3 m of the net (zone A), 3 to 6 m (B) or 6 to 9 m (C) — and the coach
 * plans each zone: what the middle may hit, how the ball goes to the pins,
 * whether combinations are run, who attacks from the back row and who the
 * setter looks for first. Pick a zone on the court and its plan is laid out
 * as cards; the whole team's instructions — the system, the offence, the
 * tempo, how often combinations are run — sit beside them. Out of
 * possession, the defence and the serve. Every instruction is a card with a
 * picture of what it does and its current setting; pick one and its options
 * open underneath. The overview down the side has everything at a glance.
 */

import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  BackRowOption, Combinations, combinationsOf, defaultZonePlans, DEFENSE_PROFILE, DefensiveSystem, Formation, formationOf,
  MiddleOption, middleOptionFor, OFFENSE_LANE_WEIGHTS, OffensiveSystem, PASS_ZONE_NAMES, PASS_ZONES, PinSet, SERVE_PROFILE,
  ServeStrategy, setterAtNet, Tempo, ZoneTarget, zonePlansOf, type PassZone, type TeamTactics, type ZonePlan,
} from '../engine/match/tactics.ts';
import {
  ATTACK_SOURCE_NAMES, ATTACK_SOURCES, COVER_SHOTS, coverage, coverageScore, DEFENCE_PRESET_NAMES, defenceLayoutsOf, hitterAcross,
  presetLayout, shotSpot, type AttackSource, type DefenceLayout, type DefenceLayouts, type DefencePreset, type Spot,
} from '../engine/match/defence.ts';
import type { Shot } from '../engine/match/engine.ts';
import { Icon } from './icons.tsx';
import {
  COMBINATION_OPTIONS, DEFENSE_OPTIONS, FORMATION_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS, TEMPO_OPTIONS,
} from './screens/Manage.tsx';

export const MIDDLE_ZONE_OPTIONS: Array<[MiddleOption, string]> = [
  [MiddleOption.Any, 'Any'],
  [MiddleOption.Quick, 'Quick (tensa)'],
  [MiddleOption.BackQuick, 'Back quick'],
  [MiddleOption.Slide, 'Slide (china)'],
  [MiddleOption.None, 'No middle'],
];

/** With the setter in the back row the right side is taken: no slide. */
export const MIDDLE_BACK_OPTIONS: Array<[MiddleOption, string]> = MIDDLE_ZONE_OPTIONS.filter(([v]) => v !== MiddleOption.Slide);

export const PIN_OPTIONS: Array<[PinSet, string]> = [
  [PinSet.Mixed, 'Mixed'],
  [PinSet.High, 'High ball'],
  [PinSet.Fast, 'Fast and flat'],
];

export const BACK_ROW_OPTIONS: Array<[BackRowOption, string]> = [
  [BackRowOption.Both, 'From 6 and 1'],
  [BackRowOption.Pipe, 'Pipe from 6'],
  [BackRowOption.ZoneOne, 'From 1'],
  [BackRowOption.None, 'None'],
];

export const TARGET_OPTIONS: Array<[ZoneTarget, string]> = [
  [ZoneTarget.Auto, 'Setter decides'],
  [ZoneTarget.Outside, 'Outside'],
  [ZoneTarget.Opposite, 'Opposite'],
  [ZoneTarget.Middle, 'Middle'],
  [ZoneTarget.BackRow, 'Back row'],
];

const COMBO_ZONE_OPTIONS: Array<[number, string]> = [[1, 'Allowed'], [0, 'Not here']];

/** What each option does, under the cards when one is picked. */
const HINTS: Readonly<Record<string, string>> = {
  formation: '5-1: one setter runs the offence. 4-2: two setters diagonal; the one in the back row sets.',
  offense: 'How the setter shares the ball out across the attack lanes.',
  tempo: 'Faster tempo beats the block but asks more of the pass and the setter.',
  combos: 'How often a pin attack off a good pass is run as a combination off the middle — X, tandem, shoot, pipe. Rehearse them in training.',
  middle: 'With the setter at the net — P2, P3, P4 — the right side is free: the quick in front (tensa), the back quick (costas) or the slide behind him (china). Any: the setter mixes them.',
  middleBack: 'With the setter in the back row — P1, P6, P5 — the opposite is up at the net on the right, so there is no slide: the quick in front or the back quick.',
  pins: 'A high ball gives the hitter time and the block time too; a fast, flat set beats the block but is harder to hit.',
  zoneCombos: 'Whether combinations may be run off a pass coming down in this zone.',
  backRow: 'Back-row attacks: the pipe from zone 6, a ball to the opposite in zone 1, or both.',
  target: 'Who the setter looks for first off a pass in this zone.',
  defense: 'How the side defends: block pressure against floor coverage.',
  serve: 'Risky serving buys aces and pays for them in errors.',
};

/** One instruction as a card: what it is, a picture of the setting, and the setting. */
function InstrCard({ title, value, visual, active, onClick }: {
  title: string;
  value: string;
  visual: ReactNode;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={`icard${active ? ' active' : ''}`} onClick={onClick}>
      <span className="icard-title">{title}</span>
      <svg className="icard-visual" viewBox="0 0 80 46" aria-hidden="true">{visual}</svg>
      <span className="icard-value">{value}</span>
    </button>
  );
}

// ---- The cards' pictures ---------------------------------------------------------------

/** The pictures' colours: the lit parts take the club's colour from the card (currentColor). */
const C = { line: 'rgba(255,255,255,0.28)', dim: 'rgba(255,255,255,0.14)', lit: 'currentColor', gold: '#d7a73f' };

/** A strip of net along the top. */
function Net(): JSX.Element {
  return <line x1="6" y1="7" x2="74" y2="7" stroke={C.line} strokeWidth="2" />;
}

function formationVisual(f: Formation): JSX.Element {
  // Six players, the setters lit.
  const spots = [[20, 18], [40, 18], [60, 18], [20, 36], [40, 36], [60, 36]];
  const setters = f === Formation.FourTwo ? [2, 3] : [5];
  return <>{spots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill={setters.includes(i) ? C.gold : C.dim} />)}</>;
}

function offenseVisual(o: OffensiveSystem): JSX.Element {
  const w = OFFENSE_LANE_WEIGHTS[o];
  const max = Math.max(...w);
  return (
    <>
      {w.map((v, i) => {
        const h = (v / max) * 34;
        return <rect key={i} x={8 + i * 11.5} y={42 - h} width="8" height={h} rx="1.5" fill={v === max ? C.lit : C.line} />;
      })}
    </>
  );
}

function tempoVisual(t: Tempo): JSX.Element {
  // A gauge: slow on the left, very fast on the right.
  const k = [1, 0.7, 0.45, 0.15][t];
  const a = Math.PI * (1 - k);
  return (
    <>
      <path d="M 14 40 A 26 26 0 0 1 66 40" fill="none" stroke={C.dim} strokeWidth="5" />
      <path d={`M 14 40 A 26 26 0 0 1 ${40 + 26 * Math.cos(a)} ${40 - 26 * Math.sin(a)}`} fill="none" stroke={C.lit} strokeWidth="5" />
      <line x1="40" y1="40" x2={40 + 18 * Math.cos(a)} y2={40 - 18 * Math.sin(a)} stroke="#fff" strokeWidth="2" />
    </>
  );
}

function combosVisual(on: boolean, level = 2): JSX.Element {
  const col = on ? C.lit : C.dim;
  return (
    <>
      <Net />
      <path d="M 18 40 Q 30 22 52 12" fill="none" stroke={col} strokeWidth="2.5" />
      <path d="M 58 40 Q 46 22 28 12" fill="none" stroke={col} strokeWidth="2.5" strokeDasharray={on ? '' : '3 3'} />
      {[0, 1, 2].map((i) => <circle key={i} cx={30 + i * 10} cy="43" r="2" fill={i < level ? C.gold : C.dim} />)}
    </>
  );
}

function middleVisual(m: MiddleOption, front: boolean): JSX.Element {
  // Along the net, left to right: the setter's spot, and where the middle hits;
  // the setter's rotations along the bottom.
  const setter = 51;
  const spots = m === MiddleOption.Quick ? [42] : m === MiddleOption.BackQuick ? [61] : m === MiddleOption.Slide ? [72]
    : m === MiddleOption.Any ? [42, 61, 72] : [];
  return (
    <>
      <Net />
      <circle cx={setter} cy="16" r="4" fill={C.gold} />
      {spots.map((x) => <circle key={x} cx={x} cy="14" r="4.5" fill={C.lit} opacity={m === MiddleOption.Any ? 0.75 : 1} />)}
      {m === MiddleOption.Slide && <path d="M 40 32 Q 58 26 70 18" fill="none" stroke={C.lit} strokeWidth="2" strokeDasharray="3 2" />}
      {m === MiddleOption.None && <path d="M 30 18 L 50 38 M 50 18 L 30 38" stroke="#e5484d" strokeWidth="3" />}
      {m !== MiddleOption.None && m !== MiddleOption.Slide && <line x1="42" y1="34" x2="42" y2="22" stroke={C.line} strokeWidth="2" />}
      {!front && <path d="M 51 40 L 51 22" stroke={C.gold} strokeWidth="1.5" strokeDasharray="2 2" />}
      <text x="6" y="45" fontSize="7.5" fontWeight="700" fill={C.line}>{front ? 'P2 · P3 · P4' : 'P1 · P6 · P5'}</text>
    </>
  );
}

function pinsVisual(p: PinSet): JSX.Element {
  return (
    <>
      <Net />
      <circle cx="54" cy="16" r="4" fill={C.gold} />
      {(p === PinSet.High || p === PinSet.Mixed) && (
        <path d="M 54 16 Q 32 -14 10 16" fill="none" stroke={C.lit} strokeWidth="2.5" opacity={p === PinSet.Mixed ? 0.7 : 1} />
      )}
      {(p === PinSet.Fast || p === PinSet.Mixed) && (
        <path d="M 54 16 Q 32 8 10 16" fill="none" stroke={C.lit} strokeWidth="2.5" strokeDasharray={p === PinSet.Mixed ? '4 3' : ''} />
      )}
      <circle cx="10" cy="17" r="4.5" fill="#fff" />
    </>
  );
}

function backRowVisual(b: BackRowOption): JSX.Element {
  const six = b === BackRowOption.Both || b === BackRowOption.Pipe;
  const one = b === BackRowOption.Both || b === BackRowOption.ZoneOne;
  return (
    <>
      <rect x="10" y="4" width="60" height="38" rx="2" fill="none" stroke={C.line} />
      <line x1="10" y1="17" x2="70" y2="17" stroke={C.dim} strokeDasharray="3 2" />
      <circle cx="40" cy="31" r="6" fill={six ? C.lit : C.dim} />
      <circle cx="61" cy="31" r="6" fill={one ? C.lit : C.dim} />
      <text x="40" y="34" textAnchor="middle" fontSize="8" fontWeight="800" fill="#0b1018">6</text>
      <text x="61" y="34" textAnchor="middle" fontSize="8" fontWeight="800" fill="#0b1018">1</text>
    </>
  );
}

function targetVisual(t: ZoneTarget): JSX.Element {
  const label = ['AUTO', 'OH', 'OPP', 'MB', 'BACK'][t];
  return (
    <>
      <circle cx="40" cy="23" r="19" fill="none" stroke={C.dim} strokeWidth="3" />
      <circle cx="40" cy="23" r="11" fill="none" stroke={t === ZoneTarget.Auto ? C.dim : C.lit} strokeWidth="3" />
      <text x="40" y="27" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{label}</text>
    </>
  );
}

function defenseVisual(d: DefensiveSystem): JSX.Element {
  const p = DEFENSE_PROFILE[d];
  const bar = (x: number, v: number, label: string): JSX.Element => (
    <>
      <rect x={x} y={40 - (v - 0.7) * 50} width="16" height={(v - 0.7) * 50} rx="2" fill={C.lit} />
      <text x={x + 8} y="45.5" textAnchor="middle" fontSize="6" fill={C.line}>{label}</text>
    </>
  );
  return <>{bar(14, p.blockPressure, 'BLK')}{bar(32, p.digCoverage, 'FLR')}{bar(50, p.servePressure, 'SRV')}</>;
}

function serveVisual(s: ServeStrategy): JSX.Element {
  const p = SERVE_PROFILE[s];
  return (
    <>
      <path d="M 10 38 Q 40 -6 72 30" fill="none" stroke={C.dim} strokeWidth="2" />
      <rect x="14" y={40 - (p.power - 0.7) * 60} width="16" height={(p.power - 0.7) * 60} rx="2" fill="#e5484d" />
      <rect x="50" y={40 - (p.accuracy - 0.7) * 60} width="16" height={(p.accuracy - 0.7) * 60} rx="2" fill={C.lit} />
    </>
  );
}

// ---- The board -------------------------------------------------------------------------

type CardKey =
  | 'formation' | 'offense' | 'tempo' | 'combos' | 'middle' | 'middleBack' | 'pins' | 'zoneCombos' | 'backRow' | 'target'
  | 'defense' | 'serve';

const label = <T extends number>(options: Array<[T, string]>, v: T): string => options.find(([o]) => o === v)?.[1] ?? '';

/** The half court with its three pass zones, each with its plan in brief — pick one to plan it. */
function ZoneCourt({ plans, zone, onZone }: { plans: Record<PassZone, ZonePlan>; zone: PassZone; onZone: (z: PassZone) => void }): JSX.Element {
  return (
    <div className="zcourt">
      <div className="zcourt-net"><span>Net</span></div>
      {PASS_ZONES.map((z) => {
        const p = plans[z];
        return (
          <button key={z} className={`zcourt-band${z === zone ? ' active' : ''}`} onClick={() => onZone(z)}>
            <span className="zcourt-zone">{z}</span>
            <span className="zcourt-depth">{PASS_ZONE_NAMES[z]}</span>
            <span className="zcourt-sum">
              <i className={p.middle === MiddleOption.None ? 'off' : ''}>
                MB {label(MIDDLE_ZONE_OPTIONS, p.middle).split(' ')[0]}
                {middleOptionFor(p, false) !== p.middle && ` / ${label(MIDDLE_ZONE_OPTIONS, middleOptionFor(p, false)).split(' ')[0]}`}
              </i>
              <i>Pins {label(PIN_OPTIONS, p.pins).split(' ')[0]}</i>
              <i className={p.combos ? '' : 'off'}>Combos</i>
              <i className={p.backRow === BackRowOption.None ? 'off' : ''}>
                Back {p.backRow === BackRowOption.Both ? '6+1' : p.backRow === BackRowOption.Pipe ? '6' : p.backRow === BackRowOption.ZoneOne ? '1' : '–'}
              </i>
            </span>
          </button>
        );
      })}
      <div className="zrot">
        <span className="zrot-label">Setter's rotations</span>
        <span className="zrot-chips">
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <i key={r} className={setterAtNet(r) ? 'front' : ''} title={setterAtNet(r) ? 'Setter at the net' : 'Setter in the back row'}>P{r + 1}</i>
          ))}
        </span>
        <span className="zrot-note">At the net in P2–P4: the slide is on. In P1, P6 and P5 it is not.</span>
      </div>
      <p className="zcourt-note">Where the pass or dig comes down decides what the setter can run.</p>
    </div>
  );
}

/** The shots on the editor, in a letter or two. */
const SHOT_MARKS: Partial<Record<Shot, [string, string]>> = {
  cross: ['X', 'Cross-court'], line: ['L', 'Down the line'], shortLine: ['SL', 'Short line'], cut: ['C', 'Cut shot'],
  tip: ['T', 'Tip'], roll: ['R', 'Roll shot'], seam: ['S', 'Seam'], deep: ['D', 'Deep'], quick: ['Q', 'Quick'],
};

/** The front-row player who doesn't block against each kind of attack, by his zone. */
const FREE_ZONE: Readonly<Record<AttackSource, string>> = { oh: '4', mb: '4', opp: '2' };

/** The standard layout a side's layout is, if it is one. */
function presetOf(layout: DefenceLayout, source: AttackSource): DefencePreset | null {
  const same = (a: Spot, b: Spot): boolean => Math.abs(a.u - b.u) < 0.005 && Math.abs(a.v - b.v) < 0.005;
  for (const p of ['perimeter', 'rotation', 'manUp'] as const) {
    const q = presetLayout(p, source);
    if (same(layout.lb, q.lb) && same(layout.mb, q.mb) && same(layout.rb, q.rb) && same(layout.free, q.free)) return p;
  }
  return null;
}

const SHORT_PRESET: Readonly<Record<string, string>> = { Perimeter: 'Perim.', Rotation: 'Rot.', 'Man-up': 'Man-up', Custom: 'Custom' };

/** A layout's name: the standard one it is, or custom. */
export function defenceName(layout: DefenceLayout, source: AttackSource): string {
  const p = presetOf(layout, source);
  return p !== null ? DEFENCE_PRESET_NAMES[p] : 'Custom';
}

/**
 * Where the defence stands against each kind of attack — the outside, the
 * middle, the opposite: the back three and the front-row player who doesn't
 * block, each dragged where the coach wants him, or a standard layout. The
 * shots from that side are marked where they come down, green where someone
 * covers them, red where the court is open.
 */
function DefenceEditor({ tactics: t, onChange }: { tactics: TeamTactics; onChange: () => void }): JSX.Element {
  const [source, setSource] = useState<AttackSource>('oh');
  const [drag, setDrag] = useState<keyof DefenceLayout | null>(null);
  const [, redraw] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const layouts = defenceLayoutsOf(t);
  const layout = layouts[source];
  const hu = hitterAcross(source);
  const cover = coverage(layout, source);
  const score = coverageScore(layout, source);
  /** The side's own layouts, made the first time one is changed. */
  const own = (): DefenceLayouts => {
    if (t.defence === undefined) {
      const c = (l: DefenceLayout): DefenceLayout => ({ lb: { ...l.lb }, mb: { ...l.mb }, rb: { ...l.rb }, free: { ...l.free } });
      t.defence = { oh: c(layouts.oh), mb: c(layouts.mb), opp: c(layouts.opp) };
    }
    return t.defence;
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const el = svg.current;
    if (drag === null || el === null) return;
    const ctm = el.getScreenCTM();
    if (ctm === null) return;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    own()[source][drag] = { u: Math.min(0.97, Math.max(0.03, p.x / 100)), v: Math.min(1, Math.max(0.04, p.y / 100)) };
    redraw((n) => n + 1);
  };
  const drop = (): void => {
    if (drag === null) return;
    setDrag(null);
    onChange();
  };
  const men: Array<[keyof DefenceLayout, string]> = [['lb', '5'], ['mb', '6'], ['rb', '1'], ['free', FREE_ZONE[source]]];
  const blockers = source === 'mb' ? [hu] : [hu - 0.07, hu + 0.07];
  const preset = presetOf(layout, source);

  return (
    <div className="zcourt dedit">
      <div className="dedit-head">
        <span className="zrot-label">Attack from</span>
        <span className="tboard-zones">
          {ATTACK_SOURCES.map((s) => (
            <button key={s} className={s === source ? 'active wide' : 'wide'} onClick={() => setSource(s)}>{ATTACK_SOURCE_NAMES[s]}</button>
          ))}
        </span>
      </div>
      <svg ref={svg} className="dedit-svg" viewBox="-4 -16 108 122" onPointerMove={move} onPointerUp={drop} onPointerLeave={drop}>
        <rect x="0" y="0" width="100" height="100" fill="#c76f36" />
        <line x1="0" y1="33.3" x2="100" y2="33.3" stroke="rgba(255,255,255,0.85)" strokeWidth="0.8" />
        <rect x="-3" y="-1.5" width="106" height="3" fill="rgba(255,255,255,0.92)" />
        {/* Their hitter across the net, and the block going up to him. */}
        <circle cx={hu * 100} cy="-8" r="4.5" fill="#e5484d" />
        <text x={hu * 100} y="-6.4" textAnchor="middle" fontSize="4.2" fontWeight="800" fill="#fff">
          {source === 'oh' ? 'OH' : source === 'mb' ? 'MB' : 'OP'}
        </text>
        {blockers.map((b) => <rect key={b} x={b * 100 - 4} y="1.5" width="8" height="4" rx="1" fill="rgba(255,255,255,0.75)" />)}
        {/* Where the shots come down: covered, partly, open. */}
        {COVER_SHOTS[source].map(([shot]) => {
          const at = shotSpot(shot, hu, 0, 0.5);
          const c = cover.get(shot) ?? 0;
          const mark = SHOT_MARKS[shot];
          return (
            <g key={shot}>
              <title>{`${mark?.[1] ?? shot}: ${c >= 0.55 ? 'covered' : c >= 0.25 ? 'partly covered' : 'open'}`}</title>
              <circle cx={at.u * 100} cy={at.v * 100} r="3.6" fill={c >= 0.55 ? '#3dbb5c' : c >= 0.25 ? '#e3a82b' : '#e5484d'} opacity="0.9" />
              <text x={at.u * 100} y={at.v * 100 + 1.4} textAnchor="middle" fontSize="3.4" fontWeight="800" fill="#0b1018">{mark?.[0] ?? '?'}</text>
            </g>
          );
        })}
        {/* Against the middle the other pin doesn't block either: he mirrors the 4. */}
        {source === 'mb' && (
          <g opacity="0.55">
            <circle cx={(1 - layout.free.u) * 100} cy={layout.free.v * 100} r="6" fill="#d7a73f" stroke="#fff" strokeWidth="0.8" />
            <text x={(1 - layout.free.u) * 100} y={layout.free.v * 100 + 2} textAnchor="middle" fontSize="5.5" fontWeight="800" fill="#0b1018">2</text>
          </g>
        )}
        {/* The defence: drag each one where he should stand. */}
        {men.map(([key, zone]) => {
          const at = layout[key];
          return (
            <g key={key} className={`dedit-man${drag === key ? ' dragging' : ''}`}
              onPointerDown={(e) => { (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId); setDrag(key); }}>
              <circle cx={at.u * 100} cy={at.v * 100} r="6" fill={key === 'free' ? '#d7a73f' : 'currentColor'} stroke="#fff" strokeWidth="0.8" />
              <text x={at.u * 100} y={at.v * 100 + 2} textAnchor="middle" fontSize="5.5" fontWeight="800" fill="#0b1018">{zone}</text>
            </g>
          );
        })}
      </svg>
      <div className="dedit-presets">
        {(['perimeter', 'rotation', 'manUp'] as const).map((p) => (
          <button key={p} className={`sm${preset === p ? ' active' : ''}`} onClick={() => { own()[source] = presetLayout(p, source); onChange(); }}>
            {DEFENCE_PRESET_NAMES[p]}
          </button>
        ))}
      </div>
      <p className="zcourt-note">
        Covers <b>{Math.round(score * 100)}%</b> of what comes from the {ATTACK_SOURCE_NAMES[source].toLowerCase()} —
        drag 5, 6, 1 and the {FREE_ZONE[source]} who doesn't block.
      </p>
    </div>
  );
}

/**
 * The whole board. `onFormation` changes the system (it may need more than a
 * flip of a field); every other change edits `tactics` and calls `onChange`.
 * `compact` drops the court and the overview, for the match's own panel.
 */
export function TacticsBoard({ tactics: t, onChange, onFormation, compact = false }: {
  tactics: TeamTactics;
  onChange: () => void;
  onFormation?: (f: Formation) => void;
  compact?: boolean;
}): JSX.Element {
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [zone, setZone] = useState<PassZone>('A');
  const [open, setOpen] = useState<CardKey | null>(null);
  const plans = zonePlansOf(t);
  const plan = plans[zone];
  /** A zone's plan changed: the side gets its own copy of the plans first. */
  const setPlan = (patch: Partial<ZonePlan>): void => {
    const own = t.zones ?? { ...defaultZonePlans(), ...plans };
    t.zones = { ...own, [zone]: { ...own[zone], ...patch } };
    onChange();
  };
  const combos = combinationsOf(t);

  const cards: Record<CardKey, { title: string; value: string; visual: JSX.Element; options: Array<[number, string]>; current: number; set: (v: number) => void }> = {
    formation: {
      title: 'System', value: label(FORMATION_OPTIONS, formationOf(t)), visual: formationVisual(formationOf(t)),
      options: FORMATION_OPTIONS, current: formationOf(t), set: (v) => onFormation?.(v as Formation),
    },
    offense: {
      title: 'Offence', value: label(OFFENSE_OPTIONS, t.offense), visual: offenseVisual(t.offense),
      options: OFFENSE_OPTIONS, current: t.offense, set: (v) => { t.offense = v; onChange(); },
    },
    tempo: {
      title: 'Tempo', value: label(TEMPO_OPTIONS, t.tempo), visual: tempoVisual(t.tempo),
      options: TEMPO_OPTIONS, current: t.tempo, set: (v) => { t.tempo = v; onChange(); },
    },
    combos: {
      title: 'Combinations', value: label(COMBINATION_OPTIONS, combos), visual: combosVisual(combos !== Combinations.Off, combos === Combinations.Often ? 3 : combos),
      options: COMBINATION_OPTIONS, current: combos, set: (v) => { t.combinations = v; onChange(); },
    },
    middle: {
      title: 'Middle · setter at net', value: label(MIDDLE_ZONE_OPTIONS, plan.middle), visual: middleVisual(plan.middle, true),
      options: MIDDLE_ZONE_OPTIONS, current: plan.middle, set: (v) => setPlan({ middle: v }),
    },
    middleBack: {
      title: 'Middle · setter back', value: label(MIDDLE_BACK_OPTIONS, middleOptionFor(plan, false)),
      visual: middleVisual(middleOptionFor(plan, false), false),
      options: MIDDLE_BACK_OPTIONS, current: middleOptionFor(plan, false), set: (v) => setPlan({ middleBack: v }),
    },
    pins: {
      title: 'Ball to the pins', value: label(PIN_OPTIONS, plan.pins), visual: pinsVisual(plan.pins),
      options: PIN_OPTIONS, current: plan.pins, set: (v) => setPlan({ pins: v }),
    },
    zoneCombos: {
      title: 'Combinations here', value: plan.combos ? 'Allowed' : 'Not here', visual: combosVisual(plan.combos, plan.combos ? 2 : 0),
      options: COMBO_ZONE_OPTIONS, current: plan.combos ? 1 : 0, set: (v) => setPlan({ combos: v === 1 }),
    },
    backRow: {
      title: 'Back-row attack', value: label(BACK_ROW_OPTIONS, plan.backRow), visual: backRowVisual(plan.backRow),
      options: BACK_ROW_OPTIONS, current: plan.backRow, set: (v) => setPlan({ backRow: v }),
    },
    target: {
      title: 'Main target', value: label(TARGET_OPTIONS, plan.target), visual: targetVisual(plan.target),
      options: TARGET_OPTIONS, current: plan.target, set: (v) => setPlan({ target: v }),
    },
    defense: {
      title: 'Defence', value: label(DEFENSE_OPTIONS, t.defense), visual: defenseVisual(t.defense),
      options: DEFENSE_OPTIONS, current: t.defense, set: (v) => { t.defense = v; onChange(); },
    },
    serve: {
      title: 'Serve', value: label(SERVE_OPTIONS, t.serve), visual: serveVisual(t.serve),
      options: SERVE_OPTIONS, current: t.serve, set: (v) => { t.serve = v; onChange(); },
    },
  };
  const teamKeys: CardKey[] = onFormation !== undefined ? ['formation', 'offense', 'tempo', 'combos'] : ['offense', 'tempo', 'combos'];
  const zoneKeys: CardKey[] = ['middle', 'middleBack', 'pins', 'zoneCombos', 'backRow', 'target'];
  const outKeys: CardKey[] = ['defense', 'serve'];
  const shown = phase === 'in' ? [...teamKeys, ...zoneKeys] : outKeys;
  const picked = open !== null && shown.includes(open) ? cards[open] : null;
  const grid = (keys: CardKey[]): JSX.Element => (
    <div className="icard-grid">
      {keys.map((k) => (
        <InstrCard key={k} title={cards[k].title} value={cards[k].value} visual={cards[k].visual} active={open === k}
          onClick={() => setOpen(open === k ? null : k)} />
      ))}
    </div>
  );

  return (
    <div className={`tboard phase-${phase}${compact ? ' compact' : ''}`}>
      <div className="tboard-phase" role="tablist">
        <button role="tab" aria-selected={phase === 'in'} className={phase === 'in' ? 'active' : ''} onClick={() => setPhase('in')}>
          <Icon name="ball" size={14} /> In Possession
        </button>
        <button role="tab" aria-selected={phase === 'out'} className={phase === 'out' ? 'active' : ''} onClick={() => setPhase('out')}>
          <Icon name="club" size={14} /> Out of Possession
        </button>
      </div>
      <div className="tboard-body">
        {phase === 'in' && !compact && <ZoneCourt plans={plans} zone={zone} onZone={setZone} />}
        {phase === 'out' && <DefenceEditor tactics={t} onChange={onChange} />}
        <div className="tboard-cards">
          {phase === 'in' ? (
            <>
              <div className="tboard-head">Whole team</div>
              {grid(teamKeys)}
              <div className="tboard-head">
                Pass in zone {zone} <span className="faint">· {PASS_ZONE_NAMES[zone]} from the net</span>
                {compact && (
                  <span className="tboard-zones">
                    {PASS_ZONES.map((z) => (
                      <button key={z} className={z === zone ? 'active' : ''} onClick={() => setZone(z)}>{z}</button>
                    ))}
                  </span>
                )}
              </div>
              {grid(zoneKeys)}
            </>
          ) : (
            <>
              <div className="tboard-head">Defence and serve</div>
              {grid(outKeys)}
              <p className="tboard-note">
                Place the defence behind the block on the court, for each kind of attack. The block assignment and where to serve are set rotation by rotation, in Rotations.
              </p>
            </>
          )}
          {picked !== null && open !== null && (
            <div className="tboard-pick">
              <div className="tboard-pick-head"><b>{picked.title}</b><span className="faint">{HINTS[open]}</span></div>
              <div className="tboard-pick-opts">
                {picked.options.map(([v, l]) => (
                  <button key={v} className={`instr-tile${v === picked.current ? ' active' : ''}`} onClick={() => picked.set(v)}>
                    {v === picked.current && <Icon name="check" size={13} />}
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {!compact && (
          <aside className="tboard-overview">
            <div className="tboard-head">Overview</div>
            <Overview title="Whole team" rows={teamKeys.map((k) => [cards[k].title, cards[k].value])} />
            {PASS_ZONES.map((z) => {
              const p = plans[z];
              return (
                <Overview key={z} title={`Zone ${z} · ${PASS_ZONE_NAMES[z]}`} active={phase === 'in' && z === zone} onClick={() => { setPhase('in'); setZone(z); }}
                  rows={[
                    ['Middle (net / back)', `${label(MIDDLE_ZONE_OPTIONS, p.middle).split(' ')[0]} / ${label(MIDDLE_BACK_OPTIONS, middleOptionFor(p, false)).split(' ')[0]}`],
                    ['Pins', label(PIN_OPTIONS, p.pins)],
                    ['Combinations', p.combos ? 'Allowed' : 'Not here'],
                    ['Back row', label(BACK_ROW_OPTIONS, p.backRow)],
                    ['Main target', label(TARGET_OPTIONS, p.target)],
                  ]} />
              );
            })}
            <Overview title="Out of possession" active={phase === 'out'} onClick={() => setPhase('out')} rows={[
              ...outKeys.map((k) => [cards[k].title, cards[k].value] as [string, string]),
              ['Behind block', ATTACK_SOURCES.map((s) => SHORT_PRESET[defenceName(defenceLayoutsOf(t)[s], s)] ?? 'Custom').join(' · ')],
            ]} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Overview({ title, rows, active = false, onClick }: {
  title: string;
  rows: Array<[string, string]>;
  active?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <div className={`tov${active ? ' active' : ''}${onClick !== undefined ? ' clickable' : ''}`} onClick={onClick}>
      <div className="tov-title">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="tov-row"><span>{k}</span><b>{v}</b></div>
      ))}
    </div>
  );
}
