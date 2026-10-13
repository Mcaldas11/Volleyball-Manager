import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../model/positions.ts';
import { computeRatings } from '../match/ratings.ts';
import { BlockAssignment, OffensiveSystem, ServeTarget } from '../match/tactics.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { applyPlan, followsPlan, suggestPlan, undoPlan } from './gamePlan.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('the scouts\' plan: serve their weakest passer, block their offence, and it goes into every rotation — and comes back out', () => {
  const world = generateWorld({ seed: 97, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const [club, opp] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  appointManager(world, club.id);
  const store = world.players;
  // Make one of their passers plainly the weakest.
  const rx = opp.preferredLineup.filter((p) => store.position[p] === Position.OutsideHitter || store.position[p] === Position.Libero);
  const weak = rx[0];
  store.setAttr(weak, 'reception', 1);
  opp.tactics.offense = OffensiveSystem.MiddleFocused;

  const plan = suggestPlan(world, club, opp);
  assert.equal(plan.parts.length, 4);
  const target = plan.parts.find((p) => p.what === 'serveTarget')!;
  assert.equal(target.value, ServeTarget.WeakestPasser);
  assert.match(target.why, new RegExp(store.fullName(weak)));
  const weakest = rx.reduce((a, b) => (computeRatings(store, a, store.position[a] as Position).reception <= computeRatings(store, b, store.position[b] as Position).reception ? a : b));
  assert.equal(weakest, weak);
  assert.equal(plan.parts.find((p) => p.what === 'block')!.value, BlockAssignment.CommitMiddle, 'commit on a middle-heavy offence');

  const before = JSON.stringify(club.tactics);
  const same = club.tactics;
  applyPlan(world, club, plan, 123);
  assert.ok(followsPlan(club.tactics, plan));
  assert.ok(club.tactics.rotations.every((r) => r.serveTarget === ServeTarget.WeakestPasser && r.blockAssignment === BlockAssignment.CommitMiddle));
  assert.ok(undoPlan(world, club));
  assert.equal(JSON.stringify(club.tactics), before, 'exactly as it was');
  assert.equal(club.tactics, same, 'and the same object, for any tactic slot holding it');
  assert.equal(undoPlan(world, club), false, 'nothing left to undo');
});
