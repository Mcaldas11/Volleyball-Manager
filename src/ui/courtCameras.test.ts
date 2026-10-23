import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { PlayerFlag } from '../engine/model/players.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { stubManager } from '../engine/world/world.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { courtCamera } from './court3d.ts';
import { CAMERA_MODES, Cameraman, type CameraMode } from './courtCameras.ts';
import { CourtMotion } from './courtMotion.ts';
import { rallyBeats, setupScene } from './matchCourt.ts';

const W = 1280;
const H = 640;

/** Play a few rallies through the motion at 60 frames a second, the cameraman aiming every frame. */
function watch(mode: CameraMode, rallies: number, frame: (camera: PerspectiveCamera, m: CourtMotion, now: number) => void): void {
  const world = generateWorld({ seed: 41, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const sim = new MatchSimulator(store, {
    home: toTeamSetup(store, world.clubs[0]), away: toTeamSetup(store, world.clubs[1]),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed: 287,
  });
  const home = new Set(world.clubs[0].players);
  const m = new CourtMotion(
    (p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }),
    (p) => (home.has(p) ? 0 : 1),
  );
  const camera = new PerspectiveCamera();
  const man = new Cameraman();
  man.setMode(mode);
  let now = 0;
  const run = (ms: number): void => {
    const end = now + ms;
    while (now < end - 1e-6) {
      const dt = Math.min(1000 / 60, end - now);
      now += dt;
      m.step(dt / 1000, now);
      man.aim(camera, m, now, dt / 1000, W, H);
      frame(camera, m, now);
    }
  };
  for (let i = 0; i < rallies; i++) {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    run(1400);
    const entry = sim.step();
    if (entry === null) break;
    for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, i, 0, entry.winner)) {
      m.scene(beat, now);
      run(beat.ms);
    }
    run(3200);
  }
}

/** Where a point lands on the screen, -1 to 1 each way — and whether it is in front of the lens. */
function onScreen(camera: PerspectiveCamera, x: number, y: number, z: number): { x: number; y: number; front: boolean } {
  const v = new Vector3(x, y, z).project(camera);
  return { x: v.x, y: v.y, front: v.z > -1 && v.z < 1 };
}

test('the broadcast camera is the one the painted hall is drawn for', () => {
  const ref = courtCamera(W, H);
  watch('broadcast', 1, (camera) => {
    assert.ok(camera.projectionMatrix.equals(ref.projectionMatrix));
    assert.ok(camera.position.equals(ref.position));
  });
});

test('every camera keeps the court in front of it and the play in shot, from above the floor', () => {
  for (const { mode } of CAMERA_MODES) {
    let frames = 0;
    let ballSeen = 0;
    let ballFrames = 0;
    watch(mode, 3, (camera, m, now) => {
      frames++;
      assert.ok(camera.position.z >= 1.2, `${mode}: the lens at ${camera.position.z.toFixed(2)} m`);
      // The net always in shot — but for the cameras that go after the ball wherever it is.
      const centre = onScreen(camera, 0, 0, 0);
      assert.ok(mode === 'professional' || mode === 'courtside' || (centre.front && Math.abs(centre.x) < 1 && Math.abs(centre.y) < 1),
        `${mode}: the middle of the court in shot`);
      // The ball in play — not on its way back to the next server while the director is tight on the point.
      const ball = m.ballAt(now);
      const f = m.flight;
      if (ball === null || f === null || now < f.t0 || now > f.t0 + f.ms || Math.abs(ball.y) > 9.5) return;
      ballFrames++;
      const b = onScreen(camera, ball.x, ball.y, ball.z);
      if (b.front && Math.abs(b.x) <= 1.02 && Math.abs(b.y) <= 1.02) ballSeen++;
    });
    assert.ok(frames > 500, `${mode}: ${frames} frames`);
    assert.ok(ballSeen / ballFrames > 0.85, `${mode}: the ball in shot ${ballSeen} of ${ballFrames} frames`);
  }
});

test('the director cuts between takes: behind the server, the rally from the side, tight on the point, wide between', () => {
  const takes = new Set<string>();
  watch('professional', 4, (camera) => {
    const p = camera.position;
    if (Math.abs(Math.abs(p.y) - 17.5) < 1e-6) takes.add('serve');
    else if (Math.abs(p.x - 12.5) < 1e-6) takes.add('rally');
    else if (Math.abs(p.x - 9.5) < 1e-6 && Math.abs(p.z - 3.6) < 1e-6) takes.add('point');
    else if (Math.abs(p.x - 9) < 1e-6 && Math.abs(p.z - 13.5) < 1e-6) takes.add('wide');
  });
  assert.deepEqual([...takes].sort(), ['point', 'rally', 'serve', 'wide']);
});
