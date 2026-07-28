/**
 * The persistent world.
 *
 * Everything the save game contains hangs off this object: every player who
 * has ever existed, every club, every competition, and the record of every
 * season played. It is designed so that a career fifty seasons deep is the
 * same shape as one on day one — only larger.
 */

import { Rng } from '../core/rng.ts';
import type { Club, LeagueTableRow } from '../model/club.ts';
import { PlayerStore } from '../model/players.ts';
import type { Staff } from '../model/staff.ts';
import { MatchFormat } from '../match/engine.ts';
import type { ScoutAssignment, ScoutingKnowledge } from './scouting.ts';

export type CompetitionKind = 'league' | 'cup' | 'continental' | 'international';

export interface Competition {
  id: number;
  name: string;
  kind: CompetitionKind;
  /** Nation index for domestic competitions, -1 otherwise. */
  nation: number;
  tier: number;
  /** Club ids, or nation indices for international competitions. */
  participants: number[];
  table: LeagueTableRow[];
  fixtureIds: number[];
  reputation: number;
  promotionSlots: number;
  relegationSlots: number;
  hasPlayoffs: boolean;
  playoffTeams: number;
  /** Winner of the most recent edition; -1 if never contested. */
  champion: number;
  /** Prize money for finishing first, scaled down the table. */
  prizePool: number;
}

export interface Fixture {
  id: number;
  competitionId: number;
  /** Absolute day number since the start of the save. */
  day: number;
  /** Club ids, or nation indices in international competitions. */
  home: number;
  away: number;
  round: number;
  format: MatchFormat;
  /** 0-1; drives pressure in the match engine. */
  importance: number;
  neutralVenue: boolean;
  played: boolean;
  homeSets: number;
  awaySets: number;
  setScores: Array<[number, number]>;
  /** Player index of the match MVP, -1 if not played. */
  mvp: number;
}

/** A national team squad and its standing. */
export interface NationalTeam {
  nation: number;
  /** Current squad, player store indices. */
  squad: number[];
  /** FIVB-style world ranking points. */
  rankingPoints: number;
  /** Player index of the manager, or -1; the user can be appointed here. */
  managedByUser: boolean;
  olympicGolds: number;
  worldTitles: number;
}

/** One line in the permanent record book. */
export interface SeasonRecord {
  season: number;
  year: number;
  /** Competition id -> winning club id (or nation index). */
  champions: Array<{ competitionId: number; winner: number }>;
  /** Player index of the season's outstanding performer. */
  playerOfTheYear: number;
  topScorer: { player: number; points: number };
  /** Clubs that went bankrupt or dissolved this season. */
  dissolved: number[];
}

export interface HallOfFameEntry {
  player: number;
  inductedYear: number;
  careerPoints: number;
  titles: number;
  caps: number;
  /** Short generated citation, e.g. "Three-time Olympic champion". */
  citation: string;
}

/** A news item for the club's inbox — a scouting report, a season result, etc. */
export interface GameMessage {
  id: number;
  day: number;
  year: number;
  subject: string;
  body: string;
  /** Player this message concerns, if any — lets the UI jump straight to them. */
  playerIdx?: number;
}

/** The human user's own profile — created once, at the start of a career. */
export interface ManagerProfile {
  firstName: string;
  lastName: string;
  birthYear: number;
  /** Day of calendar year, 0-364 — same convention as PlayerStore.birthDay. */
  birthDay: number;
  gender: 'male' | 'female';
  /** Index into NATIONS, same convention as Club.nation / player nation fields. */
  nation: number;
}

/** A manager profile for headless call sites (CLI/calibration) with no real user. */
export function stubManager(nation = 0): ManagerProfile {
  return { firstName: 'Alex', lastName: 'Manager', birthYear: 1985, birthDay: 0, gender: 'male', nation };
}

export const DAYS_PER_SEASON = 365;

/** Where in the season a given day falls. Drives what the game does that day. */
export enum SeasonPhase {
  PreSeason = 0,
  RegularSeason = 1,
  Playoffs = 2,
  NationalTeam = 3,
  OffSeason = 4,
}

/**
 * The volleyball calendar. Domestic leagues run autumn to spring; the national
 * team window is the summer, which is when the Nations League, continental
 * championships, World Championship and Olympic tournament are played.
 */
