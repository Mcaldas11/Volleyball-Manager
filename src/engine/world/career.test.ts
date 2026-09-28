import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, dayOfSeason, stubManager, type World } from './world.ts';
import {
  acceptJobOffer, appointManager, applicationBlock, applyForJob, backfillCareer, currentJob, headCoachOf,
  isUnemployed, resign, vacancyAt,
} from './career.ts';
import { advanceDay, newSeasonContext, simulateRestOfSeason, startSeason, type SeasonContext } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';

function fresh(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  return { world, ctx };
}

function topFlightClub(world: World): number {
  return world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id;
}

function advanceTo(world: World, ctx: SeasonContext, day: number): void {
  while (world.day < day) advanceDay(world, ctx);
}

test('taking charge puts the manager in the job and moves the club\'s own coach aside', () => {
  const { world } = fresh(61);
  const clubId = topFlightClub(world);
  const club = world.clubs[clubId];
  assert.ok(headCoachOf(world, club) !== undefined, 'the club had a coach');
  appointManager(world, clubId);

  assert.equal(world.userClubId, clubId);
  const job = currentJob(world);
  assert.ok(job !== undefined);
  assert.equal(job.startDay, world.day);
  assert.equal(headCoachOf(world, club), undefined, 'the user is the head coach now');
  assert.ok(world.career.reputation > 0, 'a first job gives the manager a name');
  assert.ok(world.messages.some((m) => m.category === 'board' && m.clubId === clubId));
  assert.ok(world.vacancies.length > 0, 'a few clubs are already looking for a coach');
  for (const v of world.vacancies) assert.equal(headCoachOf(world, world.clubs[v.clubId]), undefined);
});

test('every board sets a target inside its division, the favourites to win it', () => {
  const { world } = fresh(62);
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.participants.length === 0) continue;
    const clubs = comp.participants.map((id) => world.clubs[id]);
    for (const c of clubs) {
      assert.ok(c.boardExpectation >= 1 && c.boardExpectation <= clubs.length, `${c.name} has a reachable target`);
    }
    const favourite = [...clubs].sort((a, b) => b.reputation - a.reputation)[0];
    assert.equal(favourite.boardExpectation, 1);
  }
});

test('resigning ends the job and leaves the club looking for a successor', () => {
  const { world, ctx } = fresh(63);
  const clubId = topFlightClub(world);
  appointManager(world, clubId);
  advanceTo(world, ctx, 20);

  assert.equal(resign(world), true);
  assert.equal(world.userClubId, -1);
  assert.ok(isUnemployed(world));
  const job = world.career.jobs[world.career.jobs.length - 1];
  assert.equal(job.exit, 'resigned');
  assert.equal(job.endDay, world.day);
  assert.ok(vacancyAt(world, clubId) !== undefined, 'the club is looking for a new coach');
  assert.ok(applicationBlock(world, clubId) !== null, 'and won\'t have him straight back');
  assert.ok(world.messages.some((m) => m.category === 'career' && /resigned/.test(m.subject)));
  assert.equal(resign(world), false, 'there is nothing left to resign from');
});

test('the board warns its manager first, and sacks him if things do not improve', () => {
  const { world, ctx } = fresh(64);
  const clubId = topFlightClub(world);
  appointManager(world, clubId);
  advanceTo(world, ctx, 120);
  assert.equal(world.userClubId, clubId, 'a normal start keeps the job');

  const club = world.clubs[clubId];
  let warnedOn = -1;
  while (world.userClubId === clubId && world.day < 180) {
    club.boardConfidence = 5;
    advanceDay(world, ctx);
    const warning = world.messages.find((m) => m.subject === 'Final warning from the board');
    if (warning !== undefined && warnedOn < 0) warnedOn = warning.day;
  }
  assert.equal(world.userClubId, -1, 'the board acted');
  assert.ok(warnedOn >= 0, 'after a final warning');
  const sacked = world.messages.find((m) => m.category === 'career' && m.subject.startsWith('Sacked'));
  assert.ok(sacked !== undefined);
  assert.ok(sacked.day - warnedOn >= 10, 'the warning had time to work');
  assert.equal(world.career.jobs[world.career.jobs.length - 1].exit, 'sacked');
});

