/**
 * The staff hiring, handed over: the Director of Football or the assistant fills the open places
 * in the backroom from the people out of work, the best he can find within the staff budget and a
 * limit the manager sets on any one wage. He judges them with his own eye, a good judge of people
 * picks the good ones, a poor one is taken in now and then. Each hire is put to the manager first
 * and goes through a few days later unless he stops it; asked to, the delegate also replaces the
 * weakest of the staff whose contracts are running out with someone clearly better.
 */

import { StaffRole, STAFF_ROLE_NAMES, staffName, staffRating, type Staff } from '../model/staff.ts';
import type { Club } from '../model/club.ts';
import { activeHandler, handlerName, type Handler } from './delegation.ts';
import { postMessage } from './inbox.ts';
import {
  backroomOf, HIRABLE_ROLES, longestContract, releaseStaff, signStaff, STAFF_SLOTS, staffBudget, staffBudgetRoom,
  staffInterest, staffWageAsk,
} from './staffMarket.ts';
import { staffTalksWith } from './staffDeals.ts';
import { contractEndSeason, DAYS_PER_SEASON, euros, seasonEndYear, type World } from './world.ts';

/** One hire the delegate has lined up, or made. */
export interface StaffHire {
  id: number;
  staffId: number;
  role: StaffRole;
  wage: number;
  years: number;
  /** The man he replaces, whose contract is running out. */
  replaces?: number;
  /** How good the delegate thinks he is, 1-20. */
  judged: number;
  /** Who picked him. */
  by: Handler;
  day: number;
  /** The day he signs, unless the manager stops it. */
  signsOn: number;
  status: 'pending' | 'done' | 'cancelled' | 'failed';
  outcome?: string;
}

/** The manager's brief to the delegate. */
export interface StaffHiringBrief {
  /** The most any one of them may be paid a season. */
  maxWage: number;
  /** Fill only the roles nobody does, or every open place. */
  scope: 'empty' | 'all';
  /** Replace the weakest of the staff whose contracts run out, with someone clearly better. */
  replaceExpiring: boolean;
}

export interface StaffHiringState extends StaffHiringBrief {
  hires: StaffHire[];
}

/** How long a hire waits for the manager's word. */
export const HIRE_NOTICE_DAYS = 3;
/** How much better a replacement must look than the man he replaces. */
const REPLACE_MARGIN = 1.5;
/** The days of the season the delegate looks at the contracts running out: March and April. */
const REPLACE_DAYS = [243, 274];
/** How long a man the manager turned down stays off the delegate's list. */
const VETO_DAYS = 180;
/** The wage limits the manager picks from. */
export const WAGE_LIMITS: readonly number[] = [5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 60_000, 80_000, 100_000, 150_000, 200_000, 250_000];

function userClub(world: World): Club | undefined {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
}

/** The brief as it stands, with its defaults: a limit of about a tenth of the staff budget, the empty roles only. */
export function staffHiringOf(world: World): StaffHiringState {
  const club = userClub(world);
  const budget = club !== undefined ? staffBudget(club) : 60_000;
  const fallback = [...WAGE_LIMITS].reverse().find((w) => w <= budget / 10) ?? WAGE_LIMITS[0];
  world.staffHiring ??= { maxWage: fallback, scope: 'empty', replaceExpiring: false, hires: [] };
  return world.staffHiring;
}

/** Change the brief. */
export function setStaffHiringBrief(world: World, brief: Partial<StaffHiringBrief>): void {
  Object.assign(staffHiringOf(world), brief);
}

/** The person the hiring is with, or undefined while the manager keeps it. */
export function staffHiringDelegate(world: World): Staff | undefined {
  const club = userClub(world);
  const h = activeHandler(world, 'staff');
  if (club === undefined || h === 'manager') return undefined;
  const role = h === 'director' ? StaffRole.DirectorOfFootball : StaffRole.AssistantCoach;
  return backroomOf(world, club).filter((s) => s.role === role && s.retired !== true).sort((a, b) => staffRating(b) - staffRating(a))[0];
}

/** How good a judge of people he is, 1-20. */
export function judgeOfStaff(s: Staff): number {
  return (s.attributes.judgingAbility * 2 + s.attributes.manManagement) / 3;
}

