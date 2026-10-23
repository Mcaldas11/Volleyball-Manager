/**
 * The cameras the live court can be watched through, as a broadcaster has them — and the cameraman
 * behind them, aiming the lens every frame.
 *
 * Broadcast: the main television camera, high in the side stand (courtCamera.ts); the painted hall
 * lines up with it to the pixel. Dynamic: closer and lower on the same side, panning with the ball.
 * Professional: a director's cut — from behind the server as he waits and serves, the rally from the
 * side, tight on the point as it is won, wide again between points. Sky: straight down from the roof,
 * the whole court. Behind: high in the end stand behind your own end line. Courtside: down by the
 * court at a player's eye level, following the play.
 */

import { PerspectiveCamera } from 'three';
import { fitCamera, fitView, type CameraFit, type V3 } from './courtCamera.ts';
import type { CourtMotion } from './courtMotion.ts';

export type CameraMode = 'broadcast' | 'dynamic' | 'professional' | 'sky' | 'behind' | 'courtside';

export const CAMERA_MODES: ReadonlyArray<{ mode: CameraMode; name: string; hint: string }> = [
  { mode: 'broadcast', name: 'Broadcast', hint: 'The main TV camera' },
  { mode: 'dynamic', name: 'Dynamic', hint: 'Closer, following the ball' },
  { mode: 'professional', name: 'Professional', hint: 'A TV director cutting shots' },
  { mode: 'sky', name: 'Sky', hint: 'From the roof' },
  { mode: 'behind', name: 'Behind', hint: 'Behind your end line' },
  { mode: 'courtside', name: 'Courtside', hint: 'Down by the court' },
];

export function isCameraMode(v: unknown): v is CameraMode {
  return CAMERA_MODES.some((c) => c.mode === v);
}

