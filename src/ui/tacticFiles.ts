/**
 * Where tactic files go. In the desktop game: the `tactics` folder beside the
 * game, through what electron/preload.cjs hands the page — the page never
 * touches the disk itself. In a browser, which has no such folder: the file
 * is downloaded, and loaded from a file the player picks.
 */

import { parseTacticFile, type TacticFile, tacticFileName } from '../engine/model/tacticFile.ts';

interface DesktopTactics {
  list: () => Promise<{ file: string; text?: string; error?: string; modified?: number }[]>;
  save: (name: string, text: string, overwrite: boolean) => Promise<{ ok: boolean; exists?: boolean; file?: string; folder?: string; error?: string }>;
  folder: () => Promise<string>;
  openFolder: () => Promise<boolean>;
}

declare global {
  interface Window {
    vmDesktop?: { tactics?: DesktopTactics };
  }
}

function desktop(): DesktopTactics | null {
  return typeof window !== 'undefined' ? window.vmDesktop?.tactics ?? null : null;
}

/** Whether tactics live in a folder of files (the desktop game) or are downloaded (a browser). */
export function hasTacticsFolder(): boolean {
  return desktop() !== null;
}

/** One file as the list shows it: the tactic in it and anything fixed while reading it, or why it can't be read. */
export type TacticFileEntry =
  | { file: string; ok: true; tactic: TacticFile; warnings: string[] }
  | { file: string; ok: false; error: string };

function entryOf(file: string, text: string | undefined, error?: string): TacticFileEntry {
  if (text === undefined) return { file, ok: false, error: error ?? 'The file could not be read.' };
  const r = parseTacticFile(text);
  return r.ok ? { file, ok: true, tactic: r.file, warnings: r.warnings } : { file, ok: false, error: r.error };
}

/** Every file in the tactics folder. */
export async function listTacticFiles(): Promise<TacticFileEntry[]> {
  const d = desktop();
  if (d === null) return [];
  const files = await d.list();
  return files.map((f) => entryOf(f.file, f.text, f.error));
}

/** Files the player picked, read as the folder's are. */
export async function readPickedFiles(files: FileList | File[]): Promise<TacticFileEntry[]> {
  return Promise.all(Array.from(files).map(async (f) => {
    if (f.size > 512 * 1024) return entryOf(f.name, undefined, 'The file is too big to be a tactic.');
    try {
      return entryOf(f.name, await f.text());
    } catch {
      return entryOf(f.name, undefined);
    }
  }));
}

export type SaveResult = { ok: true; file: string } | { ok: false; exists: true; file: string } | { ok: false; exists?: false; error: string };

/** Write a tactic file: into the folder, or downloaded. Taken names are only overwritten when asked. */
export async function saveTacticFile(name: string, text: string, overwrite = false): Promise<SaveResult> {
  const d = desktop();
  const file = tacticFileName(name);
  if (d === null) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, file };
  }
  try {
    const r = await d.save(name, text, overwrite);
    if (r.ok) return { ok: true, file: r.file ?? file };
    if (r.exists === true) return { ok: false, exists: true, file: r.file ?? file };
    return { ok: false, error: r.error ?? 'The file could not be written.' };
  } catch {
    return { ok: false, error: 'The file could not be written.' };
  }
}

export async function tacticsFolderPath(): Promise<string | null> {
  const d = desktop();
  if (d === null) return null;
  try {
    return await d.folder();
  } catch {
    return null;
  }
}

export function openTacticsFolder(): void {
  void desktop()?.openFolder();
}
