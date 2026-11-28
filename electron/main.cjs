/**
 * The desktop game, for Windows and macOS: the same build as the web version (dist/), opened in its
 * own window. The files are served from an app:// address of their own rather than from the disk,
 * so the browser rules a web page runs under hold, and the saves (IndexedDB) live in one place that
 * every update of the game keeps.
 */

const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

// ---- Tactic files ------------------------------------------------------------------------------
//
// Like FM's own tactics folder: a `tactics` folder beside the game — in the extracted folder on
// Windows, beside the .app on a Mac — made on first use. Players share tactics by dropping files
// in it. Run from the repository (`electron .`) it is the repository's own; where the game's folder
// can't be written to (installed under Program Files, say), it is Documents/Volleyball Manager.

const TACTIC_EXT = '.vmtac';
const TACTIC_MAX_BYTES = 512 * 1024;
let tacticsDir = null;

function gameFolder() {
  if (!app.isPackaged) return path.join(__dirname, '..');
  const exe = path.dirname(app.getPath('exe'));
  // …/Volleyball Manager.app/Contents/MacOS → beside the .app.
  return process.platform === 'darwin' ? path.resolve(exe, '..', '..', '..') : exe;
}

async function tacticsFolder() {
  if (tacticsDir !== null) return tacticsDir;
  for (const dir of [path.join(gameFolder(), 'tactics'), path.join(app.getPath('documents'), 'Volleyball Manager', 'tactics')]) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fs.constants.W_OK);
      tacticsDir = dir;
      return dir;
    } catch {
      // Not writable: the next place.
    }
  }
  throw new Error('No folder for tactics could be made.');
}

/** The page's name made a safe file name, kept inside the folder. */
function tacticPath(dir, name) {
  const clean = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.vmtac$/i, '')
    .replace(/[. ]+$/, '')
    .slice(0, 60);
  const safe = clean === '' || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? 'Tactic' : clean;
  const file = path.join(dir, `${safe}${TACTIC_EXT}`);
  if (path.dirname(file) !== dir) throw new Error('Bad tactic name.');
  return file;
}

function handleTactics() {
  ipcMain.handle('tactics:folder', () => tacticsFolder());
  ipcMain.handle('tactics:open-folder', async () => {
    const err = await shell.openPath(await tacticsFolder());
    return err === '';
  });
  ipcMain.handle('tactics:list', async () => {
    const dir = await tacticsFolder();
    const names = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && /\.(vmtac|json)$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200);
    return Promise.all(names.map(async (file) => {
      try {
        const stat = await fs.stat(path.join(dir, file));
        if (stat.size > TACTIC_MAX_BYTES) return { file, error: 'The file is too big to be a tactic.' };
        return { file, text: await fs.readFile(path.join(dir, file), 'utf8'), modified: stat.mtimeMs };
      } catch {
        return { file, error: 'The file could not be read.' };
      }
    }));
  });
  ipcMain.handle('tactics:save', async (_e, name, text, overwrite) => {
    if (typeof text !== 'string' || text.length > TACTIC_MAX_BYTES) return { ok: false, error: 'The tactic is too big.' };
    const dir = await tacticsFolder();
    const file = tacticPath(dir, name);
    try {
      await fs.writeFile(file, text, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') return { ok: false, exists: true, file: path.basename(file) };
      return { ok: false, error: 'The file could not be written.' };
    }
    return { ok: true, file: path.basename(file), folder: dir };
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#04070d',
    title: 'Volleyball Manager',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Links out of the game open in the player's own browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // F11 is the page's own (src/ui/fullscreen.tsx), so its full-screen button always agrees with it.
  void win.loadURL('app://game/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = path.normalize(path.join(DIST, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // A Mac keeps its usual menu (Quit, copy and paste, full screen); Windows needs none.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  handleTactics();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
