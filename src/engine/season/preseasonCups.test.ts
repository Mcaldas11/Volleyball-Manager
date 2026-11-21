import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager, type Fixture, type World } from '../world/world.ts';
import { appointManager } from '../world/career.ts';
import { clubTrophies } from '../world/world.ts';
import { achievementList } from '../world/achievements.ts';
import {
  answerCupInvite, cupFixtures, cupPrize, cupStandings, drawGroups, FINAL, friendlyTrophies, hostCup, hostDates,
  cupCandidates, inviteUserToCup, openInvites, quarterFinalPairs, QUARTER_FINAL, roundRobinPairs, SEMI_FINAL,
  semiFinalPairs, THIRD_PLACE, userCups,
} from './preseasonCups.ts';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from './seasonEngine.ts';

function career(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return { world, ctx };
}

/** A played group match, home sets first. */
function played(id: number, home: number, away: number, hs: number, as: number, round = 0): Fixture {
  const sets: Array<[number, number]> = [];
  for (let i = 0; i < hs + as; i++) sets.push(i < hs ? [25, 20] : [20, 25]);
  return {
    id, competitionId: 0, day: 0, home, away, round, format: 0, importance: 0, neutralVenue: true,
    played: true, homeSets: hs, awaySets: as, setScores: sets, mvp: -1,
  } as Fixture;
}

test('a group of four: everyone plays everyone once, in three rounds of two', () => {
  const rounds = roundRobinPairs([1, 2, 3, 4]);
  assert.equal(rounds.length, 3);
  const pairs = rounds.flat().map(([a, b]) => [a, b].sort().join('-')).sort();
  assert.deepEqual(pairs, ['1-2', '1-3', '1-4', '2-3', '2-4', '3-4']);
  for (const r of rounds) assert.equal(new Set(r.flat()).size, 4, 'nobody twice in a day');
});

test('the table: 3 for a 3-0 or 3-1, 2 for a 3-2, 1 for a 2-3, then the semi-finals are 1v4 and 2v3', () => {
  const g = [10, 20, 30, 40];
  const fx = [
    played(1, 10, 40, 3, 0), played(2, 20, 30, 3, 2),
    played(3, 10, 30, 3, 1), played(4, 40, 20, 2, 3),
    played(5, 10, 20, 3, 2), played(6, 30, 40, 3, 0),
  ];
  const table = cupStandings(g, fx);
  assert.deepEqual(table.map((r) => r.clubId), [10, 20, 30, 40]);
  assert.deepEqual(table.map((r) => r.points), [8, 5, 4, 1]);
  assert.equal(table[0].won, 3);
  assert.deepEqual(semiFinalPairs(table), [[10, 40], [20, 30]]);
  // Knockout matches never count in the table.
  const withSemi = cupStandings(g, [...fx, played(7, 40, 10, 3, 0, SEMI_FINAL)]);
  assert.deepEqual(withSemi.map((r) => r.points), [8, 5, 4, 1]);
});

