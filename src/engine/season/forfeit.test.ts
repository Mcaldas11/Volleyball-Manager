import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { appointManager } from '../world/career.ts';
import { advanceDay, forfeitIfShort, MIN_PLAYERS, newSeasonContext, playersAvailable, startSeason } from './seasonEngine.ts';

function setup(seed: number) {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[3];
  appointManager(world, club.id);
  const f = world.fixtures.filter((x) => !x.played && (x.home === club.id || x.away === club.id) &&
    world.competitions[x.competitionId]?.kind === 'league').sort((a, b) => a.day - b.day)[0];
  return { world, ctx, club, f };
}

/** All but `keep` of a club's players hurt — still out on the day of the match, `days` from now. */
function injureAllBut(world: ReturnType<typeof setup>['world'], clubId: number, keep: number, days = 30): void {
  world.clubs[clubId].players.forEach((p, i) => {
    if (i >= keep) world.players.injuryDaysLeft[p] = days + 30;
  });
}

test('a side with fewer than six fit to play loses by default: 3-0, every set 25-0', () => {
  const { world, ctx, club, f } = setup(161);
  injureAllBut(world, club.id, 4, f.day - world.day);
  assert.equal(playersAvailable(world, club.id), 4);
  const row = (id: number) => world.competitions[f.competitionId].table.find((r) => r.clubId === id)!;
  const otherId = f.home === club.id ? f.away : f.home;
  const before = { ours: row(club.id).played, theirs: row(otherId).points };
  while (world.day < f.day) advanceDay(world, ctx, {});
  advanceDay(world, ctx, {});
  assert.ok(f.played);
  const ourSets = f.home === club.id ? f.homeSets : f.awaySets;
  const theirSets = f.home === club.id ? f.awaySets : f.homeSets;
  assert.equal(ourSets, 0);
  assert.equal(theirSets, 3);
  for (const [h, a] of f.setScores) assert.deepEqual(f.home === club.id ? [h, a] : [a, h], [0, 25]);
  assert.equal(row(club.id).played, before.ours + 1, 'on the table');
  assert.ok(row(otherId).points > before.theirs, 'the winners take the points');
  assert.ok(world.messages.some((m) => m.subject.startsWith('Match lost by default')));
  assert.ok(world.news.some((n) => n.headline.includes('by default')));
  assert.equal(world.career.jobs[0].lost, 1, 'a defeat on the record');
});

test('with six fit there is no forfeit; the opponent short-handed hands the manager the win', () => {
  const { world, ctx, club, f } = setup(162);
  injureAllBut(world, club.id, MIN_PLAYERS);
  assert.equal(forfeitIfShort(world, ctx, f), false, 'six is enough');
  const otherId = f.home === club.id ? f.away : f.home;
  injureAllBut(world, otherId, 2);
  assert.equal(forfeitIfShort(world, ctx, f), true);
  const ourSets = f.home === club.id ? f.homeSets : f.awaySets;
  assert.equal(ourSets, 3);
  assert.ok(world.messages.some((m) => m.subject.startsWith('Match won by default')));
  assert.equal(forfeitIfShort(world, ctx, f), false, 'decided once');
});
