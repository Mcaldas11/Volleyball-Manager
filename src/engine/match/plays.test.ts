import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../model/positions.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { MatchFormat, MatchSimulator, type MatchSetup, type RallyContact } from './engine.ts';
import {
  Combinations, defaultTactics, defaultZonePlans, isCombination, MiddleOption, passZone, setterAtNet, ZoneTarget, type PassZone,
  type TeamTactics,
} from './tactics.ts';

const world = generateWorld({ seed: 74, startYear: 2026, scale: 'small', manager: stubManager() });
const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);

/** Each of the home side's attacks, with the rotation it was played in (0 for P1 — the setter's zone). */
function attacksIn(tactics: Partial<TeamTactics>, seeds: number[]): Array<{ c: RallyContact; rot: number }> {
  const out: Array<{ c: RallyContact; rot: number }> = [];
  for (const seed of seeds) {
    const home = toTeamSetup(world.players, a);
    home.tactics = { ...defaultTactics(), ...tactics };
    const r = new MatchSimulator(world.players, {
      home, away: toTeamSetup(world.players, b), format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false,
      collectLog: true, seed,
    }).run();
    for (const e of r.log!) {
      for (const c of e.contacts) {
        if (c.team === 0 && ['attack', 'kill', 'attackError', 'blocked'].includes(c.kind)) out.push({ c, rot: e.homeRotation });
      }
    }
  }
  return out;
}

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
  // Told to slide with the setter at the net and to hit the quick with him at the back.
  const zones = defaultZonePlans();
  for (const z of ['A', 'B'] as const) zones[z] = { ...zones[z], middle: MiddleOption.Slide, middleBack: MiddleOption.Quick };
  const told = attacksIn({ zones }, [1, 2, 3]).filter(({ c }) => c.detail === 'Quick (middle)');
  const front = told.filter(({ rot }) => setterAtNet(rot));
  const back = told.filter(({ rot }) => !setterAtNet(rot));
  assert.ok(front.length > 5 && back.length > 5);
  assert.ok(front.every(({ c }) => c.play === 'slide' || c.play === 'quick'), 'the slide — or a quick when the libero sets');
  assert.ok(front.some(({ c }) => c.play === 'slide'));
  assert.ok(back.every(({ c }) => c.play === 'quick'));
});

test('the slide is run only with the setter at the net — P2, P3, P4', () => {
  const zones = defaultZonePlans();
  for (const z of ['A', 'B', 'C'] as const) zones[z] = { ...zones[z], middle: MiddleOption.Slide, middleBack: MiddleOption.Slide };
  const slides = attacksIn({ zones }, [4, 5, 6]).filter(({ c }) => c.play === 'slide');
  assert.ok(slides.length > 10);
  assert.ok(slides.every(({ rot }) => setterAtNet(rot)), 'never with the setter in P1, P6 or P5');
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

/** Each attack with the zone its pass came down in — the last pass, dig or cover before it. */
function byZone(tactics: Partial<TeamTactics>, seeds: number[]): Array<{ c: RallyContact; zone: PassZone }> {
  const out: Array<{ c: RallyContact; zone: PassZone }> = [];
  for (const seed of seeds) {
    const home = toTeamSetup(world.players, a);
    home.tactics = { ...defaultTactics(), ...tactics };
    const r = new MatchSimulator(world.players, {
      home, away: toTeamSetup(world.players, b), format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false,
      collectLog: true, seed,
    }).run();
    for (const e of r.log!) {
      let zone: PassZone | null = null;
      for (const c of e.contacts) {
        if ((c.kind === 'reception' || c.kind === 'dig') && c.quality !== undefined) zone = c.team === 0 ? passZone(c.quality) : null;
        if (c.team === 0 && zone !== null && ['attack', 'kill', 'attackError', 'blocked'].includes(c.kind)) out.push({ c, zone });
      }
    }
  }
  return out;
}

test('off a pass at the net anything goes; from 3-6 m the middle gets only the quick; from deep, only the pins', () => {
  const plays = byZone({}, Array.from({ length: 12 }, (_, i) => 11 + i));
  const middle = plays.filter(({ c }) => c.detail === 'Quick (middle)');
  assert.ok(middle.length > 10);
  assert.ok(middle.every(({ zone }) => zone !== 'C'), 'no middle off a deep pass');
  assert.ok(middle.filter(({ zone }) => zone === 'B').every(({ c }) => c.play === 'quick'), 'only the tensa from 3-6 m');
  assert.ok(middle.some(({ zone, c }) => zone === 'A' && c.play !== 'quick'), 'the slide and back quick off a pass at the net');
  assert.ok(plays.some(({ zone, c }) => zone === 'C' && c.detail === 'Back-row right'), 'a high ball to zone 1 off a deep one');
});

test("a zone's plan is the coach's: the middle off a deep pass, or the opposite looked for first", () => {
  const zones = defaultZonePlans();
  zones.C = { ...zones.C, middle: MiddleOption.Slide };
  const deepMiddle = byZone({ zones }, [14, 15, 16]).filter(({ zone, c }) => zone === 'C' && c.detail === 'Quick (middle)');
  assert.ok(deepMiddle.length > 0 && deepMiddle.every(({ c }) => c.play === 'slide'));

  const share = (tactics: Partial<TeamTactics>): number => {
    const all = byZone(tactics, [17, 18, 19, 20, 21, 22, 23, 24]);
    return all.filter(({ c }) => c.detail === 'Opposite').length / all.length;
  };
  const toOpp = defaultZonePlans();
  for (const z of ['A', 'B', 'C'] as const) toOpp[z] = { ...toOpp[z], target: ZoneTarget.Opposite };
  assert.ok(share({ zones: toOpp }) > share({}) + 0.03, 'the opposite gets more of the ball');
});
