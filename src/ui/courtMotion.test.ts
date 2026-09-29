import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import { CourtMotion, handOf, REFEREE_STAND, type Body, type Signal } from './courtMotion.ts';
import { rallyBeats, setupScene, type Ball3, type Beat, type Pose } from './matchCourt.ts';
import { BONES, buildRig, COVER, HOLD, jointPositions, READY, STAND, STILL } from './playerRig.ts';

function liveMatch(seed: number) {
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
  const home = new Set(world.clubs[0].players);
  return { sim, store: world.players, teamOf: (p: number): 0 | 1 => (home.has(p) ? 0 : 1) };
}

/** A player's hands in court metres, this frame. */
function handsOf(b: Body): [Ball3, Ball3] {
  const j = jointPositions(b.rig);
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const place = (v: readonly number[]): Ball3 => ({
    x: b.x + (v[0] * c - v[1] * s) * b.scale,
    y: b.y + (v[0] * s + v[1] * c) * b.scale,
    z: b.lift + v[2] * b.scale,
  });
  return [place(j.hands[0]), place(j.hands[1])];
}

function dist(a: Ball3, b: Ball3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface Contact {
  pose: Pose;
  /** How far the nearest hand (or the middle of the platform) is from the ball. */
  miss: number;
  lift: number;
}

/**
 * Play rallies through the motion at 60 frames a second, as the court does,
 * and note every contact as the ball arrives, calling `check` on every frame.
 */
function playRallies(seed: number, rallies: number, check?: (m: CourtMotion, beat: Beat, now: number) => void): Contact[] {
  const { sim, store, teamOf } = liveMatch(seed);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: handOf(p) }), teamOf);
  const contacts: Contact[] = [];
  let now = 0;
  const run = (ms: number, beat: Beat | null): void => {
    const end = now + ms;
    while (now < end - 1e-6) {
      const dt = Math.min(1000 / 60, end - now);
      now += dt;
      m.step(dt / 1000, now);
      if (beat !== null) check?.(m, beat, now);
    }
  };
  for (let i = 0; i < rallies; i++) {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    run(900, null);
    const entry = sim.step();
    if (entry === null) break;
    for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, i, 0, entry.winner)) {
      m.scene(beat, now);
      run(beat.ms, beat);
      const actor = beat.actor !== null ? m.bodies.get(beat.actor) : undefined;
      const pose = beat.actor !== null ? beat.poses.get(beat.actor) : undefined;
      if (actor === undefined || pose === undefined || beat.ball === null) continue;
      const [l, r] = handsOf(actor);
      const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 };
      const miss = pose === 'receive' || pose === 'dig' || pose === 'pass' || pose === 'set'
        ? dist(mid, beat.ball)
        : Math.min(dist(l, beat.ball), dist(r, beat.ball));
      contacts.push({ pose, miss, lift: actor.lift });
    }
  }
  return contacts;
}

test('standing, on the toes or crouched, both feet stay flat on the floor', () => {
  for (const s of [STAND, READY, COVER, HOLD]) {
    for (const hand of [1, -1] as const) {
      const j = jointPositions(buildRig(s, { ...STILL, hand }));
      for (const a of j.ankles) assert.ok(Math.abs(a[2] - BONES.ankle) < 0.01, `ankle at ${a[2].toFixed(3)} m`);
      assert.ok(j.head[2] > 1.2, 'and the head stays up');
    }
  }
});

test('running swings the feet along the way the player is going, one off the floor at a time', () => {
  const lifted: number[] = [];
  for (let g = 0; g < Math.PI * 2; g += 0.2) {
    const j = jointPositions(buildRig(READY, { ...STILL, gait: g, moveY: 5 }));
    lifted.push(Math.max(j.ankles[0][2], j.ankles[1][2]) - BONES.ankle);
    assert.ok(Math.min(j.ankles[0][2], j.ankles[1][2]) - BONES.ankle < 0.12, 'one foot is always near the floor');
  }
  assert.ok(Math.max(...lifted) > 0.1, 'and the other comes through off it');
});

test('every hand meets the ball: passes, sets, spikes, serves', () => {
  const contacts = playRallies(11, 40);
  const by = new Map<Pose, number[]>();
  for (const c of contacts) by.set(c.pose, [...(by.get(c.pose) ?? []), c.miss]);
  for (const pose of ['receive', 'set', 'spike', 'serve'] as const) {
    const misses = by.get(pose) ?? [];
    assert.ok(misses.length > 3, `enough ${pose}s were played (${misses.length})`);
    const median = [...misses].sort((a, b) => a - b)[Math.floor(misses.length / 2)];
    assert.ok(median < 0.3, `${pose}: the ball should be in the hands (median miss ${median.toFixed(2)} m)`);
  }
});

test('hitters and jump servers strike at the top of a real jump', () => {
  const contacts = playRallies(12, 30).filter((c) => c.pose === 'spike' || c.pose === 'serve');
  assert.ok(contacts.length > 10);
  for (const c of contacts) assert.ok(c.lift > 0.2, `${c.pose} hit from ${c.lift.toFixed(2)} m off the floor`);
});

test('blockers are up in the air as the hitter strikes, and nobody crosses the net', () => {
  let blocksSeen = 0;
  const side = new Map<number, number>();
  playRallies(13, 30, (m, beat, now) => {
    for (const [p, b] of m.bodies) {
      if (b.leaving) continue;
      const s = Math.sign(b.y);
      if (!side.has(p)) side.set(p, s);
      assert.equal(s, side.get(p), 'a player stays on their own side of the net');
    }
    // The last frame of an attack beat: the hitter is on the ball.
    const hitter = beat.actor !== null && beat.poses.get(beat.actor) === 'spike';
    if (!hitter || beat.ball === null || m.flight === null || now < m.flight.t0 + m.flight.ms - 1) return;
    for (const [p, pose] of beat.poses) {
      if (pose !== 'block') continue;
      blocksSeen++;
      assert.ok(m.bodies.get(p)!.lift > 0.15, 'the block goes up with the hitter');
    }
  });
  assert.ok(blocksSeen > 10);
});

