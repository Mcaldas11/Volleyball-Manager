import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import { RENEWAL_MARGIN, renewalRoom, wageBill } from './loans.ts';
import { contractDemands } from './negotiation.ts';
import { advanceDay, isSeasonOver, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';

/** Of a club's players, the share whose renewal ask fits what the club can pay him to stay. */
function affordable(world: World, clubId: number): number {
  const club = world.clubs[clubId];
  const fits = club.players.filter((p) => contractDemands(world, club, p, true).wage <= renewalRoom(world, club, p)).length;
  return fits / Math.max(1, club.players.length);
}

test('every club starts able to pay its own squad', () => {
  const world = generateWorld({ seed: 21, startYear: 2026, scale: 'small', manager: stubManager() });
  for (const club of world.clubs) {
    if (club.players.length === 0) continue;
    assert.ok(club.finances.wageBudget >= wageBill(world, club), `${club.name}'s budget covers its wage bill`);
  }
});

test("a club can always keep its own players at a fair rise, and the manager's renewals fit, season after season", () => {
  const world = generateWorld({ seed: 22, startYear: 2026, scale: 'small', manager: stubManager() });
  // A small top-flight club: the kind that had no room to renew.
  const top = world.competitions.find((c) => c.kind === 'league' && c.tier === 1 && c.participants.length >= 8)!;
  const mine = [...top.participants].sort((a, b) => world.clubs[a].reputation - world.clubs[b].reputation)[0];
  appointManager(world, mine);
  for (let season = 0; season < 2; season++) {
    for (const club of world.clubs) {
      for (const p of club.players) {
        assert.ok(renewalRoom(world, club, p) >= Math.round(world.players.wage[p] * (1 + RENEWAL_MARGIN)), 'a fair rise is always within reach');
      }
    }
    assert.ok(affordable(world, mine) >= 0.85, `most of the squad can be renewed (season ${season})`);
    const ctx = newSeasonContext();
    startSeason(world, ctx);
    while (!isSeasonOver(world)) advanceDay(world, ctx);
    endSeason(world, ctx);
  }
});
