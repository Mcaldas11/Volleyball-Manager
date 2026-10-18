import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { judgePhilosophy, meetingBlock, MEETING_GAP, paperRank, philosophyOf, principleProgress, requestLowerTarget, requestWages } from './board.ts';
import { ownerOf } from './owners.ts';

function managed(pick = 3) {
  const world = generateWorld({ seed: 33, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[pick];
  appointManager(world, club.id);
  return { world, club };
}

test('the board say what the club stands for — from who owns it — and judge the season on it', () => {
  const { world, club } = managed();
  ownerOf(world, club).kind = 'members';
  club.philosophy = undefined;
  const p = philosophyOf(world, club);
  assert.deepEqual(p.kinds, ['youth', 'prudence']);
  assert.match(world.messages.at(-1)!.subject, /stands for/);
  // Live within our means: a wage bill inside the budget is kept, one over it is not.
  club.finances.wageBudget = 1e9;
  assert.equal(principleProgress(world, club, 'prudence').done, true);
  club.finances.wageBudget = 1;
  assert.equal(principleProgress(world, club, 'prudence').done, false);
  // No young players on court yet: the youth principle isn't kept — two marks against.
  const before = club.boardConfidence;
  judgePhilosophy(world);
  assert.equal(club.boardConfidence, Math.max(0, before - 6));
  assert.equal(p.judged, true);
  judgePhilosophy(world);
  assert.equal(club.boardConfidence, Math.max(0, before - 6), 'judged once');
});

test('a board meeting: more for wages to a manager they trust with money in the bank — not to one they doubt', () => {
  const { world, club } = managed();
  club.boardConfidence = 70;
  club.finances.balance = club.finances.wageBudget;
  const was = club.finances.wageBudget;
  assert.match(requestWages(world, club), /agreed/);
  assert.ok(club.finances.wageBudget > was);
  // Not again for a while.
  assert.notEqual(meetingBlock(world, club), null);
  assert.match(requestWages(world, club), /recently/);
  world.day += MEETING_GAP;
  club.boardConfidence = 30;
  const now = club.finances.wageBudget;
  assert.match(requestWages(world, club), /turned you down/);
  assert.equal(club.finances.wageBudget, now);
});

test('a lower target only for a squad that really is not up to it — and it costs their confidence', () => {
  const { world, club } = managed();
  club.boardConfidence = 60;
  const rank = paperRank(world, club);
  // A target the squad is good for: no.
  club.boardExpectation = rank;
  assert.match(requestLowerTarget(world, club), /said no/);
  assert.equal(club.boardExpectation, rank);
  // A target well above it: yes, at a price.
  world.day += MEETING_GAP;
  club.boardExpectation = Math.max(1, rank - 3);
  const before = club.boardConfidence;
  assert.match(requestLowerTarget(world, club), /agreed/);
  assert.ok(club.boardExpectation > Math.max(1, rank - 3) && club.boardExpectation <= rank);
  assert.equal(club.boardConfidence, before - 4);
});
