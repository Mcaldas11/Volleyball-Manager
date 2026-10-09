import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { reviewCompetition } from './competitionReview.ts';
import { teamAwardsOf } from './teamAwards.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager } from './world.ts';

test('a competition ends with its team awards — the best attack, defence, block, serve and passing — each with the players who made it', () => {
  const world = generateWorld({ seed: 82, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[3];
  appointManager(world, club.id);
  const league = world.competitions[club.leagueId];
  while (world.day < DAYS_PER_SEASON - 2) advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  const lines = structuredClone(world.teamLines?.[`${world.season}:${league.id}`]);
  endSeason(world, ctx);

  const r = world.messages.find((m) => m.competitionReview?.competitionId === league.id)!.competitionReview!;
  const awards = r.teamAwards ?? [];
  for (const k of ['attack', 'defence', 'block', 'serve', 'reception', 'clinical'] as const) {
    assert.ok(awards.some((a) => a.key === k), `a ${k} award`);
  }
  // The same sides the matches say: most scored a set, fewest conceded.
  assert.equal(awards.find((a) => a.key === 'attack')!.clubId, r.bestAttack!.clubId);
  assert.equal(awards.find((a) => a.key === 'defence')!.clubId, r.bestDefence!.clubId);

  assert.ok(lines !== undefined, 'the league was followed match by match');
  for (const a of awards) {
    assert.notEqual(a.chasers[0]?.clubId, a.clubId, 'the chasers are other sides');
    if (a.key === 'comeback') {
      assert.ok((a.matches?.length ?? 0) >= 2);
      continue;
    }
    // Every man named played for the side, the biggest part first, and the parts add up to no more than the whole.
    assert.ok(a.players.length > 0, `players for ${a.key}`);
    for (const x of a.players) assert.ok(lines![a.clubId].players[x.p] !== undefined, `${x.p} played for them`);
    for (let i = 1; i < a.players.length; i++) assert.ok(a.players[i - 1].share >= a.players[i].share);
    assert.ok(a.players.reduce((n, x) => n + x.share, 0) <= 1.0001);
  }
  // The blockers' blocks are the side's.
  const block = awards.find((a) => a.key === 'block')!;
  const blocks = Object.values(lines![block.clubId].players).reduce((n, sh) => n + sh.blocks, 0);
  assert.ok(block.value.includes(`${blocks} in all`), block.value);
});

test('a competition not followed from its first match gets no team awards, rather than awards on half of it', () => {
  const world = generateWorld({ seed: 83, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  appointManager(world, club.id);
  const league = world.competitions[club.leagueId];
  while (world.day < 150) advanceDay(world, ctx);
  assert.ok(teamAwardsOf(world, league).length > 0, 'followed from the start: awards so far');
  // A save from before they were kept.
  delete world.teamLines;
  while (world.day < 200) advanceDay(world, ctx);
  assert.deepEqual(teamAwardsOf(world, league), []);
  assert.deepEqual(reviewCompetition(world, league).teamAwards, []);
});
