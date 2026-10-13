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
 *
 * A long career in a large world runs to hundreds of megabytes of JSON — more
 * than a browser can hold in one string — so the file is never one string.
 * It is written and read as a stream of lines, each a small piece of JSON:
 *
 *   {"format":"volleyball-manager-career","version":2}   the header
 *   ["o","world"]        open an object under that key   (["a",k] an array,
 *   ["k",{...}]          properties of the open object     ["t",k,"Map"] a Map
 *   ["p",[...]]          items of the open array            or Set's entries)
 *   ["c"]                close it
 *   ["end"]              the last line: the file is whole
 *
 * Anything with more than a few hundred parts is opened and written part by
 * part, everything smaller goes as plain JSON. Files from the first version —
 * the whole career as one JSON text — still read.
 */

import { StringTable } from '../engine/model/players.ts';
import type { SeasonContext } from '../engine/season/seasonEngine.ts';
import type { World } from '../engine/world/world.ts';
import { reviveSeason, reviveWorld, type SaveMeta, type SavedSeason } from './persistence.ts';

const FORMAT = 'volleyball-manager-career';
const VERSION = 2;

/** What a career file holds. */
interface CareerFile {
  format: typeof FORMAT;
  version: number;
  meta: SaveMeta;
  world: World;
  season: SavedSeason;
}

/** Something wrong with the file itself, said plainly to the player. */
class CareerFileError extends Error {}

const NOT_A_CAREER = 'That file is not a career from this game.';
const DAMAGED = 'That career file is damaged or incomplete — export it again.';

/** A container with more parts than this is written part by part. */
const SPLIT_ABOVE = 512;
/** Roughly how much JSON goes on one line, and in one chunk of the stream. */
const LINE_CHARS = 1 << 18;
const CHUNK_CHARS = 1 << 20;

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
export function careerReplacer(this: unknown, _key: string, value: unknown): unknown {
  // Called for every value in the world: the common cases first.
  switch (typeof value) {
    case 'object': break;
    case 'number': return Number.isFinite(value) ? value : { __vm: 'num', v: String(value) };
    // An undefined in an array would come back as null: keep it undefined.
    case 'undefined': return Array.isArray(this) ? { __vm: 'undef' } : value;
    default: return value;
  }
  if (value === null) return value;
  if (value instanceof Map) return { __vm: 'Map', v: [...value.entries()] };
  if (value instanceof Set) return { __vm: 'Set', v: [...value] };
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name as TypedName;
    if (name in TYPED) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { __vm: name, b: toBase64(bytes) };
    }
  }
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

/** A value as JSON.stringify sees it: its toJSON first, then the tags. */
function prepared(holder: object, key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    value = (value as { toJSON(key: string): unknown }).toJSON(key);
  }
  return careerReplacer.call(holder, key, value);
}

/** A Map or Set, as tagged: its entries. */
function taggedEntries(value: object): unknown[] | null {
  const t = value as { __vm?: unknown; v?: unknown };
  return (t.__vm === 'Map' || t.__vm === 'Set') && Array.isArray(t.v) ? t.v : null;
}

/** Tagged, but not a Map or Set: a typed array, a NaN — one piece, never taken apart. */
function isTaggedLeaf(value: object): boolean {
  return '__vm' in value && taggedEntries(value) === null;
}

function partsOf(value: object): number {
  if (Array.isArray(value)) return value.length;
  const entries = taggedEntries(value);
  return entries !== null ? entries.length : Object.keys(value).length;
}

