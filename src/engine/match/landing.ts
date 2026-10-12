/**
 * Where an attacked ball comes down, and how the video measures it against
 * the lines.
 *
 * Every attack the engine records lands somewhere: a power hitter can put it
 * anywhere in the court — down the line, deep into the far corner, short on
 * the 3 m line, into the seam, tipped behind the block — each shot over its
 * own stretch of the court and no two balls in the same spot. One hit out
 * lands out, long or wide; one off the block, beyond it.
 *
 * The spot is given relative to the hitter, so it reads the same whichever
 * half he hits from: `across` is 0 on his own sideline — the line — and 1 on
 * the far one, `deep` is 0 at the net and 1 at the end line. Outside 0-1 the
 * ball is beyond a line.
 *
 * The lines are part of the court. The ball is in if any of it touches a
 * line: its footprint — the patch of a hard-hit ball pressed against the
 * floor — reaching the line's outer edge. That is what the video measures.
 */

import type { Shot } from './engine.ts';

/** Where a ball came down, relative to the hitter — see the module comment. */
export interface Landing {
  across: number;
  deep: number;
}

/** The court, m: 9 wide, 9 deep each side. */
const COURT_M = 9;
/** Radius of the ball's footprint on the floor, m. */
export const BALL_FOOTPRINT = 0.035;

/** Where a shot comes down: over its own stretch of the court, never twice in
 *  the same spot. `hu` is where the hitter is across the court in the
 *  defending side's frame (0-1); `rnd` gives numbers in [0, 1). Undefined for
 *  a ball that never reaches the floor on that side — into the net, or played
 *  back off the block. */
export function landingFor(shot: Shot | undefined, hu: number, rnd: () => number): Landing | undefined {
  const r = (a: number, b: number): number => a + (b - a) * rnd();
  // Bunched towards 0, spread up to 1: most balls near the heart of a shot's zone.
  const near = (): number => Math.abs(rnd() + rnd() - 1);
  // The hitter's distance from his own sideline, in court widths.
  const own = Math.min(hu, 1 - hu);
  // Inside the court, clear of the lines: a ball the video would call in at a glance.
  const inCourt = (l: Landing): Landing => ({
    across: Math.min(0.985, Math.max(0.015, l.across)),
    deep: Math.min(0.985, Math.max(0.03, l.deep)),
  });
  switch (shot) {
    case 'net':
    case 'recycle':
      return undefined;
    case 'line': return inCourt({ across: 0.03 + near() * 0.12, deep: r(0.5, 0.985) });
    case 'shortLine': return inCourt({ across: 0.03 + near() * 0.1, deep: r(0.18, 0.46) });
    case 'cross': return inCourt({ across: r(0.5, 0.985), deep: r(0.38, 0.985) });
    case 'cut': return inCourt({ across: 0.985 - near() * 0.2, deep: r(0.1, 0.42) });
    case 'tip': return inCourt({ across: own + r(-0.05, 0.35), deep: r(0.04, 0.34) });
    case 'roll': return inCourt({ across: r(0.2, 0.85), deep: r(0.25, 0.75) });
    case 'seam': return inCourt({ across: own + r(0.12, 0.42), deep: r(0.3, 0.92) });
    case 'deep': return inCourt({ across: r(0.05, 0.95), deep: 0.985 - near() * 0.2 });
    case 'quick': return inCourt({ across: own + r(-0.28, 0.28), deep: r(0.06, 0.55) });
    // Off the block and away: beyond the hitter's own sideline, or deep beyond the end line.
    case 'blockout': return rnd() < 0.55
      ? { across: -r(0.03, 0.4), deep: r(0.3, 1.1) }
      : { across: r(0.0, 0.3), deep: 1 + r(0.08, 0.5) };
    case 'long': return { across: r(0.04, 0.96), deep: 1 + r(0.02, 0.24) };
    case 'wide': return rnd() < 0.5
      ? { across: -r(0.02, 0.22), deep: r(0.15, 0.95) }
      : { across: 1 + r(0.02, 0.22), deep: r(0.15, 0.95) };
    // A ball of no particular kind: anywhere in the court.
    default: return inCourt({ across: r(0.05, 0.95), deep: r(0.08, 0.95) });
  }
}

/** Which line a ball came down by: the hitter's own sideline, the far one, or the end line. */
export type CourtLine = 'ownSide' | 'farSide' | 'end';

/** A ball's mark against the line, as the video measures it. */
export interface BallMark {
  line: CourtLine;
  /** The ball's edge beyond the line's outer edge, m: positive clear of it — out — zero or less on it — in. */
  gap: number;
  at: Landing;
}

/** How far beyond each line the ball's centre came down, m: positive outside. */
function beyond(l: Landing): Record<CourtLine, number> {
  return { ownSide: -l.across * COURT_M, farSide: (l.across - 1) * COURT_M, end: (l.deep - 1) * COURT_M };
}

/** The ball against the line that matters: the one it went over, or, in the
 *  court, the nearest. */
export function ballMark(l: Landing): BallMark {
  const b = beyond(l);
  let line: CourtLine = 'ownSide';
  for (const k of ['farSide', 'end'] as const) if (b[k] > b[line]) line = k;
  return { line, gap: b[line] - BALL_FOOTPRINT, at: l };
}

/** In, as the rules have it: any of the ball touching the line. */
export function isIn(l: Landing): boolean {
  return ballMark(l).gap <= 0;
}

/** The same ball moved square to `line` so its edge is `gap` m beyond the line's outer edge. */
export function onLine(l: Landing, line: CourtLine, gap: number): Landing {
  const s = (gap + BALL_FOOTPRINT) / COURT_M;
  if (line === 'ownSide') return { across: -s, deep: Math.min(0.97, Math.max(0.05, l.deep)) };
  if (line === 'farSide') return { across: 1 + s, deep: Math.min(0.97, Math.max(0.05, l.deep)) };
  return { across: Math.min(0.97, Math.max(0.03, l.across)), deep: 1 + s };
}

/** The line nearest a ball in the court. */
export function nearestLine(l: Landing): CourtLine {
  const d: Record<CourtLine, number> = { ownSide: l.across, farSide: 1 - l.across, end: 1 - l.deep };
  let best: CourtLine = 'ownSide';
  for (const k of ['farSide', 'end'] as const) if (d[k] < d[best]) best = k;
  return best;
}

/** A gap as the video's graphic says it: "3 cm", "on the line". */
export function gapWords(gap: number): string {
  const cm = Math.round(Math.abs(gap) * 100);
  if (gap > 0) return cm === 0 ? 'out by a hair' : `${cm} cm out`;
  return cm <= 1 ? 'just touching the line' : cm < 8 ? `on the line by ${cm} cm` : 'well in';
}
