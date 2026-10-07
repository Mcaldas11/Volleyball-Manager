import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { Position } from '../engine/model/positions.ts';
import { Formation } from '../engine/match/tactics.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import {
  ballAlong, COURT_HALF_LENGTH, flightBulge, NET_HEIGHT, passSpot, rallyBeats, setupScene, type Ball3,
} from './matchCourt.ts';

function liveMatch(seed: number): { sim: MatchSimulator; positions: Uint8Array } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const sim = new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, world.clubs[0]),
    away: toTeamSetup(world.players, world.clubs[1]),
    format: MatchFormat.BestOf5,
    importance: 0.5,
    neutralVenue: false,
    collectLog: true,
    seed: seed * 7,
  });
  return { sim, positions: world.players.position };
}

/** Distance from the net as a share of the half court: 0 at the net, 1 at the baseline. */
function depth(y: number): number {
  return Math.abs(y) / COURT_HALF_LENGTH;
}

test('receiving side hides its setter at the net, whatever the rotation', () => {
  const { sim, positions } = liveMatch(1);
  for (let i = 0; i < 60; i++) {
    const snap = sim.snapshot();
    const receiving = (1 - snap.serving) as 0 | 1;
    const court = receiving === 0 ? snap.homeCourt : snap.awayCourt;
    const scene = setupScene(snap, snap.serving, positions, 0);
    const setter = court.find((p) => positions[p] === Position.Setter)!;
    const at = depth(scene.positions.get(setter)!.y);
    assert.ok(at <= 0.3, `setter in zone ${court.indexOf(setter) + 1} should start at the net (${at})`);
    if (sim.step() === null) break;
  }
});

test('receiving with the setter in 1 and an outside in 2, the outside hits on the right and zone 4 on the left — a 5-1 and a 4-2 alike', () => {
  for (const formation of [Formation.FiveOne, Formation.FourTwo]) {
    const world = generateWorld({ seed: 74, startYear: 2026, scale: 'small', manager: stubManager() });
    const store = world.players;
    const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
    a.tactics = { ...a.tactics, formation };
    const sim = new MatchSimulator(store, {
      home: toTeamSetup(store, a), away: toTeamSetup(store, b), format: MatchFormat.BestOf5,
      importance: 0.5, neutralVenue: false, collectLog: true, seed: 9,
    });
    let right = 0;
    let left = 0;
    for (let i = 0; i < 400; i++) {
      const pre = sim.snapshot();
      if (pre.matchOver) break;
      const entry = sim.step();
      if (entry === null) break;
      const court = pre.homeCourt;
      const stays = entry.serveTeam === 1 && store.position[court[0]] === Position.Setter
        && store.position[court[1]] === Position.OutsideHitter;
      if (!stays) continue;
      // Home is the near side: its right is +x. A combination behind the
      // middle's quick is hit at the centre; never at the other pin.
      for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, i, 0)) {
        if (beat.actor === null || beat.poses.get(beat.actor) !== 'spike') continue;
        const x = beat.positions.get(beat.actor)!.x;
        if (beat.actor === court[1]) { assert.ok(x > -1, `the outside from zone 2 never hits from the left (${formation}, ${x.toFixed(1)})`); right++; }
        if (beat.actor === court[3]) { assert.ok(x < 1, `zone 4 never hits from the right (${formation}, ${x.toFixed(1)})`); left++; }
      }
    }
    assert.ok(right > 0 && left > 0, `both seen hitting (${formation})`);
  }
});

test('the server stands behind their own baseline, on their own side', () => {
  const { sim, positions } = liveMatch(2);
  for (let i = 0; i < 30; i++) {
    const snap = sim.snapshot();
    const server = (snap.serving === 0 ? snap.homeCourt : snap.awayCourt)[0];
    const at = setupScene(snap, snap.serving, positions, 0).positions.get(server)!;
    assert.ok(depth(at.y) > 1, 'server should be beyond the baseline');
    // The near team (home here) plays at negative y, the far team at positive.
    assert.equal(Math.sign(at.y), snap.serving === 0 ? -1 : 1);
    if (sim.step() === null) break;
  }
});

test('each side sees the court as it faces it: left and right mirror across the net', () => {
  const { sim, positions } = liveMatch(3);
  const snap = sim.snapshot();
  const scene = setupScene(snap, snap.serving, positions, 0);
  // The serving side stands in its rotational columns: zone 4 (index 3) on
  // its own left, zone 2 (index 1) on its right.
  const court = snap.serving === 0 ? snap.homeCourt : snap.awayCourt;
  const left = scene.positions.get(court[3])!.x;
  const right = scene.positions.get(court[1])!.x;
  if (snap.serving === 0) assert.ok(left < right, 'the near side faces away from the camera');
  else assert.ok(left > right, 'the far side faces the camera, so it is mirrored');
});

