import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, simulateMatch, type TeamSetup } from '../match/engine.ts';
import { Formation } from '../match/tactics.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { LINEUP_SLOT_POSITIONS_42, pickLineup, toTeamSetup } from './seasonEngine.ts';

function twoClubs(seed: number) {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.filter((p) => world.players.position[p] === Position.Setter).length >= 2);
  return { world, a, b };
}

test('a 4-2 starts two setters diagonal, where a 5-1 has a setter and an opposite', () => {
  const { world, a } = twoClubs(61);
  const store = world.players;
  const fiveOne = pickLineup(store, a);
  assert.equal(store.position[fiveOne.lineup[0]], Position.Setter);
  assert.equal(store.position[fiveOne.lineup[3]], Position.Opposite);
  a.tactics.formation = Formation.FourTwo;
  const fourTwo = pickLineup(store, a);
  assert.deepEqual(fourTwo.lineup.map((p) => store.position[p]), [...LINEUP_SLOT_POSITIONS_42]);
});

test('in a 4-2 both setters set — from the back row — and both attack, from the front', () => {
  const { world, a, b } = twoClubs(62);
  const store = world.players;
  a.tactics.formation = Formation.FourTwo;
  const home = toTeamSetup(store, a);
  const setters = [home.lineup[0], home.lineup[3]];
  // Over a few matches, so one short night doesn't decide it.
  const sets = [0, 0];
  const attacks = [0, 0];
  for (const seed of [9, 10, 11, 12, 13, 14]) {
    const result = simulateMatch(store, {
      home, away: toTeamSetup(store, b), format: MatchFormat.BestOf5, importance: 0.5,
      neutralVenue: false, collectLog: false, seed,
    });
    setters.forEach((s, i) => {
      const line = result.stats.home.players.get(s);
      sets[i] += line?.setsMade ?? 0;
      attacks[i] += line?.attacksTotal ?? 0;
    });
  }
  for (let i = 0; i < 2; i++) {
    assert.ok(sets[i] > 120, 'each sets a share of every match');
    assert.ok(attacks[i] > 10, 'and hits on the right when at the net');
  }
});

/** Every second touch of a match, with the first touch before it. */
function secondTouches(seed: number, formation: Formation) {
  const { world, a, b } = twoClubs(seed);
  const store = world.players;
  a.tactics.formation = formation;
  const home = toTeamSetup(store, a);
  const pairs: Array<{ first: number; second: number; quality: number }> = [];
  // A few matches: a bad ball the setter can't reach is not an every-night thing.
  for (const seed of [11, 12, 13]) {
    const result = simulateMatch(store, {
      home, away: toTeamSetup(store, b), format: MatchFormat.BestOf5, importance: 0.5,
      neutralVenue: false, collectLog: true, seed,
    });
    for (const r of result.log ?? []) {
      let first = -1;
      let quality = 1;
      for (const c of r.contacts) {
        if (c.team !== 0) continue;
        if (c.kind === 'reception' || c.kind === 'dig') { first = c.player; quality = c.quality ?? 1; }
        if ((c.kind === 'set' || c.kind === 'setError') && first >= 0) { pairs.push({ first, second: c.player, quality }); first = -1; }
      }
    }
  }
  return { store, home, pairs };
}

test('nobody plays the ball twice: when the setter digs in a 5-1, the libero sets — and on a bad ball he often does', () => {
  const { store, home, pairs } = secondTouches(63, Formation.FiveOne);
  assert.ok(pairs.every((x) => x.first !== x.second), 'never the same player twice');
  const setter = home.lineup[0];
  const afterSetter = pairs.filter((x) => x.first === setter);
  assert.ok(afterSetter.length > 0, 'the setter dug or passed some balls');
  assert.ok(afterSetter.every((x) => store.position[x.second] === Position.Libero || x.second !== setter));
  assert.ok(afterSetter.some((x) => store.position[x.second] === Position.Libero), 'the libero took his place');
  const badBalls = pairs.filter((x) => x.quality < 0.22 && x.first !== home.libero);
  assert.ok(badBalls.some((x) => x.second === home.libero), 'the libero chases a bad ball');
});

test('in a 4-2, when one setter plays the first ball, the other sets', () => {
  const { store, home, pairs } = secondTouches(64, Formation.FourTwo);
  const setters = new Set([home.lineup[0], home.lineup[3]]);
  const afterSetter = pairs.filter((x) => setters.has(x.first));
  assert.ok(afterSetter.length > 0, 'a setter dug or passed some balls');
  assert.ok(afterSetter.every((x) => x.second !== x.first));
  assert.ok(afterSetter.filter((x) => store.position[x.second] === Position.Setter).length >= afterSetter.length * 0.7,
    'mostly the other setter');
});