/** Point a camera as a fit says, for a `width` × `height` box: the line of sight through (cx, cy). */
export function lens(camera: PerspectiveCamera, fit: CameraFit, width: number, height: number): void {
  camera.fov = (2 * Math.atan(height / 2 / fit.focal) * 180) / Math.PI;
  camera.aspect = width / height;
  camera.near = 0.5;
  camera.far = 150;
  camera.up.set(0, 0, 1);
  camera.position.set(fit.position.x, fit.position.y, fit.position.z);
  camera.lookAt(fit.target.x, fit.target.y, fit.target.z);
  camera.setViewOffset(width, height, width / 2 - fit.cx, height / 2 - fit.cy, width, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

type P3 = readonly [number, number, number];

/** From the roof: a touch off the vertical, so the far stand is at the top as on television. */
const SKY: { position: V3; target: V3; probes: readonly P3[] } = {
  position: { x: 2.2, y: 0, z: 34 },
  target: { x: 0, y: 0, z: 0 },
  probes: [[-6.6, -11.4, 0], [6.6, -11.4, 0], [-6.6, 11.4, 0], [6.6, 11.4, 0]],
};

/** High in the end stand behind the near team — the manager's own side. */
const BEHIND: { position: V3; target: V3; probes: readonly P3[] } = {
  position: { x: 0, y: -21, z: 10.5 },
  target: { x: 0, y: 1, z: 0.4 },
  probes: [
    [-4.6, -9.9, 0], [4.6, -9.9, 0], [-4.6, 9.9, 0], [4.6, 9.9, 0], [-4.6, 9.9, 2.8], [4.6, 9.9, 2.8],
    [0, -10.8, 0], [-5.4, 0, 3.4], [5.4, 0, 3.4],
  ],
};

/** A moving shot: where the camera stands, what it looks at, and how wide it takes in across, degrees. */
interface Shot {
  position: V3;
  target: V3;
  hfov: number;
}

/** The director's takes. */
type Take = 'wide' | 'serve' | 'rally' | 'point';

/** How long the director stays tight on a point won, ms. */
const POINT_TAKE = 2600;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class Cameraman {
  private mode: CameraMode = 'broadcast';
  /** The box and still shot the lens was last set for — a still camera isn't re-aimed every frame. */
  private still = '';
  /** Where the camera is following, eased. */
  private readonly focus: V3 = { x: 0, y: 0, z: 1 };
  /** Jump straight to the next focus rather than easing to it: a cut. */
  private snap = true;
  private take: Take = 'wide';
  private takeSince = 0;
  /** Which end is serving (-1 the near), and from where across. */
  private servingEnd = -1;
  private serverX = 0;
  /** Where the point was won, for the close-up on it. */
  private pointAt: V3 = { x: 0, y: 0, z: 0 };
  /** The last moment the ball was in play. */
  private lastPlay = -Infinity;

  get current(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.still = '';
    this.snap = true;
  }

  /** The lens was set by someone else: aim it afresh next frame. */
  invalidate(): void {
    this.still = '';
  }

  /** Aim the lens for this frame of the match. */
  aim(camera: PerspectiveCamera, motion: CourtMotion, now: number, dt: number, width: number, height: number): void {
    switch (this.mode) {
      case 'broadcast':
        return this.fixed(camera, 'broadcast', width, height, () => fitCamera(width, height));
      case 'sky':
        return this.fixed(camera, 'sky', width, height,
          () => fitView(width, height, SKY.position, SKY.target, SKY.probes, 0.04, 'centre'));
      case 'behind':
        return this.fixed(camera, 'behind', width, height,
          () => fitView(width, height, BEHIND.position, BEHIND.target, BEHIND.probes, 0.04, 'centre'));
      case 'dynamic':
        return this.moving(camera, this.dynamicShot(motion, now, dt), width, height);
      case 'courtside':
        return this.moving(camera, this.courtsideShot(motion, now, dt), width, height);
      case 'professional':
        return this.direct(camera, motion, now, dt, width, height);
    }
  }

  private fixed(camera: PerspectiveCamera, key: string, width: number, height: number, fit: () => CameraFit): void {
    const k = `${key}:${width}x${height}`;
    if (k === this.still) return;
    this.still = k;
    lens(camera, fit(), width, height);
  }

  private moving(camera: PerspectiveCamera, shot: Shot, width: number, height: number): void {
    this.still = '';
    camera.clearViewOffset();
    camera.aspect = width / height;
    const vfov = 2 * Math.atan(Math.tan((shot.hfov * Math.PI) / 360) / camera.aspect);
    camera.fov = Math.min(80, (vfov * 180) / Math.PI);
    camera.near = 0.3;
    camera.far = 160;
    camera.up.set(0, 0, 1);
    camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    camera.lookAt(shot.target.x, shot.target.y, shot.target.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** Where the play is: the ball in the air, or whoever is about to play it. */
  private play(motion: CourtMotion, now: number): V3 {
    const ball = motion.ballAt(now);
    if (ball !== null) return { x: ball.x, y: ball.y, z: ball.z };
    const actor = motion.actor !== null ? motion.bodies.get(motion.actor) : undefined;
    if (actor !== undefined) return { x: actor.x, y: actor.y, z: 1.2 };
    return { x: 0, y: 0, z: 1 };
  }

  /** Ease the focus towards the play — `rate` the higher, the quicker it catches up; never more than
   *  `reach` along the court from the net, so the net stays in shot. */
  private follow(goal: V3, dt: number, rate: number, reach: number): V3 {
    const g = { x: clamp(goal.x, -5, 5), y: clamp(goal.y, -reach, reach), z: clamp(goal.z, 0, 6) };
    const f = this.focus;
    if (this.snap) {
      f.x = g.x;
      f.y = g.y;
      f.z = g.z;
      this.snap = false;
      return f;
    }
    const k = 1 - Math.exp(-dt * rate);
    f.x += (g.x - f.x) * k;
    f.y += (g.y - f.y) * k;
    // Up and down quicker: a ball tossed or set high mustn't leave the top of the picture.
    f.z += (g.z - f.z) * (1 - Math.exp(-dt * rate * 2));
    return f;
  }

  private dynamicShot(motion: CourtMotion, now: number, dt: number): Shot {
    const f = this.follow(this.play(motion, now), dt, 2.4, 5.5);
    return {
      position: { x: 12.5, y: f.y * 0.8 - 1.2, z: 7.6 },
      target: { x: f.x * 0.35 - 0.8, y: f.y, z: 0.9 + Math.min(1.4, f.z * 0.25) },
      hfov: 54,
    };
  }

  private courtsideShot(motion: CourtMotion, now: number, dt: number): Shot {
    // Sliding along the side of the court, turning and tilting after the ball wherever it goes.
    const f = this.follow(this.play(motion, now), dt, 2.6, 9.5);
    return {
      position: { x: 7.1, y: clamp(f.y * 0.7, -6.5, 6.5) - 1.5, z: 1.9 },
      target: { x: f.x * 0.3 - 1.0, y: f.y, z: 0.6 + 0.62 * f.z },
      hfov: 74,
    };
  }

  /** The director: which take the play calls for, cut to when it changes. */
  private direct(camera: PerspectiveCamera, motion: CourtMotion, now: number, dt: number, width: number, height: number): void {
    const next = this.nextTake(motion, now);
    if (next !== this.take) {
      this.take = next;
      this.takeSince = now;
      this.snap = true;
      this.still = '';
      if (next === 'point') this.pointAt = this.play(motion, now);
    }
    switch (this.take) {
      case 'wide':
        return this.fixed(camera, 'wide', width, height, () => fitCamera(width, height));
      case 'rally':
        return this.moving(camera, this.dynamicShot(motion, now, dt), width, height);
      case 'serve': {
        // From the end stand behind the server: him in the foreground, the court beyond.
        const s = this.servingEnd;
        return this.moving(camera, {
          position: { x: this.serverX * 0.3, y: s * 17.5, z: 6.5 },
          target: { x: 0, y: s * 4, z: 0.5 },
          hfov: 58,
        }, width, height);
      }
      case 'point': {
        // Tight on where it was won, pushing in slowly.
        const p = this.pointAt;
        const t = clamp((now - this.takeSince) / POINT_TAKE, 0, 1);
        return this.moving(camera, {
          position: { x: 9.5, y: clamp(p.y, -9, 9) * 0.9 - 0.8, z: 3.6 },
          target: { x: clamp(p.x, -5, 5) * 0.5, y: clamp(p.y, -9, 9), z: 1.0 },
          hfov: 34 - 6 * t,
        }, width, height);
      }
    }
  }

  private nextTake(motion: CourtMotion, now: number): Take {
    // A point just won: tight on it for a moment.
    const cheer = motion.cheer;
    if (cheer !== null && now >= cheer.t0 && now - cheer.t0 < POINT_TAKE) return 'point';
    // The ball in the server's hands: behind him.
    for (const b of motion.bodies.values()) {
      if (b.pose !== 'hold') continue;
      this.servingEnd = b.y < 0 ? -1 : 1;
      this.serverX = b.x;
      return 'serve';
    }
    const ball = motion.ballAt(now);
    const actor = motion.actor !== null ? motion.bodies.get(motion.actor) : undefined;
    // The serve on its way: still from behind him, until it crosses the net.
    if (actor !== undefined && (actor.pose === 'serve' || actor.pose === 'float') && ball !== null
      && Math.sign(ball.y) === this.servingEnd) return 'serve';
    if (ball !== null && motion.flight !== null && now < motion.flight.t0 + motion.flight.ms + 400) {
      this.lastPlay = now;
      return 'rally';
    }
    // Between points: hold the rally a moment, then wide.
    return this.take === 'rally' && now - this.lastPlay < 1200 ? 'rally' : 'wide';
  }
}
