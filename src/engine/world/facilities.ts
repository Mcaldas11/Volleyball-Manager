/**
 * The club's facilities, and the board's money for better ones.
 *
 * Training, the youth set-up, youth recruitment and the medical centre are
 * each rated 1-20, and each matters: the training ground how fast the squad
 * improves, the youth facilities and recruitment how good the academy's
 * intake is, the medical centre how often players break down and how fast
 * they come back. The manager can ask the board for an upgrade. They answer in
 * a few days: yes if the club can afford it and they trust him, no otherwise
 * — and a refusal is not revisited for a while. A yes is a building job of a
 * few months; the club pays for it up front, and a little more each season to
 * keep it running.
 */

import type { Club } from '../model/club.ts';
import { postMessage } from './inbox.ts';
import { euros, type World } from './world.ts';

export type FacilityKind = 'training' | 'youth' | 'recruitment' | 'medical';

export const FACILITY_KINDS: readonly FacilityKind[] = ['training', 'youth', 'recruitment', 'medical'];

export const FACILITY_NAMES: Readonly<Record<FacilityKind, string>> = {
  training: 'Training ground', youth: 'Youth facilities', recruitment: 'Youth recruitment', medical: 'Medical centre',
};

export const FACILITY_EFFECTS: Readonly<Record<FacilityKind, string>> = {
  training: 'How fast the squad improves in training.',
  youth: 'How well the academy develops its players.',
  recruitment: 'How far the academy looks, and how good its intake is.',
  medical: 'How often players break down, and how fast they come back.',
};

/** Days the board takes to answer, and a refusal stands. */
const ANSWER_DAYS = [3, 6] as const;
const REFUSAL_DAYS = 90;
/** What a working facility costs to keep running each season, as a share of what it cost to build. */
export const UPKEEP_SHARE = 0.04;

/** A request with the board, or a building job under way. */
export interface FacilityProject {
  kind: FacilityKind;
  cost: number;
  /** Asked on, and the day the board answers — or, once approved, the day the work is done. */
  day: number;
  until: number;
  stage: 'asked' | 'building';
}

export function facilityLevel(club: Club, kind: FacilityKind): number {
  switch (kind) {
    case 'training': return club.trainingFacilities;
    case 'youth': return club.youthFacilities;
    case 'recruitment': return club.youthRecruitment;
    case 'medical': return club.medicalFacilities;
  }
}

function raise(club: Club, kind: FacilityKind): void {
  switch (kind) {
    case 'training': club.trainingFacilities = Math.min(20, club.trainingFacilities + 1); break;
    case 'youth': club.youthFacilities = Math.min(20, club.youthFacilities + 1); break;
    case 'recruitment': club.youthRecruitment = Math.min(20, club.youthRecruitment + 1); break;
    case 'medical': club.medicalFacilities = Math.min(20, club.medicalFacilities + 1); break;
  }
}

/** What the next level costs: dearer the higher it goes, and dearer at a bigger club. */
export function upgradeCost(club: Club, kind: FacilityKind): number {
  const next = facilityLevel(club, kind) + 1;
  const scale = 0.3 + club.reputation / 10_000;
  const weight = kind === 'recruitment' ? 0.6 : kind === 'youth' ? 0.8 : 1;
  return Math.round(next * next * 5_500 * scale * weight / 1000) * 1000;
}

/** How long the work takes, in days. */
export function buildDays(club: Club, kind: FacilityKind): number {
  return kind === 'recruitment' ? 30 : 80 + facilityLevel(club, kind) * 5;
}

/** Why the manager can't ask for an upgrade now, or null if he can. */
export function upgradeBlock(world: World, club: Club, kind: FacilityKind): string | null {
  if (facilityLevel(club, kind) >= 20) return 'It is as good as it gets.';
  const project = club.facilityProject;
  if (project !== undefined) {
    return project.stage === 'asked' ? 'The board is still considering your last request.'
      : `Work on the ${FACILITY_NAMES[project.kind].toLowerCase()} is under way — one project at a time.`;
  }
  const refused = club.facilityRefused?.[kind];
  if (refused !== undefined && refused > world.day) return `The board turned it down — ask again in ${refused - world.day} days.`;
  return null;
}

/** Put an upgrade to the board. They answer in a few days. */
export function requestUpgrade(world: World, club: Club, kind: FacilityKind): string {
  const block = upgradeBlock(world, club, kind);
  if (block !== null) return block;
  const cost = upgradeCost(club, kind);
  const until = world.day + world.rng.int(ANSWER_DAYS[0], ANSWER_DAYS[1]);
  club.facilityProject = { kind, cost, day: world.day, until, stage: 'asked' };
  return `Your request for a better ${FACILITY_NAMES[kind].toLowerCase()} (${euros(cost)}) is with the board.`;
}

/** Each day: the board's answer when it is due, and the builders finishing. The manager's club only. */
export function facilitiesDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const project = club?.facilityProject;
  if (club === undefined || project === undefined || project.until > world.day) return;
  const name = FACILITY_NAMES[project.kind];
  if (project.stage === 'asked') {
    const f = club.finances;
    const affordable = f.balance >= project.cost * 1.3;
    const trusted = club.boardConfidence >= 40;
    if (affordable && trusted) {
      // Paid up front, out of the bank: a building, not a running cost.
      f.balance -= project.cost;
      club.facilityProject = { ...project, stage: 'building', day: world.day, until: world.day + buildDays(club, project.kind) };
      postMessage(world, {
        category: 'board', from: 'The Board',
        subject: `Upgrade approved: ${name}`,
        body: `The board has agreed to spend ${euros(project.cost)} on the ${name.toLowerCase()}. The work starts now and should be done in ` +
          `${Math.round(buildDays(club, project.kind) / 30)} months.`,
      });
      return;
    }
    club.facilityProject = undefined;
    (club.facilityRefused ??= {})[project.kind] = world.day + REFUSAL_DAYS;
    postMessage(world, {
      category: 'board', from: 'The Board',
      subject: `Upgrade turned down: ${name}`,
      body: !affordable
        ? `The board can't find ${euros(project.cost)} for the ${name.toLowerCase()} — the club would want a good deal more than that in the bank first.`
        : `The board isn't ready to spend ${euros(project.cost)} on the ${name.toLowerCase()} with results as they are. Win them round first.`,
    });
    return;
  }
  // The work is done.
  raise(club, project.kind);
  club.finances.arenaMaintenance += Math.round(project.cost * UPKEEP_SHARE);
  club.facilityProject = undefined;
  postMessage(world, {
    category: 'board', from: 'The Board',
    subject: `${name} upgraded`,
    body: `The work on the ${name.toLowerCase()} is finished: it is now rated ${facilityLevel(club, project.kind)} out of 20.`,
  });
}