test('the ball goes to whoever touches it, and the second ball is set from wherever the pass went', () => {
  let rallies = 0;
  const setDepths: number[] = [];
  // Two matches: one side's passing can have a bad night.
  for (const { sim, positions } of [liveMatch(4), liveMatch(5)]) for (let i = 0; i < 150; i++) {
    const pre = sim.snapshot();
    const entry = sim.step();
    if (entry === null) break;
    rallies++;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, positions, i, 0);
    assert.ok(beats.length >= entry.contacts.length, 'at least one beat per logged contact');
    for (const b of beats) {
      if (b.actor === null || b.ball === null) continue;
      const at = b.positions.get(b.actor)!;
      assert.ok(Math.hypot(b.ball.x - at.x, b.ball.y - at.y) < 0.8, 'ball should be at the actor');
    }
    beats.forEach((b, k) => {
      // The second touch: a set overhead, or a low pass bumped up.
      const pose = b.actor !== null ? b.poses.get(b.actor) : undefined;
      const prev = beats[k - 1];
      const second = pose === 'set' || (pose === 'pass' && prev?.ball != null && prev.ball.y * b.ball!.y > 0);
      if (b.actor !== null && second) setDepths.push(depth(b.positions.get(b.actor)!.y));
    });
  }
  assert.ok(rallies > 50);
  assert.ok(setDepths.length > 20, 'plenty of sets should have been scripted');
  assert.ok(setDepths.every((d) => d < 1), 'sets are played inside the court');
  const atNet = setDepths.filter((d) => d < 0.15).length / setDepths.length;
  const wellOff = setDepths.filter((d) => d > 0.33).length / setDepths.length;
  const deep = setDepths.filter((d) => d > 0.66).length / setDepths.length;
  assert.ok(atNet > 0.3, `most passes find the setter at the net (${atNet.toFixed(2)})`);
  assert.ok(wellOff > 0.05, `but some leave them chasing well off it (${wellOff.toFixed(2)})`);
  assert.ok(deep < wellOff, 'and fewer still are played from deep, 6 to 9 m back');
});

test('the better the pass, the closer to the net, the higher and the more on target it comes down', () => {
  for (const j of [-1, -0.4, 0, 0.5, 1]) {
    const perfect = passSpot(0.75, j);
    const good = passSpot(0.5, j);
    const bad = passSpot(0.15, j);
    assert.ok(perfect.at.v < 0.1, 'a perfect pass is on the target');
    assert.ok(perfect.at.v <= good.at.v && good.at.v < bad.at.v, 'a worse pass lands further off the net');
    assert.ok(bad.at.v > 0.66, 'a bad one deep, 6 m or more off the net');
    assert.ok(good.at.v > 0.33 && good.at.v < 0.66, 'a fair one 3 to 6 m off it');
    assert.ok(perfect.z > good.z && good.z > bad.z, 'and lower');
  }
});

test('every flight across the net clears the tape', () => {
  const { sim, positions } = liveMatch(5);
  let crossings = 0;
  for (let i = 0; i < 120; i++) {
    const pre = sim.snapshot();
    const entry = sim.step();
    if (entry === null) break;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, positions, i, 0);
    let from: Ball3 | null = null;
    for (const b of beats) {
      if (b.ball === null) continue;
      if (from !== null && from.y * b.ball.y < 0) {
        crossings++;
        const bulge = flightBulge(from, b.ball, b.arc);
        const tc = from.y / (from.y - b.ball.y);
        assert.ok(ballAlong(from, b.ball, bulge, tc).z > NET_HEIGHT, 'the ball must pass over the net');
      }
      from = b.ball;
    }
  }
  assert.ok(crossings > 100);
});

test('everyone on court has something to do in every beat, contacts aim where the ball goes next, and the last beat names the winner', () => {
  const { sim, positions } = liveMatch(6);
  for (let i = 0; i < 40; i++) {
    const pre = sim.snapshot();
    const entry = sim.step();
    if (entry === null) break;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, positions, i, 0, entry.winner);
    beats.forEach((b, k) => {
      for (const p of b.positions.keys()) assert.ok(b.poses.has(p), 'every player has a pose');
      if (b.actor !== null && k + 1 < beats.length) assert.deepEqual(b.aim, beats[k + 1].ball);
      assert.equal(b.point ?? null, k === beats.length - 1 ? entry.winner : null);
    });
  }
});

test('the defence stands behind the block where its coach has put it', () => {
  const { sim, positions } = liveMatch(9);
  // Everyone in the back row of the defending side at mid-court, 4.5 m off the net.
  const mid = { u: 0.5, v: 0.5 };
  const layout = { lb: { u: 0.2, v: 0.5 }, mb: mid, rb: { u: 0.8, v: 0.5 }, free: { u: 0.5, v: 0.3 } };
  const defence = { oh: layout, mb: layout, opp: layout };
  let checked = 0;
  for (let i = 0; i < 60 && checked < 10; i++) {
    const pre = sim.snapshot();
    const entry = sim.step();
    if (entry === null) break;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, positions, i, 0, entry.winner, () => defence);
    for (const beat of beats) {
      const hitter = beat.actor !== null && beat.poses.get(beat.actor) === 'spike' ? beat.actor : null;
      if (hitter === null) continue;
      const hitterSide = Math.sign(beat.positions.get(hitter)!.y);
      // The defending side's players at 4.5 m back.
      const back = [...beat.positions.values()].filter((g) => Math.sign(g.y) === -hitterSide && Math.abs(Math.abs(g.y) - 4.5) < 0.01);
      assert.ok(back.length >= 3, `the back three at 4.5 m (${back.length})`);
      checked++;
    }
  }
  assert.ok(checked > 0);
});
