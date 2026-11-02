import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Beat, Scene } from './matchCourt.ts';
import { PlayClock } from './playClock.ts';
import { playBeats, sleep } from './rallyPlayer.ts';

test('stopped, the clock holds where it is — and runs on from there, the stop taken out', async () => {
  const clock = new PlayClock();
  await sleep(30);
  clock.stop(true);
  const at = clock.now();
  await sleep(80);
  assert.equal(clock.now(), at, 'not a moment passes while it is stopped');
  clock.stop(false);
  await sleep(30);
  const ran = clock.now() - at;
  assert.ok(ran >= 25 && ran < 70, `ran on ${ran.toFixed(0)} ms after the stop, not the stop's 80 as well`);
});

test('a wait on the clock lasts as much longer as the clock is stopped meanwhile', async () => {
  const clock = new PlayClock();
  const t0 = performance.now();
  setTimeout(() => clock.stop(true), 40);
  setTimeout(() => clock.stop(false), 160);
  await clock.sleep(100);
  const took = performance.now() - t0;
  assert.ok(took >= 210, `waited ${took.toFixed(0)} ms: 100 of play and the 120 stopped`);
});

test('paused mid-rally, the rally holds on the beat it is at — no next beat, no contact — until play goes on', async () => {
  const clock = new PlayClock();
  const beat = (ms: number): Beat => ({
    positions: new Map(), poses: new Map(), ball: null, arc: 0, actor: null, ms, callout: null,
  } as unknown as Beat);
  const shown: number[] = [];
  const contacts: number[] = [];
  const start = performance.now();
  const at = (): number => performance.now() - start;
  const beats = [beat(80 / 1.15), beat(80 / 1.15), beat(80 / 1.15)];
  // Paused a moment into the second beat, for 200 ms.
  setTimeout(() => clock.stop(true), 110);
  setTimeout(() => clock.stop(false), 310);
  await playBeats(beats, 1, { current: false }, (s: Scene) => { void s; shown.push(at()); }, () => undefined, undefined, () => contacts.push(at()), clock);
  assert.equal(shown.length, 3);
  // The second beat began before the pause; the third only after the pause and the rest of the second.
  assert.ok(shown[1] < 110, `the second beat at ${shown[1].toFixed(0)} ms`);
  assert.ok(shown[2] >= 350, `the third beat held to ${shown[2].toFixed(0)} ms, past the pause`);
  // The second beat's contact waited out the pause too.
  assert.ok(contacts[1] >= 350, `the second contact at ${contacts[1].toFixed(0)} ms`);
});
