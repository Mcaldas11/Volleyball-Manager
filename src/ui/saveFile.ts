/**
 * A career as a file: exported to keep a copy outside the browser — the
 * browser's own storage can be cleared, and with it every save — and imported
 * back, here or on another computer.
 *
 * The World is almost all plain data, but not quite JSON: it holds Maps,
 * Sets, typed arrays (the whole player database lives in them) and the odd
 * NaN. Each is written as a tagged object and read back as what it was; the
 * three classes in the graph lose their prototypes exactly as they do in
 * IndexedDB, and `reviveWorld` restores them the same way. The file is
 * gzipped where the browser can.
 */

import { StringTable } from '../engine/model/players.ts';
import type { SeasonContext } from '../engine/season/seasonEngine.ts';
import type { World } from '../engine/world/world.ts';
import { reviveSeason, reviveWorld, type SaveMeta, type SavedSeason } from './persistence.ts';

/** What a career file holds. */
interface CareerFile {
  format: 'volleyball-manager-career';
  version: 1;
  meta: SaveMeta;
  world: World;
  season: SavedSeason;
}

const TYPED = {
  Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray,
} as const;
type TypedName = keyof typeof TYPED;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Everything JSON can't say, said as a tagged object. */
function replacer(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) return { __vm: 'num', v: String(value) };
  if (value instanceof Map) return { __vm: 'Map', v: [...value.entries()] };
  if (value instanceof Set) return { __vm: 'Set', v: [...value] };
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name as TypedName;
    if (name in TYPED) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { __vm: name, b: toBase64(bytes) };
    }
  }
  // An undefined in an array would come back as null: keep it undefined.
  if (value === undefined && Array.isArray(this)) return { __vm: 'undef' };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !('__vm' in value)) return value;
  const tagged = value as { __vm: string; v?: unknown; b?: string };
  switch (tagged.__vm) {
    case 'num': return Number(tagged.v);
    case 'undef': return undefined;
    case 'Map': return new Map(tagged.v as Array<[unknown, unknown]>);
    case 'Set': return new Set(tagged.v as unknown[]);
    default: {
      const Ctor = TYPED[tagged.__vm as TypedName];
      if (Ctor === undefined || tagged.b === undefined) return value;
      const bytes = fromBase64(tagged.b);
      // A fresh buffer, aligned for the element size.
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      return new Ctor(buf);
    }
  }
}

/** Gzip, where the platform can. */
async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([text], { type: 'application/json' });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

/** A file's text — gunzipped if it was gzipped. */
async function readText(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  if (!gzipped) return file.text();
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed career files.');
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** A career written out as a file. */
export async function exportCareer(meta: SaveMeta, world: World, season: SeasonContext): Promise<Blob> {
  const file: CareerFile = {
    format: 'volleyball-manager-career',
    version: 1,
    meta,
    world,
    season: { stats: season.stats, seasonStartAbility: season.seasonStartAbility },
  };
  return gzip(JSON.stringify(file, replacer));
}

/** A career read back from a file — ready to play, or to save. */
export async function importCareer(file: Blob): Promise<{ meta: SaveMeta; world: World; season: SeasonContext }> {
  let parsed: CareerFile;
  try {
    parsed = JSON.parse(await readText(file), reviver) as CareerFile;
  } catch {
    throw new Error('That file is not a career from this game.');
  }
  if (parsed?.format !== 'volleyball-manager-career' || parsed.world === undefined) {
    throw new Error('That file is not a career from this game.');
  }
  // The name table writes itself out as its list of names: put the table back together, same ids.
  const names = parsed.world.players.names as unknown;
  if (Array.isArray(names)) {
    const table = new StringTable();
    for (const n of names as string[]) table.intern(n);
    (parsed.world.players as { names: StringTable }).names = table;
  }
  const world = reviveWorld(parsed.world);
  return { meta: parsed.meta, world, season: reviveSeason(world, parsed.season) };
}

/** A file name for a career: "Alex Manager - Sada Blumenau - 12 Mar 2027.vmcareer". */
export function careerFileName(meta: SaveMeta): string {
  const clean = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '').trim();
  return `${clean(meta.managerName)} - ${clean(meta.clubName)} - ${clean(meta.inGameDate)}.vmcareer`;
}
