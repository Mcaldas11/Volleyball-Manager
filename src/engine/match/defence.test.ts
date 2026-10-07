import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { coverEdge, defaultDefenceLayouts, presetLayout, type DefenceLayout, type DefenceLayouts } from './defence.ts';
import { MatchFormat, MatchSimulator, type RallyContact } from './engine.ts';
import { defaultTactics } from './tactics.ts';

const world = generateWorld({ seed: 72, startYear: 2026, scale: 'small', manager: stubManager() });
const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);

/** The other side's attacks when the home side defends with `defence`. */
function against(defence: DefenceLayouts, seeds: number[]): RallyContact[] {
  const out: RallyContact[] = [];
  for (const seed of seeds) {
    const home = toTeamSetup(world.players, a);
    home.tactics = { ...defaultTactics(), defence };
    const r = new MatchSimulator(world.players, {
      home, away: toTeamSetup(world.players, b), format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true,
      collectLog: true, seed,
    }).run();
    for (const e of r.log!) for (const c of e.contacts) if (c.team === 1 && ['attack', 'kill', 'attackError', 'blocked'].includes(c.kind)) out.push(c);
  }
  return out;
}

test('no defence suits every hitter: perimeter for the power hitters, rotation for the ones who tip and cut', () => {
  for (const source of ['oh', 'opp'] as const) {
    assert.equal(coverEdge(presetLayout('perimeter', source), source, 0), 1, 'the usual defence is the yardstick');
    assert.ok(coverEdge(presetLayout('perimeter', source), source, -1) > coverEdge(presetLayout('rotation', source), source, -1));
    assert.ok(coverEdge(presetLayout('rotation', source), source, 1) > coverEdge(presetLayout('perimeter', source), source, 1));
  }
  // Against the middle's quick, a defender up behind the block pays.
  assert.ok(coverEdge(presetLayout('manUp', 'mb'), 'mb', 0) > 1);
  // Everyone in a huddle in the middle of the court covers nothing from the pins.
  const huddle: DefenceLayout = { lb: { u: 0.5, v: 0.5 }, mb: { u: 0.52, v: 0.5 }, rb: { u: 0.48, v: 0.5 }, free: { u: 0.5, v: 0.45 } };
  assert.ok(coverEdge(huddle, 'oh', 0) < 0.95);
});

test('a defence in the wrong places concedes more points, and the points go where it leaves the court open', () => {
  const huddle: DefenceLayout = { lb: { u: 0.5, v: 0.5 }, mb: { u: 0.52, v: 0.5 }, rb: { u: 0.48, v: 0.5 }, free: { u: 0.5, v: 0.45 } };
  const bad: DefenceLayouts = { oh: huddle, mb: huddle, opp: huddle };
  const killRate = (cs: RallyContact[]): number => cs.filter((c) => c.kind === 'kill').length / cs.length;
  // Enough matches that a side's night — good or bad — doesn't hide it.
  const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
  const good = against(defaultDefenceLayouts(), seeds);
  const poor = against(bad, seeds);
  assert.ok(killRate(poor) > killRate(good) + 0.02, `${(killRate(poor) * 100).toFixed(1)}% against ${(killRate(good) * 100).toFixed(1)}%`);

  // Nobody deep on the line against the outside: the outside's points go down it.
  const lineOpen: DefenceLayouts = defaultDefenceLayouts();
  lineOpen.oh = { ...lineOpen.oh, rb: { u: 0.74, v: 0.22 }, mb: { u: 0.5, v: 0.85 } };
  const lineShare = (cs: RallyContact[]): number => {
    const kills = cs.filter((c) => c.kind === 'kill' && c.detail === 'Outside');
    return kills.filter((c) => c.shot === 'line').length / kills.length;
  };
  assert.ok(lineShare(against(lineOpen, [5, 6, 7, 8])) > lineShare(against(defaultDefenceLayouts(), [5, 6, 7, 8])));
});
