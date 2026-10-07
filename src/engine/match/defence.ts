/**
 * Where the defence stands behind the block — set by the coach for each kind
 * of attack: from the outside (the opposition's left pin, the defence's right),
 * from the middle, and from the opposite (their right pin, the defence's left).
 *
 * A layout places the three back-row defenders — left back (zone 5), middle
 * back (zone 6) and right back (zone 1) — and the front-row player who doesn't
 * block, who drops off the net. Positions are in the defending side's own
 * frame: `u` across the court from its own left (0) to its right (1) as its
 * players face the net, `v` depth from the net (0) to the end line (1).
 *
 * The layout matters. Every kind of shot comes down somewhere — the line deep
 * along the hitter's sideline, the cross to the far corner, the cut short by
 * the far sideline, the tip just behind the block — and a shot that lands
 * near a defender is dug far more often than one into an open court. The
 * engine weighs the layout against the shots a hitter from that side plays
 * and lifts or lowers the defence's chance of digging accordingly; and the
 * shots the points are won with go where the layout leaves holes.
 */

import type { Shot } from './engine.ts';

/** A point in the defending side's frame. */
export interface Spot {
  u: number;
  v: number;
}

/** Where an attack comes from: the outside (left pin), the middle, the opposite (right pin). */
export type AttackSource = 'oh' | 'mb' | 'opp';
export const ATTACK_SOURCES: readonly AttackSource[] = ['oh', 'mb', 'opp'];
export const ATTACK_SOURCE_NAMES: Readonly<Record<AttackSource, string>> = { oh: 'Outside', mb: 'Middle', opp: 'Opposite' };

/** The defence behind the block against one kind of attack. */
export interface DefenceLayout {
  /** Left back, zone 5. */
  lb: Spot;
  /** Middle back, zone 6. */
  mb: Spot;
  /** Right back, zone 1. */
  rb: Spot;
  /** The front-row player who doesn't block, off the net. */
  free: Spot;
}

export type DefenceLayouts = Record<AttackSource, DefenceLayout>;

/** Where the hitter is across the court, in the defending side's frame: the outside on its right, the opposite on its left. */
export function hitterAcross(source: AttackSource): number {
  return source === 'oh' ? 0.9 : source === 'opp' ? 0.1 : 0.46;
}

/**
 * Where a shot comes down, in the defending side's own frame — `hu` is where
 * the hitter is across the court in that frame, `r1` and `r2` (-1 to 1) vary
 * it. Down the line stays on the hitter's sideline, deep; the short line on
 * it at the 3 m line; cross-court goes to the far side; a cut is the sharpest
 * angle, short by the far sideline at the 3 m line; a tip drops just behind
 * the block; a roll shot into the open middle; a seam between the blockers;
 * the back row deep. Off the block, out wide or deep; a miss long or wide.
 */
export function shotSpot(shot: Shot, hu: number, r1: number, r2: number): Spot {
  const right = hu >= 0.5;
  const line = right ? 0.93 : 0.07;
  const far = right ? 0.07 : 0.93;
  const a1 = Math.abs(r1);
  const a2 = Math.abs(r2);
  switch (shot) {
    case 'line': return { u: line + r1 * 0.025, v: 0.8 + a2 * 0.15 };
    case 'shortLine': return { u: line + r1 * 0.02, v: 0.27 + a2 * 0.1 };
    case 'cross': return { u: right ? 0.12 + a1 * 0.22 : 0.88 - a1 * 0.22, v: 0.58 + a2 * 0.32 };
    case 'cut': return { u: far + (right ? a1 : -a1) * 0.05, v: 0.22 + a2 * 0.14 };
    case 'tip': return { u: hu + (0.5 - hu) * 0.4 + r1 * 0.08, v: 0.08 + a2 * 0.14 };
    case 'roll': return { u: 0.5 + r1 * 0.22, v: 0.42 + a2 * 0.18 };
    case 'seam': return { u: hu + (0.5 - hu) * 0.6 + r1 * 0.08, v: 0.48 + a2 * 0.25 };
    case 'deep': return { u: 0.5 + r1 * 0.38, v: 0.86 + a2 * 0.1 };
    case 'quick': return { u: hu + r1 * 0.22, v: 0.2 + a2 * 0.25 };
    case 'blockout': return r2 >= 0 ? { u: right ? 1.2 : -0.2, v: 0.35 + a1 * 0.8 } : { u: line, v: 1.28 + a1 * 0.15 };
    case 'long': return { u: r1 >= 0 ? line : 0.5 + (right ? -a2 : a2) * 0.35, v: 1.12 + a2 * 0.12 };
    case 'wide': return { u: r1 >= 0 ? (right ? 1.12 : -0.12) : (right ? -0.12 : 1.12), v: 0.4 + a2 * 0.5 };
    default: return { u: 0.5 + r1 * 0.3, v: 0.5 + a2 * 0.3 };
  }
}

