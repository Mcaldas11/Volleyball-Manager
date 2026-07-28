/**
 * Long-term progression: development, ageing, injuries, retirement, regens.
 *
 * This is what makes a fifty-season career different from fifty separate
 * seasons. Players improve toward a potential that is itself uncertain and can
 * be revised; they peak, decline, and retire; and the world replaces them with
 * a new generation drawn from the same national distributions, so that forty
 * years in, none of the original players remain but the world still looks like
 * a volleyball world.
 *
 * Development is deliberately *not* a straight climb toward potential. Playing
 * time, coaching, facilities and personality all gate it, which is why a
 * wonderkid rotting on a bench is a genuine waste and why a good youth setup
 * is worth paying for.
 */

import type { Rng } from '../core/rng.ts';
import {
  AGE_DECAY_WEIGHT, ATTRIBUTES, LATE_GROWTH_WEIGHT, type AttributeName,
} from '../model/attributes.ts';
import { AGEING_RESISTANCE, abilityFractionAtAge, refreshAbility, weightsFor } from '../model/ability.ts';
import { ATTR_INDEX } from '../model/attributes.ts';
import { InjuryType, PlayerFlag, type PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { StaffRole, staffRating } from '../model/staff.ts';
import type { SeasonStats } from '../season/seasonEngine.ts';
import { NATIONS } from './nations.ts';
import { estimateValue, generatePlayer, rollPotential } from './playerGen.ts';
import { DAYS_PER_SEASON, type World } from './world.ts';

/** Injuries a player can pick up, with duration in days and severity. */
interface InjuryDef {
  type: InjuryType;
  minDays: number;
  maxDays: number;
  /** Permanent ability cost on recovery, as a fraction of current ability. */
  permanentCost: number;
  weight: number;
}

/**
 * Volleyball's injury profile is distinctive: shoulders and knees from the
 * jumping and hitting load, fingers from blocking, ankles from landing under
 * the net. ACL and Achilles ruptures are rare but career-altering, which is
 * why their permanent cost is so much higher than everything else.
 */
const INJURIES: readonly InjuryDef[] = [
  { type: InjuryType.Fatigue, minDays: 3, maxDays: 10, permanentCost: 0, weight: 30 },
  { type: InjuryType.AnkleSprain, minDays: 7, maxDays: 35, permanentCost: 0.002, weight: 24 },
  { type: InjuryType.FingerFracture, minDays: 14, maxDays: 45, permanentCost: 0.003, weight: 14 },
  { type: InjuryType.Shoulder, minDays: 21, maxDays: 120, permanentCost: 0.018, weight: 16 },
  { type: InjuryType.Back, minDays: 14, maxDays: 90, permanentCost: 0.015, weight: 10 },
  { type: InjuryType.KneeCartilage, minDays: 40, maxDays: 160, permanentCost: 0.030, weight: 5 },
  { type: InjuryType.AchillesTear, minDays: 180, maxDays: 300, permanentCost: 0.075, weight: 0.6 },
  { type: InjuryType.ACLTear, minDays: 200, maxDays: 330, permanentCost: 0.085, weight: 0.9 },
];

/**
 * Roll for injuries across the world. Called once per week of the season
 * rather than per match, so the cost does not scale with fixture volume.
 */
export function rollInjuries(world: World): void {
  const store = world.players;
  const rng = world.rng;
  const medical = new Float64Array(world.clubs.length);
  for (const c of world.clubs) medical[c.id] = 1.25 - (c.medicalFacilities / 20) * 0.5;

  const weights = INJURIES.map((i) => i.weight);

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.injuryDaysLeft[i] > 0) continue;
    const club = store.clubId[i];
    if (club < 0) continue;

    const age = store.ageOn(i, world.year, 181);
    const proneness = store.getAttr(i, 'injuryProneness') / 20;
    const durability = store.getAttr(i, 'durability') / 20;
    const fatigue = 1 - store.condition[i] / 100;

    // Base weekly risk, modulated by the things that actually drive it.
    const risk =
      0.0075 *
      (0.55 + proneness * 1.1) *
      (1.35 - durability * 0.7) *
      (1 + fatigue * 1.3) *
      (age > 30 ? 1 + (age - 30) * 0.07 : 1) *
      medical[club];

    if (!rng.chance(risk)) continue;

    const def = INJURIES[rng.weightedIndex(weights)];
    const days = rng.int(def.minDays, def.maxDays);
    store.injuryDaysLeft[i] = days;
    store.injuryType[i] = def.type;
    store.setFlag(i, PlayerFlag.Injured, true);
    store.morale[i] = Math.max(10, store.morale[i] - rng.int(5, 20));

    // Serious injuries take something permanent out of a career.
    if (def.permanentCost > 0) {
      applyPermanentInjuryCost(store, i, def.permanentCost, rng);
    }
  }
}

