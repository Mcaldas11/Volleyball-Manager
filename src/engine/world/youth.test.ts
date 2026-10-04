import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { academyOffers, sellAcademyPlayer, userYouthLeague, youthState, youthTable } from './youth.ts';
import { generateYouthIntake } from './progression.ts';

function managed(seed: number): { world: World; run: (days: number) => void } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // Every club has an academy to field.
  generateYouthIntake(world);
  generateYouthIntake(world);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return { world, run: (days) => { for (let i = 0; i < days; i++) advanceDay(world, ctx); } };
}

test('every club has a youth side in an U19 league beside its senior one, a round a week', () => {
  const { world, run } = managed(81);
  const league = userYouthLeague(world)!;
  assert.ok(league !== undefined && league.name.endsWith('U19'));
  const senior = world.competitions[league.leagueId];
  assert.deepEqual([...league.clubs].sort((a, b) => a - b), [...senior.participants].sort((a, b) => a - b));
  run(120);
  assert.ok(league.round >= 8, `${league.round} rounds played by November`);
  for (const row of league.table) assert.equal(row.played, row.won + row.lost);
  const played = league.table.reduce((n, r) => n + r.played, 0);
  assert.equal(played, league.round * Math.floor(league.clubs.length / 2) * 2);
  const table = youthTable(league);
  for (let i = 1; i < table.length; i++) assert.ok(table[i - 1].points >= table[i].points);
  // The manager's academy has played, and its players have the minutes to show for it.
  const mine = world.clubs[world.userClubId];
  const state = youthState(world);
  assert.ok(state.results.some((r) => r.home === mine.id || r.away === mine.id));
  const regulars = mine.youthPlayers.filter((p) => (state.stats.get(p)?.[0] ?? 0) >= 6);
  assert.ok(regulars.length >= 1);
  for (const p of regulars) assert.ok(world.players.playingTime[p] > 50, 'playing builds playing time');
});

test("an academy player the manager doesn't want can be sold to a club that offers for him", () => {
  const { world } = managed(82);
  const mine = world.clubs[world.userClubId];
  const p = mine.youthPlayers[0];
  const offers = academyOffers(world, p);
  assert.ok(offers.length > 0, 'somebody wants him');
  assert.deepEqual(academyOffers(world, p), offers, 'the same offers on a second look');
  const best = offers[0];
  const buyer = world.clubs[best.clubId];
  const balance = mine.finances.balance;
  const sold = sellAcademyPlayer(world, p, best.clubId);
  assert.equal(sold.ok, true);
  assert.ok(!mine.youthPlayers.includes(p) && buyer.youthPlayers.includes(p));
  assert.equal(world.players.clubId[p], buyer.id);
  assert.equal(mine.finances.balance, balance + best.fee);
  assert.ok(world.news.some((n) => n.kind === 'transfer' && n.playerIdx === p), 'the paper has it');
  assert.equal(sellAcademyPlayer(world, p, best.clubId).ok, false, 'not twice');
});
