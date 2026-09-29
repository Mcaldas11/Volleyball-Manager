/**
 * The live court, as television shows a match: from high in the side stand,
 * the near team on the left, the far team on the right, the net between them.
 *
 * Three layers, one over the other. At the bottom, the hall — floor, lines,
 * advertising boards and the crowd in the stand — painted once per size. Over
 * it, the players, net and ball in 3D (court3d.ts), their shadows falling on
 * the painted floor; the two share one camera, so they line up to the pixel.
 * On top, each player's live rating (and name) riding over their head.
 *
 * The match script (matchCourt.ts) says where every player should be, what
 * they are doing and where the ball is going at each beat; courtMotion.ts
 * makes that motion continuous — running to the mark, the pass, the set, the
 * run-up and jump for the spike, the block, the serve — and this component
 * just hands it each new scene and draws a frame on every animation tick.
 * Where the browser has no WebGL the players are drawn flat on the top layer
 * instead.
 */

import { useEffect, useRef, type JSX } from 'react';
import type { PlayerStore } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
import { Court3D, type Kit, type Look } from './court3d.ts';
import { buildProjector, type Projector } from './courtCamera.ts';
import { CourtMotion, flightAt, handOf, type Body } from './courtMotion.ts';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH, NET_HEIGHT, type Ball3, type Scene } from './matchCourt.ts';

export type { Kit } from './court3d.ts';

type P3 = [number, number, number];

/** The hall's colours: an FIVB court — orange inside, blue free zone. */
const FLOOR = {
  arena: '#1d2a3c',
  freeZone: '#1f5c9f',
  court: '#d8773f',
  frontZone: '#df8550',
  line: 'rgba(255, 255, 255, 0.92)',
};

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

interface CourtProps {
  store: PlayerStore;
  kits: [Kit, Kit];
  /** Which side (0 home, 1 away) a player belongs to. */
  teamOf: (p: number) => 0 | 1;
  ratings: Map<number, number>;
  labels: CourtLabels;
}

