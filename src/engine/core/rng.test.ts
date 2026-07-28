import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from './rng.ts';

test('is reproducible from a seed', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
});

test('nearby seeds diverge immediately', () => {
  const a = new Rng(1);
  const b = new Rng(2);
  assert.notEqual(a.next(), b.next());
  assert.notEqual(a.next(), b.next());
});

test('state can be saved and restored', () => {
  const a = new Rng('save-test');
  for (let i = 0; i < 50; i++) a.next();
  const state = a.getState();
  const expected = [a.next(), a.next(), a.next()];
  const b = new Rng(0);
  b.setState(state);
  assert.deepEqual([b.next(), b.next(), b.next()], expected);
});

test('floats are uniform on [0,1)', () => {
  const rng = new Rng('uniform');
  const buckets = new Array(10).fill(0);
  const n = 200_000;
  for (let i = 0; i < n; i++) {
    const f = rng.float();
    assert.ok(f >= 0 && f < 1, `float out of range: ${f}`);
    buckets[Math.floor(f * 10)]++;
  }
  const expected = n / 10;
  for (const b of buckets) {
    // Each bucket should land within 3% of expected; sampling error at this n
    // is far tighter, so this only trips on a genuinely broken generator.
    assert.ok(Math.abs(b - expected) / expected < 0.03, `bucket skew: ${b} vs ${expected}`);
  }
});

test('period does not collapse (no short cycles)', () => {
  const rng = new Rng(999);
  const seen = new Set<number>();
  for (let i = 0; i < 100_000; i++) seen.add(rng.next());
  // With 100k draws from 2^32 values, expect ~99.9% distinct by birthday bound.
  assert.ok(seen.size > 99_000, `too many repeats: ${seen.size} distinct`);
});

test('gaussian has correct mean and stdev', () => {
  const rng = new Rng('normal');
  const n = 200_000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = rng.gaussian(10, 2);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean - 10) < 0.05, `mean was ${mean}`);
  assert.ok(Math.abs(Math.sqrt(variance) - 2) < 0.05, `stdev was ${Math.sqrt(variance)}`);
});

test('int() covers its inclusive range evenly', () => {
  const rng = new Rng('ints');
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 120_000; i++) counts[rng.int(0, 5)]++;
  for (const c of counts) assert.ok(Math.abs(c - 20_000) < 800, `die skew: ${c}`);
});

test('weightedIndex respects weights', () => {
  const rng = new Rng('weights');
  const counts = [0, 0, 0];
  const weights = [1, 3, 6];
  for (let i = 0; i < 100_000; i++) counts[rng.weightedIndex(weights)]++;
  assert.ok(Math.abs(counts[0] / 100_000 - 0.1) < 0.01);
  assert.ok(Math.abs(counts[1] / 100_000 - 0.3) < 0.015);
  assert.ok(Math.abs(counts[2] / 100_000 - 0.6) < 0.015);
});

test('forked streams are independent of parent draw count', () => {
  const parent = new Rng('fork');
  const childA = parent.fork('injuries');
  const parent2 = new Rng('fork');
  const childB = parent2.fork('injuries');
  assert.equal(childA.next(), childB.next());
  // Different labels must give different streams.
  assert.notEqual(new Rng('fork').fork('injuries').next(), new Rng('fork').fork('morale').next());
});
