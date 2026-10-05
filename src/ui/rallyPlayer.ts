/**
 * Playing a rally out on the live court, beat by beat — for the match being
 * watched and for a point shown again — and the big callouts that flash up
 * over it: a spike put away or an ace, with the ball's speed off the hand and
 * how high it was struck; a stuff block, with how high the hands were. Every
 * serve is read by the radar too, as it flies.
 */

import type { RallyContact } from '../engine/match/engine.ts';
import { MONSTER_SPIKE_KMH } from '../engine/match/highlights.ts';
import type { Beat, Radar, Scene } from './matchCourt.ts';

/** A callout over the court: what happened, whose good news it is, and the radar's reading. */
export interface BigPlay {
  text: string;
  team: 0 | 1;
  /** What the reading is of: a ball struck, or a block's hands. */
  reading?: 'strike' | 'block';
  /** km/h, for a spike put away or an ace. */
  speed?: number;
  /** How high it was struck — or the block's hands were — m. */
  height?: number;
}

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

/** The callout for a beat, if it has one: every spike put away and every ace
 *  with its speed and height — the hardest a monster — and a stuff block with
 *  how high the hands were. */
export function bigPlayFor(callout: Beat['callout']): BigPlay | null {
  if (callout === null) return null;
  const { kind, team, speed, height } = callout;
  const options = BIG_PLAY_CALLOUTS[kind];
  if (options === undefined) return null;
  if (kind === 'kill') {
    const text = speed !== undefined && speed >= MONSTER_SPIKE_KMH ? 'MONSTER SPIKE!' : pick(options);
    return { text, team, reading: 'strike', speed, height };
  }
  if (kind === 'ace') return { text: pick(options), team, reading: 'strike', speed, height };
  if (kind === 'blocked') return { text: pick(options), team, reading: 'block', height };
  return { text: pick(options), team };
}

/** How long a callout stays up: longer when there is a reading to take in. */
export function bigPlayMs(play: BigPlay): number {
  return play.reading !== undefined ? 1800 : 1100;
}

/** How long the radar's reading of a serve stays up. */
export const RADAR_MS = 2000;

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
  onRadar?: (radar: Radar) => void,
): Promise<void> {
  for (const beat of beats) {
    if (cancelled.current) return;
    const ms = (beat.ms * 1.15) / speed;
    const release = beat.release !== undefined ? (beat.release * 1.15) / speed : undefined;
    setScene({ ...beat, ms, release, seq: ++beatSeq });
    const play = bigPlayFor(beat.callout);
    if (play !== null) onBigPlay(play);
    if (beat.radar !== undefined && onRadar !== undefined) onRadar(beat.radar);
    await sleep(ms);
  }
}
