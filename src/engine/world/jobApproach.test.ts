import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import {
  acceptJobOffer, approachClub, careerDay, changeAppetite, headCoachOf, interestBlock, interestChance,
  MAX_APPROACHES, startOutOfWork, vacancyAt,
} from './career.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import type { Club } from '../model/club.ts';

function outOfWork(seed: number): World {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  startOutOfWork(world);
  return world;
}

/** Clubs with a head coach in post and a squad, biggest first. */
function coached(world: World): Club[] {
  return world.clubs
    .filter((c) => c.players.length > 0 && vacancyAt(world, c.id) === undefined && headCoachOf(world, c) !== undefined)
    .sort((a, b) => b.reputation - a.reputation);
}

/** Send the approach and have the board answer it today. */
function answered(world: World, club: Club): void {
  const app = approachClub(world, club.id);
  assert.ok(app !== null, `could approach ${club.name}`);
  assert.equal(app.speculative, true);
  app.answerOn = world.day;
  careerDay(world);
}

test('any club can be approached, vacancy or not — a vacancy is an ordinary application', () => {
  const world = outOfWork(301);
  const club = coached(world)[5];
  assert.equal(interestBlock(world, club.id), null);
  const vacant = world.clubs[world.vacancies[0].clubId];
  const app = approachClub(world, vacant.id);
  assert.ok(app !== null && app.speculative !== true, 'a vacancy takes an application');
});

test('a top club with a settled coach turns an unknown name down, and will not hear him again for a while', () => {
  const world = outOfWork(302);
  world.career.reputation = 800;
  const tops = coached(world).slice(0, 10);
  let offers = 0;
  for (const club of tops) {
    club.boardConfidence = 70;
    assert.ok(interestChance(world, club) < 0.05, `${club.name} is out of his reach`);
    world.career.applications = [];
    const before = world.career.offers.length;
    answered(world, club);
    if (world.career.offers.length > before) offers++;
    assert.ok(headCoachOf(world, club) !== undefined, 'the coach stays in post');
    assert.ok(interestBlock(world, club.id) !== null, 'and the board will not hear him again so soon');
  }
  assert.ok(offers <= 1, `${offers} top clubs said yes`);
  const reply = world.messages.find((m) => m.subject.includes('are not looking for a new coach'));
  assert.ok(reply !== undefined && reply.body.includes('greater standing'), 'the board says why');
});

test('a small club whose board has lost faith in its coach takes a bigger name — and the coach makes way', () => {
  const world = outOfWork(303);
  world.career.reputation = 8000;
  const small = coached(world).filter((c) => c.reputation < 3000).slice(0, 10);
  assert.ok(small.length >= 5);
  let offers = 0;
  for (const club of small) {
    club.boardConfidence = 20;
    club.coachSince = world.day - 200;
    assert.ok(interestChance(world, club) > 0.6, `${club.name} would want him`);
    world.career.applications = [];
    const before = world.career.offers.length;
    answered(world, club);
    if (world.career.offers.length > before) offers++;
  }
  assert.ok(offers >= small.length * 0.7, `${offers} of ${small.length} said yes`);
  const offer = world.career.offers[0];
  const club = world.clubs[offer.clubId];
  const coach = headCoachOf(world, club);
  assert.ok(coach !== undefined, 'the coach is still there until he says yes');
  assert.ok(acceptJobOffer(world, offer.id));
  assert.equal(world.userClubId, club.id);
  assert.equal(headCoachOf(world, club), undefined, 'his predecessor is gone');
});

test('a board happy with its coach is far harder to turn than one that is not', () => {
  const world = outOfWork(304);
  world.career.reputation = 5000;
  const club = coached(world).find((c) => c.reputation < 5500 && c.reputation > 3000)!;
  club.coachSince = world.day - 200;
  club.boardConfidence = 80;
  const happy = changeAppetite(world, club);
  club.boardConfidence = 25;
  const fed = changeAppetite(world, club);
  assert.ok(happy < 0.15 && fed > 0.5, `${happy} vs ${fed}`);
  // A coach just appointed is given his chance.
  club.coachSince = world.day - 5;
  assert.ok(changeAppetite(world, club) < fed);
});

test(`no more than ${MAX_APPROACHES} approaches wait on an answer at once`, () => {
  const world = outOfWork(305);
  const clubs = coached(world).slice(10, 10 + MAX_APPROACHES + 1);
  for (const c of clubs.slice(0, MAX_APPROACHES)) assert.ok(approachClub(world, c.id) !== null);
  const last = clubs[MAX_APPROACHES];
  assert.ok(interestBlock(world, last.id) !== null);
  assert.equal(approachClub(world, last.id), null);
  assert.equal(approachClub(world, clubs[0].id), null, 'one approach per club');
});
