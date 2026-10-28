/**
 * The manager profile kept in this browser, made from the main menu: who you are — name, date of
 * birth, nation — and how you look on the touchline. It stands on the menu, and every new career
 * starts from it: filled in already, or, by a quick start, taken as it is.
 */

import { NATIONS } from '../engine/world/nations.ts';
import type { ManagerLook, ManagerProfile } from '../engine/world/world.ts';
import { DEFAULT_LOOK, OUTFITS } from './coachLook.ts';

const KEY = 'vm.managerProfile';

/** A look as it was kept: anything missing or broken from the default. */
function lookFrom(v: Partial<ManagerLook> | undefined): ManagerLook | undefined {
  if (v === undefined || v === null || typeof v !== 'object') return undefined;
  const str = (x: unknown, d: string): string => (typeof x === 'string' && x !== '' ? x : d);
  return {
    outfit: OUTFITS.some((o) => o.id === v.outfit) ? v.outfit! : DEFAULT_LOOK.outfit,
    top: str(v.top, DEFAULT_LOOK.top),
    shirt: str(v.shirt, DEFAULT_LOOK.shirt),
    tie: typeof v.tie === 'string' ? v.tie : null,
    trousers: str(v.trousers, DEFAULT_LOOK.trousers),
    shoes: str(v.shoes, DEFAULT_LOOK.shoes),
    skin: Number.isInteger(v.skin) ? v.skin! : DEFAULT_LOOK.skin,
    hair: str(v.hair, DEFAULT_LOOK.hair),
    hairStyle: v.hairStyle === 0 || v.hairStyle === 1 || v.hairStyle === 2 ? v.hairStyle : DEFAULT_LOOK.hairStyle,
    beard: v.beard === 1 || v.beard === 2 ? v.beard : 0,
    glasses: v.glasses === true,
  };
}

export function loadManagerProfile(): ManagerProfile | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<ManagerProfile>;
    if (typeof v.firstName !== 'string' || typeof v.lastName !== 'string' || v.firstName.trim() === '' || v.lastName.trim() === '') return null;
    return {
      firstName: v.firstName,
      lastName: v.lastName,
      birthYear: Number.isInteger(v.birthYear) ? v.birthYear! : 1985,
      birthDay: Number.isInteger(v.birthDay) ? Math.max(0, Math.min(364, v.birthDay!)) : 0,
      gender: v.gender === 'female' ? 'female' : 'male',
      nation: Number.isInteger(v.nation) && v.nation! >= 0 && v.nation! < NATIONS.length ? v.nation! : 0,
      look: lookFrom(v.look),
      portrait: typeof v.portrait === 'string' && v.portrait.startsWith('data:image/') ? v.portrait : undefined,
    };
  } catch {
    return null;
  }
}

export function saveManagerProfile(p: ManagerProfile): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage full or blocked: it lasts as long as the page.
  }
}
