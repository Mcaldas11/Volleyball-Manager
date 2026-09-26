import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import {
  contractEndSeason, DAYS_PER_SEASON, nextTransferWindow, seasonEndDay, stubManager, transferWindowOn,
  windowCloseDay,
} from './world.ts';
import {
  contractDemands, generateIncomingOffers, respondToOffer, SquadRole, TALKS_PATIENCE, yearsLeft,
} from './negotiation.ts';
import { contractNotices } from './contracts.ts';
import { endSeason } from '../season/rollover.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason } from '../season/seasonEngine.ts';

test('transfer windows follow the football calendar: 1 July – 1 September and January', () => {
  assert.equal(transferWindowOn(0)?.name, 'summer'); // 1 July
  assert.equal(transferWindowOn(62)?.name, 'summer'); // 1 September
  assert.equal(transferWindowOn(63), null); // 2 September
  assert.equal(transferWindowOn(183), null); // 31 December
  assert.equal(transferWindowOn(184)?.name, 'winter'); // 1 January
  assert.equal(transferWindowOn(214)?.name, 'winter'); // 31 January
  assert.equal(transferWindowOn(215), null); // 1 February
  assert.equal(transferWindowOn(DAYS_PER_SEASON)?.name, 'summer', 'every season');

  assert.equal(windowCloseDay(10), 62);
  assert.equal(windowCloseDay(100), null);
  assert.deepEqual(nextTransferWindow(100), { window: { name: 'winter', opens: 184, closes: 214 }, day: 184 });
  assert.equal(nextTransferWindow(300).day, DAYS_PER_SEASON);
});

test('every contract runs to 30 June', () => {
  assert.equal(seasonEndDay(0), 364);
  assert.equal(contractEndSeason(seasonEndDay(3)), 3);

  const world = generateWorld({ seed: 21, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  for (const club of world.clubs) {
    for (const p of club.players) {
      assert.equal(store.contractUntil[p] % DAYS_PER_SEASON, DAYS_PER_SEASON - 1, 'ends on the last day of a season');
      assert.ok(contractEndSeason(store.contractUntil[p]) >= world.season);
    }
  }
});

test('a player answers offers: accepts his demands, counters a near miss, walks out when pushed', () => {
  const world = generateWorld({ seed: 22, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs[0];
  const p = world.clubs[1].players[0];
  const d = contractDemands(world, club, p, false);
  assert.ok(d.wage >= 4000 && d.floorWage <= d.wage);
  assert.ok(d.minYears >= 1 && d.maxYears >= d.minYears);

  const years = d.minYears;
  const yes = respondToOffer(d, { wage: d.wage, role: d.role, years }, TALKS_PATIENCE);
  assert.equal(yes.outcome, 'accepted');

  // Just under: he counters and comes down a little, but never below his floor.
  const close = respondToOffer(d, { wage: Math.round(d.wage * 0.92), role: d.role, years }, TALKS_PATIENCE);
  assert.equal(close.outcome, 'counter');
  assert.equal(close.gap, 'close');
  assert.equal(close.patience, TALKS_PATIENCE - 1);
  assert.ok(close.demands.wage < d.wage && close.demands.wage >= d.floorWage);

  // A contract outside the length he will sign is refused even at his wage.
  if (d.maxYears < 5) {
    const tooLong = respondToOffer(d, { wage: d.wage, role: d.role, years: d.maxYears + 3 }, TALKS_PATIENCE);
    assert.notEqual(tooLong.outcome, 'accepted');
  }

  // Insulting offers cost twice the patience; enough of them and he walks.
  let patience = TALKS_PATIENCE;
  let outcome = '';
  for (let i = 0; i < TALKS_PATIENCE && outcome !== 'walkout'; i++) {
    const r = respondToOffer(d, { wage: Math.round(d.wage * 0.4), role: SquadRole.Backup, years }, patience);
    outcome = r.outcome;
    patience = r.patience;
  }
  assert.equal(outcome, 'walkout');
});

test('a renewal has to run past the current contract', () => {
  const world = generateWorld({ seed: 23, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs[0];
  const p = club.players[0];
  world.players.contractUntil[p] = seasonEndDay(world.season + 1);
  const d = contractDemands(world, club, p, true);
  assert.equal(yearsLeft(world, p), 2);
  assert.ok(d.minYears >= 3, 'a new deal ends after the old one');
});

test('the user\'s unrenewed contracts expire and the players leave; renewed ones stay', () => {
  const world = generateWorld({ seed: 24, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  const [leaving, staying] = club.players;
  store.contractUntil[leaving] = seasonEndDay(world.season);
  store.contractUntil[staying] = seasonEndDay(world.season + 2);

  const ctx = newSeasonContext();
  startSeason(world, ctx);
  simulateRestOfSeason(world, ctx);
  endSeason(world, ctx);

  assert.notEqual(store.clubId[leaving], club.id, 'an expired contract is not renewed for the user');
  assert.ok(!club.players.includes(leaving));
  assert.equal(store.clubId[staying], club.id);
  assert.ok(world.messages.some((m) => m.category === 'contract' && m.body.includes(store.fullName(leaving))));
  // Nobody at the club is left on a contract that has already run out.
  for (const q of club.players) assert.ok(contractEndSeason(store.contractUntil[q]) >= world.season);
});

test('the inbox hears about windows opening and closing, and contracts entering their last six months', () => {
  const world = generateWorld({ seed: 25, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const club = world.clubs[0];
  world.userClubId = club.id;
  const expiring = club.players[0];
  store.contractUntil[expiring] = seasonEndDay(world.season);
  const safe = club.players[1];
  store.contractUntil[safe] = seasonEndDay(world.season + 1);

  const at = (day: number): string[] => {
    const before = world.messages.length;
    world.day = day;
    contractNotices(world);
    return world.messages.slice(before).map((m) => m.subject);
  };
  assert.deepEqual(at(0), ['Transfer window open']);
  assert.deepEqual(at(63), ['Transfer window closed']);
  const january = at(184);
  assert.ok(january.includes('Transfer window open'));
  assert.ok(january.includes(`Contract expiring: ${store.fullName(expiring)}`));
  assert.ok(!january.includes(`Contract expiring: ${store.fullName(safe)}`));
  assert.deepEqual(at(215), ['Transfer window closed']);
  assert.deepEqual(at(304), ['Contracts running out']);
  assert.deepEqual(at(100), []);
});

test('no club bids for the user\'s players while the window is shut', () => {
  const world = generateWorld({ seed: 26, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  world.day = 100; // October
  for (let i = 0; i < 200; i++) generateIncomingOffers(world);
  assert.equal(world.incomingOffers.length, 0);

  world.day = 10; // July: bids lapse by the time the window shuts
  for (let i = 0; i < 200 && world.incomingOffers.length === 0; i++) generateIncomingOffers(world);
  for (const o of world.incomingOffers) assert.ok(o.expiresOnDay <= 63);
});
