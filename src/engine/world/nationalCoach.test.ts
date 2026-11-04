import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import {
  acceptNationalOffer, counterNationalOffer, expressNationalInterest, nationalCoachName, nationalInterestBlock,
  nationalOfferTerms, offerNationalJob, worldRanking,
} from './internationals.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function career(): { world: World; ctx: ReturnType<typeof newSeasonContext>; nation: number } {
  const world = generateWorld({ seed: 52, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  const I = world.internationals!;
  const nation = worldRanking(world).find((n) => !I.vacancies.some((v) => v.nation === n) && n !== world.manager.nation)!;
  return { world, ctx, nation };
}

test('every nation with a coach has a name for him, the same each time; an open job has none', () => {
  const { world, nation } = career();
  const name = nationalCoachName(world, nation);
  assert.ok(name !== null && name.includes(' '));
  assert.equal(nationalCoachName(world, nation), name);
  const open = world.internationals!.vacancies[0];
  if (open !== undefined) assert.equal(nationalCoachName(world, open.nation), null);
});

test('the manager can tell a federation with a coach he is interested: it answers, and not again soon', () => {
  const { world, ctx, nation } = career();
  world.career.reputation = 10000;
  assert.equal(nationalInterestBlock(world, nation), null);
  const answerOn = expressNationalInterest(world, nation)!;
  assert.ok(answerOn > world.day);
  assert.notEqual(nationalInterestBlock(world, nation), null, 'waiting on the answer');
  assert.equal(expressNationalInterest(world, nation), null);
  const before = world.messages.length;
  while (world.day <= answerOn) advanceDay(world, ctx);
  const I = world.internationals!;
  assert.equal(I.applications.some((a) => a.nation === nation), false, 'answered');
  const offered = I.offers.some((o) => o.nation === nation);
  const answered = world.messages.slice(before).some((m) => m.nationalOffer?.nation === nation || m.subject.includes('thank you for your interest'));
  assert.ok(answered, 'an offer or a polite no');
  if (!offered) assert.notEqual(nationalInterestBlock(world, nation), null, 'not again so soon');
});

test('an offer has terms to haggle over: within its means a federation agrees, beyond them it comes part of the way, then says its last word', () => {
  const { world, nation } = career();
  const offer = offerNationalJob(world, nation, true);
  const start = nationalOfferTerms(world, offer);
  assert.ok(start.wage > 0 && start.untilSeason >= world.season);
  const ceiling = offer.ceiling!;
  assert.ok(ceiling > start.wage);

  const up = counterNationalOffer(world, offer.id, Math.round(ceiling * 1.3), start.untilSeason);
  assert.equal(up.outcome, 'counter');
  assert.ok(offer.terms!.wage > start.wage && offer.terms!.wage <= ceiling, 'part of the way');
  assert.equal(counterNationalOffer(world, offer.id, Math.round(ceiling * 1.3), start.untilSeason).outcome, 'counter');
  const last = counterNationalOffer(world, offer.id, Math.round(ceiling * 1.3), start.untilSeason);
  assert.equal(last.outcome, 'final');
  assert.equal(offer.terms!.wage, ceiling);

  const fair = counterNationalOffer(world, offer.id, ceiling, world.season + 20);
  assert.equal(fair.outcome, 'agreed');
  assert.ok(offer.terms!.untilSeason <= world.season + 3, 'no longer than it signs anyone for');

  // Signing it: the contract goes with the job — and the man who had it makes way.
  const terms = { ...offer.terms! };
  assert.equal(acceptNationalOffer(world, offer.id), true);
  const job = world.career.nationalJobs!.find((j) => j.nation === nation && j.endDay < 0)!;
  assert.deepEqual(job.contract, terms);
  assert.equal(nationalCoachName(world, nation), `${world.manager.firstName} ${world.manager.lastName}`);
});

test('asking far too much, more than once, and the federation walks away', () => {
  const { world, nation } = career();
  const offer = offerNationalJob(world, nation, true);
  nationalOfferTerms(world, offer);
  const greedy = Math.round(offer.ceiling! * 3);
  assert.equal(counterNationalOffer(world, offer.id, greedy, world.season).outcome, 'counter');
  assert.equal(counterNationalOffer(world, offer.id, greedy, world.season).outcome, 'withdrawn');
  assert.equal(world.internationals!.offers.some((o) => o.id === offer.id), false);
});