/**
 * A long injury does not merely cost time — it costs ceiling. Potential is
 * reduced, and explosive physical attributes take the damage first, which is
 * why a knee injury ends more careers than a shoulder does.
 */
function applyPermanentInjuryCost(
  store: PlayerStore,
  i: number,
  cost: number,
  rng: Rng,
): void {
  store.potentialAbility[i] = Math.round(store.potentialAbility[i] * (1 - cost));
  const physical: AttributeName[] = ['verticalJump', 'acceleration', 'agility', 'durability', 'stamina'];
  for (const attr of physical) {
    if (rng.chance(0.55)) {
      store.setAttr(i, attr, store.getAttr(i, attr) - rng.int(1, Math.max(1, Math.round(cost * 40))));
    }
  }
  refreshAbility(store, i);
}

/**
 * Weekly training. Small, frequent nudges toward the player's ceiling.
 */
export function weeklyTraining(world: World): void {
  const store = world.players;
  const rng = world.rng;
  const coaching = coachingQualityByClub(world);

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    const club = store.clubId[i];
    if (club < 0) continue;
    // Injured players cannot train, and lose sharpness.
    if (store.injuryDaysLeft[i] > 0) {
      store.condition[i] = Math.max(30, store.condition[i] - 1);
      continue;
    }

    const age = store.ageOn(i, world.year, 181);
    const ca = store.currentAbility[i];
    const pa = store.potentialAbility[i];
    const ceiling = pa * abilityFractionAtAge(age);

    // Personality decides how much of the available improvement is captured.
    const professionalism = store.getAttr(i, 'professionalism') / 20;
    const workEthic = store.getAttr(i, 'workEthic') / 20;
    const coachability = store.getAttr(i, 'coachability') / 20;
    const determination = store.getAttr(i, 'determination') / 20;
    const drive = 0.25 + (professionalism + workEthic + coachability + determination) / 4 * 0.95;

    const facilities = world.clubs[club].trainingFacilities / 20;
    const quality = 0.45 + coaching[club] * 0.6 + facilities * 0.35;

    const gap = ceiling - ca;
    // Weekly movement is tiny; a season of it is what shows.
    const rate = gap > 0 ? 0.012 : 0.006;
    const delta = gap * rate * drive * quality + rng.gaussian(0, 0.7);

    if (Math.abs(delta) < 0.05) continue;
    applyAbilityDelta(store, i, delta, age, rng);
  }
}

function coachingQualityByClub(world: World): Float64Array {
  const out = new Float64Array(world.clubs.length);
  for (const club of world.clubs) {
    let best = 6;
    for (const sid of club.staff) {
      const s = world.staff[sid];
      if (s === undefined) continue;
      if (s.role === StaffRole.AssistantCoach || s.role === StaffRole.HeadCoach ||
          s.role === StaffRole.StrengthCoach || s.role === StaffRole.YouthCoach) {
        best = Math.max(best, staffRating(s));
      }
    }
    out[club.id] = best / 20;
  }
  return out;
}

/**
 * Translate a change in ability into changes in actual attributes.
 *
 * Improvement goes preferentially into the attributes that matter for the
 * player's position and that have room left. Decline takes the explosive
 * physical qualities first and leaves technique and reading largely intact,
 * which is why veteran setters and liberos stay useful long after the
 * opposites they came through with have retired.
 */
