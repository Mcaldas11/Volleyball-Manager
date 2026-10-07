import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRating } from '../match/playerRating.ts';
import { runRatingReport } from '../../cli/ratings.ts';
import { newPlayerStats } from '../match/stats.ts';
import { MatchFormat, MatchSimulator } from '../match/engine.ts';
import { Position } from '../model/positions.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason, pickLineup, toTeamSetup } from '../season/seasonEngine.ts';
import { averageRating, pruneCompetitionRecords, seasonRecords, seasonTotals } from './records.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('everyone starts a match on 6.0, and stays within 1-10', () => {
  const idle = newPlayerStats(0);
  assert.equal(matchRating(idle, Position.OutsideHitter, 0, 0), 6.0);
  assert.equal(matchRating(idle, Position.Libero, 0, 0, 'quick'), 6.0);

  const monster = { ...newPlayerStats(0), ralliesPlayed: 180, attacksTotal: 60, attackKills: 40, serveAces: 8, blockPoints: 6 };
  const disaster = { ...newPlayerStats(0), ralliesPlayed: 180, attacksTotal: 40, attackErrors: 15, attackBlocked: 10, serveErrors: 8, receptionsTotal: 30, receptionErrors: 12 };
  const good = matchRating(monster, Position.Opposite, 3, 0);
  const bad = matchRating(disaster, Position.OutsideHitter, 0, 3);
  assert.ok(good > 8 && good <= 10, `a dominant match rates highly (${good})`);
  assert.ok(bad < 5 && bad >= 1, `a disastrous match rates poorly (${bad})`);
});

test('an ordinary night ends a little above 6, a great one is rare, a 9 rarer still — the same on both engines', () => {
  const report = runRatingReport(80, 77);
  for (const samples of [report.detailed, report.quick]) {
    const all = [...samples.values()].flatMap((s) => s.ratings).sort((a, b) => a - b);
    const mean = all.reduce((s, x) => s + x, 0) / all.length;
    const sd = Math.sqrt(all.reduce((s, x) => s + (x - mean) ** 2, 0) / all.length);
    assert.ok(mean > 6.05 && mean < 6.5, `a little above 6 (${mean.toFixed(2)})`);
    assert.ok(sd > 0.6 && sd < 1.1, `spread ${sd.toFixed(2)}`);
    assert.ok(all[Math.floor(all.length * 0.95)] <= 8.2, 'nineteen in twenty under 8.2');
    assert.ok(all.filter((r) => r >= 8).length / all.length < 0.08, 'an 8 is a night to remember');
    assert.ok(all.filter((r) => r >= 9).length / all.length < 0.01);
    // Every position on the same footing.
    for (const s of samples.values()) {
      const m = s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length;
      assert.ok(Math.abs(m - 6.25) < 0.3, `a position averages ${m.toFixed(2)}`);
    }
  }
});

test('a few points into a match nobody is anywhere near a 10 — a rating goes only as far as the time on court has earned', () => {
  const world = generateWorld({ seed: 31, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  const reachAfter = new Map<number, number>([[5, 0], [10, 0], [20, 0]]);
  for (let m = 0; m < 40; m++) {
    const sim = new MatchSimulator(world.players, {
      home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b), format: MatchFormat.BestOf5,
      importance: 0.5, neutralVenue: false, collectLog: false, seed: m + 1,
    });
    for (let rally = 1; rally <= 20; rally++) {
      sim.step();
      if (!reachAfter.has(rally)) continue;
      const live = sim.liveStats();
      for (const [team, f, ag] of [[live.home, live.homeSets, live.awaySets], [live.away, live.awaySets, live.homeSets]] as const) {
        for (const [p, s] of team.players) {
          const r = matchRating(s, world.players.position[p] as Position, f, ag);
          reachAfter.set(rally, Math.max(reachAfter.get(rally)!, Math.abs(r - 6)));
        }
      }
    }
  }
  assert.ok(reachAfter.get(5)! <= 0.4, `five points in: ${reachAfter.get(5)}`);
  assert.ok(reachAfter.get(10)! <= 0.6, `ten points in: ${reachAfter.get(10)}`);
  assert.ok(reachAfter.get(20)! <= 1.2, `twenty points in: ${reachAfter.get(20)}`);
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
