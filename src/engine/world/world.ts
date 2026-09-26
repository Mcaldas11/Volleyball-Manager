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
import type { IncomingOffer } from './negotiation.ts';
import type { Talks } from './deals.ts';
import type { InterviewSession } from './interviews.ts';
import type { CompetitionRecord } from './records.ts';

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
  /** The end-of-season knockout groups (championship / placement / relegation),
   *  built once the regular season finishes. Empty until then, and reset each
   *  new season by `scheduleLeagueSeason`. */
  playoffGroups: PlayoffGroup[];
}

/** One tie in a knockout bracket: two seeds (index into the group's `seeds`
 *  array) resolving to a winning seed, either by playing a fixture or — for a
 *  bye — immediately. `-1` means "not yet known" (seed) or "not yet
 *  happened" (fixtureId/winnerSeed). */
export interface PlayoffTie {
  homeSeed: number;
  awaySeed: number;
  fixtureId: number;
  winnerSeed: number;
}

export type PlayoffGroupId = 'championship' | 'placement' | 'relegation';

/**
 * A single-elimination bracket carved out of a league's final table: the top
 * clubs play off for the title, a middle band plays off for their final
 * placing, and the bottom band plays off for who actually goes down — each
 * is the same generic bracket, seeded from table position, only the seed
 * list and what the result is used for differ.
 */
