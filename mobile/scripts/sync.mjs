/**
 * Brings the game in: the computer version's code (../src) and files (../public) copied into this
 * folder as they are now, so the phone version is always the same game. Nothing outside mobile/ is
 * changed. What is the phone's own lives in app/ and is never overwritten.
 *
 * Run before every build (npm run build and npm run apk do it themselves).
 */

import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = path.resolve(here, '..');

for (const [from, to] of [['src', 'src'], ['public', 'public']]) {
  const src = path.join(game, from);
  const dst = path.join(here, to);
  if (!existsSync(src)) throw new Error(`Not found: ${src}`);
  rmSync(dst, { recursive: true, force: true });
  // The tests stay with the computer version.
  cpSync(src, dst, { recursive: true, filter: (f) => !/\.test\.ts$/.test(f) });
}
console.log('Game copied in from ../src and ../public.');