function applyAbilityDelta(
  store: PlayerStore,
  i: number,
  deltaCA: number,
  age: number,
  rng: Rng,
): void {
  const pos = store.position[i] as Position;
  const w = weightsFor(pos);
  const improving = deltaCA > 0;
  // Roughly how many attribute points correspond to this ability change.
  const steps = Math.min(6, Math.max(1, Math.round(Math.abs(deltaCA) / 8)));

  for (let s = 0; s < steps; s++) {
    const candidates: number[] = [];
    const weights: number[] = [];

    for (let a = 0; a < ATTRIBUTES.length; a++) {
      const name = ATTRIBUTES[a];
      const value = store.attrs[i * ATTRIBUTES.length + a];
      if (improving) {
        if (value >= 20) continue;
        // Positional relevance, plus a late-career bias toward the technical
        // and mental attributes that keep improving past physical peak.
        let weight = w[a];
        if (age >= 28) weight += (LATE_GROWTH_WEIGHT[name] ?? 0) * 1.4;
        if (weight <= 0) continue;
        candidates.push(a);
        weights.push(weight * (20 - value) / 19);
      } else {
        if (value <= 1) continue;
        const decay = AGE_DECAY_WEIGHT[name] ?? 0.12;
        if (decay <= 0) continue;
        candidates.push(a);
        weights.push(decay * (value / 20));
      }
    }

    if (candidates.length === 0) break;
    const pick = candidates[rng.weightedIndex(weights)];
    const base = i * ATTRIBUTES.length + pick;
    store.attrs[base] = Math.max(1, Math.min(20, store.attrs[base] + (improving ? 1 : -1)));
  }

  refreshAbility(store, i);
}

/**
 * Annual ageing, applied at the season rollover.
 */
export function applyAgeing(world: World): void {
  const store = world.players;
  const rng = world.rng;

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    const age = store.ageOn(i, world.year, 181);
    if (age < 29) continue;

    const pos = store.position[i] as Position;
    const resistance = AGEING_RESISTANCE[pos];
    const durability = store.getAttr(i, 'durability') / 20;
    const professionalism = store.getAttr(i, 'professionalism') / 20;

    // The decline curve steepens sharply in the mid-thirties.
    const severity = Math.pow(Math.max(0, age - 28), 1.5) * 1.9 * resistance;
    const mitigation = 0.62 + durability * 0.28 + professionalism * 0.22;
    const loss = severity / mitigation * rng.range(0.7, 1.3);

    if (loss > 0.5) applyAbilityDelta(store, i, -loss, age, rng);
  }
}

/**
 * Retirement.
 *
 * Driven by age, how far a player has fallen from their peak, and the hidden
 * Retirement Preference attribute. Players who are still good rarely retire;
 * players whose ability has collapsed do so quickly, whatever their age.
 */
export function processRetirements(world: World): number[] {
  const store = world.players;
  const rng = world.rng;
  const retiredNow: number[] = [];

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    const age = store.ageOn(i, world.year, 181);

    // Players who spent a full season without finding a club mostly leave the
    // sport, whatever their age. Without this the world silently accumulates
    // every academy player ever released, and the active population grows
    // without bound across a long career.
    if (store.clubId[i] < 0 && !store.hasFlag(i, PlayerFlag.Youth) && age >= 19) {
      // The better the player, the more likely someone eventually calls.
      const quality = store.currentAbility[i] / 2000;
      const persistence = store.getAttr(i, 'determination') / 20;
      const stays = Math.min(0.85, quality * 1.5 + persistence * 0.18);
      if (rng.chance(1 - stays)) {
        retirePlayer(world, i);
        retiredNow.push(i);
      }
      continue;
    }

    if (age < 29) continue;

    const preference = store.getAttr(i, 'retirementPreference') / 20;
    const ca = store.currentAbility[i];
    const peak = store.potentialAbility[i];
    const decline = peak > 0 ? 1 - ca / peak : 0;

    // Base hazard by age, shifted by how long this player intends to go on.
    let p = Math.max(0, (age - 30) * 0.055) + Math.max(0, decline - 0.15) * 0.75;
    p *= 1.45 - preference * 0.9;
    // Nobody plays past the very end.
    if (age >= 40) p = Math.max(p, 0.55);
    if (age >= 43) p = 1;
    // A player without a club for a season is far more likely to stop.
    if (store.clubId[i] < 0) p += 0.3;

    if (rng.chance(Math.min(1, p))) {
      retirePlayer(world, i);
      retiredNow.push(i);
    }
  }
  return retiredNow;
}

