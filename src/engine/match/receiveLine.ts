/**
 * Who takes the serve in a rotation, as the engine lines them up — for the
 * screens that let the coach choose. The libero, in for the back-row middle,
 * and the outsides; with two, the weaker-passing outside hidden; with four,
 * the opposite as well. The engine decides on the players' match ratings at
 * the time; this goes on their ratings as they stand.
 */

import type { PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { computeRatings } from './ratings.ts';
import type { ReceptionFormation } from './tactics.ts';

/** `zones` holds the player in each rotational zone, zone 1 first. */
export function receiveLineOf(store: PlayerStore, zones: readonly number[], libero: number, receivers: ReceptionFormation = 3): number[] {
  const back = (z: number): boolean => z === 0 || z >= 4;
  const onCourt = zones.map((p, z) => (libero >= 0 && back(z) && store.position[p] === Position.MiddleBlocker ? libero : p));
  const line = onCourt.filter((p) => store.position[p] === Position.Libero || store.position[p] === Position.OutsideHitter).slice(0, 3);
  if (receivers === 2 && line.length === 3 && line.includes(libero)) {
    const pass = (p: number): number => computeRatings(store, p, store.position[p] as Position).reception;
    const outsides = line.filter((p) => p !== libero);
    const hide = pass(outsides[0]) <= pass(outsides[1]) ? outsides[0] : outsides[1];
    return line.filter((p) => p !== hide);
  }
  if (receivers === 4 && line.length === 3) {
    const opposite = onCourt.find((p) => store.position[p] === Position.Opposite && !line.includes(p));
    if (opposite !== undefined) return [...line, opposite];
  }
  return line;
}
