import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3, type Group } from 'three';
import { DEFAULT_LOOK, figureLook } from './coachLook.ts';
import { COCKED, STRIKE } from './courtMotion.ts';
import type { Look } from './figure3d.ts';
import { arms, BONES, buildRig, jointPositions, READY, shape, STAND, STILL, type V3 } from './playerRig.ts';
import { buildVolleyballPlayer, coloursFor, CourtPlayer, LEG_SPREAD, tPose, type VolleyballPlayer } from './volleyballPlayer3d.ts';

const LOOK: Look = {
  kit: { shirt: '#1f4fa8', shorts: '#14213d', libero: '#f2c14e' }, libero: false, trim: '#ffc72c', number: 11,
  skin: '#c18a60', hair: '#2b1d14', hairStyle: 1,
};

function built(): VolleyballPlayer {
  const p = buildVolleyballPlayer();
  p.root.updateMatrixWorld(true);
  return p;
}

const at = (g: Group): Vector3 => g.getWorldPosition(new Vector3());

function near(v: Vector3, x: number, y: number, z: number, label: string): void {
  assert.ok(v.distanceTo(new Vector3(x, y, z)) < 1e-6, `${label} at ${v.toArray().map((n) => n.toFixed(3))}, not ${[x, y, z]}`);
}

test('every joint is its own named group, nested from the hips out', () => {
  const { root, joints: j } = built();
  assert.equal(root.name, 'VolleyballPlayer');
  assert.equal(j.head.parent, j.neck);
  assert.equal(j.neck.parent, j.torso);
  assert.equal(j.torso.parent, j.hips);
  for (const [tag, l] of [['L', j.left], ['R', j.right]] as const) {
    assert.equal(l.hand.parent, l.forearm);
    assert.equal(l.forearm.parent, l.upperArm);
    assert.equal(l.upperArm.parent, l.shoulder);
    assert.equal(l.shoulder.parent, j.torso);
    assert.equal(l.foot.parent, l.shin);
    assert.equal(l.shin.parent, l.thigh);
    assert.equal(l.thigh.parent, j.hips);
    for (const [name, g] of Object.entries(l)) assert.equal(g.name, `${name[0].toUpperCase()}${name.slice(1)}.${tag}`);
  }
});

test('in the T-pose the joints sit where the rig puts them, the arms out level', () => {
  const { joints: j } = built();
  const hip = BONES.ankle + (BONES.thigh + BONES.shin) * Math.cos(LEG_SPREAD);
  const shoulder = hip + BONES.spine + BONES.shoulderUp;
  near(at(j.head), 0, 0, hip + BONES.spine + BONES.neck, 'top of the neck');
  for (const [side, l] of [[1, j.right], [-1, j.left]] as const) {
    near(at(l.upperArm), side * BONES.shoulderOut, 0, shoulder, 'shoulder');
    near(at(l.forearm), side * (BONES.shoulderOut + BONES.upperArm), 0, shoulder, 'elbow');
    near(at(l.hand), side * (BONES.shoulderOut + BONES.upperArm + BONES.forearm), 0, shoulder, 'wrist');
    const ankle = at(l.foot);
    assert.ok(Math.abs(ankle.z - BONES.ankle) < 1e-6, 'ankles stay their height off the floor');
    assert.ok(side * ankle.x > BONES.hipOut, 'feet a little apart');
  }
});

test('the soles are on the floor and nothing goes through it', () => {
  const { joints: j } = built();
  for (const l of [j.left, j.right]) {
    const box = new Box3().setFromObject(l.foot, true);
    assert.ok(Math.abs(box.min.z) < 0.004, `sole at ${box.min.z.toFixed(4)}`);
  }
});

test('left and right mirror each other', () => {
  const { joints: j } = built();
  for (const part of ['upperArm', 'forearm', 'hand', 'shin', 'foot'] as const) {
    const r = new Box3().setFromObject(j.right[part], true);
    const l = new Box3().setFromObject(j.left[part], true);
    assert.ok(Math.abs(r.max.x + l.min.x) < 1e-4 && Math.abs(r.min.x + l.max.x) < 1e-4, part);
    assert.ok(Math.abs(r.min.z - l.min.z) < 1e-4 && Math.abs(r.max.y - l.max.y) < 1e-4, part);
  }
});

