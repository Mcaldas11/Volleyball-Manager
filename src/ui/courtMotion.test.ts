import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import { CourtMotion, LINE_JUDGES, lineCall, REFEREE_STAND, type Body, type Signal } from './courtMotion.ts';
import { PlayerFlag } from '../engine/model/players.ts';
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
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
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
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
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
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
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
    // As the match does: as long again as the server needs to get behind the end line.
    for (let w = 0; w < 4000 && !m.serverReady(); w += 100) run(100);
    run(600);
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
  const { m, calls, run, setup, stoppage } = refereeing(17);
  setup();
  run(1200);
  assert.equal(calls[calls.length - 1]?.kind, 'serve');
  stoppage(0, true);
  run(3000);
  const waved = calls.filter((c) => c.kind === 'serve').length;
  stoppage(null, false);
  // Back from the benches, the server to his spot behind the line — then the serve is waved on.
  run(1000);
  for (let w = 0; w < 4000 && !m.serverReady(); w += 100) run(100);
  run(600);
  assert.equal(calls.filter((c) => c.kind === 'serve').length, waved + 1);
});

test('a dive takes the whole body to the floor: flat out, head and hands low and out in front of the feet', () => {
  const standing = jointPositions(buildRig(STAND, STILL));
  const flat = jointPositions(buildRig({ ...STAND, crouch: 0, dive: 1.47, nod: -0.85, ...{ hFlex: 2.8, oFlex: 2.8, hElbow: 0.2, oElbow: 0.2 } }, STILL));
  assert.ok(standing.head[2] > 1.6, 'up on his feet');
  assert.ok(flat.head[2] < 0.5, `head down by the floor (${flat.head[2].toFixed(2)} m)`);
  assert.ok(flat.head[1] > 1.4, 'and well out in front of where he stood');
  for (const hand of flat.hands) {
    assert.ok(hand[1] > flat.head[1], 'the arms stretched out past the head');
    assert.ok(hand[2] > -0.05 && hand[2] < 0.6, 'along the floor, not through it');
  }
  // Sideways: over towards the side he rolls to.
  const sprawl = jointPositions(buildRig({ ...STAND, roll: 1.3 }, STILL));
  assert.ok(sprawl.head[0] > 1.2 && sprawl.head[2] < 0.7);
});

test('the line judges flag every ball near their lines: down for in, up for out, a hand on top for a touch', () => {
  assert.equal(lineCall({ x: 4.3, y: -5 }, false), 'in');
  assert.equal(lineCall({ x: 0, y: -0.5 }, false), null, 'well inside: nothing to signal');
  assert.equal(lineCall({ x: 5.2, y: 3 }, true), 'out');
  assert.equal(lineCall({ x: 1, y: 9.6 }, false), 'touch', 'out, but the point to the hitter: off the block');
  // Through real rallies: a moment after each ball comes down, the judge of that half has his flag where it should be.
  const { sim, store, teamOf } = liveMatch(31);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
  let now = 0;
  const run = (ms: number): void => {
    const end = now + ms;
    while (now < end - 1e-6) {
      const dt = Math.min(1000 / 60, end - now);
      now += dt;
      m.step(dt / 1000, now);
    }
  };
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    run(900);
    const entry = sim.step();
    if (entry === null) break;
    m.lastLineCall = null;
    for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, i, 0, entry.winner)) {
      m.scene(beat, now);
      run(beat.ms);
    }
    run(450);
    // (Set by the motion as the ball comes down — not by this loop.)
    const call = m.lastLineCall as CourtMotion['lastLineCall'];
    if (call === null) continue;
    seen.add(call.call);
    const hand = m.lineJudges[call.judge].rig.arms[1].x;
    if (call.call === 'in') assert.ok(hand < 1.4, `flag down for in (${hand.toFixed(2)})`);
    else assert.ok(hand > 2.2, `flag up for ${call.call} (${hand.toFixed(2)})`);
  }
  assert.ok(seen.has('in') && seen.has('out'), `signals seen: ${[...seen].join(', ')}`);
  assert.equal(LINE_JUDGES.length, 2);
});

test('after a point the side that won it comes together — round the one who won it, if someone did', () => {
  const { sim, store, teamOf } = liveMatch(15);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
  let now = 0;
  let huddles = 0;
  let heroes = 0;
  for (let r = 0; r < 12; r++) {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    for (let t = 0; t < 900; t += 16) m.step(0.016, (now += 16));
    const entry = sim.step()!;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, r, 0, entry.winner);
    for (const beat of beats) {
      m.scene(beat, now);
      for (let t = 0; t < beat.ms; t += 16) m.step(0.016, (now += 16));
    }
    // A second and a bit after the ball goes down.
    for (let t = 0; t < 1100; t += 16) m.step(0.016, (now += 16));
    const onCourt = beats.at(-1)!.positions;
    const six = [...m.bodies].filter(([p, b]) => teamOf(p) === entry.winner && b.side === null && !b.leaving && onCourt.has(p));
    const xs = six.map(([, b]) => b.x);
    const ys = six.map(([, b]) => b.y);
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (spread < 2.2) huddles++;
    const hero = beats.at(-1)?.hero;
    if (hero !== undefined && six.some(([p]) => p === hero)) {
      const h = m.bodies.get(hero)!;
      const near = six.filter(([p, b]) => p !== hero && Math.hypot(b.x - h.x, b.y - h.y) < 1.4).length;
      if (near >= 3) heroes++;
    }
  }
  assert.ok(huddles >= 8, `${huddles} of 12 points ended in a huddle`);
  assert.ok(heroes >= 2, `team-mates ran to the one who won it ${heroes} times`);
});