test('eight: snake-seeded groups, then quarter-finals crosswise', () => {
  const groups = drawGroups([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(groups, [[1, 4, 5, 8], [2, 3, 6, 7]]);
  const row = (id: number) => ({ clubId: id, played: 3, won: 0, lost: 0, points: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0 });
  const A = [1, 4, 5, 8].map(row);
  const B = [2, 3, 6, 7].map(row);
  assert.deepEqual(quarterFinalPairs(A, B), [[1, 7], [3, 5], [2, 8], [4, 6]]);
});

test('the prize is small, and bigger for eight', () => {
  assert.ok(cupPrize(5000, 4) < cupPrize(5000, 8));
  assert.ok(cupPrize(9000, 8) <= 80_000);
  assert.equal(cupPrize(0, 4) % 1000, 0);
});

test('a hosted tournament fills, plays its rounds, a 3rd-place match, and its trophy counts for nothing', () => {
  const { world, ctx } = career(77);
  const user = world.clubs[world.userClubId];
  const dates = hostDates(world, 4);
  assert.ok(dates.length > 0, 'free dates in the pre-season');
  const start = dates[0];
  const invitees = cupCandidates(world, user.id, start, 4).slice(0, 3);
  assert.equal(invitees.length, 3);
  const cup = hostCup(world, 4, start, invitees);
  assert.ok(cup !== null);
  assert.equal(hostCup(world, 4, start, invitees), null, 'not twice on the same dates');

  const titlesBefore = world.clubs.map((c) => c.titlesWon);
  const honoursBefore = clubTrophies(world, user.id).length;
  const repBefore = world.career.reputation;
  const recordsBefore = JSON.stringify(world.history);
  const achieved = achievementList(world).filter((a) => a.day !== null).length;
  const balances = world.clubs.map((c) => c.finances.balance);

  while (world.day <= start + 5) advanceDay(world, ctx, {});
  assert.equal(cup.stage, 'done');
  assert.equal(cup.teams.length, 4);
  assert.ok(cup.teams.includes(user.id));
  const fx = cupFixtures(world, cup);
  assert.equal(fx.filter((f) => f.round < QUARTER_FINAL).length, 6, 'six group matches');
  assert.equal(fx.filter((f) => f.round === SEMI_FINAL).length, 2);
  assert.equal(fx.filter((f) => f.round === FINAL).length, 1);
  assert.equal(fx.filter((f) => f.round === THIRD_PLACE).length, 1, 'a match for third place');
  assert.ok(fx.every((f) => f.played));
  // The semi-finals: first against fourth, second against third.
  const table = cupStandings(cup.groups[0], fx);
  const semis = fx.filter((f) => f.round === SEMI_FINAL).map((f) => [f.home, f.away].sort().join('-')).sort();
  assert.deepEqual(semis, semiFinalPairs(table).map((p) => [...p].sort().join('-')).sort());
  // The final is the semi-finals' winners; third place their losers.
  const final = fx.find((f) => f.round === FINAL)!;
  assert.equal(cup.placings[0], final.homeSets > final.awaySets ? final.home : final.away);
  assert.equal(cup.placings.length, 4);

  // The prize money, and a friendly trophy — and nothing that counts.
  const winner = world.clubs[cup.placings[0]];
  assert.ok(winner.finances.balance - balances[winner.id] >= cup.prize - 200_000, 'prize paid');
  assert.equal(friendlyTrophies(world, { clubId: winner.id }).length, 1);
  assert.deepEqual(world.clubs.map((c) => c.titlesWon), titlesBefore, 'no titles');
  assert.equal(clubTrophies(world, user.id).length, honoursBefore, 'no honours');
  assert.equal(world.competitions.find((c) => c.kind === 'friendly')!.champion, -1);
  assert.ok(world.career.reputation <= repBefore + 1, 'no name made');
  assert.equal(JSON.stringify(world.history), recordsBefore, 'no history');
  assert.equal(achievementList(world).filter((a) => a.day !== null).length, achieved, 'no achievements');
  assert.ok(userCups(world).includes(cup));
});

test('an invitation to another club\'s tournament: accepted, it is played; turned down, another club takes the place', () => {
  const { world, ctx } = career(91);
  const user = world.clubs[world.userClubId];
  const dates = hostDates(world, 8);
  const host = world.clubs.find((c) => c.id !== user.id && c.players.length >= 12 && c.nation === user.nation)!;
  const inv = inviteUserToCup(world, host.id, 8, dates[2]);
  assert.ok(inv !== null);
  assert.equal(openInvites(world).length, 1);
  assert.ok(world.messages.some((m) => m.cupInviteId === inv.id));
  assert.ok(answerCupInvite(world, inv.id, true).ok);
  assert.equal(openInvites(world).length, 0);
  const cup = world.preseasonCups!.cups.find((c) => c.id === inv.cupId)!;
  assert.equal(cup.stage, 'groups');
  assert.equal(cup.groups.length, 2);
  while (world.day <= cup.startDay + 6) advanceDay(world, ctx, {});
  assert.equal(cup.stage, 'done');
  const fx = cupFixtures(world, cup);
  assert.equal(fx.filter((f) => f.round === QUARTER_FINAL).length, 4);
  assert.equal(fx.filter((f) => f.round === SEMI_FINAL).length, 2);
  assert.equal(fx.filter((f) => f.round === THIRD_PLACE).length, 1);
  assert.equal(cup.placings.length, 8);

  const { world: w2 } = career(92);
  const u2 = w2.clubs[w2.userClubId];
  const h2 = w2.clubs.find((c) => c.id !== u2.id && c.players.length >= 12 && c.nation === u2.nation)!;
  const inv2 = inviteUserToCup(w2, h2.id, 4, hostDates(w2, 4)[3])!;
  assert.ok(answerCupInvite(w2, inv2.id, false).ok);
  const cup2 = w2.preseasonCups!.cups.find((c) => c.id === inv2.cupId)!;
  assert.ok(!cup2.teams.includes(u2.id));
  assert.equal(cup2.teams.length, 4, 'another club in his place');
});
