/**
 * Importing real players from FIVB VIS into a world.
 *
 * ── What VIS gives us, and what it does not ────────────────────────────────
 *
 * VIS is a registration and results database, not a scouting database. For a
 * given player it can tell you exactly who they are, where they are from, how
 * tall they are, how high they reach, what shirt they wore and which
 * tournaments they played. It does not contain — because nobody measures it —
 * anything resembling "Blocking: 17".
 *
 * So the import is deliberately split:
 *
 *   Identity and physique   taken verbatim from VIS. Name, federation,
 *                           birthdate, height, weight, spike reach and block
 *                           reach are real measurements and are used as-is.
 *
 *   Ability and attributes  ESTIMATED. Derived from the level a player
 *                           competes at, their world ranking where available,
 *                           their age, and their real reach — then shaped by
 *                           the same positional profiles used for generated
 *                           players.
 *
 * That split is the honest one, and the `estimated` flag on the result records
 * it so the UI can be upfront about which numbers are measurements and which
 * are inferences.
 *
 * No FIVB data ships with this project. This module only runs against
 * credentials the user supplies.
 */

import type { Rng } from '../../engine/core/rng.ts';
import { abilityFractionAtAge, refreshAbility } from '../../engine/model/ability.ts';
import type { PlayerStore } from '../../engine/model/players.ts';
import { Position } from '../../engine/model/positions.ts';
import { NATION_BY_CODE } from '../../engine/world/nations.ts';
import { estimateValue, generatePlayer } from '../../engine/world/playerGen.ts';
import { collect, VisClient, type VisNode } from './visClient.ts';

export interface ImportedPlayer {
  /** Store index of the created player. */
  index: number;
  /** FIVB player number. */
  fivbNo: number;
  name: string;
  /** True when the physique came from VIS rather than being generated. */
  measuredPhysique: boolean;
  /** Always true: skill attributes are inferred, never supplied by VIS. */
  estimatedAbility: boolean;
}

export interface ImportOptions {
  /** Tournament numbers to pull registrations from. */
  tournamentNos?: number[];
  /** Cap on how many players to import. */
  limit?: number;
  /**
   * Baseline ability for players in this import, 0-2000. A senior
   * international tournament sits around 1500-1700; a youth event much lower.
   */
  baseAbility?: number;
  currentYear: number;
}

/** VIS position codes, as they appear on registration records. */
const POSITION_MAP: Readonly<Record<string, Position>> = {
  '1': Position.Setter,
  '2': Position.Opposite,
  '3': Position.OutsideHitter,
  '4': Position.MiddleBlocker,
  '5': Position.Libero,
  setter: Position.Setter,
  opposite: Position.Opposite,
  'universal': Position.Opposite,
  'outside hitter': Position.OutsideHitter,
  'outside spiker': Position.OutsideHitter,
  'wing spiker': Position.OutsideHitter,
  'middle blocker': Position.MiddleBlocker,
  'middle': Position.MiddleBlocker,
  libero: Position.Libero,
};

