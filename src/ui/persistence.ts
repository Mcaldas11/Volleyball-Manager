/**
 * Save game persistence.
 *
 * Stores full careers in IndexedDB. The `World` object graph is almost
 * entirely plain data (typed arrays, Maps, and interface-shaped objects), so
 * it can be handed to IndexedDB's structured-clone algorithm directly rather
 * than hand-written to and from JSON. The only classes in the graph — `Rng`,
 * `PlayerStore` and its nested `StringTable` — lose their prototype (and
 * therefore their methods) across a clone, so `reviveWorld` restores it after
 * every read.
 *
 * Two object stores back one database: `meta` holds small per-save summaries
 * so the load-game list renders instantly, and `world` holds the heavy full
 * `World` blob, keyed separately. Listing saves never touches the `world`
 * store.
 */

import { Rng } from '../engine/core/rng.ts';
import { PlayerStore, StringTable } from '../engine/model/players.ts';
import type { World } from '../engine/world/world.ts';
import type { WorldScale } from '../engine/world/worldGen.ts';

export interface SaveMeta {
  id: string;
  managerName: string;
  nationCode: string;
  clubName: string;
  clubNationCode: string;
  scale: WorldScale;
  /** Precomputed in-game date label, e.g. "12 Mar 2027". */
  inGameDate: string;
  season: number;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}

const DB_NAME = 'vbm-saves';
const DB_VERSION = 1;
const META_STORE = 'meta';
const WORLD_STORE = 'world';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Save storage is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(WORLD_STORE)) db.createObjectStore(WORLD_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Could not open save storage.'));
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Save storage request failed.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Save storage transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Save storage transaction aborted.'));
  });
}

export function newSaveId(): string {
  return crypto.randomUUID();
}

export async function listSaves(): Promise<SaveMeta[]> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readonly');
  const all = await reqToPromise(tx.objectStore(META_STORE).getAll() as IDBRequest<SaveMeta[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveGame(id: string, meta: SaveMeta, world: World): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META_STORE, WORLD_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(WORLD_STORE).put(world, id);
    await txDone(tx);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('Not enough browser storage space to save this career.');
    }
    throw new Error('Could not save this career.');
  }
}

export async function loadGame(id: string): Promise<World> {
  const db = await openDb();
  const tx = db.transaction(WORLD_STORE, 'readonly');
  const raw = await reqToPromise(tx.objectStore(WORLD_STORE).get(id) as IDBRequest<World | undefined>);
  if (raw === undefined) throw new Error('That save could not be found.');
  return reviveWorld(raw);
}

export async function deleteSave(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, WORLD_STORE], 'readwrite');
  tx.objectStore(META_STORE).delete(id);
  tx.objectStore(WORLD_STORE).delete(id);
  await txDone(tx);
}

/**
 * Restore the prototypes structured clone drops. Exported so it can be
 * exercised headlessly via `structuredClone()`, which implements the same
 * algorithm IndexedDB uses internally.
 */
export function reviveWorld(raw: World): World {
  Object.setPrototypeOf(raw.rng, Rng.prototype);
  Object.setPrototypeOf(raw.players, PlayerStore.prototype);
  Object.setPrototypeOf(raw.players.names, StringTable.prototype);
  return raw;
}
