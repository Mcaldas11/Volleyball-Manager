/**
 * The live match court, drawn on a canvas in perspective.
 *
 * The match script (matchCourt.ts) says where every player should be and
 * where the ball is going at each beat; this component makes that motion
 * continuous. It runs its own animation loop: players run toward their
 * targets at a believable speed rather than jumping there, jump for a spike
 * or a block, and the ball flies real three-dimensional arcs — a floated
 * serve, a high pass up to the setter, a flat spike into the floor — always
 * clearing the net, with its shadow on the floor and a marker where it will
 * come down. React only hands over each new scene; everything in between is
 * interpolated frame by frame.
 */

import { useEffect, useRef, type JSX } from 'react';
import type { PlayerStore } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
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

interface Projector {
  (x: number, y: number, z: number): { X: number; Y: number; s: number };
}

/** Camera behind and well above the near baseline, looking down the court —
 *  high enough that the far half isn't squashed behind the net. */
const CAM_Y = -16;
const CAM_Z = 20;
const LOOK_Y = 0.5;

/** How high each pose lifts a player off the floor, m. */
const POSE_LIFT: Readonly<Record<Pose, number>> = {
  stand: 0, pass: 0, set: 0.12, serve: 0.35, spike: 0.8, block: 0.6,
};

/** Top running speed and how quickly players close on their mark. */
const MAX_SPEED = 7.5; // m/s
const SETTLE = 0.2; // s

/** How tall the canvas should be for a given width, so the court fills it. */
function courtAspect(): number {
  const p = buildProjector(1000, 1000);
  const pts = FIT_PROBES.map(([x, y, z]) => p(x, y, z));
  const w = Math.max(...pts.map((q) => q.X)) - Math.min(...pts.map((q) => q.X));
  const h = Math.max(...pts.map((q) => q.Y)) - Math.min(...pts.map((q) => q.Y));
  return Math.min(0.95, Math.max(0.6, (h / w) * 1.04));
}

/** What must be in shot: the court and its lines, the posts, a server behind
 *  either baseline, and heads at the far end. The rest of the free zone may
 *  fall off the edges. */
const FIT_PROBES: ReadonlyArray<readonly [number, number, number]> = [
  [-5.3, -10.4, 0], [5.3, -10.4, 0], [-5.3, 10.4, 0], [5.3, 10.4, 0],
  [-5.3, 0, 3.4], [5.3, 0, 3.4], [0, 10.4, 2.4],
];

