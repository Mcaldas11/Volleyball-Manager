import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { completeTransfer } from '../world/negotiation.ts';
import { endSeason } from './rollover.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason } from './seasonEngine.ts';

test('the end of a season posts a review of the user club\'s season to the inbox', () => {
  const world = generateWorld({ seed: 11, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;

  // A signing before the season, so there is transfer business to review.
  const seller = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const target = [...seller.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
  completeTransfer(world, club, target, store.wage[target], 250_000);

  const ctx = newSeasonContext();
  startSeason(world, ctx);
  simulateRestOfSeason(world, ctx);
  endSeason(world, ctx);

  const message = world.messages.find((m) => m.seasonReview !== undefined);
  assert.ok(message !== undefined, 'a season review was posted');
  assert.equal(message.subject, '2026/27 season review');
  const review = message.seasonReview!;
  assert.equal(review.clubId, club.id);
  assert.equal(review.season, 0);

  // The league comes first, with a real placing.
  const league = review.standings[0];
  assert.ok(league !== undefined);
  assert.equal(world.competitions[league.competitionId].kind, 'league');
  assert.ok(league.position >= 1 && league.position <= league.teams);
  assert.ok(league.won + league.lost > 0);
  assert.ok(review.won + review.lost >= league.won + league.lost, 'all competitions include the league');
  assert.equal(review.won, review.homeWon + review.awayWon);
  assert.equal(review.lost, review.homeLost + review.awayLost);
  assert.ok(review.longestWinStreak <= review.won);
  if (review.won > 0) assert.ok(review.biggestWin !== null);

  // Awards go to the club's own players, with believable numbers.
  const best = review.awards.find((a) => a.kind === 'player');
  assert.ok(best !== undefined, 'a player of the season');
  assert.ok(best.rating > 0 && best.rating <= 10);
  assert.ok(best.apps >= 3);
  for (const a of review.awards) {
    assert.ok(club.players.includes(a.playerIdx) || club.youthPlayers.includes(a.playerIdx) ||
      store.clubId[a.playerIdx] !== club.id, 'awards are drawn from the squad as it stood');
  }

  // The signing is in the transfer business, fee and all.
  assert.deepEqual(review.signings.find((s) => s.playerIdx === target), { playerIdx: target, clubId: seller.id, fee: 250_000 });
  assert.equal(review.transferSpend, 250_000);

  // The books have income and costs, and the balance is the settled one.
  assert.ok(review.income.length > 0 && review.costs.length > 0);
  assert.equal(review.closingBalance, club.finances.balance);
  assert.ok(message.body.includes(club.name));
});

test('no review is posted when the user has no club', () => {
  const world = generateWorld({ seed: 12, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = -1;
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  simulateRestOfSeason(world, ctx);
  endSeason(world, ctx);
  assert.equal(world.messages.filter((m) => m.seasonReview !== undefined).length, 0);
  assert.equal(world.transferLog.length, 0, 'only the user club\'s moves are logged');
});
