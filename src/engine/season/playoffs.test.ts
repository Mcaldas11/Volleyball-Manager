import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTableRows } from '../model/club.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { advanceDay, newSeasonContext, startSeason } from './seasonEngine.ts';
import { finalStandingsOrder, playoffBandSizes } from './playoffs.ts';

/** Run a fresh world forward a full season (well past rollover) and hand
 *  back its tier-1 league, still mid-season so its playoff state is intact —
 *  `endSeason` would reset it. */
function simulateOneSeason(seed: number) {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const league = world.competitions.find((c) => c.kind === 'league' && c.tier === 1)!;
  for (let d = 0; d < 349; d++) advanceDay(world, ctx, {});
  return { world, league };
}

test('a tier-1 league builds championship and relegation brackets sized off its own rules', () => {
  const { league } = simulateOneSeason(101);
  const { championship, relegation } = playoffBandSizes(league);

  assert.equal(championship, Math.min(league.playoffTeams, league.table.length));
  assert.ok(relegation >= league.relegationSlots);

  const champGroup = league.playoffGroups.find((g) => g.id === 'championship');
  assert.ok(champGroup !== undefined, 'expected a championship bracket for a tier-1 league');
  assert.equal(champGroup!.seeds.length, championship);
  assert.equal(champGroup!.resolved, true, 'championship should resolve well before day 349');
});

test('every playoff bracket resolves to a full, duplicate-free ordering of its own seeds', () => {
  const { league } = simulateOneSeason(102);
  for (const group of league.playoffGroups) {
    assert.equal(group.resolved, true, `${group.id} should have resolved by day 349`);
    assert.equal(group.finalOrder.length, group.seeds.length);
    assert.equal(new Set(group.finalOrder).size, group.seeds.length, `${group.id} finalOrder has duplicates`);
    for (const clubId of group.seeds) assert.ok(group.finalOrder.includes(clubId));
  }
});

test('finalStandingsOrder is a permutation of every club in the table', () => {
  const { league } = simulateOneSeason(103);
  const order = finalStandingsOrder(league);
  const tableClubIds = league.table.map((r) => r.clubId);

  assert.equal(order.length, tableClubIds.length);
  assert.equal(new Set(order).size, tableClubIds.length);
  for (const clubId of tableClubIds) assert.ok(order.includes(clubId));
});

test('a losing semifinalist in the relegation bracket survives; only the bracket\'s bottom seats actually relegate', () => {
  const { league } = simulateOneSeason(104);
  const relegation = league.playoffGroups.find((g) => g.id === 'relegation');
  if (relegation === undefined) return; // this league's bottom band was too small to need one

  const order = finalStandingsOrder(league);
  const relegatedIds = order.slice(-league.relegationSlots);
  // Everyone actually relegated must have come from the relegation bracket's
  // own pool, and the pool must be strictly larger than the number relegated
  // — otherwise there was nothing for the bracket to decide.
  assert.ok(relegation.seeds.length > league.relegationSlots);
  for (const id of relegatedIds) assert.ok(relegation.seeds.includes(id));
});

test('a league without playoffs falls back to plain table order', () => {
  const { world } = simulateOneSeason(105);
  const lowerTier = world.competitions.find((c) => c.kind === 'league' && !c.hasPlayoffs && c.table.length > 0);
  assert.ok(lowerTier !== undefined, 'expected at least one league with hasPlayoffs disabled');

  assert.equal(lowerTier!.playoffGroups.length, 0);
  const sorted = [...lowerTier!.table].sort(compareTableRows).map((r) => r.clubId);
  assert.deepEqual(finalStandingsOrder(lowerTier!), sorted);
});

test('the recorded champion sometimes differs from the regular-season table topper', () => {
  // Not every seed will show this — a playoff can crown the same club that
  // topped the table — so scan several seeds for at least one that does,
  // which is enough to prove the playoff result is actually being used.
  let sawUpset = false;
  for (let seed = 200; seed < 210 && !sawUpset; seed++) {
    const { league } = simulateOneSeason(seed);
    const sorted = [...league.table].sort(compareTableRows);
    const order = finalStandingsOrder(league);
    if (order[0] !== sorted[0].clubId) sawUpset = true;
  }
  assert.ok(sawUpset, 'expected the championship playoff to crown a non-table-topper in at least one of 10 seasons');
});
