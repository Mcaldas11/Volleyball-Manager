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
 *
 * Or the match from above, in 2D: the court upright, the far team at the top,
 * every player a disc with their name, the ball and its shadow — the same
 * motion, so the view can change in the middle of a rally.
 */

import { useEffect, useRef, type JSX } from 'react';
import { PlayerFlag, type PlayerStore } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
import { RATING_BANDS } from '../engine/match/playerRating.ts';
import { Court3D, type Kit, type Look } from './court3d.ts';
import { buildProjector, type Projector } from './courtCamera.ts';
import {
  type Body, CourtMotion, type CourtInjury, type CourtSideline, flightAt, SIDELINE,
} from './courtMotion.ts';
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
  if (r >= RATING_BANDS.star) return '#4f9dff';
  if (r >= RATING_BANDS.great) return '#2fbf63';
  if (r >= RATING_BANDS.good) return '#8fd65a';
  if (r >= RATING_BANDS.ok) return '#e8c547';
  if (r >= RATING_BANDS.poor) return '#f0913d';
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

/** From the stand in 3D, or from above in 2D. */
export type CourtView = '3d' | '2d';

interface CourtProps {
  store: PlayerStore;
  /** How full the stand is, 0-1. */
  crowdFill?: number;
  /** Who is off the court, and the team playing on the near (negative) half — the bench side. */
  sideline?: CourtSideline | null;
  nearTeam?: 0 | 1;
  /** The position each player is playing in this match, if not his own. */
  roles?: ArrayLike<number>;
  kits: [Kit, Kit];
  /** Which side (0 home, 1 away) a player belongs to. */
  teamOf: (p: number) => 0 | 1;
  ratings: Map<number, number>;
  labels: CourtLabels;
  /** Short names for the referee's calls: home, away. */
  teamNames: [string, string];
  view: CourtView;
}

