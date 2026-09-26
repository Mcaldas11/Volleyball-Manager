import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { Position } from '../model/positions.ts';
import { PlayerFlag } from '../model/players.ts';
import { pickLineup } from './seasonEngine.ts';

test('pickLineup auto-picks the best available six when no preference is set', () => {
  const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.players.length >= 8)!;
  club.preferredLineup = [];
  club.preferredLibero = -1;

  const { lineup, libero, bench } = pickLineup(world.players, club);
  assert.equal(lineup.length, 6);
  assert.notEqual(libero, -1);
  assert.equal(new Set([...lineup, libero]).size, 7, 'no player picked twice');
  for (const p of bench) assert.ok(!lineup.includes(p) && p !== libero);
});

test('pickLineup honours a saved preferred lineup and libero', () => {
  const world = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const club = world.clubs.find((c) => c.players.length >= 10)!;

  const byPos = (pos: Position): number[] => club.players.filter((p) => store.position[p] === pos);
  const [setter] = byPos(Position.Setter);
  const [opp] = byPos(Position.Opposite);
  const [oh1, oh2] = byPos(Position.OutsideHitter);
  const [mb1, mb2] = byPos(Position.MiddleBlocker);
  const [libero1] = byPos(Position.Libero);

  // Rotation P1: setter 1, outsides 2 and 5, middles 3 and 6, opposite 4.
  club.preferredLineup = [setter, oh1, mb1, opp, oh2, mb2];
  club.preferredLibero = libero1;

  const { lineup, libero } = pickLineup(store, club);
  assert.deepEqual(lineup, [setter, oh1, mb1, opp, oh2, mb2]);
  assert.equal(libero, libero1);
});

test('pickLineup falls back to the next best player for a slot whose preferred starter is unavailable', () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const club = world.clubs.find((c) => c.players.filter((p) => store.position[p] === Position.OutsideHitter).length >= 3)!;

  const byPos = (pos: Position): number[] =>
    club.players
      .filter((p) => store.position[p] === pos)
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const [setter] = byPos(Position.Setter);
  const [opp] = byPos(Position.Opposite);
  const outsides = byPos(Position.OutsideHitter);
  const [mb1, mb2] = byPos(Position.MiddleBlocker);
  const [libero1] = byPos(Position.Libero);

  club.preferredLineup = [setter, outsides[0], mb1, opp, outsides[1], mb2];
  club.preferredLibero = libero1;

  // Injure the preferred first-choice outside hitter — they should drop out
  // of the lineup and only that slot should change.
  store.injuryDaysLeft[outsides[0]] = 10;
  store.setFlag(outsides[0], PlayerFlag.Injured, true);

  const { lineup } = pickLineup(store, club);
  assert.ok(!lineup.includes(outsides[0]), 'the injured preferred starter should not be picked');
  assert.equal(lineup[2], mb1);
  assert.equal(lineup[3], opp);
  assert.equal(lineup[4], outsides[1]);
  assert.equal(lineup[5], mb2);
  // The vacated slot 1 should be filled by the best fit outside hitter left.
  const remaining = outsides.filter((p) => p !== outsides[0] && p !== outsides[1]);
  if (remaining.length > 0) assert.equal(lineup[1], remaining[0]);
});

test('pickLineup uses a named defensive libero, and never auto-picks one', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const club = world.clubs.find((c) => c.players.filter((p) => store.position[p] === Position.Libero).length >= 2)!;
  const [l1, l2] = club.players.filter((p) => store.position[p] === Position.Libero);

  club.preferredLibero = l1;
  club.preferredDefensiveLibero = -1;
  const single = pickLineup(store, club);
  assert.equal(single.defensiveLibero, -1);
  assert.ok(single.bench.includes(l2), 'the unused libero stays on the bench');

  club.preferredDefensiveLibero = l2;
  const pair = pickLineup(store, club);
  assert.equal(pair.libero, l1);
  assert.equal(pair.defensiveLibero, l2);
  assert.ok(!pair.bench.includes(l1) && !pair.bench.includes(l2));

  // With the reception libero hurt, the other libero covers alone.
  store.injuryDaysLeft[l1] = 10;
  const cover = pickLineup(store, club);
  assert.equal(cover.libero, l2);
  assert.equal(cover.defensiveLibero, -1);
});
