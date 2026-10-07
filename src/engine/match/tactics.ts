/**
 * Tactical instructions.
 *
 * Tactics are not cosmetic modifiers bolted onto a result — they feed directly
 * into the rally state machine. An offensive system changes which attacker the
 * setter picks; a serve strategy changes the risk/reward curve on every serve;
 * a rotation's block assignment changes who commits on the quick.
 */

import { Position } from '../model/positions.ts';

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

/** The play the setter called for an attack. */
export type PlayCall = 'quick' | 'backQuick' | 'slide' | 'x' | 'tandem' | 'shoot' | 'pipeQuick';

export const PLAY_NAMES: Readonly<Record<PlayCall, string>> = {
  quick: 'Quick', backQuick: 'Back quick', slide: 'Slide', x: 'X play', tandem: 'Tandem', shoot: 'Shoot',
  pipeQuick: 'Pipe off the quick',
};

/** A combination play — one with the middle as the decoy. */
export function isCombination(call: PlayCall | undefined): boolean {
  return call === 'x' || call === 'tandem' || call === 'shoot' || call === 'pipeQuick';
}

/** The middle's attack — mixed, on saves from before it could be set. */
export function middlePlayOf(t: Pick<TeamTactics, 'middlePlay'> | undefined): MiddlePlay {
  return t?.middlePlay ?? MiddlePlay.Mixed;
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
  /** What the middle hits — see MiddlePlay. Absent on older saves: mixed. */
  middlePlay?: MiddlePlay;
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
    middlePlay: MiddlePlay.Mixed,
    combinations: Combinations.Some,
    rotations: Array.from({ length: 6 }, defaultRotationTactics),
  };
}

/**
 * Serve risk profile. Aggressive serving buys aces at the cost of errors —
 * the trade every coach argues about. `power` scales serve speed (and so both
 * ace chance and error chance); `accuracy` scales control.
 */
export const SERVE_PROFILE: Readonly<Record<ServeStrategy, { power: number; accuracy: number }>> = {
  [ServeStrategy.Risky]: { power: 1.18, accuracy: 0.84 },
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
  [DefensiveSystem.Aggressive]: {
    blockPressure: 1.18, digCoverage: 0.9, servePressure: 1.06, receptionBonus: 0.97,
  },
  [DefensiveSystem.TripleBlockPriority]: {
    blockPressure: 1.3, digCoverage: 0.78, servePressure: 1.0, receptionBonus: 0.98,
  },
  [DefensiveSystem.ServicePressure]: {
    blockPressure: 1.0, digCoverage: 0.95, servePressure: 1.22, receptionBonus: 0.95,
  },
  [DefensiveSystem.ReceptionStability]: {
    blockPressure: 0.9, digCoverage: 1.0, servePressure: 0.86, receptionBonus: 1.12,
  },
};
