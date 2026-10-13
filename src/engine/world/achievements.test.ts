import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievementList, achievementsDay } from './achievements.ts';
import { appointManager } from './career.ts';
import { COURSES, courseBlock, coursesDay, licenceOf, startCourse } from './courses.ts';
import { ensureManagerAttributes } from './career.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('achievements unlock the day they are reached, once, with a word in the inbox', () => {
  const world = generateWorld({ seed: 161, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 2 && c.players.length >= 12)!;
  appointManager(world, club.id);
  achievementsDay(world);
  assert.equal(achievementList(world).filter((a) => a.day !== null).length, 0, 'nothing yet');

  const job = world.career.jobs[world.career.jobs.length - 1];
  job.won = 100;
  const cup = world.competitions.find((c) => c.kind === 'cup')!;
  job.trophies.push({ competitionId: cup.id, season: world.season });
  achievementsDay(world);
  const got = achievementList(world).filter((a) => a.day !== null).map((a) => a.id).sort();
  assert.deepEqual(got, ['cup', 'firstTrophy', 'firstWin', 'wins100']);
  assert.equal(world.messages.filter((m) => m.subject.startsWith('Achievement: ')).length, 4);
  achievementsDay(world);
  assert.equal(world.messages.filter((m) => m.subject.startsWith('Achievement: ')).length, 4, 'once');

  // Promotion: his club a division up since he last looked.
  club.tier = 1;
  achievementsDay(world);
  assert.ok(achievementList(world).find((a) => a.id === 'promotion')!.day !== null);
});

test('coaching courses: the licences in order, clinics once a season, the club pays — and the coach gets better', () => {
  const world = generateWorld({ seed: 162, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  appointManager(world, club.id);
  club.finances.balance = 1_000_000;
  const attrs = ensureManagerAttributes(world);
  for (const k of Object.keys(attrs) as Array<keyof typeof attrs>) attrs[k] = Math.min(attrs[k], 15);
  const L1 = COURSES.find((c) => c.id === 'L1')!;
  assert.match(courseBlock(world, L1)!, /Level 2/);

  const tactical = attrs.coachTactical;
  const rep = world.career.reputation;
  assert.ok(startCourse(world, 'L2').ok);
  assert.equal(club.finances.balance, 1_000_000 - 5_000, 'the club pays');
  assert.match(courseBlock(world, COURSES.find((c) => c.id === 'serveReceive')!)!, /one at a time/);
  for (let d = 0; d < 70 && world.career.course !== undefined; d++) { world.day++; coursesDay(world); }
  assert.equal(licenceOf(world), 'L2');
  assert.equal(attrs.coachTactical, tactical + 1);
  assert.ok(world.career.reputation > rep);
  assert.equal(courseBlock(world, L1), null, 'now the next one');

  // A clinic: once a season.
  const serving = attrs.coachServing;
  assert.ok(startCourse(world, 'serveReceive').ok);
  for (let d = 0; d < 40 && world.career.course !== undefined; d++) { world.day++; coursesDay(world); }
  assert.equal(attrs.coachServing, serving + 1);
  assert.match(courseBlock(world, COURSES.find((c) => c.id === 'serveReceive')!)!, /this season/);
  world.season++;
  assert.equal(courseBlock(world, COURSES.find((c) => c.id === 'serveReceive')!), null, 'again next season');
});