test('low-poly, and cheap to draw', () => {
  const { root } = built();
  let triangles = 0;
  let meshes = 0;
  root.traverse((o) => {
    if (o instanceof Mesh) {
      meshes++;
      triangles += o.geometry.getAttribute('position').count / 3;
    }
  });
  assert.ok(triangles > 3000 && triangles < 8000, `${triangles} triangles`);
  assert.ok(meshes <= 20, `${meshes} meshes`);
});

test('on the court he takes every shape just where the rig says the joints are', () => {
  const player = new CourtPlayer(LOOK);
  const dig = shape(READY, { crouch: 0.4, tilt: 0.5, lean: 0.32, nod: -0.6, stance: 0.42, stride: 0.32, ...arms(1.22, -0.25, 0.03) });
  for (const [name, s] of [['stand', STAND], ['ready', READY], ['cocked', COCKED], ['strike', STRIKE], ['dig', dig]] as const) {
    const rig = buildRig(s, { ...STILL, gait: 0.3, moveX: 0.4 });
    player.pose({ x: 0, y: 0, lift: 0, yaw: 0, scale: 1, alpha: 1, rig });
    player.root.updateMatrixWorld(true);
    const want = jointPositions(rig);
    const close = (got: Vector3, v: V3, what: string): void =>
      assert.ok(got.distanceTo(new Vector3(...v)) < 1e-6, `${name}: ${what} ${got.toArray().map((n) => n.toFixed(3))} not ${v.map((n) => n.toFixed(3))}`);
    const head = player.head.localToWorld(new Vector3(0, 0, BONES.head));
    close(head, want.head, 'head');
    const { left, right } = player.joints;
    close(left.hand.localToWorld(new Vector3(0, 0, -BONES.hand)), want.hands[0], 'left hand');
    close(right.hand.localToWorld(new Vector3(0, 0, -BONES.hand)), want.hands[1], 'right hand');
    close(at(left.forearm), want.elbows[0], 'left elbow');
    close(at(right.forearm), want.elbows[1], 'right elbow');
    close(at(left.foot), want.ankles[0], 'left ankle');
    close(at(right.foot), want.ankles[1], 'right ankle');
    // What the court holds a trophy by: halfway along each palm.
    const [a, b] = [new Vector3(), new Vector3()];
    player.handsAt(a, b);
    const palm = (hand: Group): V3 => hand.localToWorld(new Vector3(0, 0, -BONES.hand / 2)).toArray() as V3;
    close(a, palm(left.hand), 'left palm');
    close(b, palm(right.hand), 'right palm');
  }
});

test('the number shows in the role colour where it stands out, else dark or white', () => {
  assert.equal(coloursFor(LOOK).number, '#ffc72c');
  assert.equal(coloursFor({ ...LOOK, kit: { ...LOOK.kit, shirt: '#f4f6f8' }, trim: '#e8ecf0' }).number, '#10151d');
  assert.equal(coloursFor({ ...LOOK, trim: '#2a5bd0' }).number, '#ffffff');
  assert.equal(coloursFor({ ...LOOK, libero: true }).shirt, '#f2c14e');
});

test('a new kit builds him again; the same look does not', () => {
  const player = new CourtPlayer(LOOK);
  const first = player.head;
  player.restyle({ ...LOOK });
  assert.equal(player.head, first);
  player.restyle({ ...LOOK, number: 7 });
  assert.notEqual(player.head, first);
});

