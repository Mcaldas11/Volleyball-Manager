/**
 * Court geometry and rotation mechanics.
 *
 * Zones are numbered as in the rulebook, but stored 0-indexed:
 *
 *        NET
 *   [4]  [3]  [2]     <- front row, array indices 3, 2, 1
 *   [5]  [6]  [1]     <- back row,  array indices 4, 5, 0
 *
 * A rotation moves every player one step clockwise: zone 2 -> 1, 1 -> 6,
 * 6 -> 5, 5 -> 4, 4 -> 3, 3 -> 2. In this indexing that collapses to a single
 * left shift, `next[z] = prev[(z + 1) % 6]`, which is why the rally loop can
 * rotate a team in six assignments with no branching.
 */

import { Position } from '../model/positions.ts';

export const ZONE_SERVE = 0; // zone 1
export const FRONT_ROW_ZONES = [1, 2, 3] as const; // zones 2, 3, 4
export const BACK_ROW_ZONES = [0, 4, 5] as const; // zones 1, 5, 6

export const ZONE_LABELS = ['1', '2', '3', '4', '5', '6'] as const;

/** True if the given 0-indexed zone is a front-row zone. */
export function isFrontRow(zone: number): boolean {
  return zone >= 1 && zone <= 3;
}

/**
 * Rotate a court array one step clockwise, in place.
 */
export function rotate(court: Int32Array): void {
  const first = court[0];
  court[0] = court[1];
  court[1] = court[2];
  court[2] = court[3];
  court[3] = court[4];
  court[4] = court[5];
  court[5] = first;
}

/**
 * Rotation number as coaches speak of it: P1 through P6, named for the zone
 * the setter currently occupies. Returned 0-indexed, so P1 is 0.
 */
export function rotationOf(court: Int32Array, setterIdx: number): number {
  for (let z = 0; z < 6; z++) {
    if (court[z] === setterIdx) return z;
  }
  return 0;
}

/**
 * Where the libero may legally play.
 *
 * Under FIVB rules the libero cannot serve, so a middle blocker who rotates
 * into zone 1 with his side serving serves for himself — and goes on serving
 * for as long as his side keeps the serve. The moment it is lost he is just a
 * back-row player who isn't serving, and the libero comes on for him, to stay
 * through zones 6 and 5 until the middle rotates to the front again. So the
 * libero covers zones 5 and 6 — array indices 4 and 5 — always, and zone 1 —
 * index 0 — whenever his side is not serving.
 */
export function liberoCoversZone(zone: number, serving: boolean): boolean {
  return zone === 4 || zone === 5 || (zone === 0 && !serving);
}

/** The back-row zones in the order the libero takes a middle's place, should an odd lineup put two there. */
const LIBERO_ZONES = [5, 4, 0] as const;

/**
 * Resolve who is actually standing in a zone once the libero substitution is
 * applied. `serving` is whether the side serves the rally: a middle in zone 1
 * serves it, and otherwise makes way for the libero.
 *
 * `court` and `positions` take `ArrayLike<number>` rather than the engine's
 * own `Int32Array`/`Uint8Array` so the UI can call this with the plain
 * `number[]` snapshots it renders from — one substitution rule, shared by
 * the simulation and the court view, instead of the view re-deriving it.
 */
export function effectivePlayerAt(
  court: ArrayLike<number>,
  zone: number,
  positions: ArrayLike<number>,
  liberoIdx: number,
  serving: boolean,
): number {
  const p = court[zone];
  if (liberoIdx < 0 || !liberoCoversZone(zone, serving) || positions[p] !== Position.MiddleBlocker) return p;
  // He replaces one player: with two middles in the back row, the first of them.
  for (const z of LIBERO_ZONES) {
    if (z === zone) break;
    if (liberoCoversZone(z, serving) && positions[court[z]] === Position.MiddleBlocker) return p;
  }
  return liberoIdx;
}

/**
 * Build the reception unit: the players who will pass serve — a side not
 * serving, so with the libero on for a middle in zone 1 too.
 *
 * Standard professional practice is a three-passer system — the libero plus
 * both outside hitters — with the setter, opposite and middles hidden. When an
 * outside is front row they still pass, so the unit is usually libero + 2 OH.
 */
export function receptionUnit(
  court: Int32Array,
  positions: Uint8Array,
  liberoIdx: number,
  out: number[],
): number {
  let n = 0;
  for (let z = 0; z < 6 && n < 3; z++) {
    const p = effectivePlayerAt(court, z, positions, liberoIdx, false);
    const pos = positions[p] as Position;
    if (pos === Position.Libero || pos === Position.OutsideHitter) {
      out[n++] = p;
    }
  }
  // Degenerate lineups (an injury crisis, a youth side) may not field a full
  // passing unit; fall back to whoever is on the floor.
  for (let z = 0; z < 6 && n < 3; z++) {
    const p = effectivePlayerAt(court, z, positions, liberoIdx, false);
    if (out.indexOf(p) === -1) out[n++] = p;
  }
  return n;
}
