/**
 * Tactic files, the way FM shares its .fmf files: one tactic per file, a
 * plain JSON document that can be saved from one career and loaded into
 * another — or handed to a friend, who drops it in the game's `tactics`
 * folder.
 *
 * The file holds the whole plan: the system, the team and rotation
 * instructions, the zone, block, defence and receive plans — and the team
 * sheet that went with it. The team sheet names players, who may not be at
 * the club that loads it: each is written with his id, FIVB number, name and
 * position, and found again by the first of them that matches; anyone not
 * found leaves his slot to the usual pick. Familiarity is not in the file —
 * it is how well a squad knows the tactic, not part of it: a loaded tactic is
 * new to the side.
 *
 * Reading never trusts the file. Anything unreadable fails with a reason;
 * anything readable but out of range is put back to the default, with a
 * warning, so a hand-edited or older file still loads.
 */

import { BLOCK_TARGETS, type BlockPlan, type BlockPlans, defaultRotationTactics, defaultTactics, defaultZonePlans,
  FORMATION_NAMES, formationOf, PASS_ZONES, type PipeBall, ROTATION_PLAYS, type RotationPlay, type RotationTactics,
  type TeamTactics, type ZonePlan, type ZonePlans } from '../match/tactics.ts';
import { ATTACK_SOURCES, defaultDefenceLayouts, type DefenceLayout, type DefenceLayouts, type Spot } from '../match/defence.ts';
import { defaultReceivePlans, type ReceiveLayout, type ReceivePlans, SERVE_KINDS, SERVE_STYLES, SERVE_ZONES,
  type ServeStyle, type ServeZone, type ServerOrdersMap } from '../match/serveReceive.ts';
import { freshFamiliarity, NEW_TACTIC_FAMILIARITY } from '../match/tacticFamiliarity.ts';
import type { PlayerStore } from './players.ts';
import type { Position } from './positions.ts';
import type { SavedTactic } from './tacticSlots.ts';

export const TACTIC_FILE_FORMAT = 'volleyball-manager-tactic';
export const TACTIC_FILE_VERSION = 1;
export const TACTIC_FILE_EXT = '.vmtac';
/** Anything bigger is not a tactic. */
export const TACTIC_FILE_MAX_BYTES = 512 * 1024;

/** A player named in a file: found again by id, by FIVB number, then by name. */
export interface TacticPlayerRef {
  id: number;
  fivbId?: number;
  name: string;
  position: Position;
}

export interface TacticFile {
  format: typeof TACTIC_FILE_FORMAT;
  version: number;
  name: string;
  /** ISO date and time it was written. */
  saved?: string;
  /** The club it was made at, for the list. */
  club?: string;
  /** Everything but the servers' orders (by player, below) and familiarity (the squad's own). */
  tactics: Omit<TeamTactics, 'servers' | 'familiarity'>;
  /** The system the six was picked for by hand, if it was. */
  preferredFormation?: number;
  players: {
    lineup: (TacticPlayerRef | null)[];
    libero: TacticPlayerRef | null;
    defensiveLibero: TacticPlayerRef | null;
    servers: (TacticPlayerRef & { style?: ServeStyle; zone?: ServeZone })[];
  };
}

export type TacticParse =
  | { ok: true; file: TacticFile; warnings: string[] }
  | { ok: false; error: string };

// ---- Writing ----------------------------------------------------------------------------------

function refOf(store: PlayerStore, p: number): TacticPlayerRef | null {
  if (p < 0 || p >= store.count) return null;
  const fivb = store.fivbId[p];
  return { id: store.id[p], ...(fivb > 0 ? { fivbId: fivb } : {}), name: store.fullName(p), position: store.position[p] };
}

