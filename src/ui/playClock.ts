/**
 * The live match's own clock, which can be stopped: wall time with the time spent stopped taken
 * out. The court draws by it and the rally's beats wait on it, so a pause stops everything on the
 * court where it is — the ball in the air, a hitter at the top of his jump — and play goes on from
 * exactly there.
 */

import { sleep } from './rallyPlayer.ts';

export class PlayClock {
  /** When it was stopped, wall-clock ms — or null, running. */
  private stoppedAt: number | null = null;
  /** How long it has been stopped altogether, ms. */
  private lost = 0;

  /** The time on this clock, ms: wall-clock ms less every stop. */
  now(): number {
    return (this.stoppedAt ?? performance.now()) - this.lost;
  }

  get stopped(): boolean {
    return this.stoppedAt !== null;
  }

  /** Stop the clock, or set it going again. */
  stop(on: boolean): void {
    if (on && this.stoppedAt === null) {
      this.stoppedAt = performance.now();
    } else if (!on && this.stoppedAt !== null) {
      this.lost += performance.now() - this.stoppedAt;
      this.stoppedAt = null;
    }
  }

  /** Wait `ms` of this clock's time — as much longer as it is stopped meanwhile. */
  async sleep(ms: number): Promise<void> {
    const until = this.now() + ms;
    for (;;) {
      const left = until - this.now();
      if (left <= 0) return;
      await sleep(this.stopped ? 60 : left);
    }
  }
}
