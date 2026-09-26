import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRating } from '../match/playerRating.ts';
import { newPlayerStats } from '../match/stats.ts';
import { Position } from '../model/positions.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason, pickLineup } from '../season/seasonEngine.ts';
import { averageRating, pruneCompetitionRecords, seasonRecords, seasonTotals } from './records.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('matchRating sits at the neutral mark with no evidence and stays within 1-10', () => {
  const idle = newPlayerStats(0);
  assert.equal(matchRating(idle, Position.OutsideHitter, 0, 0), 6.4);

  const monster = { ...newPlayerStats(0), ralliesPlayed: 180, attacksTotal: 60, attackKills: 40, serveAces: 8, blockPoints: 6 };
  const disaster = { ...newPlayerStats(0), ralliesPlayed: 180, attacksTotal: 40, attackErrors: 15, attackBlocked: 10, serveErrors: 8, receptionsTotal: 30, receptionErrors: 12 };
  const good = matchRating(monster, Position.Opposite, 3, 0);
  const bad = matchRating(disaster, Position.OutsideHitter, 0, 3);
  assert.ok(good > 8 && good <= 10, `a dominant match rates highly (${good})`);
  assert.ok(bad < 5 && bad >= 1, `a disastrous match rates poorly (${bad})`);
});

test('winning nudges every rating up and losing nudges it down', () => {
  const line = { ...newPlayerStats(0), ralliesPlayed: 150, attacksTotal: 30, attackKills: 13, attackErrors: 3 };
  const won = matchRating(line, Position.OutsideHitter, 3, 1);
  const lost = matchRating(line, Position.OutsideHitter, 1, 3);
  assert.ok(won > lost);
});

test('a played season files a rated line per player per competition, and rollover keeps last season only', () => {
  const world = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  simulateRestOfSeason(world, ctx);

  const club = world.clubs.find((c) => c.players.length >= 10)!;
  const starter = pickLineup(world.players, club).lineup[0];
  const lines = seasonRecords(world, starter, world.season);
  assert.ok(lines.length >= 1, 'a regular starter should have a league line');
  const league = lines.find((l) => l.competitionId === club.leagueId);
  assert.ok(league !== undefined && league.apps > 5);
  const avg = averageRating(league);
  assert.ok(avg > 3 && avg < 9.5, `season average should be plausible (${avg})`);
  assert.equal(seasonTotals(world, starter).apps, lines.reduce((s, l) => s + l.apps, 0));
  assert.ok((world.ratingForm.get(starter)?.length ?? 0) > 0);

  // Two seasons on, the first season's lines are gone.
  world.season += 2;
  pruneCompetitionRecords(world);
  assert.equal(seasonRecords(world, starter, world.season - 2).length, 0);
  assert.equal(world.ratingForm.size, 0);
});
