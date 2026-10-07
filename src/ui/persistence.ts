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
 * Three object stores back one database: `meta` holds small per-save
 * summaries so the load-game list renders instantly, `world` holds the heavy
 * full `World` blob, and `season` the season-so-far figures that live beside
 * the World rather than in it — all keyed by save id. Listing saves never
 * touches the other two stores.
 */

import { Rng } from '../engine/core/rng.ts';
import { PLAYING_TIME_UNKNOWN, PlayerStore, POSITION_SLOTS, StringTable } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
import { DAYS_PER_SEASON, seasonEndDay, type World } from '../engine/world/world.ts';
import type { WorldScale } from '../engine/world/worldGen.ts';
import { cancelOffCycleClubWorld, ensureCupCompetitions } from '../engine/season/cups.ts';
import { backfillCareer } from '../engine/world/career.ts';
import { rollHandedness, rollOffHand } from '../engine/world/playerGen.ts';
import { coachesSetUp } from '../engine/world/aiTactics.ts';
import {
  newSeasonContext, pickLineup, recordSeasonStartAbility, type SeasonContext, type SeasonStats,
} from '../engine/season/seasonEngine.ts';

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

/**
 * The part of the season context worth keeping in a save: every player's
 * season stat line (the leaderboards) and abilities as the season began (the
 * "most improved" award). Full match logs are left out — they only feed the
 * report of a match just played.
 */
export interface SavedSeason {
  stats: SeasonStats;
  seasonStartAbility: Map<number, number>;
}

const DB_NAME = 'vbm-saves';
/** 2 added the `season` store. */
const DB_VERSION = 2;
const META_STORE = 'meta';
const WORLD_STORE = 'world';
const SEASON_STORE = 'season';

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
      if (!db.objectStoreNames.contains(SEASON_STORE)) db.createObjectStore(SEASON_STORE);
    };
    req.onsuccess = () => {
      // Let a newer version of the game, open in another tab, upgrade the database.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
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

export async function saveGame(id: string, meta: SaveMeta, world: World, season: SeasonContext): Promise<void> {
  const db = await openDb();
  try {
    const saved: SavedSeason = { stats: season.stats, seasonStartAbility: season.seasonStartAbility };
    const tx = db.transaction([META_STORE, WORLD_STORE, SEASON_STORE], 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(WORLD_STORE).put(world, id);
    tx.objectStore(SEASON_STORE).put(saved, id);
    await txDone(tx);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('Not enough browser storage space to save this career.');
    }
    throw new Error('Could not save this career.');
  }
}

export async function loadGame(id: string): Promise<{ world: World; season: SeasonContext }> {
  const db = await openDb();
  const tx = db.transaction([WORLD_STORE, SEASON_STORE], 'readonly');
  const worldReq = tx.objectStore(WORLD_STORE).get(id) as IDBRequest<World | undefined>;
  const seasonReq = tx.objectStore(SEASON_STORE).get(id) as IDBRequest<SavedSeason | undefined>;
  const [raw, season] = await Promise.all([reqToPromise(worldReq), reqToPromise(seasonReq)]);
  if (raw === undefined) throw new Error('That save could not be found.');
  const world = reviveWorld(raw);
  return { world, season: reviveSeason(world, season) };
}

export async function deleteSave(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, WORLD_STORE, SEASON_STORE], 'readwrite');
  tx.objectStore(META_STORE).delete(id);
  tx.objectStore(WORLD_STORE).delete(id);
  tx.objectStore(SEASON_STORE).delete(id);
  await txDone(tx);
}

/**
 * Rebuild the season context from what a save kept of it. A save written
 * before seasons were kept has none: its leaderboards start again from the
 * load, and "most improved" is measured from the load too, rather than not
 * at all.
 */
export function reviveSeason(world: World, saved: SavedSeason | undefined): SeasonContext {
  const ctx = newSeasonContext();
  if (saved === undefined) {
    recordSeasonStartAbility(world, ctx);
    return ctx;
  }
  ctx.stats = saved.stats;
  ctx.seasonStartAbility = saved.seasonStartAbility;
  return ctx;
}

/**
 * Restore the prototypes structured clone drops, and backfill fields that
 * didn't exist when an older save was written. Exported so it can be
 * exercised headlessly via `structuredClone()`, which implements the same
 * algorithm IndexedDB uses internally.
 */
