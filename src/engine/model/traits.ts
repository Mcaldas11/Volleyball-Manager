/**
 * Player traits: the habits that make a player who he is on court, beyond his
 * numbers — the outside who wants the pipe, the setter who runs the floor,
 * the libero who digs everything.
 *
 * A trait nudges the skill it is about by a few per cent and, for a hitter's
 * favourite ball, how often the setter gives it to him; a vocal leader counts
 * for more in the dressing room. Each comes with the attributes behind it: a
 * player earns his as those grow — rolled on his own dice, once at his
 * creation and again each summer, so the world's are untouched — and keeps
 * them. Three at most.
 */

import { Rng } from '../core/rng.ts';
import { ATTR_COUNT, ATTR_INDEX, type AttributeName } from './attributes.ts';
import type { PlayerStore } from './players.ts';
import { Position } from './positions.ts';

export enum Trait {
  JumpServer = 0,
  FloatSpecialist = 1,
  PipeHitter = 2,
  QuickHitter = 3,
  Tooler = 4,
  ReadBlocker = 5,
  FloorGeneral = 6,
  DigMachine = 7,
  RockInReception = 8,
  Clutch = 9,
  Tireless = 10,
  VocalLeader = 11,
}

export const TRAITS: readonly Trait[] = [
  Trait.JumpServer, Trait.FloatSpecialist, Trait.PipeHitter, Trait.QuickHitter, Trait.Tooler, Trait.ReadBlocker,
  Trait.FloorGeneral, Trait.DigMachine, Trait.RockInReception, Trait.Clutch, Trait.Tireless, Trait.VocalLeader,
];

export const TRAIT_NAMES: Readonly<Record<Trait, string>> = {
  [Trait.JumpServer]: 'Big jump server',
  [Trait.FloatSpecialist]: 'Float specialist',
  [Trait.PipeHitter]: 'Loves the pipe',
  [Trait.QuickHitter]: 'Quick-attack specialist',
  [Trait.Tooler]: 'Tools the block',
  [Trait.ReadBlocker]: 'Reads the setter',
  [Trait.FloorGeneral]: 'Floor general',
  [Trait.DigMachine]: 'Digs everything',
  [Trait.RockInReception]: 'Rock in reception',
  [Trait.Clutch]: 'Big-point player',
  [Trait.Tireless]: 'Tireless',
  [Trait.VocalLeader]: 'Vocal leader',
};

export const TRAIT_HINTS: Readonly<Record<Trait, string>> = {
  [Trait.JumpServer]: 'Goes up for the jump serve, and hits it harder than most.',
  [Trait.FloatSpecialist]: 'His float serve dips and swerves — and lands where he wants it.',
  [Trait.PipeHitter]: 'Wants the ball in the pipe from the back row, and gets it more often.',
  [Trait.QuickHitter]: 'Fast off the floor for the quick — the setter looks for him.',
  [Trait.Tooler]: 'Uses the block rather than hitting into it: fewer of his attacks come back.',
  [Trait.ReadBlocker]: 'Reads the setter, not the ball — he is there when the attack comes.',
  [Trait.FloorGeneral]: 'Runs the offence: his sets are cleaner, his choices sharper.',
  [Trait.DigMachine]: 'Gets a hand to everything in defence.',
  [Trait.RockInReception]: 'Takes the serve on the forearms without a flicker.',
  [Trait.Clutch]: 'At his best when the set is on the line.',
  [Trait.Tireless]: 'Plays the fifth set as he played the first.',
  [Trait.VocalLeader]: 'Talks his team through it — he counts for more in the dressing room.',
};

/** Most traits one player carries. */
export const MAX_TRAITS = 3;

/** What a trait takes: the positions it belongs to (none listed: any), and the attributes behind it. */
const NEEDS: Readonly<Record<Trait, { positions?: readonly Position[]; attrs: readonly AttributeName[] }>> = {
  [Trait.JumpServer]: { attrs: ['jumpServe', 'servingPower'] },
  [Trait.FloatSpecialist]: { attrs: ['floatServe', 'servingAccuracy'] },
  [Trait.PipeHitter]: { positions: [Position.OutsideHitter, Position.Opposite], attrs: ['pipeAttack', 'backRowAttack'] },
  [Trait.QuickHitter]: { positions: [Position.MiddleBlocker], attrs: ['quickAttack', 'acceleration'] },
  [Trait.Tooler]: { positions: [Position.OutsideHitter, Position.Opposite], attrs: ['spikeTechnique', 'ballControl'] },
  [Trait.ReadBlocker]: { positions: [Position.MiddleBlocker, Position.Opposite], attrs: ['blocking', 'concentration'] },
  [Trait.FloorGeneral]: { positions: [Position.Setter], attrs: ['setting', 'teamwork'] },
  [Trait.DigMachine]: { positions: [Position.Libero, Position.OutsideHitter], attrs: ['digging', 'agility'] },
  [Trait.RockInReception]: { positions: [Position.Libero, Position.OutsideHitter], attrs: ['reception', 'composure'] },
  [Trait.Clutch]: { attrs: ['bigMatchPerformance', 'pressureHandling'] },
  [Trait.Tireless]: { attrs: ['stamina', 'recovery'] },
  [Trait.VocalLeader]: { attrs: ['leadership', 'confidence'] },
};

export function hasTrait(mask: number, t: Trait): boolean {
  return (mask & (1 << t)) !== 0;
}

/** A player's traits, in order. */
export function traitsOf(store: PlayerStore, i: number): Trait[] {
  const mask = store.traits[i];
  return TRAITS.filter((t) => hasTrait(mask, t));
}

/** How far a player's attributes carry him towards a trait, 0-1: nothing at 11 on average, all at 17. */
export function traitClaim(store: PlayerStore, i: number, t: Trait): number {
  const need = NEEDS[t];
  if (need.positions !== undefined && !need.positions.includes(store.position[i] as Position)) return 0;
  const base = i * ATTR_COUNT;
  let sum = 0;
  for (const a of need.attrs) sum += store.attrs[base + ATTR_INDEX[a]];
  const avg = sum / need.attrs.length;
  return Math.max(0, Math.min(1, (avg - 11) / 6));
}

/**
 * Give a player the traits his attributes have earned him. His own dice say
 * how far each one has to come — the same throw every time he is looked at —
 * so a trait comes once his attributes are good enough, and stays.
 */
export function rollTraits(store: PlayerStore, i: number): void {
  const own = new Rng((store.id[i] * 2654435769 + 0x51ed270b) >>> 0);
  let mask = store.traits[i];
  let count = TRAITS.filter((t) => hasTrait(mask, t)).length;
  for (const t of TRAITS) {
    // Every throw is made, kept or not, so each trait's stays the same.
    const bar = 0.35 + own.float() * 0.6;
    if (count >= MAX_TRAITS || hasTrait(mask, t)) continue;
    if (traitClaim(store, i, t) >= bar) {
      mask |= 1 << t;
      count++;
    }
  }
  store.traits[i] = mask;
}
