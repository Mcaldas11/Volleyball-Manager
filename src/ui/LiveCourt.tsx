/**
 * The live court, drawn on a canvas as television shows a match: from high in
 * the side stand, the near team on the left, the far team on the right, the
 * net between them.
 *
 * The match script (matchCourt.ts) says where every player should be and
 * where the ball is going at each beat; this component makes that motion
 * continuous. It runs its own animation loop: players run toward their
 * targets at a believable speed rather than jumping there, jump for a spike
 * or a block, and the ball flies real three-dimensional arcs — a floated
 * serve, a high pass up to the setter, a flat spike into the floor — always
 * clearing the net, with its shadow on the floor and a marker where it will
 * come down. React only hands over each new scene; everything in between is
 * interpolated frame by frame. The hall itself — floor, boards, the crowd in
 * the stand — is painted once per size and laid under every frame.
 */

import { useEffect, useRef, type JSX } from 'react';
import type { PlayerStore } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
import { buildProjector, type Projector } from './courtCamera.ts';
import {
  ballAlong, COURT_HALF_LENGTH, COURT_HALF_WIDTH, flightBulge, NET_HEIGHT,
  type Ball3, type Pose, type Scene,
} from './matchCourt.ts';

/** A side's playing colours. */
export interface Kit {
  shirt: string;
  shorts: string;
  /** Liberos wear a contrasting shirt, as the rules require. */
  libero: string;
}

interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  lift: number;
  pose: Pose;
  alpha: number;
  leaving: boolean;
}

interface Flight {
  from: Ball3;
  to: Ball3;
  /** Parabola bulge actually used, after solving for the apex and net clearance. */
  bulge: number;
  t0: number;
  ms: number;
}

type P3 = [number, number, number];

/** How high each pose lifts a player off the floor, m. */
const POSE_LIFT: Readonly<Record<Pose, number>> = {
  stand: 0, pass: 0, set: 0.12, serve: 0.35, spike: 0.8, block: 0.6,
};

/** Top running speed and how quickly players close on their mark. */
const MAX_SPEED = 7.5; // m/s
const SETTLE = 0.2; // s

/** The hall's colours: an FIVB court — orange inside, blue free zone. */
const FLOOR = {
  arena: '#1d2a3c',
  freeZone: '#1f5c9f',
  court: '#d8773f',
  frontZone: '#df8550',
  line: 'rgba(255, 255, 255, 0.92)',
};

const SKIN = '#e2bf97';

function flightAt(f: Flight, now: number): Ball3 {
  const t = f.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - f.t0) / f.ms));
  return ballAlong(f.from, f.to, f.bulge, t);
}

