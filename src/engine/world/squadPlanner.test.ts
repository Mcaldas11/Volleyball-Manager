import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { contractEndSeason, seasonEndDay, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, POSITIONS } from '../model/positions.ts';
import {
  addPlanTarget, PLAN_DEPTH, planCandidates, projectedAbility, removePlanTarget, squadPlan, tidyPlanTargets,
} from './squadPlanner.ts';

function career() {
  const world = generateWorld({ seed: 73, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[1];
  appointManager(world, club.id);
  return { world, club };
}

test('the plan shows the squad by position over three seasons, a contract running out gone the season after', () => {
  const { world, club } = career();
  const store = world.players;
  const p = club.players.find((q) => !store.hasFlag(q, PlayerFlag.Youth))!;
  store.contractUntil[p] = seasonEndDay(world.season);
  const plan = squadPlan(world, club);
  assert.deepEqual(plan.seasons, [world.season, world.season + 1, world.season + 2]);
  assert.equal(plan.cells.length, POSITIONS.length);
  const row = plan.cells[POSITIONS.indexOf(store.position[p] as Position)];
  const now = row[0].players.find((e) => e.p === p);
  assert.ok(now !== undefined && now.tags.includes('expires'), 'there this season, his deal ending');
  assert.ok(!row[1].players.some((e) => e.p === p), 'gone the next');
  // Everyone counted is under contract for the season shown.
  for (const r of plan.cells) for (const c of r) for (const e of c.players) assert.ok(contractEndSeason(store.contractUntil[e.p]) >= c.season);
});

test('a position short of its depth shows the gap, and a target can be marked against it', () => {
  const { world, club } = career();
  const store = world.players;
  // Every setter's deal ends this season: next season, both places are empty.
  for (const p of club.players) if (store.position[p] === Position.Setter) store.contractUntil[p] = seasonEndDay(world.season);
  const plan = squadPlan(world, club);
  const next = plan.cells[POSITIONS.indexOf(Position.Setter)][1];
  assert.equal(next.players.length, 0);
  assert.equal(next.gaps, PLAN_DEPTH[Position.Setter]);
  assert.ok(plan.summary[1].gaps >= PLAN_DEPTH[Position.Setter]);

  const [target] = planCandidates(world, club, Position.Setter, 5);
  assert.ok(target !== undefined, 'someone to look at');
  assert.equal(store.position[target], Position.Setter);
  assert.notEqual(store.clubId[target], club.id);
  addPlanTarget(world, target, Position.Setter, world.season + 1);
  assert.ok(squadPlan(world, club).cells[POSITIONS.indexOf(Position.Setter)][1].targets.some((e) => e.p === target));
  // Marked again, he moves rather than appearing twice.
  addPlanTarget(world, target, Position.Setter, world.season + 2);
  assert.equal(world.squadPlan!.targets.filter((t) => t.p === target).length, 1);
  // Signed: the plan no longer counts him as a target.
  store.clubId[target] = club.id;
  tidyPlanTargets(world, club);
  assert.equal(world.squadPlan!.targets.length, 0);
  addPlanTarget(world, target, Position.Setter, world.season);
  removePlanTarget(world, target);
  assert.equal(world.squadPlan!.targets.length, 0);
});

test('projections: the young grow towards their potential, the old fade', () => {
  const { world } = career();
  const store = world.players;
  const young = [...Array(store.count).keys()].find((p) => store.isActive(p) && store.ageOn(p, world.year, 181) <= 20
    && store.potentialAbility[p] > store.currentAbility[p] + 200)!;
  const old = [...Array(store.count).keys()].find((p) => store.isActive(p) && store.ageOn(p, world.year, 181) >= 33)!;
  assert.ok(projectedAbility(world, young, 2) > store.currentAbility[young]);
  assert.ok(projectedAbility(world, young, 2) <= store.potentialAbility[young]);
  assert.ok(projectedAbility(world, old, 2) < store.currentAbility[old]);
  assert.equal(projectedAbility(world, young, 0), store.currentAbility[young]);
});
