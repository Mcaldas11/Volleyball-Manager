import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { DAYS_PER_SEASON, stubManager, type World } from '../world/world.ts';
import { appointManager, currentJob } from '../world/career.ts';
import {
  boardArrangeFriendly, FRIENDLY_FIRST_DAY, FRIENDLY_LAST_DAY, FRIENDLY_NOTICE_DAYS, friendliesOf, friendlyBlock,
  friendlyDates, friendlyInterest, friendlyRequests, MAX_FRIENDLIES, requestFriendly, withdrawFriendlyRequest,
} from './friendlies.ts';
import { advanceDay, newSeasonContext, startSeason, toTeamSetup, type SeasonContext } from './seasonEngine.ts';
import { MatchFormat, simulateMatch } from '../match/engine.ts';

function career(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return { world, ctx };
}

function advanceTo(world: World, ctx: SeasonContext, day: number): void {
  while (world.day < day) advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
}

/** Clubs of the user's country, smallest first — the likeliest to say yes. */
function smallClubs(world: World): number[] {
  const me = world.clubs[world.userClubId];
  return world.clubs
    .filter((c) => c.id !== me.id && c.nation === me.nation && c.players.length >= 12)
    .sort((a, b) => a.reputation - b.reputation)
    .map((c) => c.id);
}

test('friendlies go on free pre-season dates, a few days ahead, one per club and six at most', () => {
  const { world } = career(301);
  const dates = friendlyDates(world);
  assert.ok(dates.length > 0);
  for (const d of dates) {
    assert.ok(d >= FRIENDLY_FIRST_DAY && d <= FRIENDLY_LAST_DAY && d >= world.day + FRIENDLY_NOTICE_DAYS);
  }
  const [a, b] = smallClubs(world);
  assert.equal(friendlyBlock(world, world.userClubId, dates[0]), 'Choose another club to play.');
  assert.ok(friendlyBlock(world, a, 2) !== null, 'not tomorrow');
  assert.ok(requestFriendly(world, a, dates[0], true) !== null);
  assert.ok(friendlyBlock(world, b, dates[0]) !== null, 'not the same day as another');
  assert.match(friendlyBlock(world, a, dates[5])!, /already have a friendly/);
  withdrawFriendlyRequest(world, friendlyRequests(world)[0].id);
  assert.equal(friendlyRequests(world).length, 0);

  // Six at most.
  for (const clubId of smallClubs(world)) {
    const day = friendlyDates(world)[0];
    if (day === undefined || requestFriendly(world, clubId, day, false) === null) break;
  }
  assert.equal(friendlyRequests(world).length, MAX_FRIENDLIES);
  assert.match(friendlyBlock(world, smallClubs(world)[MAX_FRIENDLIES + 1], friendlyDates(world)[0] ?? 40)!, /as many as/);
});

test('bigger clubs are less keen, and keener to host than to travel', () => {
  const { world } = career(302);
  const clubs = smallClubs(world);
  const small = clubs[0];
  const big = world.clubs
    .filter((c) => c.id !== world.userClubId)
    .sort((x, y) => y.reputation - x.reputation)[0].id;
  assert.ok(friendlyInterest(world, small, false) > friendlyInterest(world, big, false));
  assert.ok(friendlyInterest(world, small, false) > friendlyInterest(world, small, true), 'asked to travel, less so');
});

test('an invitation is answered within a few days — and an accepted one is on the calendar', () => {
  const { world, ctx } = career(303);
  const clubs = smallClubs(world);
  const sent = clubs.slice(0, 3).map((c, i) => requestFriendly(world, c, friendlyDates(world)[i * 5], true)!);
  assert.ok(sent.every((r) => r !== null && r.answerOn > world.day && r.answerOn <= world.day + 3));
  advanceTo(world, ctx, world.day + 4);
  assert.equal(friendlyRequests(world).length, 0, 'every one answered');
  const answers = world.messages.filter((m) => /accept your invitation|decline your invitation/.test(m.subject));
  assert.equal(answers.length, 3);
  const booked = friendliesOf(world, world.userClubId);
  assert.ok(booked.length >= 1, 'a small club is glad of the game');
  for (const f of booked) assert.equal(f.home, world.userClubId, 'at home, as asked');
});

test('with nothing arranged, the board books a couple a fortnight in — and does so whenever asked', () => {
  const { world, ctx } = career(304);
  advanceTo(world, ctx, 16);
  const booked = friendliesOf(world, world.userClubId);
  assert.equal(booked.length, 2);
  assert.ok(world.messages.some((m) => m.subject === 'Pre-season friendlies arranged'));
  assert.ok(Math.abs(booked[0].day - booked[1].day) >= 4, 'spaced out');
  assert.ok(booked.some((f) => f.home === world.userClubId) && booked.some((f) => f.away === world.userClubId));

  const more = boardArrangeFriendly(world);
  assert.ok(more !== null);
  assert.equal(friendliesOf(world, world.userClubId).length, 3);
});

test('a friendly is played in full and counts for nothing but the practice', () => {
  const { world, ctx } = career(305);
  const me = world.userClubId;
  advanceTo(world, ctx, FRIENDLY_LAST_DAY + 1);

  const played = friendliesOf(world, me).filter((f) => f.played);
  assert.ok(played.length >= 2, 'the board\'s friendlies were played');
  for (const f of played) assert.ok(ctx.detailedResults.has(f.id), 'through the full engine');
  // Only the super cup, if the club is in it, can have been played for real by now.
  const competitive = world.fixtures.filter((f) => f.played && (f.home === me || f.away === me) &&
    world.competitions[f.competitionId].kind !== 'friendly').length;
  for (const p of world.clubs[me].players) {
    if (competitive === 0) assert.equal(ctx.stats.get(p), undefined, 'in nobody\'s season statistics');
  }
  const job = currentJob(world)!;
  assert.equal(job.won + job.lost, competitive, 'nor on the manager\'s');
  assert.ok(!world.pendingInterviews.some((s) => played.some((f) => f.id === s.fixtureId)), 'and no press conference');
  assert.ok(world.day < DAYS_PER_SEASON);
});

test('a friendly goes on no player\'s career record', () => {
  const { world } = career(306);
  const store = world.players;
  const setup = (clubId: number) => toTeamSetup(store, world.clubs[clubId]);
  const [opp] = smallClubs(world);
  const players = [...world.clubs[world.userClubId].players, ...world.clubs[opp].players];
  const before = players.map((p) => store.careerMatches[p]);
  simulateMatch(store, {
    home: setup(world.userClubId), away: setup(opp), format: MatchFormat.BestOf5, importance: 0.05,
    neutralVenue: false, collectLog: false, seed: 1, friendly: true,
  });
  assert.deepEqual(players.map((p) => store.careerMatches[p]), before);
  simulateMatch(store, {
    home: setup(world.userClubId), away: setup(opp), format: MatchFormat.BestOf5, importance: 0.5,
    neutralVenue: false, collectLog: false, seed: 1,
  });
  assert.notDeepEqual(players.map((p) => store.careerMatches[p]), before, 'as a competitive match does');
});
