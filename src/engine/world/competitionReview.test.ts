import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager } from './world.ts';

test('every competition the manager is in ends with its review: the champions, the awards, the surprises', () => {
  const world = generateWorld({ seed: 81, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // The best-known side in a top flight. Sacked or not, what he started in he hears the end of.
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[0];
  appointManager(world, club.id);
  const league = club.leagueId;
  while (world.day < DAYS_PER_SEASON - 2) advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  endSeason(world, ctx);

  const reviews = world.messages.filter((m) => m.competitionReview !== undefined).map((m) => m.competitionReview!);
  const leagueReviews = reviews.filter((r) => r.competitionId === league);
  assert.equal(leagueReviews.length, 1, 'the league is reviewed, once');
  const r = leagueReviews[0];
  assert.ok(r.champion >= 0 && r.standings[0] === r.champion);
  // Where the manager's side finished — if he is still in charge of it.
  if (world.userClubId === club.id) assert.ok(r.you !== null && r.you.finish.length > 0);
  for (const k of ['mvp', 'scorer', 'server', 'blocker', 'attacker'] as const) {
    assert.ok(r.awards.some((a) => a.key === k), `a ${k}`);
  }
  // The awards go to who earned them.
  const scorer = r.awards.find((a) => a.key === 'scorer')!;
  const pointsOf = (p: number): number =>
    world.competitionRecords.get(p)?.find((l) => l.competitionId === league && l.season === r.season)?.points ?? 0;
  for (const [p] of world.competitionRecords) assert.ok(pointsOf(p) <= pointsOf(scorer.p));
  assert.ok(r.dreamTeam.length >= 6, 'a team of the competition');
  assert.equal(r.favourites.length, 3);
  assert.ok(r.numbers.matches > 20 && r.numbers.sets >= r.numbers.matches * 3);
  assert.ok(r.bestAttack !== null && r.bestDefence !== null);
  // The best point of the league was seen and kept.
  assert.ok(r.bestPoint !== undefined, 'the best point, to watch again');
  // Every one has its MVP — a one-match super cup too — and none comes twice.
  for (const x of reviews) assert.ok(x.awards.some((a) => a.key === 'mvp'), `an MVP in ${x.competitionId}`);
  const ids = reviews.map((x) => `${x.season}:${x.competitionId}`);
  assert.equal(new Set(ids).size, ids.length);
});
