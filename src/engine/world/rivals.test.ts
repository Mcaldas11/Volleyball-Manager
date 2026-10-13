import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { clubCity, fixtureRivalry, rivalryName, rivalryOf, rivalsOf } from './rivals.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('clubs of one city are derby rivals; each country\'s two leading clubs play the classic, kept for good', () => {
  const world = generateWorld({ seed: 81, startYear: 2026, scale: 'small', manager: stubManager() });
  for (const c of world.clubs) {
    const city = clubCity(world, c);
    assert.ok(city !== null && c.name.includes(city), `${c.name}: ${city}`);
  }
  let derbies = 0;
  for (const a of world.clubs.slice(0, 200)) {
    for (const r of rivalsOf(world, a.id)) {
      assert.equal(rivalryOf(world, r.clubId, a.id), r.kind, 'both ways');
      if (r.kind === 'derby') {
        derbies++;
        assert.equal(clubCity(world, world.clubs[r.clubId]), clubCity(world, a));
      }
    }
  }
  assert.ok(derbies > 0);
  // The classic: picked once, and kept when the clubs' standing changes.
  rivalsOf(world, 0);
  const classics = JSON.stringify(world.classics);
  assert.ok((world.classics?.length ?? 0) > 5);
  for (const c of world.clubs) c.reputation = 10000 - c.reputation;
  rivalsOf(world, 0);
  assert.equal(JSON.stringify(world.classics), classics);
  const [a, b] = world.classics![0];
  assert.equal(rivalryOf(world, a, b), clubCity(world, world.clubs[a]) === clubCity(world, world.clubs[b]) ? 'derby' : 'classic');
  assert.equal(rivalryOf(world, a, a), null);
});

test('a derby: the scouts call it one, the papers and the fans make it one', () => {
  const world = generateWorld({ seed: 82, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // A club with a derby in its league.
  const club = world.clubs.find((c) => c.tier === 1 && world.fixtures.some((f) =>
    (f.home === c.id || f.away === c.id) && fixtureRivalry(world, f) === 'derby'))!;
  appointManager(world, club.id);
  const derby = world.fixtures.filter((f) => (f.home === club.id || f.away === club.id) && fixtureRivalry(world, f) === 'derby')
    .sort((x, y) => x.day - y.day)[0];
  assert.match(rivalryName(world, derby)!, /^the .+ derby$/);
  while (!derby.played) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });

  const opp = world.clubs[derby.home === club.id ? derby.away : derby.home];
  assert.ok(world.messages.some((m) => m.subject === `Scouting report: ${opp.name} — derby` && m.body.includes(rivalryName(world, derby)!)));
  const story = world.news.find((n) => n.fans?.story === 'derby' && (n.clubId === club.id || n.otherClubId === club.id));
  assert.ok(story !== undefined, 'the paper calls it the derby');
  assert.ok(story.body.includes(rivalryName(world, derby)!));
});