test('a coach in each outfit: his clothes, trousers and shoes, no number — and stands like anyone else', () => {
  const kit = { shirt: '#1f4fa8', shorts: '#14213d', libero: '#1f4fa8' };
  const triangles = (p: CourtPlayer): number => {
    let n = 0;
    p.root.traverse((o) => { if (o instanceof Mesh) n += o.geometry.getAttribute('position').count / 3; });
    return n;
  };
  const player = triangles(new CourtPlayer(LOOK));
  for (const outfit of ['suit', 'shirt', 'tracksuit', 'polo'] as const) {
    const look = figureLook({ ...DEFAULT_LOOK, outfit, tie: '#9b1f2e', beard: 2, glasses: true }, kit, false);
    const coach = new CourtPlayer(look);
    const rig = buildRig(STAND, STILL);
    coach.pose({ x: 0, y: 0, lift: 0, yaw: 0, scale: 1, alpha: 1, rig });
    coach.root.updateMatrixWorld(true);
    const want = jointPositions(rig);
    assert.ok(at(coach.joints.left.foot).distanceTo(new Vector3(...want.ankles[0])) < 1e-6, outfit);
    const n = triangles(coach);
    assert.ok(n > 3000 && n < 8000, `${outfit}: ${n} triangles`);
    // No knee pads or number to draw, though there are trousers to the shoe.
    assert.notEqual(n, player, outfit);
    const box = new Box3().setFromObject(coach.joints.left.shin, true);
    assert.ok(box.min.z < 0.1, `${outfit}: trousers down to ${box.min.z.toFixed(3)}`);
  }
  assert.equal(coloursFor(figureLook(DEFAULT_LOOK, kit, false)).sole, '#0d0f13', 'smart shoes, dark soles');
});

test('a woman — player or coach, every hairstyle — on the same skeleton, feet on the floor', () => {
  const kit = { shirt: '#1f4fa8', shorts: '#14213d', libero: '#1f4fa8' };
  const looks: Look[] = [0, 1, 2].map((hairStyle) => ({ ...LOOK, women: true, hairStyle }));
  for (const outfit of ['suit', 'tracksuit', 'polo'] as const) looks.push(figureLook({ ...DEFAULT_LOOK, outfit, beard: 2 }, kit, true));
  const man = new CourtPlayer(LOOK);
  for (const look of looks) {
    const woman = new CourtPlayer(look);
    for (const s of [STAND, STRIKE]) {
      const rig = buildRig(s, STILL);
      woman.pose({ x: 0, y: 0, lift: 0, yaw: 0, scale: 1, alpha: 1, rig });
      woman.root.updateMatrixWorld(true);
      const want = jointPositions(rig);
      assert.ok(woman.joints.right.hand.localToWorld(new Vector3(0, 0, -BONES.hand)).distanceTo(new Vector3(...want.hands[1])) < 1e-6);
    }
    tPose({ root: woman.root, joints: woman.joints });
    woman.root.updateMatrixWorld(true);
    const sole = new Box3().setFromObject(woman.joints.left.foot, true).min.z;
    assert.ok(Math.abs(sole) < 0.004, `sole at ${sole.toFixed(4)}`);
    // Narrower at the shoulders than a man.
    const across = (p: CourtPlayer): number => new Box3().setFromObject(p.joints.right.shoulder, true).max.x;
    tPose({ root: man.root, joints: man.joints });
    man.root.updateMatrixWorld(true);
    assert.ok(across(woman) < across(man));
  }
  // A woman's never has a beard, whatever the look asks.
  const faceColours = (look: Look): number[] =>
    Array.from(((new CourtPlayer(look).joints.head.children[0] as Mesh).geometry.getAttribute('color').array as Float32Array));
  assert.deepEqual(faceColours({ ...looks[3], beard: 2 }), faceColours({ ...looks[3], beard: 0 }));
  assert.notDeepEqual(faceColours({ ...looks[3], women: false, beard: 2 }), faceColours({ ...looks[3], women: false, beard: 0 }));
});

test('tPose puts a posed body back', () => {
  const p = built();
  p.joints.right.forearm.rotation.x = 1.2;
  p.joints.left.thigh.rotation.x = -0.6;
  p.joints.head.rotation.z = 0.4;
  tPose(p);
  assert.equal(p.joints.right.forearm.rotation.x, 0);
  assert.equal(p.joints.left.thigh.rotation.x, 0);
  assert.equal(p.joints.head.rotation.z, 0);
  assert.equal(p.joints.right.upperArm.rotation.y, -Math.PI / 2);
});