/** The lines inside an open object or array. */
function* bodyLines(container: object, root: boolean): Generator<string> {
  const isArray = Array.isArray(container);
  const keys = isArray ? null : Object.keys(container);
  const n = isArray ? container.length : keys!.length;
  let batch: string[] = [];
  let size = 0;
  const flush = (): string => {
    const line = isArray ? `["p",[${batch.join(',')}]]` : `["k",{${batch.join(',')}}]`;
    batch = [];
    size = 0;
    return line;
  };
  for (let i = 0; i < n; i++) {
    const key = isArray ? String(i) : keys![i];
    const value = prepared(container, key, (container as Record<string, unknown>)[key]);
    if (!isArray && (value === undefined || typeof value === 'function' || typeof value === 'symbol')) continue;
    const isContainer = value !== null && typeof value === 'object' && !isTaggedLeaf(value);
    let text: string | undefined;
    let split = isContainer && (root || partsOf(value as object) > SPLIT_ABOVE);
    if (!split) {
      try {
        text = JSON.stringify(value, careerReplacer);
      } catch (err) {
        // Too long for one string: take it apart instead.
        if (!(err instanceof RangeError) || !isContainer) throw err;
        split = true;
      }
    }
    if (split) {
      if (batch.length > 0) yield flush();
      const at = JSON.stringify(isArray ? i : key);
      const entries = taggedEntries(value as object);
      if (entries !== null) {
        yield `["t",${at},${JSON.stringify((value as { __vm: string }).__vm)}]`;
        yield* bodyLines(entries, false);
      } else {
        yield `[${Array.isArray(value) ? '"a"' : '"o"'},${at}]`;
        yield* bodyLines(value as object, false);
      }
      yield '["c"]';
      continue;
    }
    const part = isArray ? (text ?? 'null') : `${JSON.stringify(key)}:${text}`;
    batch.push(part);
    size += part.length;
    if (size >= LINE_CHARS) yield flush();
  }
  if (batch.length > 0) yield flush();
}

/** An object as the lines of a career file. */
export function* fileLines(value: object): Generator<string> {
  yield JSON.stringify({ format: FORMAT, version: VERSION });
  yield* bodyLines(value, true);
  yield '["end"]';
}

/** The lines, as bytes, a megabyte at a time — gzipped where the platform can. */
function encodeFile(value: object): ReadableStream<Uint8Array> {
  const lines = fileLines(value);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk = '';
      while (chunk.length < CHUNK_CHARS) {
        const next = lines.next();
        if (next.done === true) {
          if (chunk !== '') controller.enqueue(encoder.encode(chunk));
          controller.close();
          return;
        }
        chunk += `${next.value}\n`;
      }
      controller.enqueue(encoder.encode(chunk));
    },
  });
  if (typeof CompressionStream === 'undefined') return stream;
  return stream.pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

/** A file's text, a line at a time — gunzipped if it was gzipped. */
async function* fileTextLines(file: Blob): AsyncGenerator<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  let bytes = file.stream() as ReadableStream<Uint8Array>;
  if (gzipped) {
    if (typeof DecompressionStream === 'undefined') throw new CareerFileError('This browser cannot open compressed career files.');
    bytes = bytes.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  }
  const reader = bytes.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  // The start of a line still being read, in pieces: one long line (a first-version file is
  // all one line) is only joined up once, when it ends.
  let pending: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let start = 0;
    for (let nl = value.indexOf('\n'); nl >= 0; nl = value.indexOf('\n', start)) {
      pending.push(value.slice(start, nl));
      yield pending.join('');
      pending = [];
      start = nl + 1;
    }
    if (start < value.length) pending.push(value.slice(start));
  }
  if (pending.length > 0) yield pending.join('');
}

type Node = Record<string, unknown> | unknown[];

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  else target[key] = value;
}

