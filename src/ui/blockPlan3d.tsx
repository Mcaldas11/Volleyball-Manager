/**
 * The block plan: against the outside, the opposite and the pipe, where the
 * block sets up — reading the hitter, or shut on the line or the cross — and
 * how many go up. Drawn in 3D: their hitter running in and going up, ours
 * closing the block, the court the block takes away in red, what it leaves in
 * green, the defence behind it where the coach has it — and now and then what
 * goes wrong however good the plan: the middle late across, the block reading
 * the hitter the wrong way.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import {
  CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  NeutralToneMapping, PerspectiveCamera, PlaneGeometry, Scene, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { defenceLayoutsOf, type AttackSource, type DefenceLayout } from '../engine/match/defence.ts';
import {
  BLOCK_TARGETS, BlockFocus, BlockNumbers, blockPlansOf, defaultBlockPlans, type BlockPlan, type BlockTarget, type TeamTactics,
} from '../engine/match/tactics.ts';
import { APPROACH, BLOCK_PEAK, BLOCK_READY, COCKED, LOAD, STRIKE } from './courtMotion.ts';
import { Figure, type Kit, type Look } from './figure3d.ts';
import { Icon } from './icons.tsx';
import { buildRig, COVER, mixShape, READY, REF_HEIGHT, STILL, type Shape as Pose } from './playerRig.ts';

export const BLOCK_TARGET_NAMES: Readonly<Record<BlockTarget, string>> = { outside: 'Outside', opposite: 'Opposite', pipe: 'Pipe' };

/** The choices, in the words used for each attack: against the pipe there is no line, only the seam and the angle. */
function focusOptions(t: BlockTarget): Array<[BlockFocus, string, string]> {
  return t === 'pipe'
    ? [
      [BlockFocus.Read, 'Read the hitter', 'Go with the set and put hands on the ball. Safe — nothing taken away, nothing given.'],
      [BlockFocus.Line, 'Take the seam', 'Close straight down the middle: he has to cut it to the angles, where the defence waits.'],
      [BlockFocus.Cross, 'Take the angle', 'Shut his favourite angle and leave the seam to the middle back.'],
    ]
    : [
      [BlockFocus.Read, 'Read the hitter', 'Go with the set and put hands on the ball. Safe — nothing taken away, nothing given.'],
      [BlockFocus.Line, 'Take the line', 'Set the block on the sideline: he has to hit cross-court, into the diggers.'],
      [BlockFocus.Cross, 'Take the cross', 'Set the block inside, on the angle: the line is left to the back-row defender.'],
    ];
}

const NUMBER_OPTIONS: Array<[BlockNumbers, string, string]> = [
  [BlockNumbers.Single, 'One up', 'One blocker: the rest stay back for the tip and are free to attack off the dig.'],
  [BlockNumbers.Double, 'Two up', 'The pin blocker and the middle — the usual block.'],
  [BlockNumbers.Triple, 'Three up', 'All three front-row players on a big hitter: more stuff blocks, but the tip is open and the counter slower.'],
];

const FOCUS_SHORT: Readonly<Record<BlockFocus, string>> = { [BlockFocus.Read]: 'Read', [BlockFocus.Line]: 'Line', [BlockFocus.Cross]: 'Cross' };

/** A plan in a few words: "Line · 2 up". */
export function blockPlanLabel(p: BlockPlan, t: BlockTarget): string {
  const f = t === 'pipe' ? (p.focus === BlockFocus.Line ? 'Seam' : p.focus === BlockFocus.Cross ? 'Angle' : 'Read') : FOCUS_SHORT[p.focus];
  return `${f} · ${p.numbers} up`;
}

/** All three plans in one line, for a tactics card. */
export function blockPlansSummary(t: TeamTactics): string {
  const plans = blockPlansOf(t);
  return BLOCK_TARGETS.map((k) => `${BLOCK_TARGET_NAMES[k].slice(0, 3)} ${blockPlanLabel(plans[k], k).replace(' up', '')}`).join(' · ');
}

// ---- The scene ----------------------------------------------------------------------------

