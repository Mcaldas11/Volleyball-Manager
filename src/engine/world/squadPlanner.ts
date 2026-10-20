/**
 * The squad planner: the squad by position over this season and the next two — who is under
 * contract for each, whose deal runs out, who is likely to stop, the academy players coming
 * through — and where it falls short of the depth a side needs. The manager marks transfer targets
 * against each gap.
 *
 * What a player will be worth in a season to come is a projection, not a promise: the young grow
 * towards their potential, the late twenties hold, the thirties fade.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, POSITIONS } from '../model/positions.ts';
import { loanOf, loansOutOf } from './loans.ts';
import { willRetire } from './retirement.ts';
import { contractEndSeason, seasonEndYear, type World } from './world.ts';

/** How many of each a squad wants: two setters, two opposites, four outsides, four middles, two liberos. */
export const PLAN_DEPTH: Readonly<Record<Position, number>> = {
  [Position.Setter]: 2,
  [Position.Opposite]: 2,
  [Position.OutsideHitter]: 4,
  [Position.MiddleBlocker]: 4,
  [Position.Libero]: 2,
};

/** Seasons the planner looks over: this one and the next two. */
export const PLAN_SEASONS = 3;

/** A player marked as a target for a gap: a position, in a season. */
export interface PlanTarget {
  p: number;
  position: Position;
  season: number;
  /** When he was marked. */
  day: number;
}

export interface SquadPlanState {
  targets: PlanTarget[];
}

export type PlanTag =
  /** His contract ends with this season. */
  | 'expires'
  /** He has said he will stop at the end of this season. */
  | 'retiring'
  /** Old enough by then that he may well stop. */
  | 'mayRetire'
  /** Here on loan: gone at the season's end. */
  | 'loanIn'
  /** Ours, out on loan this season: back for the next. */
  | 'loanOut'
  /** On the transfer list. */
  | 'listed'
  /** Signed, joining when the window opens. */
  | 'joining';

export interface PlanEntry {
  p: number;
  /** His age at that season's end. */
  age: number;
  /** His ability now, and as projected for that season. */
  now: number;
  ability: number;
  tags: PlanTag[];
}

export interface PlanCell {
  position: Position;
  season: number;
  /** The senior squad there that season, the best first. */
  players: PlanEntry[];
  /** Academy players of the position old enough by then to step up. */
  academy: PlanEntry[];
  /** The targets marked for this gap. */
  targets: PlanEntry[];
  /** How many short of the depth the position wants. */
  gaps: number;
}

export interface PlanSeasonSummary {
  season: number;
  /** Senior players under contract (on loan elsewhere included, from the season they are back). */
  squad: number;
  expiring: number;
  retiring: number;
  gaps: number;
  /** What the squad under contract will cost in wages that season, and the budget now. */
  wages: number;
  budget: number;
}

export interface SquadPlan {
  seasons: number[];
  /** By position (in POSITIONS order), then by season. */
  cells: PlanCell[][];
  summary: PlanSeasonSummary[];
}

/** The planner's targets, made on first use. */
export function planState(world: World): SquadPlanState {
  return world.squadPlan ??= { targets: [] };
}

/** A player's ability projected `years` seasons on: growing while young, holding, then fading. */
export function projectedAbility(world: World, p: number, years: number): number {
  const store = world.players;
  const pa = store.potentialAbility[p];
  let v = store.currentAbility[p];
  const age = store.ageOn(p, world.year, 181);
  for (let k = 0; k < years; k++) {
    const a = age + k;
    if (a < 24) v += Math.max(0, pa - v) * 0.35;
    else if (a < 28) v += Math.max(0, pa - v) * 0.15;
    else if (a >= 33) v *= 0.95;
    else if (a >= 30) v *= 0.975;
  }
  return Math.round(Math.min(2000, v));
}

/** A player's age at the end of a season. */
function ageIn(world: World, p: number, season: number): number {
  return world.players.ageOn(p, seasonEndYear(world, season), 181);
}

