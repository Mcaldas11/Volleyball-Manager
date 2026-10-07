/**
 * Tactical instructions.
 *
 * Tactics are not cosmetic modifiers bolted onto a result — they feed directly
 * into the rally state machine. An offensive system changes which attacker the
 * setter picks; a serve strategy changes the risk/reward curve on every serve;
 * a rotation's block assignment changes who commits on the quick.
 */

import { Position } from '../model/positions.ts';
import type { DefenceLayouts } from './defence.ts';

/**
 * The team's system: how many setters, and so who sets. In a 5-1 one setter
 * runs the offence from wherever he stands, with an opposite diagonal to him;
 * in a 4-2 two setters stand diagonal and whichever is in the back row comes
 * up to set, while the one at the net hits on the right — three front-row
 * attackers in every rotation, but the right side is a setter's arm.
 */
export enum Formation {
  FiveOne = 0,
  FourTwo = 1,
}

export const FORMATION_NAMES: Readonly<Record<Formation, string>> = {
  [Formation.FiveOne]: '5-1',
  [Formation.FourTwo]: '4-2',
};

/** Slot order used by `club.preferredLineup`, `pickLineup`'s result, the
 *  team-sheet UI and the match engine alike — slot `i` starts the set in zone
 *  `i + 1`, so this is the standard 5-1 in rotation P1: setter in 1, outsides
 *  in 2 and 5, middles in 3 and 6, opposite in 4. Setter and opposite sit
 *  diagonal, as do the two outsides and the two middles, and every other
 *  rotation follows from it. Whoever starts in a slot plays its position. */
export const LINEUP_SLOT_POSITIONS: readonly Position[] = [
  Position.Setter, Position.OutsideHitter, Position.MiddleBlocker,
  Position.Opposite, Position.OutsideHitter, Position.MiddleBlocker,
];

/** The 4-2: a second setter where the opposite stands, diagonal to the first. */
export const LINEUP_SLOT_POSITIONS_42: readonly Position[] = [
  Position.Setter, Position.OutsideHitter, Position.MiddleBlocker,
  Position.Setter, Position.OutsideHitter, Position.MiddleBlocker,
];

/** The six slots' positions for a system. */
export function lineupSlotPositions(formation: Formation): readonly Position[] {
  return formation === Formation.FourTwo ? LINEUP_SLOT_POSITIONS_42 : LINEUP_SLOT_POSITIONS;
}

/** A team's system — 5-1 unless its coach has chosen otherwise (and on saves from before the choice). */
export function formationOf(t: Pick<TeamTactics, 'formation'> | undefined): Formation {
  return t?.formation ?? Formation.FiveOne;
}

export enum OffensiveSystem {
  Fast = 0,
  Balanced = 1,
  OutsideFocused = 2,
  OppositeFocused = 3,
  MiddleFocused = 4,
  PipeHeavy = 5,
  BackRowHeavy = 6,
}

export enum DefensiveSystem {
  Conservative = 0,
  Aggressive = 1,
  TripleBlockPriority = 2,
  ServicePressure = 3,
  ReceptionStability = 4,
}

export enum ServeStrategy {
  Risky = 0,
  Balanced = 1,
  Conservative = 2,
}

export enum Tempo {
  VeryFast = 0,
  Fast = 1,
  Balanced = 2,
  Slow = 3,
}

/** Where the server is instructed to aim. */
export enum ServeTarget {
  Auto = 0,
  WeakestPasser = 1,
  Setter = 2,
  BestAttacker = 3,
  DeepCorner = 4,
  ShortZone = 5,
}

/** Defensive floor shape behind the block. */
export enum DefensiveShape {
  PerimeterDefense = 0,
  RotationDefense = 1,
  ManUpDefense = 2,
}

/** How aggressively the middle commits on the opposing quick. */
export enum BlockAssignment {
  ReadBlock = 0,
  CommitMiddle = 1,
  SpreadBlock = 2,
  ReleaseToLine = 3,
}

/**
 * What the middle hits: the quick in front of the setter (the "tensa"), the
 * back quick behind him (the "costas"), the slide — off one foot, running
 * along the net behind the setter (the "china") — or a mix of them, by what
 * each middle does best and how good the pass is.
 */
export enum MiddlePlay {
  Mixed = 0,
  Quick = 1,
  BackQuick = 2,
  Slide = 3,
}

