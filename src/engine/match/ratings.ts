/**
 * Turning attributes into match-relevant skill ratings.
 *
 * The rally loop runs millions of times per simulated season, so it must not
 * be reading bytes out of the attribute table and re-deriving skills on every
 * contact. Instead each player's ratings are computed once when a match starts
 * and stored as floats; the rally loop then applies only cheap multiplicative
 * modifiers (fatigue, momentum, confidence).
 *
 * Ratings live on a 0-100 scale. Contests between them go through a logistic
 * curve, so a 10-point rating edge is roughly a 60/40 outcome and a 30-point
 * edge is roughly 85/15 — which matches how volleyball actually behaves, where
 * even large talent gaps do not produce certainty on any single rally.
 */

import { ATTR_COUNT, ATTR_INDEX } from '../model/attributes.ts';
import type { PlayerStore } from '../model/players.ts';
import { Position, positionalEffectiveness } from '../model/positions.ts';

/** Reference anthropometrics for a top-flight men's league, used to normalise. */
const REF_SPIKE_REACH = 345;
const REF_BLOCK_REACH = 330;

const A = ATTR_INDEX;

export interface PlayerMatchRatings {
  /** Index into the PlayerStore. */
  idx: number;
  /** Role this player is filling in this match (may differ from natural). */
  role: Position;
  /** Multiplier for playing out of position. */
  posEff: number;

  serveFloat: number;
  serveJump: number;
  servePower: number;
  serveAccuracy: number;

  reception: number;
  dig: number;
  setting: number;
  block: number;

  attackPower: number;
  attackControl: number;
  quickAttack: number;
  backRowAttack: number;
  pipeAttack: number;

  /** Reach differentials above league reference, in cm. */
  spikeReachEdge: number;
  blockReachEdge: number;

  stamina: number;
  recovery: number;
  composure: number;
  concentration: number;
  consistency: number;
  bigMatch: number;
  leadership: number;
  teamwork: number;

  /** Live per-match state, mutated as the match runs. */
  fatigue: number;
  confidence: number;
}

/** Normalise a 1-20 attribute to 0..1. */
function n(v: number): number {
  return (v - 1) / 19;
}

/** Scale a 0..1 blend onto the 0-100 rating scale. */
function r(x: number): number {
  return x * 100;
}

/**
 * Build match ratings for one player filling a given role.
 *
 * `formBonus` folds in morale, form, and condition so that a player in poor
 * shape genuinely plays worse rather than merely being flagged as such.
 */
export function computeRatings(
  store: PlayerStore,
  idx: number,
  role: Position,
): PlayerMatchRatings {
  const b = idx * ATTR_COUNT;
  const at = store.attrs;
  const g = (k: number): number => n(at[b + k]);

  const natural = store.position[idx] as Position;
  const secondary = store.secondary[idx] as Position | -1;
  const posEff = positionalEffectiveness(natural, secondary, role);

  // Condition and morale act as broad multipliers on everything technical.
  const condition = store.condition[idx] / 100;
  const morale = store.morale[idx] / 100;
  const form = store.form[idx] / 50; // -1..1
  const state = 0.86 + 0.1 * condition + 0.06 * morale + 0.04 * form;

  const athleticism = 0.5 * g(A.verticalJump) + 0.25 * g(A.agility) + 0.25 * g(A.acceleration);
  const technique = g(A.spikeTechnique);
  const control = g(A.ballControl);

  const spikeEdge = store.spikeReachCm[idx] - REF_SPIKE_REACH;
  const blockEdge = store.blockReachCm[idx] - REF_BLOCK_REACH;

  // Reach converts to rating points at roughly 0.7 per cm — meaningful but not
  // dominant, since timing and technique decide most contested balls.
  const spikeReachBonus = spikeEdge * 0.7;
  const blockReachBonus = blockEdge * 0.75;

  const mk = (x: number): number => r(x) * state * posEff;

  return {
    idx,
    role,
    posEff,

    serveFloat: mk(0.68 * g(A.floatServe) + 0.22 * g(A.servingAccuracy) + 0.1 * control),
    serveJump: mk(0.55 * g(A.jumpServe) + 0.22 * g(A.servingPower) + 0.23 * athleticism),
    servePower: mk(0.7 * g(A.servingPower) + 0.3 * g(A.powerServe)),
    serveAccuracy: mk(0.7 * g(A.servingAccuracy) + 0.18 * g(A.concentration) + 0.12 * control),

    reception: mk(0.6 * g(A.reception) + 0.2 * control + 0.12 * g(A.concentration) + 0.08 * g(A.balance)),
    dig: mk(0.52 * g(A.digging) + 0.18 * g(A.agility) + 0.15 * g(A.balance) + 0.15 * g(A.flexibility)),
    setting: mk(0.62 * g(A.setting) + 0.2 * control + 0.18 * g(A.concentration)),
    block: mk(0.6 * g(A.blocking) + 0.22 * g(A.verticalJump) + 0.18 * g(A.balance)) + blockReachBonus,

    attackPower: mk(0.45 * technique + 0.3 * athleticism + 0.25 * g(A.servingPower)) + spikeReachBonus,
    attackControl: mk(0.55 * technique + 0.3 * control + 0.15 * g(A.composure)),
    quickAttack: mk(0.6 * g(A.quickAttack) + 0.22 * athleticism + 0.18 * technique) + spikeReachBonus * 0.8,
    backRowAttack: mk(0.6 * g(A.backRowAttack) + 0.25 * athleticism + 0.15 * technique),
    pipeAttack: mk(0.6 * g(A.pipeAttack) + 0.25 * athleticism + 0.15 * technique),

    spikeReachEdge: spikeEdge,
    blockReachEdge: blockEdge,

    stamina: n(at[b + A.stamina]),
    recovery: n(at[b + A.recovery]),
    composure: n(at[b + A.composure]),
    concentration: n(at[b + A.concentration]),
    consistency: n(at[b + A.consistency]),
    bigMatch: n(at[b + A.bigMatchPerformance]),
    leadership: n(at[b + A.leadership]),
    teamwork: n(at[b + A.teamwork]),

    fatigue: 1,
    confidence: 1,
  };
}

/**
 * Logistic contest. `scale` controls how decisive a rating gap is; smaller
 * scale means more deterministic outcomes.
 */
export function contest(a: number, b: number, scale = 14): number {
  return 1 / (1 + Math.exp(-(a - b) / scale));
}

/**
 * Apply a player's live modifiers to a base rating.
 *
 * Consistency governs how much random variance a player shows contact to
 * contact: an inconsistent player has a wider spread around their true level,
 * which is exactly what makes them frustrating to rely on.
 */
export function live(p: PlayerMatchRatings, base: number, noise: number): number {
  const variance = (1 - p.consistency) * 16;
  return base * p.fatigue * p.confidence + noise * variance;
}