export interface PlayoffGroup {
  id: PlayoffGroupId;
  label: string;
  /** Club ids in seed order — index 0 is the top seed. */
  seeds: number[];
  /** rounds[0] is the first round; each later round pairs the previous
   *  round's winners once every tie in it has resolved. */
  rounds: PlayoffTie[][];
  /** Round currently being played or awaited. */
  currentRound: number;
  resolved: boolean;
  /** Club ids from best to worst once resolved; empty until then. */
  finalOrder: number[];
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
  /** Best performer aged 21 or under — the season's breakthrough player. */
  youngPlayerOfTheYear: number;
  /** Biggest rise in current ability across the season, among players who featured. */
  mostImproved: { player: number; gain: number };
  /** Youngest player to hold a regular place this season. */
  youngestPlayer: number;
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

/** One row of the end-of-season awards table shown in a GameMessage. */
export interface SeasonAwardLine {
  label: string;
  playerIdx: number;
  detail: string;
}

/** A player joining or leaving the user's club, kept for the season review. */
export interface TransferLogEntry {
  /** Season the move counts towards — a signing made in the summer window
   *  belongs to the season about to start. */
  season: number;
  day: number;
  playerIdx: number;
  /** Club ids; -1 on either side for a free agent or a released player. */
  fromClub: number;
  toClub: number;
  /** Fee paid, 0 for a free transfer or release. */
  fee: number;
}

/** How the user's club finished one competition, for the season review. */
export interface SeasonReviewStanding {
  competitionId: number;
  /** Final placing, 1-based, once any playoffs are settled. */
  position: number;
  /** Placing in the regular-season table, before any playoffs. */
  tablePosition: number;
  teams: number;
  won: number;
  lost: number;
  points: number;
  setsFor: number;
  setsAgainst: number;
  champion: boolean;
}

/** One of the club's own end-of-season awards. */
export interface SeasonReviewAward {
  kind: 'player' | 'scorer' | 'signing' | 'young' | 'improved';
  playerIdx: number;
  /** Average match rating over the season, across every competition. */
  rating: number;
  apps: number;
  points: number;
  /** Player-of-the-match awards. */
  mvps: number;
  /** Fee paid, for the best signing. */
  fee: number;
  /** Rise in current ability over the season, for the most improved. */
  gain: number;
}

/** A player who joined or left during the season; `clubId` is the other club (-1 for none). */
export interface SeasonReviewMove {
  playerIdx: number;
  clubId: number;
  fee: number;
}

/** The user's club's season in one place — posted to the inbox at the rollover. */
export interface SeasonReview {
  season: number;
  clubId: number;
  standings: SeasonReviewStanding[];
  /** Change of division decided by the season, if any. */
  movement: 'promoted' | 'relegated' | null;
  won: number;
  lost: number;
  homeWon: number;
  homeLost: number;
  awayWon: number;
  awayLost: number;
  longestWinStreak: number;
  /** The most one-sided win, from the club's side: sets and every set score. */
  biggestWin: { fixtureId: number; opponent: number; setsFor: number; setsAgainst: number; setScores: Array<[number, number]> } | null;
  awards: SeasonReviewAward[];
  signings: SeasonReviewMove[];
  departures: SeasonReviewMove[];
  /** The season's books as they were settled, one line per stream. */
  income: Array<[string, number]>;
  costs: Array<[string, number]>;
  transferSpend: number;
  transferIncome: number;
  closingBalance: number;
}

/** Which inbox tab a message belongs in. */
export type MessageCategory = 'news' | 'task' | 'offer' | 'interview' | 'contract';

/** A news item for the club's inbox — a scouting report, a season result, etc. */
export interface GameMessage {
  id: number;
  day: number;
  year: number;
  subject: string;
  body: string;
  /** Player this message concerns, if any — lets the UI jump straight to them. */
  playerIdx?: number;
  /** Pending incoming offer this message concerns, if any. */
  offerId?: number;
  /** End-of-season awards table, rendered specially in the inbox. */
  seasonAwards?: SeasonAwardLine[];
  /** The club's end-of-season review, rendered as a full report in the inbox. */
  seasonReview?: SeasonReview;
  /** Talks this message is an answer in — the inbox offers a way back into them. */
  talksId?: number;
  /** Fixture a pre-match interview request concerns — looked up against
   *  `World.pendingInterviews` to render the question and answer options. */
  fixtureId?: number;
  /** Inbox tab this belongs in. Optional so saves written before the inbox
   *  tabs existed still load — {@link messageCategory} derives it from the
   *  older fields when absent. */
  category?: MessageCategory;
  /** Whether the manager has opened this message yet. Absent means unread. */
  read?: boolean;
}

/** A message's inbox category, falling back to a guess from its other fields
 *  for messages written before `category` existed. */
export function messageCategory(m: GameMessage): MessageCategory {
  if (m.category !== undefined) return m.category;
  if (m.offerId !== undefined) return 'offer';
  if (m.playerIdx !== undefined) return 'task';
  return 'news';
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

// ---- Contracts and transfer windows -------------------------------------------

/** Contracts always run to 30 June — the last day of a season (the save's
 *  seasons start on 1 July). */
export function seasonEndDay(season: number): number {
  return (season + 1) * DAYS_PER_SEASON - 1;
}

/** The season a contract ending on `day` runs out at the end of. */
export function contractEndSeason(day: number): number {
  return Math.floor(day / DAYS_PER_SEASON);
}

/** The calendar year a season ends in — the year on a contract's 30 June. */
export function seasonEndYear(world: Pick<World, 'startYear'>, season: number): number {
  return world.startYear + season + 1;
}

/** A transfer window, in days of the season (0 = 1 July), both ends inclusive. */
export interface TransferWindow {
  name: 'summer' | 'winter';
  opens: number;
  closes: number;
}

/** The football calendar: summer from 1 July to 1 September, winter through January. */
export const TRANSFER_WINDOWS: readonly TransferWindow[] = [
  { name: 'summer', opens: 0, closes: 62 },
  { name: 'winter', opens: 184, closes: 214 },
];

/** The window open on an absolute day, if any. */
export function transferWindowOn(day: number): TransferWindow | null {
  const d = day % DAYS_PER_SEASON;
  return TRANSFER_WINDOWS.find((w) => d >= w.opens && d <= w.closes) ?? null;
}

/** Absolute last day of the window open on `day`, or null when none is. */
export function windowCloseDay(day: number): number | null {
  const w = transferWindowOn(day);
  return w === null ? null : day - (day % DAYS_PER_SEASON) + w.closes;
}

/** The next window to open after `day`, and the absolute day it opens. */
export function nextTransferWindow(day: number): { window: TransferWindow; day: number } {
  const start = day - (day % DAYS_PER_SEASON);
  for (const w of TRANSFER_WINDOWS) {
    if (start + w.opens > day) return { window: w, day: start + w.opens };
  }
  return { window: TRANSFER_WINDOWS[0], day: start + DAYS_PER_SEASON + TRANSFER_WINDOWS[0].opens };
}

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

  /** Unsolicited bids from other clubs for the user's own players. */
  incomingOffers: IncomingOffer[];
  /** Monotonic id source for incomingOffers — they get removed, unlike messages. */
  nextOfferId: number;

  /** Pre-match press conferences in progress or awaiting their summary to be
   *  dismissed, keyed off their fixture. */
  pendingInterviews: InterviewSession[];
  /** Fixture ids already offered a press conference, so the same match is never asked twice. */
  interviewedFixtures: Set<number>;

  /** Appearances and match ratings per player, per competition, for this
   *  season and the last — see records.ts. Keyed by player index. */
  competitionRecords: Map<number, CompetitionRecord[]>;
  /** Each player's most recent match ratings, oldest first. */
  ratingForm: Map<number, number[]>;
  /** Moves in and out of the user's club, this season and the last. */
  transferLog: TransferLogEntry[];
  /** Players who walked out of contract talks with the user, and the day
   *  they will talk again. */
  talksBlockedUntil: Map<number, number>;
  /** The user's negotiations in progress — signings and renewals. */
  talks: Talks[];
  /** Monotonic id source for talks. */
  nextTalksId: number;
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
    incomingOffers: [],
    nextOfferId: 0,
    pendingInterviews: [],
    interviewedFixtures: new Set(),
    competitionRecords: new Map(),
    ratingForm: new Map(),
    transferLog: [],
    talksBlockedUntil: new Map(),
    talks: [],
    nextTalksId: 0,
  };
}

/** Record a move if it involves the user's club — the only club the season
 *  review needs it for, so the log stays small. */
export function logTransfer(
  world: World,
  playerIdx: number,
  fromClub: number,
  toClub: number,
  fee: number,
  season = world.season,
): void {
  if (world.userClubId < 0) return;
  if (fromClub !== world.userClubId && toClub !== world.userClubId) return;
  world.transferLog.push({ season, day: world.day, playerIdx, fromClub, toClub, fee });
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
