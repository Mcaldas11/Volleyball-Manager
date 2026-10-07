import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { selectionScore } from '../model/ability.ts';
import type { PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { MatchFormat, MatchSimulator, type MatchSetup } from './engine.ts';

function buildMatch(worldSeed: number, matchSeed: number): { store: PlayerStore; setup: MatchSetup } {
  const world = generateWorld({ seed: worldSeed, startYear: 2026, scale: 'small', manager: stubManager() });
  const home = world.clubs[0];
  const away = world.clubs[1];
  return {
    store: world.players,
    setup: {
      home: toTeamSetup(world.players, home),
      away: toTeamSetup(world.players, away),
      format: MatchFormat.BestOf5,
      importance: 0.5,
      neutralVenue: false,
      collectLog: true,
      seed: matchSeed,
    },
  };
}

test('MatchSimulator.run() is deterministic for a given seed', () => {
  const a = buildMatch(1, 999);
  const b = buildMatch(1, 999);
  const resultA = new MatchSimulator(a.store, a.setup).run();
  const resultB = new MatchSimulator(b.store, b.setup).run();

  assert.deepEqual(resultA.setScores, resultB.setScores);
  assert.equal(resultA.homeSets, resultB.homeSets);
  assert.equal(resultA.awaySets, resultB.awaySets);
});

test('step()-driven playback matches run() for the same seed', () => {
  const a = buildMatch(2, 555);
  const b = buildMatch(2, 555);
  const viaRun = new MatchSimulator(a.store, a.setup).run();

  const stepped = new MatchSimulator(b.store, b.setup);
  while (stepped.step() !== null) { /* drain one rally at a time */ }
  const viaStep = stepped.buildResult();

  assert.deepEqual(viaStep.setScores, viaRun.setScores);
  assert.equal(viaStep.homeSets, viaRun.homeSets);
  assert.equal(viaStep.awaySets, viaRun.awaySets);
});

test('substitute() swaps the bench player into the correct zone', () => {
  const { store, setup } = buildMatch(3, 111);
  const sim = new MatchSimulator(store, setup);
  sim.step(); // starts the match

  const outPlayer = setup.home.lineup[0];
  const inPlayer = setup.home.bench[0];
  const result = sim.substitute(0, outPlayer, inPlayer);

  assert.equal(result.ok, true);
  const snap = sim.snapshot();
  assert.ok(snap.homeCourt.includes(inPlayer));
  assert.ok(!snap.homeCourt.includes(outPlayer));
});

test('substitute() rejects a player outside the squad', () => {
  const { store, setup } = buildMatch(4, 222);
  const sim = new MatchSimulator(store, setup);
  sim.step();

  const outPlayer = setup.home.lineup[0];
  const result = sim.substitute(0, outPlayer, 999_999);
  assert.equal(result.ok, false);
});

test('substitute() enforces the five-per-set limit', () => {
  const { store, setup } = buildMatch(5, 333);
  assert.ok(setup.home.bench.length >= 6, 'this test needs at least 6 bench players');
  const sim = new MatchSimulator(store, setup);
  sim.step();

  for (let i = 0; i < 5; i++) {
    const outPlayer = setup.home.lineup[i];
    const inPlayer = setup.home.bench[i];
    const result = sim.substitute(0, outPlayer, inPlayer);
    assert.equal(result.ok, true, `substitution ${i} should succeed`);
  }

  // Zone 5 was never touched by the loop above, so this is a fresh pair —
  // it should still fail, but purely on the count limit, not the pairing rule.
  const sixthOut = sim.snapshot().homeCourt[5];
  const sixthIn = setup.home.bench[5];
  const sixth = sim.substitute(0, sixthOut, sixthIn);
  assert.equal(sixth.ok, false);
  assert.equal(sim.subsRemaining(0), 0);
});

test('substitute() only lets a substituted starter return for the player who replaced them', () => {
  const { store, setup } = buildMatch(6, 444);
  assert.ok(setup.home.bench.length >= 2, 'this test needs at least 2 bench players');
  const sim = new MatchSimulator(store, setup);
  sim.step();

  const starter = setup.home.lineup[0];
  const sub1 = setup.home.bench[0];
  const sub2 = setup.home.bench[1];

  assert.equal(sim.substitute(0, starter, sub1).ok, true);

  // A different bench player may not come in for sub1 — only the starter may.
  assert.equal(sim.substitute(0, sub1, sub2).ok, false);

  // The starter returning for sub1 (their own replacement) is fine.
  assert.equal(sim.substitute(0, sub1, starter).ok, true);
  assert.ok(sim.snapshot().homeCourt.includes(starter));

  // The pair is locked for the rest of the set: sub2 still can't break in...
  assert.equal(sim.substitute(0, starter, sub2).ok, false);
  // ...only sub1 can replace the starter again.
  assert.equal(sim.substitute(0, starter, sub1).ok, true);
});

test('substitute() will not bring on a bench player already paired with someone else', () => {
  const { store, setup } = buildMatch(6, 445);
  const sim = new MatchSimulator(store, setup);
  sim.step();

  const [starterA, starterB] = setup.home.lineup;
  const sub = setup.home.bench[0];
  assert.equal(sim.substitute(0, starterA, sub).ok, true);
  assert.equal(sim.substitute(0, sub, starterA).ok, true);

  // `sub` has had their one swap this set, with starterA — they can't now
  // come on for anybody else.
  assert.equal(sim.substitute(0, starterB, sub).ok, false);
});

test('suggestSubstitution() makes no change at the first whistle when the starters are the best available', () => {
  const { store, setup } = buildMatch(11, 1111);
  for (const team of [setup.home, setup.away]) {
    for (const starter of team.lineup) {
      const clearlyBetter = team.bench.some((p) =>
        store.position[p] === store.position[starter]
        && store.currentAbility[p] > store.currentAbility[starter] * 1.04);
      assert.ok(!clearlyBetter, 'this test needs starters no reserve clearly outranks');
    }
  }
  const sim = new MatchSimulator(store, setup);
  assert.equal(sim.suggestSubstitution(0), null);
  assert.equal(sim.suggestSubstitution(1), null);
});

test('suggestSubstitution() only ever proposes legal like-for-like changes, and does make some', () => {
  let made = 0;
  for (let seed = 0; seed < 6; seed++) {
    const { store, setup } = buildMatch(12 + seed, 1200 + seed);
    const sim = new MatchSimulator(store, setup);
    while (sim.step() !== null) {
      for (const team of [0, 1] as const) {
        const plan = sim.suggestSubstitution(team);
        if (plan === null) continue;
        assert.equal(store.position[plan.inPlayerIdx], store.position[plan.outPlayerIdx]);
        const result = sim.substitute(team, plan.outPlayerIdx, plan.inPlayerIdx);
        assert.equal(result.ok, true, result.reason);
        made++;
      }
    }
  }
  assert.ok(made > 0, 'over six full matches, somebody should have needed replacing');
});

/** Play on until the current set is over; false if the match ended instead. */
function playToNextSet(sim: MatchSimulator): boolean {
  const set = sim.snapshot().set;
  while (sim.step() !== null) {
    const snap = sim.snapshot();
    if (snap.matchOver) return false;
    if (snap.set !== set) return true;
  }
  return false;
}

test('setStartingLineup() changes the six only between sets, and the new six keep starting', () => {
  const { store, setup } = buildMatch(18, 1818);
  const sim = new MatchSimulator(store, setup);
  const libero = setup.home.libero;
  const defence = setup.home.defensiveLibero ?? -1;
  const reserveOH = setup.home.bench.find((p) => store.position[p] === Position.OutsideHitter);
  assert.ok(reserveOH !== undefined, 'this test needs an outside hitter on the bench');
  const newSix = setup.home.lineup.slice();
  newSix[1] = reserveOH;

  sim.step();
  assert.equal(sim.setStartingLineup(0, newSix, libero, defence).ok, false, 'not in the middle of a set');

  assert.ok(playToNextSet(sim));
  sim.substitute(0, sim.snapshot().homeCourt[0], setup.home.bench[0]);
  const result = sim.setStartingLineup(0, newSix, libero, defence);
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(sim.snapshot().homeCourt, newSix);
  assert.deepEqual(sim.startingLineup(0), newSix);
  assert.equal(sim.subsRemaining(0), 5, 'a new line-up sheet is not a substitution');

  // The six handed in carry on starting later sets too.
  assert.ok(playToNextSet(sim));
  assert.deepEqual(sim.snapshot().homeCourt, newSix);
});

test('setStartingLineup() rejects duplicates, outsiders and a libero in the six', () => {
  const { store, setup } = buildMatch(19, 1919);
  const sim = new MatchSimulator(store, setup);
  const libero = setup.home.libero;
  const six = setup.home.lineup;
  assert.equal(sim.setStartingLineup(0, [six[0], six[0], six[2], six[3], six[4], six[5]], libero).ok, false);
  assert.equal(sim.setStartingLineup(0, [999_999, six[1], six[2], six[3], six[4], six[5]], libero).ok, false);
  assert.equal(sim.setStartingLineup(0, [libero, six[1], six[2], six[3], six[4], six[5]], libero).ok, false);
  assert.equal(sim.setStartingLineup(0, six, six[0]).ok, false, 'only a registered libero plays libero');
  assert.equal(sim.setStartingLineup(0, six, libero).ok, true);
});

test('suggestStartingLineup() is only offered before a set\'s first serve, and keeps a fresh six', () => {
  const { store, setup } = buildMatch(11, 1111);
  for (const starter of setup.home.lineup) {
    const clearlyBetter = setup.home.bench.some((p) =>
      store.position[p] === store.position[starter]
      && selectionScore(store, p) > selectionScore(store, starter) * 1.03);
    assert.ok(!clearlyBetter, 'this test needs starters no reserve clearly outranks');
  }
  const sim = new MatchSimulator(store, setup);
  assert.equal(sim.suggestStartingLineup(0), null, 'nobody is tired or off form yet');
  sim.step();
  assert.equal(sim.suggestStartingLineup(0), null, 'the set is under way');
});

test('suggestStartingLineup() only proposes legal like-for-like line-ups, and does change some', () => {
  let changes = 0;
  for (let seed = 0; seed < 12; seed++) {
    const { store, setup } = buildMatch(30 + seed, 3000 + seed);
    const sim = new MatchSimulator(store, setup);
    while (playToNextSet(sim)) {
      for (const team of [0, 1] as const) {
        const before = sim.startingLineup(team);
        const plan = sim.suggestStartingLineup(team);
        if (plan === null) continue;
        plan.lineup.forEach((p, slot) => assert.equal(store.position[p], store.position[before[slot]]));
        assert.equal(plan.changes.length, plan.lineup.filter((p, slot) => p !== before[slot]).length);
        const liberos = sim.liberos(team);
        const result = sim.setStartingLineup(team, plan.lineup, liberos.reception, liberos.defence);
        assert.equal(result.ok, true, result.reason);
        changes += plan.changes.length;
      }
    }
  }
  assert.ok(changes > 0, 'over a dozen full matches, some starter should have needed a rest');
});

test('a setter substituted in one set does not go on setting from the bench the next', () => {
  const { store, setup } = buildMatch(20, 2020);
  const starter = setup.home.lineup.find((p) => store.position[p] === Position.Setter);
  const reserve = setup.home.bench.find((p) => store.position[p] === Position.Setter);
  assert.ok(starter !== undefined && reserve !== undefined, 'this test needs two setters');
  const sim = new MatchSimulator(store, setup);
  sim.step();
  assert.equal(sim.substitute(0, starter, reserve).ok, true);

  assert.ok(playToNextSet(sim));
  const setsMade = (p: number): number => sim.liveStats().home.players.get(p)?.setsMade ?? 0;
  const reserveBefore = setsMade(reserve);
  const starterBefore = setsMade(starter);
  playToNextSet(sim);
  assert.equal(setsMade(reserve), reserveBefore, 'the reserve setter is back on the bench');
  assert.ok(setsMade(starter) > starterBefore, 'the starting setter is back running the offence');
});

/** A match whose home side registers a second, defensive libero from its bench. */
function buildTwoLiberoMatch(worldSeed: number, matchSeed: number): { store: PlayerStore; setup: MatchSetup; reception: number; defence: number } {
  const { store, setup } = buildMatch(worldSeed, matchSeed);
  const defence = setup.home.bench.find((p) => store.position[p] === Position.Libero);
  assert.ok(defence !== undefined, 'this test needs a second libero on the bench');
  setup.home.bench = setup.home.bench.filter((p) => p !== defence);
  setup.home.defensiveLibero = defence;
  return { store, setup, reception: setup.home.libero, defence };
}

test('a single libero plays exactly as before when no defensive libero is named', () => {
  const a = buildMatch(7, 777);
  const b = buildMatch(7, 777);
  b.setup.home.defensiveLibero = -1;
  const ra = new MatchSimulator(a.store, a.setup).run();
  const rb = new MatchSimulator(b.store, b.setup).run();
  assert.deepEqual(ra.setScores, rb.setScores);
});

test('the reception libero passes when receiving and the defensive libero digs when serving', () => {
  const { store, setup, reception, defence } = buildTwoLiberoMatch(8, 888);
  const sim = new MatchSimulator(store, setup);
  let receptionTouches = 0;
  let defenceTouches = 0;
  for (let entry = sim.step(); entry !== null; entry = sim.step()) {
    for (const c of entry.contacts) {
      if (c.team !== 0 || (c.player !== reception && c.player !== defence)) continue;
      // Home receiving serve means the away side served this rally.
      if (entry.serveTeam === 1) {
        assert.equal(c.player, reception, 'only the reception libero may touch the ball while receiving');
        receptionTouches++;
      } else {
        assert.equal(c.player, defence, 'only the defensive libero may touch the ball while serving');
        defenceTouches++;
      }
    }
  }
  assert.ok(receptionTouches > 0 && defenceTouches > 0, 'both liberos should have played');
});

test('snapshot() names the libero for whichever side of the ball the team is on next', () => {
  const { store, setup, reception, defence } = buildTwoLiberoMatch(9, 999);
  const sim = new MatchSimulator(store, setup);
  for (let i = 0; i < 40; i++) {
    const snap = sim.snapshot();
    assert.equal(snap.homeLibero, snap.serving === 0 ? defence : reception);
    if (sim.step() === null) break;
  }
});

test('setLibero() swaps liberos freely — and whoever is named libero plays libero', () => {
  const { store, setup, reception, defence } = buildTwoLiberoMatch(10, 1010);
  const sim = new MatchSimulator(store, setup);
  sim.step();

  // Nobody on court, though.
  assert.equal(sim.setLibero(0, 'reception', sim.snapshot().homeCourt[0]).ok, false);

  // Naming the defensive libero for reception swaps the two roles over.
  assert.equal(sim.setLibero(0, 'reception', defence).ok, true);
  assert.deepEqual(sim.liberos(0), { reception: defence, defence: reception });

  // Dropping the defensive role leaves one libero playing throughout, and it
  // never used up a substitution.
  assert.equal(sim.setLibero(0, 'defence', -1).ok, true);
  assert.deepEqual(sim.liberos(0), { reception: defence, defence: -1 });
  assert.equal(sim.subsRemaining(0), 5);

  // Only the two named for the match play libero: an outside hitter off the bench can't…
  const outfield = setup.home.bench.find((p) => store.position[p] === Position.OutsideHitter)!;
  assert.equal(sim.setLibero(0, 'reception', outfield).ok, false);
  // …but one named libero for it plays it.
  const named = new MatchSimulator(store, {
    ...setup, home: { ...setup.home, libero: outfield, defensiveLibero: -1, bench: setup.home.bench.filter((p) => p !== outfield) },
  });
  assert.equal(named.roleOf(outfield), Position.Libero);
});

/** Two top-flight sides of one league, the first clearly the stronger. */
function favouriteAndUnderdog(): { store: PlayerStore; fav: MatchSetup['home']; dog: MatchSetup['home'] } {
  const world = generateWorld({ seed: 20260728, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const league = world.competitions.find((c) => c.kind === 'league' && c.tier === 1)!;
  const strength = (s: MatchSetup['home']): number =>
    [...s.lineup, s.libero].reduce((t, p) => t + store.currentAbility[p], 0) / 7;
  const sides = league.table.map((r) => toTeamSetup(store, world.clubs[r.clubId])).sort((a, b) => strength(b) - strength(a));
  const fav = sides[0];
  const dog = sides.find((s) => strength(fav) - strength(s) >= 150)!;
  return { store, fav, dog };
}

test('ability decides most matches, but a clearly weaker side wins some on its night', () => {
  const { store, fav, dog } = favouriteAndUnderdog();
  let dogWins = 0;
  const n = 300;
  for (let seed = 0; seed < n; seed++) {
    const r = new MatchSimulator(store, {
      home: dog, away: fav, format: MatchFormat.BestOf5, importance: 0.5,
      neutralVenue: true, collectLog: false, seed,
    }).run();
    if (r.homeSets > r.awaySets) dogWins++;
  }
  assert.ok(dogWins / n > 0.08, `the underdog won only ${dogWins} of ${n}`);
  assert.ok(dogWins / n < 0.48, `the underdog won ${dogWins} of ${n}`);
});

test('the weaker the side, the rarer its night — but a far weaker one still has it now and then', () => {
  const world = generateWorld({ seed: 555, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const sides = world.clubs.filter((c) => c.players.length >= 12).map((c) => toTeamSetup(store, c));
  const strength = (s: MatchSetup['home']): number => [...s.lineup, s.libero].reduce((t, p) => t + store.currentAbility[p], 0) / 7;
  const upsets = (lo: number, hi: number): number => {
    let won = 0;
    let n = 0;
    for (let i = 0; i < sides.length && n < 120; i++) {
      for (let j = 0; j < sides.length && n < 120; j += 7) {
        const gap = strength(sides[i]) - strength(sides[j]);
        if (gap < lo || gap >= hi) continue;
        const r = new MatchSimulator(store, {
          home: sides[j], away: sides[i], format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: n,
        }).run();
        if (r.homeSets > r.awaySets) won++;
        n++;
      }
    }
    return won / n;
  };
  const close = upsets(100, 150);
  const far = upsets(220, 320);
  assert.ok(close > 0.15 && close < 0.45, `100-150 below wins ${(close * 100).toFixed(0)}%`);
  assert.ok(far > 0.04 && far < close, `220-320 below wins ${(far * 100).toFixed(0)}%`);
});

test('a side whose tactic the opposition has read wins less often', () => {
  const { store, fav } = favouriteAndUnderdog();
  const winRate = (read: number): number => {
    let wins = 0;
    for (let seed = 0; seed < 400; seed++) {
      const r = new MatchSimulator(store, {
        home: { ...fav, read }, away: fav, format: MatchFormat.BestOf5, importance: 0.5,
        neutralVenue: true, collectLog: false, seed,
      }).run();
      if (r.homeSets > r.awaySets) wins++;
    }
    return wins / 400;
  };
  const unread = winRate(0);
  const read = winRate(1);
  assert.ok(Math.abs(unread - 0.5) < 0.07, `mirror match won ${unread}`);
  assert.ok(read < unread - 0.06, `read ${read} vs unread ${unread}`);
});

/** Matches enough to see a coach's changes: in a well-matched pair they are a few a season, not every night. */
const COACHED_MATCHES = Array.from({ length: 30 }, (_, i) => i + 1);

test('an engine-coached side makes its own changes; one left alone makes none', () => {
  const { store, setup: base } = buildMatch(4, 0);
  const benchUsed = (autoCoach: boolean): number => {
    let used = 0;
    for (const seed of COACHED_MATCHES) {
      const setup = { ...base, seed };
      const r = new MatchSimulator(store, { ...setup, autoCoach: [autoCoach, autoCoach] }).run();
      for (const [side, team] of [[setup.home, r.stats.home], [setup.away, r.stats.away]] as const) {
        for (const p of side.bench) if ((team.players.get(p)?.ralliesPlayed ?? 0) > 0) used++;
      }
    }
    return used;
  };
  assert.equal(benchUsed(false), 0);
  assert.ok(benchUsed(true) > 0);
});

test('a bench handed to the engine mid-match is coached from then on', () => {
  const { store, setup: base } = buildMatch(4, 0);
  let used = 0;
  for (const seed of COACHED_MATCHES) {
    const setup = { ...base, seed };
    const sim = new MatchSimulator(store, setup);
    for (let i = 0; i < 20; i++) sim.step();
    sim.setAutoCoach(0, true);
    sim.setAutoCoach(1, true);
    sim.finish();
    const r = sim.buildResult();
    for (const p of setup.home.bench) if ((r.stats.home.players.get(p)?.ralliesPlayed ?? 0) > 0) used++;
    for (const p of setup.away.bench) if ((r.stats.away.players.get(p)?.ralliesPlayed ?? 0) > 0) used++;
  }
  assert.ok(used > 0);
});
