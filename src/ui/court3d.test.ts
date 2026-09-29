import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { courtCamera } from './court3d.ts';
import { buildProjector, IN_SHOT } from './courtCamera.ts';

test('the 3D camera sees the court exactly where the painted hall is drawn', () => {
  for (const [w, h] of [[1200, 600], [800, 700], [500, 900], [1600, 760]]) {
    const camera = courtCamera(w, h);
    const project = buildProjector(w, h);
    for (const [x, y, z] of [...IN_SHOT, [0, 0, 2.43], [-4.5, -9, 0], [4.5, 9, 0], [2, -5, 3.2]]) {
      const v = new Vector3(x, y, z).project(camera);
      const painted = project(x, y, z);
      const X = ((v.x + 1) / 2) * w;
      const Y = ((1 - v.y) / 2) * h;
      assert.ok(Math.hypot(X - painted.X, Y - painted.Y) < 0.5,
        `(${x}, ${y}, ${z}) in ${w}×${h}: 3D at ${X.toFixed(1)},${Y.toFixed(1)}, painted at ${painted.X.toFixed(1)},${painted.Y.toFixed(1)}`);
    }
  }
});
