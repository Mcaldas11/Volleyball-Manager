/**
 * The desktop downloads: `npm run desktop` builds the game and packs it as an app for Windows and
 * for macOS (Apple silicon and Intel), each zipped in release/ ready to upload to itch.io.
 *
 *   npm run desktop            all three
 *   npm run desktop -- win     Windows only
 *   npm run desktop -- mac     macOS only
 */

import { packager } from '@electron/packager';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { zipFolder } from './zip.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'release');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const want = process.argv[2] ?? 'all';

const targets = [
  { platform: 'win32', arch: 'x64', name: 'windows' },
  { platform: 'darwin', arch: 'arm64', name: 'mac-apple-silicon' },
  { platform: 'darwin', arch: 'x64', name: 'mac-intel' },
].filter((t) => want === 'all' || (want === 'win' ? t.platform === 'win32' : want === 'mac' ? t.platform === 'darwin' : false));

if (targets.length === 0) {
  console.error(`Unknown target "${want}": use win, mac or nothing for all.`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
console.log('Building the game…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// Only what the app needs: the built game, the window around it, and package.json.
const keep = /^\/(dist|electron)(\/|$)|^\/package\.json$/;

for (const t of targets) {
  console.log(`Packing for ${t.name}…`);
  if (t.platform === 'darwin' && process.platform !== 'darwin') {
    // A Mac app has to be put together and signed on a Mac: GitHub builds it (see .github/workflows/desktop.yml).
    console.log('  skipped — the Mac apps are built on a Mac: push to GitHub, or run this there.');
    continue;
  }
  const [dir] = await packager({
    dir: root,
    out,
    overwrite: true,
    platform: t.platform,
    arch: t.arch,
    name: 'Volleyball Manager',
    executableName: t.platform === 'win32' ? 'Volleyball Manager' : undefined,
    appVersion: pkg.version,
    appCopyright: '© 2026 Miguel Caldas. All rights reserved.',
    appBundleId: 'com.miguelcaldas.volleyballmanager',
    appCategoryType: 'public.app-category.sports-games',
    icon: path.join(root, 'electron', t.platform === 'win32' ? 'icon.ico' : 'icon.icns'),
    asar: true,
    prune: false,
    ignore: (file) => file !== '' && !keep.test(file.replaceAll('\\', '/')),
    win32metadata: { CompanyName: 'Miguel Caldas', ProductName: 'Volleyball Manager', FileDescription: 'Volleyball Manager' },
  });
  if (t.platform === 'darwin') {
    // Signed for this machine alone ("ad hoc"): without any signature an Apple silicon Mac calls the app damaged.
    execSync(`codesign --force --deep --sign - "${path.join(dir, 'Volleyball Manager.app')}"`, { stdio: 'inherit' });
  }
  const zip = path.join(out, `volleyball-manager-${pkg.version}-${t.name}.zip`);
  rmSync(zip, { force: true });
  if (process.platform === 'darwin') {
    // Apple's own zipper, the way a Mac app is meant to be zipped.
    execSync(`ditto -c -k --sequesterRsrc --keepParent "${path.join(dir, t.platform === 'darwin' ? 'Volleyball Manager.app' : '')}" "${zip}"`, { stdio: 'inherit' });
  } else {
    await zipFolder(dir, zip);
  }
  console.log(`  → ${path.relative(root, zip)}`);
}
