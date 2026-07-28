/**
 * Player generation.
 *
 * Produces the fictional players who fill the world at the start of a career
 * and every regen born into it afterwards. The goal is that a generated squad
 * list is indistinguishable, in its shape, from a real one: middles are tall
 * and block well and cannot pass, liberos are short and are the best defenders
 * on the floor, and the distribution of quality across a league is skewed —
 * a handful of stars, a broad middle, and a long tail.
 */

import type { Rng } from '../core/rng.ts';
import {
  ATTR_COUNT, ATTR_INDEX, HIDDEN_ATTRS, type AttributeName,
} from '../model/attributes.ts';
import { abilityFractionAtAge, weightsFor } from '../model/ability.ts';
import { computeCurrentAbility } from '../model/ability.ts';
import { PlayerFlag, type PlayerStore } from '../model/players.ts';
import { PLAUSIBLE_SECONDARY, Position } from '../model/positions.ts';
import { NATIONS } from './nations.ts';
import { bankFor } from './names.ts';

/** Natural distribution of positions in a talent pool. */
const POSITION_WEIGHTS = [0.16, 0.16, 0.30, 0.24, 0.14];

/** Mean height in cm by position for a top-flight men's squad. */
const HEIGHT_MEAN: Readonly<Record<Position, number>> = {
  [Position.Setter]: 192,
  [Position.Opposite]: 201,
  [Position.OutsideHitter]: 197,
  [Position.MiddleBlocker]: 205,
  [Position.Libero]: 183,
};

const HEIGHT_SD = 5.2;

export interface PlayerGenOptions {
  nation: number;
  age: number;
  /** Target Potential Ability, 0-2000. */
  potential: number;
  position?: Position;
  currentYear: number;
  isRegen?: boolean;
  /** Overrides the age-derived current ability fraction. */
  abilityFraction?: number;
}

/**
 * Create one player and return their store index.
 */
export function generatePlayer(store: PlayerStore, rng: Rng, opts: PlayerGenOptions): number {
  const i = store.create();
  const nationDef = NATIONS[opts.nation] ?? NATIONS[0];

  const position = opts.position ?? (rng.weightedIndex(POSITION_WEIGHTS) as Position);
  store.position[i] = position;
  store.nation[i] = opts.nation;

  // ---- Identity ----
  const bank = bankFor(nationDef.nameGroup);
  store.firstName[i] = store.names.intern(rng.pick(bank.first));
  store.lastName[i] = store.names.intern(rng.pick(bank.last));
  store.birthYear[i] = opts.currentYear - opts.age;
  store.birthDay[i] = rng.int(0, 364);

  // ---- Physique ----
  // Better players are, on average, slightly better built for the position;
  // the correlation is real but weak, since technique separates elite players
  // far more than centimetres do.
  const levelBias = (opts.potential / 2000 - 0.5) * 2.4;
  const height = Math.round(
    rng.gaussianClamped(
      HEIGHT_MEAN[position] + nationDef.heightBias + levelBias,
      HEIGHT_SD,
      HEIGHT_MEAN[position] - 15,
      HEIGHT_MEAN[position] + 16,
    ),
  );
  store.heightCm[i] = height;
  store.weightKg[i] = Math.round((height / 100) ** 2 * rng.gaussianClamped(22.9, 1.2, 19, 27));

  // ---- Attributes ----
  const targetCA = Math.round(
    opts.potential * (opts.abilityFraction ?? abilityFractionAtAge(opts.age)),
  );
  fitAttributes(store, rng, i, position, height, targetCA);
  generateHiddenAttributes(store, rng, i, opts.age);

  store.potentialAbility[i] = Math.max(opts.potential, store.currentAbility[i]);

  // ---- Secondary position ----
  // Roughly a quarter of professionals have a genuine second position, usually
  // one they came through the youth system playing.
  if (rng.chance(0.24)) {
    const options = PLAUSIBLE_SECONDARY[position];
    store.secondary[i] = rng.pick(options);
  }

  // ---- Career state ----
  store.condition[i] = rng.int(88, 100);
  store.morale[i] = rng.int(50, 80);
  store.form[i] = 0;
  if (opts.isRegen) store.setFlag(i, PlayerFlag.Regen, true);
  if (opts.age < 20) store.setFlag(i, PlayerFlag.Youth, true);

  store.reputation[i] = Math.round(
    Math.min(10000, (store.currentAbility[i] / 2000) ** 1.6 * 9000 * rng.range(0.85, 1.15)),
  );
  store.value[i] = estimateValue(store, i, opts.age);
  store.wage[i] = Math.round((store.value[i] * 0.22) / 1000) * 1000;

  return i;
}

