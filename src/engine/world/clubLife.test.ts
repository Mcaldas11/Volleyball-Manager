import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRatings } from '../match/ratings.ts';
import { ATTR_COUNT, ATTR_INDEX } from '../model/attributes.ts';
import { Position } from '../model/positions.ts';
import { hasTrait, rollTraits, Trait, traitsOf } from '../model/traits.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { affiliateCandidates, affiliatesDay, isAffiliate, proposeAffiliation } from './affiliates.ts';
import { appointManager } from './career.ts';
import { chooseSponsor, crowdAt, projectedGate, sponsorBonus, sponsorDay } from './commercial.ts';
import { loanToAffiliate } from './deals.ts';
import { cohesionEdge, dressingRoom, noteDeparture } from './dressingRoom.ts';
import { facilitiesDay, facilityLevel, requestUpgrade, upgradeBlock } from './facilities.ts';
import { loanOf } from './loans.ts';
import { evaluateFeeOffer } from './negotiation.ts';
import { answerTransferRequest, playerHappinessWeek, talkToPlayer } from './playerTalks.ts';
import { giveTalk, type TalkContext } from './teamTalk.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function managed(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[1];
  appointManager(world, club.id);
  return { world, club };
}

/** Days go by, with the jobs these features run each day. */
function days(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    world.day++;
    facilitiesDay(world);
    sponsorDay(world);
    affiliatesDay(world);
  }
}

test('traits: earned by the attributes behind them, kept, and a few per cent on the skill they are about', () => {
  const { world, club } = managed(61);
  const store = world.players;
  const setter = club.players.find((p) => store.position[p] === Position.Setter)!;
  store.traits[setter] = 0;
  const row = setter * ATTR_COUNT;
  store.attrs[row + ATTR_INDEX.setting] = 20;
  store.attrs[row + ATTR_INDEX.teamwork] = 20;
  rollTraits(store, setter);
  assert.ok(hasTrait(store.traits[setter], Trait.FloorGeneral), 'a setter that good runs the floor');
  const mask = store.traits[setter];
  rollTraits(store, setter);
  assert.equal(store.traits[setter], mask, 'the same throw every time');
  assert.ok(traitsOf(store, setter).length <= 3);
  // With the trait, he sets better than the same numbers without it.
  const withIt = computeRatings(store, setter, Position.Setter).setting;
  store.traits[setter] = 0;
  const without = computeRatings(store, setter, Position.Setter).setting;
  assert.ok(withIt > without);
});

test('the dressing room: its leaders, its cohesion — and a leader leaving shakes it', () => {
  const { world, club } = managed(62);
  const room = dressingRoom(world, club);
  assert.equal(room.members.filter((m) => m.tier === 'leader').length, 3);
  assert.ok(room.members[0].influence >= room.members[room.members.length - 1].influence);
  assert.ok(room.cohesion >= 5 && room.cohesion <= 100);
  assert.ok(cohesionEdge(100) > 1 && cohesionEdge(5) < 1 && Math.abs(cohesionEdge(60) - 1) < 1e-9);
  const leader = room.members[0].p;
  noteDeparture(world, club, leader);
  assert.ok(dressingRoom(world, club).cohesion < room.cohesion, 'losing a leader unsettles it');
  assert.ok(world.messages.some((m) => m.subject.includes('departure')));
});

test('team talks: praise after a set won lands, criticism after one won annoys, and the same words again lose their edge', () => {
  const { world, club } = managed(63);
  const six = club.players.slice(0, 7);
  const won: TalkContext = { moment: 'setbreak', favourite: 0, setsFor: 1, setsAgainst: 0, lastSet: { won: true, margin: 5 }, importance: 0.5 };
  const praise = giveTalk(world, club, six, 'praise', won, false, 1);
  const criticise = giveTalk(world, club, six, 'criticise', won, false, 2);
  assert.ok(praise.team > criticise.team);
  assert.ok(praise.multiplier > 1 && criticise.multiplier < 1);
  assert.ok(criticise.reactions.some((r) => r.label === 'Annoyed'));
  const again = giveTalk(world, club, six, 'praise', won, true, 1);
  assert.ok(again.team < praise.team, 'stale');
  // Telling big favourites you expect a win suits them better than telling underdogs.
  const fav: TalkContext = { moment: 'prematch', favourite: 0.8, setsFor: 0, setsAgainst: 0, importance: 0.5 };
  const dog: TalkContext = { ...fav, favourite: -0.8 };
  assert.ok(giveTalk(world, club, six, 'demand', fav, false, 3).team > giveTalk(world, club, six, 'demand', dog, false, 3).team);
});

