/**
 * The Android app: the built game (dist/, from `vite build`) put into the Android project and built
 * into a signed .apk — release/volleyball-manager-<version>-android.apk, the file to upload to
 * itch.io. Run with `npm run apk` (which syncs the game and builds it first).
 *
 * Needs Java 21 and the Android SDK. They are looked for in ANDROID_TOOLS (default:
 * ~/.android-build, with jdk/ and sdk/ inside), or taken from JAVA_HOME and ANDROID_HOME.
 *
 * The app is signed with the key in keystore/, made here the first time. Keep a copy of that folder:
 * a phone only takes an update signed with the same key as the app it has.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
// The game's own version (the computer version's package.json), so the .apk always says the same as the
// Windows zip.
const { version } = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const [major, minor, patch] = version.split('.').map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

/** A Windows path without spaces (the Android tools' scripts break on "C:\Users\First Last"). */
function short(p) {
  if (!win || !p.includes(' ')) return p;
  const ps = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${p.replaceAll("'", "''")}').ShortPath`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
}

// The tools.
const tools = process.env.ANDROID_TOOLS ?? path.join(os.homedir(), '.android-build');
let javaHome = process.env.JAVA_HOME;
const jdkDir = path.join(tools, 'jdk');
if (existsSync(jdkDir)) {
  const jdk = readdirSync(jdkDir).find((d) => d.startsWith('jdk-21'));
  if (jdk !== undefined) javaHome = path.join(jdkDir, jdk);
}
const sdk = existsSync(path.join(tools, 'sdk')) ? path.join(tools, 'sdk') : process.env.ANDROID_HOME;
if (javaHome === undefined || sdk === undefined) throw new Error('Java 21 or the Android SDK not found — see the top of scripts/apk.mjs.');
const env = { ...process.env, JAVA_HOME: short(javaHome), ANDROID_HOME: short(sdk), ANDROID_SDK_ROOT: short(sdk) };
env.PATH = `${path.join(env.JAVA_HOME, 'bin')}${path.delimiter}${env.PATH}`;

// The key, the first time.
const keys = path.join(here, 'keystore');
const props = path.join(keys, 'keystore.properties');
if (!existsSync(props)) {
  mkdirSync(keys, { recursive: true });
  const pass = randomBytes(18).toString('base64url');
  execFileSync(path.join(env.JAVA_HOME, 'bin', win ? 'keytool.exe' : 'keytool'), [
    '-genkeypair', '-v', '-keystore', path.join(keys, 'volleyball-manager.jks'), '-alias', 'volleyball-manager',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-storepass', pass, '-keypass', pass,
    '-dname', 'CN=Volleyball Manager, O=Volleyball Manager',
  ], { stdio: 'inherit', env });
  writeFileSync(props, `storeFile=volleyball-manager.jks\nstorePassword=${pass}\nkeyAlias=volleyball-manager\nkeyPassword=${pass}\n`);
  console.log('Made the signing key in mobile/keystore/ — keep a copy of that folder.');
}

// The game into the Android project, then the .apk.
execFileSync(win ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], { cwd: here, stdio: 'inherit', env, shell: win });
const android = path.join(here, 'android');
execFileSync(win ? '.\\gradlew.bat' : './gradlew', ['assembleRelease', `-PvmVersion=${version}`, `-PvmVersionCode=${versionCode}`, '--no-daemon'], {
  cwd: android, stdio: 'inherit', env, shell: win,
});

const built = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const out = path.join(here, 'release');
mkdirSync(out, { recursive: true });
const apk = path.join(out, `volleyball-manager-${version}-android.apk`);
copyFileSync(built, apk);
console.log(`→ mobile/release/${path.basename(apk)}`);