/** What this loop of the animation shows: the plan working, the middle late, or the block reading it wrong. */
type Scenario = 'plan' | 'late' | 'misread';
const SCENARIOS: readonly Scenario[] = ['plan', 'plan', 'late', 'plan', 'misread'];
const SCENARIO_TEXT: Readonly<Record<Scenario, string>> = {
  plan: 'As planned',
  late: 'The middle is late across — a seam opens in the block',
  misread: 'The block reads him wrong and shuts the other shot',
};

const SOURCE: Readonly<Record<BlockTarget, AttackSource>> = { outside: 'oh', opposite: 'opp', pipe: 'mb' };
const PERIOD = 3.4;
const NET_TOP = 2.43;
const HALF = 4.5;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const span = (p: number, a: number, b: number): number => smooth((p - a) / (b - a));

interface Spot2 { x: number; y: number }

/** Where everyone is for a plan, against an attack, in a scenario. Our side is y < 0, facing the net at y = 0. */
function stagingFor(target: BlockTarget, plan: BlockPlan, scenario: Scenario, layout: DefenceLayout): {
  hitter: { from: Spot2; jump: Spot2 };
  blockers: Array<{ from: Spot2; to: Spot2; late: boolean }>;
  free: Spot2[];
  back: Spot2[];
  shadow: [number, number];
  open: Array<{ to: Spot2; main: boolean }>;
} {
  const pipe = target === 'pipe';
  const xh = target === 'outside' ? 3.65 : target === 'opposite' ? -3.65 : 0;
  // Towards the antenna, from the hitter: +x for their outside (our right), -x for their opposite.
  const out = target === 'outside' ? 1 : target === 'opposite' ? -1 : 1;
  let focus = plan.focus;
  if (scenario === 'misread') focus = focus === BlockFocus.Line ? BlockFocus.Cross : focus === BlockFocus.Cross ? BlockFocus.Line : BlockFocus.Cross;
  const shift = pipe
    ? (focus === BlockFocus.Cross ? 0.55 : 0)
    : focus === BlockFocus.Line ? 0.38 : focus === BlockFocus.Cross ? -0.55 : -0.1;
  const centre = xh + out * shift;
  const n = plan.numbers;
  // Our front row: zone 4 on our left (-x), 3 in the middle, 2 on our right.
  const home = { left: -3, mid: 0, right: 3 };
  const pin = target === 'opposite' ? home.left : home.right;
  const far = target === 'opposite' ? home.right : home.left;
  const net = -0.42;
  const spots: Array<{ from: Spot2; to: Spot2; late: boolean }> = [];
  if (pipe) {
    spots.push({ from: { x: home.mid, y: net }, to: { x: centre, y: net }, late: false });
    if (n >= 2) spots.push({ from: { x: home.right, y: net }, to: { x: centre + 0.72, y: net }, late: scenario === 'late' });
    if (n >= 3) spots.push({ from: { x: home.left, y: net }, to: { x: centre - 0.72, y: net }, late: false });
  } else {
    if (n === 1) {
      spots.push({ from: { x: pin, y: net }, to: { x: centre, y: net }, late: false });
    } else {
      spots.push({ from: { x: pin, y: net }, to: { x: centre + out * 0.36, y: net }, late: false });
      spots.push({ from: { x: home.mid, y: net }, to: { x: centre - out * 0.36, y: net }, late: scenario === 'late' });
      if (n >= 3) spots.push({ from: { x: far, y: net }, to: { x: centre - out * 1.08, y: net }, late: false });
    }
  }
  // The front-row players who don't block, and the back three, where the coach has them.
  const at = (s: { u: number; v: number }): Spot2 => ({ x: (s.u - 0.5) * 9, y: -s.v * 9 });
  const free: Spot2[] = [];
  const frontLeft = [pin, home.mid, far].filter((x) => !spots.some((b) => b.from.x === x));
  if (frontLeft.length >= 1) free.push(at(layout.free));
  if (frontLeft.length >= 2) free.push(at({ u: 1 - layout.free.u, v: layout.free.v }));
  // The block's hands, edge to edge, and the court behind it they take away.
  const xs = spots.map((b) => (b.late ? b.from.x + (b.to.x - b.from.x) * 0.55 : b.to.x));
  const hands: [number, number] = [Math.min(...xs) - 0.32, Math.max(...xs) + 0.32];
  // What it leaves him: the shot the block isn't on.
  const lineTo = { x: xh - out * 0.5, y: -8.2 };
  const crossTo = { x: -out * 2.6, y: -6.4 };
  const open: Array<{ to: Spot2; main: boolean }> = pipe
    ? focus === BlockFocus.Line
      ? [{ to: { x: 3.2, y: -6.6 }, main: true }, { to: { x: -3.2, y: -6.6 }, main: true }]
      : focus === BlockFocus.Cross ? [{ to: { x: 0, y: -8 }, main: true }, { to: { x: -3.2, y: -6.6 }, main: false }]
        : [{ to: { x: 0, y: -8 }, main: false }, { to: { x: 3.2, y: -6.6 }, main: false }, { to: { x: -3.2, y: -6.6 }, main: false }]
    : focus === BlockFocus.Line ? [{ to: crossTo, main: true }]
      : focus === BlockFocus.Cross ? [{ to: lineTo, main: true }]
        : [{ to: lineTo, main: false }, { to: crossTo, main: false }];
  if (scenario === 'late') open.unshift({ to: { x: (hands[0] + hands[1]) / 2 + out * 0.2, y: -5 }, main: true });
  return {
    hitter: pipe ? { from: { x: xh + 0.4, y: 6.6 }, jump: { x: xh, y: 3.4 } } : { from: { x: xh + out * 0.9, y: 4.6 }, jump: { x: xh, y: 0.75 } },
    blockers: spots,
    free,
    back: [at(layout.lb), at(layout.mb), at(layout.rb)],
    shadow: hands,
    open,
  };
}