function buildProjector(width: number, height: number): Projector {
  const dirY = LOOK_Y - CAM_Y;
  const dirZ = -CAM_Z;
  const len = Math.hypot(dirY, dirZ);
  const fY = dirY / len;
  const fZ = dirZ / len;
  const raw = (x: number, y: number, z: number): { X: number; Y: number; d: number } => {
    const dy = y - CAM_Y;
    const dz = z - CAM_Z;
    const d = dy * fY + dz * fZ;
    const up = dy * -fZ + dz * fY;
    return { X: x / d, Y: -up / d, d };
  };
  const probes = FIT_PROBES.map(([x, y, z]) => raw(x, y, z));
  const minX = Math.min(...probes.map((p) => p.X));
  const maxX = Math.max(...probes.map((p) => p.X));
  const minY = Math.min(...probes.map((p) => p.Y));
  const maxY = Math.max(...probes.map((p) => p.Y));
  const pad = 0.03;
  const F = Math.min((width * (1 - 2 * pad)) / (maxX - minX), (height * (1 - 2 * pad)) / (maxY - minY));
  const cx = width / 2 - ((minX + maxX) / 2) * F;
  const cy = height / 2 - ((minY + maxY) / 2) * F;
  return (x, y, z) => {
    const p = raw(x, y, z);
    return { X: cx + p.X * F, Y: cy + p.Y * F, s: F / p.d };
  };
}

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

    const aspect = courtAspect();
    let project = buildProjector(1, 1);
    let cssW = 0;
    let cssH = 0;
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = wrap.clientWidth;
      cssH = Math.round(cssW * aspect);
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      project = buildProjector(cssW, cssH);
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
      step(s, dt, now);
      draw(ctx, cssW, cssH, project, s, now);
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

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: Projector,
  s: LiveState & { props: { store: PlayerStore; kits: [Kit, Kit]; teamOf: (p: number) => 0 | 1; ratings: Map<number, number>; labels: CourtLabels } },
  now: number,
): void {
  const { store, kits, teamOf, ratings, labels } = s.props;
  ctx.clearRect(0, 0, w, h);

  const poly = (pts: Array<[number, number, number]>, fill: string | null, stroke: string | null, lw = 1): void => {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => {
      const p = project(x, y, z);
      if (i === 0) ctx.moveTo(p.X, p.Y);
      else ctx.lineTo(p.X, p.Y);
    });
    ctx.closePath();
    if (fill !== null) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke !== null) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  const line = (a: [number, number, number], b: [number, number, number], stroke: string, lw: number): void => {
    const p = project(...a);
    const q = project(...b);
    ctx.beginPath();
    ctx.moveTo(p.X, p.Y);
    ctx.lineTo(q.X, q.Y);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  const ellipse = (x: number, y: number, rx: number, fill: string | null, stroke: string | null, lw = 1.5): void => {
    const c = project(x, y, 0);
    const side = project(x + rx, y, 0);
    const depth = project(x, y + rx, 0);
    ctx.beginPath();
    ctx.ellipse(c.X, c.Y, Math.abs(side.X - c.X), Math.max(1, Math.abs(depth.Y - c.Y)), 0, 0, Math.PI * 2);
    if (fill !== null) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke !== null) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };

  // ---- Floor ----
  const W = COURT_HALF_WIDTH;
  const L = COURT_HALF_LENGTH;
  poly([[-6.6, -11.4, 0], [6.6, -11.4, 0], [6.6, 11.4, 0], [-6.6, 11.4, 0]], '#1c2838', null);
  poly([[-W, -L, 0], [W, -L, 0], [W, L, 0], [-W, L, 0]], '#2e425c', 'rgba(255,255,255,0.85)', 2);
  // Subtle lighting: brighter towards the net.
  const glow = ctx.createLinearGradient(0, project(0, -L, 0).Y, 0, project(0, L, 0).Y);
  glow.addColorStop(0, 'rgba(255,255,255,0.0)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  glow.addColorStop(1, 'rgba(0,0,0,0.12)');
  poly([[-W, -L, 0], [W, -L, 0], [W, L, 0], [-W, L, 0]], null, null);
  ctx.fillStyle = glow;
  ctx.fill();
  line([-W, 0, 0], [W, 0, 0], 'rgba(255,255,255,0.85)', 2);
  line([-W, -3, 0], [W, -3, 0], 'rgba(255,255,255,0.55)', 1.5);
  line([-W, 3, 0], [W, 3, 0], 'rgba(255,255,255,0.55)', 1.5);

  // ---- Shadows and floor markers ----
  const ball = s.flight !== null ? flightAt(s.flight, now) : null;
  for (const b of s.bodies.values()) {
    ellipse(b.x, b.y, 0.34 * (1 - Math.min(0.5, b.lift * 0.5)), `rgba(0,0,0,${0.35 * b.alpha})`, null);
  }
  if (s.actor !== null) {
    const a = s.bodies.get(s.actor);
    if (a !== undefined) ellipse(a.x, a.y, 0.55, null, 'rgba(255,199,44,0.95)', 2);
  }
  if (s.flight !== null && s.flight.to.z < 1.3) {
    const t = Math.min(1, (now - s.flight.t0) / Math.max(1, s.flight.ms));
    if (t < 1) {
      const pulse = 0.35 + 0.15 * Math.sin(now / 90);
      ellipse(s.flight.to.x, s.flight.to.y, pulse, null, 'rgba(255,255,255,0.75)', 1.5);
    }
  }
  if (ball !== null) {
    const fade = Math.max(0.08, 0.4 - ball.z * 0.06);
    ellipse(ball.x, ball.y, Math.max(0.08, 0.16 - ball.z * 0.012), `rgba(0,0,0,${fade})`, null);
  }

  // ---- Everything standing up, far to near ----
  const items: Array<{ y: number; draw: () => void }> = [];
  for (const [p, b] of s.bodies) {
    items.push({ y: b.y, draw: () => drawPlayer(ctx, project, p, b, store, kits, teamOf, ratings, labels, s.actor === p) });
  }
  items.push({ y: 0, draw: () => drawNet(ctx, project, line) });
  if (ball !== null) {
    items.push({ y: ball.y - 0.01, draw: () => drawBall(ctx, project, ball, s.trail) });
  }
  items.sort((a, b) => b.y - a.y);
  for (const it of items) it.draw();
}

