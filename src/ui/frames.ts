/**
 * Frames: the 3D views draw no more often than the frame-rate limit allows (preferences.ts), and
 * note each frame they draw, for the counter in the corner — which shows how many a 3D view drew
 * in the last second, or, with none drawing, how many the page itself did.
 */

import { frameCap } from './preferences.ts';

/** Whether a view draws on this tick of the screen's, as the limit allows. One per view. */
export class FramePacer {
  private last = -Infinity;

  /** `cap`: the limit, frames a second — 0 for none; the preferences' by default. */
  constructor(private readonly cap: () => number = frameCap) {}

  due(now: number): boolean {
    const cap = this.cap();
    if (cap === 0) {
      this.last = now;
      return true;
    }
    const interval = 1000 / cap;
    const since = now - this.last;
    // A millisecond or two early is near enough: the screen's ticks never come quite evenly.
    if (since < interval - 2) return false;
    // On the beat, not drifting from it — or, after a long pause, from now.
    this.last = since > interval * 3 ? now : this.last + interval * Math.max(1, Math.floor((since + 2) / interval));
    return true;
  }
}

/** When each view drew its frames over the last second. */
const drawn = new Map<object, number[]>();

/** A frame drawn by `view`. */
export function noteFrame(view: object, now: number): void {
  let times = drawn.get(view);
  if (times === undefined) {
    times = [];
    drawn.set(view, times);
  }
  times.push(now);
  while (times.length > 0 && times[0] < now - 1000) times.shift();
}

/** Frames a second the busiest 3D view is drawing — null with none drawing. */
export function viewFrameRate(now: number): number | null {
  let best: number | null = null;
  for (const [view, times] of drawn) {
    while (times.length > 0 && times[0] < now - 1000) times.shift();
    // Stopped drawing — gone, or hidden.
    if (times.length === 0 || now - times[times.length - 1] > 500) {
      drawn.delete(view);
      continue;
    }
    best = Math.max(best ?? 0, times.length);
  }
  return best;
}
