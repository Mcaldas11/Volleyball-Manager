/**
 * Playing a rally out on the live court, beat by beat — for the match being
 * watched and for a point shown again — and the big callouts that flash up
 * over it: a spike put away, a stuff block, an ace, with the ball's speed
 * off the hand when it was struck hard enough to be worth the radar.
 */

import type { RallyContact } from '../engine/match/engine.ts';
import { MONSTER_SPIKE_KMH } from '../engine/match/highlights.ts';
import type { Beat, Scene } from './matchCourt.ts';

/** A callout over the court: what happened, whose good news it is, and the radar's reading. */
export interface BigPlay {
  text: string;
  team: 0 | 1;
  /** km/h, for a monster spike or a jump serve aced. */
  speed?: number;
}

/** A jump serve this fast that aces gets its speed shown. */
const RADAR_ACE_KMH = 100;

/** Beat counter shared by every rally, so each flight gets a fresh animation. */
let beatSeq = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Punchy callouts for the moments worth flashing on screen, not every touch of the ball. */
const BIG_PLAY_CALLOUTS: Partial<Record<RallyContact['kind'], readonly string[]>> = {
  kill: ['KILL!', 'CRUSHED!', 'UNSTOPPABLE!', 'PUT AWAY!'],
  blocked: ['HUGE BLOCK!', 'STUFFED!', 'DENIED!', 'REJECTED!'],
  ace: ['ACE!', 'UNTOUCHABLE SERVE!'],
  attackError: ['OUT!', 'WIDE!'],
  serveError: ['OUT!', 'INTO THE NET!'],
};

function pick(options: readonly string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}

/** The callout for a beat, if it has one: a spike struck hard enough is a monster, its speed on the radar. */
export function bigPlayFor(callout: Beat['callout']): BigPlay | null {
  if (callout === null) return null;
  const { kind, team, speed } = callout;
  if (kind === 'kill' && speed !== undefined && speed >= MONSTER_SPIKE_KMH) return { text: 'MONSTER SPIKE!', team, speed };
  if (kind === 'ace' && speed !== undefined && speed >= RADAR_ACE_KMH) return { text: pick(BIG_PLAY_CALLOUTS.ace!), team, speed };
  const options = BIG_PLAY_CALLOUTS[kind];
  return options !== undefined ? { text: pick(options), team } : null;
}

/** How long a callout stays up: longer when there is a speed to read. */
export function bigPlayMs(play: BigPlay): number {
  return play.speed !== undefined ? 1700 : 1100;
}

/**
 * Play a rally's beats on the court: every beat moves the players into where
 * they would really be and sends the ball to whoever touches it next. Beat
 * timings are tuned for 1x — slower speeds stretch them, faster squeeze.
 */
export async function playBeats(
  beats: readonly Beat[],
  speed: number,
  cancelled: { current: boolean },
  setScene: (scene: Scene) => void,
  onBigPlay: (play: BigPlay) => void,
): Promise<void> {
  for (const beat of beats) {
    if (cancelled.current) return;
    const ms = (beat.ms * 1.15) / speed;
    const release = beat.release !== undefined ? (beat.release * 1.15) / speed : undefined;
    setScene({ ...beat, ms, release, seq: ++beatSeq });
    const play = bigPlayFor(beat.callout);
    if (play !== null) onBigPlay(play);
    await sleep(ms);
  }
}
