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
 * Under FIVB rules the libero cannot serve, so when the middle blocker rotates
 * into zone 1 they must serve for themselves; the libero comes in one rotation
 * later. That means the libero covers zones 5 and 6 only — array indices 4 and
 * 5 — which is exactly what happens on a real court.
 */
export function liberoCoversZone(zone: number): boolean {
  return zone === 4 || zone === 5;
}

/**
 * Resolve who is actually standing in a zone once the libero substitution is
 * applied.
 */
export function effectivePlayerAt(
  court: Int32Array,
  zone: number,
  positions: Uint8Array,
  liberoIdx: number,
): number {
  const p = court[zone];
  if (liberoIdx >= 0 && liberoCoversZone(zone) && positions[p] === Position.MiddleBlocker) {
    return liberoIdx;
  }
  return p;
}

/**
 * Build the reception unit: the players who will pass serve.
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
    const p = effectivePlayerAt(court, z, positions, liberoIdx);
    const pos = positions[p] as Position;
    if (pos === Position.Libero || pos === Position.OutsideHitter) {
      out[n++] = p;
    }
  }
  // Degenerate lineups (an injury crisis, a youth side) may not field a full
  // passing unit; fall back to whoever is on the floor.
  for (let z = 0; z < 6 && n < 3; z++) {
    const p = effectivePlayerAt(court, z, positions, liberoIdx);
    if (out.indexOf(p) === -1) out[n++] = p;
  }
  return n;
}
