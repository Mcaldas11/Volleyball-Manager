import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from './engine.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';

/**
 * A double switch, as the planned substitution makes it: with the setter in zone 4 and the opposite in
 * zone 1, a bench setter comes on for the opposite and a bench opposite for the setter — and three
 * rotations later, the setter who came on in zone 4, the two who went off come back.
 */
test('a double switch: the setter who comes on sets from the back row, and the two who went off come back in their own positions', () => {
  const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 14);
  const sim = new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed: 3,
  });
  const court = (): number[] => sim.snapshot().homeCourt;
  const onCourt = (p: number): boolean => court().includes(p);
  const bench = sim.squadFor(0).filter((p) => !onCourt(p) && !sim.registeredLiberosOf(0).includes(p));
  const benchSetter = bench.find((p) => sim.roleOf(p) === Position.Setter);
  const benchOpposite = bench.find((p) => sim.roleOf(p) === Position.Opposite);
  assert.ok(benchSetter !== undefined && benchOpposite !== undefined, 'a setter and an opposite on the bench');

  // Play on until the setter is in zone 4 with the opposite in zone 1.
  const due = (s: number, o: number): boolean => court()[3] === s && court()[0] === o;
  const setterOn = (): number | undefined => court().find((p) => sim.roleOf(p) === Position.Setter);
  const oppositeOn = (): number | undefined => court().find((p) => sim.roleOf(p) === Position.Opposite);
  const setter = setterOn()!;
  const opposite = oppositeOn()!;
  for (let i = 0; i < 80 && !due(setter, opposite); i++) sim.step();
  assert.ok(due(setter, opposite), 'the setter came round to zone 4');

  assert.deepEqual(sim.substitute(0, opposite, benchSetter, Position.Setter), { ok: true });
  assert.deepEqual(sim.substitute(0, setter, benchOpposite, Position.Opposite), { ok: true });
  assert.equal(court()[0], benchSetter, 'the new setter in zone 1');
  assert.equal(court()[3], benchOpposite, 'the new opposite in zone 4, at the net');
  assert.equal(sim.subsRemaining(0), 4);

  // He sets from here on — nobody else on the side does.
  const setBy = new Set<number>();
  for (let i = 0; i < 80 && !due(benchSetter, benchOpposite); i++) {
    const entry = sim.step();
    for (const c of entry?.contacts ?? []) if (c.team === 0 && c.kind === 'set' && sim.roleOf(c.player) === Position.Setter) setBy.add(c.player);
  }
  assert.ok(setBy.has(benchSetter) && !setBy.has(setter), `the new setter sets: ${[...setBy].join(', ')}`);
  assert.ok(due(benchSetter, benchOpposite), 'three rotations on, the new setter is in zone 4');

  // And back: each only for whoever replaced him, in his own position.
  assert.notEqual(sim.substitutionCheck(0, benchOpposite, opposite), null, 'the opposite cannot come back for the wrong man');
  assert.deepEqual(sim.substitute(0, benchOpposite, setter, Position.Setter), { ok: true });
  assert.deepEqual(sim.substitute(0, benchSetter, opposite, Position.Opposite), { ok: true });
  assert.equal(court()[0], setter);
  assert.equal(court()[3], opposite);
  assert.equal(sim.roleOf(setter), Position.Setter);
  assert.equal(sim.roleOf(opposite), Position.Opposite);
  assert.equal(sim.subsRemaining(0), 2);
});
