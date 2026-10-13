import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { analysisFor, GRID, seasonFromReports } from './analysis.ts';
import { appointManager } from './career.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('the analyst keeps a season of the club: where the attacks came down, both ways, each attacker by lane, each rotation, each match', () => {
  const world = generateWorld({ seed: 95, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1)[0];
  appointManager(world, club.id);
  for (let d = 0; d < 110; d++) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });

  const a = analysisFor(world, club.id, world.season)!;
  assert.ok(a !== undefined && a.matches > 3, 'matches noted');
  for (const map of [a.ours, a.theirs]) {
    assert.equal(map.attacks.length, GRID * GRID);
    const attacks = map.attacks.reduce((s, x) => s + x, 0);
    assert.ok(attacks > 50, `${attacks} attacks placed`);
    map.kills.forEach((k, i) => assert.ok(k <= map.attacks[i]));
    assert.ok(map.long + map.wide > 0, 'some hit out');
  }
  // Every cell of the court gets attacked over a season — the hitters reach it all.
  assert.ok(a.ours.attacks.filter((x) => x > 0).length >= 30);
  const lanes = Object.values(a.lanes);
  assert.ok(lanes.length > 3 && lanes.every(([att, k, err]) => k + err <= att));

  const r = seasonFromReports(world, club.id, world.season);
  // Every competitive match the club played this season, in order.
  const played = world.fixtures.filter((f) => f.played && (f.home === club.id || f.away === club.id) &&
    world.competitions[f.competitionId]?.kind !== 'friendly');
  assert.equal(r.matches.length, played.length);
  assert.ok(r.matches.every((m, i) => i === 0 || m.fixture.day >= r.matches[i - 1].fixture.day));
  assert.ok(r.matches.every((m) => m.killRate > 0 && m.killRate < 1 && m.sideOut > 0 && m.sideOut < 1));
  const received = r.rotations.reduce((s, x) => s + x.receiveRallies, 0);
  assert.ok(received > 100 && r.rotations.every((x) => x.sideOutsWon <= x.receiveRallies));
  assert.ok(r.totals.kills <= r.totals.attacks && r.totals.sets >= played.length * 3);
});
