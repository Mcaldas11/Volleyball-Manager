import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { newTableRow } from '../model/club.ts';
import type { Competition, World } from '../world/world.ts';
import { applyPromotionRelegation, balanceRelegationSlots, leaguePyramids } from './pyramid.ts';

/** One nation's pyramid of leagues, `groups[t]` groups in tier t + 1, `sizes(t, g)` clubs in each. */
function pyramid(groups: number[], sizes: (tier: number, group: number) => number): World {
  const competitions: Competition[] = [];
  const clubs: Array<{ id: number; leagueId: number; tier: number; reputation: number }> = [];
  groups.forEach((count, t) => {
    for (let g = 0; g < count; g++) {
      const comp = {
        id: competitions.length, name: `T${t + 1}${String.fromCharCode(65 + g)}`, kind: 'league', nation: 0, tier: t + 1,
        participants: [], table: [], fixtureIds: [], reputation: 1000,
        promotionSlots: t === 0 ? 0 : count > 1 ? 1 : 2, relegationSlots: 2,
        hasPlayoffs: false, playoffTeams: 0, champion: -1, prizePool: 0, playoffGroups: [],
      } as unknown as Competition;
      competitions.push(comp);
      for (let c = 0; c < sizes(t, g); c++) {
        const club = { id: clubs.length, leagueId: comp.id, tier: t + 1, reputation: 1000 };
        clubs.push(club);
        comp.participants.push(club.id);
      }
    }
  });
  return { competitions, clubs, userClubId: -1 } as unknown as World;
}

/** A season played: every league's table from its clubs, in a random order. */
function playSeason(world: World, rng: Rng): void {
  for (const comp of world.competitions) {
    comp.table = comp.participants.map((c) => ({ ...newTableRow(c), played: 22, points: rng.int(0, 66), won: rng.int(0, 22) }));
  }
}

const sizesOf = (world: World): number[][] =>
  [...leaguePyramids(world).values()][0].map((tier) => tier.map((c) => c.participants.length));

function assertConsistent(world: World): void {
  const seen = new Set<number>();
  for (const comp of world.competitions) {
    for (const c of comp.participants) {
      assert.ok(!seen.has(c), `club ${c} in two leagues`);
      seen.add(c);
      const club = world.clubs[c] as unknown as { leagueId: number; tier: number };
      assert.equal(club.leagueId, comp.id);
      assert.equal(club.tier, comp.tier);
    }
  }
  assert.equal(seen.size, world.clubs.length, 'every club in a league');
}

test('two divisions trade as many clubs as they send, and a tier\'s groups stay the same size', () => {
  // As the standard world builds it: one, one, two, four, then eight groups to the bottom.
  const world = pyramid([1, 1, 2, 4, 8, 8, 8], () => 12);
  const rng = new Rng(7);
  const totals = sizesOf(world).map((t) => t.reduce((a, b) => a + b, 0));
  for (let season = 0; season < 12; season++) {
    playSeason(world, rng);
    const report = { promoted: 0, relegated: 0 };
    applyPromotionRelegation(world, report);
    assert.ok(report.promoted > 0);
    assert.equal(report.promoted, report.relegated, 'as many up as down');
    const sizes = sizesOf(world);
    assert.deepEqual(sizes.map((t) => t.reduce((a, b) => a + b, 0)), totals, 'no division grows or shrinks');
    for (const tier of sizes) assert.ok(Math.max(...tier) - Math.min(...tier) <= 2, `groups even: ${tier.join('/')}`);
    assertConsistent(world);
  }
  // Eight groups over eight: one down from each, for the one up from each beneath.
  assert.deepEqual(world.competitions.filter((c) => c.tier === 5).map((c) => c.relegationSlots), Array(8).fill(1));
});

test('a pyramid out of shape is put back — one Group A of forty, groups emptied, the bottom swollen', () => {
  const world = pyramid([1, 1, 2, 4, 8, 8], (t, g) => (t === 4 ? (g === 0 ? 40 : 1) : t === 5 ? (g === 0 ? 30 : 20) : 12));
  balanceRelegationSlots(world);
  const rng = new Rng(3);
  for (let season = 0; season < 3; season++) {
    playSeason(world, rng);
    applyPromotionRelegation(world, { promoted: 0, relegated: 0 });
    assertConsistent(world);
  }
  const sizes = sizesOf(world);
  for (const tier of sizes) {
    assert.ok(Math.max(...tier) - Math.min(...tier) <= 2, `groups even: ${tier.join('/')}`);
    assert.ok(Math.max(...tier) <= 20, `no giant group: ${tier.join('/')}`);
  }
  // The fifth tier, down to forty-seven clubs over eight groups, is filled back up from the one below.
  assert.ok(sizes[4].reduce((a, b) => a + b, 0) >= 8 * 10, `tier 5: ${sizes[4].join('/')}`);
});