/** Old enough by a season's end that stopping is likely. */
const RETIRING_AGE = 35;

/** The plan for a club over this season and the next two. */
export function squadPlan(world: World, club: Club): SquadPlan {
  const store = world.players;
  const s0 = world.season;
  const seasons = Array.from({ length: PLAN_SEASONS }, (_, i) => s0 + i);
  const away = loansOutOf(world, club.id).map((l) => l.playerIdx);
  const joining = world.pendingMoves
    .filter((m) => m.kind === 'transfer' && m.toClubId === club.id)
    .map((m) => m.playerIdx);
  const pool = [...new Set([...club.players, ...away, ...joining])].filter((p) => store.isActive(p));
  const targets = planTargets(world, club);

  const entry = (p: number, season: number): PlanEntry => {
    const tags: PlanTag[] = [];
    const k = season - s0;
    const age = ageIn(world, p, season);
    if (club.players.includes(p) && !store.hasFlag(p, PlayerFlag.Youth)) {
      if (contractEndSeason(store.contractUntil[p]) === season) tags.push('expires');
    }
    if (away.includes(p) && contractEndSeason(store.contractUntil[p]) === season) tags.push('expires');
    if (k === 0 && willRetire(world, p)) tags.push('retiring');
    else if (age >= RETIRING_AGE) tags.push('mayRetire');
    if (k === 0 && loanOf(world, p)?.parentClubId !== undefined && loanOf(world, p)!.parentClubId !== club.id) tags.push('loanIn');
    if (k === 0 && away.includes(p)) tags.push('loanOut');
    if (store.hasFlag(p, PlayerFlag.Transferable)) tags.push('listed');
    if (joining.includes(p)) tags.push('joining');
    return { p, age, now: store.currentAbility[p], ability: projectedAbility(world, p, k), tags };
  };

  /** Whether a senior player is here, and counts, in a season. */
  const inSeason = (p: number, season: number): boolean => {
    if (store.hasFlag(p, PlayerFlag.Youth) && !joining.includes(p)) return false;
    const k = season - s0;
    const loan = loanOf(world, p);
    const loanedIn = loan !== undefined && loan.parentClubId !== club.id;
    if (loanedIn) return k === 0;
    if (contractEndSeason(store.contractUntil[p]) < season) return false;
    // Stopping at this season's end: gone from the next.
    if (k > 0 && willRetire(world, p)) return false;
    return true;
  };

  const cells = POSITIONS.map((position) => seasons.map((season): PlanCell => {
    const k = season - s0;
    const players = pool
      .filter((p) => store.position[p] === position && inSeason(p, season))
      .map((p) => entry(p, season))
      .sort((a, b) => b.ability - a.ability);
    // Away on loan this season: listed, but not counted towards the depth until he is back.
    const counted = players.filter((e) => !e.tags.includes('loanOut')).length;
    const academy = k === 0 ? [] : club.youthPlayers
      .filter((p) => store.isActive(p) && store.position[p] === position && ageIn(world, p, season) >= 18)
      .map((p) => entry(p, season))
      .sort((a, b) => b.ability - a.ability)
      .slice(0, 2);
    const marked = targets
      .filter((t) => t.position === position && t.season === season)
      .map((t) => entry(t.p, season));
    return { position, season, players, academy, targets: marked, gaps: Math.max(0, PLAN_DEPTH[position] - counted) };
  }));

  const summary = seasons.map((season, i): PlanSeasonSummary => {
    const here = pool.filter((p) => inSeason(p, season));
    const at = cells.map((row) => row[i]);
    return {
      season,
      squad: here.length,
      expiring: at.reduce((n, c) => n + c.players.filter((e) => e.tags.includes('expires')).length, 0),
      retiring: at.reduce((n, c) => n + c.players.filter((e) => e.tags.includes('retiring') || e.tags.includes('mayRetire')).length, 0),
      gaps: at.reduce((n, c) => n + c.gaps, 0),
      wages: Math.round(here.reduce((sum, p) => sum + store.wage[p], 0)),
      budget: club.finances.wageBudget,
    };
  });
  return { seasons, cells, summary };
}

