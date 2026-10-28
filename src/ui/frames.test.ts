import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FramePacer, noteFrame, viewFrameRate } from './frames.ts';
import { QUALITY, qualityOf } from './preferences.ts';

/** How many of a second's screen ticks, at `hz`, a pacer limited to `cap` draws — the ticks a little uneven, as a screen's are. */
function drawnIn(cap: number, hz: number): number {
  const pacer = new FramePacer(() => cap);
  let drawn = 0;
  for (let i = 0; i < hz * 2; i++) {
    const now = 1000 + (i * 1000) / hz + (i % 3 === 0 ? 0.6 : i % 3 === 1 ? -0.5 : 0);
    if (pacer.due(now) && now >= 2000) drawn++;
  }
  return drawn;
}

test('the frame-rate limit: a view draws no more frames a second than it allows, and every one the screen shows without one', () => {
  assert.equal(drawnIn(0, 60), 60);
  assert.equal(drawnIn(0, 144), 144);
  assert.ok(Math.abs(drawnIn(30, 60) - 30) <= 1, `30 on a 60 Hz screen: ${drawnIn(30, 60)}`);
  assert.ok(Math.abs(drawnIn(60, 60) - 60) <= 1, `60 on a 60 Hz screen: ${drawnIn(60, 60)}`);
  assert.ok(Math.abs(drawnIn(60, 144) - 60) <= 2, `60 on a 144 Hz screen: ${drawnIn(60, 144)}`);
  assert.ok(Math.abs(drawnIn(120, 144) - 120) <= 3, `120 on a 144 Hz screen: ${drawnIn(120, 144)}`);
});

test('the frame-rate counter counts the busiest view over the last second, and nothing once views stop drawing', () => {
  const a = {};
  const b = {};
  for (let t = 0; t < 1000; t += 1000 / 30) noteFrame(a, 5000 + t);
  for (let t = 0; t < 1000; t += 1000 / 60) noteFrame(b, 5000 + t);
  const fps = viewFrameRate(5990);
  assert.ok(fps !== null && Math.abs(fps - 60) <= 1, `the busier one: ${fps}`);
  assert.equal(viewFrameRate(7000), null, 'none drawing');
});

test('graphics presets are told apart from details set by hand', () => {
  assert.equal(qualityOf(QUALITY.low), 'low');
  assert.equal(qualityOf(QUALITY.ultra), 'ultra');
  assert.equal(qualityOf({ ...QUALITY.high, shadows: 'off' }), 'custom');
});
