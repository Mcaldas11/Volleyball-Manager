import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, simulateMatch, type MatchSetup } from './engine.ts';
import { MATCH_INJURIES } from './injury.ts';
import { Position } from '../model/positions.ts';
import { InjuryType } from '../model/players.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';

function match(seed: number): { w: ReturnType<typeof generateWorld>; setup: MatchSetup } {
  const w = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = w.clubs.filter((c) => c.tier === 1 && c.players.length >= 18);
  return {
    w,
    setup: {
      home: toTeamSetup(w.players, a), away: toTeamSetup(w.players, b),
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed,
    },
  };
}

const kindOf = (type: InjuryType): number => MATCH_INJURIES.findIndex((k) => k.type === type);

test('players get hurt in matches — about once in ten for a side, mostly knocks they can play on with', () => {
  const { w, setup } = match(61);
  let events = 0;
  let knocks = 0;
  let sides = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = simulateMatch(w.players, { ...setup, seed });
    sides += 2;
    events += r.injuries?.length ?? 0;
    knocks += (r.injuries ?? []).filter((i) => MATCH_INJURIES[i.kind].severity === 'knock').length;
  }
  const rate = events / sides;
  assert.ok(rate > 0.05 && rate < 0.2, `${rate.toFixed(3)} a side a match`);
  assert.ok(knocks / events > 0.55 && knocks / events < 0.85, `${knocks} knocks of ${events}`);
});

test('a player hurt too badly to go on comes off before the next serve, and takes no further part', () => {
  const { w, setup } = match(62);
  const sim = new MatchSimulator(w.players, setup);
  sim.step();
  const victim = sim.snapshot().homeCourt.find((p) => w.players.position[p] === Position.OutsideHitter)!;
  sim.injure(0, victim, kindOf(InjuryType.AnkleSprain));
  sim.step();
  const court = sim.snapshot().homeCourt;
  assert.ok(!court.includes(victim), 'off');
  assert.ok(sim.isOutHurt(0, victim));
  // Nor back on, nor in the sets to come.
  const someone = court.find((p) => p !== victim)!;
  assert.equal(sim.substitute(0, someone, victim).ok, false);
  sim.finish();
  const r = sim.buildResult();
  const inj = r.injuries!.find((i) => i.p === victim)!;
  assert.equal(inj.off, true);
});

test("the live coach answers for his own: the match waits for him — and when the five are used up, the exceptional substitution", () => {
  const { w, setup } = match(63);
  const sim = new MatchSimulator(w.players, setup);
  sim.answerInjuriesFor(0, true);
  sim.step();
  // Five changes made already this set.
  const bench = setup.home.bench.filter((p) => w.players.position[p] !== Position.Libero);
  let made = 0;
  for (const inc of bench) {
    if (made >= 5) break;
    const out = sim.snapshot().homeCourt.find((p) => sim.roleOf(p) === sim.roleOf(inc) && !setup.home.bench.includes(p));
    if (out !== undefined && sim.substitute(0, out, inc).ok) made++;
  }
  while (sim.subsRemaining(0) > 0) {
    const inc = bench.find((p) => !sim.snapshot().homeCourt.includes(p));
    const out = sim.snapshot().homeCourt.find((p) => !bench.includes(p));
    if (inc === undefined || out === undefined || !sim.substitute(0, out, inc).ok) break;
  }
  assert.equal(sim.subsRemaining(0), 0);
  const victim = sim.snapshot().homeCourt[2];
  sim.injure(0, victim, kindOf(InjuryType.MuscleStrain));
  assert.equal(sim.injuryWaiting(0)?.p, victim, 'waiting on the coach');
  const inc = sim.injuryReplacement(0, victim);
  assert.ok(inc >= 0);
  assert.equal(sim.injurySubstitute(0, victim, inc).ok, true, 'the exceptional substitution');
  assert.equal(sim.injuryWaiting(0), null);
  assert.ok(sim.snapshot().homeCourt.includes(inc) && !sim.snapshot().homeCourt.includes(victim));
  assert.equal(sim.subsRemaining(0), 0, 'it used none of the five');
});

test('a libero hurt: a spare named for the match takes over — with none, the other libero alone, or none at all', () => {
  const { w, setup } = match(64);
  const sim = new MatchSimulator(w.players, setup);
  sim.step();
  const { reception, defence } = sim.liberos(0);
  sim.injure(0, reception, kindOf(InjuryType.AnkleSprain));
  sim.step();
  const now = sim.liberos(0);
  assert.notEqual(now.reception, reception);
  assert.ok(now.reception === defence || sim.registeredLiberosOf(0).includes(now.reception) || now.reception === -1);
  // The last libero down too: the side plays on without one.
  if (now.reception >= 0) {
    sim.injure(0, now.reception, kindOf(InjuryType.AnkleSprain));
    sim.step();
    const after = sim.liberos(0);
    assert.ok(after.reception !== now.reception);
  }
  sim.finish();
  assert.ok(sim.buildResult().homeSets + sim.buildResult().awaySets >= 3, 'and the match is played out');
});

test('a knock: the engine takes him off for a like-for-like change if it can — otherwise he plays on, below himself', () => {
  const { w, setup } = match(65);
  const sim = new MatchSimulator(w.players, setup);
  sim.step();
  const victim = sim.snapshot().homeCourt.find((p) => w.players.position[p] === Position.MiddleBlocker)!;
  const inj = sim.injure(0, victim, kindOf(InjuryType.TurnedAnkle));
  sim.step();
  const replaced = !sim.snapshot().homeCourt.includes(victim);
  assert.equal(replaced, inj.off === true);
  if (!replaced) assert.ok(sim.knocks(0).some((k) => k.p === victim), 'playing on with it');
});