/** A saved tactic as a file, its players named so another squad can find them. */
export function tacticToFile(t: SavedTactic, store: PlayerStore, clubName?: string, now = new Date()): TacticFile {
  const { servers, familiarity: _f, ...tactics } = structuredClone(t.tactics);
  const serverRefs: TacticFile['players']['servers'] = [];
  for (const [k, orders] of Object.entries(servers ?? {})) {
    const ref = refOf(store, Number(k));
    if (ref !== null && (orders.style !== undefined || orders.zone !== undefined)) serverRefs.push({ ...ref, ...orders });
  }
  return {
    format: TACTIC_FILE_FORMAT,
    version: TACTIC_FILE_VERSION,
    name: t.name,
    saved: now.toISOString(),
    ...(clubName !== undefined ? { club: clubName } : {}),
    tactics,
    ...(t.preferredFormation !== undefined ? { preferredFormation: t.preferredFormation } : {}),
    players: {
      lineup: t.preferredLineup.map((p) => refOf(store, p)),
      libero: refOf(store, t.preferredLibero),
      defensiveLibero: refOf(store, t.preferredDefensiveLibero),
      servers: serverRefs,
    },
  };
}

export function serialiseTacticFile(f: TacticFile): string {
  return `${JSON.stringify(f, null, 2)}\n`;
}

/** A name that is safe as a file name on every system — the extension added. */
export function tacticFileName(name: string): string {
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
  const safe = clean === '' || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? 'Tactic' : clean;
  return `${safe}${TACTIC_FILE_EXT}`;
}

// ---- Reading ----------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads one file's fields, putting back the default and noting it wherever one is wrong. */
class Reader {
  readonly warnings: string[] = [];

  private warn(what: string): void {
    if (this.warnings.length < 20) this.warnings.push(what);
  }

  /** A whole number in [min, max]; absent is the default, quietly. */
  int(v: unknown, min: number, max: number, def: number, what: string): number {
    if (v === undefined) return def;
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
    this.warn(`${what} was not valid`);
    return def;
  }

  /** As int, but absent stays absent. */
  optInt(v: unknown, min: number, max: number, what: string): number | undefined {
    if (v === undefined) return undefined;
    if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
    this.warn(`${what} was not valid`);
    return undefined;
  }

  oneOf<T>(v: unknown, allowed: readonly T[], what: string): T | undefined {
    if (v === undefined) return undefined;
    if (allowed.includes(v as T)) return v as T;
    this.warn(`${what} was not valid`);
    return undefined;
  }

  bool(v: unknown, def: boolean, what: string): boolean {
    if (v === undefined) return def;
    if (typeof v === 'boolean') return v;
    this.warn(`${what} was not valid`);
    return def;
  }

  spot(v: unknown, def: Spot, what: string): Spot {
    const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
    if (isObj(v) && ok(v.u) && ok(v.v)) return { u: v.u, v: v.v };
    this.warn(`${what} was not valid`);
    return { ...def };
  }

  zones(v: unknown): ZonePlans | undefined {
    if (v === undefined) return undefined;
    const def = defaultZonePlans();
    if (!isObj(v)) { this.warn('The zone plans were not valid'); return def; }
    const out = {} as ZonePlans;
    for (const z of PASS_ZONES) {
      const d = def[z];
      const s = v[z];
      if (!isObj(s)) { if (s !== undefined) this.warn(`Zone ${z} was not valid`); out[z] = d; continue; }
      const plan: ZonePlan = {
        middle: this.int(s.middle, 0, 5, d.middle, `Zone ${z} middle`),
        pins: this.int(s.pins, 0, 2, d.pins, `Zone ${z} pins`),
        combos: this.bool(s.combos, d.combos, `Zone ${z} combinations`),
        backRow: this.int(s.backRow, 0, 3, d.backRow, `Zone ${z} back row`),
        target: this.int(s.target, 0, 4, d.target, `Zone ${z} target`),
      };
      const mb = this.optInt(s.middleBack, 0, 5, `Zone ${z} middle (setter back)`);
      if (mb !== undefined) plan.middleBack = mb;
      out[z] = plan;
    }
    return out;
  }