function drawNet(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  line: (a: [number, number, number], b: [number, number, number], stroke: string, lw: number) => void,
): void {
  const postX = COURT_HALF_WIDTH + 0.6;
  const top = NET_HEIGHT;
  const bottom = NET_HEIGHT - 1;
  // Posts.
  for (const x of [-postX, postX]) line([x, 0, 0], [x, 0, top + 0.12], '#c9d1dc', 3);
  // Mesh.
  const a = project(-postX, 0, top);
  const b = project(postX, 0, top);
  const c = project(postX, 0, bottom);
  const d = project(-postX, 0, bottom);
  ctx.beginPath();
  ctx.moveTo(a.X, a.Y);
  ctx.lineTo(b.X, b.Y);
  ctx.lineTo(c.X, c.Y);
  ctx.lineTo(d.X, d.Y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10, 14, 20, 0.35)';
  ctx.fill();
  for (let x = -postX; x <= postX + 0.01; x += 0.3) line([x, 0, bottom], [x, 0, top], 'rgba(255,255,255,0.14)', 1);
  for (let z = bottom; z <= top; z += 0.25) line([-postX, 0, z], [postX, 0, z], 'rgba(255,255,255,0.12)', 1);
  // Tapes.
  line([-postX, 0, top], [postX, 0, top], '#f4f6fa', 3);
  line([-postX, 0, bottom], [postX, 0, bottom], 'rgba(244,246,250,0.7)', 1.5);
  // Antennas, red and white.
  for (const x of [-COURT_HALF_WIDTH, COURT_HALF_WIDTH]) {
    for (let i = 0; i < 8; i++) {
      const z0 = bottom + i * 0.225;
      line([x, 0, z0], [x, 0, z0 + 0.225], i % 2 === 0 ? '#e5484d' : '#ffffff', 2.5);
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
  const half = (m: number): number => (m * s) / 2;

  ctx.save();
  ctx.globalAlpha = b.alpha;

  // Arms: up for a block, spike, set or serve; forward for a pass.
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#e2bf97';
  ctx.lineWidth = Math.max(1.5, 0.08 * s);
  if (b.pose === 'block' || b.pose === 'spike' || b.pose === 'set' || b.pose === 'serve') {
    const reach = b.pose === 'set' ? 2.05 : 2.3;
    const spread = b.pose === 'block' ? 0.2 : 0.12;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(foot.X + side * half(0.34), at(1.45));
      ctx.lineTo(foot.X + side * half(0.34 + spread * 2), at(reach));
      ctx.stroke();
    }
  } else if (b.pose === 'pass') {
    ctx.beginPath();
    ctx.moveTo(foot.X - half(0.34), at(1.35));
    ctx.lineTo(foot.X, at(0.85));
    ctx.lineTo(foot.X + half(0.34), at(1.35));
    ctx.stroke();
  }

  // Legs and shorts.
  ctx.fillStyle = kit.shorts;
  roundRect(ctx, foot.X - half(0.32), at(0.9), half(0.32) * 2, 0.9 * perM, half(0.12));
  ctx.fill();
  // Shirt.
  const torsoTop = at(1.52);
  const torsoH = 0.72 * perM;
  const grad = ctx.createLinearGradient(foot.X - half(0.46), 0, foot.X + half(0.46), 0);
  grad.addColorStop(0, shirt);
  grad.addColorStop(1, shadeOf(shirt));
  ctx.fillStyle = grad;
  roundRect(ctx, foot.X - half(0.46), torsoTop, half(0.46) * 2, torsoH, half(0.2));
  ctx.fill();
  // Role trim across the shoulders, so the setter, middles and the rest read at a glance.
  ctx.fillStyle = ROLE_TRIM[role];
  roundRect(ctx, foot.X - half(0.46), torsoTop, half(0.46) * 2, Math.max(1.5, 0.1 * perM), half(0.08));
  ctx.fill();
  // Head.
  ctx.beginPath();
  ctx.arc(foot.X, at(1.68), Math.max(2, 0.13 * s), 0, Math.PI * 2);
  ctx.fillStyle = '#e8c6a0';
  ctx.fill();

  // Live rating (and optionally the name): under the feet on the near side,
  // over the head on the far side, so the two front rows' labels never pile
  // up on top of each other at the net.
  const rating = ratings.get(p);
  const showName = labels === 'names' || (labels === 'ratings' && isActor);
  if (labels !== 'off' && (showName || rating !== undefined)) {
    const ground = project(b.x, b.y, 0);
    const size = Math.max(9, Math.min(12, 0.3 * ground.s));
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    const name = showName ? store.shortName(p) : '';
    const nameW = name !== '' ? ctx.measureText(name).width + 8 : 0;
    const chipW = rating !== undefined ? size * 2.3 : 0;
    const totalW = nameW + chipW;
    const boxH = size + 5;
    const y0 = b.y < 0 ? ground.Y + 5 : at(2.05) - boxH - 2;
    const x0 = ground.X - totalW / 2;
    if (nameW > 0) {
      ctx.fillStyle = 'rgba(8, 10, 14, 0.66)';
      roundRect(ctx, x0, y0, totalW, boxH, 4);
      ctx.fill();
      ctx.fillStyle = isActor ? '#ffd650' : '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(name, x0 + 4, y0 + 2.5);
    }
    if (rating !== undefined) {
      const cx = x0 + nameW;
      ctx.fillStyle = ratingColour(rating);
      roundRect(ctx, cx, y0, chipW, boxH, 3);
      ctx.fill();
      ctx.fillStyle = rating >= 8 || rating < 5.6 ? '#ffffff' : '#0b0e13';
      ctx.font = `800 ${size - 1}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const label = rating.toFixed(1);
      ctx.fillText(label, cx + (chipW - ctx.measureText(label).width) / 2, y0 + 3);
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