/** The targets still worth showing: not signed by us since, still playing, in a season still ahead. */
export function planTargets(world: World, club: Club): PlanTarget[] {
  const store = world.players;
  return (world.squadPlan?.targets ?? []).filter((t) =>
    t.season >= world.season && store.isActive(t.p) && store.clubId[t.p] !== club.id
    && !world.pendingMoves.some((m) => m.playerIdx === t.p && m.toClubId === club.id));
}

/** Mark a player as a target for a gap — one gap at a time: marking him again moves him. */
export function addPlanTarget(world: World, p: number, position: Position, season: number): void {
  const state = planState(world);
  state.targets = state.targets.filter((t) => t.p !== p);
  state.targets.push({ p, position, season: Math.max(world.season, season), day: world.day });
}

export function removePlanTarget(world: World, p: number): void {
  const state = planState(world);
  state.targets = state.targets.filter((t) => t.p !== p);
}

export function isPlanTarget(world: World, p: number): boolean {
  return (world.squadPlan?.targets ?? []).some((t) => t.p === p);
}

/** Drop the targets that are done with: signed, retired, or for a season gone by. */
export function tidyPlanTargets(world: World, club: Club): void {
  if (world.squadPlan === undefined) return;
  world.squadPlan.targets = planTargets(world, club);
}

/** The first season a position falls short in, if it does — where a new target is wanted. */
export function firstGap(plan: SquadPlan, position: Position): number | null {
  const row = plan.cells[POSITIONS.indexOf(position)];
  return row?.find((c) => c.gaps > 0)?.season ?? null;
}

/**
 * Players worth marking for a position, the way a scout would put them forward: first those good
 * enough to matter here and within reach — a fee the club can find, a free agent, or a contract
 * that will have run out by the season in question — then the nearly-good-enough within reach,
 * and last the ones it would take more money — or a bigger club — to land. Nobody past 31 by then.
 */
export function planCandidates(world: World, club: Club, position: Position, limit = 40, season = world.season): number[] {
  const store = world.players;
  const ours = club.players.filter((p) => store.position[p] === position && !store.hasFlag(p, PlayerFlag.Youth));
  const level = ours.length > 0
    ? ours.map((p) => store.currentAbility[p]).sort((a, b) => a - b)[Math.floor(ours.length / 2)]
    : club.players.reduce((s, p) => s + store.currentAbility[p], 0) / Math.max(1, club.players.length);
  const budget = Math.max(club.finances.transferBudget * 1.25, 50_000);
  const tiers: number[][] = [[], [], []];
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.position[i] !== position || store.clubId[i] === club.id) continue;
    if (store.hasFlag(i, PlayerFlag.Youth) || store.hasFlag(i, PlayerFlag.Retired)) continue;
    if (world.loans.some((l) => l.playerIdx === i && l.parentClubId === club.id)) continue;
    // Still in his prime by the season he is wanted for.
    if (ageIn(world, i, season) > 31) continue;
    const ca = store.currentAbility[i];
    const free = store.clubId[i] < 0 || contractEndSeason(store.contractUntil[i]) < season;
    const reach = free || store.value[i] <= budget;
    // Far above the club's level, a player is a dream, not a plan: he goes with the dear ones.
    if (ca >= level * 0.92) tiers[reach && ca <= level * 1.35 ? 0 : 2].push(i);
    else if (ca >= level * 0.8 && reach) tiers[1].push(i);
  }
  const best = (a: number, b: number): number => store.currentAbility[b] - store.currentAbility[a];
  return tiers.flatMap((t) => t.sort(best)).slice(0, limit);
}