function ratingColour(r: number): string {
  if (r >= 8.0) return '#4f9dff';
  if (r >= 7.2) return '#2fbf63';
  if (r >= 6.7) return '#8fd65a';
  if (r >= 6.2) return '#e8c547';
  if (r >= 5.6) return '#f0913d';
  return '#ec5a52';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** What to print by each player: their live rating, name and rating, or nothing. */
export type CourtLabels = 'ratings' | 'names' | 'off';

export function LiveCourt({
  scene, store, kits, teamOf, ratings, labels = 'ratings',
}: {
  scene: Scene;
  store: PlayerStore;
  kits: [Kit, Kit];
  /** Which side (0 home, 1 away) a player belongs to. */
  teamOf: (p: number) => 0 | 1;
  ratings: Map<number, number>;
  labels?: CourtLabels;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({
    bodies: new Map<number, Body>(),
    flight: null as Flight | null,
    trail: [] as Ball3[],
    actor: null as number | null,
    first: true,
    props: { store, kits, teamOf, ratings, labels },
  });
  live.current.props = { store, kits, teamOf, ratings, labels };

  // Hand each new scene to the animation: new targets, new poses, a new flight.
  useEffect(() => {
    const s = live.current;
    const now = performance.now();
    for (const [p, g] of scene.positions) {
      const b = s.bodies.get(p);
      const pose = scene.poses.get(p) ?? 'stand';
      if (b === undefined) {
        // Players arriving mid-match (a substitution) walk on from the sideline.
        const startX = s.first ? g.x : Math.sign(g.x || 1) * (COURT_HALF_WIDTH + 1.6);
        s.bodies.set(p, { x: startX, y: g.y, tx: g.x, ty: g.y, lift: 0, pose, alpha: s.first ? 1 : 0, leaving: false });
      } else {
        b.tx = g.x;
        b.ty = g.y;
        b.pose = pose;
        b.leaving = false;
      }
    }
    for (const [p, b] of s.bodies) {
      if (scene.positions.has(p)) continue;
      b.leaving = true;
      b.tx = Math.sign(b.x || 1) * (COURT_HALF_WIDTH + 1.8);
      b.pose = 'stand';
    }
    s.actor = scene.actor;
    if (scene.ball !== null) {
      const from = s.flight !== null ? flightAt(s.flight, now) : scene.ball;
      s.flight = { from, to: scene.ball, bulge: flightBulge(from, scene.ball, scene.arc), t0: now, ms: scene.ms };
    } else {
      s.flight = null;
    }
    s.first = false;
  }, [scene]);

  // The animation loop — runs for the life of the court.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (canvas === null || wrap === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const hall = document.createElement('canvas');

    let project = buildProjector(1, 1);
    let cssW = 0;
    let cssH = 0;
    let hallKits = '';
    // The canvas takes whatever box the layout gives it — the match screen
    // fits the viewport, so the court shrinks to the space rather than
    // pushing the page into a scroll. The camera fits the court inside that
    // box, and the hall is painted again for the new size.
    const paintHall = (): void => {
      const dpr = canvas.width / cssW;
      hall.width = canvas.width;
      hall.height = canvas.height;
      const hctx = hall.getContext('2d');
      if (hctx === null) return;
      hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawHall(hctx, cssW, cssH, dpr, project, live.current.props.kits);
      hallKits = JSON.stringify(live.current.props.kits);
    };
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = Math.max(1, wrap.clientWidth);
      cssH = Math.max(1, wrap.clientHeight);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      project = buildProjector(cssW, cssH);
      paintHall();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = live.current;
      if (JSON.stringify(s.props.kits) !== hallKits) paintHall();
      step(s, dt, now);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.drawImage(hall, 0, 0, cssW, cssH);
      draw(ctx, project, s, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="live-court" ref={wrapRef}>
      <canvas ref={canvasRef} className="live-court-canvas" />
    </div>
  );
}

type LiveState = {
  bodies: Map<number, Body>;
  flight: Flight | null;
  trail: Ball3[];
  actor: number | null;
};

/** Advance every player and the ball by one frame. */
function step(s: LiveState, dt: number, now: number): void {
  for (const [p, b] of s.bodies) {
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) {
      const move = Math.min(dist, Math.min(MAX_SPEED, dist / SETTLE) * dt);
      b.x += (dx / dist) * move;
      b.y += (dy / dist) * move;
    }
    const lift = POSE_LIFT[b.pose];
    b.lift += (lift - b.lift) * (1 - Math.exp(-dt / 0.07));
    const alphaTarget = b.leaving ? 0 : 1;
    b.alpha += (alphaTarget - b.alpha) * (1 - Math.exp(-dt / 0.25));
    if (b.leaving && b.alpha < 0.02) s.bodies.delete(p);
  }
  if (s.flight !== null) {
    s.trail.push(flightAt(s.flight, now));
    if (s.trail.length > 7) s.trail.shift();
  }
}

// ---- Drawing helpers -------------------------------------------------------------

function polygon(ctx: CanvasRenderingContext2D, project: Projector, pts: P3[]): void {
  ctx.beginPath();
  pts.forEach(([x, y, z], i) => {
    const p = project(x, y, z);
    if (i === 0) ctx.moveTo(p.X, p.Y);
    else ctx.lineTo(p.X, p.Y);
  });
  ctx.closePath();
}

function segment(ctx: CanvasRenderingContext2D, project: Projector, a: P3, b: P3, stroke: string, lw: number): void {
  const p = project(...a);
  const q = project(...b);
  ctx.beginPath();
  ctx.moveTo(p.X, p.Y);
  ctx.lineTo(q.X, q.Y);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** A circle of radius `r` metres on the floor, as the camera sees it. */
function floorCircle(
  ctx: CanvasRenderingContext2D, project: Projector, x: number, y: number, r: number,
  fill: string | null, stroke: string | null, lw = 1.5,
): void {
  const c = project(x, y, 0);
  const a = project(x + r, y, 0);
  const b = project(x, y + r, 0);
  ctx.save();
  // The unit circle carried onto the floor: the path is fixed in screen space,
  // so the stroke below keeps its own width.
  ctx.transform(a.X - c.X, a.Y - c.Y, b.X - c.X, b.Y - c.Y, c.X, c.Y);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.restore();
  if (fill !== null) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke !== null) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** A small, fixed-seed generator, so the crowd sits in the same seats every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- The hall: painted once per size -----------------------------------------------

/** Where the far stand starts, and the advertising boards in front of it. */
const BOARD_X = -7.3;
const BOARD_HEIGHT = 0.9;
const END_BOARD_Y = 12.4;

function drawHall(
  ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, project: Projector, kits: [Kit, Kit],
): void {
  ctx.clearRect(0, 0, w, h);

  // ---- The far stand and its crowd ----
  const rows = 20;
  const standBack = BOARD_X - 0.9 - rows * 0.8;
  const standTop = 1.35 + rows * 0.6;
  polygon(ctx, project, [
    [BOARD_X - 0.4, -34, 1.05], [BOARD_X - 0.4, 34, 1.05], [standBack, 34, standTop], [standBack, -34, standTop],
  ]);
  const top = project(standBack, 0, standTop).Y;
  const bottom = project(BOARD_X, 0, 1).Y;
  const tiers = ctx.createLinearGradient(0, top, 0, bottom);
  tiers.addColorStop(0, '#0a0f16');
  tiers.addColorStop(1, '#17212f');
  ctx.fillStyle = tiers;
  ctx.fill();
  const rand = seeded(20260728);
  const crowdColours = ['#c9ced6', '#3b4658', '#7d8796', '#e7e2d6', '#2a3342', '#9aa3b0'];
  for (let row = 0; row < rows; row++) {
    const x = BOARD_X - 0.9 - row * 0.8;
    const z = 1.35 + row * 0.6;
    for (let y = -33.5; y <= 33.5; y += 0.62) {
      if (rand() < 0.12) continue; // an empty seat
      const jitter = (rand() - 0.5) * 0.18;
      const p = project(x, y + jitter, z);
      const r = Math.max(0.8, 0.14 * p.s);
      const pick = rand();
      // The home end is loud in home colours; the away fans have their corner too.
      ctx.fillStyle = pick < 0.34 ? kits[0].shirt : pick < 0.48 ? kits[1].shirt
        : crowdColours[Math.floor(rand() * crowdColours.length)];
      ctx.beginPath();
      ctx.ellipse(p.X, p.Y + r * 1.25, r * 1.25, r * 0.95, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = rand() < 0.5 ? '#e0bd98' : '#b98c63';
      ctx.beginPath();
      ctx.arc(p.X, p.Y, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- The floor ----
  polygon(ctx, project, [[BOARD_X, -END_BOARD_Y, 0], [BOARD_X, END_BOARD_Y, 0], [11, END_BOARD_Y, 0], [11, -END_BOARD_Y, 0]]);
  ctx.fillStyle = FLOOR.arena;
  ctx.fill();
  polygon(ctx, project, [[-6.6, -11.4, 0], [-6.6, 11.4, 0], [6.6, 11.4, 0], [6.6, -11.4, 0]]);
  ctx.fillStyle = FLOOR.freeZone;
  ctx.fill();
  const W = COURT_HALF_WIDTH;
  const L = COURT_HALF_LENGTH;
  polygon(ctx, project, [[-W, -L, 0], [-W, L, 0], [W, L, 0], [W, -L, 0]]);
  ctx.fillStyle = FLOOR.court;
  ctx.fill();
  polygon(ctx, project, [[-W, -3, 0], [-W, 3, 0], [W, 3, 0], [W, -3, 0]]);
  ctx.fillStyle = FLOOR.frontZone;
  ctx.fill();
  // The lights over the court, caught in the polish.
  const mid = project(0, 0, 0);
  const sheen = ctx.createRadialGradient(mid.X, mid.Y, 0, mid.X, mid.Y, Math.max(w, h) * 0.55);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  polygon(ctx, project, [[-6.6, -11.4, 0], [-6.6, 11.4, 0], [6.6, 11.4, 0], [6.6, -11.4, 0]]);
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.lineJoin = 'round';
  polygon(ctx, project, [[-W, -L, 0], [-W, L, 0], [W, L, 0], [W, -L, 0]]);
  ctx.strokeStyle = FLOOR.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  segment(ctx, project, [-W, 0, 0], [W, 0, 0], FLOOR.line, 2);
  for (const y of [-3, 3]) {
    segment(ctx, project, [-W, y, 0], [W, y, 0], FLOOR.line, 1.6);
    // The attack line's dashes, out into the free zone either side.
    for (let k = 0; k < 5; k++) {
      const x0 = W + 0.15 + k * 0.35;
      segment(ctx, project, [x0, y, 0], [x0 + 0.15, y, 0], 'rgba(255,255,255,0.7)', 1.4);
      segment(ctx, project, [-x0, y, 0], [-x0 - 0.15, y, 0], 'rgba(255,255,255,0.7)', 1.4);
    }
  }

  // ---- Advertising boards: along the far side, and across both ends ----
  const boardText = 'VM  ·  VOLLEYBALL MANAGER';
  const board = (from: P3, to: P3, length: number): void => {
    // Lettered left to right as the camera sees the board, never mirrored.
    const [a, b] = project(...from).X <= project(...to).X ? [from, to] : [to, from];
    const segments = Math.max(1, Math.round(length / 4.2));
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const lerp = (t: number, z: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z];
      const tl = project(...lerp(t0, BOARD_HEIGHT));
      const tr = project(...lerp(t1, BOARD_HEIGHT));
      const bl = project(...lerp(t0, 0));
      const br = project(...lerp(t1, 0));
      ctx.beginPath();
      ctx.moveTo(tl.X, tl.Y);
      ctx.lineTo(tr.X, tr.Y);
      ctx.lineTo(br.X, br.Y);
      ctx.lineTo(bl.X, bl.Y);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? '#0f1c30' : '#132440';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // The lettering, carried onto the board's face.
      const bw = 400;
      const bh = 40;
      ctx.save();
      ctx.setTransform(
        dpr * (tr.X - tl.X) / bw, dpr * (tr.Y - tl.Y) / bw,
        dpr * (bl.X - tl.X) / bh, dpr * (bl.Y - tl.Y) / bh,
        dpr * tl.X, dpr * tl.Y,
      );
      ctx.fillStyle = '#e0ad44';
      ctx.font = '800 24px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(boardText, bw / 2, bh / 2 + 1);
      ctx.restore();
    }
    segment(ctx, project, [a[0], a[1], BOARD_HEIGHT], [b[0], b[1], BOARD_HEIGHT], 'rgba(255, 214, 120, 0.55)', 1.2);
  };
  board([BOARD_X, -END_BOARD_Y, 0], [BOARD_X, END_BOARD_Y, 0], END_BOARD_Y * 2);
  board([BOARD_X, -END_BOARD_Y, 0], [9, -END_BOARD_Y, 0], 9 - BOARD_X);
  board([BOARD_X, END_BOARD_Y, 0], [9, END_BOARD_Y, 0], 9 - BOARD_X);
}

// ---- Every frame ------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  s: LiveState & { props: { store: PlayerStore; kits: [Kit, Kit]; teamOf: (p: number) => 0 | 1; ratings: Map<number, number>; labels: CourtLabels } },
  now: number,
): void {
  const { store, kits, teamOf, ratings, labels } = s.props;

  // ---- Shadows and floor markers ----
  const ball = s.flight !== null ? flightAt(s.flight, now) : null;
  for (const b of s.bodies.values()) {
    floorCircle(ctx, project, b.x, b.y, 0.36 * (1 - Math.min(0.5, b.lift * 0.5)), `rgba(0,0,0,${0.32 * b.alpha})`, null);
  }
  if (s.actor !== null) {
    const a = s.bodies.get(s.actor);
    if (a !== undefined) floorCircle(ctx, project, a.x, a.y, 0.58, null, 'rgba(255,199,44,0.95)', 2);
  }
  if (s.flight !== null && s.flight.to.z < 1.3) {
    const t = Math.min(1, (now - s.flight.t0) / Math.max(1, s.flight.ms));
    if (t < 1) {
      const pulse = 0.35 + 0.15 * Math.sin(now / 90);
      floorCircle(ctx, project, s.flight.to.x, s.flight.to.y, pulse, null, 'rgba(255,255,255,0.8)', 1.5);
    }
  }
  if (ball !== null) {
    const fade = Math.max(0.08, 0.4 - ball.z * 0.06);
    floorCircle(ctx, project, ball.x, ball.y, Math.max(0.08, 0.16 - ball.z * 0.012), `rgba(0,0,0,${fade})`, null);
  }

  // ---- Everything standing up, furthest from the camera first ----
  const items: Array<{ d: number; draw: () => void }> = [];
  for (const [p, b] of s.bodies) {
    items.push({
      d: project(b.x, b.y, 0).d,
      draw: () => drawPlayer(ctx, project, p, b, store, kits, teamOf, ratings, labels, s.actor === p),
    });
  }
  // The net in strips, so a player on the camera's side of it stands in front
  // of the stretch nearest him and behind the rest.
  const postX = COURT_HALF_WIDTH + 0.6;
  const strips = 10;
  for (let i = 0; i < strips; i++) {
    const x0 = -postX + (2 * postX * i) / strips;
    const x1 = -postX + (2 * postX * (i + 1)) / strips;
    items.push({ d: project((x0 + x1) / 2, 0, NET_HEIGHT - 0.5).d, draw: () => drawNetStrip(ctx, project, x0, x1) });
  }
  for (const x of [-postX, postX]) {
    items.push({ d: project(x, 0, 1).d, draw: () => drawPost(ctx, project, x) });
  }
  if (ball !== null) {
    items.push({ d: project(ball.x, ball.y, ball.z).d - 0.01, draw: () => drawBall(ctx, project, ball, s.trail) });
  }
  items.sort((a, b) => b.d - a.d);
  for (const it of items) it.draw();
}

function drawPost(ctx: CanvasRenderingContext2D, project: Projector, x: number): void {
  const foot = project(x, 0, 0);
  const top = project(x, 0, NET_HEIGHT + 0.14);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#b8c2cf';
  ctx.lineWidth = Math.max(2, 0.1 * foot.s);
  ctx.beginPath();
  ctx.moveTo(foot.X, foot.Y);
  ctx.lineTo(top.X, top.Y);
  ctx.stroke();
  // The padding round the foot of the post.
  ctx.strokeStyle = '#1f5c9f';
  ctx.lineWidth = Math.max(3, 0.22 * foot.s);
  const pad = project(x, 0, 1.6);
  ctx.beginPath();
  ctx.moveTo(foot.X, foot.Y);
  ctx.lineTo(pad.X, pad.Y);
  ctx.stroke();
}

/** One stretch of the net between `x0` and `x1`: mesh, tapes, and an antenna if one stands in it. */
function drawNetStrip(ctx: CanvasRenderingContext2D, project: Projector, x0: number, x1: number): void {
  const top = NET_HEIGHT;
  const bottom = NET_HEIGHT - 1;
  polygon(ctx, project, [[x0, 0, top], [x1, 0, top], [x1, 0, bottom], [x0, 0, bottom]]);
  ctx.fillStyle = 'rgba(10, 14, 20, 0.28)';
  ctx.fill();
  for (let x = Math.ceil(x0 / 0.3) * 0.3; x <= x1 + 1e-6; x += 0.3) {
    segment(ctx, project, [x, 0, bottom], [x, 0, top], 'rgba(255,255,255,0.16)', 1);
  }
  for (let z = bottom; z <= top + 1e-6; z += 0.25) {
    segment(ctx, project, [x0, 0, z], [x1, 0, z], 'rgba(255,255,255,0.14)', 1);
  }
  segment(ctx, project, [x0, 0, top], [x1, 0, top], '#f4f6fa', 3);
  segment(ctx, project, [x0, 0, bottom], [x1, 0, bottom], 'rgba(244,246,250,0.75)', 1.5);
  // Antennas, red and white, above each sideline.
  for (const x of [-COURT_HALF_WIDTH, COURT_HALF_WIDTH]) {
    if (x < x0 || x > x1) continue;
    for (let i = 0; i < 8; i++) {
      const z0 = bottom + i * 0.225;
      segment(ctx, project, [x, 0, z0], [x, 0, z0 + 0.225], i % 2 === 0 ? '#e5484d' : '#ffffff', 2.5);
    }
  }
}

function drawBall(ctx: CanvasRenderingContext2D, project: Projector, ball: Ball3, trail: Ball3[]): void {
  trail.forEach((t, i) => {
    const p = project(t.x, t.y, t.z);
    const r = Math.max(2, 0.12 * p.s) * (0.4 + (i / trail.length) * 0.5);
    ctx.beginPath();
    ctx.arc(p.X, p.Y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.05 + (i / trail.length) * 0.18})`;
    ctx.fill();
  });
  const p = project(ball.x, ball.y, ball.z);
  const r = Math.max(3.5, 0.13 * p.s);
  const g = ctx.createRadialGradient(p.X - r * 0.35, p.Y - r * 0.35, r * 0.2, p.X, p.Y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.7, '#f3f0e2');
  g.addColorStop(1, '#c8c2a8');
  ctx.beginPath();
  ctx.arc(p.X, p.Y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // The ball's blue and yellow panels, hinted at by two seams.
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.strokeStyle = 'rgba(59, 99, 214, 0.75)';
  ctx.beginPath();
  ctx.arc(p.X, p.Y, r * 0.62, -0.4, 1.4);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 199, 44, 0.85)';
  ctx.beginPath();
  ctx.arc(p.X, p.Y, r * 0.62, 2.4, 4.1);
  ctx.stroke();
}

/**
 * A player, standing up off the floor: legs (bent for a pass), knee pads and
 * shoes, shorts, the shirt with his role's trim across the shoulders, arms
 * where the pose puts them, and a head of hair. Drawn to scale for his
 * distance from the camera.
 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  p: number,
  b: Body,
  store: PlayerStore,
  kits: [Kit, Kit],
  teamOf: (p: number) => 0 | 1,
  ratings: Map<number, number>,
  labels: CourtLabels,
  isActor: boolean,
): void {
  const foot = project(b.x, b.y, b.lift);
  const head = project(b.x, b.y, b.lift + 1);
  const perM = foot.Y - head.Y; // screen px per metre of height here
  const s = foot.s;
  const kit = kits[teamOf(p)];
  const role = store.position[p] as Position;
  const shirt = role === Position.Libero ? kit.libero : kit.shirt;
  const at = (z: number): number => foot.Y - z * perM;
  const wide = (m: number): number => m * s;
  const cx = foot.X;
  const crouch = b.pose === 'pass';
  const hip = crouch ? 0.78 : 0.93;
  const knee = crouch ? 0.4 : 0.5;

  ctx.save();
  ctx.globalAlpha = b.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Legs, knee pads and shoes.
  for (const side of [-1, 1]) {
    const hx = cx + side * wide(0.09);
    const kx = cx + side * wide(crouch ? 0.19 : 0.1);
    const fx = cx + side * wide(crouch ? 0.2 : 0.12);
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = Math.max(1.5, wide(0.12));
    ctx.beginPath();
    ctx.moveTo(hx, at(hip));
    ctx.lineTo(kx, at(knee));
    ctx.lineTo(fx, at(0.06));
    ctx.stroke();
    ctx.fillStyle = '#1a1e26';
    ctx.beginPath();
    ctx.arc(kx, at(knee), Math.max(1, wide(0.07)), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1f3f6';
    ctx.beginPath();
    ctx.ellipse(fx, at(0.04), Math.max(1.2, wide(0.1)), Math.max(0.8, wide(0.045)), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shorts.
  ctx.fillStyle = kit.shorts;
  roundRect(ctx, cx - wide(0.2), at(hip + 0.2), wide(0.4), 0.26 * perM, wide(0.06));
  ctx.fill();

  // Arms: up for a block, spike, set or serve; forward and together for a pass.
  const shoulder = hip + 0.58;
  ctx.strokeStyle = SKIN;
  ctx.lineWidth = Math.max(1.5, wide(0.085));
  if (b.pose === 'block' || b.pose === 'spike' || b.pose === 'set' || b.pose === 'serve') {
    const reach = b.pose === 'set' ? shoulder + 0.55 : shoulder + 0.75;
    const spread = b.pose === 'block' ? 0.2 : 0.12;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * wide(0.19), at(shoulder - 0.05));
      ctx.lineTo(cx + side * wide(0.19 + spread), at(reach));
      ctx.stroke();
    }
  } else if (crouch) {
    ctx.beginPath();
    ctx.moveTo(cx - wide(0.19), at(shoulder - 0.08));
    ctx.lineTo(cx, at(hip - 0.1));
    ctx.lineTo(cx + wide(0.19), at(shoulder - 0.08));
    ctx.stroke();
  } else {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * wide(0.2), at(shoulder - 0.05));
      ctx.lineTo(cx + side * wide(0.25), at(hip + 0.05));
      ctx.stroke();
    }
  }

  // Shirt, shaded, with the role's trim across the shoulders — the setter,
  // the middles and the rest read at a glance.
  const torsoTop = at(shoulder);
  const torsoH = (shoulder - hip - 0.15) * perM;
  const grad = ctx.createLinearGradient(cx - wide(0.23), 0, cx + wide(0.23), 0);
  grad.addColorStop(0, shirt);
  grad.addColorStop(1, shadeOf(shirt));
  ctx.fillStyle = grad;
  roundRect(ctx, cx - wide(0.23), torsoTop, wide(0.46), torsoH, wide(0.1));
  ctx.fill();
  ctx.fillStyle = ROLE_TRIM[role];
  roundRect(ctx, cx - wide(0.23), torsoTop, wide(0.46), Math.max(1.5, 0.1 * perM), wide(0.04));
  ctx.fill();

  // Head and hair.
  const headZ = shoulder + 0.17;
  const headR = Math.max(2, wide(0.12));
  ctx.fillStyle = '#e8c6a0';
  ctx.beginPath();
  ctx.arc(cx, at(headZ), headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR[p % HAIR.length];
  ctx.beginPath();
  ctx.arc(cx, at(headZ), headR, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();

  // Live rating (and optionally the name), over the head.
  const rating = ratings.get(p);
  const showName = labels === 'names' || (labels === 'ratings' && isActor);
  if (labels !== 'off' && (showName || rating !== undefined)) {
    const size = Math.max(9, Math.min(12, 0.3 * s));
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    const name = showName ? store.shortName(p) : '';
    const nameW = name !== '' ? ctx.measureText(name).width + 8 : 0;
    const chipW = rating !== undefined ? size * 2.3 : 0;
    const totalW = nameW + chipW;
    const boxH = size + 5;
    const y0 = at(headZ) - headR - boxH - 4;
    const x0 = cx - totalW / 2;
    if (nameW > 0) {
      ctx.fillStyle = 'rgba(8, 10, 14, 0.7)';
      roundRect(ctx, x0, y0, totalW, boxH, 4);
      ctx.fill();
      ctx.fillStyle = isActor ? '#ffd650' : '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(name, x0 + 4, y0 + 2.5);
    }
    if (rating !== undefined) {
      const chipX = x0 + nameW;
      ctx.fillStyle = ratingColour(rating);
      roundRect(ctx, chipX, y0, chipW, boxH, 3);
      ctx.fill();
      ctx.fillStyle = rating >= 8 || rating < 5.6 ? '#ffffff' : '#0b0e13';
      ctx.font = `800 ${size - 1}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const label = rating.toFixed(1);
      ctx.fillText(label, chipX + (chipW - ctx.measureText(label).width) / 2, y0 + 3);
    }
  }
  ctx.restore();
}

const ROLE_TRIM: Readonly<Record<Position, string>> = {
  [Position.Setter]: '#ffc72c',
  [Position.Opposite]: '#ff6b6b',
  [Position.OutsideHitter]: '#8fc2ff',
  [Position.MiddleBlocker]: '#c7a6ff',
  [Position.Libero]: '#0b0e13',
};

const HAIR: readonly string[] = ['#2b1d14', '#4a3222', '#1a1410', '#7a5a36', '#b08a4e', '#3a2a20'];

/** A darker shade of a CSS hsl() colour, for the shirt's shading. */
function shadeOf(colour: string): string {
  const m = /hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/.exec(colour);
  if (m === null) return colour;
  return `hsl(${m[1]}, ${m[2]}%, ${Math.max(10, Number(m[3]) - 16)}%)`;
}

/** Playing colours for both sides from their club hues, forced apart when the
 *  two clubs happen to wear similar colours. */
export function kitsFor(homeHue: number, awayHue: number): [Kit, Kit] {
  let away = awayHue;
  const gap = Math.abs(((homeHue - awayHue + 540) % 360) - 180);
  if (gap < 55) away = (awayHue + 180) % 360;
  const kit = (h: number): Kit => ({
    shirt: `hsl(${h.toFixed(0)}, 62%, 50%)`,
    shorts: `hsl(${h.toFixed(0)}, 35%, 20%)`,
    libero: `hsl(${((h + 150) % 360).toFixed(0)}, 70%, 58%)`,
  });
  return [kit(homeHue), kit(away)];
}