test('when the ball goes down, the winners celebrate and the losers take it in', () => {
  const { sim, store, teamOf } = liveMatch(14);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: handOf(p) }), teamOf);
  const pre = sim.snapshot();
  m.scene(setupScene(pre, pre.serving, store.position, 0), 0);
  const entry = sim.step()!;
  let now = 0;
  for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, 0, 0, entry.winner)) {
    m.scene(beat, now);
    for (let t = 0; t < beat.ms; t += 16) m.step(0.016, (now += 16));
  }
  m.step(0.016, (now += 16));
  for (const [p, b] of m.bodies) {
    assert.ok(b.reaction !== null);
    assert.equal(b.reaction.kind, teamOf(p) === entry.winner ? 'celebrate' : 'dejected');
  }
});

test('running flat out a player runs tall; shuffling a step or two they stay low', () => {
  const m = new CourtMotion(() => ({ height: 1.95, hand: 1 }), () => 0);
  const scene = (x: number, y: number): Parameters<CourtMotion['scene']>[0] => ({
    positions: new Map([[1, { x, y }]]), poses: new Map([[1, 'ready']]), ball: null, arc: 0, actor: null, ms: 1500,
  });
  m.scene(scene(0, -8.5), 0);
  let now = 0;
  const run = (ms: number): void => {
    for (let t = 0; t < ms; t += 16) m.step(0.016, (now += 16));
  };
  run(600);
  const standing = m.bodies.get(1)!.rig.pelvis.z;
  // Seven metres to the net: a proper run.
  m.scene(scene(0, -1.5), now);
  run(450);
  const running = m.bodies.get(1)!.rig.pelvis.z;
  assert.ok(running > standing + 0.07, `hips up when running (${running.toFixed(2)} vs ${standing.toFixed(2)})`);
  run(1500);
  // A shuffle half a metre to the side: stays down in the stance.
  m.scene(scene(0.6, -1.5), now);
  run(120);
  assert.ok(m.bodies.get(1)!.rig.pelvis.z < standing + 0.04, 'a shuffle stays low');
});

/** A match played through the motion rally by rally, noting every call the referee makes. */
function refereeing(seed: number) {
  const { sim, store, teamOf } = liveMatch(seed);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: handOf(p) }), teamOf);
  const calls: Signal[] = [];
  let now = 0;
  const run = (ms: number): void => {
    for (let t = 0; t < ms; t += 16) {
      m.step(0.016, (now += 16));
      if (m.signal !== null && calls[calls.length - 1] !== m.signal) calls.push(m.signal);
    }
  };
  const setup = (): { serving: 0 | 1 } => {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    return { serving: pre.serving };
  };
  const stoppage = (timeout: 0 | 1 | null, paused: boolean): void => m.setStoppage(timeout, paused, now);
  const rally = (during?: () => void) => {
    const pre = sim.snapshot();
    const entry = sim.step()!;
    rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, 0, 0, entry.winner).forEach((b, k) => {
      m.scene(b, now);
      if (k === 0) during?.();
      run(b.ms);
    });
    return entry;
  };
  return { m, calls, run, setup, rally, stoppage };
}

test('the referee waves each serve on before the toss, and gives each point to the side that won it, arm out towards them', () => {
  const { m, calls, run, setup, rally } = refereeing(15);
  for (let i = 0; i < 12; i++) {
    const { serving } = setup();
    run(1800);
    const waved = calls[calls.length - 1];
    assert.equal(waved?.kind, 'serve', 'the serve is waved on before the toss');
    assert.equal(waved.team, serving);
    const entry = rally();
    run(1100);
    const call = m.signal!;
    assert.equal(call.kind, 'point');
    assert.equal(call.team, entry.winner);
    // Home plays the near half (negative y): the arm goes out over the winners' half.
    const side = entry.winner === 0 ? -1 : 1;
    const out = Math.max(...handsOf(m.referee).map((h) => side * (h.y - REFEREE_STAND.y)));
    assert.ok(out > 0.6, `the arm points to the winners (${out.toFixed(2)} m out)`);
  }
});

test('a time-out is signalled once the rally in play is over, and no serve is waved on until play restarts', () => {
  const { calls, run, setup, rally, stoppage } = refereeing(16);
  setup();
  run(1800);
  const before = calls.length;
  rally(() => stoppage(1, true));
  run(4000);
  const after = calls.slice(before).map((c) => `${c.kind}${c.kind === 'timeout' ? c.team : ''}`);
  assert.deepEqual(after.slice(0, 2), ['point', 'timeout1'], 'the point first, then the time-out');
  setup();
  run(3000);
  assert.ok(!calls.slice(before).some((c) => c.kind === 'serve'), 'no serve during the time-out');
  stoppage(null, false);
  run(1200);
  assert.equal(calls[calls.length - 1].kind, 'serve', 'play back on: the serve is waved on');
});

test('a serve waved on before a stoppage is waved on again once play is back on', () => {
  const { calls, run, setup, stoppage } = refereeing(17);
  setup();
  run(1200);
  assert.equal(calls[calls.length - 1]?.kind, 'serve');
  stoppage(0, true);
  run(3000);
  const waved = calls.filter((c) => c.kind === 'serve').length;
  stoppage(null, false);
  run(1000);
  assert.equal(calls.filter((c) => c.kind === 'serve').length, waved + 1);
});
