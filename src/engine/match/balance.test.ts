import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch } from './engine.ts';
import {
  defaultTactics, DefensiveSystem, OffensiveSystem, ServeStrategy, ServeTarget, type TeamTactics,
} from './tactics.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';

/**
 * Every tactical choice is a trade: played by one of two equal sides against
 * the defaults, none of them wins most matches on its own, and none is a trap
 * that loses most. The manager's edge has to come from fitting the tactic to
 * the players, not from one setting the other coaches never found.
 */
test('no single tactical choice wins — or loses — most matches between equal sides', () => {
  const world = generateWorld({ seed: 4243, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const top = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation);
  const pairs = [[top[2], top[3]], [top[6], top[7]]];
  const variants: Array<[string, (t: TeamTactics) => void]> = [
    ['risky serving', (t) => { t.serve = ServeStrategy.Risky; }],
    ['serving the weakest passer', (t) => { for (const r of t.rotations) r.serveTarget = ServeTarget.WeakestPasser; }],
    ['an aggressive defence', (t) => { t.defense = DefensiveSystem.Aggressive; }],
    ['the triple block', (t) => { t.defense = DefensiveSystem.TripleBlockPriority; }],
    ['playing for reception', (t) => { t.defense = DefensiveSystem.ReceptionStability; }],
    ['the back-row attack', (t) => { t.offense = OffensiveSystem.BackRowHeavy; }],
  ];
  let seed = 1;
  for (const [name, change] of variants) {
    let wins = 0;
    let games = 0;
    for (const [a, b] of pairs) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const t = defaultTactics();
        change(t);
        for (let i = 0; i < 40; i++) {
          const xs = { ...toTeamSetup(store, x), tactics: t };
          const ys = { ...toTeamSetup(store, y), tactics: defaultTactics() };
          const r = simulateMatch(store, {
            home: i % 2 === 0 ? xs : ys, away: i % 2 === 0 ? ys : xs, format: MatchFormat.BestOf5,
            importance: 0.5, neutralVenue: false, collectLog: false, seed: seed++,
          });
          if ((r.homeSets > r.awaySets) === (i % 2 === 0)) wins++;
          games++;
        }
      }
    }
    const share = wins / games;
    assert.ok(share > 0.36 && share < 0.64, `${name} wins ${(share * 100).toFixed(0)}% against the defaults`);
  }
});
