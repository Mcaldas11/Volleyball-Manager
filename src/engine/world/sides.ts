/**
 * A national side's id. A nation's senior team goes by the nation's own index
 * (into NATIONS); its youth teams by the same index lifted out of the way:
 * the U21s by YOUTH_OFFSET[21] above it, the U19s by YOUTH_OFFSET[19]. Every
 * part of the international game that takes a "nation" — tournaments, squads,
 * jobs, the matchday — takes a side, and so plays the youth teams too.
 */

import { NATIONS } from './nations.ts';

export type YouthAge = 21 | 19;
export const YOUTH_AGES: readonly YouthAge[] = [21, 19];

const YOUTH_OFFSET: Readonly<Record<YouthAge, number>> = { 21: 1000, 19: 2000 };

/** A nation's youth side. */
export function youthSide(nation: number, age: YouthAge): number {
  return nation + YOUTH_OFFSET[age];
}

/** The nation a side belongs to. */
export function baseNation(side: number): number {
  if (side >= YOUTH_OFFSET[19]) return side - YOUTH_OFFSET[19];
  if (side >= YOUTH_OFFSET[21]) return side - YOUTH_OFFSET[21];
  return side;
}

/** The age a side is limited to — 0 for a senior side. */
export function sideAge(side: number): 0 | YouthAge {
  if (side >= YOUTH_OFFSET[19]) return 19;
  if (side >= YOUTH_OFFSET[21]) return 21;
  return 0;
}

export function isYouthSide(side: number): boolean {
  return side >= YOUTH_OFFSET[21];
}

/** "U21", "U19" — or "" for the seniors. */
export function sideSuffix(side: number): string {
  const age = sideAge(side);
  return age === 0 ? '' : `U${age}`;
}

/** A side's name: "Italy", "Italy U21". */
export function sideName(side: number): string {
  const name = NATIONS[baseNation(side)]?.name ?? '?';
  const age = sideAge(side);
  return age === 0 ? name : `${name} U${age}`;
}

/** A side's short code: "ITA", "ITA21". */
export function sideCode(side: number): string {
  const code = NATIONS[baseNation(side)]?.code ?? '?';
  const age = sideAge(side);
  return age === 0 ? code : `${code}${age}`;
}