/**
 * How often the setter runs combination plays off the middle: the X — the
 * outside crossing behind the middle's quick; the tandem — the opposite
 * hitting right behind it; the shoot — a fast, flat set out to the pin while
 * the middle pulls the block; and the pipe off the quick. They beat the block,
 * if the side has rehearsed them; if not, the timing goes.
 */
export enum Combinations {
  Off = 0,
  Some = 1,
  Often = 2,
}

/** The play the setter called for an attack: the middle's kind of quick, a
 *  combination, or a fast set out to a pin. */
export type PlayCall = 'quick' | 'backQuick' | 'slide' | 'x' | 'tandem' | 'shoot' | 'pipeQuick' | 'fastSet';

export const PLAY_NAMES: Readonly<Record<PlayCall, string>> = {
  quick: 'Quick', backQuick: 'Back quick', slide: 'Slide', x: 'X play', tandem: 'Tandem', shoot: 'Shoot',
  pipeQuick: 'Pipe off the quick', fastSet: 'Fast set',
};

// ---- Where the pass comes down --------------------------------------------------------------
//
// The setter's options depend on where the pass or dig puts the ball. Within
// 3 m of the net (zone A) he can run anything: the middle's quicks, the pins,
// combinations, the back row. Between 3 and 6 m (B) the middle can only get
// the quick in front — the tensa — while the pins go on as ever. Deeper than
// 6 m (C) it is the pins only, and a high ball to the back row from zone 1.
// Each zone's plan is the coach's to set.

/** Where a pass comes down: within 3 m of the net, 3 to 6 m, or 6 to 9 m. */
export type PassZone = 'A' | 'B' | 'C';
export const PASS_ZONES: readonly PassZone[] = ['A', 'B', 'C'];
export const PASS_ZONE_NAMES: Readonly<Record<PassZone, string>> = { A: '0–3 m', B: '3–6 m', C: '6–9 m' };

/** Where a pass or dig of quality `q` (0-1) comes down — a perfect one at the net, a poor one deep. */
export function passZone(q: number): PassZone {
  return q >= 0.58 ? 'A' : q >= 0.42 ? 'B' : 'C';
}

/** What the middle may hit off a pass in a zone. */
export enum MiddleOption {
  Any = 0,
  Quick = 1,
  BackQuick = 2,
  Slide = 3,
  None = 4,
}

/** How the ball goes out to the pins: high, fast and flat, or the setter's choice by the set he has. */
export enum PinSet {
  Mixed = 0,
  High = 1,
  Fast = 2,
}

/** Who attacks from the back row: the pipe from zone 6, the opposite from zone 1, both or neither. */
export enum BackRowOption {
  Both = 0,
  Pipe = 1,
  ZoneOne = 2,
  None = 3,
}

/** Who the setter looks for first off a pass in a zone. */
export enum ZoneTarget {
  Auto = 0,
  Outside = 1,
  Opposite = 2,
  Middle = 3,
  BackRow = 4,
}

/**
 * The setter's rotations, named for the zone he stands in: at the net in P4,
 * P3 and P2 — and only then is the right side free for the middle to run the
 * slide behind him — and in the back row in P1, P6 and P5.
 */
export const SETTER_FRONT_ROTATIONS: readonly number[] = [3, 2, 1];
export const SETTER_BACK_ROTATIONS: readonly number[] = [0, 5, 4];

/** Whether the setter stands in the front row in rotation `r` (0 for P1). */
export function setterAtNet(r: number): boolean {
  return r >= 1 && r <= 3;
}

/** The coach's plan for a pass coming down in one zone. */
export interface ZonePlan {
  /** What the middle may hit with the setter at the net (P2, P3, P4). */
  middle: MiddleOption;
  /** …and with the setter in the back row (P1, P6, P5) — never the slide. Absent: as at the net, the slide made a quick. */
  middleBack?: MiddleOption;
  pins: PinSet;
  /** Combination plays may be run off a pass here. */
  combos: boolean;
  backRow: BackRowOption;
  target: ZoneTarget;
}

export type ZonePlans = Record<PassZone, ZonePlan>;

/** The usual plan: anything off a pass at the net; the tensa only from 3-6 m;
 *  the pins and a high ball to zone 1 off a deep one. */
export function defaultZonePlans(): ZonePlans {
  return {
    A: {
      middle: MiddleOption.Any, middleBack: MiddleOption.Any, pins: PinSet.Mixed, combos: true, backRow: BackRowOption.Both,
      target: ZoneTarget.Auto,
    },
    B: {
      middle: MiddleOption.Quick, middleBack: MiddleOption.Quick, pins: PinSet.Mixed, combos: false, backRow: BackRowOption.Both,
      target: ZoneTarget.Auto,
    },
    C: {
      middle: MiddleOption.None, middleBack: MiddleOption.None, pins: PinSet.High, combos: false, backRow: BackRowOption.ZoneOne,
      target: ZoneTarget.Auto,
    },
  };
}