export function phaseOfSeason(dayOfSeason: number): SeasonPhase {
  if (dayOfSeason < 55) return SeasonPhase.PreSeason;
  if (dayOfSeason < 275) return SeasonPhase.RegularSeason;
  if (dayOfSeason < 310) return SeasonPhase.Playoffs;
  if (dayOfSeason < 350) return SeasonPhase.NationalTeam;
  return SeasonPhase.OffSeason;
}

export interface World {
  /** Seed the world was created from; makes a career fully reproducible. */
  seed: number;
  rng: Rng;

  /** Absolute day since the save began. */
  day: number;
  /** Calendar year of the current day. */
  year: number;
  startYear: number;
  /** 0-based season index. Season 0 is the first one played. */
  season: number;

  players: PlayerStore;
  clubs: Club[];
  staff: Staff[];
  competitions: Competition[];
  fixtures: Fixture[];
  nationalTeams: NationalTeam[];

  history: SeasonRecord[];
  hallOfFame: HallOfFameEntry[];

  /** Club the user manages, or -1 if unemployed. */
  userClubId: number;
  /** Nation whose national team the user manages, or -1. */
  userNationId: number;
  /** The human user's own manager profile. */
  manager: ManagerProfile;

  /** Fixture ids indexed by day, so advancing a day is O(matches that day). */
  fixturesByDay: Map<number, number[]>;

  /** Retired player indices, kept forever for records and the Hall of Fame. */
  retired: number[];

  /** The user's scouting knowledge of players outside their own squad. */
  scoutingKnowledge: Map<number, ScoutingKnowledge>;
  /** Scouts currently dispatched, resolving on a future day. */
  scoutingQueue: ScoutAssignment[];

  /** The club's inbox — news, reports, results, in the order they arrived. */
  messages: GameMessage[];
}

export function dayOfSeason(world: World): number {
  return world.day % DAYS_PER_SEASON;
}

export function currentPhase(world: World): SeasonPhase {
  return phaseOfSeason(dayOfSeason(world));
}

/** Day of the calendar year, for birthdays and age calculations. */
export function dayOfYear(world: World): number {
  // The save begins on 1 July, so season day 0 is calendar day 181.
  return (dayOfSeason(world) + 181) % 365;
}

export function newWorld(seed: number, startYear: number, manager: ManagerProfile): World {
  return {
    seed,
    rng: new Rng(seed),
    day: 0,
    year: startYear,
    startYear,
    season: 0,
    players: new PlayerStore(16384),
    clubs: [],
    staff: [],
    competitions: [],
    fixtures: [],
    nationalTeams: [],
    history: [],
    hallOfFame: [],
    userClubId: -1,
    userNationId: -1,
    manager,
    fixturesByDay: new Map(),
    retired: [],
    scoutingKnowledge: new Map(),
    scoutingQueue: [],
    messages: [],
  };
}

export function addFixture(world: World, f: Fixture): void {
  world.fixtures.push(f);
  let list = world.fixturesByDay.get(f.day);
  if (list === undefined) {
    list = [];
    world.fixturesByDay.set(f.day, list);
  }
  list.push(f.id);
}

export function competitionOf(world: World, id: number): Competition {
  return world.competitions[id];
}

/** Every club playing in a given nation's pyramid. */
export function clubsOfNation(world: World, nation: number): Club[] {
  return world.clubs.filter((c) => c.nation === nation);
}

/** The user's club, or null when unemployed. */
export function userClub(world: World): Club | null {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : null;
}

export interface ClubTrophy {
  year: number;
  competitionName: string;
  tier: number;
}

/**
 * Every title a club has won, most recent first. Mirrors Club.titlesWon
 * exactly in count — both are written at the same site, awardTitles() in
 * rollover.ts.
 */
export function clubTrophies(world: World, clubId: number): ClubTrophy[] {
  const out: ClubTrophy[] = [];
  for (const record of world.history) {
    for (const c of record.champions) {
      if (c.winner !== clubId) continue;
      const comp = world.competitions[c.competitionId];
      if (comp === undefined) continue;
      out.push({ year: record.year, competitionName: comp.name, tier: comp.tier });
    }
  }
  return out.reverse();
}
