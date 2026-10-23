/**
 * Who does what: as in Football Manager, the manager hands jobs to his staff. Contract renewals
 * to the Director of Football, who keeps whoever is worth keeping, within the wage budget, and
 * lets the rest go; the pre-season friendlies to the assistant or the director, who book them;
 * the training to the assistant, who runs the whole programme as he sees fit; the press
 * conferences to the assistant, who fronts them — calmly, nothing to win or lose.
 */

import { PlayerFlag } from '../model/players.ts';
import { StaffRole } from '../model/staff.ts';
import { boardArrangeFriendly, friendliesOf, friendlyWindow, FRIENDLY_FIRST_DAY } from '../season/friendlies.ts';
import { delegateDeal, directorOf, directorTaskFor } from './director.ts';
import { postMessage } from './inbox.ts';
import { loanOf, wageRoom } from './loans.ts';
import { willRetire } from './retirement.ts';
import { contractEndSeason, DAYS_PER_SEASON, euros, type World } from './world.ts';

export type Handler = 'manager' | 'assistant' | 'director';
export type DelegableTask = 'renewals' | 'friendlies' | 'training' | 'press';

export type Delegation = Record<DelegableTask, Handler>;

/** Who may take each job on. */
export const TASK_HANDLERS: Readonly<Record<DelegableTask, readonly Handler[]>> = {
  renewals: ['manager', 'director'],
  friendlies: ['manager', 'assistant', 'director'],
  training: ['manager', 'assistant'],
  press: ['manager', 'assistant'],
};

export const TASK_NAMES: Readonly<Record<DelegableTask, string>> = {
  renewals: 'Contract renewals',
  friendlies: 'Pre-season friendlies',
  training: 'Training',
  press: 'Press conferences',
};

export const HANDLER_NAMES: Readonly<Record<Handler, string>> = {
  manager: 'You',
  assistant: 'Assistant',
  director: 'Director of Football',
};

const DEFAULT: Delegation = { renewals: 'manager', friendlies: 'manager', training: 'manager', press: 'manager' };

/** Who does each job at the manager's club now. */
export function delegationOf(world: World): Delegation {
  return { ...DEFAULT, ...(world.delegation ?? {}) };
}

/** Whether the club has someone to hand a job to. */
export function handlerAvailable(world: World, handler: Handler): boolean {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return false;
  if (handler === 'manager') return true;
  if (handler === 'director') return directorOf(world, club) !== undefined;
  return world.staff.some((s) => s.clubId === club.id && s.role === StaffRole.AssistantCoach && s.retired !== true);
}

/** The person doing a job, by name — or the job's title, with nobody in it. */
export function handlerName(world: World, handler: Handler): string {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || handler === 'manager') return 'You';
  const role = handler === 'director' ? StaffRole.DirectorOfFootball : StaffRole.AssistantCoach;
  const s = world.staff.find((x) => x.clubId === club.id && x.role === role && x.retired !== true);
  return s !== undefined ? `${s.firstName} ${s.lastName}` : HANDLER_NAMES[handler];
}

/** Hand a job over — or take it back. Returns a line for the manager. */
export function setDelegation(world: World, task: DelegableTask, handler: Handler): string {
  if (!TASK_HANDLERS[task].includes(handler)) return 'Nobody does that job.';
  if (!handlerAvailable(world, handler)) {
    return handler === 'director' ? 'The club has no Director of Football — hire one on the Staff screen.' : 'The club has no assistant coach to hand it to.';
  }
  world.delegation = { ...delegationOf(world), [task]: handler };
  if (handler === 'manager') return `${TASK_NAMES[task]}: back in your hands.`;
  return `${TASK_NAMES[task]}: ${handlerName(world, handler)} takes care of ${task === 'training' ? 'it' : 'them'} from now on.`;
}

/** The job's handler as it stands — the manager again if the man it was handed to has left. */
export function activeHandler(world: World, task: DelegableTask): Handler {
  const h = delegationOf(world)[task];
  return handlerAvailable(world, h) ? h : 'manager';
}

