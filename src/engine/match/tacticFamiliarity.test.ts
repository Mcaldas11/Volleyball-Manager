import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch } from './engine.ts';
import {
  currentFamiliarity, FAMILIARITY_GAIN, freshFamiliarity, intensityFatigue, learnTactic, matchFamiliarity,
  NEW_TACTIC_FAMILIARITY, overallFamiliarity, tacticIntensity,
} from './tacticFamiliarity.ts';
import { Combinations, DefensiveSystem, defaultTactics, Formation, ServeStrategy, Tempo } from './tactics.ts';
import { newTactic } from '../model/tacticSlots.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';

test('a tactic the side has always played is known through and through, and stays so', () => {
  const t = defaultTactics();
  assert.equal(overallFamiliarity(currentFamiliarity(t)), 100);
  learnTactic(t, FAMILIARITY_GAIN.tactical);
  assert.deepEqual(matchFamiliarity(t), { attack: 1, defence: 1, serve: 1 });
});

test('a change costs familiarity in its own part, at once, and the bigger the change the more', () => {
  const t = defaultTactics();
  learnTactic(t, 0);
  t.tempo = Tempo.VeryFast;
  const tempo = currentFamiliarity(t);
  assert.ok(tempo.attack < 100 && tempo.attack > 70, `a new tempo: the attack ${tempo.attack.toFixed(0)}`);
  assert.equal(tempo.defence, 100, 'the defence untouched');
  assert.equal(tempo.serve, 100, 'the serve untouched');
  // Not yet learnt, the match counts it already — and looking leaves the tactic as it was.
  assert.ok(matchFamiliarity(t).attack < 1);
  assert.equal(t.familiarity!.attack, 100);

  const u = defaultTactics();
  learnTactic(u, 0);
  u.formation = Formation.FourTwo;
  const system = currentFamiliarity(u);
  assert.ok(system.attack < tempo.attack, 'a new system costs more than a new tempo');
  assert.ok(system.defence < 100, 'and the defence with it');

  const v = defaultTactics();
  learnTactic(v, 0);
  v.serve = ServeStrategy.Risky;
  v.defense = DefensiveSystem.Aggressive;
  const out = currentFamiliarity(v);
  assert.ok(out.attack === 100 && out.defence < 100 && out.serve < 100);
});

test('it is learnt back on the training ground — a tactical day more than a physical one — and by playing', () => {
  const tactical = defaultTactics();
  const physical = defaultTactics();
  for (const t of [tactical, physical]) {
    learnTactic(t, 0);
    t.offense = 0;
    t.tempo = Tempo.Fast;
    t.combinations = Combinations.Often;
    learnTactic(t, 0);
  }
  const low = tactical.familiarity!.attack;
  assert.ok(low < 85, `the attack after the changes: ${low.toFixed(0)}`);
  for (let d = 0; d < 3; d++) {
    learnTactic(tactical, FAMILIARITY_GAIN.tactical);
    learnTactic(physical, FAMILIARITY_GAIN.physical);
  }
  assert.ok(tactical.familiarity!.attack > physical.familiarity!.attack, 'tactical days teach more');
  for (let d = 0; d < 30; d++) learnTactic(tactical, FAMILIARITY_GAIN.match);
  assert.equal(tactical.familiarity!.attack, 100, 'and in the end it is known again');
});

test('a new tactic has it all to learn', () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs[0];
  const i = newTactic(club);
  assert.notEqual(i, null);
  assert.equal(overallFamiliarity(currentFamiliarity(club.tactics)), NEW_TACTIC_FAMILIARITY);
  assert.deepEqual(freshFamiliarity(defaultTactics(), 55).attack, 55);
});

test('intensity: the usual tactic tires the players as they always have; a fast, aggressive one faster, a slow, safe one slower', () => {
  assert.equal(intensityFatigue(defaultTactics()), 1);
  const hard = { ...defaultTactics(), tempo: Tempo.VeryFast, defense: DefensiveSystem.TripleBlockPriority, combinations: Combinations.Often, serve: ServeStrategy.Risky };
  const easy = { ...defaultTactics(), tempo: Tempo.Slow, combinations: Combinations.Off, serve: ServeStrategy.Conservative };
  assert.ok(tacticIntensity(hard) > 0.75 && intensityFatigue(hard) > 1.07, `hard: ${tacticIntensity(hard).toFixed(2)}`);
  assert.ok(tacticIntensity(easy) < 0.35 && intensityFatigue(easy) < 0.97, `easy: ${tacticIntensity(easy).toFixed(2)}`);
});

test('a side that doesn\'t know its tactic yet plays it worse', () => {
  const world = generateWorld({ seed: 4250, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((x, y) => y.reputation - x.reputation).slice(3, 5);
  const points = (level: number): number => {
    const tactics = { ...defaultTactics() };
    tactics.familiarity = freshFamiliarity(tactics, level);
    const home = { ...toTeamSetup(store, a), tactics };
    const away = { ...toTeamSetup(store, b), tactics: defaultTactics() };
    let won = 0;
    let played = 0;
    for (let i = 0; i < 40; i++) {
      const r = simulateMatch(store, { home, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 300 + i });
      for (const [h, w] of r.setScores) {
        won += h;
        played += h + w;
      }
    }
    return won / played;
  };
  const known = points(100);
  const unknown = points(20);
  assert.ok(known - unknown > 0.01, `points won: known ${known.toFixed(3)}, unknown ${unknown.toFixed(3)}`);
});