/**
 * Choose attribute values that both fit the positional profile and add up to
 * the requested ability.
 *
 * The profile is drawn first — a shape, not a level — then scaled by a single
 * factor found by bisection so that the resulting Current Ability lands on
 * target. Doing it this way means a 1200-CA middle and a 1700-CA middle have
 * recognisably the same *kind* of attribute spread, just at different levels,
 * which is how real players differ.
 */
function fitAttributes(
  store: PlayerStore,
  rng: Rng,
  i: number,
  position: Position,
  height: number,
  targetCA: number,
): void {
  const w = weightsFor(position);
  const base = i * ATTR_COUNT;
  const shape = new Float64Array(ATTR_COUNT);
  const level = Math.min(1, targetCA / 2000);

  for (let a = 0; a < ATTR_COUNT; a++) {
    if (w[a] === 0) {
      // Attributes that do not count toward this position's ability still need
      // a real value: a libero who never blocks still has a vertical jump, and
      // the match engine and reach calculation both read it. Leaving these
      // unset would leave zeros, which is outside the legal 1-20 range.
      // They are generated low but plausible, and are excluded from the
      // ability fit below so they cannot inflate a player's rating.
      store.attrs[base + a] = Math.round(
        1 + 19 * Math.min(1, Math.max(0.03, rng.gaussian(level * 0.58, 0.11))),
      );
      continue;
    }
    // Important attributes cluster high, marginal ones scatter low.
    shape[a] = Math.min(1, Math.max(0.04, rng.gaussian(0.35 + w[a] * 0.6, 0.15)));
  }

  const applyScale = (k: number): number => {
    for (let a = 0; a < ATTR_COUNT; a++) {
      if (w[a] === 0) continue;
      const v = Math.min(1, Math.max(0.02, shape[a] * k));
      store.attrs[base + a] = Math.round(1 + 19 * v);
    }
    setReach(store, i, height, position);
    return computeCurrentAbility(store, i);
  };

  // Bisect on the scale factor. CA is monotonic in k, so this converges fast.
  let lo = 0.05;
  let hi = 2.6;
  for (let iter = 0; iter < 14; iter++) {
    const mid = (lo + hi) / 2;
    if (applyScale(mid) < targetCA) lo = mid;
    else hi = mid;
  }
  applyScale((lo + hi) / 2);
  store.currentAbility[i] = computeCurrentAbility(store, i);
}

/**
 * Derive spike and block reach from height and jumping ability.
 *
 * Standing reach runs about 1.30x height; a professional spike approach adds
 * 75-105cm on top, and a block jump from a standing start gives up roughly a
 * fifth of that. These are the numbers on an FIVB registration sheet, which is
 * why they are stored in centimetres rather than on the 1-20 scale.
 */
function setReach(store: PlayerStore, i: number, height: number, position: Position): void {
  let vj = store.attrs[i * ATTR_COUNT + ATTR_INDEX.verticalJump];
  // Liberos are not selected for jumping, so vertical jump carries no weight
  // in their ability — but they are still professional athletes, and their
  // recorded reach should reflect that rather than the low draw above.
  if (position === Position.Libero) vj = Math.max(vj, Math.round(8 + (vj / 20) * 8));
  const standingReach = height * 1.302;
  const jump = 52 + ((vj - 1) / 19) * 58;
  store.spikeReachCm[i] = Math.round(standingReach + jump);
  store.blockReachCm[i] = Math.round(standingReach + jump * 0.78);
}

