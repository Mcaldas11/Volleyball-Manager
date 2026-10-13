/**
 * The screens for the game the world plays: the women's game shows women's
 * faces, a net nineteen centimetres lower, a slower ball — so a "monster"
 * spike is a slower one — and speaks of its players as women.
 */

import { MONSTER_SPIKE_KMH } from '../engine/match/highlights.ts';
import { WOMEN_BALL_SPEED } from '../engine/match/engine.ts';
import { setNationsGame } from '../engine/world/nations.ts';
import { setFaceSet } from './faces.ts';
import { setNetHeight } from './matchCourt.ts';
import { setPronouns } from './pronouns.ts';

let women = false;

/** Set the screens up for a world's game. */
export function setUiGame(gender: 'men' | 'women'): void {
  women = gender === 'women';
  setNationsGame(gender);
  setFaceSet(women ? 'women' : 'men');
  setNetHeight(women ? 2.24 : 2.43);
  setPronouns(women);
}

/** Whether the women's game is on the screens. */
export function womensGame(): boolean {
  return women;
}

/** How fast a spike has to be put away to be a monster, in the game being played. */
export function monsterSpikeKmh(): number {
  return Math.round(MONSTER_SPIKE_KMH * (women ? WOMEN_BALL_SPEED : 1));
}