function look(kit: Kit, n: number, libero = false): Look {
  const skins = ['#e0b48e', '#c99a76', '#8d5a3c', '#f1c9a5', '#6b4430'];
  const hairs = ['#2b1d14', '#5a3a22', '#141010', '#8a6a3a'];
  return { kit, libero, trim: '#ffffff', number: n, skin: skins[n % skins.length], hair: hairs[n % hairs.length], hairStyle: n % 3 };
}

/** A flat polygon on the floor, just above it. */
function floorPoly(points: Spot2[], color: string, opacity: number): Mesh {
  const s = new Shape();
  points.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.y) : s.lineTo(p.x, p.y)));
  s.closePath();
  const m = new Mesh(new ShapeGeometry(s), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide }));
  m.position.z = 0.012;
  return m;
}

/** An arrow along the floor, from one spot to another. */
function floorArrow(from: Spot2, to: Spot2, color: string, opacity: number, width = 0.32): Mesh {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const head = Math.min(1.1, len * 0.3);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const w = width / 2;
  return floorPoly([
    { x: from.x + nx * w, y: from.y + ny * w }, { x: base.x + nx * w, y: base.y + ny * w }, { x: base.x + nx * w * 2.6, y: base.y + ny * w * 2.6 },
    to, { x: base.x - nx * w * 2.6, y: base.y - ny * w * 2.6 }, { x: base.x - nx * w, y: base.y - ny * w }, { x: from.x - nx * w, y: from.y - ny * w },
  ], color, opacity);
}