/** The shots a defence has to cover from each side, and how often they come — the ones that stay in the court. */
export const COVER_SHOTS: Readonly<Record<AttackSource, ReadonlyArray<readonly [Shot, number]>>> = {
  oh: [['cross', 0.27], ['line', 0.18], ['shortLine', 0.07], ['cut', 0.1], ['tip', 0.1], ['roll', 0.07], ['seam', 0.13], ['deep', 0.08]],
  opp: [['cross', 0.27], ['line', 0.18], ['shortLine', 0.07], ['cut', 0.1], ['tip', 0.1], ['roll', 0.07], ['seam', 0.13], ['deep', 0.08]],
  mb: [['quick', 0.45], ['cut', 0.15], ['tip', 0.15], ['line', 0.12], ['seam', 0.13]],
};

/** Within this far (court widths — 1 is 9 m) a defender gets to a ball; it falls off to nothing beyond it. */
const REACH = 0.3;

/** Balls hit hard: only a defender behind where one lands — or not far in front of it — can dig it. */
const HARD: ReadonlySet<Shot> = new Set<Shot>(['cross', 'line', 'seam', 'deep', 'quick']);

/** How well a layout covers each shot from a side, 0 (wide open) to 1 (someone stands on it). */
export function coverage(layout: DefenceLayout, source: AttackSource): Map<Shot, number> {
  const hu = hitterAcross(source);
  const men = [layout.lb, layout.mb, layout.rb, layout.free];
  // The other pin who didn't block either, against a single block on the middle.
  if (source === 'mb') men.push({ u: 1 - layout.free.u, v: layout.free.v });
  const out = new Map<Shot, number>();
  for (const [shot] of COVER_SHOTS[source]) {
    const hard = HARD.has(shot);
    // A typical ball of the kind, and a little either side of it.
    let total = 0;
    for (const r1 of [-0.6, 0, 0.6]) {
      const s = shotSpot(shot, hu, r1, 0.5);
      let best = 0;
      for (const m of men) {
        // A hard ball is past a defender stood well in front of where it lands before he moves.
        if (hard && m.v < s.v - 0.12) continue;
        best = Math.max(best, 1 - Math.hypot(m.u - s.u, m.v - s.v) / REACH);
      }
      total += best;
    }
    out.set(shot, total / 3);
  }
  return out;
}

/**
 * How often each shot comes from a side, for a hitter of a given style — `style`
 * -1 for a pure power hitter, who hits through the court, to 1 for a pure
 * technician, who tips, cuts and places it.
 */
export function shotWeights(source: AttackSource, style = 0): Array<[Shot, number]> {
  const soft: ReadonlySet<Shot> = new Set<Shot>(['tip', 'cut', 'roll', 'shortLine']);
  return COVER_SHOTS[source].map(([shot, w]) => [shot, w * (soft.has(shot) ? 1 + 0.8 * style : 1 - 0.3 * style)]);
}

/** How much of what comes from a side a layout covers, 0-1, by how often each shot comes from this hitter. */
export function coverageScore(layout: DefenceLayout, source: AttackSource, style = 0): number {
  const cover = coverage(layout, source);
  let score = 0;
  let total = 0;
  for (const [shot, w] of shotWeights(source, style)) {
    score += w * (cover.get(shot) ?? 0);
    total += w;
  }
  return total > 0 ? score / total : 0;
}

// ---- The standard layouts --------------------------------------------------------------

/** Mirror a layout across the court — the same idea against an attack from the other side. */
function mirror(l: DefenceLayout): DefenceLayout {
  const m = (s: Spot): Spot => ({ u: 1 - s.u, v: s.v });
  return { lb: m(l.rb), mb: m(l.mb), rb: m(l.lb), free: m(l.free) };
}

