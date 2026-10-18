import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager, type Fixture } from '../world/world.ts';
import { appointManager } from '../world/career.ts';
import { advanceDay, newSeasonContext, startSeason } from './seasonEngine.ts';
import { asItStands, liveTable, playAroundTheLeague, pointsFor } from './aroundTheLeague.ts';
import { newTableRow } from '../model/club.ts';

test('another match unfolds in step with the manager\'s: set for set, the score climbing, final when it is', () => {
  const f = { setScores: [[25, 20], [23, 25], [25, 18], [25, 22]] } as unknown as Fixture;
  const start = asItStands(f, { sets: 0, score: [0, 0], over: false });
  assert.deepEqual(start, { sets: [], live: [0, 0], done: false });
  const mid = asItStands(f, { sets: 1, score: [13, 11], over: false });
  assert.deepEqual(mid.sets, [[25, 20]]);
  assert.ok(mid.live![0] > 5 && mid.live![0] < 23 && mid.live![1] > 5);
  assert.equal(asItStands(f, { sets: 4, score: [3, 2], over: false }).done, true, 'four sets and done before his fifth');
  assert.equal(asItStands(f, { sets: 2, score: [5, 5], over: true }).done, true, 'his match over: theirs shown in full');
});

test('the table as it stands: a set lead counted as the win it would be', () => {
  assert.deepEqual(pointsFor(3, 0), [3, 0]);
  assert.deepEqual(pointsFor(2, 1), [3, 0]);
  assert.deepEqual(pointsFor(2, 3), [1, 2]);
  assert.deepEqual(pointsFor(1, 1), [0, 0]);
  const base = [1, 2, 3, 4].map((id) => ({ ...newTableRow(id), points: 10 - id }));
  // 4th beats 1st 3-0 — level on points, ahead on wins; 2nd and 3rd level at a set each.
  const t = liveTable(base, [{ home: 4, away: 1, homeSets: 3, awaySets: 0 }, { home: 2, away: 3, homeSets: 1, awaySets: 1 }]);
  assert.deepEqual(t.map((r) => r.clubId), [4, 1, 2, 3]);
  const fourth = t.find((r) => r.clubId === 4)!;
  assert.equal(fourth.was, 4);
  assert.equal(fourth.points, 9);
});

test('at kick-off the rest of the round is played, the table kept as it stood — and the day does not play it twice', () => {
  const world = generateWorld({ seed: 12, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[1];
  appointManager(world, club.id);
  const league = world.competitions[club.leagueId];
  let own: Fixture | undefined;
  for (let d = 0; d < 250 && own === undefined; d++) {
    own = (world.fixturesByDay.get(world.day) ?? []).map((id) => world.fixtures[id])
      .find((f) => !f.played && f.competitionId === league.id && (f.home === club.id || f.away === club.id));
    if (own === undefined) advanceDay(world, ctx, {});
  }
  assert.ok(own !== undefined, 'a league match');
  const before = league.table.map((r) => ({ ...r }));
  const around = playAroundTheLeague(world, ctx, own!)!;
  assert.ok(around.ids.length >= 1);
  assert.deepEqual(around.base, before);
  assert.ok(around.ids.every((id) => world.fixtures[id].played));
  const results = around.ids.map((id) => world.fixtures[id].setScores.join('|'));
  advanceDay(world, ctx, {});
  assert.deepEqual(around.ids.map((id) => world.fixtures[id].setScores.join('|')), results, 'the same results');
});
