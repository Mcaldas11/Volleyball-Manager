import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/world/worldGen.ts';
import { seasonEndDay, stubManager } from '../engine/world/world.ts';
import { newSeasonContext, playFixture, startSeason } from '../engine/season/seasonEngine.ts';
import { reviveSeason, reviveWorld } from './persistence.ts';
import { GATE_RESCALE } from '../engine/model/club.ts';

test('world round-trips through structuredClone with prototypes restored', () => {
  const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager(3) });

  const nameBefore = world.players.fullName(0);
  world.rng.next(); // advance state so it differs from a fresh Rng
  const stateBefore = world.rng.getState();
  const nameId = world.players.names.intern('Round Trip Test');

  const revived = reviveWorld(structuredClone(world));

  // Prototype methods work again.
  assert.equal(revived.players.fullName(0), nameBefore);
  assert.equal(typeof revived.rng.next, 'function');
  assert.deepEqual(revived.rng.getState(), stateBefore);
  assert.equal(revived.players.names.get(nameId), 'Round Trip Test');

  // Plain-data structures survive natively.
  assert.ok(revived.fixturesByDay instanceof Map);
  assert.equal(revived.fixturesByDay.size, world.fixturesByDay.size);
  assert.equal(revived.clubs.length, world.clubs.length);
  assert.equal(revived.manager.firstName, 'Alex');
  assert.equal(revived.manager.nation, 3);
});

test('reviveWorld backfills fields added after a save was written', () => {
  const world = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager() });
  // Simulate a save written before the playoff system existed: strip the
  // field entirely, the way an old IndexedDB blob would arrive.
  for (const comp of world.competitions) delete (comp as { playoffGroups?: unknown }).playoffGroups;
  // Same for the pre-match interview system.
  const stripped = world as { pendingInterviews?: unknown; interviewedFixtures?: unknown };
  delete stripped.pendingInterviews;
  delete stripped.interviewedFixtures;

  const revived = reviveWorld(structuredClone(world));

  for (const comp of revived.competitions) {
    assert.ok(Array.isArray(comp.playoffGroups), `competition ${comp.id} missing playoffGroups after revive`);
  }
  assert.ok(Array.isArray(revived.pendingInterviews));
  assert.ok(revived.interviewedFixtures instanceof Set);
});

test('reviveWorld moves an old-order default lineup into the corrected rotational order', () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs[0];
  const [s, oh1, mb1, opp, oh2, mb2] = club.preferredLineup;
  // How a save written before the fix stored it: S-MB-OH-OPP-MB-OH.
  club.preferredLineup = [s, mb1, oh1, opp, mb2, oh2];

  const revived = reviveWorld(structuredClone(world));
  assert.deepEqual(revived.clubs[0].preferredLineup, [s, oh1, mb1, opp, oh2, mb2]);
  // Already-correct lineups are left alone.
  assert.deepEqual(revived.clubs[1].preferredLineup, world.clubs[1].preferredLineup);
});

test('reviveWorld moves old contract days to the 30 June of the season they ran out in', () => {
  const world = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const [a, b, c] = world.clubs[0].players;
  // Old saves: a contract ran until the first rollover (season day 350) on or after its day.
  store.contractUntil[a] = 365; // 1 July 2027 -> ran out at the end of 2027/28
  store.contractUntil[b] = 350 + 2 * 365; // signed at a rollover for two seasons
  store.contractUntil[c] = seasonEndDay(3); // already aligned: left alone
  delete (world as { talksBlockedUntil?: unknown }).talksBlockedUntil;

  const revived = reviveWorld(structuredClone(world));
  assert.equal(revived.players.contractUntil[a], seasonEndDay(1));
  assert.equal(revived.players.contractUntil[b], seasonEndDay(2));
  assert.equal(revived.players.contractUntil[c], seasonEndDay(3));
  assert.ok(revived.talksBlockedUntil instanceof Map);
});

test('season stats survive a save and load', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const fixture = world.fixtures[0];
  playFixture(world, ctx, fixture, false);
  assert.ok(ctx.stats.size > 0, 'the match should have produced stat lines');

  // What saveGame() hands IndexedDB, through the same clone algorithm.
  const saved = structuredClone({ stats: ctx.stats, seasonStartAbility: ctx.seasonStartAbility });
  const revived = reviveSeason(world, saved);
  assert.ok(revived.stats instanceof Map);
  assert.deepEqual(revived.stats, ctx.stats);
  assert.deepEqual(revived.seasonStartAbility, ctx.seasonStartAbility);
});

test('a save from before seasons were kept loads with fresh leaderboards and a baseline for most improved', () => {
  const world = generateWorld({ seed: 6, startYear: 2026, scale: 'small', manager: stubManager() });
  const revived = reviveSeason(world, undefined);
  assert.equal(revived.stats.size, 0);
  assert.ok(revived.seasonStartAbility.size > 0);
  const [p] = revived.seasonStartAbility.keys();
  assert.equal(revived.seasonStartAbility.get(p), world.players.currentAbility[p]);
});

test('a women\'s world comes back from a save as the women\'s game — and a men\'s as the men\'s', async () => {
  const { NATIONS, nationStrength } = await import('../engine/world/nations.ts');
  const iran = NATIONS.findIndex((n) => n.code === 'IRI');
  const women = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager(3), gender: 'women' });
  const men = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager(3) });
  const menIran = nationStrength(iran);
  const back = reviveWorld(structuredClone(women));
  assert.equal(back.gender, 'women');
  assert.equal(back.players.women, true);
  assert.ok(nationStrength(iran) < menIran, 'the women\'s map');
  const menBack = reviveWorld(structuredClone(men));
  assert.equal(menBack.players.women, false);
  assert.equal(nationStrength(iran), menIran);
});

test('a save from before the gate was booked once has its gates brought up — once', () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  assert.equal(world.gateBooked, true, 'a new world is born with them');
  const old = structuredClone(world);
  delete old.gateBooked;
  for (const c of old.clubs) c.finances.ticketIncomePerMatch = 10_000;
  const back = reviveWorld(old);
  assert.equal(back.gateBooked, true);
  assert.ok(back.clubs.every((c) => c.finances.ticketIncomePerMatch === Math.round(10_000 * GATE_RESCALE)));
  // Loaded again, nothing more happens.
  const again = reviveWorld(structuredClone(back));
  assert.ok(again.clubs.every((c) => c.finances.ticketIncomePerMatch === Math.round(10_000 * GATE_RESCALE)));
  // A new world's gates are left as they were made.
  const fresh = reviveWorld(structuredClone(world));
  assert.deepEqual(fresh.clubs.map((c) => c.finances.ticketIncomePerMatch), world.clubs.map((c) => c.finances.ticketIncomePerMatch));
});

test("a save from before the FIVB's calendar keeps the old one for the season it is in", () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  assert.equal(world.fivbCalendarFrom, 0, 'a new world is the FIVB\'s from its first season');
  const old = structuredClone(world);
  delete old.fivbCalendarFrom;
  old.season = 4;
  assert.equal(reviveWorld(old).fivbCalendarFrom, 5);
});
