import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { Position } from '../engine/model/positions.ts';
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
  const { sim, positions } = liveMatch(4);
  let rallies = 0;
  const setDepths: number[] = [];
  for (let i = 0; i < 120; i++) {
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
