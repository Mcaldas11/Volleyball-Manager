import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clubKit, colourDistance, hueOf, kitFromHue, matchKits, rgbOf, toHex } from './kits.ts';
import type { Club } from '../engine/model/club.ts';

test('colours read from hex and hsl alike', () => {
  assert.deepEqual(rgbOf('#ff8000'), [255, 128, 0]);
  assert.deepEqual(rgbOf('hsl(0, 100%, 50%)'), [255, 0, 0]);
  assert.equal(toHex('hsl(240, 100%, 50%)'), '#0000ff');
  assert.equal(colourDistance('#123456', '#123456'), 0);
  assert.ok(colourDistance('#000000', '#ffffff') > 200);
});

test("a club wears its designed kit, or one made from its colour — and the away side changes on a clash", () => {
  const plain = { id: 7 } as Club;
  assert.equal(hueOf(plain), (7 * 137.508) % 360);
  assert.deepEqual(clubKit(plain), kitFromHue(hueOf(plain)));
  const designed = { id: 7, kit: { hue: 10, shirt: '#ffcc00', shorts: '#000000', libero: '#00aaff' } } as Club;
  assert.equal(hueOf(designed), 10);
  assert.equal(clubKit(designed).shirt, '#ffcc00');
  // Two near-identical reds: the away side goes to its change kit.
  const [h, a] = matchKits({ shirt: '#d02020', shorts: '#300', libero: '#0f0' }, { shirt: '#c82828', shorts: '#200', libero: '#0f0' }, 0);
  assert.equal(h.shirt, '#d02020');
  assert.ok(colourDistance(h.shirt, a.shirt) >= 70);
  // Kits far apart: both keep their own.
  const kept = matchKits({ shirt: '#d02020', shorts: '#300', libero: '#0f0' }, { shirt: '#2050d0', shorts: '#002', libero: '#0f0' }, 220);
  assert.equal(kept[1].shirt, '#2050d0');
});
