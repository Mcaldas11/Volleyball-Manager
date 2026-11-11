/**
 * A career plan for each prospect: the path the club means him to take — to
 * grow in the academy (the U19s' minutes, a programme, a mentor), to go out
 * on loan for senior games, or to be promoted the day he is ready — and the
 * head of youth seeing it through. On a loan path he goes out when a window
 * opens and a club will play him; on the promotion path he comes up once he
 * is as good as the squad's bench. Once a month the head of youth reports on
 * every plan: what each has brought, and what he would do next.
 *
 * The advice is the head of youth's: a prospect playing too little needs the
 * U19s' minutes first; one already as good as the senior bench is ready; a
 * sixteen-year-old near senior level wants senior games; the rest grow.
 */

import { Position, MAX_SQUAD } from '../model/positions.ts';
import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { programmeOf } from './academy.ts';
import { MONTH_STARTS, postMessage } from './inbox.ts';
import { loanOf } from './loans.ts';
import { mentorOf } from './mentoring.ts';
import { notePlayerEvent } from './playerTimeline.ts';
import { dayOfSeason, seasonEndDay, type World } from './world.ts';
import { academyLoanBlock, academyLoanOffers, loanAcademyPlayer } from './youth.ts';

export type CareerPath = 'grow' | 'loan' | 'promote';
export const CAREER_PATHS: readonly CareerPath[] = ['grow', 'loan', 'promote'];
export const PATH_NAMES: Readonly<Record<CareerPath, string>> = {
  grow: 'Grow in the academy', loan: 'Loan for senior games', promote: 'Promote when ready',
};

export interface CareerPlan {
  path: CareerPath;
  /** Absolute day it began, and his ability then. */
  since: number;
  startAbility: number;
}

function userClub(world: World): Club | undefined {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
}

/** The squad's bench level: the ability a prospect needs to be worth a place in it — its twelfth best. */
export function benchLevel(world: World, club: Club): number {
  const store = world.players;
  const abilities = club.players.map((p) => store.currentAbility[p]).sort((a, b) => b - a);
  return abilities[Math.min(abilities.length - 1, 11)] ?? 0;
}

/** Whether a prospect is ready for the first team: as good as its bench, and room for him. */
export function readyToPromote(world: World, club: Club, p: number): boolean {
  return world.players.currentAbility[p] >= benchLevel(world, club) && club.players.length < MAX_SQUAD;
}

/** The head of youth's advice for a prospect: the path, and why. */
export function planAdvice(world: World, p: number): { path: CareerPath; reason: string } {
  const club = userClub(world);
  const store = world.players;
  if (club === undefined) return { path: 'grow', reason: '' };
  const age = store.ageOn(p, world.year, 181);
  const ability = store.currentAbility[p];
  const bench = benchLevel(world, club);
  if (readyToPromote(world, club, p)) return { path: 'promote', reason: 'He is already as good as the squad\'s bench.' };
  if (store.playingTime[p] < 40 && age < 17) return { path: 'grow', reason: 'He needs the U19s\' minutes first — he hardly plays.' };
  if (age >= 16 && ability >= bench * 0.82) return { path: 'loan', reason: 'Close to senior level: games against men would bring him on.' };
  return { path: 'grow', reason: mentorOf(world, p) === null && age >= 15 ? 'Let him grow — a mentor would help.' : 'Let him grow: the U19s, a programme, time.' };
}

/** The plan a prospect is on, if any. */
export function planOf(world: World, p: number): CareerPlan | undefined {
  return world.academyPlans?.[p];
}

/** Put a prospect on a path — or, with null, take him off his plan. */
export function setCareerPlan(world: World, p: number, path: CareerPath | null): string {
  const store = world.players;
  const plans = (world.academyPlans ??= {});
  if (path === null) {
    delete plans[p];
    return `${store.fullName(p)} is off his career plan.`;
  }
  plans[p] = { path, since: world.day, startAbility: store.currentAbility[p] };
  return `${store.fullName(p)} is now on a plan: ${PATH_NAMES[path].toLowerCase()}.`;
}