  defence(v: unknown): DefenceLayouts | undefined {
    if (v === undefined) return undefined;
    const def = defaultDefenceLayouts();
    if (!isObj(v)) { this.warn('The defence layouts were not valid'); return def; }
    const out = {} as DefenceLayouts;
    for (const src of ATTACK_SOURCES) {
      const d = def[src];
      const l = v[src];
      if (!isObj(l)) { if (l !== undefined) this.warn(`The defence against the ${src} was not valid`); out[src] = d; continue; }
      const layout: DefenceLayout = {
        lb: this.spot(l.lb, d.lb, 'A defender'), mb: this.spot(l.mb, d.mb, 'A defender'),
        rb: this.spot(l.rb, d.rb, 'A defender'), free: this.spot(l.free, d.free, 'A defender'),
      };
      out[src] = layout;
    }
    return out;
  }

  blockPlans(v: unknown): BlockPlans | undefined {
    if (v === undefined) return undefined;
    const out = {} as BlockPlans;
    const bad = !isObj(v);
    if (bad) this.warn('The block plans were not valid');
    for (const target of BLOCK_TARGETS) {
      const s = bad ? undefined : (v as Obj)[target];
      const plan: BlockPlan = { focus: 0, numbers: 2 };
      if (isObj(s)) {
        plan.focus = this.int(s.focus, 0, 2, 0, `The block on the ${target}`);
        plan.numbers = this.int(s.numbers, 1, 3, 2, `The block on the ${target}`);
        if (s.spots !== undefined) {
          const spots = s.spots;
          if (Array.isArray(spots) && spots.length === 3
            && spots.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 4)) {
            plan.spots = [...spots] as number[];
          } else {
            this.warn(`The block spots on the ${target} were not valid`);
          }
        }
      } else if (s !== undefined) {
        this.warn(`The block on the ${target} was not valid`);
      }
      out[target] = plan;
    }
    return out;
  }

  receive(v: unknown): ReceivePlans | undefined {
    if (v === undefined) return undefined;
    const def = defaultReceivePlans();
    if (!isObj(v)) { this.warn('The receive lines were not valid'); return def; }
    const out = {} as ReceivePlans;
    for (const kind of SERVE_KINDS) {
      const d = def[kind];
      const l = v[kind];
      if (!isObj(l)) { if (l !== undefined) this.warn(`The receive line against a ${kind} serve was not valid`); out[kind] = d; continue; }
      const line: ReceiveLayout = {
        left: this.spot(l.left, d.left, 'A passer'), middle: this.spot(l.middle, d.middle, 'A passer'),
        right: this.spot(l.right, d.right, 'A passer'),
      };
      if (l.overhead !== undefined) line.overhead = this.bool(l.overhead, false, 'Taking the float overhead');
      out[kind] = line;
    }
    return out;
  }

  rotations(v: unknown): RotationTactics[] {
    if (!Array.isArray(v) || v.length !== 6) {
      if (v !== undefined) this.warn('The rotations were not valid');
      return Array.from({ length: 6 }, defaultRotationTactics);
    }
    return v.map((r: unknown, i) => {
      const d = defaultRotationTactics();
      const what = `P${i + 1}`;
      if (!isObj(r)) { this.warn(`${what} was not valid`); return d; }
      const out: RotationTactics = {
        preferredAttacker: this.int(r.preferredAttacker, -1, 4, -1, `${what} preferred attacker`) as Position | -1,
        serveTarget: this.int(r.serveTarget, 0, 5, d.serveTarget, `${what} serve target`),
        blockAssignment: this.int(r.blockAssignment, 0, 3, d.blockAssignment, `${what} block`),
        defensiveShape: this.int(r.defensiveShape, 0, 2, d.defensiveShape, `${what} defence`),
        transitionBackRow: this.int(r.transitionBackRow, 0, 100, d.transitionBackRow, `${what} transition`),
        setterTempoBias: this.int(r.setterTempoBias, 0, 100, d.setterTempoBias, `${what} tempo`),
      };
      const receivers = this.oneOf(r.receivers, [2, 3, 4] as const, `${what} receivers`);
      if (receivers !== undefined) out.receivers = receivers;
      const play = this.oneOf<RotationPlay>(r.play, ROTATION_PLAYS, `${what} play`);
      if (play !== undefined) out.play = play;
      const pipe = this.oneOf<PipeBall>(r.pipeBall, ['left', 'middle', 'back'], `${what} pipe ball`);
      if (pipe !== undefined) out.pipeBall = pipe;
      return out;
    });
  }

  ref(v: unknown, what: string): TacticPlayerRef | null {
    if (v === null || v === undefined) return null;
    if (isObj(v) && typeof v.name === 'string' && typeof v.id === 'number' && Number.isInteger(v.id)
      && typeof v.position === 'number' && Number.isInteger(v.position) && v.position >= 0 && v.position <= 4) {
      const ref: TacticPlayerRef = { id: v.id, name: v.name.slice(0, 80), position: v.position as Position };
      if (typeof v.fivbId === 'number' && Number.isInteger(v.fivbId) && v.fivbId > 0) ref.fivbId = v.fivbId;
      return ref;
    }
    this.warn(`${what} was not valid`);
    return null;
  }
}