/** How many friendlies a delegate books for the pre-season. */
const DELEGATE_FRIENDLIES = 3;
/** The days of the season the director looks over the contracts running out: 1 January, then monthly until May. */
const RENEWAL_REVIEW_DAYS = [184, 215, 243, 274];

/** Each day: whatever the delegates have to do today. */
export function delegationDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || world.delegation === undefined) return;
  const d = world.day % DAYS_PER_SEASON;

  // ---- The friendlies: booked early in the pre-season.
  const friendlies = activeHandler(world, 'friendlies');
  if (friendlies !== 'manager' && d >= Math.max(FRIENDLY_FIRST_DAY, friendlyWindow(world).first - 21) && d <= friendlyWindow(world).last
    && friendliesOf(world, club.id).length < DELEGATE_FRIENDLIES) {
    const f = boardArrangeFriendly(world);
    if (f !== null) {
      const home = f.home === club.id;
      const opp = world.clubs[home ? f.away : f.home];
      postMessage(world, {
        category: 'matchday', from: handlerName(world, friendlies),
        subject: `Friendly arranged: ${opp?.name ?? 'a club'}`,
        body: `I have booked a pre-season friendly ${home ? 'at home to' : 'away at'} ${opp?.name ?? 'a club'} — good practice, at the right level for this time of the summer.`,
        clubId: opp?.id,
      });
    }
  }

  // ---- The renewals: the director goes through whoever is out of contract in June.
  if (activeHandler(world, 'renewals') === 'director' && RENEWAL_REVIEW_DAYS.includes(d)) directorRenewals(world);
}

/** The director's look at the contracts running out: keep whoever is worth it, let the rest go. */
export function directorRenewals(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const director = directorOf(world, club);
  if (director === undefined) return;
  const store = world.players;
  const seniors = club.players.filter((p) => store.isActive(p) && !store.hasFlag(p, PlayerFlag.Youth) && loanOf(world, p) === undefined);
  const ranked = [...seniors].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const keepLine = Math.ceil(ranked.length * 0.7);
  const expiring = seniors.filter((p) => contractEndSeason(store.contractUntil[p]) === world.season
    && directorTaskFor(world, p) === undefined && !world.talks.some((t) => t.playerIdx === p)
    && !store.hasFlag(p, PlayerFlag.Transferable) && !willRetire(world, p));
  if (expiring.length === 0) return;
  const kept: string[] = [];
  const let_go: string[] = [];
  for (const p of expiring) {
    const age = store.ageOn(p, world.year, 181);
    const worth = ranked.indexOf(p) < keepLine || (age <= 24 && store.potentialAbility[p] >= store.currentAbility[p] + 100);
    if (!worth || age >= 34) { let_go.push(store.fullName(p)); continue; }
    const maxWage = Math.round(Math.min(store.wage[p] * 1.35, store.wage[p] + Math.max(0, wageRoom(world, club))) / 1000) * 1000;
    const r = delegateDeal(world, club, p, 'renewal', 0, Math.max(store.wage[p], maxWage));
    if (r.ok) kept.push(`${store.fullName(p)} (up to ${euros(Math.max(store.wage[p], maxWage))})`);
  }
  if (kept.length === 0 && let_go.length === 0) return;
  postMessage(world, {
    category: 'contract', from: `${director.firstName} ${director.lastName}`,
    subject: 'Contracts running out: my plan',
    body: [
      kept.length > 0 ? `I have opened talks to keep ${kept.join(', ')}.` : '',
      let_go.length > 0 ? `I don't think ${let_go.join(', ')} ${let_go.length === 1 ? 'is' : 'are'} worth a new deal — ${let_go.length === 1 ? 'he leaves' : 'they leave'} on a free in June unless you say otherwise.` : '',
    ].filter((l) => l !== '').join(' '),
  });
}
