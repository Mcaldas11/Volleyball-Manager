import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch, type MatchResult } from './engine.ts';
import { defaultTactics, type ReceptionFormation } from './tactics.ts';
import { Position } from '../model/positions.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';

/** Matches between two sides, the home side receiving in the line given in every rotation. */
function play(receivers: ReceptionFormation, n: number): { results: MatchResult[]; home: ReturnType<typeof toTeamSetup>; store: ReturnType<typeof generateWorld>['players'] } {
  const world = generateWorld({ seed: 4250, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((x, y) => y.reputation - x.reputation).slice(3, 5);
  const t = defaultTactics();
  for (const r of t.rotations) r.receivers = receivers;
  const home = { ...toTeamSetup(store, a), tactics: t };
  const away = { ...toTeamSetup(store, b), tactics: defaultTactics() };
  const results: MatchResult[] = [];
  for (let i = 0; i < n; i++) {
    results.push(simulateMatch(store, {
      home, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed: 900 + i,
    }));
  }
  return { results, home, store };
}

/** Who took the home side's serve receptions, and how often. */
function receivers(results: MatchResult[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of results) {
    for (const rally of r.log!) {
      if (rally.serveTeam !== 1) continue;
      const c = rally.contacts.find((x) => x.team === 0 && (x.kind === 'reception' || x.kind === 'receptionError'));
      if (c !== undefined) out.set(c.player, (out.get(c.player) ?? 0) + 1);
    }
  }
  return out;
}

test('the usual three: libero and both outsides take the serve, and the log says nothing of it', () => {
  const { results, store } = play(3, 6);
  const who = receivers(results);
  assert.ok([...who.keys()].every((p) => store.position[p] === Position.Libero || store.position[p] === Position.OutsideHitter));
  assert.ok(results.every((r) => r.log!.every((e) => e.passers === undefined)));
});

test('two passers hide the weaker-passing outside — who then attacks the first ball fresher', () => {
  const three = play(3, 30);
  const two = play(2, 30);
  const store = two.store;
  const whoTwo = receivers(two.results);
  const whoThree = receivers(three.results);
  // The outsides who passed with three, and the one hidden with two — the weaker passer on the day, so
  // now and then, his confidence up or the other's down, he swaps with the other and takes one.
  const outsides = [...whoThree.keys()].filter((p) => store.position[p] === Position.OutsideHitter);
  const hidden = outsides.filter((p) => (whoTwo.get(p) ?? 0) < whoThree.get(p)! * 0.1);
  assert.ok(hidden.length >= 1, 'an outside spared the serve');
  assert.ok(two.results.some((r) => r.log!.some((e) => e.passers?.length === 2)));

  // His first-ball kill rate, after a pass by someone else.
  const firstBall = (results: MatchResult[], p: number): number => {
    let att = 0;
    let kills = 0;
    for (const r of results) {
      for (const rally of r.log!) {
        if (rally.serveTeam !== 1) continue;
        const i = rally.contacts.findIndex((c) => c.team === 0 && c.kind === 'reception');
        if (i < 0) continue;
        const hit = rally.contacts.slice(i + 1).find((c) => c.team === 0 && (c.kind === 'attack' || c.kind === 'kill' || c.kind === 'attackError' || c.kind === 'blocked'));
        if (hit === undefined || hit.player !== p) continue;
        att++;
        if (hit.kind === 'kill') kills++;
      }
    }
    return att > 0 ? kills / att : 0;
  };
  const freed = hidden[0];
  assert.ok(firstBall(two.results, freed) > firstBall(three.results, freed), 'the freed outside kills more of the first ball');
});

test('four passers bring the opposite into the line', () => {
  const { results, store } = play(4, 10);
  const who = receivers(results);
  const opposite = [...who.keys()].find((p) => store.position[p] === Position.Opposite);
  assert.ok(opposite !== undefined && who.get(opposite)! > 5, 'the opposite takes serves');
  assert.ok(results.some((r) => r.log!.some((e) => e.passers?.length === 4)));
});
