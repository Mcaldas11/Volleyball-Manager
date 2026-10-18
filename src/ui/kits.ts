/**
 * What a club wears: its own kit if one has been designed (see the editor), else one made from its
 * colour — and, when two sides meet in kits too alike to tell apart, the away side in its change kit.
 */

import type { Club, ClubKit } from '../engine/model/club.ts';
import type { Kit } from './figure3d.ts';

/** A club's colour, as a hue: its designed one, or one made from its id — crest, theme and kit all share it. */
export function hueOf(club: Club): number {
  return club.kit?.hue ?? (club.id * 137.508) % 360;
}

/** The kit made from a hue. */
export function kitFromHue(h: number): Kit {
  return {
    shirt: `hsl(${h.toFixed(0)}, 62%, 50%)`,
    shorts: `hsl(${h.toFixed(0)}, 35%, 20%)`,
    libero: `hsl(${((h + 150) % 360).toFixed(0)}, 70%, 58%)`,
  };
}

/** A club's kit: as designed, or made from its colour. */
export function clubKit(club: Club): Kit {
  const k = club.kit;
  return k !== undefined ? { shirt: k.shirt, shorts: k.shorts, libero: k.libero } : kitFromHue(hueOf(club));
}

/** A designed kit's starting point: the one the club wears now. */
export function designFrom(club: Club): ClubKit {
  const k = clubKit(club);
  return { hue: hueOf(club), shirt: toHex(k.shirt), shorts: toHex(k.shorts), libero: toHex(k.libero) };
}

/** A colour as red, green and blue, 0-255 — from '#rrggbb' or 'hsl(h, s%, l%)'. */
export function rgbOf(c: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex !== null) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hsl = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(c);
  if (hsl !== null) {
    const h = Number(hsl[1]) / 360;
    const s = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t: number): number => {
      const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
      return Math.round(v * 255);
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  return [128, 128, 128];
}

export function toHex(c: string): string {
  const [r, g, b] = rgbOf(c);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** How far apart two colours look, roughly: 0 the same, about 440 black and white. */
export function colourDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  // Weighted the way the eye weighs them.
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2) / Math.sqrt(9) ;
}

/** Too close to tell apart across a court. */
const CLASH = 70;

/** The two sides' kits for a match: the home side's own; the away side's, or its change kit if they clash. */
export function matchKits(home: Kit, away: Kit, awayHue: number): [Kit, Kit] {
  if (colourDistance(home.shirt, away.shirt) >= CLASH) return [home, away];
  const change = kitFromHue((awayHue + 180) % 360);
  // A change kit that still clashes: white, as every club has.
  if (colourDistance(home.shirt, change.shirt) < CLASH) return [home, { shirt: '#f2f2f2', shorts: '#1c2230', libero: change.libero }];
  return [home, change];
}

/** The kits for two clubs meeting. */
export function clubMatchKits(home: Club | undefined, away: Club | undefined): [Kit, Kit] {
  const h = home !== undefined ? clubKit(home) : kitFromHue(210);
  const a = away !== undefined ? clubKit(away) : kitFromHue(20);
  return matchKits(h, a, away !== undefined ? hueOf(away) : 20);
}