/** What the middle may hit in a zone, with the setter at the net or not: never the slide with him in the back row. */
export function middleOptionFor(plan: ZonePlan, setterFront: boolean): MiddleOption {
  if (setterFront) return plan.middle;
  const back = plan.middleBack ?? plan.middle;
  return back === MiddleOption.Slide ? MiddleOption.Quick : back;
}

/** A team's zone plans: its own, or the usual — with the middle's attack set before the zones carried into zone A. */
export function zonePlansOf(t: Pick<TeamTactics, 'zones' | 'middlePlay'> | undefined): ZonePlans {
  if (t?.zones !== undefined) return t.zones;
  const plans = defaultZonePlans();
  const mp = t?.middlePlay;
  if (mp === MiddlePlay.Quick) plans.A.middle = MiddleOption.Quick;
  else if (mp === MiddlePlay.BackQuick) plans.A.middle = MiddleOption.BackQuick;
  else if (mp === MiddlePlay.Slide) plans.A.middle = MiddleOption.Slide;
  return plans;
}

/** A combination play — one with the middle as the decoy. */
export function isCombination(call: PlayCall | undefined): boolean {
  return call === 'x' || call === 'tandem' || call === 'shoot' || call === 'pipeQuick';
}

/** How often combinations are run — now and then, on saves from before it could be set. */
export function combinationsOf(t: Pick<TeamTactics, 'combinations'> | undefined): Combinations {
  return t?.combinations ?? Combinations.Some;
}

/** How often a pin attack off a good pass is run as a combination, and how
 *  much more the middle is fed — he is in every one of them. */
export const COMBINATION_PROFILE: Readonly<Record<Combinations, { rate: number; quickFeed: number }>> = {
  [Combinations.Off]: { rate: 0, quickFeed: 1 },
  [Combinations.Some]: { rate: 0.22, quickFeed: 1.1 },
  [Combinations.Often]: { rate: 0.42, quickFeed: 1.22 },
};

/** Per-rotation instructions. Rotations differ enormously in practice. */
export interface RotationTactics {
  /** Position the setter should prioritise in this rotation, or -1 for auto. */
  preferredAttacker: Position | -1;
  serveTarget: ServeTarget;
  blockAssignment: BlockAssignment;
  defensiveShape: DefensiveShape;
  /** 0-100: how much to run transition offense through the back row. */
  transitionBackRow: number;
  /** 0-100: setter's bias toward the fastest available tempo. */
  setterTempoBias: number;
}

export interface TeamTactics {
  /** 5-1 or 4-2; absent on saves from before the choice, which play 5-1. */
  formation?: Formation;
  offense: OffensiveSystem;
  defense: DefensiveSystem;
  serve: ServeStrategy;
  tempo: Tempo;
  /** What the middle hit, before the zone plans: kept only to carry into zone A — see zonePlansOf. */
  middlePlay?: MiddlePlay;
  /** The plan for each zone a pass can come down in — see ZonePlan. Absent: the usual plan. */
  zones?: ZonePlans;
  /** Where the defence stands behind the block against each kind of attack — see defence.ts. Absent: perimeter. */
  defence?: DefenceLayouts;
  /** How often combination plays are run — see Combinations. Absent on older saves: now and then. */
  combinations?: Combinations;
  /** Instructions for rotations P1..P6, indexed 0-5. */
  rotations: RotationTactics[];
}

export function defaultRotationTactics(): RotationTactics {
  return {
    preferredAttacker: -1,
    serveTarget: ServeTarget.Auto,
    blockAssignment: BlockAssignment.ReadBlock,
    defensiveShape: DefensiveShape.PerimeterDefense,
    transitionBackRow: 35,
    setterTempoBias: 50,
  };
}

export function defaultTactics(): TeamTactics {
  return {
    formation: Formation.FiveOne,
    offense: OffensiveSystem.Balanced,
    defense: DefensiveSystem.Conservative,
    serve: ServeStrategy.Balanced,
    tempo: Tempo.Balanced,
    combinations: Combinations.Some,
    zones: defaultZonePlans(),
    rotations: Array.from({ length: 6 }, defaultRotationTactics),
  };
}

