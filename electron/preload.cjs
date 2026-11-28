/**
 * What the desktop game's page may ask of the computer, and nothing more: the tactic files in the
 * `tactics` folder beside the game. The page itself never gets Node; it calls these, and main.cjs
 * does the reading and writing (see src/ui/tacticFiles.ts).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vmDesktop', {
  tactics: {
    /** Every tactic file in the folder: { file, text } or { file, error }. */
    list: () => ipcRenderer.invoke('tactics:list'),
    /** Write one: { ok, file } — or { exists: true } when the name is taken and `overwrite` is not set. */
    save: (name, text, overwrite) => ipcRenderer.invoke('tactics:save', String(name), String(text), Boolean(overwrite)),
    /** The folder's full path. */
    folder: () => ipcRenderer.invoke('tactics:folder'),
    /** Open the folder in Explorer or the Finder. */
    openFolder: () => ipcRenderer.invoke('tactics:open-folder'),
  },
});