/** Against the outside (the defence's right): perimeter — the line deep, the cross deep, 6 on the end line, the off-blocker on the cut. */
const PERIMETER_OH: DefenceLayout = {
  lb: { u: 0.17, v: 0.74 }, mb: { u: 0.52, v: 0.92 }, rb: { u: 0.88, v: 0.82 }, free: { u: 0.15, v: 0.33 },
};
/** Rotation: the line defender up for the tip, 6 round to the line, 5 deep in the cross. */
const ROTATION_OH: DefenceLayout = {
  lb: { u: 0.2, v: 0.8 }, mb: { u: 0.86, v: 0.86 }, rb: { u: 0.74, v: 0.22 }, free: { u: 0.15, v: 0.33 },
};
/** Man-up: 6 up behind the block for the tips, the corners deep. */
const MAN_UP_OH: DefenceLayout = {
  lb: { u: 0.18, v: 0.8 }, mb: { u: 0.64, v: 0.24 }, rb: { u: 0.88, v: 0.85 }, free: { u: 0.18, v: 0.33 },
};
/** Against the middle: a single block, both pins off the net, the back three spread. */
const PERIMETER_MB: DefenceLayout = {
  lb: { u: 0.18, v: 0.62 }, mb: { u: 0.5, v: 0.8 }, rb: { u: 0.82, v: 0.62 }, free: { u: 0.14, v: 0.3 },
};
const MAN_UP_MB: DefenceLayout = {
  lb: { u: 0.2, v: 0.7 }, mb: { u: 0.5, v: 0.4 }, rb: { u: 0.8, v: 0.7 }, free: { u: 0.12, v: 0.3 },
};

export type DefencePreset = 'perimeter' | 'rotation' | 'manUp';
export const DEFENCE_PRESET_NAMES: Readonly<Record<DefencePreset, string>> = {
  perimeter: 'Perimeter', rotation: 'Rotation', manUp: 'Man-up',
};

function clone(l: DefenceLayout): DefenceLayout {
  return { lb: { ...l.lb }, mb: { ...l.mb }, rb: { ...l.rb }, free: { ...l.free } };
}

/** A standard layout against one side. */
export function presetLayout(preset: DefencePreset, source: AttackSource): DefenceLayout {
  const oh = preset === 'rotation' ? ROTATION_OH : preset === 'manUp' ? MAN_UP_OH : PERIMETER_OH;
  if (source === 'oh') return clone(oh);
  if (source === 'opp') return mirror(oh);
  return clone(preset === 'manUp' ? MAN_UP_MB : PERIMETER_MB);
}

/** The usual defence: perimeter against everything. */
export function defaultDefenceLayouts(): DefenceLayouts {
  return { oh: presetLayout('perimeter', 'oh'), mb: presetLayout('perimeter', 'mb'), opp: presetLayout('perimeter', 'opp') };
}

/**
 * How much better (or worse) than the usual perimeter a side's layout covers
 * an attack from `source` by a hitter of `style`, as a dig multiplier: the
 * defence that suits the hitter in front of it digs more of his balls.
 */
export function coverEdge(layout: DefenceLayout, source: AttackSource, style = 0): number {
  const bucket = Math.round(style * 4);
  const key = `${source}:${bucket}`;
  const base = (BASE[key] ??= coverageScore(presetLayout('perimeter', source), source, bucket / 4));
  const edge = 1 + COVER_EDGE * (coverageScore(layout, source, bucket / 4) - base);
  return Math.min(COVER_MAX, Math.max(COVER_MIN, edge));
}

/** The usual perimeter's coverage of each side, worked out once. */
const BASE: Record<string, number> = {};

/** A side's own layouts, or the usual ones. */
export function defenceLayoutsOf(t: { defence?: DefenceLayouts } | undefined): DefenceLayouts {
  return t?.defence ?? (DEFAULTS ??= defaultDefenceLayouts());
}
let DEFAULTS: DefenceLayouts | undefined;

/** What covering the court better is worth to the dig, and how far it can swing it. */
const COVER_EDGE = 0.5;
const COVER_MIN = 0.88;
const COVER_MAX = 1.06;
