/**
 * Recruitment: the manager's shortlist, and the missions he sends his scouts on — "an opposite,
 * 24 or under, for no more than €200k". Each week a mission is out, the scouts come back with
 * the best new names they have found that fit it, and those go on the shortlist; the report
 * lands in the inbox. How sure they are of a player's level depends on how well they know where
 * he plays: a good scout in a region he knows rates him close to the truth, a poor one in the
 * wrong country guesses.
 */

import { hash01 } from './offerStance.ts';
import { PlayerFlag } from '../model/players.ts';
import { POSITION_NAMES, POSITION_SHORT, type Position } from '../model/positions.ts';
import { postMessage } from './inbox.ts';
import { NATIONS, type Confederation } from './nations.ts';
import { scoutingQualityFor } from './scouting.ts';
import { contractEndSeason, euros, type World } from './world.ts';

export interface ScoutMission {
  id: number;
  position: Position | null;
  maxAge: number | null;
  /** The most his club would want for him, or null for any price. */
  maxValue: number | null;
  /** The least ability worth reporting, 0-2000, or null for anyone better than the squad's weakest. */
  minAbility: number | null;
  /** Free agents and players whose contracts run out this season only. */
  freeOnly: boolean;
  /** Where to look, or null for everywhere. */
  region: Confederation | null;
  created: number;
  nextReport: number;
  /** Everyone reported so far, never named twice. */
  found: number[];
  active: boolean;
}

export type MissionSpec = Pick<ScoutMission, 'position' | 'maxAge' | 'maxValue' | 'minAbility' | 'freeOnly' | 'region'>;

/** Days between a mission's reports. */
export const MISSION_REPORT_DAYS = 7;
/** New names a report brings at most. */
const NAMES_PER_REPORT = 3;
/** Missions the scouts can run at once. */
export const MAX_MISSIONS = 4;

// ---- The shortlist ---------------------------------------------------------------------

export function shortlistOf(world: World): number[] {
  return (world.shortlist ?? []).filter((p) => world.players.isActive(p) && world.players.clubId[p] !== world.userClubId);
}

export function isShortlisted(world: World, p: number): boolean {
  return (world.shortlist ?? []).includes(p);
}

/** On the shortlist, or off it. Returns whether he is on it now. */
export function toggleShortlist(world: World, p: number): boolean {
  const list = (world.shortlist ??= []);
  const at = list.indexOf(p);
  if (at >= 0) {
    list.splice(at, 1);
    return false;
  }
  list.push(p);
  return true;
}

// ---- Missions --------------------------------------------------------------------------

export function missionsOf(world: World): ScoutMission[] {
  return (world.scoutMissions ?? []).filter((m) => m.active);
}

/** "Opposite · 24 or under · up to €200k" */
export function missionLabel(m: MissionSpec): string {
  const parts = [m.position !== null ? POSITION_NAMES[m.position] : 'Any position'];
  if (m.maxAge !== null) parts.push(`${m.maxAge} or under`);
  if (m.maxValue !== null) parts.push(`up to ${euros(m.maxValue)}`);
  if (m.minAbility !== null) parts.push(`${Math.round(m.minAbility / 400 * 2) / 2}★ or better`);
  if (m.freeOnly) parts.push('free / out of contract');
  if (m.region !== null) parts.push(m.region);
  return parts.join(' · ');
}

/** Send the scouts out. The first report comes in a week. */
export function addMission(world: World, spec: MissionSpec): { ok: boolean; text: string; mission?: ScoutMission } {
  if (world.userClubId < 0) return { ok: false, text: 'No club.' };
  if (missionsOf(world).length >= MAX_MISSIONS) return { ok: false, text: `The scouts can run ${MAX_MISSIONS} missions at once — call one off first.` };
  const all = (world.scoutMissions ??= []);
  const mission: ScoutMission = {
    ...spec, id: (all.at(-1)?.id ?? 0) + 1, created: world.day, nextReport: world.day + MISSION_REPORT_DAYS, found: [], active: true,
  };
  all.push(mission);
  return { ok: true, text: `The scouts are on it: ${missionLabel(spec)}. First report in a week.`, mission };
}