test('a club assigned by hand is never judged by its board', () => {
  const { world, ctx } = fresh(65);
  const clubId = topFlightClub(world);
  world.userClubId = clubId;
  advanceTo(world, ctx, 100);
  while (world.day < 160) {
    world.clubs[clubId].boardConfidence = 0;
    advanceDay(world, ctx);
  }
  assert.equal(world.userClubId, clubId);
});

test('an application is answered within a week, and an offer can be taken', () => {
  const { world, ctx } = fresh(66);
  const clubId = topFlightClub(world);
  appointManager(world, clubId);
  world.career.reputation = 10000;
  // Three small clubs looking for a coach, and in no hurry to appoint one.
  const targets = world.clubs.filter((c) => c.id !== clubId && c.tier === 2 && vacancyAt(world, c.id) === undefined).slice(0, 3);
  for (const c of targets) world.vacancies.push({ clubId: c.id, since: world.day, fillsOn: world.day + 200 });
  for (const c of targets) assert.ok(applyForJob(world, c.id) !== null);
  assert.equal(applyForJob(world, targets[0].id), null, 'one application per club');

  advanceTo(world, ctx, world.day + 8);
  assert.equal(world.career.applications.length, 0, 'every club has answered');
  const offer = world.career.offers[0];
  assert.ok(offer !== undefined, 'someone wants a manager with his name');
  assert.ok(world.messages.some((m) => m.jobOfferId === offer.id));

  assert.equal(acceptJobOffer(world, offer.id), true);
  assert.equal(world.userClubId, offer.clubId);
  assert.equal(world.career.jobs.length, 2);
  assert.equal(world.career.jobs[0].exit, 'moved');
  assert.ok(vacancyAt(world, clubId) !== undefined, 'the old club needs a coach now');
  assert.equal(vacancyAt(world, offer.clubId), undefined, 'the new one does not');
  assert.equal(world.career.offers.length, 0, 'taking a job ends the search');
});

test('a manager out of work is not left waiting for a call forever', () => {
  const { world, ctx } = fresh(67);
  appointManager(world, topFlightClub(world));
  advanceTo(world, ctx, 90);
  resign(world);
  const out = world.day;
  while (world.career.offers.length === 0 && world.day < out + 60) advanceDay(world, ctx);
  assert.ok(world.career.offers.length > 0, 'a club has called');
  assert.ok(world.day - out <= 45);
});

test('boards part with coaches in the season, and every vacancy is filled in time', () => {
  const { world, ctx } = fresh(68);
  const seen = new Set<number>();
  while (dayOfSeason(world) < 300) {
    advanceDay(world, ctx);
    for (const v of world.vacancies) seen.add(v.clubId);
  }
  assert.ok(seen.size > 0, 'some coach lost his job');
  for (const club of world.clubs) {
    if (vacancyAt(world, club.id) !== undefined) continue;
    assert.ok(headCoachOf(world, club) !== undefined, `${club.name} has a coach`);
  }
  for (const v of world.vacancies) assert.ok(world.day - v.since <= 35, 'no club is left without a coach for long');
});

test('the season ends with the board\'s verdict and next season\'s target', () => {
  const { world, ctx } = fresh(69);
  const clubId = topFlightClub(world);
  appointManager(world, clubId);
  simulateRestOfSeason(world, ctx);
  endSeason(world, ctx);

  const job = world.career.jobs[0];
  assert.ok(job.won + job.lost > 0, 'the record was kept');
  if (world.userClubId === clubId) {
    assert.ok(world.messages.some((m) => m.subject === 'The board\'s verdict on the season'));
    assert.ok(world.messages.some((m) => m.subject === 'Objectives for 2027/28'));
  } else {
    assert.equal(job.exit, 'sacked');
  }
});

test('a save from before careers makes the club it was managing its first job', () => {
  const { world } = fresh(70);
  const clubId = topFlightClub(world);
  world.userClubId = clubId;
  world.day = DAYS_PER_SEASON + 40;
  world.season = 1;
  const raw = world as unknown as Record<string, unknown>;
  delete raw.career;
  delete raw.vacancies;
  backfillCareer(world);

  assert.equal(world.career.jobs.length, 1);
  assert.equal(currentJob(world)?.clubId, clubId);
  assert.equal(currentJob(world)?.startDay, DAYS_PER_SEASON);
  assert.deepEqual(world.vacancies, []);
  assert.equal(headCoachOf(world, world.clubs[clubId]), undefined);
});
