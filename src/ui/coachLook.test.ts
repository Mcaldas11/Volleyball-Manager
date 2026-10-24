import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COACH_SKINS, DEFAULT_LOOK, figureLook } from './coachLook.ts';

const kit = { shirt: '#2a5bb8', shorts: '#f2f3f5', libero: '#d7a73f' };

test('the default is a polo in the club colours: short sleeves, the club\'s other colour across the shoulders', () => {
  const look = figureLook(DEFAULT_LOOK, kit, false);
  assert.equal(look.kit.shirt, kit.shirt);
  assert.equal(look.trim, kit.shorts);
  assert.equal(look.longSleeves, undefined);
  assert.equal(look.front?.kind, 'polo');
  assert.equal(look.number, 0, 'no number on a coach');
  assert.equal(look.trousers, true);
});

test('a suit: the jacket in its colour, long sleeves, the shirt and tie at the front, the chosen shoes', () => {
  const look = figureLook({ ...DEFAULT_LOOK, outfit: 'suit', top: '#22324f', shirt: '#cfe0f2', tie: '#9b1f2e', shoes: '#4a2e1a', skin: 5, beard: 2, glasses: true }, kit, false);
  assert.equal(look.kit.shirt, '#22324f');
  assert.equal(look.longSleeves, true);
  assert.deepEqual(look.front, { kind: 'jacket', shirt: '#cfe0f2', tie: '#9b1f2e' });
  assert.equal(look.trim, '#cfe0f2', 'the shirt collar at the neck');
  assert.equal(look.shoes, '#4a2e1a');
  assert.equal(look.skin, COACH_SKINS[5]);
  assert.equal(look.beard, 2);
  assert.equal(look.glasses, true);
});

test('a shirt and tie is the shirt itself; a tracksuit zips up; a woman has no beard', () => {
  const shirt = figureLook({ ...DEFAULT_LOOK, outfit: 'shirt', shirt: '#f4d7dc', tie: null }, kit, false);
  assert.equal(shirt.kit.shirt, '#f4d7dc');
  assert.deepEqual(shirt.front, { kind: 'shirt', tie: null });
  const track = figureLook({ ...DEFAULT_LOOK, outfit: 'tracksuit', top: 'club' }, kit, true);
  assert.equal(track.front?.kind, 'zip');
  assert.equal(track.longSleeves, true);
  assert.equal(track.women, true);
  assert.equal(figureLook({ ...DEFAULT_LOOK, beard: 2 }, kit, true).beard, 0);
});