/** How good he thinks a man is: the truth, give or take as much as his eye is poor. The same each time he looks. */
export function judgedRating(judge: Staff, s: Staff): number {
  let h = Math.imul(judge.id + 0x9e37, 2654435761) ^ Math.imul(s.id + 0x51ed, 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  const noise = (h / 0xffffffff) * 2 - 1;
  const spread = Math.max(0.3, (20 - judgeOfStaff(judge)) / 20 * 4.5);
  return Math.max(1, Math.min(20, staffRating(s) + noise * spread));
}

export function pendingStaffHires(world: World): StaffHire[] {
  return (world.staffHiring?.hires ?? []).filter((h) => h.status === 'pending');
}

/** What the lined-up hires would add to the wage bill. */
function committed(world: World): number {
  let sum = 0;
  for (const h of pendingStaffHires(world)) sum += h.wage - (h.replaces !== undefined ? world.staff[h.replaces]?.wage ?? 0 : 0);
  return sum;
}

/** The wage he would sign for at the club. */
function askOf(world: World, s: Staff, club: Club): number {
  const ask = staffWageAsk(world, s, club);
  return staffInterest(world, s, club) === 'reluctant' ? Math.round(ask * 1.1 / 1000) * 1000 : ask;
}

/** The best man out of work for a role, as the delegate sees him, at a wage the club can pay. */
function bestFor(world: World, club: Club, judge: Staff, role: StaffRole, cap: number): { s: Staff; judged: number; wage: number } | undefined {
  const state = staffHiringOf(world);
  const taken = new Set(state.hires.filter((h) => h.status === 'pending' || (h.status === 'cancelled' && world.day - h.day < VETO_DAYS)).map((h) => h.staffId));
  let best: { s: Staff; judged: number; wage: number } | undefined;
  for (const s of world.staff) {
    if (s.role !== role || s.clubId >= 0 || s.retired === true || taken.has(s.id)) continue;
    if (staffTalksWith(world, s.id) !== undefined) continue;
    const blocked = world.staffTalks?.[s.id];
    if (blocked !== undefined && blocked.until > world.day) continue;
    if (staffInterest(world, s, club) === 'refuses') continue;
    const wage = askOf(world, s, club);
    if (wage > cap) continue;
    const judged = judgedRating(judge, s);
    if (best === undefined || judged > best.judged) best = { s, judged, wage };
  }
  return best;
}

function lineUp(world: World, club: Club, pick: { s: Staff; judged: number; wage: number }, replaces?: Staff): StaffHire {
  const state = staffHiringOf(world);
  const hire: StaffHire = {
    id: (state.hires.at(-1)?.id ?? 0) + 1, staffId: pick.s.id, role: pick.s.role, wage: pick.wage,
    years: Math.min(3, longestContract(world, pick.s, club)), judged: Math.round(pick.judged * 10) / 10,
    by: activeHandler(world, 'staff'), day: world.day, signsOn: world.day + HIRE_NOTICE_DAYS, status: 'pending',
    ...(replaces !== undefined ? { replaces: replaces.id } : {}),
  };
  state.hires.push(hire);
  if (state.hires.length > 40) state.hires.splice(0, state.hires.length - 40);
  return hire;
}

/** The delegate looks over the backroom and lines up whoever is needed. Returns what he lined up. */
export function planStaffHires(world: World): StaffHire[] {
  const club = userClub(world);
  const judge = staffHiringDelegate(world);
  if (club === undefined || judge === undefined) return [];
  const state = staffHiringOf(world);
  const out: StaffHire[] = [];
  const room = (): number => Math.min(state.maxWage, staffBudgetRoom(world, club) - committed(world));
  const pendingIn = (role: StaffRole): number => pendingStaffHires(world).filter((h) => h.role === role && h.replaces === undefined).length;
  const roles = HIRABLE_ROLES.filter((r) => r !== StaffRole.DirectorOfFootball);
  // The roles nobody does first, then, if he is asked to, every other open place.
  const order: StaffRole[] = [];
  for (const r of roles) if (backroomOf(world, club).every((s) => s.role !== r)) order.push(r);
  if (state.scope === 'all') for (const r of roles) for (let i = 0; i < STAFF_SLOTS[r]; i++) order.push(r);
  for (const role of order) {
    const have = backroomOf(world, club).filter((s) => s.role === role).length + pendingIn(role);
    if (have >= STAFF_SLOTS[role] || (state.scope === 'empty' && have > 0)) continue;
    const cap = room();
    if (cap < 2_000) break;
    const pick = bestFor(world, club, judge, role, cap);
    if (pick !== undefined) out.push(lineUp(world, club, pick));
  }
  // The contracts running out: whoever can be clearly bettered.
  const d = world.day % DAYS_PER_SEASON;
  if (state.replaceExpiring && REPLACE_DAYS.includes(d)) {
    const expiring = backroomOf(world, club).filter((s) => contractEndSeason(s.contractUntil) <= world.season && s.id !== judge.id
      && s.role !== StaffRole.DirectorOfFootball && staffTalksWith(world, s.id) === undefined
      && !pendingStaffHires(world).some((h) => h.replaces === s.id))
      .sort((a, b) => judgedRating(judge, a) - judgedRating(judge, b));
    for (const s of expiring) {
      const cap = Math.min(state.maxWage, staffBudgetRoom(world, club) - committed(world) + s.wage);
      const pick = bestFor(world, club, judge, s.role, cap);
      if (pick !== undefined && pick.judged >= judgedRating(judge, s) + REPLACE_MARGIN) out.push(lineUp(world, club, pick, s));
    }
  }
  if (out.length > 0) {
    const lines = out.map((h) => {
      const s = world.staff[h.staffId];
      const old = h.replaces !== undefined ? world.staff[h.replaces] : undefined;
      return `${staffName(s)} as ${STAFF_ROLE_NAMES[h.role].toLowerCase()}${old !== undefined ? ` in place of ${staffName(old)}` : ''}, ${euros(h.wage)} a season for ${h.years} year${h.years > 1 ? 's' : ''}`;
    });
    postMessage(world, {
      category: 'staff', from: handlerName(world, activeHandler(world, 'staff')),
      subject: out.length === 1 ? `Staff hire lined up: ${staffName(world.staff[out[0].staffId])}` : `${out.length} staff hires lined up`,
      body: `I would like to bring in ${lines.join('; ')}. ${out.length === 1 ? 'He signs' : 'They sign'} in ${HIRE_NOTICE_DAYS} days unless you stop it on the Director & Delegation screen.`,
      staffId: out[0].staffId,
    });
  }
  return out;
}

/** The lined-up hires that are due go through, if they still can. */
export function completeStaffHires(world: World): void {
  const club = userClub(world);
  if (club === undefined) return;
  for (const h of pendingStaffHires(world)) {
    if (h.signsOn > world.day) continue;
    const s = world.staff[h.staffId];
    const old = h.replaces !== undefined ? world.staff[h.replaces] : undefined;
    const problem = s === undefined || s.retired === true ? 'He has retired.'
      : s.clubId >= 0 ? 'Another club signed him first.'
      : staffTalksWith(world, s.id) !== undefined ? 'You are talking to him yourself.'
      : old === undefined && backroomOf(world, club).filter((x) => x.role === h.role).length >= STAFF_SLOTS[h.role] ? 'The place has been filled.'
      : h.wage - (old?.clubId === club.id ? old.wage : 0) > staffBudgetRoom(world, club) ? 'The staff budget no longer stretches to him.'
      : null;
    if (problem !== null) { h.status = 'failed'; h.outcome = problem; continue; }
    if (old !== undefined && old.clubId === club.id) releaseStaff(world, club, old);
    signStaff(world, club, s, h.wage, h.years, 0);
    h.status = 'done';
    const until = seasonEndYear(world, world.season + h.years - 1);
    h.outcome = `Signed until 30 June ${until}.`;
    postMessage(world, {
      category: 'staff', from: handlerName(world, h.by),
      subject: `Staff signed: ${staffName(s)}`,
      body: `${staffName(s)} has joined as ${STAFF_ROLE_NAMES[h.role].toLowerCase()}${old !== undefined ? `, in place of ${staffName(old)}, who leaves now his contract is nearly up` : ''}. ` +
        `I rate him ${h.judged.toFixed(1)} out of 20. He is on ${euros(h.wage)} a season, until 30 June ${until}.`,
      staffId: s.id,
    });
  }
}

/** Stop a hire the delegate lined up. Returns a line for the manager. */
export function cancelStaffHire(world: World, id: number): string {
  const h = pendingStaffHires(world).find((x) => x.id === id);
  if (h === undefined) return 'That hire is no longer waiting.';
  h.status = 'cancelled';
  h.outcome = 'Stopped by you.';
  return `${staffName(world.staff[h.staffId])} will not be hired. He stays off the list for now.`;
}

/** Each day, while the hiring is handed over: due hires signed, and once a week, the backroom looked over. */
export function staffHiringDay(world: World): void {
  if (world.staffHiring === undefined && activeHandler(world, 'staff') === 'manager') return;
  if (staffHiringDelegate(world) === undefined) {
    // The hiring back with the manager: whatever was lined up lapses.
    for (const h of pendingStaffHires(world)) { h.status = 'cancelled'; h.outcome = 'The hiring is back in your hands.'; }
    return;
  }
  completeStaffHires(world);
  const d = world.day % DAYS_PER_SEASON;
  if (world.day % 7 === 3 || REPLACE_DAYS.includes(d)) planStaffHires(world);
}
