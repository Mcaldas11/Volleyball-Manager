/**
 * Getting hurt in a match.
 *
 * Every rally on court carries a small risk — more for a player prone to
 * injury, less for a durable one, more as he tires. Most of what happens is a
 * knock he can carry on with — a turned ankle, a jammed finger, cramp — at
 * the coach's choice and at a risk: every rally he plays on with it, it may
 * get worse, into the injury it could have been. Now and then it is one that
 * ends his match there and then: he has to come off.
 *
 * What a match did to a player — and how long it keeps him out — is settled
 * once it is over, by whether he came off for it or played on, and whether it
 * got worse (see `injuryOutcome`).
 */

import type { Rng } from '../core/rng.ts';
import { InjuryType, type PlayerStore } from '../model/players.ts';

export type InjurySeverity = 'knock' | 'serious';

/** Something that happened to a player in a match. */
export interface MatchInjury {
  p: number;
  team: 0 | 1;
  /** When: the set (from 0) and the rally of the match. */
  set: number;
  rally: number;
  /** Which of `MATCH_INJURIES` it was. */
  kind: number;
  /** What it is now: a knock that got worse is the injury it became. */
  type: InjuryType;
  severity: InjurySeverity;
  /** A knock he played on with, that got worse. */
  aggravated?: boolean;
  /** He came off for it — and who came on for him (-1 for nobody: a libero the side went on without). */
  off?: boolean;
  replacedBy?: number;
}

interface Days {
  type: InjuryType;
  days: readonly [number, number];
  /** What a long one takes out of a career for good — see progression.ts. */
  cost: number;
}

interface InjuryKind {
  type: InjuryType;
  severity: InjurySeverity;
  weight: number;
  /** A serious one: how long it keeps him out. */
  days?: readonly [number, number];
  cost?: number;
  /** A knock: the days it costs taken off straight away, or played on with to the end — and what it becomes if it gets worse. */
  off?: readonly [number, number];
  on?: readonly [number, number];
  worse?: Days;
}

export const MATCH_INJURIES: readonly InjuryKind[] = [
  // Knocks: he can carry on — at a risk.
  { type: InjuryType.TurnedAnkle, severity: 'knock', weight: 24, off: [0, 3], on: [2, 6], worse: { type: InjuryType.AnkleSprain, days: [10, 30], cost: 0.002 } },
  { type: InjuryType.JammedFinger, severity: 'knock', weight: 14, off: [0, 2], on: [1, 5], worse: { type: InjuryType.FingerFracture, days: [14, 40], cost: 0.003 } },
  { type: InjuryType.Cramp, severity: 'knock', weight: 14, off: [0, 1], on: [0, 3], worse: { type: InjuryType.MuscleStrain, days: [7, 18], cost: 0 } },
  { type: InjuryType.KneeKnock, severity: 'knock', weight: 9, off: [0, 3], on: [2, 7], worse: { type: InjuryType.KneeCartilage, days: [30, 90], cost: 0.02 } },
  { type: InjuryType.SoreShoulder, severity: 'knock', weight: 9, off: [0, 3], on: [2, 7], worse: { type: InjuryType.Shoulder, days: [21, 60], cost: 0.01 } },
  // Injuries that end his match.
  { type: InjuryType.AnkleSprain, severity: 'serious', weight: 11, days: [10, 35], cost: 0.002 },
  { type: InjuryType.MuscleStrain, severity: 'serious', weight: 6, days: [7, 21], cost: 0 },
  { type: InjuryType.FingerFracture, severity: 'serious', weight: 4, days: [14, 45], cost: 0.003 },
  { type: InjuryType.Back, severity: 'serious', weight: 3.5, days: [7, 30], cost: 0.01 },
  { type: InjuryType.Shoulder, severity: 'serious', weight: 3, days: [30, 90], cost: 0.018 },
  { type: InjuryType.KneeCartilage, severity: 'serious', weight: 1.5, days: [40, 120], cost: 0.03 },
  { type: InjuryType.ACLTear, severity: 'serious', weight: 0.6, days: [200, 330], cost: 0.085 },
  { type: InjuryType.AchillesTear, severity: 'serious', weight: 0.4, days: [180, 300], cost: 0.075 },
];

const WEIGHTS = MATCH_INJURIES.map((k) => k.weight);

/**
 * The risk to an average player in a rally on court. A side keeps about seven
 * on court for some 170 rallies, so this comes to something happening about
 * once in ten matches for each side — mostly knocks.
 */
export const INJURY_PER_RALLY = 0.00006;
/** Each rally a player plays on with a knock, the risk it gets worse. */
export const AGGRAVATE_PER_RALLY = 0.005;
/** How far a knock takes a player below himself while he plays on with it. */
export const KNOCK_HAMPER = 0.86;

/** The risk to this player of getting hurt in one rally on court; `tired` from 0 (fresh) to 1. */
export function injuryRiskPerRally(store: PlayerStore, p: number, tired: number): number {
  const proneness = store.getAttr(p, 'injuryProneness') / 20;
  const durability = store.getAttr(p, 'durability') / 20;
  return INJURY_PER_RALLY * (0.55 + proneness * 1.1) * (1.35 - durability * 0.7) * (1 + Math.max(0, tired) * 1.3);
}

/** What he has done to himself: which of `MATCH_INJURIES`. */
export function drawInjury(rng: Rng): number {
  return rng.weightedIndex(WEIGHTS);
}

/** A knock played on with that gets worse: the injury it becomes. */
export function aggravate(inj: MatchInjury): void {
  const worse = MATCH_INJURIES[inj.kind].worse;
  if (worse === undefined || inj.aggravated === true) return;
  inj.aggravated = true;
  inj.severity = 'serious';
  inj.type = worse.type;
}

/**
 * What a match's injury comes to once it is over: what he has, how many days
 * it keeps him out (0 for a knock that cost nothing), and what a long one
 * takes out of his career.
 */
export function injuryOutcome(inj: MatchInjury, rng: Rng): { type: InjuryType; days: number; cost: number } {
  const k = MATCH_INJURIES[inj.kind];
  if (inj.aggravated === true && k.worse !== undefined) {
    return { type: k.worse.type, days: rng.int(k.worse.days[0], k.worse.days[1]), cost: k.worse.cost };
  }
  if (k.severity === 'serious') return { type: k.type, days: rng.int(k.days![0], k.days![1]), cost: k.cost ?? 0 };
  const range = inj.off === true ? k.off! : k.on!;
  return { type: k.type, days: rng.int(range[0], range[1]), cost: 0 };
}
