import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { Position } from '../engine/model/positions.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import { rallyBeats, setupScene, type CourtState } from './matchCourt.ts';

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

/** Screen depth from the net, in half-court units: 0 at the net, 1 at the baseline. */
function depth(y: number): number {
  return Math.abs(y - 50) / 50;
}

test('receiving side lines up its passers and hides a back-row setter at the net', () => {
  const { sim, positions } = liveMatch(1);
  for (let i = 0; i < 60; i++) {
    const snap = sim.snapshot();
    const receiving = (1 - snap.serving) as 0 | 1;
    const court = receiving === 0 ? snap.homeCourt : snap.awayCourt;
    const scene = setupScene(snap, snap.serving, positions);
    const setter = court.find((p) => positions[p] === Position.Setter)!;
    const setterZone = court.indexOf(setter);
    const setterDepth = depth(scene.positions.get(setter)!.y);
    // Front row or hiding from the back row, the setter always starts near the net.
    assert.ok(setterDepth <= 0.3, `setter in zone ${setterZone + 1} should start at the net (${setterDepth})`);
    if (sim.step() === null) break;
  }
});

test('the server stands behind their own baseline', () => {
  const { sim, positions } = liveMatch(2);
  for (let i = 0; i < 30; i++) {
    const snap = sim.snapshot();
    // Zone 1 serves — the libero never covers it, so the rotational player is the server.
    const server = (snap.serving === 0 ? snap.homeCourt : snap.awayCourt)[0];
    const at = setupScene(snap, snap.serving, positions).positions.get(server)!;
    assert.ok(depth(at.y) > 1, 'server should be beyond the baseline');
    if (sim.step() === null) break;
  }
});

test('each side sees the court as it faces it: home is mirrored left to right', () => {
  const { sim, positions } = liveMatch(3);
  const snap = sim.snapshot();
  const court: CourtState = { ...snap };
  const scene = setupScene(court, snap.serving, positions);
  // Zone 2 (index 1) is on each team's own right: screen left for home at the
  // top (facing down), screen right for away at the bottom (facing up) — unless
  // that player is a passer who has moved; the front row never passes in the
  // serving side, so check the serving team's zone 2.
  const servingCourt = snap.serving === 0 ? snap.homeCourt : snap.awayCourt;
  const x = scene.positions.get(servingCourt[1])!.x;
  if (snap.serving === 0) assert.ok(x < 50, `home zone 2 should be on screen left (${x})`);
  else assert.ok(x > 50, `away zone 2 should be on screen right (${x})`);
});

test('the ball always goes to whoever touches it, and a set precedes every attack after a pass', () => {
  const { sim, positions } = liveMatch(4);
  let rallies = 0;
  let setsSeen = 0;
  for (let i = 0; i < 120; i++) {
    const pre = sim.snapshot();
    const entry = sim.step();
    if (entry === null) break;
    rallies++;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, positions, i);
    assert.ok(beats.length >= entry.contacts.length, 'at least one beat per logged contact');
    for (const b of beats) {
      if (b.actor === null || b.ball === null) continue;
      const at = b.positions.get(b.actor)!;
      assert.ok(Math.hypot(b.ball.x - at.x, b.ball.y - at.y) < 6, 'ball should be at the actor');
    }
    // Every attack that follows a pass or dig is set first — by the setter at the net.
    const kinds = entry.contacts.map((c) => c.kind);
    if (kinds.includes('reception') && kinds.some((k) => k === 'kill' || k === 'attack' || k === 'attackError' || k === 'blocked')) {
      const setBeat = beats.find((b) => b.actor !== null && positions[b.actor] === Position.Setter && b.high);
      if (setBeat !== undefined) {
        setsSeen++;
        assert.ok(depth(setBeat.positions.get(setBeat.actor!)!.y) < 0.12, 'setter sets from the net');
      }
    }
  }
  assert.ok(rallies > 50);
  assert.ok(setsSeen > 10, 'plenty of sets should have been scripted');
});
