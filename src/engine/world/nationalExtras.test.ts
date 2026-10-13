import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointNationalCoach, createFriendly, eligibleFor, internationalDay, internationals, selectionScore, suggestSquad } from './internationals.ts';
import {
  arrangeFriendly, FRAME_MAX, frameOf, friendlyDays, friendlyOpponents, MAX_FRIENDLIES, toggleFrame, toggleWatch, watchingList,
} from './nationalExtras.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager, type World } from './world.ts';

function setup(seed: number): { world: World; nation: number } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const top = world.clubs.filter((c) => c.tier === 1).sort((a, b) => b.reputation - a.reputation)[0];
  const nation = top.nation;
  appointNationalCoach(world, nation);
  return { world, nation };
}

test('a friendly: arranged on a free date in the national months, three a season, caps but no ranking points', () => {
  const { world, nation } = setup(181);
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // The end of spring: the national team's months.
  world.day = world.season * DAYS_PER_SEASON + 300;
  const opp = friendlyOpponents(world)[0];
  const days = friendlyDays(world, opp);
  assert.ok(days.length > 0, 'free dates');
  assert.ok(days.every((d) => d >= world.day + 7));
  const r = arrangeFriendly(world, opp, days[0], true);
  assert.ok(r.ok, r.text);
  const t = internationals(world).tournaments.find((x) => x.kind === 'friendly')!;
  assert.deepEqual(t.teams, [nation, opp]);
  assert.equal(arrangeFriendly(world, opp, days[0], true).ok, false, 'not on a date it already plays');
  // Played: everyone home, caps, no ranking points — the two nations' points as they were that morning.
  const points = (): string => world.nationalTeams.filter((x) => x.nation === nation || x.nation === opp).map((x) => x.rankingPoints).join(',');
  for (let d = world.day; d <= days[0] + 1; d++) {
    world.day = d;
    const before = points();
    // The manager names no squad: the assistant does.
    internationalDay(world);
    if (d === days[0]) assert.equal(points(), before, 'the ranking doesn\'t count it');
  }
  assert.equal(t.status, 'done');
  assert.ok(t.matches[0].played);
  assert.ok(t.squads.flatMap(([, s]) => s).some((p) => world.players.nationalCaps[p] > 0));
  // Three a season at most.
  const others = friendlyOpponents(world).filter((o) => o !== opp);
  for (let i = 1; i < MAX_FRIENDLIES; i++) createFriendly(world, nation, others[i], world.day + 2 * i);
  const free = friendlyDays(world, others[9]);
  const tooMany = arrangeFriendly(world, others[9], free[0] ?? world.day + 8, true);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.text, new RegExp(`${MAX_FRIENDLIES} friendlies`));
});

test('the provisional squad: up to 25 in the frame, the assistant\'s fourteen from them first — and they hear how they stand', () => {
  const { world, nation } = setup(182);
  const pool = eligibleFor(world, nation).sort((a, b) => selectionScore(world, a) - selectionScore(world, b));
  // The weakest few in the frame: they make the assistant's fourteen.
  const weak = pool.slice(0, 6);
  for (const p of weak) assert.match(toggleFrame(world, p), /provisional squad/);
  const squad = suggestSquad(world, nation);
  assert.ok(weak.filter((p) => squad.includes(p)).length >= 3, 'the frame comes first');
  assert.match(toggleFrame(world, weak[0]), /out of the frame/);
  assert.equal(frameOf(world).length, 5);
  for (const p of pool.slice(10, 10 + FRAME_MAX)) toggleFrame(world, p);
  assert.equal(frameOf(world).length, FRAME_MAX);
});

test('watching a club match: the coach sees him play, knows him better, and has the report', () => {
  const { world, nation } = setup(183);
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const p = eligibleFor(world, nation).find((q) => world.players.clubId[q] >= 0 && world.clubs[world.players.clubId[q]].tier === 1)!;
  const before = world.scoutingKnowledge.get(p)?.matchesWatched ?? 0;
  assert.match(toggleWatch(world, p), /next match/);
  assert.deepEqual(watchingList(world), [p]);
  for (let d = 0; d < 120 && watchingList(world).length > 0; d++) advanceDay(world, ctx);
  assert.deepEqual(watchingList(world), []);
  const report = world.messages.find((m) => m.subject.startsWith(`Watched: ${world.players.fullName(p)}`))!;
  assert.ok(report !== undefined);
  if (!report.subject.endsWith("didn't play")) assert.equal(world.scoutingKnowledge.get(p)!.matchesWatched, before + 3);
});
