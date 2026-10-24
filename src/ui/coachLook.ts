/**
 * The manager's look on the touchline: what can be chosen — outfits, colours, skin, hair, a beard,
 * glasses — and how it is dressed on the 3D figure that stands at the bench.
 */

import type { ManagerLook } from '../engine/world/world.ts';
import type { Kit, Look } from './figure3d.ts';

export const COACH_SKINS: readonly string[] = ['#f3d4b8', '#eac29d', '#dcaa80', '#c18a60', '#99653f', '#6e472c', '#553622'];

export const OUTFITS: ReadonlyArray<{ id: ManagerLook['outfit']; name: string; hint: string }> = [
  { id: 'suit', name: 'Suit', hint: 'Jacket, shirt and tie' },
  { id: 'shirt', name: 'Shirt & tie', hint: 'No jacket, sleeves down' },
  { id: 'tracksuit', name: 'Tracksuit', hint: 'Zipped top and trousers' },
  { id: 'polo', name: 'Polo', hint: 'Short sleeves, smart trousers' },
];

/** Colours for a jacket, a top or trousers. */
export const CLOTH_COLOURS: readonly string[] = [
  '#1b2130', '#22324f', '#2f3b52', '#3a3f47', '#5b616b', '#0e0f12', '#c7b89a', '#6b4b2e', '#7a1f2b', '#f2f3f5',
];
export const SHIRT_COLOURS: readonly string[] = ['#f4f6f8', '#cfe0f2', '#f4d7dc', '#e8e2d2', '#1d2026', '#8fa9c7'];
export const TIE_COLOURS: readonly string[] = ['#9b1f2e', '#1f3d7a', '#0f1218', '#d7a73f', '#2f6b45', '#6a2c7a', '#c0c4cc'];
export const SHOE_COLOURS: readonly string[] = ['#15181e', '#4a2e1a', '#f6f7f9'];
export const HAIR_COLOURS: readonly string[] = ['#16110d', '#2e1f16', '#4a3020', '#7a5230', '#b48a55', '#d8c08c', '#8c3b1e', '#9a9a9a', '#e8e6e1'];

/** As the career begins: a polo in the club's colours, as every coach has worn until now. */
export const DEFAULT_LOOK: ManagerLook = {
  outfit: 'polo', top: 'club', shirt: '#f4f6f8', tie: null, trousers: '#1b2130', shoes: '#15181e',
  skin: 2, hair: '#2e1f16', hairStyle: 1, beard: 0, glasses: false,
};

/** Dress the touchline figure: `kit` for the club's colours, `women` for a woman's frame. */
export function figureLook(look: ManagerLook, kit: Kit, women: boolean): Look {
  const top = look.top === 'club' ? kit.shirt : look.top;
  // The second colour for a polo's or a tracksuit's shoulders: the club's other one, or a light one on a dark top.
  const accent = look.top === 'club' ? kit.shorts : '#f2f3f5';
  const base = {
    libero: false, number: 0, skin: COACH_SKINS[Math.max(0, Math.min(COACH_SKINS.length - 1, look.skin))] ?? COACH_SKINS[2],
    hair: look.hair, hairStyle: look.hairStyle, trousers: true, women, beard: women ? 0 as const : look.beard,
    glasses: look.glasses, shoes: look.shoes,
  };
  switch (look.outfit) {
    case 'suit':
      return {
        ...base, kit: { shirt: top, shorts: look.trousers, libero: top }, trim: look.shirt, longSleeves: true,
        front: { kind: 'jacket', shirt: look.shirt, tie: look.tie },
      };
    case 'shirt':
      return {
        ...base, kit: { shirt: look.shirt, shorts: look.trousers, libero: look.shirt }, trim: look.shirt, longSleeves: true,
        front: { kind: 'shirt', tie: look.tie },
      };
    case 'tracksuit':
      return { ...base, kit: { shirt: top, shorts: look.trousers, libero: top }, trim: accent, longSleeves: true, front: { kind: 'zip' } };
    default:
      return { ...base, kit: { shirt: top, shorts: look.trousers, libero: top }, trim: accent, front: { kind: 'polo' } };
  }
}