/** The court, the net and its antennas. */
function hall(): Group {
  const g = new Group();
  const plane = (w: number, h: number, color: string, x: number, y: number, z = 0): Mesh => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ color, roughness: 0.8 }));
    m.position.set(x, y, z);
    return m;
  };
  g.add(plane(40, 44, '#1d2a3c', 0, 0, -0.01));
  g.add(plane(9, 18, '#c76f36', 0, 0, 0));
  const line = (w: number, h: number, x: number, y: number): void => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: '#f4f1ea' }));
    m.position.set(x, y, 0.006);
    g.add(m);
  };
  line(0.05, 18.05, -HALF, 0);
  line(0.05, 18.05, HALF, 0);
  line(9.05, 0.05, 0, -9);
  line(9.05, 0.05, 0, 9);
  line(9.05, 0.05, 0, 0);
  line(9.05, 0.05, 0, -3);
  line(9.05, 0.05, 0, 3);
  // The net: mesh, the white tape along its top, the posts and the antennas.
  const net = new Mesh(new PlaneGeometry(9.6, 1.0), new MeshStandardMaterial({ color: '#0d1117', transparent: true, opacity: 0.42, side: DoubleSide }));
  net.rotation.x = Math.PI / 2;
  net.position.set(0, 0, NET_TOP - 0.5);
  g.add(net);
  const tape = new Mesh(new PlaneGeometry(9.6, 0.07), new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide }));
  tape.rotation.x = Math.PI / 2;
  tape.position.set(0, 0, NET_TOP - 0.035);
  g.add(tape);
  for (const x of [-5.1, 5.1]) {
    const post = new Mesh(new CylinderGeometry(0.05, 0.05, 2.55, 12), new MeshStandardMaterial({ color: '#b9c0cc', metalness: 0.4, roughness: 0.4 }));
    post.rotation.x = Math.PI / 2;
    post.position.set(x, 0, 1.275);
    g.add(post);
  }
  for (const x of [-HALF, HALF]) {
    for (let i = 0; i < 9; i++) {
      const seg = new Mesh(new CylinderGeometry(0.012, 0.012, 0.2, 8), new MeshBasicMaterial({ color: i % 2 === 0 ? '#e5484d' : '#ffffff' }));
      seg.rotation.x = Math.PI / 2;
      seg.position.set(x, 0, NET_TOP - 0.9 + i * 0.2);
      g.add(seg);
    }
  }
  return g;
}

