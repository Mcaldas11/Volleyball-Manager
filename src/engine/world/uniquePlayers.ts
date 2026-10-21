/**
 * Real people written into the game by hand: not drawn from the generator's dice but set down as
 * they are — name, birthday, height, position, attributes — and given their own photo (see the
 * UI's faces.ts). Each is put into every new world, and into a saved career that doesn't have him
 * yet, as a free agent.
 */

import { computeCurrentAbility } from '../model/ability.ts';
import { ATTR_COUNT, ATTR_INDEX, ATTRIBUTES, type AttributeName } from '../model/attributes.ts';
import { NO_CLUB, PlayerFlag } from '../model/players.ts';
import { Position, POSITIONS } from '../model/positions.ts';
import { rollTraits } from '../model/traits.ts';
import { estimateValue, rollOffHand } from './playerGen.ts';
import { nationIndex } from './nations.ts';
import type { World } from './world.ts';

export interface UniquePlayer {
  /** A key of his own, the same in every world. */
  key: string;
  firstName: string;
  lastName: string;
  nation: string;
  /** Born on: year, month (1-12) and day. */
  born: [number, number, number];
  heightCm: number;
  weightKg: number;
  position: Position;
  /** A second position he plays in full. */
  secondary?: Position;
  leftHanded?: boolean;
  /** Every attribute, 1-20 — whatever is left out is 10. */
  attrs: Partial<Record<AttributeName, number>>;
  /** How much better he can still get than he is now, in ability points. */
  growth: number;
}

/** Diogo Couto: a libero who can play on the outside, from Portugal. */
const DIOGO_COUTO: UniquePlayer = {
  key: 'diogo-couto',
  firstName: 'Diogo',
  lastName: 'Couto',
  nation: 'POR',
  born: [2005, 6, 24],
  heightCm: 184,
  weightKg: 76,
  position: Position.Libero,
  secondary: Position.OutsideHitter,
  attrs: {
    // Physical
    acceleration: 16, verticalJump: 14, agility: 17, balance: 16, flexibility: 16, stamina: 16, recovery: 16, durability: 15,
    // Technical: a libero's hands and platform first, enough of a hitter's game to play outside
    floatServe: 13, jumpServe: 11, powerServe: 11, setting: 14, reception: 18, digging: 18, blocking: 11,
    quickAttack: 11, backRowAttack: 13, pipeAttack: 13, servingAccuracy: 14, servingPower: 12, spikeTechnique: 14, ballControl: 17,
    // Mental
    leadership: 15, teamwork: 17, professionalism: 16, determination: 17, composure: 16, concentration: 17,
    aggression: 13, pressureHandling: 16, discipline: 16, confidence: 16, adaptability: 16, workEthic: 17,
    // Hidden
    injuryProneness: 6, loyalty: 15, ambition: 16, temperament: 15, mediaHandling: 13, consistency: 16,
    bigMatchPerformance: 16, homesickness: 8, coachability: 16, retirementPreference: 15,
  },
  growth: 160,
};

export const UNIQUE_PLAYERS: readonly UniquePlayer[] = [DIOGO_COUTO];

/** The day of the year, 0 for 1 January — as a player's birthday is kept. */
function dayOfYear(month: number, day: number): number {
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return before[month - 1] + day - 1;
}

/** Where a unique player is in this world's store, if he is. */
export function uniquePlayerIndex(world: World, key: string): number | undefined {
  const p = world.uniquePlayers?.[key];
  return p !== undefined && p < world.players.count ? p : undefined;
}

/** Put every unique player into a world that doesn't have him yet — a free agent. The men's game only. */
export function addUniquePlayers(world: World): void {
  const store = world.players;
  if (store.women) return;
  for (const def of UNIQUE_PLAYERS) {
    if (uniquePlayerIndex(world, def.key) !== undefined) continue;
    (world.uniquePlayers ??= {})[def.key] = createUnique(world, def);
  }
}

function createUnique(world: World, def: UniquePlayer): number {
  const store = world.players;
  const i = store.create();
  store.firstName[i] = store.names.intern(def.firstName);
  store.lastName[i] = store.names.intern(def.lastName);
  store.nation[i] = nationIndex(def.nation);
  store.birthYear[i] = def.born[0];
  store.birthDay[i] = dayOfYear(def.born[1], def.born[2]);
  store.heightCm[i] = def.heightCm;
  store.weightKg[i] = def.weightKg;
  store.position[i] = def.position;

  const base = i * ATTR_COUNT;
  for (const name of ATTRIBUTES) store.attrs[base + ATTR_INDEX[name]] = Math.max(1, Math.min(20, def.attrs[name] ?? 10));

  // Reach as the generator works it out: standing reach from height, the jump from the legs.
  const vj = store.attrs[base + ATTR_INDEX.verticalJump];
  const standing = def.heightCm * 1.302;
  const jump = 52 + ((vj - 1) / 19) * 58;
  store.spikeReachCm[i] = Math.round(standing + jump);
  store.blockReachCm[i] = Math.round(standing + jump * 0.78);

  // His other position known in full; next to nothing of the rest.
  for (const pos of POSITIONS) {
    if (pos === def.position) continue;
    store.setFamiliarity(i, pos, pos === def.secondary ? 100 : 5);
  }
  if (def.secondary !== undefined) store.secondary[i] = def.secondary;
  store.setFlag(i, PlayerFlag.LeftHanded, def.leftHanded === true);
  rollOffHand(store, i);

  store.currentAbility[i] = computeCurrentAbility(store, i);
  store.potentialAbility[i] = Math.min(2000, store.currentAbility[i] + def.growth);
  rollTraits(store, i);

  store.condition[i] = 100;
  store.morale[i] = 75;
  store.form[i] = 0;
  const age = store.ageOn(i, world.year, 181);
  if (age < 20) store.setFlag(i, PlayerFlag.Youth, true);
  store.reputation[i] = Math.round(Math.min(10000, (store.currentAbility[i] / 2000) ** 1.6 * 9000));
  store.value[i] = estimateValue(store, i, age);
  store.wage[i] = Math.round((store.value[i] * 0.22) / 1000) * 1000;

  // A free agent, waiting for a club.
  store.clubId[i] = NO_CLUB;
  store.contractUntil[i] = 0;
  return i;
}