export function reviveWorld(raw: World): World {
  Object.setPrototypeOf(raw.rng, Rng.prototype);
  Object.setPrototypeOf(raw.players, PlayerStore.prototype);
  Object.setPrototypeOf(raw.players.names, StringTable.prototype);
  // Saves from before positions could be learnt: a trained secondary is known in full, the rest not at all.
  if (raw.players.familiarity === undefined) {
    raw.players.familiarity = new Uint8Array(raw.players.id.length * POSITION_SLOTS);
    for (let i = 0; i < raw.players.count; i++) {
      const second = raw.players.secondary[i];
      if (second >= 0) raw.players.familiarity[i * POSITION_SLOTS + second] = 100;
    }
  }
  // Saves from before playing time was tracked: everyone starts in between.
  raw.players.playingTime ??= new Uint8Array(raw.players.id.length).fill(PLAYING_TIME_UNKNOWN);
  // Saves from before the playoff system existed have no bracket state at all.
  for (const comp of raw.competitions) {
    comp.playoffGroups ??= [];
  }
  // Saves from before pre-match interviews existed have neither field.
  raw.pendingInterviews ??= [];
  raw.interviewedFixtures ??= new Set();
  // Saves from before post-match conferences: sessions were known by their fixture.
  raw.nextInterviewId ??= 0;
  for (const s of raw.pendingInterviews) {
    if (s.id !== undefined) continue;
    s.id = raw.nextInterviewId++;
    s.kind = 'pre';
    s.occasion ??= 'League match';
    s.stakes ??= 'routine';
    s.crowd ??= s.questions.length * 2;
    const msg = raw.messages.find((m) => m.category === 'interview' && m.fixtureId === s.fixtureId && m.interviewId === undefined);
    if (msg !== undefined) msg.interviewId = s.id;
  }
  // Saves from before match ratings and the second libero existed.
  raw.competitionRecords ??= new Map();
  raw.ratingForm ??= new Map();
  // Saves from before the season review existed have no transfer log.
  raw.transferLog ??= [];
  // Saves from before contract negotiations and transfer windows.
  raw.talksBlockedUntil ??= new Map();
  raw.talks ??= [];
  raw.nextTalksId ??= 0;
  // Saves from before loans, and deals done while the window was shut, existed.
  raw.loans ??= [];
  raw.pendingMoves ??= [];
  // Saves from before the world's news.
  raw.news ??= [];
  // National jobs and dual nationals came later than the tournaments.
  if (raw.internationals !== undefined) {
    raw.internationals.tiedTo ??= new Map();
    raw.internationals.vacancies ??= [];
    raw.internationals.applications ??= [];
    raw.internationals.chosen ??= null;
    raw.internationals.dualFrom ??= 0;
    raw.internationals.offers ??= [];
    raw.internationals.nextOfferId ??= 0;
    raw.internationals.lastApproach ??= -1;
    raw.internationals.squadAsked ??= [];
  }
  raw.nextNewsId ??= 0;
  // Saves from before international duty needed a ninth player flag.
  if (!(raw.players.flags instanceof Uint16Array)) raw.players.flags = Uint16Array.from(raw.players.flags);
  // Saves from before the other hand was rated: each player's is rolled, as a new world would.
  if (raw.players.offHand === undefined) {
    raw.players.offHand = new Uint8Array(raw.players.id.length).fill(5);
    for (let i = 0; i < raw.players.count; i++) rollOffHand(raw.players, i);
  }
  // Saves from before players had a hitting hand: each is given one, as a new world would.
  if (raw.handedness !== true) {
    for (let i = 0; i < raw.players.count; i++) rollHandedness(raw.players, i);
    raw.handedness = true;
  }
  // Saves from before the manager had a career: the club being managed
  // becomes the first job on record.
  backfillCareer(raw);
  migrateContractDays(raw.players);
  // Saves from before the cups were played: national cups, super cups and the
  // Club World Championship are added; all of them start with the next season.
  ensureCupCompetitions(raw);
  // The Club World Championship is every fourth year: one drawn before that for any other comes off.
  cancelOffCycleClubWorld(raw);
  for (const club of raw.clubs) {
    club.preferredDefensiveLibero ??= -1;
    migrateLineupOrder(club.preferredLineup, raw.players.position);
  }
  // Saves from before the other coaches picked their own tactics: they pick them now, not next season.
  if (raw.coachedSides !== true) {
    coachesSetUp(raw, (club) => pickLineup(raw.players, club).lineup);
    raw.coachedSides = true;
  }
  return raw;
}

/**
 * Contracts now always end on 30 June — the last day of a season. Older saves
 * stored any day, and a contract ran until the first season rollover (season
 * day 350) on or after it; each is moved to the 30 June of that same season,
 * so nobody's contract gets longer or shorter. Already-aligned days are left
 * alone, which makes this safe to run on every load.
 */
function migrateContractDays(store: PlayerStore): void {
  for (let i = 0; i < store.count; i++) {
    const day = store.contractUntil[i];
    if (day % DAYS_PER_SEASON === DAYS_PER_SEASON - 1) continue;
    store.contractUntil[i] = seasonEndDay(Math.max(0, Math.ceil((day - 350) / DAYS_PER_SEASON)));
  }
}

/**
 * Saves from before the rotational order was corrected stored the default
 * lineup as S-MB-OH-OPP-MB-OH; slots are now S-OH-MB-OPP-OH-MB (see
 * LINEUP_SLOT_POSITIONS). An old-order lineup is recognised by a middle in
 * slot 1 or 4, or an outside in slot 2 or 5 — impossible in the new order —
 * and has those pairs swapped back into place, so nobody's chosen six is lost.
 */
function migrateLineupOrder(lineup: number[], positions: ArrayLike<number>): void {
  const at = (slot: number): number => {
    const p = lineup[slot];
    return p !== undefined && p >= 0 ? positions[p] : -1;
  };
  const oldOrder =
    at(1) === Position.MiddleBlocker || at(2) === Position.OutsideHitter ||
    at(4) === Position.MiddleBlocker || at(5) === Position.OutsideHitter;
  if (!oldOrder) return;
  while (lineup.length < 6) lineup.push(-1);
  [lineup[1], lineup[2]] = [lineup[2], lineup[1]];
  [lineup[4], lineup[5]] = [lineup[5], lineup[4]];
}
