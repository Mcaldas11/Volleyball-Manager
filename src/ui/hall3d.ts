/**
 * The hall in 3D, for the cameras that look from anywhere but the broadcast position (see
 * courtCameras.ts): the floor — free zone, court, lines, the warm-up squares — the advertising
 * boards round it, and stands on all four sides, the ones the broadcast never shows full of people
 * too. The broadcast camera keeps the hall LiveCourt paints once per size, which lines up with it
 * to the pixel; this is the same hall, for any other lens.
 */

import {
  BoxGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PlaneGeometry, SRGBColorSpace, type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SIDELINE } from './courtMotion.ts';
import { Crowd, FRONT_X, FRONT_Z, ROW_DEPTH, ROW_RISE, ROWS, type StandLayout } from './crowd3d.ts';
import type { Kit } from './figure3d.ts';
import { COURT_HALF_LENGTH, COURT_HALF_WIDTH } from './matchCourt.ts';

/** The hall's colours: an FIVB court — orange inside, blue free zone. */
export const FLOOR = {
  arena: '#1d2a3c',
  freeZone: '#1f5c9f',
  court: '#d8773f',
  frontZone: '#df8550',
  line: 'rgba(255, 255, 255, 0.92)',
};

/** Where the far side's advertising boards stand, how tall they are, and where the end ones run. */
export const BOARD_X = -7.3;
export const BOARD_HEIGHT = 0.9;
export const END_BOARD_Y = 12.4;
export const BOARD_TEXT = 'VM  ·  VOLLEYBALL MANAGER';

/** The floor inside the boards, and its texture's pixels a metre. */
const HALL_X = -BOARD_X;
const HALL_Y = END_BOARD_Y;
const PPM = 90;

