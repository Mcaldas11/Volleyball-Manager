/**
 * A page for watching the players move, slowed down: the live court (court3d.ts) playing rallies
 * from a generated match through the same motion as a match (courtMotion.ts), at a quarter, half
 * or full speed, paused or stepped a frame at a time, from any of the 3D cameras, in the men's or
 * the women's game. Served by the dev server at /rally.html — it is not part of the game's build.
 */

import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { PlayerFlag } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { stubManager } from '../engine/world/world.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { DEFAULT_LOOK, figureLook } from './coachLook.ts';
import { Court3D, type Kit, type Look } from './court3d.ts';
import type { CameraMode } from './courtCameras.ts';
import { CourtMotion } from './courtMotion.ts';
import { setUiGame } from './gameGender.ts';
import { rallyBeats, setupScene, type Scene } from './matchCourt.ts';

const query = new URLSearchParams(location.search);
const women = query.get('game') === 'women';
setUiGame(women ? 'women' : 'men');
let speed = Number(query.get('speed') ?? 0.25);
let camera = (query.get('camera') ?? 'courtside') as CameraMode;

const world = generateWorld({ seed: 11, startYear: 2026, scale: 'small', manager: stubManager() });
const sim = new MatchSimulator(world.players, {
  home: toTeamSetup(world.players, world.clubs[0]),
  away: toTeamSetup(world.players, world.clubs[1]),
  format: MatchFormat.BestOf5,
  importance: 0.5,
  neutralVenue: false,
  collectLog: true,
  seed: 77,
});
const store = world.players;
const home = new Set(world.clubs[0].players);
const teamOf = (p: number): 0 | 1 => (home.has(p) ? 0 : 1);

const KITS: [Kit, Kit] = [
  { shirt: '#1f50b8', shorts: '#1f50b8', libero: '#f2c14e' },
  { shirt: '#c8102e', shorts: '#14213d', libero: '#f2f2f2' },
];
/** Each role's colour across the shoulders, as the match has them. */
const TRIM: Partial<Record<Position, string>> = {
  [Position.Setter]: '#ffc72c', [Position.Opposite]: '#ff6b6b', [Position.OutsideHitter]: '#8fc2ff',
  [Position.MiddleBlocker]: '#c7a6ff', [Position.Libero]: '#0b0e13',
};
const SKIN = ['#f3d4b8', '#eac29d', '#dcaa80', '#c18a60', '#99653f', '#6e472c'];
const HAIR = ['#2b1d14', '#4a3222', '#1a1410', '#7a5a36', '#b08a4e'];
const looks = new Map<number, Look>();
function lookOf(p: number): Look {
  let l = looks.get(p);
  if (l === undefined) {
    const role = store.position[p] as Position;
    l = {
      kit: KITS[teamOf(p)], libero: role === Position.Libero, trim: TRIM[role] ?? '#ffffff', number: 1 + (p % 19),
      skin: SKIN[p % SKIN.length], hair: HAIR[(p >> 1) % HAIR.length], hairStyle: p % 3,
    };
    looks.set(p, l);
  }
  return l;
}
const coaches: [Look, Look] = [
  figureLook({ ...DEFAULT_LOOK, outfit: 'suit', tie: '#9b1f2e' }, KITS[0], women),
  figureLook({ ...DEFAULT_LOOK, outfit: 'tracksuit' }, KITS[1], women),
];

const motion = new CourtMotion((p) => ({ height: store.heightCm[p] / 100, hand: store.hasFlag(p, PlayerFlag.LeftHanded) ? -1 : 1 }), teamOf);
const queue: Array<[Scene, number]> = [];
let rally = 0;
/** The next rally's scenes: the line-up for the serve, then each beat of it. */
function nextRally(): void {
  const pre = sim.snapshot();
  queue.push([setupScene(pre, pre.serving, store.position, 0), 900]);
  const entry = sim.step();
  if (entry === null) return;
  rally++;
  for (const beat of rallyBeats(pre, entry.serveTeam, entry.contacts, store.position, rally, 0, entry.winner)) queue.push([beat, beat.ms]);
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const court = new Court3D(canvas);
court.setCamera(camera);
court.setCrowd(KITS, 0.8);
court.setBenches(KITS, [-1, 1]);
const resize = (): void => court.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', resize);
resize();

const FRAME = 1000 / 60;
let now = 0;
let sceneEnd = 0;
let owed = 0;
let paused = false;
let last = performance.now();

/** One whole 1/60 s frame of the match, as the court steps it. */
function advance(): void {
  now += FRAME;
  if (now >= sceneEnd) {
    if (queue.length === 0) nextRally();
    const next = queue.shift();
    if (next !== undefined) {
      motion.scene(next[0], now);
      sceneEnd = now + next[1];
    }
  }
  motion.step(FRAME / 1000, now);
}

const stats = document.getElementById('stats')!;
function frame(t: number): void {
  if (!paused) owed += Math.min(50, t - last) * speed;
  last = t;
  while (owed >= FRAME) {
    owed -= FRAME;
    advance();
  }
  court.render(motion, now, FRAME / 1000, lookOf, (side) => coaches[side]);
  stats.textContent = `Rally ${rally} · ${(now / 1000).toFixed(1)} s of play · ${paused ? 'paused' : `${speed}×`}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- The controls ----

function press(group: string, attr: string, value: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button[${attr}]`)) {
    b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
  }
}
const pauseButton = document.querySelector<HTMLButtonElement>('[data-pause]')!;
function setPaused(on: boolean): void {
  paused = on;
  pauseButton.setAttribute('aria-pressed', String(on));
  pauseButton.textContent = on ? 'Play' : 'Pause';
}
press('speed', 'data-speed', String(speed));
press('camera', 'data-camera', camera);
press('game', 'data-game', women ? 'women' : 'men');

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    press('speed', 'data-speed', String(speed));
    setPaused(false);
  });
}
pauseButton.addEventListener('click', () => setPaused(!paused));
document.querySelector<HTMLButtonElement>('[data-step]')!.addEventListener('click', () => {
  setPaused(true);
  advance();
});
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
  b.addEventListener('click', () => {
    camera = b.dataset.camera as CameraMode;
    court.setCamera(camera);
    press('camera', 'data-camera', camera);
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-game]')) {
  b.addEventListener('click', () => {
    const q = new URLSearchParams(location.search);
    q.set('game', b.dataset.game!);
    q.set('camera', camera);
    q.set('speed', String(speed));
    location.search = q.toString();
  });
}
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.key === 'ArrowRight') {
    setPaused(true);
    advance();
  }
});