export function LiveCourt({
  scene, store, roles, kits, teamOf, ratings, labels = 'ratings', timeout = null, paused = false, speed = 1,
  teamNames = ['Home', 'Away'], view = '3d', sideline = null, nearTeam = 0, crowdFill = 0.85, injury = null,
}: {
  scene: Scene;
  /** Someone down hurt, and where the stoppage for him has got to. */
  injury?: CourtInjury | null;
  store: PlayerStore;
  /** How full the stand is, 0-1 — a title decider packed, a dead rubber half empty. */
  crowdFill?: number;
  roles?: ArrayLike<number>;
  /** Who is off the court — substitutes, a libero waiting — and who is warming up. */
  sideline?: CourtSideline | null;
  /** The team on the near half. */
  nearTeam?: 0 | 1;
  kits: [Kit, Kit];
  teamOf: (p: number) => 0 | 1;
  ratings: Map<number, number>;
  labels?: CourtLabels;
  /** A time-out in progress, and whose — once the rally it followed has been shown. */
  timeout?: 0 | 1 | null;
  /** Play stopped: the referee waves no serve on. */
  paused?: boolean;
  /** How fast the match is being shown. */
  speed?: number;
  teamNames?: [string, string];
  view?: CourtView;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hallRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const props = useRef<CourtProps>({ store, roles, kits, teamOf, ratings, labels, teamNames, view, sideline, nearTeam, crowdFill });
  props.current = { store, roles, kits, teamOf, ratings, labels, teamNames, view, sideline, nearTeam, crowdFill };
  /** The bench side as last handed to the motion. */
  const sidelineKey = useRef('');
  const applySideline = (now: number): void => {
    const sl = props.current.sideline;
    const m = motion.current;
    if (sl === null || sl === undefined || m === null) return;
    const key = JSON.stringify([sl.bench, sl.waiting, [...sl.warming], sl.hurt ?? [], props.current.nearTeam]);
    if (key === sidelineKey.current) return;
    sidelineKey.current = key;
    m.setSideline(sl, props.current.nearTeam ?? 0, now);
  };
  const motion = useRef<CourtMotion | null>(null);
  if (motion.current === null) {
    motion.current = new CourtMotion(
      (p) => ({
        height: (props.current.store.heightCm[p] || 195) / 100,
        hand: props.current.store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1,
      }),
      (p) => props.current.teamOf(p),
    );
  }

  // Hand each new scene to the motion: new marks, new moves, a new flight.
  useEffect(() => {
    // Who is off the court first: a substitution's two players find each other in the zone.
    applySideline(performance.now());
    motion.current?.scene(scene, performance.now());
  }, [scene]);

  // The referee's side of things: stoppages, time-outs, the pace of play.
  useEffect(() => {
    motion.current?.setStoppage(timeout, paused, performance.now());
  }, [timeout, paused]);

  // Someone hurt: down, the physio on, up again or helped off.
  const injuryKey = injury === null ? '' : `${injury.p}:${injury.phase}`;
  useEffect(() => {
    // Who is off hurt goes on the sideline before he is sent there.
    applySideline(performance.now());
    motion.current?.setInjury(injury, performance.now());
  }, [injuryKey]);
  if (motion.current !== null) motion.current.pace = speed;

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
    let shownView: CourtView = props.current.view;
    const paintHall = (): void => {
      hall.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (props.current.view === '2d') {
        hall.clearRect(0, 0, cssW, cssH);
        drawTopFloor(hall, topProjector(cssW, cssH), props.current.kits, props.current.nearTeam ?? 0);
      } else {
        // Without WebGL the crowd is painted into the stand instead.
        drawHall(hall, cssW, cssH, dpr, project, props.current.kits, court === null);
      }
      hallKits = JSON.stringify([props.current.kits, props.current.nearTeam]);
      shownView = props.current.view;
      glCanvas.style.display = shownView === '2d' ? 'none' : '';
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
      if (JSON.stringify([props.current.kits, props.current.nearTeam]) !== hallKits) {
        looks.clear();
        paintHall();
      }
      if (props.current.view !== shownView) paintHall();
      applySideline(now);
      m.step(dt, now);
      top.clearRect(0, 0, cssW, cssH);
      if (shownView === '2d') {
        drawTopDown(top, topProjector(cssW, cssH), m, props.current, now);
      } else if (court !== null) {
        const near = props.current.nearTeam ?? 0;
        court.setBenches(props.current.kits, near === 0 ? [-1, 1] : [1, -1]);
        court.setCrowd(props.current.kits, props.current.crowdFill ?? 0.85);
        court.render(m, now, dt, lookOf, (t) => coachLook(props.current.kits[t]));
        const c = court;
        drawLabels(top, m, props.current, (p) => c.headOnScreen(p));
        drawCall(top, m, props.current, c.refereeOnScreen(), now);
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

// ---- The court from above ---------------------------------------------------------------

/** Court metres to screen pixels, looking straight down, the court upright: the far team at the top. */
interface TopProjector {
  X: (x: number) => number;
  Y: (y: number) => number;
  /** Pixels per metre. */
  s: number;
}

/** The free zone around the court that the view takes in, in metres from the centre. */
const TOP_HALF_W = 7.6;
const TOP_HALF_L = 12.5;

function topProjector(w: number, h: number): TopProjector {
  const s = Math.min((w * 0.94) / (2 * TOP_HALF_W), (h * 0.96) / (2 * TOP_HALF_L));
  return { X: (x) => w / 2 + x * s, Y: (y) => h / 2 - y * s, s };
}

/** The floor seen from above: the free zone, the court, its lines, and the net across the middle. */
function drawTopFloor(ctx: CanvasRenderingContext2D, P: TopProjector, kits: [Kit, Kit], nearTeam: 0 | 1): void {
  const rect = (x0: number, y0: number, x1: number, y1: number, fill: string, radius = 0): void => {
    const X = P.X(Math.min(x0, x1));
    const Y = P.Y(Math.max(y0, y1));
    const W = Math.abs(x1 - x0) * P.s;
    const H = Math.abs(y1 - y0) * P.s;
    roundRect(ctx, X, Y, W, H, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // The hall's floor, the free zone on it.
  rect(-TOP_HALF_W, -TOP_HALF_L, TOP_HALF_W, TOP_HALF_L, FLOOR.arena, 10);
  rect(-6.6, -11.4, 6.6, 11.4, '#235fa3', 6);
  // The bench side: each team's warm-up square in the corner, its bench, its bottles.
  const sides: [number, number] = nearTeam === 0 ? [-1, 1] : [1, -1];
  for (const t of [0, 1] as const) {
    const side = sides[t];
    const w = SIDELINE.warmup;
    const X = P.X(w.x0);
    const Y = P.Y(Math.max(side * w.y0, side * w.y1));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(X, Y, (w.x1 - w.x0) * P.s, (w.y1 - w.y0) * P.s);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(1.2, P.s * 0.05);
    ctx.strokeRect(X, Y, (w.x1 - w.x0) * P.s, (w.y1 - w.y0) * P.s);
    const b = SIDELINE.bench;
    rect(b.x - 0.21, side * b.y0, b.x + 0.21, side * b.y1, kits[t].shirt, 3);
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(P.X(b.x + 0.42 + (i % 2) * 0.07), P.Y(side * (b.y0 + 0.3 + i * 0.42)), Math.max(1.5, P.s * 0.05), 0, Math.PI * 2);
      ctx.fillStyle = '#9cc8f0';
      ctx.fill();
    }
  }
  rect(-COURT_HALF_WIDTH, -COURT_HALF_LENGTH, COURT_HALF_WIDTH, COURT_HALF_LENGTH, FLOOR.court, 6);
  rect(-COURT_HALF_WIDTH, -3, COURT_HALF_WIDTH, 3, FLOOR.frontZone);

  ctx.strokeStyle = FLOOR.line;
  ctx.lineWidth = Math.max(1.5, P.s * 0.07);
  ctx.strokeRect(P.X(-COURT_HALF_WIDTH), P.Y(COURT_HALF_LENGTH), 2 * COURT_HALF_WIDTH * P.s, 2 * COURT_HALF_LENGTH * P.s);
  for (const y of [-3, 3]) {
    ctx.beginPath();
    ctx.moveTo(P.X(-COURT_HALF_WIDTH), P.Y(y));
    ctx.lineTo(P.X(COURT_HALF_WIDTH), P.Y(y));
    ctx.stroke();
    // The attack line carries on, dashed, across the free zone.
    ctx.save();
    ctx.setLineDash([P.s * 0.25, P.s * 0.25]);
    ctx.lineWidth = Math.max(1, P.s * 0.05);
    for (const [a, b] of [[-TOP_HALF_W, -COURT_HALF_WIDTH], [COURT_HALF_WIDTH, TOP_HALF_W]]) {
      ctx.beginPath();
      ctx.moveTo(P.X(a), P.Y(y));
      ctx.lineTo(P.X(b), P.Y(y));
      ctx.stroke();
    }
    ctx.restore();
  }
  // The net, post to post across the centre line.
  const post = COURT_HALF_WIDTH + 0.8;
  ctx.fillStyle = 'rgba(16, 22, 32, 0.55)';
  ctx.fillRect(P.X(-post), P.Y(0) - P.s * 0.12, 2 * post * P.s, P.s * 0.24);
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(P.X(-post), P.Y(0) - P.s * 0.06, 2 * post * P.s, P.s * 0.12);
  for (const x of [-post, post]) {
    ctx.beginPath();
    ctx.arc(P.X(x), P.Y(0), Math.max(3, P.s * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = '#c9ced8';
    ctx.fill();
  }
}

/** The players and the ball from above: a disc in the kit's colour for each, their name beneath. */
function drawTopDown(ctx: CanvasRenderingContext2D, P: TopProjector, m: CourtMotion, props: CourtProps, now: number): void {
  const ball = m.flight !== null ? flightAt(m.flight, now) : null;
  // Where the ball will come down, while it is on its way.
  if (m.flight !== null && m.flight.to.z < 1.3) {
    const t = Math.min(1, (now - m.flight.t0) / Math.max(1, m.flight.ms));
    if (t < 1) {
      ctx.beginPath();
      ctx.arc(P.X(m.flight.to.x), P.Y(m.flight.to.y), P.s * (0.3 + 0.08 * Math.sin(now / 90)), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  const r = Math.max(7, P.s * 0.36);
  const { store, kits, teamOf } = props;
  // The coaches, at the front of their benches.
  m.coaches.forEach((c, t) => {
    ctx.beginPath();
    ctx.arc(P.X(c.x), P.Y(c.y), r * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = '#1b2130';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = kits[t].shirt;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.max(9, r * 0.9)}px Archivo, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', P.X(c.x), P.Y(c.y) + 0.5);
  });
  // The physio: white, with a red cross.
  if (m.medic !== null) {
    const md = m.medic;
    ctx.save();
    ctx.globalAlpha = md.alpha;
    ctx.beginPath();
    ctx.arc(P.X(md.x), P.Y(md.y), r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f6f8';
    ctx.fill();
    drawCross(ctx, P.X(md.x), P.Y(md.y), r * 0.5);
    ctx.restore();
  }
  for (const [p, b] of m.bodies) {
    const X = P.X(b.x);
    const Y = P.Y(b.y);
    const lift = 1 + Math.min(0.35, b.lift * 0.35);
    const kit = kits[teamOf(p)];
    const role = (props.roles ?? store.position)[p] as Position;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    // A shadow, wider as the player leaves the floor.
    ctx.beginPath();
    ctx.ellipse(X + 1.5, Y + 2.5, r * lift, r * lift * 0.9, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();
    if (m.actor === p) {
      ctx.beginPath();
      ctx.arc(X, Y, r * lift + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 199, 44, 0.35)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(X, Y, r * lift, 0, Math.PI * 2);
    ctx.fillStyle = role === Position.Libero ? kit.libero : kit.shirt;
    ctx.fill();
    ctx.lineWidth = m.actor === p ? 3 : 2;
    ctx.strokeStyle = m.actor === p ? '#ffc72c' : 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    // Down hurt, or hobbling off: a red cross over him.
    if ((b.hurt ?? 0) > 0.2 || b.limp === true) {
      ctx.beginPath();
      ctx.arc(X + r * 0.75, Y - r * 0.75, r * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      drawCross(ctx, X + r * 0.75, Y - r * 0.75, r * 0.32);
    }
    ctx.restore();

    if (props.labels === 'off' || b.side !== null) continue;
    const name = store.shortName(p).split(' ').pop() ?? '';
    const rating = props.ratings.get(p);
    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.font = `700 ${Math.max(10, Math.min(13, P.s * 0.42))}px Archivo, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ty = Y + r * lift + 3;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 14, 24, 0.85)';
    ctx.strokeText(name, X, ty);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, X, ty);
    if (props.labels === 'ratings' && rating !== undefined) {
      const text = rating.toFixed(1);
      const tw = ctx.measureText(text).width + 8;
      const by = ty + 15;
      roundRect(ctx, X - tw / 2, by, tw, 15, 4);
      ctx.fillStyle = ratingColour(rating);
      ctx.fill();
      ctx.fillStyle = '#0b111b';
      ctx.fillText(text, X, by + 2);
    }
    ctx.restore();
  }

  if (ball !== null) {
    // Its shadow on the floor, and the ball itself lifted by how high it is.
    ctx.beginPath();
    ctx.ellipse(P.X(ball.x), P.Y(ball.y), Math.max(3, P.s * 0.14), Math.max(2, P.s * 0.1), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0.12, 0.45 - ball.z * 0.06)})`;
    ctx.fill();
    const lift = ball.z * P.s * 0.28;
    m.trail.forEach((t, i) => {
      ctx.beginPath();
      ctx.arc(P.X(t.x), P.Y(t.y) - t.z * P.s * 0.28, Math.max(1.5, P.s * 0.08) * (0.4 + (i / m.trail.length) * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.06 + (i / m.trail.length) * 0.2})`;
      ctx.fill();
    });
    const br = Math.max(4.5, P.s * (0.17 + ball.z * 0.012));
    ctx.beginPath();
    ctx.arc(P.X(ball.x), P.Y(ball.y) - lift, br, 0, Math.PI * 2);
    ctx.fillStyle = '#fbf8ec';
    ctx.fill();
    ctx.lineWidth = Math.max(1, br * 0.3);
    ctx.strokeStyle = 'rgba(59, 99, 214, 0.8)';
    ctx.beginPath();
    ctx.arc(P.X(ball.x), P.Y(ball.y) - lift, br * 0.6, -0.4, 1.4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 199, 44, 0.9)';
    ctx.beginPath();
    ctx.arc(P.X(ball.x), P.Y(ball.y) - lift, br * 0.6, 2.4, 4.1);
    ctx.stroke();
  }
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
  const role = (props.roles ?? props.store.position)[p] as Position;
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

/** A coach: a polo in his team's colours, dark trousers, no number. */
function coachLook(kit: Kit): Look {
  return {
    kit: { shirt: kit.shirt, shorts: '#1b2130', libero: kit.shirt },
    libero: false, trim: '#1b2130', number: 0, skin: '#d9a97c', hair: '#3a2a1c', hairStyle: 1, trousers: true,
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
    // Nothing over those off the court.
    if (b.side !== null) continue;
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
  ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, project: Projector, kits: [Kit, Kit], crowd: boolean,
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
  // The rows of the stand, each step catching a little light.
  for (let row = 0; row <= rows; row++) {
    const x = BOARD_X - 0.5 - row * 0.8;
    const z = 1.05 + row * 0.6 + 0.37;
    segment(ctx, project, [x, -34, z], [x, 34, z], 'rgba(120, 140, 170, 0.10)', 1);
  }
  const rand = seeded(20260728);
  const crowdColours = ['#c9ced6', '#3b4658', '#7d8796', '#e7e2d6', '#2a3342', '#9aa3b0'];
  for (let row = 0; row < (crowd ? rows : 0); row++) {
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

  // ---- The warm-up areas: a white square in each far corner ----
  for (const side of [-1, 1]) {
    const w = SIDELINE.warmup;
    polygon(ctx, project, [[w.x0, side * w.y0, 0], [w.x0, side * w.y1, 0], [w.x1, side * w.y1, 0], [w.x1, side * w.y0, 0]]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
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

/** A red cross, centred at (x, y), `h` from the middle to each arm's end. */
function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  const w = h * 0.38;
  ctx.fillStyle = '#e5484d';
  ctx.fillRect(x - w, y - h, w * 2, h * 2);
  ctx.fillRect(x - h, y - w, h * 2, w * 2);
}

/** The referee's call over their head while they make it — whose point,
 *  whose serve, whose time-out, in that side's colours — and the whistle
 *  as it blows. */
function drawCall(
  ctx: CanvasRenderingContext2D, m: CourtMotion, props: CourtProps, at: { X: number; Y: number; s: number }, now: number,
): void {
  const sig = m.signal;
  if (sig === null) return;
  const fade = Math.min(1, (now - sig.t0) / 150, (sig.end - now) / 250);
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  if (now >= sig.whistle[0] && now <= sig.whistle[1]) {
    // Blasts off the whistle, beside the mouth.
    const r = Math.max(3, 0.1 * at.s);
    const mouth = at.Y + 0.2 * at.s;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(at.X + r * 0.6, mouth, r * (0.5 + 0.55 * i), -0.65, 0.65);
      ctx.stroke();
    }
  }
  const name = props.teamNames[sig.team];
  const text = sig.kind === 'point' ? `${sig.out ? 'OUT · ' : ''}POINT ${name}`
    : sig.kind === 'timeout' ? `TIME-OUT ${name}` : `SERVE ${name}`;
  ctx.font = '800 10px "Segoe UI", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  const h = 16;
  const x0 = at.X - w / 2;
  const y0 = at.Y - h - 6;
  roundRect(ctx, x0, y0, w, h, 4);
  ctx.fillStyle = props.kits[sig.team].shirt;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + 6, y0 + h / 2 + 0.5);
  ctx.restore();
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
  const role = (props.roles ?? store.position)[p] as Position;
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
    ctx.fillStyle = rating >= RATING_BANDS.star || rating < RATING_BANDS.poor ? '#ffffff' : '#0b0e13';
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