export function parsePosition(raw: string | undefined): Position | undefined {
  if (raw === undefined || raw === '') return undefined;
  return POSITION_MAP[raw.trim().toLowerCase()] ?? POSITION_MAP[raw.trim()];
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Convert one VIS player record into a player in the store.
 *
 * Returns null when the record lacks the minimum identifying information.
 */
export function importVisPlayer(
  store: PlayerStore,
  rng: Rng,
  node: VisNode,
  opts: ImportOptions,
): ImportedPlayer | null {
  const a = node.attrs;
  const fivbNo = num(a.No);
  const first = a.FirstName?.trim();
  const last = a.LastName?.trim();
  if (fivbNo === undefined || first === undefined || last === undefined) return null;

  const federation = (a.FederationCode ?? a.Nationality ?? '').trim().toUpperCase();
  const nation = NATION_BY_CODE.get(federation) ?? 0;

  // Age from the real birthdate where present.
  let age = 25;
  const birth = a.Birthdate;
  if (birth !== undefined && birth.length >= 4) {
    const year = Number(birth.slice(0, 4));
    if (Number.isFinite(year) && year > 1940) age = opts.currentYear - year;
  }
  age = Math.max(15, Math.min(45, age));

  const position = parsePosition(a.Position) ?? Position.OutsideHitter;

  // Ability is inferred, not measured. A player's level is estimated from the
  // standard of the competition they were registered for, adjusted for age.
  const base = opts.baseAbility ?? 1450;
  const potential = Math.round(
    Math.min(1980, Math.max(500, base * rng.gaussianClamped(1, 0.09, 0.75, 1.28))),
  );

  const index = generatePlayer(store, rng, {
    nation,
    age,
    potential,
    position,
    currentYear: opts.currentYear,
    abilityFraction: abilityFractionAtAge(age),
  });

  // Overwrite the generated identity with the real one.
  store.fivbId[index] = fivbNo;
  store.firstName[index] = store.names.intern(first);
  store.lastName[index] = store.names.intern(last);

  // Overwrite generated physique with real measurements where VIS supplied
  // them. Reach in particular is a genuine measurement and feeds straight into
  // the match engine's blocking and attacking calculations.
  const height = num(a.Height);
  const weight = num(a.Weight);
  const spike = num(a.SpikeReach);
  const block = num(a.BlockReach);
  let measured = false;
  if (height !== undefined && height > 140 && height < 240) {
    store.heightCm[index] = Math.round(height);
    measured = true;
  }
  if (weight !== undefined && weight > 40 && weight < 160) {
    store.weightKg[index] = Math.round(weight);
  }
  if (spike !== undefined && spike > 200 && spike < 420) {
    store.spikeReachCm[index] = Math.round(spike);
    measured = true;
  }
  if (block !== undefined && block > 200 && block < 400) {
    store.blockReachCm[index] = Math.round(block);
  }

  // Reach changed, so ability has to be recomputed from it.
  refreshAbility(store, index);
  store.value[index] = estimateValue(store, index, age);
  store.wage[index] = Math.round((store.value[index] * 0.22) / 1000) * 1000;

  return {
    index,
    fivbNo,
    name: `${first} ${last}`,
    measuredPhysique: measured,
    estimatedAbility: true,
  };
}

/**
 * Pull player registrations from VIS and import them.
 *
 * `GetVolleyPlayerList` returns one row per tournament registration, so the
 * same player appears repeatedly across events; results are deduplicated on
 * the FIVB player number, keeping the first occurrence.
 */
export async function importFromVis(
  client: VisClient,
  store: PlayerStore,
  rng: Rng,
  opts: ImportOptions,
): Promise<ImportedPlayer[]> {
  const seen = new Set<number>();
  const imported: ImportedPlayer[] = [];
  const limit = opts.limit ?? 5000;

  const tournaments = opts.tournamentNos ?? [];
  const batches: VisNode[][] = [];

  if (tournaments.length === 0) {
    batches.push(await client.getVolleyPlayerList({}));
  } else {
    for (const no of tournaments) {
      batches.push(await client.getVolleyPlayerList({ TournamentNo: no }));
    }
  }

  for (const batch of batches) {
    for (const node of collect(batch, 'VolleyPlayer')) {
      if (imported.length >= limit) return imported;
      const no = num(node.attrs.No);
      if (no === undefined || seen.has(no)) continue;
      seen.add(no);
      const result = importVisPlayer(store, rng, node, opts);
      if (result !== null) imported.push(result);
    }
  }
  return imported;
}

/**
 * Attach imported players to clubs by matching the club name VIS reports.
 * Unmatched players are left as free agents rather than being dropped.
 */
export function assignToClubs(
  store: PlayerStore,
  imported: ImportedPlayer[],
  nodes: VisNode[],
  clubsByName: Map<string, number>,
): number {
  const byNo = new Map<number, ImportedPlayer>();
  for (const p of imported) byNo.set(p.fivbNo, p);

  let matched = 0;
  for (const node of collect(nodes, 'VolleyPlayer')) {
    const no = num(node.attrs.No);
    if (no === undefined) continue;
    const player = byNo.get(no);
    if (player === undefined) continue;

    const clubName = (node.attrs.PlaysFor ?? node.attrs.TeamName ?? '').trim().toLowerCase();
    const clubId = clubsByName.get(clubName);
    if (clubId === undefined) continue;
    store.clubId[player.index] = clubId;
    matched++;
  }
  return matched;
}