/**
 * Hidden attributes: personality and durability.
 *
 * Professionalism, work ethic, determination and discipline are correlated —
 * they describe one underlying trait that coaches call being a pro — while
 * things like injury proneness and homesickness are independent. That
 * correlation is what produces recognisable player archetypes rather than
 * random noise.
 */
function generateHiddenAttributes(store: PlayerStore, rng: Rng, i: number, age: number): void {
  const core = rng.gaussianClamped(11.5, 3.6, 1, 20);
  const around = (mean: number, sd: number): number =>
    Math.round(rng.gaussianClamped(mean, sd, 1, 20));

  const set = (name: AttributeName, v: number): void => store.setAttr(i, name, v);

  set('professionalism', around(core, 2.6));
  set('workEthic', around(core, 2.8));
  set('discipline', around(core * 0.85 + 2, 3.0));
  set('adaptability', around(11, 3.4));
  set('aggression', around(11, 3.6));
  set('confidence', around(11.5, 3.2));

  for (const name of HIDDEN_ATTRS) {
    if (name === 'coachability') { set(name, around(core * 0.7 + 3.5, 3.0)); continue; }
    if (name === 'loyalty') { set(name, around(11, 4.0)); continue; }
    if (name === 'ambition') { set(name, around(core * 0.4 + 7, 3.6)); continue; }
    if (name === 'temperament') { set(name, around(core * 0.5 + 5.5, 3.4)); continue; }
    if (name === 'consistency') { set(name, around(core * 0.45 + 6.5, 3.0)); continue; }
    if (name === 'bigMatchPerformance') { set(name, around(10.5, 3.8)); continue; }
    if (name === 'injuryProneness') { set(name, around(8.5, 3.8)); continue; }
    if (name === 'homesickness') { set(name, around(9, 3.9)); continue; }
    if (name === 'mediaHandling') { set(name, around(10, 3.6)); continue; }
    if (name === 'retirementPreference') {
      // Roughly "how long they intend to keep playing"; drives retirement age.
      set(name, around(11 + (age > 30 ? -1.5 : 0), 3.5));
      continue;
    }
  }
}

/**
 * Market value.
 *
 * Volleyball is not football: transfer fees are small or absent and value is
 * dominated by wage-earning capacity. Value rises steeply with ability, is
 * boosted heavily by unrealised potential in young players, and collapses past
 * the mid-thirties.
 */
export function estimateValue(store: PlayerStore, i: number, age: number): number {
  const ca = store.currentAbility[i];
  const pa = store.potentialAbility[i];
  const level = ca / 2000;

  // Steep convexity: the top few hundred players in the world earn multiples
  // of what a solid first-division starter does.
  let value = Math.pow(level, 4.2) * 4_200_000;

  // Unrealised potential in a young player is itself an asset.
  const headroom = Math.max(0, pa - ca) / 2000;
  if (age <= 23) value *= 1 + headroom * 3.2;
  else if (age <= 26) value *= 1 + headroom * 1.3;

  // Age curve on top of ability.
  if (age <= 20) value *= 1.15;
  else if (age >= 34) value *= Math.max(0.12, 1 - (age - 33) * 0.24);
  else if (age >= 31) value *= 1 - (age - 30) * 0.1;

  return Math.max(2000, Math.round(value / 1000) * 1000);
}

/**
 * Draw a Potential Ability for a newly generated player from a nation.
 *
 * Talent is heavily skewed: a strong volleyball nation does not mainly produce
 * better average players, it produces a thicker tail of exceptional ones. The
 * lognormal-ish shape here is what makes finding a genuine superstar in a
 * youth intake rare and memorable.
 */
export function rollPotential(rng: Rng, nationStrength: number, eliteBias = 1): number {
  const base = 620 + nationStrength * 5.2;
  // Heavy right tail.
  const roll = Math.exp(rng.gaussian(0, 0.30)) * eliteBias;
  const pa = base * roll + rng.gaussian(0, 70);
  return Math.round(Math.min(1980, Math.max(320, pa)));
}
