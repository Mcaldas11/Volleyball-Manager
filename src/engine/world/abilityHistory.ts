/**
 * Every player's ability as each season ended, for charting how he came on —
 * or went off. One small array of every player's ability a season, kept for
 * the last twenty.
 */

import type { World } from './world.ts';

/** Seasons kept. */
export const HISTORY_SEASONS = 20;

export interface AbilityHistory {
  /** The season each snapshot closed, oldest first. */
  seasons: number[];
  /** Each player's ability as it closed — 0 for anyone not yet in the world then. */
  values: Uint16Array[];
}

/** Note everyone's ability as the season closes. Called by the rollover, before the summer's ageing. */
export function recordAbilities(world: World): void {
  const store = world.players;
  const h = (world.abilityHistory ??= { seasons: [], values: [] });
  if (h.seasons[h.seasons.length - 1] === world.season) return;
  const snap = new Uint16Array(store.count);
  for (let i = 0; i < store.count; i++) snap[i] = Math.max(0, Math.min(65535, store.currentAbility[i]));
  h.seasons.push(world.season);
  h.values.push(snap);
  while (h.seasons.length > HISTORY_SEASONS) {
    h.seasons.shift();
    h.values.shift();
  }
}

/** A player's ability season by season, as each one closed — and now, this season so far. */
export function abilityTimeline(world: World, p: number): Array<{ season: number; ability: number; now?: true }> {
  const out: Array<{ season: number; ability: number; now?: true }> = [];
  const h = world.abilityHistory;
  if (h !== undefined) {
    h.seasons.forEach((season, i) => {
      const v = h.values[i];
      if (p < v.length && v[p] > 0) out.push({ season, ability: v[p] });
    });
  }
  out.push({ season: world.season, ability: world.players.currentAbility[p], now: true });
  return out;
}