/** A side with no setter on the bench — but an opposite as good as its setters — its first setter worn out before the first serve. */
function tiredSetter(formation: Formation) {
  const { world, a, b } = twoClubs(64);
  const store = world.players;
  a.tactics.formation = formation;
  const setup = toTeamSetup(store, a);
  const home: TeamSetup = { ...setup, bench: setup.bench.filter((p) => store.position[p] !== Position.Setter) };
  const sim = new MatchSimulator(store, {
    home, away: toTeamSetup(store, b), format: MatchFormat.BestOf5, importance: 0.5,
    neutralVenue: true, collectLog: true, seed: 5,
  });
  const setter = home.lineup[0];
  // Reaching into the engine's live ratings: running a setter into the ground
  // for real would take most of a match.
  const runtime = sim as unknown as { teams: Array<{ rate(p: number): { fatigue: number } }> };
  const tire = (p: number): void => {
    runtime.teams[0].rate(p).fatigue = 0.74;
  };
  return { store, sim, home, setter, tire };
}

test('in a 4-2, a setter who has to come off can make way for an opposite — the other setter sets on', () => {
  const { store, sim, home, setter, tire } = tiredSetter(Formation.FourTwo);
  assert.ok(home.bench.some((p) => store.position[p] === Position.Opposite));
  const fresh = sim.suggestSubstitution(0);
  assert.ok(fresh?.outPlayerIdx !== setter, 'not while he is fresh');

  tire(setter);
  const plan = sim.suggestSubstitution(0);
  assert.ok(plan !== null);
  assert.equal(plan.outPlayerIdx, setter);
  assert.equal(store.position[plan.inPlayerIdx], Position.Opposite);
  assert.equal(plan.reason, 'fatigue');
  assert.ok(sim.substitute(0, plan.outPlayerIdx, plan.inPlayerIdx).ok);

  // The last setter is never the one to go, however tired.
  const other = home.lineup[3];
  tire(other);
  const next = sim.suggestSubstitution(0);
  assert.ok(next?.outPlayerIdx !== other || store.position[next.inPlayerIdx] === Position.Setter);

  const sets = new Map<number, number>();
  const hits = new Map<number, number>();
  while (sim.snapshot().set === 0) {
    for (const c of sim.step()!.contacts) {
      if (c.team !== 0) continue;
      if (c.kind === 'set') sets.set(c.player, (sets.get(c.player) ?? 0) + 1);
      if (c.kind === 'attack' || c.kind === 'kill' || c.kind === 'attackError' || c.kind === 'blocked') {
        hits.set(c.player, (hits.get(c.player) ?? 0) + 1);
      }
    }
  }
  const total = [...sets.values()].reduce((x, y) => x + y, 0);
  assert.equal(sets.get(setter) ?? 0, 0, 'the setter taken off sets nothing more');
  assert.ok((sets.get(other) ?? 0) > total * 0.75, 'the other setter runs the offence');
  assert.ok((hits.get(plan.inPlayerIdx) ?? 0) > 0, 'and the opposite hits');
});

test('in a 4-2, a set break can start an opposite for a worn-out setter; a 5-1 never swaps its setter for one', () => {
  const fourTwo = tiredSetter(Formation.FourTwo);
  fourTwo.tire(fourTwo.setter);
  const sheet = fourTwo.sim.suggestStartingLineup(0);
  assert.ok(sheet !== null);
  assert.equal(fourTwo.store.position[sheet.lineup[0]], Position.Opposite);
  assert.equal(sheet.lineup.filter((p) => fourTwo.store.position[p] === Position.Setter).length, 1);

  const fiveOne = tiredSetter(Formation.FiveOne);
  fiveOne.tire(fiveOne.setter);
  assert.ok(fiveOne.sim.suggestSubstitution(0)?.outPlayerIdx !== fiveOne.setter);
  assert.equal(fiveOne.sim.suggestStartingLineup(0)?.lineup[0] ?? fiveOne.setter, fiveOne.setter);
});

test('a side can switch to a 4-2 mid-match: a second setter on for the opposite, and from the next rally both set', () => {
  const { world, a, b } = twoClubs(64);
  const store = world.players;
  a.tactics.formation = Formation.FiveOne;
  const home = toTeamSetup(store, a);
  const sim = new MatchSimulator(store, {
    home, away: toTeamSetup(store, b), format: MatchFormat.BestOf5, importance: 0.5,
    neutralVenue: true, collectLog: true, seed: 7,
  });
  for (let i = 0; i < 6; i++) sim.step();
  const court = sim.snapshot().homeCourt;
  const setter = court.find((p) => store.position[p] === Position.Setter)!;
  const opposite = court[(court.indexOf(setter) + 3) % 6];
  const second = home.bench.find((p) => store.position[p] === Position.Setter)!;
  assert.ok(second !== undefined, 'a setter on the bench');
  // A change of system: he comes on to play his own position — as the interface asks.
  assert.equal(sim.substitute(0, opposite, second, Position.Setter).ok, true);
  // The live tactics are the very object the engine reads.
  home.tactics.formation = Formation.FourTwo;
  const setBy = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const r = sim.step();
    if (r === null || r.set !== 0) break;
    for (const c of r.contacts) if (c.team === 0 && c.kind === 'set') setBy.add(c.player);
  }
  assert.ok(setBy.has(setter) && setBy.has(second), 'both setters set, each from the back row');
});