export function LiveCourt({
  scene, store, kits, teamOf, ratings, labels = 'ratings',
}: {
  scene: Scene;
  store: PlayerStore;
  kits: [Kit, Kit];
  teamOf: (p: number) => 0 | 1;
  ratings: Map<number, number>;
  labels?: CourtLabels;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hallRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const props = useRef<CourtProps>({ store, kits, teamOf, ratings, labels });
  props.current = { store, kits, teamOf, ratings, labels };
  const motion = useRef<CourtMotion | null>(null);
  if (motion.current === null) {
    motion.current = new CourtMotion(
      (p) => ({ height: (props.current.store.heightCm[p] || 195) / 100, hand: handOf(p) }),
      (p) => props.current.teamOf(p),
    );
  }

  // Hand each new scene to the motion: new marks, new moves, a new flight.
  useEffect(() => {
    motion.current?.scene(scene, performance.now());
  }, [scene]);

  // The animation loop — runs for the life of the court.
  useEffect(() => {
    const wrap = wrapRef.current;
    const hallCanvas = hallRef.current;
    const topCanvas = topRef.current;
    const m = motion.current;
    if (wrap === null || hallCanvas === null || topCanvas === null || m === null) return;
    const hall = hallCanvas.getContext('2d');
    const top = topCanvas.getContext('2d');
    if (hall === null || top === null) return;
    // The 3D layer gets a canvas of its own for each run of this effect: a
    // WebGL context given back on cleanup can't be had again from the same
    // canvas, and React's development mode runs every effect twice.
    const glCanvas = document.createElement('canvas');
    glCanvas.className = 'live-court-canvas';
    wrap.insertBefore(glCanvas, topCanvas);
    let court: Court3D | null = null;
    try {
      court = new Court3D(glCanvas);
    } catch {
      glCanvas.remove();
    }

    const looks = new Map<number, Look>();
    const numbers = new ShirtNumbers();
    const lookOf = (p: number): Look => {
      let look = looks.get(p);
      if (look === undefined) {
        look = lookFor(p, props.current, numbers);
        looks.set(p, look);
      }
      return look;
    };

    let project = buildProjector(1, 1);
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let hallKits = '';
    const paintHall = (): void => {
      hall.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawHall(hall, cssW, cssH, dpr, project, props.current.kits);
      hallKits = JSON.stringify(props.current.kits);
    };
    // The canvases take whatever box the layout gives them — the match screen
    // fits the viewport, so the court shrinks to the space rather than
    // pushing the page into a scroll. The camera fits the court inside that
    // box, and the hall is painted again for the new size.
    const resize = (): void => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cssW = Math.max(1, wrap.clientWidth);
      cssH = Math.max(1, wrap.clientHeight);
      for (const c of [hallCanvas, topCanvas]) {
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
      }
      top.setTransform(dpr, 0, 0, dpr, 0, 0);
      project = buildProjector(cssW, cssH);
      court?.resize(cssW, cssH, dpr);
      paintHall();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (JSON.stringify(props.current.kits) !== hallKits) {
        looks.clear();
        paintHall();
      }
      m.step(dt, now);
      top.clearRect(0, 0, cssW, cssH);
      if (court !== null) {
        court.render(m, now, dt, lookOf);
        const c = court;
        drawLabels(top, m, props.current, (p) => c.headOnScreen(p));
      } else {
        drawFlat(top, project, m, props.current, now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      court?.dispose();
      glCanvas.remove();
    };
  }, []);

  return (
    <div className="live-court" ref={wrapRef}>
      <canvas ref={hallRef} className="live-court-canvas" />
      <canvas ref={topRef} className="live-court-canvas" />
    </div>
  );
}

// ---- How each player looks ------------------------------------------------------------

/** Shirt numbers: the same one for a player all match, never two alike on a side. */
class ShirtNumbers {
  private readonly given = new Map<number, number>();
  private readonly taken: [Set<number>, Set<number>] = [new Set(), new Set()];

  of(p: number, id: number, team: 0 | 1): number {
    let n = this.given.get(p);
    if (n === undefined) {
      const want = 1 + (((id * 7) % 20) + 20) % 20;
      n = want;
      for (let i = 0; i < 99 && this.taken[team].has(n); i++) n = (n % 99) + 1;
      this.given.set(p, n);
      this.taken[team].add(n);
    }
    return n;
  }
}

const SKIN_TONES: readonly string[] = ['#f3d4b8', '#eac29d', '#dcaa80', '#c18a60', '#99653f', '#6e472c', '#553622'];

function lookFor(p: number, props: CourtProps, numbers: ShirtNumbers): Look {
  const team = props.teamOf(p);
  const role = props.store.position[p] as Position;
  const id = props.store.id[p];
  const h = Math.imul(id, 0x9e3779b1) >>> 0;
  const tone = h % SKIN_TONES.length;
  return {
    kit: props.kits[team],
    libero: role === Position.Libero,
    trim: ROLE_TRIM[role],
    number: numbers.of(p, id, team),
    skin: SKIN_TONES[tone],
    // Darker skin, darker hair.
    hair: tone >= 4 ? HAIR[(h >> 4) % 3 === 0 ? 2 : 0] : HAIR[(h >> 4) % HAIR.length],
    hairStyle: (h >> 8) % 7 === 0 ? 2 : (h >> 8) % 2,
  };
}

/** Each player's live rating, and their name when asked for (always for the
 *  player on the ball), riding over their head. */
function drawLabels(
  ctx: CanvasRenderingContext2D, m: CourtMotion, props: CourtProps,
  head: (p: number) => { X: number; Y: number; s: number } | null,
): void {
  if (props.labels === 'off') return;
  for (const [p, b] of m.bodies) {
    const at = head(p);
    if (at === null) continue;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    drawLabel(ctx, at.X, at.Y, at.s, p, props, m.actor === p);
    ctx.restore();
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

// ---- Without WebGL: the players drawn flat ---------------------------------------------

function drawFlat(ctx: CanvasRenderingContext2D, project: Projector, m: CourtMotion, props: CourtProps, now: number): void {
  // ---- Shadows and floor markers ----
  const ball = m.flight !== null ? flightAt(m.flight, now) : null;
  for (const b of m.bodies.values()) {
    floorCircle(ctx, project, b.x, b.y, 0.36 * (1 - Math.min(0.5, b.lift * 0.5)), `rgba(0,0,0,${0.32 * b.alpha})`, null);
  }
  if (m.actor !== null) {
    const a = m.bodies.get(m.actor);
    if (a !== undefined) floorCircle(ctx, project, a.x, a.y, 0.58, null, 'rgba(255,199,44,0.95)', 2);
  }
  if (m.flight !== null && m.flight.to.z < 1.3) {
    const t = Math.min(1, (now - m.flight.t0) / Math.max(1, m.flight.ms));
    if (t < 1) {
      const pulse = 0.35 + 0.15 * Math.sin(now / 90);
      floorCircle(ctx, project, m.flight.to.x, m.flight.to.y, pulse, null, 'rgba(255,255,255,0.8)', 1.5);
    }
  }
  if (ball !== null) {
    const fade = Math.max(0.08, 0.4 - ball.z * 0.06);
    floorCircle(ctx, project, ball.x, ball.y, Math.max(0.08, 0.16 - ball.z * 0.012), `rgba(0,0,0,${fade})`, null);
  }

  // ---- Everything standing up, furthest from the camera first ----
  const items: Array<{ d: number; draw: () => void }> = [];
  for (const [p, b] of m.bodies) {
    items.push({ d: project(b.x, b.y, 0).d, draw: () => drawPlayer(ctx, project, p, b, props, m.actor === p) });
  }
  // The net in strips, so a player on the camera's side of it stands in front
  // of the stretch nearest them and behind the rest.
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
    items.push({ d: project(ball.x, ball.y, ball.z).d - 0.01, draw: () => drawBall(ctx, project, ball, m.trail) });
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
 * A player drawn flat, standing up off the floor: legs (bent low for a pass),
 * knee pads and shoes, shorts, the shirt with their role's trim across the
 * shoulders, arms where the pose puts them, and a head of hair. Drawn to
 * scale for their distance from the camera.
 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  project: Projector,
  p: number,
  b: Body,
  props: CourtProps,
  isActor: boolean,
): void {
  const { store, kits, teamOf } = props;
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
  const crouch = b.pose === 'receive' || b.pose === 'dig' || b.pose === 'pass' || b.pose === 'cover';
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
    ctx.strokeStyle = FLAT_SKIN;
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
  ctx.strokeStyle = FLAT_SKIN;
  ctx.lineWidth = Math.max(1.5, wide(0.085));
  if (b.pose === 'block' || b.pose === 'spike' || b.pose === 'set' || b.pose === 'serve' || b.pose === 'float') {
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

  drawLabel(ctx, cx, at(headZ) - headR, s, p, props, isActor);
  ctx.restore();
}

const FLAT_SKIN = '#e2bf97';

/** A player's live rating, and optionally their name, just above `(x, top)`. */
function drawLabel(
  ctx: CanvasRenderingContext2D, x: number, top: number, s: number, p: number, props: CourtProps, isActor: boolean,
): void {
  const { store, ratings, labels } = props;
  const rating = ratings.get(p);
  const showName = labels === 'names' || (labels === 'ratings' && isActor);
  if (labels === 'off' || (!showName && rating === undefined)) return;
  const size = Math.max(9, Math.min(12, 0.3 * s));
  ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
  const name = showName ? store.shortName(p) : '';
  const nameW = name !== '' ? ctx.measureText(name).width + 8 : 0;
  const chipW = rating !== undefined ? size * 2.3 : 0;
  const totalW = nameW + chipW;
  const boxH = size + 5;
  const y0 = top - boxH - 4;
  const x0 = x - totalW / 2;
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
