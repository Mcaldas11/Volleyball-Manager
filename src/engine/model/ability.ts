/**
 * Current and Potential Ability.
 *
 * CA is a single 0-2000 roll-up of how good a player is *right now, for the
 * position they play*. It is never stored independently of the attributes —
 * it is always recomputed from them, so that when training nudges an attribute
 * up, ability follows automatically and cannot drift out of sync.
 *
 * The positional weights below are what make a 205cm middle blocker with a 6
 * in Setting a world-class player rather than a mediocre one: setting simply
 * does not count for a middle. They are also why converting a player to a new
 * position genuinely costs ability rather than merely applying a penalty.
 */

import { ATTR_COUNT, ATTR_INDEX, type AttributeName } from './attributes.ts';
import type { PlayerStore } from './players.ts';
import { Position } from './positions.ts';

type WeightMap = Partial<Record<AttributeName, number>>;

/** How much each attribute contributes to ability, by position. */
export const POSITION_WEIGHTS: Readonly<Record<Position, WeightMap>> = {
  [Position.Setter]: {
    setting: 1.0, ballControl: 0.85, concentration: 0.72, composure: 0.68,
    agility: 0.55, teamwork: 0.6, leadership: 0.55, blocking: 0.45,
    digging: 0.42, floatServe: 0.52, jumpServe: 0.35, servingAccuracy: 0.52,
    balance: 0.4, determination: 0.4, pressureHandling: 0.5, verticalJump: 0.35,
    reception: 0.18, spikeTechnique: 0.2, quickAttack: 0.15, stamina: 0.45,
  },
  [Position.Opposite]: {
    spikeTechnique: 1.0, verticalJump: 0.92, backRowAttack: 0.8, servingPower: 0.74,
    jumpServe: 0.82, powerServe: 0.72, servingAccuracy: 0.5, blocking: 0.66, acceleration: 0.5,
    composure: 0.5, determination: 0.55, pressureHandling: 0.5, ballControl: 0.4,
    stamina: 0.55, balance: 0.4, pipeAttack: 0.35, quickAttack: 0.3,
    reception: 0.12, digging: 0.28, agility: 0.4,
  },
  [Position.OutsideHitter]: {
    spikeTechnique: 0.95, reception: 0.9, ballControl: 0.75, verticalJump: 0.8,
    pipeAttack: 0.72, digging: 0.6, blocking: 0.55, jumpServe: 0.72,
    servingAccuracy: 0.58, servingPower: 0.52, stamina: 0.65, agility: 0.55, composure: 0.5,
    concentration: 0.5, backRowAttack: 0.45, determination: 0.5, balance: 0.5,
    acceleration: 0.45, teamwork: 0.45,
  },
  [Position.MiddleBlocker]: {
    blocking: 1.0, quickAttack: 0.95, verticalJump: 0.88, agility: 0.62,
    acceleration: 0.58, concentration: 0.6, balance: 0.5, spikeTechnique: 0.55,
    floatServe: 0.58, servingAccuracy: 0.5, stamina: 0.5, flexibility: 0.4,
    determination: 0.4, teamwork: 0.4, reception: 0.08, digging: 0.2,
  },
  [Position.Libero]: {
    reception: 1.0, digging: 1.0, ballControl: 0.9, agility: 0.82,
    concentration: 0.75, balance: 0.7, flexibility: 0.62, acceleration: 0.6,
    composure: 0.55, teamwork: 0.5, stamina: 0.55, setting: 0.35,
    determination: 0.45, leadership: 0.3,
  },
};

/**
 * Precomputed as flat arrays so ability recalculation — which runs for every
 * player in the world at each development tick — never touches a hash map.
 */
const WEIGHT_TABLE: Float64Array[] = [];
const WEIGHT_SUM: number[] = [];
for (const pos of [
  Position.Setter, Position.Opposite, Position.OutsideHitter,
  Position.MiddleBlocker, Position.Libero,
]) {
  const arr = new Float64Array(ATTR_COUNT);
  let sum = 0;
  const map = POSITION_WEIGHTS[pos];
  for (const [name, w] of Object.entries(map)) {
    arr[ATTR_INDEX[name as AttributeName]] = w!;
    sum += w!;
  }
  WEIGHT_TABLE[pos] = arr;
  WEIGHT_SUM[pos] = sum;
}