/** A career file read back as the object it was written from. */
export async function readCareerFile(file: Blob): Promise<Record<string, unknown>> {
  const lines = fileTextLines(file);
  let first: IteratorResult<string>;
  let header: { format?: unknown; version?: unknown };
  try {
    first = await lines.next();
    header = JSON.parse(first.done === true ? '' : first.value, reviver) as typeof header;
  } catch (err) {
    void lines.return(undefined);
    if (err instanceof CareerFileError) throw err;
    throw new CareerFileError(NOT_A_CAREER);
  }
  if (header === null || typeof header !== 'object' || header.format !== FORMAT) {
    void lines.return(undefined);
    throw new CareerFileError(NOT_A_CAREER);
  }
  // The first version: the whole career was that one line.
  if (header.version === 1) return header as Record<string, unknown>;
  if (header.version !== VERSION) throw new CareerFileError('That career file comes from a newer version of the game.');

  const root: Record<string, unknown> = {};
  interface Frame { node: Node; parent: Node | null; key: string | number; tag: string | null }
  let top: Frame = { node: root, parent: null, key: '', tag: null };
  const frames: Frame[] = [];
  let whole = false;
  const open = (key: string | number, node: Node, tag: string | null): void => {
    if (Array.isArray(top.node)) top.node.push(node);
    else setOwn(top.node, String(key), node);
    frames.push(top);
    top = { node, parent: top.node, key, tag };
  };
  try {
    for await (const line of lines) {
      if (line === '') continue;
      if (whole) throw new CareerFileError(DAMAGED);
      // Most lines hold nothing tagged, and parse much faster without the reviver.
      const op = (line.includes('"__vm"') ? JSON.parse(line, reviver) : JSON.parse(line)) as [string, unknown, unknown?];
      switch (op[0]) {
        case 'k': {
          if (Array.isArray(top.node)) throw new CareerFileError(DAMAGED);
          const props = op[1] as Record<string, unknown>;
          for (const k of Object.keys(props)) setOwn(top.node, k, props[k]);
          break;
        }
        case 'p': {
          if (!Array.isArray(top.node)) throw new CareerFileError(DAMAGED);
          const items = op[1] as unknown[];
          for (let i = 0; i < items.length; i++) top.node.push(items[i]);
          break;
        }
        case 'o': open(op[1] as string, {}, null); break;
        case 'a': open(op[1] as number, [], null); break;
        case 't': open(op[1] as string, [], String(op[2])); break;
        case 'c': {
          const done = top;
          const parent = frames.pop();
          if (parent === undefined) throw new CareerFileError(DAMAGED);
          top = parent;
          if (done.tag !== null) {
            // A Map or Set, written entry by entry: now it can be one again.
            const revived = reviver('', { __vm: done.tag, v: done.node });
            if (Array.isArray(top.node)) top.node[top.node.length - 1] = revived;
            else setOwn(top.node, String(done.key), revived);
          }
          break;
        }
        case 'end':
          if (frames.length > 0) throw new CareerFileError(DAMAGED);
          whole = true;
          break;
        default:
          throw new CareerFileError(DAMAGED);
      }
    }
  } catch (err) {
    if (err instanceof CareerFileError) throw err;
    // Bad JSON, a broken gzip stream, a line cut short.
    if (err instanceof SyntaxError || err instanceof TypeError) throw new CareerFileError(DAMAGED);
    throw err;
  }
  if (!whole) throw new CareerFileError(DAMAGED);
  return { ...root, format: FORMAT, version: VERSION };
}

/** A career as the bytes of its file, made as they are read: never all in memory at once. */
export function careerFileStream(meta: SaveMeta, world: World, season: SeasonContext): ReadableStream<Uint8Array> {
  const file: CareerFile = {
    format: FORMAT,
    version: VERSION,
    meta,
    world,
    season: { stats: season.stats, seasonStartAbility: season.seasonStartAbility },
  };
  return encodeFile(file);
}

/** A career written out as a file. */
export async function exportCareer(meta: SaveMeta, world: World, season: SeasonContext): Promise<Blob> {
  return new Response(careerFileStream(meta, world, season)).blob();
}

/** A career read back from a file — ready to play, or to save. */
export async function importCareer(file: Blob): Promise<{ meta: SaveMeta; world: World; season: SeasonContext }> {
  let parsed: CareerFile;
  try {
    parsed = (await readCareerFile(file)) as unknown as CareerFile;
  } catch (err) {
    if (err instanceof CareerFileError) throw err;
    throw new Error(`Could not read that career file: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed.world === undefined || parsed.meta === undefined) throw new CareerFileError(NOT_A_CAREER);
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
