import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager, type World } from '../world/world.ts';
import { appointManager, startOutOfWork } from '../world/career.ts';
import { startNationalCareer } from '../world/internationals.ts';
import { PlayerFlag } from '../model/players.ts';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from './seasonEngine.ts';
import { friendliesOf } from './friendlies.ts';
import { beginTestCoaching, bookTestMatch, settleTestMatch, TEST_SIDE_NAME, testMatchToday } from './testMatch.ts';

function fresh(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  return { world, ctx };
}

test('a club career: the practice match is today, counts as no friendly, and leaves nothing behind', () => {
  const { world, ctx } = fresh(11);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  const club = world.clubs[world.userClubId];
  const f = bookTestMatch(world)!;
  assert.ok(f !== null);
  assert.equal(bookTestMatch(world), null, 'once a career');
  assert.equal(testMatchToday(world), f);
  assert.equal(f.home, club.id);
  assert.equal(world.clubs[f.away].name, TEST_SIDE_NAME);
  assert.equal(friendliesOf(world, club.id).length, 0, 'not one of the pre-season\'s friendlies');
  const condition = club.players.map((p) => world.players.condition[p]);
  const tables = JSON.stringify(world.competitions.map((c) => c.table));
  const made = [...world.clubs[f.away].players];
  advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });
  assert.ok(f.played);
  assert.equal(JSON.stringify(world.competitions.map((c) => c.table)), tables, 'no table');
  // Overnight recovery only — the match itself took nothing out of the legs.
  club.players.forEach((p, i) => assert.ok(world.players.condition[p] >= condition[i] - 1));
  assert.equal(world.testMatch!.settled, true);
  assert.equal(world.clubs[f.away].players.length, 0);
  for (const p of made) assert.ok(world.players.hasFlag(p, PlayerFlag.Retired), 'the made-up players go');
});

test('a national team\'s fourteen are lent for the day and go back to their clubs as they were', () => {
  const { world } = fresh(12);
  const nation = world.nationalTeams[0].nation;
  startNationalCareer(world, nation);
  assert.equal(world.userClubId, -1);
  const f = bookTestMatch(world)!;
  const side = world.clubs[f.home];
  assert.equal(side.exhibition, true);
  const lent = [...side.players];
  const clubs = lent.map((p) => world.players.clubId[p]);
  assert.ok(lent.length >= 12);
  assert.ok(beginTestCoaching(world));
  assert.equal(world.userClubId, side.id);
  f.played = true;
  settleTestMatch(world);
  assert.equal(world.userClubId, -1, 'the side given back');
  assert.deepEqual(lent.map((p) => world.players.clubId[p]), clubs);
  assert.ok(lent.every((p) => !world.players.hasFlag(p, PlayerFlag.Retired)));
});

test('out of work: a scratch side to coach', () => {
  const { world } = fresh(13);
  startOutOfWork(world);
  const f = bookTestMatch(world)!;
  assert.ok(f !== null);
  assert.equal(world.clubs[f.home].players.length, 14);
  assert.ok(beginTestCoaching(world));
  f.played = true;
  settleTestMatch(world);
  assert.equal(world.userClubId, -1);
  assert.equal(world.clubs[f.home].players.length, 0);
});