test('one-to-one: praise in form lifts him; a promise kept or broken; a player kept unhappy asks to leave', () => {
  const { world, club } = managed(64);
  const store = world.players;
  const [a, b, c] = club.players;
  world.ratingForm.set(a, [7.2, 7.5, 7.0]);
  store.morale[a] = 50;
  const praise = talkToPlayer(world, club, a, 'praise');
  assert.ok(praise.ok && store.morale[a] > 50);
  assert.match(praise.reply, /noticed/, 'in his own words, as he would say it');
  assert.match(talkToPlayer(world, club, a, 'mood').reply, /\./, 'how he is, said back');
  assert.equal(talkToPlayer(world, club, a, 'encourage').ok, false, 'not twice in a fortnight');

  store.playingTime[b] = 10;
  store.morale[b] = 50;
  assert.equal(talkToPlayer(world, club, b, 'promise').ok, true);
  world.day += 60;
  playerHappinessWeek(world);
  assert.ok(world.messages.some((m) => m.subject.includes('a promise broken')));
  assert.ok(store.morale[b] < 50);

  store.morale[c] = 10;
  for (let w = 0; w < 5; w++) playerHappinessWeek(world);
  assert.equal(world.transferRequests?.[c]?.status, 'open');
  assert.ok(world.messages.some((m) => m.transferRequestOf === c));
  answerTransferRequest(world, c, 'list');
  assert.equal(world.transferRequests?.[c]?.status, 'listed');
});

test('facilities: the board answers in days — yes with the money and the trust, then the builders; no, and not again for a while', () => {
  const { world, club } = managed(65);
  const level = facilityLevel(club, 'medical');
  club.finances.balance = 50_000_000;
  club.boardConfidence = 70;
  requestUpgrade(world, club, 'medical');
  assert.equal(club.facilityProject?.stage, 'asked');
  days(world, 7);
  assert.equal(club.facilityProject?.stage, 'building');
  days(world, 400);
  assert.equal(facilityLevel(club, 'medical'), level + 1);
  assert.equal(club.facilityProject, undefined);
  // Broke: no.
  club.finances.balance = 0;
  requestUpgrade(world, club, 'training');
  days(world, 7);
  assert.equal(club.facilityProject, undefined);
  assert.match(upgradeBlock(world, club, 'training') ?? '', /turned it down/);
});

test('tickets and sponsors: a cheaper ticket fills the arena; the summer\'s offers, one signed, a bonus for a title', () => {
  const { world, club } = managed(66);
  assert.ok(crowdAt(1000, 0.7) > crowdAt(1000, 1) && crowdAt(1000, 1.4) < crowdAt(1000, 1));
  assert.ok(projectedGate(world, club, 0.7).crowd >= projectedGate(world, club, 1.4).crowd);
  days(world, 1);
  assert.equal(world.sponsorOffers?.offers.length, 3);
  chooseSponsor(world, club, 1);
  assert.equal(club.sponsor?.kind, 'bonus');
  assert.equal(club.finances.sponsorshipIncome, club.sponsor?.base);
  const before = club.finances.sponsorshipIncome;
  assert.ok(sponsorBonus(world, club, 1) > 0);
  assert.ok(club.finances.sponsorshipIncome > before);
});

test('affiliates: a smaller club says yes, lets its players go a quarter cheaper, and takes the club\'s on loan', () => {
  const { world, club } = managed(67);
  club.reputation = 9000;
  // The smallest name on the list.
  const target = affiliateCandidates(world, club).at(-1)!;
  proposeAffiliation(world, club, target);
  for (let i = 0; i < 10 && !isAffiliate(club, target.id); i++) days(world, 1);
  assert.ok(isAffiliate(club, target.id), 'a club that much smaller agrees');
  const theirs = target.players[0];
  const full = evaluateFeeOffer(world, target, theirs, 1).valuation;
  const cheap = evaluateFeeOffer(world, target, theirs, 1, 0.75).valuation;
  assert.ok(cheap < full);
  // A young one of ours goes there on loan, if he will.
  const store = world.players;
  const young = club.players.slice().sort((a, b) => store.ageOn(a, world.year, 181) - store.ageOn(b, world.year, 181))[0];
  store.contractUntil[young] = 1_000_000;
  const text = loanToAffiliate(world, club, young, target.id);
  assert.ok(/on loan/.test(text) || /doesn't want/.test(text), text);
  if (/has gone/.test(text)) assert.equal(loanOf(world, young)?.loanClubId, target.id);
});
