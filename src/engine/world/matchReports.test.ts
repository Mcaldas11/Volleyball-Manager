import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSeasonContext, startSeason, advanceDay } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { bareResult, reportResult } from './matchReports.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('every match of the manager\'s club keeps its box score, and reads back the same as it was played', () => {
  const world = generateWorld({ seed: 71, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[0];
  appointManager(world, club.id);
  for (let d = 0; d < 80; d++) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });

  const mine = world.fixtures.filter((f) => f.played && (f.home === club.id || f.away === club.id));
  assert.ok(mine.length > 0);
  for (const f of mine) assert.ok(world.matchReports?.has(f.id), `match ${f.id} kept`);
  // Nobody else's.
  const others = world.fixtures.filter((f) => f.played && f.home !== club.id && f.away !== club.id);
  for (const f of others) assert.equal(world.matchReports?.has(f.id), false);

  // Read back, it is the match as it was played — the rally log aside.
  const f = mine[mine.length - 1];
  const played = ctx.detailedResults.get(f.id)!;
  const kept = reportResult(f, world.matchReports!.get(f.id)!);
  assert.equal(kept.log, null);
  assert.equal(kept.totalRallies, played.totalRallies);
  for (const side of ['home', 'away'] as const) {
    for (const [p, s] of kept.stats[side].players) assert.deepEqual(s, played.stats[side].players.get(p));
    assert.deepEqual(kept.stats[side].rotations, played.stats[side].rotations);
  }

  // A match nothing was kept of still opens: the score and the sets.
  const bare = bareResult(f);
  assert.deepEqual([bare.homeSets, bare.awaySets], [f.homeSets, f.awaySets]);
  assert.equal(bare.stats.home.players.size, 0);
});