/** Read a tactic file: the tactic in it, every out-of-range value put back to the default — or why it can't be read. */
export function parseTacticFile(text: string): TacticParse {
  if (text.length > TACTIC_FILE_MAX_BYTES) return { ok: false, error: 'The file is too big to be a tactic.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'The file is not a tactic file (it could not be read).' };
  }
  if (!isObj(raw) || raw.format !== TACTIC_FILE_FORMAT) return { ok: false, error: 'The file is not a Volleyball Manager tactic.' };
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: 'The file has no valid version.' };
  }
  if (!isObj(raw.tactics)) return { ok: false, error: 'The file has no tactic in it.' };

  const r = new Reader();
  if (raw.version > TACTIC_FILE_VERSION) r.warnings.push('Made by a newer version of the game, some of it may not load');
  const t = raw.tactics;
  const def = defaultTactics();
  const tactics: TacticFile['tactics'] = {
    formation: r.int(t.formation, 0, 1, 0, 'The system'),
    offense: r.int(t.offense, 0, 6, def.offense, 'The offensive system'),
    defense: r.int(t.defense, 0, 4, def.defense, 'The defensive system'),
    serve: r.int(t.serve, 0, 2, def.serve, 'The serve strategy'),
    tempo: r.int(t.tempo, 0, 3, def.tempo, 'The tempo'),
    rotations: r.rotations(t.rotations),
  };
  const middlePlay = r.optInt(t.middlePlay, 0, 3, 'The middle play');
  if (middlePlay !== undefined) tactics.middlePlay = middlePlay;
  const combinations = r.optInt(t.combinations, 0, 2, 'The combinations');
  if (combinations !== undefined) tactics.combinations = combinations;
  const zones = r.zones(t.zones);
  if (zones !== undefined) tactics.zones = zones;
  const defence = r.defence(t.defence);
  if (defence !== undefined) tactics.defence = defence;
  const blockPlans = r.blockPlans(t.blockPlans);
  if (blockPlans !== undefined) tactics.blockPlans = blockPlans;
  const receive = r.receive(t.receive);
  if (receive !== undefined) tactics.receive = receive;

  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 32) : 'Imported tactic';
  const p = isObj(raw.players) ? raw.players : {};
  const lineupRaw = Array.isArray(p.lineup) ? p.lineup.slice(0, 6) : [];
  const servers: TacticFile['players']['servers'] = [];
  for (const s of Array.isArray(p.servers) ? p.servers.slice(0, 30) : []) {
    const ref = r.ref(s, 'A server');
    if (ref === null || !isObj(s)) continue;
    const style = r.oneOf<ServeStyle>(s.style, SERVE_STYLES, `${ref.name}'s serve`);
    const zone = r.oneOf<ServeZone>(s.zone, SERVE_ZONES, `${ref.name}'s serving zone`);
    if (style !== undefined || zone !== undefined) {
      servers.push({ ...ref, ...(style !== undefined ? { style } : {}), ...(zone !== undefined ? { zone } : {}) });
    }
  }
  const file: TacticFile = {
    format: TACTIC_FILE_FORMAT,
    version: raw.version,
    name,
    ...(typeof raw.saved === 'string' ? { saved: raw.saved.slice(0, 40) } : {}),
    ...(typeof raw.club === 'string' ? { club: raw.club.slice(0, 60) } : {}),
    tactics,
    ...(raw.preferredFormation !== undefined
      ? { preferredFormation: r.optInt(raw.preferredFormation, 0, 1, 'The team sheet system') } : {}),
    players: {
      lineup: lineupRaw.map((x, i) => r.ref(x, `Slot ${i + 1}`)),
      libero: r.ref(p.libero, 'The libero'),
      defensiveLibero: r.ref(p.defensiveLibero, 'The defensive libero'),
      servers,
    },
  };
  if (file.preferredFormation === undefined) delete file.preferredFormation;
  return { ok: true, file, warnings: r.warnings };
}