/**
 * Serve risk profile. Aggressive serving buys aces at the cost of errors —
 * the trade every coach argues about. `power` scales serve speed (and so both
 * ace chance and error chance); `accuracy` scales control.
 */
export const SERVE_PROFILE: Readonly<Record<ServeStrategy, { power: number; accuracy: number }>> = {
  [ServeStrategy.Risky]: { power: 1.1, accuracy: 0.8 },
  [ServeStrategy.Balanced]: { power: 1.0, accuracy: 1.0 },
  [ServeStrategy.Conservative]: { power: 0.82, accuracy: 1.14 },
};

/**
 * Attacker selection weights by offensive system, keyed by attack lane.
 * These are relative propensities, later modulated by who is actually front
 * row, reception quality, and the individual attacker's quality.
 */
export const enum AttackLane {
  QuickMiddle = 0,
  OutsideHigh = 1,
  OppositeRight = 2,
  Pipe = 3,
  BackRowRight = 4,
  SecondTempoOutside = 5,
}

export const LANE_NAMES: Readonly<Record<number, string>> = {
  [AttackLane.QuickMiddle]: 'Quick (middle)',
  [AttackLane.OutsideHigh]: 'Outside',
  [AttackLane.OppositeRight]: 'Opposite',
  [AttackLane.Pipe]: 'Pipe',
  [AttackLane.BackRowRight]: 'Back-row right',
  [AttackLane.SecondTempoOutside]: 'Second tempo outside',
};

export const OFFENSE_LANE_WEIGHTS: Readonly<Record<OffensiveSystem, readonly number[]>> = {
  //                          quick  outside  opp   pipe  backRight  2ndTempo
  [OffensiveSystem.Fast]: [1.75, 1.0, 0.95, 0.85, 0.45, 0.5],
  [OffensiveSystem.Balanced]: [1.0, 1.25, 1.05, 0.55, 0.35, 0.75],
  [OffensiveSystem.OutsideFocused]: [0.75, 2.1, 0.8, 0.5, 0.25, 1.0],
  [OffensiveSystem.OppositeFocused]: [0.75, 0.95, 2.15, 0.45, 0.7, 0.6],
  [OffensiveSystem.MiddleFocused]: [2.3, 0.95, 0.85, 0.45, 0.25, 0.6],
  [OffensiveSystem.PipeHeavy]: [1.05, 1.0, 0.9, 1.85, 0.5, 0.6],
  [OffensiveSystem.BackRowHeavy]: [0.85, 0.85, 0.8, 1.5, 1.4, 0.5],
};

/**
 * Tempo affects how quickly the offense operates: faster tempo means the block
 * has less time to form, but demands better reception and higher setter skill
 * to execute without errors.
 */
export const TEMPO_PROFILE: Readonly<
  Record<Tempo, { blockDelay: number; executionDifficulty: number }>
> = {
  [Tempo.VeryFast]: { blockDelay: 0.3, executionDifficulty: 1.3 },
  [Tempo.Fast]: { blockDelay: 0.18, executionDifficulty: 1.14 },
  [Tempo.Balanced]: { blockDelay: 0.0, executionDifficulty: 1.0 },
  [Tempo.Slow]: { blockDelay: -0.14, executionDifficulty: 0.9 },
};

/** Defensive system effects on block count, dig positioning, and serve risk. */
export const DEFENSE_PROFILE: Readonly<
  Record<
    DefensiveSystem,
    { blockPressure: number; digCoverage: number; servePressure: number; receptionBonus: number }
  >
> = {
  [DefensiveSystem.Conservative]: {
    blockPressure: 0.95, digCoverage: 1.08, servePressure: 0.95, receptionBonus: 1.0,
  },
  // Each a trade against the conservative default, none of them a trap:
  // played against it by an equal side, every one wins close to half its
  // matches — engine.test.ts pins it.
  [DefensiveSystem.Aggressive]: {
    blockPressure: 1.15, digCoverage: 1.02, servePressure: 1.06, receptionBonus: 0.98,
  },
  [DefensiveSystem.TripleBlockPriority]: {
    blockPressure: 1.3, digCoverage: 1.02, servePressure: 1.0, receptionBonus: 0.99,
  },
  [DefensiveSystem.ServicePressure]: {
    blockPressure: 1.0, digCoverage: 0.95, servePressure: 1.22, receptionBonus: 0.95,
  },
  [DefensiveSystem.ReceptionStability]: {
    blockPressure: 0.95, digCoverage: 1.04, servePressure: 0.93, receptionBonus: 1.1,
  },
};
