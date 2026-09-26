import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { Position } from '../engine/model/positions.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import {
  ballAlong, COURT_HALF_LENGTH, flightBulge, NET_HEIGHT, rallyBeats, setupScene, type Ball3,
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

test('the ball goes to whoever touches it, and a set at the net precedes attacks after a pass', () => {
  const { sim, positions } = liveMatch(4);
  let rallies = 0;
  let setsSeen = 0;
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
    for (const b of beats) {
      if (b.actor !== null && b.poses.get(b.actor) === 'set') {
        setsSeen++;
        assert.ok(depth(b.positions.get(b.actor)!.y) < 0.12, 'setter sets from the net');
      }
    }
  }
  assert.ok(rallies > 50);
  assert.ok(setsSeen > 20, 'plenty of sets should have been scripted');
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