export function weightsFor(pos: Position): Float64Array {
  return WEIGHT_TABLE[pos];
}

export function weightSumFor(pos: Position): number {
  return WEIGHT_SUM[pos];
}

/**
 * Reach expectations by position, in centimetres of spike reach. A middle
 * blocker who cannot get above 340 is physically limited no matter how good
 * their technique; an outside at 360 has a real edge.
 */
const REACH_NORM: Readonly<Record<Position, number>> = {
  [Position.Setter]: 333,
  [Position.Opposite]: 352,
  [Position.OutsideHitter]: 348,
  [Position.MiddleBlocker]: 355,
  // Liberos are not selected on reach, so this norm sits at the population
  // average rather than at an elite standard — otherwise simply being a
  // libero would earn a systematic ability bonus.
  [Position.Libero]: 322,
};

/** Weight of the physical-reach term relative to the attribute average. */
const REACH_WEIGHT = 0.14;

/**
 * Recompute a player's Current Ability from their attributes and physique.
 */
export function computeCurrentAbility(store: PlayerStore, i: number): number {
  const pos = store.position[i] as Position;
  const w = WEIGHT_TABLE[pos];
  const wsum = WEIGHT_SUM[pos];
  const base = i * ATTR_COUNT;
  const attrs = store.attrs;

  let acc = 0;
  for (let a = 0; a < ATTR_COUNT; a++) {
    const weight = w[a];
    if (weight === 0) continue;
    acc += weight * ((attrs[base + a] - 1) / 19);
  }
  const attrScore = acc / wsum;

  // Reach relative to the positional norm, saturating so that extreme height
  // is an advantage but never a substitute for skill.
  const reachDelta = store.spikeReachCm[i] - REACH_NORM[pos];
  const reachScore = Math.tanh(reachDelta / 22) * 0.5 + 0.5;

  const combined = attrScore * (1 - REACH_WEIGHT) + reachScore * REACH_WEIGHT;
  return Math.round(Math.max(0, Math.min(1, combined)) * 2000);
}

/** Recompute and store CA. Call after any attribute change. */
export function refreshAbility(store: PlayerStore, i: number): number {
  const ca = computeCurrentAbility(store, i);
  store.currentAbility[i] = ca;
  if (store.potentialAbility[i] < ca) store.potentialAbility[i] = ca;
  return ca;
}

/**
 * The share of their potential a player has realised at a given age.
 *
 * Volleyball careers peak later than the raw athletic curve suggests, because
 * reading the game matters so much: setters and liberos in particular often
 * play their best volleyball past thirty. The decline after the peak is real
 * but gradual until the mid-thirties, when it accelerates sharply.
 */
export function abilityFractionAtAge(age: number): number {
  if (age <= 14) return 0.28;
  if (age <= 18) return 0.28 + ((age - 14) / 4) * 0.27; // 0.28 -> 0.55
  if (age <= 21) return 0.55 + ((age - 18) / 3) * 0.19; // 0.55 -> 0.74
  if (age <= 24) return 0.74 + ((age - 21) / 3) * 0.16; // 0.74 -> 0.90
  if (age <= 27) return 0.90 + ((age - 24) / 3) * 0.09; // 0.90 -> 0.99
  if (age <= 30) return 0.99 + ((age - 27) / 3) * 0.01; // plateau
  if (age <= 33) return 1.0 - ((age - 30) / 3) * 0.06;
  if (age <= 36) return 0.94 - ((age - 33) / 3) * 0.12;
  return Math.max(0.45, 0.82 - (age - 36) * 0.055);
}

/**
 * Position-specific ageing. A libero's game survives ageing far better than an
 * opposite's, because it depends on reading and technique rather than on
 * jumping over a triple block.
 */
export const AGEING_RESISTANCE: Readonly<Record<Position, number>> = {
  [Position.Setter]: 0.62,
  [Position.Opposite]: 1.18,
  [Position.OutsideHitter]: 1.0,
  [Position.MiddleBlocker]: 1.1,
  [Position.Libero]: 0.6,
};