/** Promote a prospect into the squad, contract and all. */
function promote(world: World, club: Club, p: number): void {
  const store = world.players;
  club.youthPlayers = club.youthPlayers.filter((x) => x !== p);
  if (!club.players.includes(p)) club.players.push(p);
  store.setFlag(p, PlayerFlag.Youth, false);
  store.contractUntil[p] = Math.max(store.contractUntil[p], seasonEndDay(world.season + 2));
  notePlayerEvent(world, p, { kind: 'promoted', clubId: club.id });
}

/**
 * The head of youth's day: a loan path's prospect goes out when a club will
 * play him; a promotion path's comes up once he is ready; on the first of the
 * month, the report on every plan.
 */
export function academyPlansDay(world: World): void {
  const club = userClub(world);
  const plans = world.academyPlans;
  if (club === undefined || plans === undefined) return;
  const store = world.players;
  for (const [key, plan] of Object.entries(plans)) {
    const p = Number(key);
    const inAcademy = club.youthPlayers.includes(p);
    const away = loanOf(world, p)?.parentClubId === club.id;
    // Gone — sold, released, come of age into the squad: the plan is over.
    if (!inAcademy && !away) {
      delete plans[p];
      continue;
    }
    if (!inAcademy) continue;
    if (plan.path === 'loan' && academyLoanBlock(world, p) === null) {
      const offer = academyLoanOffers(world, p)[0];
      if (offer !== undefined) {
        const done = loanAcademyPlayer(world, p, offer.clubId);
        if (done.ok) postMessage(world, { category: 'staff', from: 'Head of youth', subject: `Career plan: ${store.fullName(p)} goes on loan`, body: done.text, playerIdx: p });
      }
    } else if (plan.path === 'promote' && readyToPromote(world, club, p)) {
      promote(world, club, p);
      delete plans[p];
      postMessage(world, {
        category: 'staff', from: 'Head of youth', subject: `Career plan: ${store.fullName(p)} is promoted`,
        body: `${store.fullName(p)} has reached the level of the squad's bench (${store.currentAbility[p]}): as planned, he is promoted to the first team.`,
        playerIdx: p,
      });
    }
  }
  // The month's report on every plan.
  if (!isFirstOfMonth(world)) return;
  const lines: string[] = [];
  for (const [key, plan] of Object.entries(plans)) {
    const p = Number(key);
    if (!store.isActive(p)) continue;
    const gain = store.currentAbility[p] - plan.startAbility;
    const loan = loanOf(world, p);
    const where = loan !== undefined ? `on loan at ${world.clubs[loan.loanClubId]?.name ?? '?'}`
      : programmeOf(world, p) !== undefined ? 'on a development programme' : `U19 minutes ${store.playingTime[p]}/100`;
    const mentor = mentorOf(world, p);
    const advice = planAdvice(world, p);
    // A part at a time, between dots: each reads — and translates — on its own.
    lines.push([
      store.fullName(p), `plan: ${PATH_NAMES[plan.path].toLowerCase()}`, `${gain >= 0 ? '+' : ''}${gain} ability since the plan began`, where,
      ...(mentor !== null ? [`mentored by ${store.shortName(mentor)}`] : []), `advice: ${PATH_NAMES[advice.path].toLowerCase()}`,
    ].join(' · '));
  }
  if (lines.length === 0) return;
  postMessage(world, {
    category: 'staff', from: 'Head of youth', subject: `Career plans: the month's report (${lines.length})`,
    body: `How each prospect on a plan is getting on:\n${lines.join('\n')}`,
  });
}

/** The first day of a calendar month. */
function isFirstOfMonth(world: World): boolean {
  return MONTH_STARTS.includes(dayOfSeason(world)) && world.day > 0;
}

/** Positions a prospect's plan is judged in — for the UI's advice, his own. */
export function planPosition(world: World, p: number): Position {
  return world.players.position[p] as Position;
}
