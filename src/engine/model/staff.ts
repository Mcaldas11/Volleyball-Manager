/**
 * Staff.
 *
 * Staff are not decoration. A strength coach with poor attributes measurably
 * slows physical development; a scout with no knowledge of South America
 * returns vague reports on Brazilian players and confident ones on Poles. The
 * user hires against these numbers without ever seeing them directly.
 */

import type { Confederation } from '../world/nations.ts';

export enum StaffRole {
  AssistantCoach = 0,
  Scout = 1,
  HeadScout = 2,
  PerformanceAnalyst = 3,
  SportsPsychologist = 4,
  StrengthCoach = 5,
  Doctor = 6,
  Physiotherapist = 7,
  YouthCoach = 8,
  RecruitmentAnalyst = 9,
  HeadCoach = 10,
}

export const STAFF_ROLE_NAMES: Readonly<Record<StaffRole, string>> = {
  [StaffRole.AssistantCoach]: 'Assistant Coach',
  [StaffRole.Scout]: 'Scout',
  [StaffRole.HeadScout]: 'Head Scout',
  [StaffRole.PerformanceAnalyst]: 'Performance Analyst',
  [StaffRole.SportsPsychologist]: 'Sports Psychologist',
  [StaffRole.StrengthCoach]: 'Strength Coach',
  [StaffRole.Doctor]: 'Doctor',
  [StaffRole.Physiotherapist]: 'Physiotherapist',
  [StaffRole.YouthCoach]: 'Youth Coach',
  [StaffRole.RecruitmentAnalyst]: 'Recruitment Analyst',
  [StaffRole.HeadCoach]: 'Head Coach',
};

/** Staff attributes, all on the same 1-20 scale as players. */
export interface StaffAttributes {
  /** Coaching specialisms — each drives the matching training module. */
  coachAttacking: number;
  coachBlocking: number;
  coachServing: number;
  coachReception: number;
  coachSetting: number;
  coachTactical: number;
  coachMental: number;
  coachFitness: number;

  /** Scouting. */
  judgingAbility: number;
  potentialAssessment: number;

  /** Medical. */
  physiotherapy: number;
  sportsScience: number;

  /** People. */
  manManagement: number;
  discipline: number;
  motivating: number;
  workingWithYouth: number;

  /** Hidden. */
  adaptability: number;
  loyalty: number;
  ambition: number;
}

/** One spell of a head coach's in charge of a club. */
export interface CoachSpell {
  clubId: number;
  from: number;
  /** Last day in charge; -1 while it lasts. */
  to: number;
  /** How it ended: sacked, made way for the user, or gone of his own accord. */
  exit?: 'sacked' | 'replaced' | 'left';
  won: number;
  lost: number;
}

export interface Staff {
  id: number;
  firstName: string;
  lastName: string;
  nation: number;
  birthYear: number;
  role: StaffRole;
  clubId: number;
  attributes: StaffAttributes;
  /**
   * Regional expertise, 1-20 per confederation, plus a per-nation bonus for
   * the handful of countries this scout genuinely knows. Scouting reports are
   * only as precise as the scout's knowledge of where the player plays.
   */
  regionKnowledge: Record<Confederation, number>;
  nationKnowledge: Map<number, number>;
  wage: number;
  contractUntil: number;
  reputation: number;
  /** A head coach's clubs, oldest first. Absent until his first is on record. */
  spells?: CoachSpell[];
  /** Turned a move down he wanted — or was kept from one: he asks more to stay, and may not. */
  unsettled?: boolean;
  /** Retired from the game: on the record, in no one's employ, on no market. */
  retired?: boolean;
  /** The season the manager was last told his contract is running out. */
  warnedSeason?: number;
  /** The day he went out of work, for how long he has been looking. */
  freeSince?: number;
}

export function staffName(s: Staff): string {
  return `${s.firstName} ${s.lastName}`;
}

/**
 * A single number summarising how good this person is at their actual job.
 * Used for hiring AI, the staff screen, and development calculations.
 */
export function staffRating(s: Staff): number {
  const a = s.attributes;
  switch (s.role) {
    case StaffRole.HeadCoach:
    case StaffRole.AssistantCoach:
      return coachingRating(a);
    case StaffRole.Scout:
    case StaffRole.HeadScout:
    case StaffRole.RecruitmentAnalyst:
      return (a.judgingAbility * 2 + a.potentialAssessment * 2 + a.adaptability) / 5;
    case StaffRole.PerformanceAnalyst:
      return (a.coachTactical * 2 + a.judgingAbility + a.sportsScience) / 4;
    case StaffRole.SportsPsychologist:
      return (a.coachMental * 2 + a.manManagement + a.motivating) / 4;
    case StaffRole.StrengthCoach:
      return (a.coachFitness * 2 + a.sportsScience + a.physiotherapy) / 4;
    case StaffRole.Doctor:
      return (a.sportsScience * 2 + a.physiotherapy) / 3;
    case StaffRole.Physiotherapist:
      return (a.physiotherapy * 2 + a.sportsScience) / 3;
    case StaffRole.YouthCoach:
      return (a.workingWithYouth * 2 + a.coachTactical + a.motivating) / 4;
    default:
      return 10;
  }
}

/** A coach's worth on the training court, 1-20 — a head coach's, an assistant's, the manager's own. */
export function coachingRating(a: StaffAttributes): number {
  return (
    a.coachAttacking + a.coachBlocking + a.coachServing + a.coachReception +
    a.coachSetting + a.coachTactical + a.manManagement + a.motivating
  ) / 8;
}

/** The attributes a profile shows — everything but the hidden three. */
export const VISIBLE_STAFF_ATTRIBUTES: ReadonlyArray<keyof StaffAttributes> = [
  'coachAttacking', 'coachBlocking', 'coachServing', 'coachReception', 'coachSetting', 'coachTactical',
  'coachMental', 'coachFitness', 'manManagement', 'motivating', 'discipline', 'workingWithYouth',
  'judgingAbility', 'potentialAssessment', 'sportsScience', 'physiotherapy',
];

/** How well this scout knows a given nation, 1-20. */
export function knowledgeOf(s: Staff, nationIdx: number, conf: Confederation): number {
  const specific = s.nationKnowledge.get(nationIdx);
  const regional = s.regionKnowledge[conf] ?? 5;
  return specific !== undefined ? Math.max(specific, regional) : regional;
}