/** "5-1" — the system a file plays. */
export function tacticFileFormation(f: TacticFile): string {
  return FORMATION_NAMES[formationOf(f.tactics)];
}

// ---- Into a squad -----------------------------------------------------------------------------

/**
 * Find a file's player in a squad: the same player (id and name) first — the
 * file saved at this club in this career — then by FIVB number, then by name,
 * if only one has it. -1 when he isn't there.
 */
function findPlayer(ref: TacticPlayerRef | null, squad: readonly number[], store: PlayerStore): number {
  if (ref === null) return -1;
  const same = squad.find((p) => store.id[p] === ref.id && store.fullName(p) === ref.name);
  if (same !== undefined) return same;
  if (ref.fivbId !== undefined) {
    const fivb = squad.find((p) => store.fivbId[p] === ref.fivbId);
    if (fivb !== undefined) return fivb;
  }
  const byName = squad.filter((p) => store.fullName(p) === ref.name);
  return byName.length === 1 ? byName[0] : -1;
}

export interface FileTactic {
  tactic: SavedTactic;
  /** How many of the players the file names are at the club. */
  found: number;
  named: number;
}

/**
 * A file's tactic for a squad: its players found in it — anyone not found
 * leaves his slot to the usual pick — and new to the side.
 */
export function tacticFromFile(f: TacticFile, squad: readonly number[], store: PlayerStore): FileTactic {
  const tactics: TeamTactics = structuredClone(f.tactics);
  let named = 0;
  let found = 0;
  const taken = new Set<number>();
  const find = (ref: TacticPlayerRef | null): number => {
    if (ref === null) return -1;
    named++;
    const p = findPlayer(ref, squad, store);
    if (p < 0 || taken.has(p)) return -1;
    found++;
    taken.add(p);
    return p;
  };
  const lineup = f.players.lineup.map(find);
  const libero = find(f.players.libero);
  const defensiveLibero = find(f.players.defensiveLibero);
  const servers: ServerOrdersMap = {};
  for (const s of f.players.servers) {
    const p = findPlayer(s, squad, store);
    if (p < 0) continue;
    servers[p] = { ...(s.style !== undefined ? { style: s.style } : {}), ...(s.zone !== undefined ? { zone: s.zone } : {}) };
  }
  if (Object.keys(servers).length > 0) tactics.servers = servers;
  tactics.familiarity = freshFamiliarity(tactics, NEW_TACTIC_FAMILIARITY);
  const anyone = lineup.some((p) => p >= 0);
  return {
    tactic: {
      name: f.name,
      tactics,
      // An all-empty sheet is no sheet: the six is picked afresh.
      preferredLineup: anyone ? lineup : [],
      preferredLibero: libero,
      preferredDefensiveLibero: defensiveLibero,
      ...(anyone && f.preferredFormation !== undefined ? { preferredFormation: f.preferredFormation } : {}),
    },
    found,
    named,
  };
}
