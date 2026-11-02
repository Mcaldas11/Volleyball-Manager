/**
 * A page for looking at the low-poly player (volleyballPlayer3d.ts) from every side: him on the
 * court in front of the net, in the 3D hall with its stands, lit the way the live court is.
 * Served by the dev server at /player.html — it is not part of the game's build.
 */

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AxesHelper, DirectionalLight, HemisphereLight, LineBasicMaterial, Mesh, MeshStandardMaterial, NeutralToneMapping, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
  type Group,
} from 'three';
import type { ManagerLook } from '../engine/world/world.ts';
import { DEFAULT_LOOK, figureLook } from './coachLook.ts';
import { buildNet } from './court3d.ts';
import { Crowd } from './crowd3d.ts';
import type { Kit } from './figure3d.ts';
import { buildHall } from './hall3d.ts';
import { buildRig, STAND, STILL } from './playerRig.ts';
import { buildVolleyballPlayer, CourtPlayer, KIT_FOUR, type HairStyle, type PlayerJoints } from './volleyballPlayer3d.ts';

/** Where he stands: on his own side, about four metres off the net, facing away from it. */
const SPOT = new Vector3(1.2, -4.2, 0);
const CHEST = SPOT.clone().setZ(1.05);

/** The views the buttons jump to: the camera, and what it looks at — from behind, on his side of the net. */
const VIEWS: Record<string, [Vector3, Vector3]> = {
  front: [new Vector3(0.55, -9.4, 1.35), CHEST],
  side: [new Vector3(6.4, -4.9, 1.3), CHEST],
  back: [new Vector3(1.75, -0.2, 1.5), SPOT.clone().setZ(1.2)],
  face: [new Vector3(1.05, -5.25, 1.86), SPOT.clone().setZ(1.8)],
  // His right hand, at the end of the arm on the left of the front view (?view=hand).
  hand: [new Vector3(0.45, -4.75, 1.8), new Vector3(SPOT.x - 0.98, SPOT.y, 1.59)],
};

const KITS: [Kit, Kit] = [
  { shirt: '#1f50b8', shorts: '#1f50b8', libero: '#f6c419' },
  { shirt: '#c8102e', shorts: '#14213d', libero: '#f2f2f2' },
];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
// The hall's light from every side, as on the live court (court3d.ts): the room is y-up, the court z-up.
const pmrem = new PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentRotation.set(Math.PI / 2, 0, 0);
scene.environmentIntensity = 0.45;
room.dispose();
pmrem.dispose();

const sky = new HemisphereLight('#e8eeff', '#9a6a4c', 0.8);
sky.position.set(0, 0, 1);
scene.add(sky);
// The far side's lights, behind him as the front view sees him: a cool edge round the body.
const rim = new DirectionalLight('#d8e6ff', 1.1);
rim.position.set(SPOT.x - 6, SPOT.y + 9, 7);
scene.add(rim);
const key = new DirectionalLight('#ffffff', 2.0);
key.position.set(SPOT.x + 3.5, SPOT.y - 5, 14);
key.target.position.copy(SPOT);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 4, far: 30 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const fill = new DirectionalLight('#dfe6f5', 0.45);
fill.position.set(SPOT.x + 10, SPOT.y - 6, 5);
scene.add(fill);

// The hall, its far stand's crowd, the net — and the shadows on the painted floor.
const hall = buildHall(0.85, renderer.capabilities.getMaxAnisotropy());
const farStand = new Crowd(0.85);
scene.add(hall.group, farStand.group, buildNet());
const crowds = [farStand, ...hall.crowds];
for (const c of crowds) c.setKits(KITS);
const floor = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: 0.34 }));
floor.receiveShadow = true;
scene.add(floor);

// ?woman=1 for a woman's build; ?hair=0|1|2 and ?number=… try the other cuts and numbers;
// ?coach=suit|shirt|tracksuit|polo (with &beard=1|2, &glasses=1) dresses the manager at the bench,
// standing as at the bench.
const query = new URLSearchParams(location.search);
const woman = query.get('woman') === '1';
const hair = Math.max(0, Math.min(2, Number(query.get('hair') ?? (woman ? 0 : 1)))) as HairStyle;
const outfit = query.get('coach') as ManagerLook['outfit'] | null;
const player: { root: Group; joints: PlayerJoints } = outfit === null
  ? buildVolleyballPlayer(KIT_FOUR, { number: Number(query.get('number') ?? 4), hair, frame: woman ? 'woman' : 'man' })
  : (() => {
    const coach = new CourtPlayer(figureLook({
      ...DEFAULT_LOOK, outfit, hairStyle: hair, beard: Number(query.get('beard') ?? 0) as 0 | 1 | 2,
      glasses: query.get('glasses') === '1', tie: outfit === 'suit' || outfit === 'shirt' ? '#9b1f2e' : null,
    }, KITS[0], woman));
    coach.pose({ x: 0, y: 0, lift: 0, yaw: 0, scale: 1, alpha: 1, rig: buildRig(STAND, STILL) });
    return coach;
  })();
player.root.position.copy(SPOT);
// He faces -y, towards the near end, his back to the net.
player.root.rotation.z = Math.PI;
scene.add(player.root);

// A marker at every joint's pivot, through the body, for the Joints button.
function allJoints(j: PlayerJoints): Group[] {
  return [j.hips, j.torso, j.neck, j.head, ...Object.values(j.left), ...Object.values(j.right)];
}
const markers = allJoints(player.joints).map((g) => {
  const axes = new AxesHelper(0.09);
  (axes.material as LineBasicMaterial).depthTest = false;
  axes.renderOrder = 10;
  axes.visible = false;
  g.add(axes);
  return axes;
});

let triangles = 0;
let meshes = 0;
player.root.traverse((o) => {
  if (o instanceof Mesh) {
    meshes++;
    triangles += o.geometry.getAttribute('position').count / 3;
  }
});
document.getElementById('stats')!.textContent =
  `${triangles.toLocaleString('en')} triangles · ${meshes} meshes · ${markers.length} joints`;

const camera = new PerspectiveCamera(32, 1, 0.05, 200);
// z is up on the court; the controls take the camera's up as they are made.
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.6;
controls.maxDistance = 16;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 1.6;

function show(view: string): void {
  const [from, at] = VIEWS[view] ?? VIEWS.front;
  camera.position.copy(from);
  controls.target.copy(at);
  controls.update();
}
show(query.get('view') ?? 'front');

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const toggles: Record<string, (on: boolean) => void> = {
  spin: (on) => { controls.autoRotate = on; },
  wire: (on) => {
    player.root.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material.wireframe = on;
    });
  },
  joints: (on) => markers.forEach((m) => { m.visible = on; }),
};
for (const b of document.querySelectorAll<HTMLButtonElement>('.hud button')) {
  b.addEventListener('click', () => {
    if (b.dataset.view !== undefined) show(b.dataset.view);
    const t = b.dataset.toggle;
    if (t !== undefined) {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      toggles[t](on);
    }
  });
}
window.addEventListener('keydown', (e) => {
  const view = ['front', 'side', 'back', 'face'][Number(e.key) - 1];
  if (view !== undefined) show(view);
});

renderer.setAnimationLoop((now) => {
  controls.update();
  for (const c of crowds) c.update(now);
  renderer.render(scene, camera);
});
