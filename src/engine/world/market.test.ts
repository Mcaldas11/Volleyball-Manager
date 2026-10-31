import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SQUAD } from '../model/positions.ts';
import { openTalks, processDeals, submitOffer } from './deals.ts';
import { deadlineDay, deadlineMorning, rumoursAboutUs } from './market.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager, TRANSFER_WINDOWS, type World } from './world.ts';

function setup(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12 && c.players.length < MAX_SQUAD && c.reputation < 6000)!;
  world.userClubId = club.id;
  club.finances.balance = 20_000_000;
  club.finances.transferBudget = 20_000_000;
  club.finances.wageBudget = 50_000_000;
  return { world, club };
}

test('the papers link the manager\'s best players with bigger clubs — and an ambitious one\'s head turns', () => {
  const { world, club } = setup(171);
  const store = world.players;
  for (const p of club.players) store.setAttr(p, 'ambition', 18);
  for (let d = 0; d < 200 && !world.news.some((n) => n.kind === 'rumour' && n.otherClubId === club.id); d++) {
    world.day++;
    rumoursAboutUs(world);
  }
  const story = world.news.find((n) => n.kind === 'rumour' && n.otherClubId === club.id)!;
  assert.ok(story !== undefined && club.players.includes(story.playerIdx!));
  assert.ok(world.clubs[story.clubId!].reputation > club.reputation);
  assert.ok(world.messages.some((m) => m.subject.endsWith('head turned?')));
});

test('a rival\'s formal bid for the manager\'s target: beat it, or lose him', () => {
  const { world, club } = setup(172);
  world.day = 10;
  const seller = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const rival = world.clubs.find((c) => c.id !== club.id && c.id !== seller.id && c.players.length > 0)!;
  rival.finances.balance = 50_000_000;
  // A rival may just as well sign him outright before it ever bids: then it is his team-mate's turn.
  let p = -1;
  let t: ReturnType<typeof openTalks> | undefined;
  for (const candidate of seller.players.slice(1, 6)) {
    p = candidate;
    t = openTalks(world, club, p, 'transfer');
    t.rivals = [{ clubId: rival.id, wage: world.players.wage[p] }];
    for (let d = 0; d < 200 && t.rivalBid === undefined && world.talks.includes(t); d++) { world.day++; processDeals(world); }
    if (t.rivalBid !== undefined) break;
  }
  assert.ok(t !== undefined && t.rivalBid !== undefined, 'a rival tables a bid');
  assert.ok(world.messages.some((m) => m.subject === `Rival bid for ${world.players.fullName(p)}`));
  // Under it: no.
  submitOffer(world, t, { ...t.lastOffer, fee: t.rivalBid!.fee - 1000 });
  for (let d = 0; d < 4 && t.pending !== null; d++) { world.day++; processDeals(world); }
  assert.equal(t.stage, 'fee');
  assert.ok(world.messages.some((m) => m.subject.startsWith('Bid rejected') && m.body.includes('beat it')));
  // Over it: his.
  submitOffer(world, t, { ...t.lastOffer, fee: t.rivalBid!.fee + 1000 });
  for (let d = 0; d < 4 && t.pending !== null; d++) { world.day++; processDeals(world); }
  assert.equal(t.stage, 'terms');
  assert.equal(t.rivalBid, undefined);

  // Left unanswered, the rival gets him.
  const q = seller.players.find((x) => x !== p)!;
  const t2 = openTalks(world, club, q, 'transfer');
  t2.rivals = [{ clubId: rival.id, wage: world.players.wage[q] }];
  t2.rivalBid = { clubId: rival.id, fee: world.players.value[q], until: world.day + 1 };
  for (let d = 0; d < 4 && world.talks.includes(t2); d++) { world.day++; processDeals(world); }
  assert.ok(!world.talks.includes(t2));
  assert.ok(world.players.clubId[q] === rival.id || world.pendingMoves.some((m) => m.playerIdx === q && m.toClubId === rival.id));
});

test('deadline day: the manager hears that morning, every answer comes that day, the late deals make the papers', () => {
  const { world, club } = setup(173);
  const close = TRANSFER_WINDOWS[0].closes + DAYS_PER_SEASON * world.season;
  world.day = close;
  const seller = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const t = openTalks(world, club, seller.players[3], 'transfer');
  t.rivals = [];
  submitOffer(world, t, { ...t.lastOffer, fee: world.players.value[seller.players[3]] * 2 });
  t.pending!.resolvesOn = close + 3;
  deadlineMorning(world);
  assert.ok(world.messages.some((m) => m.subject === 'Deadline day'));
  assert.equal(t.pending!.resolvesOn, close, 'answered today');
  // Squads with a player to spare: the late business.
  for (const c of world.clubs) c.finances.balance = Math.max(c.finances.balance, 5_000_000);
  deadlineDay(world);
  processDeals(world);
  assert.equal(t.pending, null, 'the answer came');
  assert.ok(world.news.some((n) => n.headline.startsWith('Deadline day:')), 'the papers round it up');
  // Not on another day.
  const news = world.news.length;
  world.day = close - 1;
  deadlineDay(world);
  assert.equal(world.news.length, news);
});