export function retirePlayer(world: World, i: number): void {
  const store = world.players;
  store.setFlag(i, PlayerFlag.Retired, true);
  store.retiredYear[i] = world.year;
  const club = store.clubId[i];
  if (club >= 0) {
    const c = world.clubs[club];
    c.players = c.players.filter((p) => p !== i);
    c.youthPlayers = c.youthPlayers.filter((p) => p !== i);
  }
  store.clubId[i] = -1;
  world.retired.push(i);
}

/**
 * Annual youth intake.
 *
 * Every club produces a handful of prospects each year, their quality set by
 * the club's youth recruitment reach, its facilities, and the strength of its
 * nation's volleyball culture. The tail is deliberately long and thin: a
 * genuine future international should be a rare and memorable event, not an
 * annual occurrence.
 */
export function generateYouthIntake(world: World): number[] {
  const store = world.players;
  const rng = world.rng;
  const created: number[] = [];

  for (const club of world.clubs) {
    const nation = NATIONS[club.nation];
    const count = 1 + Math.round((club.youthRecruitment / 20) * 3 * rng.range(0.6, 1.4));

    for (let n = 0; n < count; n++) {
      // Recruitment reach and facilities raise the ceiling of what turns up.
      const reach = club.youthRecruitment / 20;
      const facilities = club.youthFacilities / 20;
      const eliteBias = 0.72 + reach * 0.34 + facilities * 0.18;

      // The rare "golden generation" prospect.
      const golden = rng.chance(0.006 * (0.4 + reach));
      const potential = rollPotential(
        rng,
        nation.strength,
        golden ? eliteBias * 1.55 : eliteBias,
      );

      const idx = generatePlayer(store, rng, {
        nation: club.nation,
        age: rng.int(15, 18),
        potential,
        currentYear: world.year,
        isRegen: true,
      });
      store.clubId[idx] = club.id;
      store.setFlag(idx, PlayerFlag.Youth, true);
      store.contractUntil[idx] = world.day + rng.int(2, 4) * DAYS_PER_SEASON;
      store.wage[idx] = Math.round(8_000 + (club.reputation / 10000) * 30_000);
      club.youthPlayers.push(idx);
      created.push(idx);
    }
  }
  return created;
}

/**
 * Potential is dynamic.
 *
 * A young player who has been developing faster than expected has their
 * ceiling revised upward; one who has stalled has it revised down. This is
 * what makes scouting a judgement rather than a lookup — the number a scout
 * is estimating is itself moving.
 */
export function revisePotential(world: World, seasonStats: SeasonStats): void {
  const store = world.players;
  const rng = world.rng;

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    const age = store.ageOn(i, world.year, 181);
    if (age > 25 || age < 16) continue;

    const line = seasonStats.get(i);
    const played = line?.matches ?? 0;
    const expected = store.potentialAbility[i] * abilityFractionAtAge(age);
    const actual = store.currentAbility[i];
    const surplus = (actual - expected) / Math.max(1, store.potentialAbility[i]);

    let delta = surplus * 240 * rng.range(0.5, 1.5);
    // Playing regularly at a high level is itself evidence of a higher ceiling.
    if (played >= 15) delta += rng.range(0, 28);
    else if (played <= 2) delta -= rng.range(0, 22);

    const next = Math.round(store.potentialAbility[i] + delta);
    store.potentialAbility[i] = Math.max(actual, Math.min(1990, next));
  }
}

/** Refresh every player's market value and wage demand. */
export function revalueSquads(world: World): void {
  const store = world.players;
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    const age = store.ageOn(i, world.year, 181);
    store.value[i] = estimateValue(store, i, age);
    store.reputation[i] = Math.round(
      Math.min(10000, (store.currentAbility[i] / 2000) ** 1.6 * 9000),
    );
  }
  void ATTR_INDEX;
}
