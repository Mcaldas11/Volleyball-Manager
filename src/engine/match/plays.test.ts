import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../model/positions.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { MatchFormat, MatchSimulator, type MatchSetup, type RallyContact } from './engine.ts';
import { Combinations, defaultTactics, isCombination, MiddlePlay, type TeamTactics } from './tactics.ts';

const world = generateWorld({ seed: 71, startYear: 2026, scale: 'small', manager: stubManager() });
const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);

function attacks(tactics: Partial<TeamTactics>, seeds: number[]): RallyContact[] {
  const out: RallyContact[] = [];
  for (const seed of seeds) {
    const home = toTeamSetup(world.players, a);
    home.tactics = { ...defaultTactics(), ...tactics };
    const setup: MatchSetup = {
      home, away: toTeamSetup(world.players, b), format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false,
      collectLog: true, seed,
    };
    const r = new MatchSimulator(world.players, setup).run();
    for (const e of r.log!) {
      for (const c of e.contacts) if (c.team === 0 && ['attack', 'kill', 'attackError', 'blocked'].includes(c.kind)) out.push(c);
    }
  }
  return out;
}

test("the middle hits the quick, the back quick and the slide — or just the one he's told to", () => {
  const mixed = attacks({}, [1, 2, 3]).filter((c) => c.detail === 'Quick (middle)');
  for (const play of ['quick', 'backQuick', 'slide'] as const) assert.ok(mixed.some((c) => c.play === play), `some ${play}`);
  const slides = attacks({ middlePlay: MiddlePlay.Slide }, [1, 2]).filter((c) => c.detail === 'Quick (middle)');
  assert.ok(slides.length > 10 && slides.every((c) => c.play === 'slide'));
});

test('combinations run off a middle up front as the decoy, and not at all when they are off', () => {
  const often = attacks({ combinations: Combinations.Often }, [4, 5, 6]);
  const combos = often.filter((c) => isCombination(c.play));
  assert.ok(combos.length > 15, `${combos.length} combinations in three matches`);
  for (const c of combos) {
    assert.ok(c.decoy !== undefined && c.decoy !== c.player);
    assert.equal(world.players.position[c.decoy!], Position.MiddleBlocker);
  }
  // The decoy takes a blocker away.
  const avg = (cs: RallyContact[]): number => cs.reduce((s, c) => s + (c.blockers ?? 0), 0) / cs.length;
  const pins = often.filter((c) => c.detail === 'Outside' || c.detail === 'Opposite');
  assert.ok(avg(pins.filter((c) => isCombination(c.play))) < avg(pins.filter((c) => c.play === undefined)));
  assert.equal(attacks({ combinations: Combinations.Off }, [4, 5]).filter((c) => isCombination(c.play)).length, 0);
});

test('combination plays rehearsed in training beat a side that runs none', () => {
  const N = 160;
  let won = 0;
  for (let i = 0; i < N; i++) {
    const home = toTeamSetup(world.players, a);
    const away = toTeamSetup(world.players, a);
    home.tactics = { ...defaultTactics(), combinations: Combinations.Often };
    away.tactics = { ...defaultTactics(), combinations: Combinations.Off };
    home.prep = { reception: 0, transition: 0, block: 0, combinations: 1 };
    const r = new MatchSimulator(world.players, {
      home, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 5000 + i,
    }).run();
    if (r.homeSets > r.awaySets) won++;
  }
  assert.ok(won / N > 0.52, `${((won / N) * 100).toFixed(1)}% won`);
});