function floorTexture(anisotropy: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.round(2 * HALL_X * PPM);
  c.height = Math.round(2 * HALL_Y * PPM);
  const ctx = c.getContext('2d')!;
  const X = (x: number): number => (x + HALL_X) * PPM;
  const Y = (y: number): number => (HALL_Y - y) * PPM;
  const rect = (x0: number, y0: number, x1: number, y1: number, fill: string | CanvasGradient): void => {
    ctx.fillStyle = fill;
    ctx.fillRect(X(Math.min(x0, x1)), Y(Math.max(y0, y1)), Math.abs(x1 - x0) * PPM, Math.abs(y1 - y0) * PPM);
  };
  const W = COURT_HALF_WIDTH;
  const L = COURT_HALF_LENGTH;
  rect(-HALL_X, -HALL_Y, HALL_X, HALL_Y, FLOOR.arena);
  rect(-6.6, -11.4, 6.6, 11.4, FLOOR.freeZone);
  rect(-W, -L, W, L, FLOOR.court);
  rect(-W, -3, W, 3, FLOOR.frontZone);
  // The lights over the court, caught in the polish.
  const sheen = ctx.createRadialGradient(X(0), Y(0), 0, X(0), Y(0), 12 * PPM);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  rect(-6.6, -11.4, 6.6, 11.4, sheen);
  // The lines, 5 cm wide and part of the court they bound.
  const line = 0.05;
  rect(-W, L - line, W, L, FLOOR.line);
  rect(-W, -L, W, -L + line, FLOOR.line);
  rect(-W, -L, -W + line, L, FLOOR.line);
  rect(W - line, -L, W, L, FLOOR.line);
  rect(-W, -line / 2, W, line / 2, FLOOR.line);
  for (const y of [-3, 3]) {
    rect(-W, y - line / 2, W, y + line / 2, FLOOR.line);
    // The attack line's dashes, out into the free zone either side.
    for (let k = 0; k < 5; k++) {
      const x0 = W + 0.15 + k * 0.35;
      rect(x0, y - line / 2, x0 + 0.15, y + line / 2, 'rgba(255, 255, 255, 0.7)');
      rect(-x0, y - line / 2, -x0 - 0.15, y + line / 2, 'rgba(255, 255, 255, 0.7)');
    }
  }
  // The warm-up areas: a white square in each far corner.
  for (const side of [-1, 1]) {
    const w = SIDELINE.warmup;
    const [y0, y1] = [side * w.y0, side * w.y1];
    rect(w.x0, y0, w.x1, y1, 'rgba(255, 255, 255, 0.08)');
    rect(w.x0, y0, w.x1, y0 + side * line, 'rgba(255, 255, 255, 0.9)');
    rect(w.x0, y1 - side * line, w.x1, y1, 'rgba(255, 255, 255, 0.9)');
    rect(w.x0, y0, w.x0 + line, y1, 'rgba(255, 255, 255, 0.9)');
    rect(w.x1 - line, y0, w.x1, y1, 'rgba(255, 255, 255, 0.9)');
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/** A board's face: panels a little over four metres long, alternately shaded, lettered in gold. */
function boardTexture(length: number): CanvasTexture {
  const panels = Math.max(1, Math.round(length / 4.2));
  const pw = 420;
  const ph = 90;
  const c = document.createElement('canvas');
  c.width = panels * pw;
  c.height = ph;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < panels; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#0f1c30' : '#132440';
    ctx.fillRect(i * pw, 0, pw, ph);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(i * pw + 1, 1, pw - 2, ph - 2);
    ctx.fillStyle = '#e0ad44';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // As big as fits the panel, with a margin either side.
    ctx.font = '800 40px "Segoe UI", system-ui, sans-serif';
    const size = Math.min(40, (40 * pw * 0.86) / ctx.measureText(BOARD_TEXT).width);
    ctx.font = `800 ${size.toFixed(1)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(BOARD_TEXT, i * pw + pw / 2, ph / 2 + 2);
  }
  ctx.fillStyle = 'rgba(255, 214, 120, 0.55)';
  ctx.fillRect(0, 0, c.width, 3);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A board `length` long centred at (x, y), its face towards `facing` (a unit vector on the floor). */
function board(x: number, y: number, length: number, facing: [number, number]): Group {
  const g = new Group();
  const turn = Math.atan2(facing[1], facing[0]) + Math.PI / 2;
  const back = new Mesh(
    new BoxGeometry(length, 0.12, BOARD_HEIGHT).rotateZ(turn),
    new MeshLambertMaterial({ color: '#0b1524' }),
  );
  back.position.set(x, y, BOARD_HEIGHT / 2);
  const face = new Mesh(
    new PlaneGeometry(length, BOARD_HEIGHT).rotateX(Math.PI / 2).rotateZ(turn),
    new MeshBasicMaterial({ map: boardTexture(length), toneMapped: false }),
  );
  face.position.set(x + facing[0] * 0.062, y + facing[1] * 0.062, BOARD_HEIGHT / 2);
  g.add(back, face);
  return g;
}

/** A stand's concrete: a step under each row of seats, dark at the back, and a wall behind the last. */
function standSteps(rows: number, span: number): Mesh {
  const parts: BufferGeometry[] = [];
  const colour = new Color();
  const paint = (geo: BufferGeometry, hex: string, k: number): BufferGeometry => {
    colour.set(hex).multiplyScalar(k);
    const n = geo.getAttribute('position').count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([colour.r, colour.g, colour.b], i * 3);
    geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
    return geo;
  };
  const length = 2 * span + 0.6;
  for (let r = 0; r < rows; r++) {
    const top = FRONT_Z + r * ROW_RISE;
    const step = new BoxGeometry(ROW_DEPTH, length, top).translate(FRONT_X - r * ROW_DEPTH, 0, top / 2);
    parts.push(paint(step, '#1c2738', 1 - (0.45 * r) / rows));
  }
  const height = FRONT_Z + rows * ROW_RISE + 3;
  const wall = new BoxGeometry(0.3, length, height).translate(FRONT_X - (rows - 0.5) * ROW_DEPTH - 0.15, 0, height / 2);
  parts.push(paint(wall, '#0a0f16', 1));
  return new Mesh(mergeGeometries(parts), new MeshLambertMaterial({ vertexColors: true }));
}

/** A stand and its people, built where the far one is and turned into place. */
function stand(fill: number, layout: StandLayout, turn: number, shiftY: number, crowds: Crowd[]): Group {
  const g = new Group();
  g.add(standSteps(layout.rows, layout.span));
  const crowd = new Crowd(fill, layout);
  g.add(crowd.group);
  crowds.push(crowd);
  g.rotation.z = turn;
  g.position.y = shiftY;
  return g;
}

export interface Hall {
  group: Group;
  /** The people in the stands the broadcast doesn't show — to dress, and to get on their feet. */
  crowds: Crowd[];
}

/** Build the hall, its stands `fill` full; `anisotropy` how sharp the floor stays at a glancing angle. */
export function buildHall(fill: number, anisotropy: number): Hall {
  const group = new Group();
  const crowds: Crowd[] = [];
  // Beyond the boards: the hall's floor under the stands, in the dark.
  const ground = new Mesh(new PlaneGeometry(90, 90), new MeshBasicMaterial({ color: '#111823', toneMapped: false }));
  ground.position.z = -0.01;
  const floor = new Mesh(
    new PlaneGeometry(2 * HALL_X, 2 * HALL_Y),
    new MeshBasicMaterial({ map: floorTexture(anisotropy), toneMapped: false }),
  );
  floor.position.z = -0.004;
  group.add(ground, floor);
  group.add(
    board(BOARD_X, 0, 2 * END_BOARD_Y, [1, 0]),
    board(-BOARD_X, 0, 2 * END_BOARD_Y, [-1, 0]),
    board(0, -END_BOARD_Y, 2 * HALL_X, [0, 1]),
    board(0, END_BOARD_Y, 2 * HALL_X, [0, -1]),
  );
  // The far stand's people are the court's own (court3d.ts); here, the concrete under them.
  group.add(standSteps(ROWS, 31));
  // The near side, opposite it; and an end stand behind each end line — the away fans in the far one.
  group.add(stand(fill, { rows: ROWS, span: 31, seed: 4471, away: null }, Math.PI, 0, crowds));
  group.add(stand(fill, { rows: 14, span: 7.6, seed: 5521, away: [0, 7.6] }, -Math.PI / 2, 5, crowds));
  group.add(stand(fill, { rows: 14, span: 7.6, seed: 6631, away: null }, Math.PI / 2, -5, crowds));
  return { group, crowds };
}

/** Dress the hall's crowds in these kits, and move them on to `now` — `cheer` the last point won. */
export function liveHall(hall: Hall, kits: [Kit, Kit], cheer: Parameters<Crowd['react']>[0], now: number): void {
  for (const c of hall.crowds) {
    c.setKits(kits);
    c.react(cheer);
    c.update(now);
  }
}
