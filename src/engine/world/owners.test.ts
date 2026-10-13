import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askBlock, askOwner, demandProgress, noteTrophy, ownerDay, ownerMeans, ownerOf, ownerSeasonEnd, ownerSeasonStart,
} from './owners.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function setup(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  return { world, club };
}

test('every club has an owner, the same one until it is sold — big clubs draw the money', () => {
  const { world } = setup(141);
  const kinds = new Map<string, number>();
  for (const c of world.clubs) {
    const o = ownerOf(world, c);
    assert.equal(ownerOf(world, c), o, 'kept');
    assert.ok(o.wealth >= 1 && o.wealth <= 5 && o.patience >= 1 && o.patience <= 5 && o.ambition >= 1 && o.ambition <= 5);
    if (c.reputation > 7000) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1);
  }
  const rich = (kinds.get('tycoon') ?? 0) + (kinds.get('consortium') ?? 0);
  const total = [...kinds.values()].reduce((s, x) => s + x, 0);
  assert.ok(rich / total > 0.4, `${rich} of ${total} big clubs owned by money`);
});

test('the owner\'s wish for the season: set when the manager arrives, judged at the end', () => {
  const { world, club } = setup(142);
  ownerDay(world);
  const d = club.ownerDemand!;
  assert.ok(d !== undefined && d.season === world.season);
  assert.ok(world.messages.some((m) => m.subject === 'The owner\'s wish for the season'));
  // Make it a trophy, and win one.
  d.kind = 'trophy';
  assert.equal(demandProgress(world, club).done, false);
  noteTrophy(world, club.id);
  assert.equal(demandProgress(world, club).done, true);
  const before = club.boardConfidence;
  const goodwill = ownerOf(world, club).goodwill;
  ownerSeasonEnd(world);
  assert.equal(d.met, true);
  assert.ok(club.boardConfidence > before && ownerOf(world, club).goodwill > goodwill);

  // A profit missed.
  world.season++;
  ownerDay(world);
  club.ownerDemand!.kind = 'profit';
  club.finances.balance = club.ownerDemand!.startBalance - 100_000;
  const conf = club.boardConfidence;
  ownerSeasonEnd(world);
  assert.equal(club.ownerDemand!.met, false);
  assert.ok(club.boardConfidence < conf);
  assert.ok(world.messages.some((m) => m.subject === 'The owner is disappointed'));
});

test('asking him for money: an answer in days — yes puts it in, no is final for a while, and more than he has is no', () => {
  const { world, club } = setup(143);
  const o = ownerOf(world, club);
  o.wealth = 5; o.ambition = 5; o.goodwill = 95;
  club.boardConfidence = 95;
  const means = ownerMeans(world, club);
  const balance = club.finances.balance;
  assert.match(askOwner(world, club, Math.round(means / 2)), /You have asked/);
  assert.ok(askBlock(world, club) !== null, 'one request at a time');
  for (let d = 0; d < 8 && club.ownerAsk !== undefined; d++) { world.day++; ownerDay(world); }
  assert.equal(club.ownerAsk, undefined, 'answered');
  assert.equal(club.finances.balance, balance + Math.round(means / 2), 'a rich, keen owner says yes');
  assert.ok(o.goodwill < 95, 'and it costs goodwill');

  // More than his means: no, and not again for a while.
  askOwner(world, club, means * 3);
  for (let d = 0; d < 8 && club.ownerAsk !== undefined; d++) { world.day++; ownerDay(world); }
  assert.ok(world.messages.some((m) => m.subject === 'The owner says no'));
  assert.match(askBlock(world, club)!, /ask again in/);
});

test('a rich owner covers a season in the red; and now and then the club changes hands', () => {
  const { world, club } = setup(144);
  const o = ownerOf(world, club);
  o.wealth = 4;
  club.finances.balance = -50_000;
  ownerSeasonEnd(world);
  assert.ok(club.finances.balance >= 0, 'covered');
  assert.ok(world.messages.some((m) => m.subject === 'The owner covers the losses'));

  // In debt, an owner who has had enough: sooner or later someone buys the club.
  let sold = false;
  for (let s = 1; s < 80 && !sold; s++) {
    world.season = s;
    ownerOf(world, club).goodwill = 10;
    club.finances.balance = -10_000;
    const was = club.owner;
    ownerSeasonStart(world);
    sold = club.owner !== was;
  }
  assert.ok(sold, 'a takeover');
  assert.ok(world.messages.some((m) => m.subject.startsWith('Takeover: ')));
  assert.equal(club.ownerDemand!.season, world.season, 'the new man sets his own wish');
});