function BlockScene({ target, plan, layout, ours, theirs, onScenario }: {
  target: BlockTarget;
  plan: BlockPlan;
  layout: DefenceLayout;
  ours: Kit;
  theirs: Kit;
  onScenario: (s: Scenario) => void;
}): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null);
  const live = useRef({ target, plan, layout });
  live.current = { target, plan, layout };
  const tell = useRef(onScenario);
  tell.current = onScenario;

  useEffect(() => {
    const box = wrap.current;
    if (box === null) return;
    // A canvas of its own each time: React's development mode runs every effect twice.
    const el = document.createElement('canvas');
    el.className = 'bp3-canvas';
    box.prepend(el);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: el, antialias: true, alpha: true });
    } catch {
      el.remove();
      return;
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new Scene();
    const sky = new HemisphereLight('#e8eeff', '#3a3028', 1.1);
    sky.position.set(0, 0, 1);
    const key = new DirectionalLight('#ffffff', 2.0);
    key.position.set(-4, -8, 12);
    const rim = new DirectionalLight('#cfe0ff', 0.9);
    rim.position.set(5, 10, 6);
    scene.add(sky, key, rim, hall());
    const marks = new Group();
    scene.add(marks);
    const ball = new Mesh(new SphereGeometry(0.11, 20, 14), new MeshStandardMaterial({ color: '#f5d94a', roughness: 0.5 }));
    scene.add(ball);
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    camera.up.set(0, 0, 1);

    const figures: Figure[] = [];
    const figure = (l: Look): Figure => {
      const f = new Figure(l);
      scene.add(f.root);
      figures.push(f);
      return f;
    };
    const hitter = figure(look(theirs, 7));
    const blockers = [figure(look(ours, 2)), figure(look(ours, 12)), figure(look(ours, 9))];
    const free = [figure(look(ours, 4)), figure(look(ours, 15))];
    const back = [figure(look(ours, 1, true)), figure(look(ours, 6)), figure(look(ours, 11))];

    let size: [number, number] = [1, 1];
    const resize = (): void => {
      const w = Math.max(1, box.clientWidth);
      const h = Math.max(1, box.clientHeight);
      renderer.setSize(w, h, false);
      size = [w, h];
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    // Turned by dragging, a little either way.
    let yaw = 0;
    let dragging: number | null = null;
    const down = (e: PointerEvent): void => { dragging = e.clientX; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent): void => {
      if (dragging === null) return;
      yaw = Math.max(-0.95, Math.min(0.95, yaw - (e.clientX - dragging) * 0.006));
      dragging = e.clientX;
    };
    const up = (): void => { dragging = null; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    const put = (f: Figure, p: Spot2, lift: number, facing: number, pose: Pose, height: number): void => {
      f.root.visible = true;
      f.pose({ x: p.x, y: p.y, lift, yaw: facing, scale: height / REF_HEIGHT, rig: buildRig(pose, STILL), alpha: 1 });
    };
    const lerp = (a: Spot2, b: Spot2, t: number): Spot2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

    let markKey = '';
    let loop = -1;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number): void => {
      const { target: tg, plan: pl, layout: ly } = live.current;
      const elapsed = (now - start) / 1000;
      const n = Math.floor(elapsed / PERIOD);
      const p = (elapsed / PERIOD) - n;
      // One up has no middle to be late.
      const drawn = SCENARIOS[n % SCENARIOS.length];
      const scenario: Scenario = drawn === 'late' && pl.numbers === BlockNumbers.Single ? 'plan' : drawn;
      if (n !== loop) {
        loop = n;
        tell.current(scenario);
      }
      const st = stagingFor(tg, pl, scenario, ly);

      // The floor markings, redrawn when the plan or what goes wrong changes.
      const k = `${tg}|${pl.focus}|${pl.numbers}|${scenario}|${JSON.stringify(ly)}`;
      if (k !== markKey) {
        markKey = k;
        for (const c of [...marks.children]) {
          marks.remove(c);
          const m = c as Mesh;
          m.geometry.dispose();
          (m.material as MeshBasicMaterial).dispose();
        }
        const xh = st.hitter.jump.x;
        const ye = tg === 'pipe' ? 6.5 : 3.6;
        const proj = (x: number): number => Math.max(-HALF, Math.min(HALF, xh + (x - xh) * ((ye + 9) / ye)));
        const [a, b] = st.shadow;
        marks.add(floorPoly([{ x: a, y: 0 }, { x: b, y: 0 }, { x: proj(b), y: -9 }, { x: proj(a), y: -9 }], '#e5484d', 0.3));
        const from = { x: xh, y: -0.6 };
        for (const o of st.open) marks.add(floorArrow(from, o.to, o.main ? '#3dbb5c' : '#e3c02b', o.main ? 0.85 : 0.6, o.main ? 0.36 : 0.26));
      }

      // Their hitter: the run-in, the jump, the swing.
      const run = span(p, 0.02, 0.38);
      const air = p > 0.38 && p < 0.72 ? Math.sin(Math.PI * (p - 0.38) / 0.34) : 0;
      const hp = lerp(st.hitter.from, st.hitter.jump, run);
      const hitterPose = p < 0.28 ? APPROACH : p < 0.38 ? mixShape(APPROACH, LOAD, span(p, 0.28, 0.38))
        : p < 0.54 ? COCKED : p < 0.72 ? mixShape(COCKED, STRIKE, span(p, 0.54, 0.6)) : READY;
      put(hitter, hp, air * 0.85, Math.PI, hitterPose, 1.98);

      // The block: across to their spots, then up together — the late one behind.
      blockers.forEach((f, i) => {
        const b = st.blockers[i];
        if (b === undefined) {
          f.root.visible = false;
          return;
        }
        const reach = b.late ? span(p, 0.05, 0.62) * 0.75 : span(p, 0.05, 0.36);
        const at = lerp(b.from, b.to, reach);
        const t0 = b.late ? 0.56 : 0.44;
        const lift = p > t0 && p < t0 + 0.3 ? Math.sin(Math.PI * (p - t0) / 0.3) * (b.late ? 0.32 : 0.55) : 0;
        put(f, at, lift, 0, lift > 0.05 ? BLOCK_PEAK : BLOCK_READY, 2.0);
      });
      free.forEach((f, i) => {
        const s = st.free[i];
        if (s === undefined) f.root.visible = false;
        else put(f, s, 0, 0, COVER, 1.92);
      });
      back.forEach((f, i) => put(f, st.back[i], 0, 0, COVER, i === 0 ? 1.84 : 1.9));

      // The ball: struck at the top of the jump, down the shot the block left him.
      const shot = st.open.find((o) => o.main) ?? st.open[0];
      if (p >= 0.5 && p < 0.96) {
        const hand = { x: st.hitter.jump.x - 0.15, y: st.hitter.jump.y - 0.2, z: 3.25 };
        const f = span(p, 0.52, 0.64);
        const to = shot.to;
        ball.visible = true;
        ball.position.set(hand.x + (to.x - hand.x) * f, hand.y + (to.y - hand.y) * f, Math.max(0.11, hand.z * (1 - f) + 0.11 * f + Math.sin(Math.PI * f) * 0.3));
      } else {
        ball.visible = false;
      }

      // From behind our baseline, up in the stand.
      const [w, h] = size;
      camera.aspect = w / h;
      camera.fov = w / h < 1.2 ? 46 : 38;
      // High enough to see over the block to their hitter, and the whole of our court behind it.
      const r = 18.5;
      camera.position.set(Math.sin(yaw) * r, -Math.cos(yaw) * r - 2, 12.8);
      camera.lookAt(0, -1.6, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      for (const f of figures) f.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    };
  }, [ours.shirt, theirs.shirt]);

  return <div className="bp3-stage-canvas" ref={wrap} />;
}

