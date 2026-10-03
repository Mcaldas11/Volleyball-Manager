import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager, type SeasonRecord, type World } from './world.ts';
import {
  acceptContractOffer, acceptJobOffer, appointManager, askForContract, careerDay, contractAskBlock, currentJob,
  declineContractOffer, marketWage, seasonReckoning,
} from './career.ts';
import { messageNeedsAction } from './inbox.ts';
import { clubBooks } from '../season/books.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';

function hired(seed: number): World {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return world;
}

/** The board's days from `from` to `to` of the season, nothing else moving. */
function boardDays(world: World, from: number, to: number, until: () => boolean = () => false): void {
  const start = world.season * DAYS_PER_SEASON;
  for (let d = from; d <= to && !until(); d++) {
    world.day = start + d;
    careerDay(world);
  }
}

function emptyRecord(world: World): SeasonRecord {
  return {
    season: world.season, year: world.year, champions: [], playerOfTheYear: -1, topScorer: { player: -1, points: 0 },
    youngPlayerOfTheYear: -1, mostImproved: { player: -1, gain: 0 }, youngestPlayer: -1, dissolved: [],
  };
}

test('a job comes with a contract to the end of next season, paid as the club can afford', () => {
  const world = hired(401);
  const job = currentJob(world)!;
  assert.ok(job.contract !== undefined);
  assert.equal(job.contract.untilSeason, world.season + 1);
  assert.ok(job.contract.wage > 0);
  const clubs = [...world.clubs].sort((a, b) => a.reputation - b.reputation);
  assert.ok(marketWage(clubs[clubs.length - 1], 0) > marketWage(clubs[0], 0), 'a big club pays more');

  // On the club's books, in place of the coach he replaced.
  const club = world.clubs[world.userClubId];
  const staff = club.staff.reduce((s, id) => s + (world.staff[id]?.wage ?? 0), 0);
  assert.equal(clubBooks(world, club).costs.find(([k]) => k === 'Staff wages')![1], staff + job.contract.wage);
});

test('a job taken comes on the terms the club offered', () => {
  const world = hired(402);
  const to = world.clubs.find((c) => c.id !== world.userClubId && c.tier === 1)!;
  const terms = { wage: 123_000, untilSeason: world.season + 2 };
  world.career.offers.push({ id: 99, clubId: to.id, madeOn: world.day, expiresOn: world.day + 5, applied: false, contract: terms });
  assert.equal(acceptJobOffer(world, 99), true);
  assert.deepEqual(currentJob(world)!.contract, terms);
});

test('a happy board offers a new contract in his last season — longer, and better paid', () => {
  const world = hired(403);
  const job = currentJob(world)!;
  const club = world.clubs[world.userClubId];
  job.contract!.untilSeason = world.season;
  job.startDay = -DAYS_PER_SEASON;
  club.boardConfidence = 70;
  const old = { ...job.contract! };

  boardDays(world, 60, 300, () => world.career.contractOffer != null);
  const offer = world.career.contractOffer;
  assert.ok(offer != null, 'the board raised it by the spring');
  assert.ok(offer.terms.untilSeason > old.untilSeason);
  assert.ok(offer.terms.wage > old.wage);
  const msg = world.messages.find((m) => m.contractOfferId === offer.id)!;
  assert.ok(messageNeedsAction(world, msg));

  assert.equal(acceptContractOffer(world), true);
  assert.deepEqual(job.contract, offer.terms);
  assert.equal(world.career.contractOffer, null);
  assert.ok(!messageNeedsAction(world, msg));
});

test('a board that would rather not keep him says so by the spring, and the contract runs out with the season', () => {
  const world = hired(404);
  const job = currentJob(world)!;
  const club = world.clubs[world.userClubId];
  job.contract!.untilSeason = world.season;
  job.startDay = -DAYS_PER_SEASON;
  club.boardConfidence = 35;

  boardDays(world, 60, 300);
  assert.equal(world.career.contractOffer ?? null, null);
  assert.ok(world.messages.some((m) => m.subject === 'Your contract will not be renewed'));
  world.day += 40;
  assert.match(askForContract(world), /results improve/);

  seasonReckoning(world, emptyRecord(world), new Map());
  assert.equal(world.userClubId, -1);
  assert.equal(world.career.jobs[world.career.jobs.length - 1].exit, 'expired');
  assert.ok(world.messages.some((m) => /contract with .* has ended/.test(m.subject)));
});

test('he can ask: two seasons left and the board waits, unless it is delighted — and he waits to ask again', () => {
  const world = hired(405);
  const job = currentJob(world)!;
  const club = world.clubs[world.userClubId];
  assert.match(askForContract(world), /only just signed/);
  world.day += 121;
  job.contract!.untilSeason = world.season + 2;
  club.boardConfidence = 60;

  assert.match(askForContract(world), /no reason to discuss it yet/);
  assert.match(contractAskBlock(world)!, /so soon/);
  world.day += 31;
  club.boardConfidence = 85;
  assert.equal(contractAskBlock(world), null);
  assert.match(askForContract(world), /offered you a new contract/);
  assert.ok(world.career.contractOffer!.terms.untilSeason > world.season + 2);

  // Turned down, the board leaves it there for the season.
  declineContractOffer(world);
  assert.equal(world.career.contractOffer, null);
  boardDays(world, 60, 300);
  assert.equal(world.career.contractOffer ?? null, null);
});