test('a tip is no full swing — the elbow stays soft — and it still meets the ball', () => {
  let tips = 0;
  const { sim, store, teamOf } = liveMatch(16);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
  let now = 0;
  for (let r = 0; r < 80 && tips < 3; r++) {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    for (let t = 0; t < 900; t += 16) m.step(0.016, (now += 16));
    const entry = sim.step();
    if (entry === null) break;
    for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, r, 0, entry.winner)) {
      m.scene(beat, now);
      const end = now + beat.ms;
      while (now < end - 1e-6) {
        const dt = Math.min(1000 / 60, end - now);
        now += dt;
        m.step(dt / 1000, now);
      }
      if (beat.shot !== 'tip' || beat.actor === null || beat.ball === null) continue;
      const b = m.bodies.get(beat.actor)!;
      const [l, rh] = handsOf(b);
      const miss = Math.min(dist(l, beat.ball), dist(rh, beat.ball));
      assert.ok(miss < 0.35, `the tip meets the ball (${miss.toFixed(2)} m)`);
      assert.ok(b.shape.hElbow > 0.18, `a soft elbow on a tip (${b.shape.hElbow.toFixed(2)})`);
      tips++;
    }
  }
  assert.ok(tips >= 1, 'some tips were played');
});

test('shuffling sideways the feet step and close, and never cross', () => {
  for (const moveX of [1.2, 2.2, -2.2]) {
    for (let g = 0; g < Math.PI * 2; g += 0.15) {
      const j = jointPositions(buildRig(READY, { ...STILL, gait: g, moveX }));
      // Ankle 0 is the left foot: it stays left of the right one.
      assert.ok(j.ankles[0][0] < j.ankles[1][0] - 0.04, `feet crossed at ${g.toFixed(2)} moving ${moveX} m/s`);
    }
  }
});

test('a time-out: both sides go to their benches and stand round their coach — and back to their places after', () => {
  const { sim, store, teamOf } = liveMatch(17);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
  m.setSideline({ bench: [[], []], waiting: [[], []], warming: new Set() }, 0, 0);
  const pre = sim.snapshot();
  let now = 0;
  const setup = setupScene(pre, pre.serving, store.position, 0);
  m.scene(setup, now);
  for (let t = 0; t < 1500; t += 16) m.step(0.016, (now += 16));
  m.setStoppage(1, true, now);
  for (let t = 0; t < 4000; t += 16) m.step(0.016, (now += 16));
  for (const [p] of setup.positions) {
    const b = m.bodies.get(p)!;
    const coach = m.coaches[teamOf(p)];
    assert.ok(Math.hypot(b.x - coach.x, b.y - coach.y) < 2.2, `${p} by the coach (${Math.hypot(b.x - coach.x, b.y - coach.y).toFixed(1)} m)`);
  }
  m.setStoppage(null, false, now);
  for (let t = 0; t < 3500; t += 16) m.step(0.016, (now += 16));
  for (const [p, g] of setup.positions) {
    const b = m.bodies.get(p)!;
    assert.ok(Math.hypot(b.x - g.x, b.y - g.y) < 0.8, `${p} back in place`);
  }
});

test('before the first serve: lined up, then hands slapped at the net — each side on its own — then to their places', () => {
  const { sim, store, teamOf } = liveMatch(18);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
  const pre = sim.snapshot();
  let now = 0;
  const setup = setupScene(pre, pre.serving, store.position, 0);
  m.scene(setup, now);
  m.step(0.016, (now += 16));
  const side = new Map([...setup.positions].map(([p, g]) => [p, Math.sign(g.y)]));
  m.ceremony(now);
  const t0 = now;
  const until = (ms: number): void => { while (now < t0 + ms) m.step(0.016, (now += 16)); };
  until(3800);
  for (const [p] of setup.positions) assert.ok(Math.abs(Math.abs(m.bodies.get(p)!.y) - 3.2) < 0.6, 'lined up on the attack line');
  until(5400);
  for (const [p] of setup.positions) {
    const b = m.bodies.get(p)!;
    assert.ok(Math.abs(b.y) < 1.3, `${p} at the net (${b.y.toFixed(2)})`);
    assert.equal(Math.sign(b.y), side.get(p), 'and on his own side of it');
  }
  until(9000);
  for (const [p, g] of setup.positions) {
    const b = m.bodies.get(p)!;
    assert.ok(Math.hypot(b.x - g.x, b.y - g.y) < 0.6, `${p} in place for the serve`);
  }
});

test('the serve waits for the server: the ball is tossed only from behind the end line', () => {
  const { sim, store, teamOf } = liveMatch(23);
  const m = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
  let now = 0;
  const run = (ms: number): void => {
    for (const end = now + ms; now < end - 1e-6;) {
      const dt = Math.min(1000 / 60, end - now);
      now += dt;
      m.step(dt / 1000, now);
    }
  };
  let heldUp = 0;
  for (let i = 0; i < 30; i++) {
    const pre = sim.snapshot();
    m.scene(setupScene(pre, pre.serving, store.position, 0), now);
    // As the match does: the referee's moment, then as long as the server needs to get there.
    run(300);
    if (!m.serverReady()) heldUp++;
    let waited = 0;
    for (; waited < 4000 && !m.serverReady(); waited += 100) run(100);
    assert.ok(m.serverReady(), `rally ${i}: the server got to his spot`);
    const entry = sim.step();
    if (entry === null) break;
    const beats = rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, i, 0, entry.winner);
    const server = m.bodies.get(entry.contacts[0].player)!;
    assert.ok(Math.abs(server.y) > 9, `rally ${i}: tossed from ${server.y.toFixed(2)} m — behind the line`);
    for (const beat of beats) {
      m.scene(beat, now);
      run(beat.ms);
    }
  }
  assert.ok(heldUp > 0, 'some serves had to wait for the server');
});