// ---- The window --------------------------------------------------------------------------

/** The block plans, edited over a 3D court: a choice is made at once on the side's tactics. */
export function BlockPlanDialog({ tactics: t, ours, theirs, onChange, onClose, start = 'outside' }: {
  tactics: TeamTactics;
  ours: Kit;
  theirs: Kit;
  onChange: () => void;
  onClose: () => void;
  start?: BlockTarget;
}): JSX.Element {
  const [target, setTarget] = useState<BlockTarget>(start);
  const [scenario, setScenario] = useState<Scenario>('plan');
  const [, redraw] = useState(0);
  const plans = blockPlansOf(t);
  const plan = plans[target];
  const layout = defenceLayoutsOf(t)[SOURCE[target]];
  const set = (patch: Partial<BlockPlan>): void => {
    const own = t.blockPlans ?? defaultBlockPlans();
    t.blockPlans = { ...own, [target]: { ...own[target], ...patch } };
    onChange();
    redraw((n) => n + 1);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="hol-overlay" onClick={onClose}>
      <div className="hol-card bp3-card" role="dialog" aria-label="Block plan" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs">Tactics <Icon name="chevronRight" size={12} /> <b>Block plan</b></span>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="bp3-body">
          <div className="bp3-stage">
            <BlockScene target={target} plan={plan} layout={layout} ours={ours} theirs={theirs} onScenario={setScenario} />
            <div className={`bp3-caption ${scenario}`}>
              {scenario !== 'plan' && <Icon name="alert" size={14} />} {SCENARIO_TEXT[scenario]}
            </div>
            <div className="bp3-legend">
              <span><i className="red" /> Taken away by the block</span>
              <span><i className="green" /> Left open</span>
              <span><i className="yellow" /> Either way</span>
              <span className="faint">Drag to turn</span>
            </div>
          </div>
          <div className="bp3-side">
            <div className="bp3-tabs" role="tablist">
              {BLOCK_TARGETS.map((k) => (
                <button key={k} role="tab" aria-selected={k === target} className={k === target ? 'active' : ''} onClick={() => setTarget(k)}>
                  <b>{BLOCK_TARGET_NAMES[k]}</b>
                  <span>{blockPlanLabel(plans[k], k)}</span>
                </button>
              ))}
            </div>
            <div className="bp3-group">
              <h4>Where the block sets up</h4>
              {focusOptions(target).map(([v, name, hint]) => (
                <button key={v} className={`bp3-opt${plan.focus === v ? ' active' : ''}`} onClick={() => set({ focus: v })}>
                  <b>{plan.focus === v && <Icon name="check" size={13} />} {name}</b>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
            <div className="bp3-group">
              <h4>How many go up</h4>
              <div className="bp3-nums">
                {NUMBER_OPTIONS.map(([v, name, hint]) => (
                  <button key={v} className={`bp3-num${plan.numbers === v ? ' active' : ''}`} title={hint} onClick={() => set({ numbers: v })}>{name}</button>
                ))}
              </div>
              <p className="bp3-hint">{NUMBER_OPTIONS.find(([v]) => v === plan.numbers)?.[2]}</p>
            </div>
            <p className="bp3-note">
              <Icon name="alert" size={13} /> However good the plan, a block can go wrong: the middle can be late across to
              the pin — more so against a fast set, a combination, or on tired legs — and a blocker can read the hitter the
              wrong way and shut the shot he wasn't going to hit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
