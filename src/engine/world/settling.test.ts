import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { stillSettling } from './playerTalks.ts';
import { stanceOf, stanceOnAgreedSale } from './offerStance.ts';
import type { IncomingOffer } from './negotiation.ts';

function managed() {
  const world = generateWorld({ seed: 77, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  appointManager(world, club.id);
  return { world, club };
}

test('a new signing is still settling for six weeks: he does not complain about his minutes yet', () => {
  const { world, club } = managed();
  const p = club.players[0];
  world.transferLog.push({ season: world.season, day: world.day, playerIdx: p, fromClub: -1, toClub: club.id, fee: 0 });
  assert.equal(stillSettling(world, p), true, 'just arrived');
  world.day += 20;
  assert.equal(stillSettling(world, p), true, 'three weeks in, and no matches played');
  // Long after, settled whatever the matches.
  world.day += 200;
  assert.equal(stillSettling(world, p), false, 'months later');
  // A player who never moved is not settling.
  assert.equal(stillSettling(world, club.players[1]), false);
});

test('a release clause paid is not the club selling him: staying costs him no morale', () => {
  const { world, club } = managed();
  const p = club.players.find((x) => {
    const o = { id: 1, playerIdx: x, buyingClubId: world.clubs.find((c) => c.id !== club.id)!.id, fee: 1e6, expiresOnDay: world.day + 14 } as IncomingOffer;
    return stanceOf(world, o) === 'staying';
  });
  if (p === undefined) return; // nobody minded where he played in this world
  const buyer = world.clubs.find((c) => c.id !== club.id)!;
  for (const clause of [true, false]) {
    for (let id = 1; id < 40; id++) {
      const offer = { id, playerIdx: p, buyingClubId: buyer.id, fee: 1e6, expiresOnDay: world.day + 14, status: 'accepted', clause } as IncomingOffer;
      if (stanceOf(world, offer) !== 'staying') continue;
      world.players.morale[p] = 60;
      const goes = stanceOnAgreedSale(world, offer, true);
      if (goes) continue;
      assert.equal(world.players.morale[p], clause ? 60 : 54, clause ? 'clause: no hit' : 'a sale the club agreed: hurt');
      break;
    }
  }
});
