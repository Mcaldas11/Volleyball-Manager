import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjector, IN_SHOT } from './courtCamera.ts';

test('the side camera puts the near team on the left, the far team on the right, and the net between', () => {
  const project = buildProjector(1200, 600);
  const near = project(0, -6, 0);
  const net = project(0, 0, 0);
  const far = project(0, 6, 0);
  assert.ok(near.X < net.X && net.X < far.X);
});

test('everything that matters is in shot, whatever the box', () => {
  for (const [w, h] of [[1200, 600], [800, 700], [500, 900]]) {
    const project = buildProjector(w, h);
    for (const [x, y, z] of IN_SHOT) {
      const p = project(x, y, z);
      assert.ok(p.X >= 0 && p.X <= w && p.Y >= 0 && p.Y <= h, `(${x}, ${y}, ${z}) off screen in ${w}×${h}`);
    }
  }
});

test('up is up, and the side of the court by the camera is nearer and larger', () => {
  const project = buildProjector(1200, 600);
  assert.ok(project(0, 0, 2).Y < project(0, 0, 0).Y, 'a raised point sits higher on screen');
  const byCamera = project(4, 0, 0);
  const farSide = project(-4, 0, 0);
  assert.ok(byCamera.d < farSide.d, 'the near sideline is closer');
  assert.ok(byCamera.s > farSide.s, 'and drawn larger');
  assert.ok(byCamera.Y > farSide.Y, 'and lower on screen');
});
