import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { ebbLoads, loadOf, noteMatchLoad, recoveryFactor, TRAVEL_COST, travelEve, tripTo } from './fatigue.ts';
import { NATIONS } from './nations.ts';
import { clubCity } from './rivals.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type Fixture } from './world.ts';

test('the away side travels the day before: a short trip, a long one across a big country, a flight abroad', () => {
  const world = generateWorld({ seed: 91, startYear: 2026, scale: 'small', manager: stubManager() });
  const nation = (code: string): number => NATIONS.findIndex((n) => n.code === code);
  const clubOf = (code: string, i = 0): number => world.clubs.filter((c) => c.nation === nation(code))[i].id;
  const fx = (home: number, away: number, neutralVenue = false): Fixture =>
    ({ home, away, neutralVenue } as unknown as Fixture);
  const [ita1, ita2, bra1, bra2] = [clubOf('ITA'), clubOf('ITA', 1), clubOf('BRA'), clubOf('BRA', 1)];
  assert.equal(tripTo(world, fx(ita1, ita2), ita1), null, 'at home');
  assert.equal(tripTo(world, fx(ita1, ita2), ita2), 'short');
  assert.equal(tripTo(world, fx(bra1, bra2), bra2), clubCity(world, world.clubs[bra1]) === clubCity(world, world.clubs[bra2]) ? 'short' : 'long', 'Brazil is a big country');
  const [x, y] = world.clubs.filter((c) => c.nation === nation('BRA')).flatMap((c) => world.clubs
    .filter((d) => d.id !== c.id && d.nation === c.nation && clubCity(world, d) === clubCity(world, c)).map((d) => [c.id, d.id]))[0];
  assert.equal(tripTo(world, fx(x, y), y), 'short', 'across town, even in Brazil');
  assert.equal(tripTo(world, fx(ita1, bra1), bra1), 'abroad');
  assert.equal(tripTo(world, fx(ita1, ita2, true), ita1), 'short', 'at a neutral venue both sides travel');

  // On the eve of a match day, the away side's legs.
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // A long trip: across Brazil.
  const f = world.fixtures.filter((x) => world.competitions[x.competitionId]?.kind === 'league' && !x.neutralVenue &&
    tripTo(world, x, x.away) === 'long').sort((a, b) => a.day - b.day)[0];
  while (world.day < f.day - 1) advanceDay(world, ctx);
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  for (const p of [...home.players, ...away.players]) world.players.condition[p] = 100;
  world.day = f.day;
  travelEve(world);
  assert.ok(TRAVEL_COST.long > 0 && TRAVEL_COST.abroad > TRAVEL_COST.long && TRAVEL_COST.short === 0);
  assert.ok(away.players.every((p) => world.players.condition[p] === 100 - TRAVEL_COST.long));
  assert.ok(home.players.every((p) => world.players.condition[p] === 100), 'the home side stays put');
});

test('a crowded run of matches slows recovery; a rest lets the load ebb away', () => {
  const world = generateWorld({ seed: 92, startYear: 2026, scale: 'small', manager: stubManager() });
  const [fresh, busy] = world.clubs[0].players;
  noteMatchLoad(world, [busy]);
  assert.equal(recoveryFactor(world, busy), 1, 'one match is nothing');
  for (let d = 0; d < 2; d++) { ebbLoads(world); noteMatchLoad(world, [busy]); }
  assert.ok(loadOf(world, busy) > 2.3, `three in three days: ${loadOf(world, busy)}`);
  assert.ok(recoveryFactor(world, busy) < 0.85);
  assert.equal(recoveryFactor(world, fresh), 1);
  for (let d = 0; d < 7; d++) ebbLoads(world);
  assert.ok(recoveryFactor(world, busy) === 1, 'a week off and he is fresh');
  for (let d = 0; d < 30; d++) ebbLoads(world);
  assert.equal(world.matchLoad!.has(busy), false, 'and the load is gone');

  // Over a stretch of the season, everyone who plays carries his matches.
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  for (let d = 0; d < 80; d++) advanceDay(world, ctx);
  assert.ok((world.matchLoad?.size ?? 0) > 100);
});
