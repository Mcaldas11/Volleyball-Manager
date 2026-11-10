/**
 * Custom player portraits: a photo the manager picks for a player, in place of the one the game gives him.
 *
 * Kept apart from the career itself — in a database of their own, by career and player — so a portrait
 * changes none of the player's data, nothing about the save, and turns no achievements off. The open
 * career's are held in memory, so every face in the game shows them at once. A career's portraits go
 * with it when it is deleted; exporting a career leaves them out, and they are exported (and imported)
 * on their own, from the portrait editor.
 */

import { useSyncExternalStore } from 'react';

const DB_NAME = 'volleyball-manager-portraits';
const DB_VERSION = 1;
const STORE = 'portraits';

interface PortraitRecord {
  /** `${saveId}:${playerId}`. */
  key: string;
  saveId: string;
  playerId: number;
  /** The cropped photo, as a data URL. */
  image: string;
  updatedAt: number;
}

/** What a portraits file holds: one career's portraits, by permanent player id. */
export interface PortraitsFile {
  kind: 'volleyball-manager-portraits';
  version: 1;
  portraits: Record<string, string>;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('saveId', 'saveId');
    };
    req.onsuccess = () => resolve(req.result);
    // No database (a private window, say): portraits last as long as the page.
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---- The open career's portraits, in memory ---------------------------------------------

let openSave: string | null = null;
let portraits = new Map<number, string>();
const listeners = new Set<() => void>();

function changed(): void {
  portraits = new Map(portraits);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The custom portrait of a player of the open career, if he has one — re-rendering when it changes. */
export function usePortrait(playerId: number): string | undefined {
  return useSyncExternalStore(subscribe, () => portraits.get(playerId));
}

/** The custom portrait of a player of the open career, if he has one. */
export function portraitOf(playerId: number): string | undefined {
  return portraits.get(playerId);
}

/** Load the portraits of the career just opened (or none, with null). */
export async function openPortraits(saveId: string | null): Promise<void> {
  if (saveId === openSave) return;
  openSave = saveId;
  portraits = new Map();
  changed();
  if (saveId === null) return;
  const d = await db();
  if (d === null || openSave !== saveId) return;
  const records = await new Promise<PortraitRecord[]>((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).index('saveId').getAll(saveId);
    req.onsuccess = () => resolve(req.result as PortraitRecord[]);
    req.onerror = () => resolve([]);
  });
  if (openSave !== saveId) return;
  for (const r of records) portraits.set(r.playerId, r.image);
  changed();
}

/** Give a player of the open career a portrait — or, with null, his own photo back. */
export async function setPortrait(playerId: number, image: string | null): Promise<void> {
  if (openSave === null) return;
  const saveId = openSave;
  if (image === null) portraits.delete(playerId);
  else portraits.set(playerId, image);
  changed();
  const d = await db();
  if (d === null) return;
  const tx = d.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const key = `${saveId}:${playerId}`;
  if (image === null) store.delete(key);
  else store.put({ key, saveId, playerId, image, updatedAt: Date.now() } satisfies PortraitRecord);
  await done(tx);
}

/** How many players of the open career have a portrait. */
export function portraitCount(): number {
  return portraits.size;
}

/** The open career's portraits, for a file of their own. */
export function exportPortraits(): PortraitsFile {
  return { kind: 'volleyball-manager-portraits', version: 1, portraits: Object.fromEntries([...portraits].map(([id, img]) => [String(id), img])) };
}

/**
 * Portraits from a file into the open career — each for the player with that permanent id, if the
 * career has him. Returns how many were taken.
 */
export async function importPortraits(file: unknown, hasPlayer: (playerId: number) => boolean): Promise<number> {
  const f = file as Partial<PortraitsFile> | null;
  if (f === null || typeof f !== 'object' || f.kind !== 'volleyball-manager-portraits' || typeof f.portraits !== 'object' || f.portraits === null) {
    throw new Error('That is not a portraits file.');
  }
  let n = 0;
  for (const [id, image] of Object.entries(f.portraits)) {
    const playerId = Number(id);
    if (!Number.isInteger(playerId) || typeof image !== 'string' || !image.startsWith('data:image/') || !hasPlayer(playerId)) continue;
    await setPortrait(playerId, image);
    n++;
  }
  return n;
}

/** A deleted career's portraits go with it. */
export async function deletePortraitsOf(saveId: string): Promise<void> {
  if (saveId === openSave) {
    portraits = new Map();
    changed();
  }
  const d = await db();
  if (d === null) return;
  const tx = d.transaction(STORE, 'readwrite');
  const index = tx.objectStore(STORE).index('saveId');
  const req = index.openKeyCursor(IDBKeyRange.only(saveId));
  req.onsuccess = () => {
    const c = req.result;
    if (c === null) return;
    tx.objectStore(STORE).delete(c.primaryKey);
    c.continue();
  };
  await done(tx);
}
