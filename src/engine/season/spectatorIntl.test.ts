import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSimulator, type MatchResult } from '../match/engine.ts';
import { findIntlMatch } from '../world/internationals.ts';
import { reportResult } from '../world/matchReports.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager, type Fixture, type World } from '../world/world.ts';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from './seasonEngine.ts';
import { canWatch, commitWatched, spectatorSetup, watchListToday } from './spectator.ts';

/** A world on the first day with a national teams' match to watch from the stands. */
function intlDay(seed: number): { world: World; ctx: SeasonContext; f: Fixture } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const intl = (): Fixture | undefined => watchListToday(world).find((x) => x.fixture.id < 0)?.fixture;
  for (let i = 0; i < 500 && intl() === undefined; i++) advanceDay(world, ctx, {});
  const f = intl();
  assert.ok(f !== undefined, 'a day with a national teams\' match on');
  return { world, ctx, f };
}

function watchLive(world: World, f: Fixture): MatchResult {
  const sim = new MatchSimulator(world.players, spectatorSetup(world, f));
  while (sim.step() !== null) { /* rally by rally, as the live screen plays it */ }
  return sim.buildResult();
}

const { world, ctx, f } = intlDay(43);

test('a national teams\' match can be watched from the stands, and goes into its tournament', () => {
  assert.ok(canWatch(world, f));
  const found = findIntlMatch(world, -1 - f.id);
  assert.ok(found !== null);
  const { t, m } = found;
  const before = world.news.length;
  const story = commitWatched(world, ctx, f, watchLive(world, f));
  assert.equal(m.played, true);
  assert.equal(m.homeSets === 3 || m.awaySets === 3, true);
  assert.equal(canWatch(world, f), false, 'never watched twice');
  assert.ok(story !== null && story.headline.includes(t.name), 'the papers report him at the tournament');
  assert.ok(world.news.length > before);
  assert.ok(!story.headline.includes('—') && !story.body.includes('—'), 'no long dashes in game text');
  // Its box score is kept with the tournament.
  const kept = t.reports?.[m.id];
  assert.ok(kept !== undefined && kept.lines.length >= 12);
  assert.equal(reportResult(m, kept).stats.home.players.size > 0, true);

  // The day goes on: the match watched is not played again.
  const score = [m.homeSets, m.awaySets, [...m.setScores]];
  advanceDay(world, ctx, {});
  assert.deepEqual([m.homeSets, m.awaySets, m.setScores], score);
});

test('every national teams\' match played keeps its box score', () => {
  for (let i = 0; i < 6; i++) advanceDay(world, ctx, {});
  const played = (world.internationals?.tournaments ?? []).flatMap((t) => t.matches.filter((m) => m.played).map((m) => ({ t, m })));
  assert.ok(played.length > 5);
  for (const { t, m } of played) assert.ok(t.reports?.[m.id] !== undefined, `${t.name}: ${m.stage}`);
});