export function cancelMission(world: World, id: number): void {
  const m = (world.scoutMissions ?? []).find((x) => x.id === id);
  if (m !== undefined) m.active = false;
}

/** Whether a player fits a mission's brief. */
function fits(world: World, m: ScoutMission, p: number, floor: number): boolean {
  const store = world.players;
  if (!store.isActive(p) || store.hasFlag(p, PlayerFlag.Youth) || store.clubId[p] === world.userClubId) return false;
  if (m.position !== null && store.position[p] !== m.position) return false;
  if (m.maxAge !== null && store.ageOn(p, world.year, 181) > m.maxAge) return false;
  const free = store.clubId[p] < 0 || contractEndSeason(store.contractUntil[p]) <= world.season;
  if (m.freeOnly && !free) return false;
  // The price is what his club would want today — a contract running out is still a fee until June,
  // unless the brief is for players who will cost nothing.
  if (m.maxValue !== null && store.clubId[p] >= 0 && !m.freeOnly && store.value[p] > m.maxValue) return false;
  if (m.region !== null && NATIONS[store.nation[p]]?.confederation !== m.region) return false;
  return store.currentAbility[p] >= floor;
}

/** The scouts' estimate of a player's level, 0-2000: the truth, give or take what they don't know. */
export function scoutEstimate(world: World, p: number): number {
  const { quality } = scoutingQualityFor(world, world.userClubId, p);
  const noise = (hash01(world.players.id[p], 0x5c0) - 0.5) * 2 * (1 - quality) * 450;
  return Math.max(0, Math.min(2000, Math.round(world.players.currentAbility[p] + noise)));
}

/** A mission's next report: the best new names, onto the shortlist and into the inbox. */
export function missionReport(world: World, m: ScoutMission): number[] {
  const club = world.clubs[world.userClubId];
  if (club === undefined) return [];
  const store = world.players;
  const seniors = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
  const weakest = seniors.length > 0 ? Math.min(...seniors.map((p) => store.currentAbility[p])) : 0;
  const floor = m.minAbility ?? weakest;
  const seen = new Set(m.found);
  const pool: number[] = [];
  for (let p = 0; p < store.count; p++) if (!seen.has(p) && fits(world, m, p, floor * 0.9)) pool.push(p);
  // Ranked as the scouts see them, not as they are.
  const picks = pool.map((p) => ({ p, est: scoutEstimate(world, p) }))
    .filter((x) => x.est >= floor)
    .sort((a, b) => b.est - a.est)
    .slice(0, NAMES_PER_REPORT);
  m.found.push(...picks.map((x) => x.p));
  m.nextReport = world.day + MISSION_REPORT_DAYS;
  for (const { p } of picks) if (!isShortlisted(world, p)) toggleShortlist(world, p);
  const stars = (v: number): string => `${Math.round((v / 400) * 2) / 2}★`;
  postMessage(world, {
    category: 'staff' as const, from: 'Scouting department',
    subject: picks.length > 0 ? `Scouting mission: ${picks.length} new name${picks.length === 1 ? '' : 's'}` : 'Scouting mission: nothing new this week',
    body: picks.length > 0
      ? `Our report on the brief "${missionLabel(m)}". ${picks.length === 1 ? 'He is' : 'They are'} on your shortlist now.`
      : `Nobody new who fits "${missionLabel(m)}" this week. We keep looking — or widen the brief.`,
    tables: picks.length > 0 ? [{
      label: missionLabel(m),
      columns: ['Player', 'Pos', 'Age', 'Club', 'Value', 'Our rating'],
      rows: picks.map(({ p, est }) => {
        const c = store.clubId[p] >= 0 ? world.clubs[store.clubId[p]] : undefined;
        return {
          p,
          cells: [store.fullName(p), POSITION_SHORT[store.position[p] as Position], store.ageOn(p, world.year, 181),
            c?.shortName ?? 'Free agent', c === undefined ? 'Free' : euros(store.value[p]), stars(est)],
        };
      }),
    }] : undefined,
  });
  return picks.map((x) => x.p);
}

/** Each day: any mission due a report gets one. */
export function recruitmentDay(world: World): void {
  if (world.userClubId < 0) return;
  for (const m of missionsOf(world)) if (m.nextReport <= world.day) missionReport(world, m);
}
