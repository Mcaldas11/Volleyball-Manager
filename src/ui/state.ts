/**
 * Game state for the UI.
 *
 * A deliberately thin layer: the engine owns the world and all the rules, and
 * this only holds what the *interface* needs — which club the user manages,
 * which screen is open, which player is selected, and the last match they
 * watched. Nothing here may contain simulation logic; if a rule lives in the
 * UI it cannot be tested headlessly or run in a fifty-season career.
 */

import { applyPreferences, loadPreferences, savePreferences, type Preferences } from './preferences.ts';
import { playAroundTheLeague, type AroundTheLeague } from '../engine/season/aroundTheLeague.ts';
import { bookCamp, type CampKind } from '../engine/world/camp.ts';
import { requestLowerTarget, requestWages } from '../engine/world/board.ts';
import { setUiGame } from './gameGender.ts';
import { arrangeFriendly, toggleFrame, toggleWatch } from '../engine/world/nationalExtras.ts';
import { startCourse } from '../engine/world/courses.ts';
import { requestExpansion } from '../engine/world/supporters.ts';
import { askOwner } from '../engine/world/owners.ts';
import { atRisk, chooseTreatment, type InjuryCase, type Treatment } from '../engine/world/treatment.ts';
import { menteesOf, mentorBlock, mentorOf, setMentor } from '../engine/world/mentoring.ts';
import { rivalryName, rivalsOf, type Rivalry } from '../engine/world/rivals.ts';
import { useSyncExternalStore } from 'react';
import { applyPlan, suggestPlan, undoPlan, type GamePlan, type PlanSide } from '../engine/world/gamePlan.ts';
import type { InboxPrefs } from '../engine/world/world.ts';
import { careerFileName, careerFileStream, exportCareer, importCareer } from './saveFile.ts';
import { bidTurnedDown } from '../engine/world/offerStance.ts';
import { bareResult, reportResult } from '../engine/world/matchReports.ts';
import {
  MatchFormat, MatchSimulator, registeredLiberos, simulateMatch, SUBS_PER_SET, type MatchResult, type RallyLogEntry, type ShoutKind,
  type SubstitutionPlan, type SubstitutionReason, type TeamSetup,
} from '../engine/match/engine.ts';
import type { Club } from '../engine/model/club.ts';
import { matchRating, playedInMatch } from '../engine/match/playerRating.ts';
import { InjuryType, NO_CLUB, PlayerFlag } from '../engine/model/players.ts';
import { MATCHDAY_SQUAD, type Position } from '../engine/model/positions.ts';
import { StaffRole, staffName, type Staff } from '../engine/model/staff.ts';
import {
  backroomOf, compensationFor, longestContract, releaseStaff, roleCount, severanceFor, STAFF_SLOTS, staffBudgetRoom,
  staffInterest, staffMarket, staffOfferBlock, staffWageAsk, type StaffInterest, type StaffListing,
} from '../engine/world/staffMarket.ts';
import {
  answerStaffApproach, counterStaffApproach, openStaffTalks, setStaffListed, staffTalksBlock, staffTalksOf, staffTalksWith,
  submitStaffOffer, withdrawStaffTalks, type StaffTalks,
} from '../engine/world/staffDeals.ts';
import { cohesionEdge, cohesionOf, dressingRoom, setCaptain, setViceCaptain, type DressingRoom } from '../engine/world/dressingRoom.ts';
import { applyTalkMorale, favouriteness, giveTalk, type TalkMoment, type TalkResult, type TalkTone } from '../engine/world/teamTalk.ts';
import { answerTransferRequest, CHAT_LINES, chatBlock, chatOpening, talkToPlayer, type ChatTopic } from '../engine/world/playerTalks.ts';
import { requestUpgrade, upgradeBlock, type FacilityKind } from '../engine/world/facilities.ts';
import { chooseSponsor, setTicketPrice } from '../engine/world/commercial.ts';
import { endAffiliation, proposeAffiliation } from '../engine/world/affiliates.ts';
import { loanToAffiliate } from '../engine/world/deals.ts';
import { challengeChecksFor, type ChallengeCheck, type ChallengeResult, type LastCall } from '../engine/match/engine.ts';
import type { BallMark } from '../engine/match/landing.ts';
import { offerStaffRole, persuadeToPlayOn, retirementPlan, willRetire, type RetirementPlan } from '../engine/world/retirement.ts';
import { interestedClubs, type ClubInterest } from '../engine/world/interest.ts';
import {
  advanceDay, applyMatchResult, matchPrep, newSeasonContext, oppositionRead, pickLineup, playFixture, toTeamSetup,
  type SeasonContext,
} from '../engine/season/seasonEngine.ts';
import { endSeason, type RolloverReport } from '../engine/season/rollover.ts';
import { isSeasonOver, startSeason } from '../engine/season/seasonEngine.ts';
import { calendarOf } from '../engine/world/calendar.ts';
import { generateWorld, type WorldScale } from '../engine/world/worldGen.ts';
import {
  currentPhase, dayOfSeason, DAYS_PER_SEASON, euros, logTransfer, nextTransferWindow, seasonEndDay, SeasonPhase,
  transferWindowOn,
  type Fixture, type GameMessage, type ManagerProfile, type World,
} from '../engine/world/world.ts';
import { MAX_CONTRACT_YEARS, refusesToRenew, SquadRole, type IncomingOffer } from '../engine/world/negotiation.ts';
import { releaseClauseOf, takeUpOption } from '../engine/world/contractTerms.ts';
import { defaultTactics, FORMATION_NAMES, formationOf, type Formation, type TeamTactics } from '../engine/match/tactics.ts';
import {
  activeTactic, deleteTactic as deleteTacticSlot, loadTactic as loadTacticSlot, MAX_TACTICS,
  newTactic as newTacticSlot, renameTactic as renameTacticSlot, tacticSlots, type SavedTactic,
} from '../engine/model/tacticSlots.ts';
import {
  acceptNationalOffer, applyForNationalJob, applyIntlResult, askForSquad, canPlayForCountry, declineNationalOffer,
  leaveNationalJob, matchImportance, nameSquad,
  nationalApplicationBlock, nationName, nationSetup, nextTournamentFor, postMatchReport, squadDue, squadOf,
  startNationalCareer, suggestSquad, userMatchToday, userNation, type IntlMatch, type Tournament,
} from '../engine/world/internationals.ts';
import {
  answerOffers, applyForJobs, countHolidayDay, DEFAULT_HOLIDAY, returnDay, type HolidayPlan,
} from '../engine/world/holiday.ts';
import {
  acceptIncomingOffer, closeTalks, counterIncomingOffer, counterLoanOffer, openTalks, submitOffer, type Talks,
} from '../engine/world/deals.ts';
import {
  coachRequests, coachTalkBlock, loanOf, loansOutOf, loanStarters, MAX_SQUAD, recallFromLoan as recallPlayer,
  requestLoanReport, squadSize, talkToLoanCoach, wageBill, wageRoom,
  type CoachTalkResult, type Loan, type LoanPlayingTime,
} from '../engine/world/loans.ts';
import {
  arrivalsFor, moveDay, pendingMoveOf, seasonOfDay, type PendingMove,
} from '../engine/world/moves.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { isCupFinal } from '../engine/season/cups.ts';
import {
  boardArrangeFriendly, friendlyBlock, isFriendly, requestFriendly, withdrawFriendlyRequest,
} from '../engine/season/friendlies.ts';
import {
  acceptContractOffer as signContractOffer, acceptJobOffer as takeJobOffer, appointManager, askForContract,
  applyForJob as sendApplication, applicationBlock, declineContractOffer as turnDownContractOffer,
  declineJobOffer as turnDownJobOffer, isUnemployed, resign as resignFromClub,
} from '../engine/world/career.ts';
import { positionTarget, setPositionTarget } from '../engine/world/training.ts';
import { effectivePlayerAt } from '../engine/match/court.ts';
import { injuryNotice } from '../engine/world/inbox.ts';
import type { CourtSideline, InjuryPhase } from './courtMotion.ts';
import type { MatchInjury } from '../engine/match/injury.ts';
import type { Highlight } from '../engine/match/highlights.ts';
import {
  academyOffers, sellAcademyPlayer, userYouthLeague, type AcademyOffer, type YouthLeague,
} from '../engine/world/youth.ts';
import {
  answerInterviewQuestion as resolveInterviewAnswer,
  closeInterview as closeInterviewSession,
  conferenceMatch,
  declineInterview as declineInterviewSession,
  generateNationalPostMatchInterview,
  generatePostMatchInterview,
  interviewMessage,
  type AnswerResult,
  type InterviewSession,
} from '../engine/world/interviews.ts';
import { chemistryFor } from '../engine/world/chemistry.ts';
import {
  deleteSave as deleteSaveFromDb, listSaves, loadGame as readSaveWorld,
  newSaveId, saveGame as writeSaveWorld, type SaveMeta,
} from './persistence.ts';

/** One line of a one-to-one: the manager, the player, or what the room saw. */
export interface PlayerTalkLine {
  who: 'you' | 'him' | 'note';
  text: string;
  /** What it did to his morale, on a note. */
  morale?: number;
}

/** A video check under way: the point shown again, then the referee's verdict. */
export interface VideoReview {
  seq: number;
  /** The side that asked. */
  team: 0 | 1;
  /** The point being looked at, as it was played. */
  log: MatchdayLogEntry;
  /** What the referee gave. */
  call: LastCall['call'];
  /** What the side asked the video to look at. */
  check: ChallengeCheck;
  /** Null while the video is still running. */
  verdict: { overturned: boolean; text: string; mark?: BallMark } | null;
  /** Play goes on by itself once it is over — it was running when the video was asked for. */
  resume: boolean;
}

/** A one-to-one in progress. */
export interface PlayerTalk {
  p: number;
  lines: PlayerTalkLine[];
  /** What has been raised this time. */
  asked: ChatTopic[];
}

export type ScreenId =
  | 'home' | 'inbox' | 'calendar' | 'competitions' | 'squad' | 'lineup' | 'tactics' | 'rotations' | 'fixtures' | 'table'
  | 'transfers' | 'training' | 'finances' | 'staff' | 'scouting'
  | 'youth' | 'stats' | 'rankings' | 'halloffame' | 'career' | 'jobs' | 'news' | 'internationals'
  | 'dressing' | 'commercial' | 'facilities' | 'affiliates' | 'analysis' | 'owner' | 'achievements' | 'courses' | 'editor';

/** The screens that still make sense without a club — everything a manager
 *  between jobs can look at. */
export const CLUBLESS_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>([
  'home', 'inbox', 'career', 'jobs', 'competitions', 'stats', 'rankings', 'halloffame', 'news', 'internationals',
  'achievements', 'courses', 'editor',
]);

/** The team screens a national team has as well as a club: its squad, its team sheet, its instructions, its rotations. */
export const NATIONAL_TEAM_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(['squad', 'lineup', 'tactics', 'rotations']);

/** Which of the manager's teams the team screens show, when he has a club and a country. */
export type TeamView = 'club' | 'national';

/** Whatever keeps a default team sheet and plays to instructions: a club, or a national team. */
interface SheetOwner {
  preferredLineup: number[];
  preferredLibero: number;
  preferredDefensiveLibero: number;
  preferredBench?: number[];
  preferredFormation?: Formation;
  tactics: TeamTactics;
}

export type MenuStage = 'main' | 'load' | 'createManager' | 'worldSetup';

/** Something the game waits on — a save, a load, a career file in or out, a new world —
 *  shown in a window of its own while it runs. */
export interface GameTask {
  /** What is being done: "Saving the game". */
  title: string;
  /** Whose career and where it stands — or the file, or the world being made. */
  detail: string;
  /** The stages in order, and the one under way. */
  steps: string[];
  step: number;
  /** A big career or world: the window says it may take a while. */
  slow: boolean;
}

/** What a new career takes charge of: a club, a national team, or both. */
export type CareerMode = 'club' | 'national' | 'both';

export interface WatchedMatch {
  fixture: Fixture;
  result: MatchResult;
  homeName: string;
  awayName: string;
  /** A national team's match: the fixture's sides are nations, not clubs. */
  national?: NationalMatchRef;
}

/** One of the manager's national team's matches, at a tournament. */
export interface NationalMatchRef {
  tournamentId: number;
  matchId: number;
  /** The manager's nation. */
  nation: number;
  /** "EuroVolley 2026 · Quarter-final". */
  title: string;
}

/** One side of the match on the matchday screens: a club, or a nation. */
export interface MatchSide {
  /** Club id, or -1 for a national team. */
  clubId: number;
  /** Nation index for a national team, or -1. */
  nation: number;
  name: string;
  shortName: string;
  /** Everyone who could play for it today and their bench: the club's squad or the nation's fourteen. */
  players: number[];
}

/** The user's own club has just been crowned champion of something —
 *  triggers the trophy-lift celebration overlay. */
export interface TrophyCelebration {
  clubId: number;
  /** A national team's title: the nation, and no club. */
  nation?: number;
  competitionName: string;
}

/** The talks screen: a view onto one of `world.talks`, with the offer being
 *  drafted. The talks themselves — stage, demands, patience, any offer out
 *  for an answer — live in the world, and carry on while the screen is shut. */
export interface Negotiation {
  talksId: number;
  feeOffer: number;
  termsWage: number;
  termsRole: SquadRole;
  /** Seasons the contract runs, counting this one — it ends on 30 June. */
  termsYears: number;
  /** Loan talks: the share of his wage you offer to pay, 0-1. */
  loanShare: number;
  /** Loan talks: the playing time you promise him. */
  loanPlayingTime: LoanPlayingTime;
  /** Terms: the small print — see contractTerms.ts. 0 is none. */
  termsAppearance: number;
  termsTitleBonus: number;
  termsClause: number;
  termsOption: boolean;
  termsAgentFee: number;
  /** A problem with the offer itself (budget, window) before it is sent. */
  message: string | null;
}

/** The small print of an offer being put together. */
export type SmallPrint = Pick<Negotiation, 'termsAppearance' | 'termsTitleBonus' | 'termsClause' | 'termsOption' | 'termsAgentFee'>;

/** Where the browser remembers that the welcome tour has been seen. */
const WELCOME_KEY = 'vm.welcome';

/** A team talk the coach gave, and how it went. */
export interface GivenTalk {
  tone: TalkTone;
  result: TalkResult;
}

/** The staff talks screen: the offer being put together, before it is sent. */
export interface StaffNegotiation {
  talksId: number;
  /** Compensation to his club — while that is what is being agreed. */
  fee: number;
  wage: number;
  /** Seasons the contract runs, counting this one — it ends on 30 June. */
  years: number;
  /** A problem with the offer itself (budget, places) before it is sent. */
  message: string | null;
}

/** Narrowing controls for the Scouting screen's player pool. `null` on any
 *  bound means "no constraint" — the filter is simply not applied. */
export interface ScoutFilters {
  query: string;
  position: Position | null;
  ageMin: number | null;
  ageMax: number | null;
  heightMin: number | null;
  heightMax: number | null;
  /** 0 means no minimum — the ability scale never goes negative. */
  potentialMin: number;
  valueMax: number | null;
  freeAgentOnly: boolean;
}

export const DEFAULT_SCOUT_FILTERS: ScoutFilters = {
  query: '',
  position: null,
  ageMin: null,
  ageMax: null,
  heightMin: null,
  heightMax: null,
  potentialMin: 0,
  valueMax: null,
  freeAgentOnly: false,
};

export interface IncomingOfferReview {
  offerId: number;
  playerIdx: number;
  buyingClubId: number;
  fee: number;
  counterFee: number;
  /** Loan offers: the terms being drafted to ask them for. */
  counterShare: number;
  counterPlayingTime: LoanPlayingTime;
  message: string | null;
  expiresOnDay: number;
}

/** A conversation with a loanee's coach about his playing time: what is being
 *  asked, how, and — once spoken — the coach's answer. */
export interface CoachTalk {
  playerIdx: number;
  request: LoanPlayingTime;
  firm: boolean;
  result: CoachTalkResult | null;
}

/** One step in the in-game back/forward history — which screen, and which
 *  player or club profile (if any) was open over it. */
interface NavEntry {
  screen: ScreenId;
  selectedPlayer: number | null;
  selectedClub: number | null;
  /** Inbox message whose season review is open full-screen. */
  selectedReview: number | null;
  /** Competition whose page is open. */
  selectedCompetition: number | null;
  /** Coach (staff id) whose profile is open. */
  selectedCoach?: number | null;
  /** Nation whose national team page is open. */
  selectedNation?: number | null;
}

function sameNav(a: NavEntry, b: NavEntry): boolean {
  return a.screen === b.screen && a.selectedPlayer === b.selectedPlayer &&
    a.selectedClub === b.selectedClub && a.selectedReview === b.selectedReview &&
    a.selectedCompetition === b.selectedCompetition && (a.selectedCoach ?? null) === (b.selectedCoach ?? null) &&
    (a.selectedNation ?? null) === (b.selectedNation ?? null);
}

/** How many steps back the header's back button remembers. */
const NAV_HISTORY_LIMIT = 50;

/** How long each day stays on screen while Continue runs the calendar on —
 *  long enough to watch the date tick over, short enough that a quiet month
 *  passes in a second or two. */
/** Something to answer before the day moves on — see GameState.pendingDecision. */
export interface PendingDecision {
  kind: 'interview' | 'offer' | 'squad';
  /** What the Continue button says while it waits. */
  label: string;
  /** Why the day can't move on yet. */
  reason: string;
  /** The press conference waiting, by its id. */
  interviewId: number | null;
  offerId: number | null;
  /** The inbox message to answer it from. */
  messageId: number | null;
}

const DAY_TICK_MS = 45;
/** A holiday runs a little quicker — the days are the assistant's. */
const HOLIDAY_TICK_MS = 110;
/** The processing window: how long the day stands before it turns, and the
 *  least time the window stays up for a single day. */
const PROCESS_LEAD_MS = 380;
const PROCESS_MIN_MS = 1250;

/** Rallies the AI lets a substitution settle before it considers another. */
const AI_SUB_COOLDOWN_RALLIES = 4;
/** Chance, each rally, that the AI acts on a substitution it judges warranted. */
const AI_SUB_CHANCE = 0.5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MatchdaySnapshot {
  homeCourt: number[];
  awayCourt: number[];
  /** -1 if that side has no libero on the floor. */
  homeLibero: number;
  awayLibero: number;
  homeScore: number;
  awayScore: number;
  homeSets: number;
  awaySets: number;
  set: number;
  serving: 0 | 1;
  matchOver: boolean;
  /** The rotation each side stands in, P1 to P6 as 0-5; absent on a match saved before it was kept. */
  homeRotation?: number;
  awayRotation?: number;
}

/** A revealed rally, plus the court arrangement that was in effect while it
 *  was played (rotation only changes between rallies), so the live view can
 *  place each contact in its true zone for the ball animation. */
/** Someone down hurt in the live match, as the viewer plays the stoppage out. */
export interface LiveInjury {
  seq: number;
  /** The engine's own record of it — it learns whether he came off, and for whom. */
  inj: MatchInjury;
  /** The user's own player: the call is his. */
  ours: boolean;
  phase: InjuryPhase;
}

export interface MatchdayLogEntry {
  entry: RallyLogEntry;
  homeCourt: number[];
  awayCourt: number[];
  homeLibero: number;
  awayLibero: number;
  /** Sets won by each side before this rally — so a viewer still showing the
   *  rally can show the scoreboard as it stood. */
  setsBefore: [number, number];
}

export interface MatchdayState {
  fixture: Fixture;
  /** The rest of the round in the competition, played at kick-off to unfold alongside — see aroundTheLeague.ts. */
  around?: AroundTheLeague;
  /** Home and away, as the screens show them. */
  sides: [MatchSide, MatchSide];
  /** The competition, as the banner shows it. */
  title: string;
  /** Set when the match is the manager's national team's. */
  national: NationalMatchRef | null;
  /** Team selection before kickoff, the match itself, or the break between
   *  two sets, where the user picks the six to start the next one. */
  stage: 'lineup' | 'live' | 'setBreak';
  /** Set once a set has been won; the break opens as soon as the viewer has
   *  shown that final point. */
  setBreakPending: boolean;
  /** What the AI side changed in its six for the set about to start — shown
   *  at the set break. Empty when it kept the same team. */
  opponentChanges: SubstitutionPlan[];
  userIsHome: boolean;
  /** The user's side, regardless of home/away; edited pre-kickoff and again
   *  at every set break. */
  homeLineup: number[];
  /** The reception libero — the only libero, unless a defensive one is named. */
  homeLibero: number;
  /** Second libero who plays whenever the team serves, or -1. */
  homeDefensiveLibero: number;
  /** The reserves named for the match: with the six and the liberos, the fourteen. */
  homeBench: number[];
  /** The liberos named for the match, fixed at kickoff — at most two. */
  homeLiberos?: number[];
  /** Reserve liberos the coach has down to play in the six rather than as the spare libero — until kickoff. */
  homeOutfieldLiberos?: number[];
  speed: 1 | 1.5 | 2;
  paused: boolean;
  /** Wall-clock ms; once reached the rally loop auto-resumes — a substitution stoppage, not a real pause. */
  pauseUntil: number | null;
  /** Rallies revealed so far, for the live commentary feed and ball animation. */
  log: MatchdayLogEntry[];
  /** Latest read from liveSim.snapshot(), refreshed after every rally. */
  snapshot: MatchdaySnapshot | null;
  /** Per team (0=home, 1=away). Resets each set, same as the engine's own limit. */
  timeoutsUsed: [number, number];
  /** Which team's timeout is currently open (pausing play for tactics/subs), or null. */
  timeoutActive: 0 | 1 | null;
  /** The most recent substitution, either side — drives the live "X off, Y on" banner.
   *  `libero` marks a libero change rather than a regular substitution;
   *  `reason` is set when the AI made it, so the banner can say why. */
  lastSubstitution: {
    team: 0 | 1;
    outPlayerIdx: number;
    inPlayerIdx: number;
    seq: number;
    libero?: 'reception' | 'defence';
    reason?: SubstitutionReason;
  } | null;
  /** The user's last shout from the touchline and how it landed, for the banner;
   *  `rally` is the log length it was made at, for the wait before the next. */
  lastShout?: { kind: ShoutKind; effect: 'lifted' | 'flat' | 'tense'; seq: number; rally: number } | null;
  /** How warm each of the user's players is, 0-1: everyone warmed up before the
   *  match; on court they stay warm, on the bench they cool. Missing: warm. */
  warmth?: Map<number, number>;
  /** The user's substitutes sent to warm up. */
  warming?: Set<number>;
  /** The talks the coach has given: before the match, and at each set break, by the set it was for. */
  talks?: { prematch?: GivenTalk; sets: Record<number, GivenTalk> };
  /** The last video check, either side's, for the banner. */
  lastChallenge?: { seq: number; team: 0 | 1; overturned: boolean; verdict: string } | null;
  /** The stoppage under way is for the video, not a substitution. */
  videoCheck?: boolean;
  /** The video being looked at: the point played again on the court, then the verdict. */
  videoReview?: VideoReview | null;
  /** The coach has a panel open — the substitutions, or one player's options: play holds until it is closed. */
  coachPanel?: boolean;
  /** Play was running when he opened it: closing it starts it again. */
  pausedForPanel?: boolean;
  /** Injuries still to be shown, each once the rally it came in has been played out. */
  injuryQueue?: LiveInjury[];
  /** The stoppage for someone hurt under way — null when there is none. */
  injury?: LiveInjury | null;
}

/** Rallies' worth of warm-up from cold to ready, and how fast a substitute cools on the bench. */
const WARM_PER_RALLY = 0.2;
const COOL_PER_RALLY = 0.02;
/** Warm enough to come on without risk. */
export const WARM_READY = 0.7;
/** How many can be warming up at once. */
export const MAX_WARMING = 4;
/** The chance of a strain coming on stone cold — less the warmer he is, none once ready. */
const COLD_STRAIN = 0.18;

const COURT_VIEW_KEY = 'vm.courtView';

function readCourtView(): '3d' | '2d' {
  try {
    return window.localStorage.getItem(COURT_VIEW_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

/** Rallies between one shout from the touchline and the next. */
export const SHOUT_COOLDOWN = 6;

class Game {
  world: World | null = null;
  ctx: SeasonContext = newSeasonContext();
  screen: ScreenId = 'home';
  /** The message open in the Inbox's reading pane. */
  inboxSelected: number | null = null;
  /** True while Continue is running the calendar on, day by day. */
  processing = false;
  /** The holiday options dialog, open — with the return date it offers first. */
  holidayDialog: { returnDay: number | null } | null = null;
  /** The dialog to invite a club to a friendly, while it is open. */
  friendlyDialog = false;
  /** A point or play being shown again, and what it is. */
  replay: { highlight: Highlight; title: string } | null = null;
  /** The instructions left last time, offered again next time. */
  holidayPlan: HolidayPlan = DEFAULT_HOLIDAY;
  /** The processing window, up while days pass — one on Continue, many on
   *  holiday — with the inbox as it stood when it opened. */
  processingView: { kind: 'day' | 'holiday'; firstMessage: number; firstNews: number } | null = null;
  /** Away on holiday: since when, until when (null for indefinitely), and a
   *  request to come back early. */
  holiday: { since: number; until: number | null; cutShort: boolean } | null = null;
  /** The user's match that has just finished: its result stays on screen
   *  until they continue, which brings in the rest of the matchday. */
  postMatch: number | null = null;
  selectedPlayer: number | null = null;
  selectedClub: number | null = null;
  /** A coach's profile, open over the screen — a staff id. */
  selectedCoach: number | null = null;
  /** A national team's page, open over the screen — a nation index. */
  selectedNation: number | null = null;
  /** Id of the inbox message whose season review is open full-screen, if any. */
  selectedReview: number | null = null;
  /** Competition whose page is open over the current screen, if any. */
  selectedCompetition: number | null = null;
  /** Tournament the International screen should open on. */
  focusTournament: number | null = null;
  /** Player the Scouting screen should jump to next time it opens; consumed once. */
  scoutingFocus: number | null = null;
  negotiation: Negotiation | null = null;
  /** The player the open profile is being compared with — see Compare.tsx. */
  compareTo: number | null = null;
  /** Players whose profiles were opened lately, the latest first. */
  recentPlayers: number[] = [];
  staffNegotiation: StaffNegotiation | null = null;
  /** The help, open over whatever is on screen. */
  helpOpen = false;
  /** A new manager's first look round — see help.tsx. */
  welcomeOpen = false;
  incomingOffer: IncomingOfferReview | null = null;
  /** A word with the coach of a club playing one of ours on loan. */
  coachTalk: CoachTalk | null = null;
  /** A one-to-one with one of the squad, in his office. */
  playerTalk: PlayerTalk | null = null;
  /** Fixture id of the press conference currently open full-screen, if any. */
  /** The press conference on screen, by its id. */
  activeInterviewId: number | null = null;
  /** The player's own settings — see preferences.ts — and whether their window is open. */
  prefs: Preferences = loadPreferences();
  settingsOpen = false;
  matchday: MatchdayState | null = null;
  private liveSim: MatchSimulator | null = null;
  /** Distinguishes each substitution for React, even if the same two players swap twice. */
  private subSeq = 0;
  /** Index into matchday.log at the last timeout (either side) — a simple anti-spam cooldown for the AI. */
  private lastTimeoutAtRally = -Infinity;
  /** Index into matchday.log at the AI's last substitution, so it lets a change settle before the next. */
  private lastAISubAtRally = -Infinity;
  watched: WatchedMatch | null = null;
  /** The manager's national team's last match, for its result screen. */
  private lastNational: WatchedMatch | null = null;
  lastRollover: RolloverReport | null = null;
  /** Set right after a rollover the user's own club won a league title in —
   *  cleared once the celebration has been shown. */
  trophyCelebration: TrophyCelebration | null = null;
  busy = false;
  notice = '';
  /** Where the header's back/forward buttons lead — browser-style: any fresh
   *  navigation pushes onto `backStack` and discards `forwardStack`. */
  private backStack: NavEntry[] = [];
  private forwardStack: NavEntry[] = [];

  // ---- Menu / save-game flow --------------------------------------------
  menuStage: MenuStage = 'main';
  /** What the game is busy with — a save, a load, a career file, a new world — under a window saying so. */
  task: GameTask | null = null;
  /** What the career being created takes charge of. */
  careerMode: CareerMode = 'club';
  /** Club and country: the club is taken, the nation still to pick. */
  private nationStepPending = false;
  /** With a club and a country, which of the two the team screens are about. */
  teamView: TeamView = 'club';
  pendingManager: ManagerProfile | null = null;
  currentScale: WorldScale | null = null;
  saves: SaveMeta[] = [];
  currentSaveId: string | null = null;
  saveCreatedAt: number | null = null;

  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- Lifecycle --------------------------------------------------------

  newGame(scale: WorldScale, seed: number, gender: 'men' | 'women' = 'men'): void {
    const manager = this.pendingManager;
    if (manager === null) return;
    this.beginCareer(generateWorld({ seed, startYear: 2026, scale, manager, gender }), scale, gender);
  }

  /** A new career's world, built under the processing window: the world, then its first season. */
  async createWorld(scale: WorldScale, seed: number, gender: 'men' | 'women' = 'men'): Promise<void> {
    const manager = this.pendingManager;
    if (manager === null || this.task !== null) return;
    const size = `${scale[0].toUpperCase()}${scale.slice(1)}`;
    await this.beginTask('Building the world', `${size} world · the ${gender === 'women' ? "women's" : "men's"} game`,
      ['Nations, clubs and players', 'The season ahead'], scale !== 'small');
    try {
      const world = generateWorld({ seed, startYear: 2026, scale, manager, gender });
      await this.taskStep(1);
      this.beginCareer(world, scale, gender);
    } catch (err) {
      this.notice = `Could not build the world — ${err instanceof Error ? err.message : String(err)}`;
    }
    this.endTask();
    this.emit();
  }

  /** A freshly made world, its season under way, taken up as the career in play. */
  private beginCareer(world: World, scale: WorldScale, gender: 'men' | 'women'): void {
    // Every new career offers the tutorial — its first card has the way out for those who know the game.
    this.welcomeOpen = true;
    setUiGame(gender);
    this.ctx = newSeasonContext();
    startSeason(world, this.ctx);
    this.world = world;
    this.teamView = 'club';
    this.watched = null;
    this.lastRollover = null;
    this.trophyCelebration = null;
    this.notice = '';
    this.screen = 'home';
    this.inboxSelected = null;
    this.postMatch = null;
    this.processing = false;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.matchday = null;
    this.liveSim = null;
    this.pendingManager = null;
    this.nationStepPending = false;
    this.currentScale = scale;
    this.currentSaveId = newSaveId();
    this.saveCreatedAt = Date.now();
    this.resetHistory();
    this.emit();
  }

  // ---- Menu / save-game flow --------------------------------------------

  goToMenu(stage: MenuStage): void {
    this.menuStage = stage;
    this.emit();
  }

  setPendingManager(manager: ManagerProfile): void {
    this.pendingManager = manager;
    this.menuStage = 'worldSetup';
    this.emit();
  }

  async refreshSaves(): Promise<void> {
    try {
      this.saves = await listSaves();
    } catch {
      this.notice = 'Could not read saved careers.';
    }
    this.emit();
  }

  async loadGame(id: string): Promise<void> {
    if (this.task !== null) return;
    const saved = this.saves.find((s) => s.id === id);
    await this.beginTask('Loading the career', saved !== undefined ? careerLine(saved) : '',
      ['Reading the save', 'Setting up the world'], isBigCareer(saved));
    try {
      const { world, season } = await readSaveWorld(id, () => this.taskStep(1));
      this.world = world;
      setUiGame(world.gender ?? 'men');
      this.teamView = 'club';
      this.ctx = season;
      this.watched = null;
      this.lastRollover = null;
      this.trophyCelebration = null;
      this.notice = '';
      this.screen = 'home';
      this.inboxSelected = null;
      this.postMatch = null;
      this.processing = false;
      this.selectedPlayer = null;
      this.selectedClub = null;
      this.selectedCoach = null;
      this.selectedNation = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.negotiation = null;
      this.staffNegotiation = null;
      this.incomingOffer = null;
      this.coachTalk = null;
      this.playerTalk = null;
      this.matchday = null;
      this.liveSim = null;
      this.currentSaveId = id;
      this.nationStepPending = false;
      const meta = this.saves.find((s) => s.id === id);
      this.currentScale = meta?.scale ?? null;
      this.saveCreatedAt = meta?.createdAt ?? Date.now();
      this.resetHistory();
    } catch {
      this.notice = 'Could not load that save.';
    }
    this.endTask();
    this.emit();
  }

  /** Puts the task's window up, and lets it paint before the work starts — the work may hold the page. */
  private async beginTask(title: string, detail: string, steps: string[], slow: boolean): Promise<void> {
    this.task = { title, detail, steps, step: 0, slow };
    setTaskProgress(null);
    this.busy = true;
    this.emit();
    await nextPaint();
  }

  /** On to the task's next stage, shown before it starts. */
  private async taskStep(step: number, detail?: string): Promise<void> {
    if (this.task === null) return;
    this.task = { ...this.task, step, detail: detail ?? this.task.detail };
    setTaskProgress(null);
    this.emit();
    await nextPaint();
  }

  /** The task done: its window comes down with the next emit. */
  private endTask(): void {
    this.task = null;
    setTaskProgress(null);
    this.busy = false;
  }

  /** The summary a save of the career as it stands is listed by. */
  private currentMeta(world: World, id: string): SaveMeta {
    const nationalTeam = world.career.nationalTeam ?? -1;
    return {
      id,
      managerName: `${world.manager.firstName} ${world.manager.lastName}`,
      nationCode: NATIONS[world.manager.nation]?.code ?? '???',
      clubName: this.club?.name ?? (nationalTeam >= 0 ? `${NATIONS[nationalTeam].name} national team` : 'Unemployed'),
      clubNationCode: this.club ? NATIONS[this.club.nation].code : nationalTeam >= 0 ? NATIONS[nationalTeam].code : '',
      scale: this.currentScale ?? 'standard',
      inGameDate: this.dateLabel(),
      season: world.season,
      createdAt: this.saveCreatedAt ?? Date.now(),
      updatedAt: Date.now(),
      schemaVersion: 1,
      ...(world.gender === 'women' ? { gender: 'women' as const } : {}),
    };
  }

  /** Hand the browser a file to save. */
  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Where an exported career goes: a place the player picks, where the browser
   *  lets them — asked first, while the click still counts as theirs — and
   *  otherwise the downloads folder (null). 'cancelled' when they close the dialog. */
  private async pickCareerFile(name: string): Promise<FileSystemFileHandle | null | 'cancelled'> {
    const pick = (window as unknown as { showSaveFilePicker?: (options: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (typeof pick !== 'function') return null;
    try {
      return await pick.call(window, {
        suggestedName: name,
        types: [{ description: 'Volleyball Manager career', accept: { 'application/octet-stream': ['.vmcareer'] } }],
      });
    } catch (err) {
      // Not allowed here (an embedded page, say): it downloads instead.
      return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : null;
    }
  }

  /** A career out to a file, written a piece at a time: straight into the place
   *  picked, or downloaded. The game waits while it is written. The last of
   *  `steps` is the writing; `load` takes the task through any before it. */
  private async exportTo(meta: SaveMeta, steps: string[], load: () => Promise<{ world: World; season: SeasonContext }>): Promise<void> {
    if (this.task !== null) return;
    const name = careerFileName(meta);
    const target = await this.pickCareerFile(name);
    if (target === 'cancelled') return;
    await this.beginTask('Exporting the career', careerLine(meta), steps, isBigCareer(meta));
    try {
      const { world, season } = await load();
      await this.taskStep(steps.length - 1);
      const written = progressEvery((bytes: number) => ({ fraction: null, label: `${(bytes / 1e6).toFixed(1)} MB` }));
      if (target !== null) {
        await careerFileStream(meta, world, season, written).pipeTo(await target.createWritable());
      } else {
        this.download(await exportCareer(meta, world, season, written), name);
      }
      this.notice = 'Career exported — keep the file somewhere safe.';
    } catch (err) {
      this.notice = `Could not export the career — ${err instanceof Error ? err.message : String(err)}`;
    }
    this.endTask();
    this.emit();
  }

  /** The career as it stands, as a file to keep — a copy outside the browser. */
  async exportCurrentCareer(): Promise<void> {
    const world = this.world;
    if (world === null) return;
    const season = this.ctx;
    const meta = this.currentMeta(world, this.currentSaveId ?? newSaveId());
    await this.exportTo(meta, ['Writing the file'], async () => ({ world, season }));
  }

  /** A saved career, straight from the list, as a file. */
  async exportSavedCareer(id: string): Promise<void> {
    const meta = this.saves.find((s) => s.id === id);
    if (meta === undefined) return;
    await this.exportTo(meta, ['Reading the save', 'Setting up the world', 'Writing the file'], () => readSaveWorld(id, () => this.taskStep(1)));
    // Reading a save sets its game up: back to the one in play.
    if (this.world !== null) setUiGame(this.world.gender ?? 'men');
  }

  /** A career file brought in: saved as a career of its own, and listed. */
  async importCareerFile(file: File): Promise<void> {
    if (this.task !== null) return;
    await this.beginTask('Importing the career', file.name, ['Reading the file', 'Saving the career'], file.size > 20_000_000);
    try {
      const read = progressEvery((fraction: number) => ({ fraction, label: `${Math.round(fraction * 100)}%` }));
      const { meta, world, season } = await importCareer(file, read);
      await this.taskStep(1, careerLine(meta));
      const id = newSaveId();
      await writeSaveWorld(id, { ...meta, id, updatedAt: Date.now() }, world, season);
      this.notice = `Imported ${meta.managerName}'s career — ${meta.clubName}, ${meta.inGameDate}.`;
      await this.refreshSaves();
    } catch (err) {
      this.notice = err instanceof Error ? err.message : 'Could not import that file.';
    }
    if (this.world !== null) setUiGame(this.world.gender ?? 'men');
    this.endTask();
    this.emit();
  }

  /** The career in play written to its save. False, with the reason as the notice, when it could not be. */
  private async writeCurrentSave(world: World, meta: SaveMeta): Promise<boolean> {
    try {
      await writeSaveWorld(meta.id, meta, world, this.ctx);
      this.notice = 'Game saved.';
      return true;
    } catch (err) {
      this.notice = err instanceof Error ? err.message : 'Could not save this career.';
      return false;
    }
  }

  async saveCurrentGame(): Promise<void> {
    const world = this.world;
    if (world === null || this.task !== null) return;
    if (this.currentSaveId === null) this.currentSaveId = newSaveId();
    const meta = this.currentMeta(world, this.currentSaveId);
    await this.beginTask('Saving the game', careerLine(meta), ['Writing the save'], isBigCareer(meta));
    await this.writeCurrentSave(world, meta);
    this.endTask();
    this.emit();
  }

  /** Saved, then back to the main menu — unless the save failed: then the career stays open, not lost. */
  async exitToMenu(): Promise<void> {
    const world = this.world;
    if (world === null || this.task !== null) return;
    if (this.currentSaveId === null) this.currentSaveId = newSaveId();
    const meta = this.currentMeta(world, this.currentSaveId);
    await this.beginTask('Saving and exiting', careerLine(meta), ['Writing the save', 'Back to the main menu'], isBigCareer(meta));
    if (!(await this.writeCurrentSave(world, meta))) {
      this.endTask();
      this.emit();
      return;
    }
    await this.taskStep(1);
    this.resetHistory();
    this.world = null;
    this.currentSaveId = null;
    this.saveCreatedAt = null;
    this.currentScale = null;
    this.menuStage = 'main';
    // Said at once: a render already under way must not find the world gone while it still thinks it's there.
    this.emit();
    await this.refreshSaves();
    this.endTask();
    this.emit();
  }

  async deleteSave(id: string): Promise<void> {
    try {
      await deleteSaveFromDb(id);
    } catch {
      this.notice = 'Could not delete that save.';
    }
    await this.refreshSaves();
  }

  setCareerMode(mode: CareerMode): void {
    this.careerMode = mode;
    this.emit();
  }

  /** The step of a new career still to take — its club, or its nation — or
   *  null once it has begun. A career between jobs has begun. */
  setupStep(): 'club' | 'nation' | null {
    const world = this.world;
    if (world === null) return null;
    if (this.nationStepPending) return 'nation';
    // Begun: a club, a nation, or one of them once — out of work now is still a career.
    const begun = world.userClubId >= 0 || this.unemployed || world.career.nationalTeam !== undefined ||
      (world.career.nationalJobs?.length ?? 0) > 0;
    if (begun) return null;
    return this.careerMode === 'national' ? 'nation' : 'club';
  }

  takeCharge(clubId: number): void {
    if (this.world === null) return;
    appointManager(this.world, clubId);
    // Club and country: the nation is next.
    this.nationStepPending = this.careerMode === 'both' && this.world.career.nationalTeam === undefined;
    this.screen = 'home';
    this.resetHistory();
    this.emit();
  }

  /** Take over a national team as the career begins — on its own, or after the club. */
  takeChargeOfNation(nation: number): void {
    const world = this.world;
    if (world === null) return;
    startNationalCareer(world, nation);
    this.nationStepPending = false;
    this.screen = 'home';
    this.resetHistory();
    this.emit();
  }

  /** Club and country after all — just the club. */
  skipNationStep(): void {
    this.nationStepPending = false;
    this.emit();
  }

  get club(): Club | null {
    if (this.world === null || this.world.userClubId < 0) return null;
    return this.world.clubs[this.world.userClubId];
  }

  /** Out of work between jobs — not the same as not having picked a first club. */
  get unemployed(): boolean {
    return this.world !== null && isUnemployed(this.world);
  }

  // ---- Career -----------------------------------------------------------

  /**
   * The manager's club has changed under the interface — he was sacked, or
   * resigned, or took another job. Whatever was open on the old club closes,
   * and the history (full of the old club's screens) starts again.
   */
  private employmentChanged(): void {
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedCompetition = null;
    this.watched = null;
    this.postMatch = null;
    this.activeInterviewId = null;
    if (this.club === null && !CLUBLESS_SCREENS.has(this.screen) &&
      !(this.nationalView() && NATIONAL_TEAM_SCREENS.has(this.screen))) this.screen = 'home';
    // Club and country no longer: the team screens are about the one that is left.
    if (this.club === null) this.teamView = 'national';
    else if (this.world !== null && userNation(this.world) < 0) this.teamView = 'club';
    this.resetHistory();
  }

  /** Walk out on the club. */
  resign(): void {
    const world = this.world;
    if (world === null || this.matchday !== null || this.postMatch !== null || this.processing) return;
    const name = this.club?.name ?? 'the club';
    if (!resignFromClub(world)) return;
    this.employmentChanged();
    this.screen = 'career';
    this.notice = `You have resigned from ${name}.`;
    this.emit();
  }

  /** Apply for a club's vacant head coach's job. */
  applyForJob(clubId: number): void {
    const world = this.world;
    if (world === null) return;
    const problem = applicationBlock(world, clubId);
    const app = problem === null ? sendApplication(world, clubId) : null;
    this.notice = app !== null
      ? `Application sent to ${world.clubs[clubId]?.name ?? 'the club'} — expect an answer by ${this.dateLabelForDay(app.answerOn)}.`
      : problem ?? 'You cannot apply for that job.';
    this.emit();
  }

  /** Take a job on offer — leaving the current club, if there is one. */
  acceptJobOffer(offerId: number): void {
    const world = this.world;
    if (world === null || this.matchday !== null || this.postMatch !== null || this.processing) return;
    const offer = world.career.offers.find((o) => o.id === offerId);
    if (offer === undefined || !takeJobOffer(world, offerId)) {
      this.notice = 'That offer is no longer on the table.';
      this.emit();
      return;
    }
    this.employmentChanged();
    this.screen = 'home';
    this.inboxSelected = null;
    this.notice = `You are the new head coach of ${world.clubs[offer.clubId]?.name ?? 'the club'}.`;
    this.emit();
  }

  /** Turn a job offer down. */
  declineJobOffer(offerId: number): void {
    const world = this.world;
    if (world === null) return;
    const offer = world.career.offers.find((o) => o.id === offerId);
    turnDownJobOffer(world, offerId);
    if (offer !== undefined) this.notice = `You turned down ${world.clubs[offer.clubId]?.name ?? 'the club'}.`;
    this.emit();
  }

  // ---- Navigation -------------------------------------------------------

  private navEntry(): NavEntry {
    return {
      screen: this.screen,
      selectedPlayer: this.selectedPlayer,
      selectedClub: this.selectedClub,
      selectedReview: this.selectedReview,
      selectedCompetition: this.selectedCompetition,
      selectedCoach: this.selectedCoach,
      selectedNation: this.selectedNation,
    };
  }

  /** Remember where we are before moving somewhere new. Closing a profile is
   *  deliberately not recorded — only moves *to* somewhere are. */
  private pushHistory(next: NavEntry): void {
    const current = this.navEntry();
    if (sameNav(current, next)) return;
    this.backStack.push(current);
    if (this.backStack.length > NAV_HISTORY_LIMIT) this.backStack.shift();
    this.forwardStack = [];
  }

  private resetHistory(): void {
    this.backStack = [];
    this.forwardStack = [];
  }

  private restoreNav(entry: NavEntry): void {
    this.screen = entry.screen;
    this.selectedPlayer = entry.selectedPlayer;
    this.selectedClub = entry.selectedClub;
    this.selectedReview = entry.selectedReview;
    this.selectedCompetition = entry.selectedCompetition;
    this.selectedCoach = entry.selectedCoach ?? null;
    this.selectedNation = entry.selectedNation ?? null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Whether the back/forward buttons would actually lead anywhere — entries
   *  identical to the current view (left behind by closing a profile) don't count. */
  canGoBack(): boolean {
    const current = this.navEntry();
    return this.backStack.some((e) => !sameNav(e, current));
  }

  canGoForward(): boolean {
    const current = this.navEntry();
    return this.forwardStack.some((e) => !sameNav(e, current));
  }

  back(): void {
    const current = this.navEntry();
    while (this.backStack.length > 0) {
      const entry = this.backStack.pop()!;
      if (sameNav(entry, current)) continue;
      this.forwardStack.push(current);
      this.restoreNav(entry);
      return;
    }
  }

  forward(): void {
    const current = this.navEntry();
    while (this.forwardStack.length > 0) {
      const entry = this.forwardStack.pop()!;
      if (sameNav(entry, current)) continue;
      this.backStack.push(current);
      this.restoreNav(entry);
      return;
    }
  }

  go(screen: ScreenId): void {
    this.pushHistory({ screen, selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: null });
    this.screen = screen;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    // Navigating away must always work, even mid-negotiation — the deal
    // itself is untouched (it lives in world.incomingOffers), only the
    // full-screen prompt for it closes.
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  select(playerIdx: number | null): void {
    if (playerIdx !== null) {
      this.pushHistory({ screen: this.screen, selectedPlayer: playerIdx, selectedClub: null, selectedReview: null, selectedCompetition: null });
      // Remembered, to compare him with later.
      this.recentPlayers = [playerIdx, ...this.recentPlayers.filter((p) => p !== playerIdx)].slice(0, 12);
    }
    this.selectedPlayer = playerIdx;
    this.compareTo = null;
    if (playerIdx !== null) {
      this.selectedClub = null;
      this.selectedCoach = null;
      this.selectedNation = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
      this.coachTalk = null;
      this.playerTalk = null;
    }
    this.emit();
  }

  selectClub(clubId: number | null): void {
    if (clubId !== null) {
      this.pushHistory({ screen: this.screen, selectedPlayer: null, selectedClub: clubId, selectedReview: null, selectedCompetition: null });
    }
    this.selectedClub = clubId;
    if (clubId !== null) {
      this.selectedCoach = null;
      this.selectedNation = null;
      this.selectedPlayer = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
      this.coachTalk = null;
      this.playerTalk = null;
    }
    this.emit();
  }

  /** Open a coach's profile — any club's head coach, or one of the staff. */
  selectCoach(staffId: number | null): void {
    if (staffId !== null) {
      this.pushHistory({
        screen: this.screen, selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: null,
        selectedCoach: staffId,
      });
      this.selectedPlayer = null;
      this.selectedClub = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
      this.coachTalk = null;
      this.playerTalk = null;
    }
    this.selectedCoach = staffId;
    if (staffId !== null) this.selectedNation = null;
    this.emit();
  }

  /** Open a national team's page — any nation's. */
  selectNation(nation: number | null): void {
    if (nation !== null) {
      this.pushHistory({
        screen: this.screen, selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: null,
        selectedNation: nation,
      });
      this.selectedPlayer = null;
      this.selectedClub = null;
      this.selectedCoach = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
      this.coachTalk = null;
      this.playerTalk = null;
    }
    this.selectedNation = nation;
    this.emit();
  }

  /** Open the International screen on one tournament. */
  openTournament(id: number): void {
    this.focusTournament = id;
    this.go('internationals');
  }

  /** Open a competition's page: its groups, bracket and results. */
  openCompetition(compId: number): void {
    // A national teams' competition opens on its latest tournament.
    const comp = this.world?.competitions[compId];
    if (comp?.kind === 'international') {
      const latest = [...(this.world?.internationals?.tournaments ?? [])].reverse().find((t) => t.competitionId === compId);
      this.focusTournament = latest?.id ?? null;
      this.go('internationals');
      return;
    }
    this.pushHistory({
      screen: this.screen, selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: compId,
    });
    this.selectedCompetition = compId;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Clear the toast, but only if it still shows `text` — a newer notice
   *  that replaced it in the meantime keeps its own full display time. */
  dismissNotice(text?: string): void {
    if (text !== undefined && this.notice !== text) return;
    if (this.notice === '') return;
    this.notice = '';
    this.emit();
  }

  /** Mark an inbox message as opened — idempotent, and a no-op if it's gone. */
  /** Open an end-of-season review full-screen, from its inbox message. */
  openSeasonReview(messageId: number): void {
    const world = this.world;
    if (world === null) return;
    const msg = world.messages.find((m) => m.id === messageId);
    if (msg?.seasonReview === undefined) return;
    msg.read = true;
    this.pushHistory({ screen: this.screen, selectedPlayer: null, selectedClub: null, selectedReview: messageId, selectedCompetition: null });
    this.selectedReview = messageId;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Close the full-screen season review — like closing a profile, not a step in the history. */
  closeSeasonReview(): void {
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.emit();
  }

  markMessageRead(messageId: number): void {
    const world = this.world;
    if (world === null) return;
    const m = world.messages.find((x) => x.id === messageId);
    if (m === undefined || m.read === true) return;
    m.read = true;
    this.emit();
  }

  // ---- Inbox ------------------------------------------------------------

  /** Open a message in the Inbox, from anywhere — it counts as read. */
  openMessage(messageId: number): void {
    const world = this.world;
    if (world === null) return;
    const m = world.messages.find((x) => x.id === messageId);
    if (m === undefined) return;
    this.pushHistory({ screen: 'inbox', selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: null });
    this.screen = 'inbox';
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.inboxSelected = messageId;
    m.read = true;
    this.emit();
  }

  /** Show a message in the reading pane (or clear it) without leaving the Inbox. */
  selectMessage(messageId: number | null): void {
    this.inboxSelected = messageId;
    if (messageId !== null) {
      const m = this.world?.messages.find((x) => x.id === messageId);
      if (m !== undefined) m.read = true;
    }
    this.emit();
  }

  /** Unread messages still in the inbox, oldest first — the order they are worked through. */
  unreadMessages(): GameMessage[] {
    return this.world?.messages.filter((m) => m.read !== true && m.archived !== true) ?? [];
  }

  /** Open the oldest unread message — what the big button does while the inbox has any. */
  nextUnread(): void {
    const next = this.unreadMessages()[0];
    if (next !== undefined) this.openMessage(next.id);
  }

  markAllRead(): void {
    for (const m of this.world?.messages ?? []) m.read = true;
    this.emit();
  }

  toggleStar(messageId: number): void {
    const m = this.world?.messages.find((x) => x.id === messageId);
    if (m === undefined) return;
    m.starred = m.starred !== true;
    this.emit();
  }

  /** Move a message to the Archive folder, or back into the inbox. */
  toggleArchive(messageId: number): void {
    const m = this.world?.messages.find((x) => x.id === messageId);
    if (m === undefined) return;
    m.archived = m.archived !== true;
    m.read = true;
    this.emit();
  }

  /** Open the full-screen press conference the user chose to attend — a
   *  no-op if it is no longer open. */
  openInterview(sessionId: number): void {
    const world = this.world;
    if (world === null) return;
    const session = world.pendingInterviews.find((s) => s.id === sessionId);
    if (session === undefined) return;
    const msg = interviewMessage(world, session);
    if (msg !== undefined) msg.read = true;
    this.activeInterviewId = sessionId;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Skip a press conference entirely — always safe: no morale risk, but no
   *  boost either. */
  declineInterview(sessionId: number): void {
    const world = this.world;
    if (world === null) return;
    const session = world.pendingInterviews.find((s) => s.id === sessionId);
    const msg = session === undefined ? undefined : interviewMessage(world, session);
    if (!declineInterviewSession(world, sessionId)) return;
    if (msg !== undefined) msg.read = true;
    this.notice = 'You declined the press conference.';
    this.emit();
  }

  /** Answer the current question of the open press conference. Nudges both
   *  squads' morale, updates that journalist's body language, and advances
   *  to the next question (or finishes the conference). */
  answerInterviewQuestion(sessionId: number, optionIndex: number): AnswerResult | null {
    const world = this.world;
    if (world === null) return null;
    const result = resolveInterviewAnswer(world, sessionId, optionIndex);
    if (result === null) return null;
    // Answering is itself reading the message — without this, a manager who
    // goes straight into the conference from the notification would still
    // see it flagged unread afterwards.
    const session = world.pendingInterviews.find((s) => s.id === sessionId);
    const msg = session === undefined ? undefined : interviewMessage(world, session);
    if (msg !== undefined) msg.read = true;
    this.emit();
    return result;
  }

  /** The press conference after a match, still open: offered on its result screen. */
  postMatchInterview(fixtureId: number): InterviewSession | null {
    return this.world?.pendingInterviews.find((s) => s.kind === 'post' && s.fixtureId === fixtureId) ?? null;
  }

  /** Close a finished press conference's summary and return to the game. */
  closeInterview(): void {
    const world = this.world;
    const sessionId = this.activeInterviewId;
    if (world !== null && sessionId !== null) closeInterviewSession(world, sessionId);
    this.activeInterviewId = null;
    this.emit();
  }

  /** Jump to the Scouting screen with a specific player already selected. */
  focusScouting(playerIdx: number): void {
    this.pushHistory({ screen: 'scouting', selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: null });
    this.scoutingFocus = playerIdx;
    this.screen = 'scouting';
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Called by the Scouting screen once it has read scoutingFocus on mount. */
  clearScoutingFocus(): void {
    this.scoutingFocus = null;
  }

  // ---- Time -------------------------------------------------------------

  /**
   * The big button: on to the next day. New post opens in the Inbox, the way
   * a manager's day starts with the desk. Longer jumps — to a match, to a
   * date — are a holiday (see goOnHoliday). `maxDays` runs on further, a day
   * at a time, until something happens: news, or one of the user's matches.
   */
  async continueGame(maxDays = 1): Promise<void> {
    const world = this.world;
    // Not while the career is being written to a file: it is read as it goes.
    if (world === null || this.processing || this.task !== null || this.matchday !== null || this.activeInterviewId !== null) return;
    if (this.postMatch !== null) {
      this.finishPostMatch();
      return;
    }
    if (this.ownFixtureToday() !== null) {
      this.openMatchday();
      return;
    }
    if (userMatchToday(world) !== null) {
      this.openNationalMatchday();
      return;
    }
    if (this.openPendingDecision()) return;

    this.processing = true;
    const before = world.messages.length;
    const opened = Date.now();
    // The processing window: the day as it stands, then turning over, and
    // whatever came in with it, before it closes on its own.
    this.processingView = { kind: 'day', firstMessage: before, firstNews: world.nextNewsId };
    this.emit();
    await this.processingPause(PROCESS_LEAD_MS);
    for (let d = 0; d < maxDays; d++) {
      if (this.world !== world) break;
      this.stepDay();
      this.emit();
      if (this.world !== world) break;
      if (world.messages.length > before || this.ownFixtureToday() !== null || userMatchToday(world) !== null ||
        this.trophyCelebration !== null) break;
      await sleep(DAY_TICK_MS);
    }
    await this.processingPause(PROCESS_MIN_MS - (Date.now() - opened));
    this.processingView = null;
    this.processing = false;

    // A season review opened by the rollover keeps the screen; otherwise the
    // first of the new post is waiting in the inbox — news of the manager's
    // own job before anything else.
    if (this.world === world && world.messages.length > before && this.selectedReview === null) {
      const fresh = world.messages.slice(before);
      this.openMessage((fresh.find((m) => m.category === 'career') ?? fresh[0]).id);
    }
    this.emit();
  }

  /**
   * What must be answered before the day can move on or a match be played,
   * the way a manager can't walk past the press or leave a bid sitting on
   * the desk: a press conference neither faced nor declined, or a bid for one
   * of the players not yet accepted, countered or turned down. The press
   * conference comes first — it is for the next match.
   */
  pendingDecision(): PendingDecision | null {
    const world = this.world;
    if (world === null) return null;
    for (const s of world.pendingInterviews) {
      // Only a conference before a match holds the day up; the one after it can wait.
      if (s.finished || s.kind !== 'pre' || conferenceMatch(world, s)?.played !== false) continue;
      const msg = interviewMessage(world, s);
      return {
        kind: 'interview', label: 'Press conference', interviewId: s.id, offerId: null, messageId: msg?.id ?? null,
        reason: 'The press are waiting — attend the press conference or decline it before you go on.',
      };
    }
    for (const o of world.incomingOffers) {
      if ((o.status ?? 'open') !== 'open') continue;
      const msg = world.messages.find((m) => m.offerId === o.id);
      const club = world.clubs[o.buyingClubId]?.name ?? 'A club';
      return {
        kind: 'offer', label: 'Respond to offer', interviewId: null, offerId: o.id, messageId: msg?.id ?? null,
        reason: `${club} want an answer about ${world.players.fullName(o.playerIdx)} — accept, counter or reject the offer before you go on.`,
      };
    }
    const due = squadDue(world);
    if (due !== undefined) {
      return {
        kind: 'squad', label: 'Name your squad', interviewId: null, offerId: null, messageId: null,
        reason: `${nationName(userNation(world))} need your fourteen for the ${due.name} — name the squad before you go on.`,
      };
    }
    return null;
  }

  /** Take the manager to what needs answering, and say why he can't go on
   *  yet. False if nothing does. */
  openPendingDecision(): boolean {
    const d = this.pendingDecision();
    if (d === null) return false;
    if (d.kind === 'squad') {
      // The squad is named in the federation's message.
      const m = this.world === null ? undefined : askForSquad(this.world);
      if (m !== undefined) this.openMessage(m.id);
    } else if (d.kind === 'interview' && d.interviewId !== null) {
      // "Press conference": straight into the room — it can still be declined from its message.
      this.openInterview(d.interviewId);
    } else if (d.messageId !== null) this.openMessage(d.messageId);
    else if (d.interviewId !== null) this.openInterview(d.interviewId);
    else if (d.offerId !== null) this.openOffer(d.offerId);
    this.notice = d.reason;
    this.emit();
    return true;
  }

  /** Wait up to `ms` with the processing window up — less if it is closed. */
  private async processingPause(ms: number): Promise<void> {
    const until = Date.now() + ms;
    while (this.processingView !== null && Date.now() < until) await sleep(Math.min(50, until - Date.now()));
  }

  /** Close the processing window: at once on Continue; on holiday, by coming
   *  back at the end of the day in progress. */
  closeProcessing(): void {
    if (this.holiday !== null) {
      this.returnFromHoliday();
      return;
    }
    this.processingView = null;
    this.emit();
  }

  // ---- Holidays -----------------------------------------------------------

  /** Open the holiday options, offering `day` as the return date. */
  openHoliday(day: number | null = null): void {
    if (this.world === null || this.processing || this.matchday !== null || this.postMatch !== null) return;
    this.holidayDialog = { returnDay: day };
    this.emit();
  }

  closeHoliday(): void {
    this.holidayDialog = null;
    this.emit();
  }

  // ---- Friendlies -------------------------------------------------------

  /** Show a point or play again, on the live court. */
  openReplay(highlight: Highlight, title: string): void {
    this.replay = { highlight, title };
    this.emit();
  }

  closeReplay(): void {
    this.replay = null;
    this.emit();
  }

  openFriendlyDialog(): void {
    if (this.club === null) return;
    this.friendlyDialog = true;
    this.emit();
  }

  closeFriendlyDialog(): void {
    this.friendlyDialog = false;
    this.emit();
  }

  /** Invite a club to a friendly; its answer comes to the inbox. */
  inviteToFriendly(clubId: number, day: number, home: boolean): boolean {
    const world = this.world;
    if (world === null) return false;
    const problem = friendlyBlock(world, clubId, day);
    const req = problem === null ? requestFriendly(world, clubId, day, home) : null;
    const name = world.clubs[clubId]?.name ?? 'The club';
    this.notice = req !== null
      ? `Invitation sent — ${name} will answer by ${this.dateLabelForDay(req.answerOn)}.`
      : problem ?? 'That friendly cannot be arranged.';
    if (req !== null) this.friendlyDialog = false;
    this.emit();
    return req !== null;
  }

  /** Have the board fix up a friendly — booked at once. */
  boardFriendly(): void {
    const world = this.world;
    if (world === null) return;
    const f = boardArrangeFriendly(world);
    if (f === null) {
      this.notice = 'The board could not find a club free to play before the pre-season ends.';
    } else {
      const home = f.home === world.userClubId;
      const opp = world.clubs[home ? f.away : f.home]?.name ?? 'a club';
      this.notice = `The board has arranged a friendly ${home ? 'at home to' : 'away at'} ${opp} on ${this.dateLabelForDay(f.day)}.`;
      this.friendlyDialog = false;
    }
    this.emit();
  }

  /** Take back an invitation not yet answered. */
  withdrawFriendly(requestId: number): void {
    const world = this.world;
    if (world === null) return;
    withdrawFriendlyRequest(world, requestId);
    this.emit();
  }

  // ---- The manager's contract ---------------------------------------------

  /** Ask the board for a new contract — its answer comes back at once. */
  askForNewContract(): void {
    const world = this.world;
    if (world === null || this.club === null) return;
    this.notice = askForContract(world);
    this.emit();
  }

  acceptContractOffer(): void {
    const world = this.world;
    if (world === null) return;
    this.notice = signContractOffer(world) ? 'New contract signed.' : 'That offer is no longer on the table.';
    this.emit();
  }

  declineContractOffer(): void {
    const world = this.world;
    if (world === null) return;
    turnDownContractOffer(world);
    this.notice = 'You turned down the board’s offer. You can still ask for a new contract later.';
    this.emit();
  }

  /**
   * Go on holiday: day after day runs on without the manager until the date
   * he set — or, sooner, until something needs him: a job offer, the sack,
   * the season's end. Each day his assistant answers the bids for his players
   * and applies for jobs as instructed, and plays any match that comes up,
   * with the manager's own tactics and team or his own. The news that came
   * in waits in the inbox.
   */
  async goOnHoliday(plan: HolidayPlan): Promise<void> {
    const world = this.world;
    if (world === null || this.processing || this.matchday !== null || this.postMatch !== null) return;
    const until = returnDay(world, plan.until);
    if (until !== null && until <= world.day) return;
    this.holidayPlan = plan;
    this.holidayDialog = null;
    this.holiday = { since: world.day, until, cutShort: false };
    this.processingView = { kind: 'holiday', firstMessage: world.messages.length, firstNews: world.nextNewsId };
    this.processing = true;
    this.emit();

    const before = world.messages.length;
    const clubId = world.userClubId;
    const season = world.season;
    const offers = world.career.offers.length;
    const nationalOffers = (): number => world.internationals?.offers?.length ?? 0;
    const nationalBefore = nationalOffers();
    const contractOffer = world.career.contractOffer?.id;
    let why: string | null = null;
    while (until === null || world.day < until) {
      if (this.holiday.cutShort) { why = 'you cut it short'; break; }
      this.holidayDay(plan);
      if (this.world !== world) break;
      if (world.userClubId !== clubId) { why = world.userClubId < 0 ? 'the board has let you go' : 'you have a new job'; break; }
      if (world.career.offers.length > offers) { why = 'a club has offered you a job'; break; }
      if (nationalOffers() > nationalBefore) { why = 'a national team has offered you its job'; break; }
      if (world.career.contractOffer != null && world.career.contractOffer.id !== contractOffer) {
        why = 'the board has offered you a new contract';
        break;
      }
      if (world.season !== season) { why = 'the season is over'; break; }
      this.emit();
      await sleep(HOLIDAY_TICK_MS);
      if (this.world !== world) break;
    }
    const away = world.day - this.holiday.since;
    this.holiday = null;
    this.processingView = null;
    this.processing = false;
    const news = world.messages.length - before;
    this.notice = `Back from holiday after ${away} day${away === 1 ? '' : 's'}${why !== null ? ` — ${why}` : ''}.` +
      (news > 0 ? ` ${news} new message${news === 1 ? '' : 's'} in the inbox.` : '');
    // The season's review keeps the screen; otherwise, back to the desk.
    if (this.selectedReview === null && news > 0) this.go('inbox');
    this.emit();
  }

  /** Come back early — the holiday ends at the end of the day in progress. */
  returnFromHoliday(): void {
    if (this.holiday === null) return;
    this.holiday.cutShort = true;
    this.emit();
  }

  /** One day away: the bids and the job market dealt with as instructed, and
   *  any match played by the assistant. */
  private holidayDay(plan: HolidayPlan): void {
    const world = this.world;
    if (world === null) return;
    answerOffers(world, plan.offers, plan.onlyListed);
    if (plan.jobs !== null) applyForJobs(world, plan.jobs);
    // The press get the assistant instead.
    for (const s of [...world.pendingInterviews]) {
      const msg = interviewMessage(world, s);
      if (s.finished || !declineInterviewSession(world, s.id)) continue;
      if (msg !== undefined) msg.body = 'Your assistant faced the press while you were on holiday.';
    }
    countHolidayDay(world);
    // The national squad, if it is due: the assistant's fourteen.
    if (squadDue(world) !== undefined) nameSquad(world, suggestSquad(world, userNation(world)));
    const match = this.ownFixtureToday();
    const club = this.club;
    if (match === null || club === null) {
      this.stepDay();
      return;
    }
    // The assistant's own tactics and team, unless told to keep the manager's.
    const tactics = club.tactics;
    const lineup = club.preferredLineup;
    if (!plan.useTactics) club.tactics = defaultTactics();
    if (!plan.useSelection) club.preferredLineup = [];
    try {
      this.stepDay();
    } finally {
      club.tactics = tactics;
      club.preferredLineup = lineup;
    }
    if (match.played) this.checkChampionshipWin(world, match);
  }

  /** One day of the world — or, once the season is over, the rollover into the next. */
  private stepDay(): void {
    const world = this.world;
    if (world === null) return;
    const clubId = world.userClubId;
    if (isSeasonOver(world)) {
      this.rollover();
    } else {
      // The user's own matches always run through the full rally engine.
      advanceDay(world, this.ctx, {
        detailedClubs: clubId >= 0 ? new Set([clubId]) : undefined,
      });
      // Keep the most recent of the user's matches available to review.
      const played = this.fixtureOn(world.day - 1);
      if (played !== null && played.played) this.captureWatched(played);
    }
    if (world.userClubId !== clubId) this.employmentChanged();
  }

  /** The user's match today, if it is still to be played. */
  ownFixtureToday(): Fixture | null {
    const world = this.world;
    if (world === null) return null;
    const f = this.fixtureOn(world.day);
    return f !== null && !f.played ? f : null;
  }

  /**
   * Play today's match without watching it — the full rally engine, straight
   * to the result screen.
   */
  instantResult(): void {
    const world = this.world;
    const f = this.ownFixtureToday();
    if (world !== null && f === null && !this.processing && userMatchToday(world) !== null) {
      this.instantNationalResult();
      return;
    }
    if (world === null || f === null || this.processing) return;
    if (this.openPendingDecision()) return;
    playFixture(world, this.ctx, f, true);
    this.captureWatched(f);
    this.checkChampionshipWin(world, f);
    this.showPostMatch(f);
  }

  private showPostMatch(f: Fixture): void {
    // The press want the manager's reaction — offered from the result screen.
    if (this.world !== null) generatePostMatchInterview(this.world, f);
    this.postMatch = f.id;
    this.matchday = null;
    this.liveSim = null;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /**
   * Leave the result screen: the rest of the matchday is played, the day
   * rolls over, and the league's round-up — or whatever else came in — opens
   * in the inbox.
   */
  finishPostMatch(): void {
    const world = this.world;
    if (world === null || this.postMatch === null) return;
    this.postMatch = null;
    // The club's and the nation's matches on the one day: the other one next.
    if (this.ownFixtureToday() !== null) {
      this.openMatchday();
      return;
    }
    if (userMatchToday(world) !== null) {
      this.openNationalMatchday();
      return;
    }
    const before = world.messages.length;
    const clubId = world.userClubId;
    advanceDay(world, this.ctx, { detailedClubs: clubId >= 0 ? new Set([clubId]) : undefined });
    if (world.userClubId !== clubId) this.employmentChanged();
    const fresh = world.messages.slice(before);
    // The sack, if that result was one too many; otherwise the round-up.
    const first = fresh.find((m) => m.category === 'career') ?? fresh.find((m) => m.roundup !== undefined) ?? fresh[0];
    if (first !== undefined) this.openMessage(first.id);
    else this.go('home');
  }

  private rollover(): void {
    const world = this.world;
    if (world === null) return;
    // The day this season closes on — the new one's calendar may differ.
    const closesOn = calendarOf(world).rollover;
    this.lastRollover = endSeason(world, this.ctx);
    this.notice = `Season ${world.year} complete.`;

    // The season just ended opens as its full-screen review, the way FM
    // closes a season; it stays in the inbox to come back to.
    const reviewMsg = [...world.messages].reverse().find((m) => m.seasonReview !== undefined);
    if (reviewMsg !== undefined && reviewMsg.seasonReview?.season === world.season - 1) {
      this.openSeasonReview(reviewMsg.id);
    }

    // world.history's last entry is the season that just ended — check it for
    // a title win before anything else (like relegation reshuffling leagues)
    // makes "which competition did we just win" harder to answer. A
    // playoff-decided title was already celebrated the instant the final was
    // won (see checkChampionshipWin), so only pick up titles decided by the
    // plain table (leagues too small to run playoffs) here.
    const record = world.history[world.history.length - 1];
    const title = record?.champions.find((c) => {
      if (c.winner !== world.userClubId) return false;
      const comp = world.competitions[c.competitionId];
      return comp !== undefined && comp.kind === 'league' && !comp.hasPlayoffs;
    });
    if (title !== undefined) {
      const comp = world.competitions[title.competitionId];
      this.trophyCelebration = { clubId: world.userClubId, competitionName: comp?.name ?? 'the league' };
    }

    // Step into the new season.
    while (dayOfSeason(world) >= closesOn) {
      world.day++;
      if (world.day % DAYS_PER_SEASON === 0) world.year++;
    }
  }

  /** Close the trophy celebration overlay. */
  dismissTrophyCelebration(): void {
    this.trophyCelebration = null;
    this.emit();
  }

  private captureWatched(fixture: Fixture): void {
    const world = this.world;
    if (world === null) return;
    const result = this.ctx.detailedResults.get(fixture.id);
    if (result === undefined) return;
    this.watched = {
      fixture,
      result,
      homeName: world.clubs[fixture.home]?.name ?? '?',
      awayName: world.clubs[fixture.away]?.name ?? '?',
    };
  }

  // ---- Fixtures ---------------------------------------------------------

  private fixtureOn(day: number): Fixture | null {
    const world = this.world;
    if (world === null || world.userClubId < 0) return null;
    const ids = world.fixturesByDay.get(day);
    if (ids === undefined) return null;
    for (const id of ids) {
      const f = world.fixtures[id];
      if (f.home === world.userClubId || f.away === world.userClubId) return f;
    }
    return null;
  }

  nextFixture(): Fixture | null {
    const world = this.world;
    if (world === null || world.userClubId < 0) return null;
    let best: Fixture | null = null;
    for (const f of world.fixtures) {
      if (f.played) continue;
      if (f.home !== world.userClubId && f.away !== world.userClubId) continue;
      if (f.day < world.day) continue;
      if (best === null || f.day < best.day) best = f;
    }
    return best;
  }

  /** All of the user's fixtures this season, in order. */
  ownFixtures(): Fixture[] {
    const world = this.world;
    if (world === null || world.userClubId < 0) return [];
    return world.fixtures
      .filter((f) => f.home === world.userClubId || f.away === world.userClubId)
      .sort((a, b) => a.day - b.day);
  }

  /**
   * Every match of every club the manager has been in charge of, while he
   * was — the whole career, in order. A club given by hand, with no job on
   * the record, counts throughout.
   */
  private careerFixtures(): Fixture[] {
    const world = this.world;
    if (world === null) return [];
    const jobs = world.career.jobs;
    const mine = (f: Fixture): boolean => {
      if (jobs.length === 0) return f.home === world.userClubId || f.away === world.userClubId;
      return jobs.some((j) => (f.home === j.clubId || f.away === j.clubId) && f.day >= j.startDay && (j.endDay < 0 || f.day <= j.endDay));
    };
    return world.fixtures.filter((f) => world.competitions[f.competitionId]?.kind !== 'international' && mine(f))
      .sort((a, b) => a.day - b.day);
  }

  /** The seasons the manager has had matches in, the latest first — this one always. */
  managerSeasons(): number[] {
    const world = this.world;
    if (world === null) return [];
    const seasons = new Set<number>([world.season]);
    for (const f of this.careerFixtures()) seasons.add(Math.floor(f.day / DAYS_PER_SEASON));
    return [...seasons].sort((a, b) => b - a);
  }

  /** The manager's matches in one season, in order: his club's, and any other he had charge of that season. */
  managerFixtures(season: number): Fixture[] {
    return this.careerFixtures().filter((f) => Math.floor(f.day / DAYS_PER_SEASON) === season);
  }

  /** Replay the user's most recent completed match through the full engine. */
  reviewLast(): WatchedMatch | null {
    return this.watched;
  }

  /**
   * Open the report of a match already played: in full — the rally log too —
   * while it is still in memory; its box score and rotations from the save
   * once it isn't; the score and the sets for one played before reports were kept.
   */
  openMatchReport(fixtureId: number): void {
    const world = this.world;
    const fixture = world?.fixtures[fixtureId];
    if (world === null || fixture === undefined || !fixture.played) return;
    const detailed = this.ctx.detailedResults.get(fixture.id);
    const kept = world.matchReports?.get(fixture.id);
    this.watched = {
      fixture,
      result: detailed ?? (kept !== undefined ? reportResult(fixture, kept) : bareResult(fixture)),
      homeName: world.clubs[fixture.home]?.name ?? '?',
      awayName: world.clubs[fixture.away]?.name ?? '?',
    };
    this.emit();
  }

  /** The scouts' plan against a club. */
  gamePlanAgainst(oppId: number): GamePlan | null {
    const world = this.world;
    const club = this.club;
    const opp = world?.clubs[oppId];
    return world === null || club === null || opp === undefined ? null : suggestPlan(world, club, opp);
  }

  /** Put the scouts' plan into every rotation's instructions. */
  applyGamePlan(oppId: number, fixtureId: number): void {
    const world = this.world;
    const club = this.club;
    const plan = this.gamePlanAgainst(oppId);
    if (world === null || club === null || plan === null) return;
    applyPlan(world, club, plan, fixtureId);
    this.notice = `The plan for ${world.clubs[oppId]?.name ?? 'the match'} is in — every rotation.`;
    this.emit();
  }

  /** A national team as the scouts' plan sees it: the fourteen for the match, its sheet, its instructions.
   *  Its id is -1 - the nation, so it is never taken for a club's. */
  private nationPlanSide(nation: number, fixtureId: number): PlanSide | null {
    const world = this.world;
    if (world === null) return null;
    const own = nation === userNation(world);
    const team = own ? this.nationalSheet() : world.nationalTeams.find((x) => x.nation === nation);
    if (team === null || team === undefined) return null;
    const matchId = -1 - fixtureId;
    const t = world.internationals?.tournaments.find((x) => x.matches.some((m) => m.id === matchId));
    const named = t !== undefined ? squadOf(t, nation) : [];
    const players = named.length > 0 ? named : own ? this.nationalPlayers() : suggestSquad(world, nation);
    return { id: -1 - nation, players, preferredLineup: team.preferredLineup ?? [], tactics: team.tactics ?? defaultTactics() };
  }

  /** The national team scouts' plan against a nation, for the match `fixtureId` (-1 - its id). */
  nationalGamePlan(oppNation: number, fixtureId: number): GamePlan | null {
    const world = this.world;
    if (world === null || userNation(world) < 0) return null;
    const own = this.nationPlanSide(userNation(world), fixtureId);
    const opp = this.nationPlanSide(oppNation, fixtureId);
    return own === null || opp === null ? null : suggestPlan(world, own, opp);
  }

  /** Put the national team scouts' plan into every rotation of its instructions. */
  applyNationalGamePlan(oppNation: number, fixtureId: number): void {
    const world = this.world;
    const sheet = this.nationalSheet();
    const plan = this.nationalGamePlan(oppNation, fixtureId);
    if (world === null || sheet === null || plan === null) return;
    applyPlan(world, { id: -1 - userNation(world), tactics: sheet.tactics }, plan, fixtureId);
    this.notice = `The plan for ${nationName(oppNation)} is in — every rotation of the national team.`;
    this.emit();
  }

  /** Take the national team's plan back out. */
  undoNationalGamePlan(): void {
    const world = this.world;
    const sheet = this.nationalSheet();
    if (world === null || sheet === null) return;
    this.notice = undoPlan(world, { id: -1 - userNation(world), tactics: sheet.tactics })
      ? 'The national team\'s instructions are back as they were.' : 'Nothing to undo.';
    this.emit();
  }

  /** Take the plan back out. */
  undoGamePlan(): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = undoPlan(world, club) ? 'Your instructions are back as they were.' : 'Nothing to undo.';
    this.emit();
  }

  /** Change one of the manager's preferences for the post. */
  setInboxPref<K extends keyof InboxPrefs>(key: K, value: InboxPrefs[K]): void {
    const world = this.world;
    if (world === null) return;
    world.inboxPrefs = { ...(world.inboxPrefs ?? {}), [key]: value };
    this.emit();
  }

  /** Close the match report beside the fixtures. */
  closeMatchReport(): void {
    this.watched = null;
    this.emit();
  }

  // ---- Matchday -----------------------------------------------------------

  /** Open the pre-match lineup screen for today's match. A match further
   *  off is reached by going on holiday until its day. */
  openMatchday(): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    const next = this.nextFixture();
    if (next === null) return;
    if (world.day < next.day) {
      this.openHoliday(next.day);
      return;
    }
    if (this.openPendingDecision()) return;
    // The club's match: its squad, team sheet and instructions are the ones to see.
    this.teamView = 'club';
    // A profile left open goes; one opened during the match shows over it.
    this.selectedPlayer = null;

    const { lineup, libero, defensiveLibero, bench } = pickLineup(world.players, club);
    const side = (id: number): MatchSide => {
      const c = world.clubs[id];
      return { clubId: id, nation: -1, name: c?.name ?? '—', shortName: c?.shortName ?? '—', players: c?.players ?? [] };
    };
    this.matchday = {
      fixture: next,
      sides: [side(next.home), side(next.away)],
      title: (world.competitions[next.competitionId]?.name ?? 'Match') + (rivalryName(world, next) !== null ? ` · ${rivalryName(world, next)}` : ''),
      national: null,
      stage: 'lineup',
      setBreakPending: false,
      opponentChanges: [],
      userIsHome: next.home === club.id,
      homeLineup: lineup,
      homeLibero: libero,
      homeDefensiveLibero: defensiveLibero,
      homeBench: bench,
      speed: 1,
      paused: false,
      pauseUntil: null,
      log: [],
      snapshot: null,
      timeoutsUsed: [0, 0],
      timeoutActive: null,
      lastSubstitution: null,
      lastShout: null,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Swap a starter on the team sheet — before kickoff or at a set break. */
  setMatchdayPlayer(zoneIdx: number, playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage === 'live') return;
    if (md.homeLiberos?.includes(playerIdx)) {
      this.notice = 'A libero named for the match cannot play in the six.';
      this.emit();
      return;
    }
    const was = md.homeLineup[zoneIdx];
    md.homeLineup[zoneIdx] = playerIdx;
    this.trade(md, playerIdx, was);
    this.emit();
  }

  /**
   * One of the fourteen has taken a place on the sheet from `was`: off the
   * bench, `was` sits down in his place; from outside the squad, the two
   * simply swap, and the squad stays as it was in size.
   */
  private trade(md: MatchdayState, incoming: number, was: number): void {
    const at = md.homeBench.indexOf(incoming);
    if (at >= 0) {
      if (was >= 0) md.homeBench[at] = was;
      else md.homeBench.splice(at, 1);
    }
  }

  /** Name a player in the matchday squad — while there is room in the fourteen. */
  addToMatchdaySquad(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup' || md.homeBench.includes(playerIdx)) return;
    if (this.matchdaySquad().length >= MATCHDAY_SQUAD) {
      this.notice = `Only ${MATCHDAY_SQUAD} can be named — leave someone out first.`;
    } else md.homeBench.push(playerIdx);
    this.emit();
  }

  /** Leave a reserve out of the matchday squad. */
  dropFromMatchdaySquad(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return;
    md.homeBench = md.homeBench.filter((p) => p !== playerIdx);
    this.emit();
  }

  /** The user's fourteen for today: the six, the liberos and the bench. */
  matchdaySquad(): number[] {
    const md = this.matchday;
    if (md === null) return [];
    if (md.stage !== 'lineup' && this.liveSim !== null) return this.liveSim.squadFor(md.userIsHome ? 0 : 1);
    return [...md.homeLineup, md.homeLibero, md.homeDefensiveLibero, ...md.homeBench].filter((p) => p >= 0);
  }

  /** The user's fit players left out of today's squad — before kickoff. */
  matchdayLeftOut(): number[] {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return [];
    const named = new Set(this.matchdaySquad());
    return md.sides[md.userIsHome ? 0 : 1].players
      .filter((p) => this.matchAvailable(p) && !named.has(p))
      .sort((a, b) => this.world!.players.currentAbility[b] - this.world!.players.currentAbility[a]);
  }

  /** Either side's fourteen in the match under way. */
  matchSquadOf(team: 0 | 1): number[] {
    const md = this.matchday;
    if (md !== null && md.stage === 'lineup' && team === (md.userIsHome ? 0 : 1)) return this.matchdaySquad();
    return this.liveSim?.squadFor(team) ?? [];
  }

  /** The liberos either side named for the match under way. */
  matchLiberosOf(team: 0 | 1): number[] {
    return this.liveSim?.registeredLiberosOf(team) ?? [];
  }

  /** Swap two starting zones' players — dragging one starter onto another on the team sheet. */
  swapMatchdayPlayers(zoneA: number, zoneB: number): void {
    const md = this.matchday;
    if (md === null || md.stage === 'live') return;
    const a = md.homeLineup[zoneA];
    md.homeLineup[zoneA] = md.homeLineup[zoneB];
    md.homeLineup[zoneB] = a;
    this.emit();
  }

  /** Change the (reception) libero on the pre-match lineup screen. Naming the
   *  defensive libero swaps the two roles over. */
  setMatchdayLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage === 'live' || !this.mayPlayLibero(md, playerIdx)) return;
    if (playerIdx === md.homeDefensiveLibero) md.homeDefensiveLibero = md.homeLibero;
    else this.trade(md, playerIdx, md.homeLibero);
    md.homeLibero = playerIdx;
    this.emit();
  }

  /** Name (or with -1, drop) the second libero who plays whenever the team serves. */
  setMatchdayDefensiveLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage === 'live' || (playerIdx >= 0 && !this.mayPlayLibero(md, playerIdx))) return;
    const was = md.homeDefensiveLibero;
    if (playerIdx >= 0 && playerIdx === md.homeLibero) {
      if (was < 0) return;
      md.homeLibero = was;
    } else if (playerIdx >= 0) {
      this.trade(md, playerIdx, was);
    } else if (was >= 0 && md.stage === 'lineup') {
      // One libero from now on: the other stays in the squad, on the bench.
      md.homeBench.push(was);
    }
    md.homeDefensiveLibero = playerIdx;
    this.emit();
  }

  /** Whether a player may take a libero role: before kickoff anyone, after it only a libero named for the match. */
  private mayPlayLibero(md: MatchdayState, playerIdx: number): boolean {
    const problem = md.homeLineup.includes(playerIdx) ? 'He is in the six — bring someone else on for him first.'
      : md.homeLiberos !== undefined && !md.homeLiberos.includes(playerIdx) ? 'Only the two liberos named for the match can play libero.'
        : null;
    if (problem === null) return true;
    this.notice = problem;
    this.emit();
    return false;
  }

  /**
   * Edit the club's saved starting lineup directly — from the Squad screen,
   * any time, not just right before kickoff. `pickLineup` reads this first
   * and only falls back to auto-picking whichever slots it doesn't cover
   * (empty, or a name who's since left or gotten hurt), so this is a genuine
   * default rather than a one-off arrangement that gets thrown away.
   */
  setPreferredLineupSlot(slot: number, playerIdx: number): void {
    const club = this.sheet();
    if (club === null) return;
    const before = this.lineup()?.lineup[slot] ?? -1;
    while (club.preferredLineup.length <= slot) club.preferredLineup.push(-1);
    // Whoever he was, he moves to this slot.
    const was = club.preferredLineup.indexOf(playerIdx);
    if (was >= 0 && was !== slot) club.preferredLineup[was] = -1;
    club.preferredLineup[slot] = playerIdx;
    club.preferredFormation = formationOf(club.tactics);
    this.tradePreferred(playerIdx, before);
    this.emit();
  }

  /** The default bench once `incoming` has taken `was`'s place on the sheet: off the bench, `was` sits down in his place. */
  private tradePreferred(incoming: number, was: number): void {
    const bench = this.sheet()?.preferredBench;
    if (bench === undefined) return;
    const at = bench.indexOf(incoming);
    if (at < 0) return;
    if (was >= 0) bench[at] = was;
    else bench.splice(at, 1);
  }

  /** Name a player in the default matchday squad — while there is room in the fourteen. */
  addToPreferredSquad(playerIdx: number): void {
    const club = this.sheet();
    const picked = this.lineup();
    if (club === null || picked === null) return;
    const named = picked.lineup.length + (picked.libero >= 0 ? 1 : 0) + (picked.defensiveLibero >= 0 ? 1 : 0) + picked.bench.length;
    if (named >= MATCHDAY_SQUAD) this.notice = `Only ${MATCHDAY_SQUAD} can be named — leave someone out first.`;
    else club.preferredBench = [...picked.bench, playerIdx];
    this.emit();
  }

  /** Leave a reserve out of the default matchday squad. */
  dropFromPreferredSquad(playerIdx: number): void {
    const club = this.sheet();
    const picked = this.lineup();
    if (club === null || picked === null) return;
    club.preferredBench = picked.bench.filter((p) => p !== playerIdx);
    this.emit();
  }

  swapPreferredLineupSlots(slotA: number, slotB: number): void {
    const club = this.sheet();
    if (club === null) return;
    while (club.preferredLineup.length < 6) club.preferredLineup.push(-1);
    const a = club.preferredLineup[slotA];
    club.preferredLineup[slotA] = club.preferredLineup[slotB];
    club.preferredLineup[slotB] = a;
    club.preferredFormation = formationOf(club.tactics);
    this.emit();
  }

  /** Set the default (reception) libero; naming the defensive one swaps the roles. */
  setPreferredLibero(playerIdx: number): void {
    const club = this.sheet();
    const picked = this.lineup();
    if (club === null || picked === null) return;
    if (playerIdx === picked.defensiveLibero) club.preferredDefensiveLibero = picked.libero;
    else this.tradePreferred(playerIdx, picked.libero);
    club.preferredLibero = playerIdx;
    this.emit();
  }

  /** Name the default defensive libero, or -1 to play one libero throughout. */
  setPreferredDefensiveLibero(playerIdx: number): void {
    const club = this.sheet();
    const picked = this.lineup();
    if (club === null || picked === null) return;
    if (playerIdx >= 0 && playerIdx === picked.libero) {
      if (picked.defensiveLibero < 0) return;
      club.preferredLibero = picked.defensiveLibero;
    } else if (playerIdx >= 0) {
      this.tradePreferred(playerIdx, picked.defensiveLibero);
    } else if (picked.defensiveLibero >= 0 && club.preferredBench !== undefined) {
      // One libero from now on: the other stays in the squad, on the bench.
      club.preferredBench.push(picked.defensiveLibero);
    }
    club.preferredDefensiveLibero = playerIdx;
    this.emit();
  }

  /** Clear the saved lineup so every slot — and the bench — goes back to auto-picking the best available player. */
  resetPreferredLineup(): void {
    const club = this.sheet();
    if (club === null) return;
    club.preferredLineup = [];
    club.preferredLibero = -1;
    club.preferredDefensiveLibero = -1;
    club.preferredBench = undefined;
    this.emit();
  }

  /** Confirm the lineup and start the live match. */
  kickOff(): void {
    const world = this.world;
    const md = this.matchday;
    if (md?.national != null) {
      this.kickOffNational();
      return;
    }
    const club = this.club;
    if (world === null || md === null || club === null) return;
    const homeClub = world.clubs[md.fixture.home];
    const awayClub = world.clubs[md.fixture.away];
    if (homeClub === undefined || awayClub === undefined) return;

    this.handInSquad(md, (p) => world.players.isAvailable(p));
    const userSetup: TeamSetup = {
      clubId: club.id,
      name: club.name,
      lineup: md.homeLineup,
      libero: md.homeLibero,
      defensiveLibero: md.homeDefensiveLibero,
      bench: md.homeBench,
      liberos: md.homeLiberos,
      tactics: club.tactics,
      // A friendly teaches the opposition nothing.
      read: isFriendly(world, md.fixture) ? 0 : oppositionRead(world, club),
      prep: matchPrep(world, club, md.fixture.day),
      roomEdge: cohesionEdge(cohesionOf(world, club.id)),
      chemistry: chemistryFor(world),
    };
    // The other side keeps any promise of games it has made a loanee — and
    // comes having prepared for the match, as it would anywhere else.
    const theirs = (c: Club): TeamSetup => ({
      ...toTeamSetup(world.players, c, loanStarters(world, c)), prep: matchPrep(world, c, md.fixture.day),
      roomEdge: cohesionEdge(cohesionOf(world, c.id)), chemistry: chemistryFor(world),
    });
    const homeSetup = md.userIsHome ? userSetup : theirs(homeClub);
    const awaySetup = md.userIsHome ? theirs(awayClub) : userSetup;

    this.liveSim = new MatchSimulator(world.players, {
      home: homeSetup,
      away: awaySetup,
      format: md.fixture.format,
      importance: md.fixture.importance,
      neutralVenue: md.fixture.neutralVenue,
      collectLog: true,
      // A league match's best point and play go in the running for the month's awards.
      highlights: !isFriendly(world, md.fixture),
      seed: world.rng.next(),
      friendly: isFriendly(world, md.fixture),
    });
    const talk = md.talks?.prematch;
    if (talk !== undefined) this.liveSim.teamTalk(md.userIsHome ? 0 : 1, talk.result.multiplier, 'match');
    // The rest of the round is played alongside.
    md.around = playAroundTheLeague(world, this.ctx, md.fixture) ?? undefined;
    this.startLive();
  }

  /**
   * The team sheet handed in at kickoff: the bench as named — nobody twice,
   * nobody who can't play, never more than the fourteen — and the liberos
   * named for the match, fixed from here on.
   */
  private handInSquad(md: MatchdayState, canPlay: (p: number) => boolean): void {
    const store = this.world!.players;
    const sheet = new Set([...md.homeLineup, md.homeLibero, md.homeDefensiveLibero]);
    const room = MATCHDAY_SQUAD - [...sheet].filter((p) => p >= 0).length;
    md.homeBench = [...new Set(md.homeBench)].filter((p) => canPlay(p) && !sheet.has(p)).slice(0, Math.max(0, room));
    md.homeLiberos = registeredLiberos(store, {
      libero: md.homeLibero, defensiveLibero: md.homeDefensiveLibero, bench: md.homeBench, outfield: md.homeOutfieldLiberos,
    });
  }

  /**
   * Before kickoff: a libero among the reserves is either the spare libero —
   * who plays libero and nothing else — or down to play in the six, an
   * outfield player who may never take a libero's place. This turns him from
   * the one into the other.
   */
  toggleReserveLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup' || !md.homeBench.includes(playerIdx)) return;
    const outfield = md.homeOutfieldLiberos ?? [];
    md.homeOutfieldLiberos = outfield.includes(playerIdx) ? outfield.filter((p) => p !== playerIdx) : [...outfield, playerIdx];
    this.emit();
  }

  /** The match under way, from the first serve. */
  private startLive(): void {
    const md = this.matchday;
    if (md === null || this.liveSim === null) return;
    // His own hurt players are his to answer for: the engine waits on him.
    this.liveSim.answerInjuriesFor(md.userIsHome ? 0 : 1, true);
    md.injuryQueue = [];
    md.injury = null;
    md.stage = 'live';
    md.log = [];
    md.timeoutsUsed = [0, 0];
    // Both cooldowns count rallies in md.log, which starts again from zero.
    this.lastTimeoutAtRally = -Infinity;
    this.lastAISubAtRally = -Infinity;
    md.snapshot = this.liveSim.snapshot();
    this.emit();
  }

  setSpeed(speed: 1 | 1.5 | 2): void {
    const md = this.matchday;
    if (md === null) return;
    md.speed = speed;
    this.emit();
  }

  /** Whether the touchline can be heard again yet — and in how many rallies, if not. */
  shoutWait(): number {
    const md = this.matchday;
    if (md === null || md.lastShout == null) return 0;
    return Math.max(0, SHOUT_COOLDOWN - (md.log.length - md.lastShout.rally));
  }

  /** A word from the touchline to the user's side. */
  shout(kind: ShoutKind): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.stage !== 'live' || this.shoutWait() > 0) return;
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    const effect = sim.shout(team, kind);
    md.lastShout = { kind, effect, seq: ++this.subSeq, rally: md.log.length };
    this.emit();
  }

  /** How the user watches the court: from the stand in 3D, or from above in 2D — remembered between matches. */
  courtView: '3d' | '2d' = readCourtView();

  setCourtView(view: '3d' | '2d'): void {
    this.courtView = view;
    try {
      window.localStorage.setItem(COURT_VIEW_KEY, view);
    } catch {
      // A private window: the choice lasts the session.
    }
    this.emit();
  }

  pause(): void {
    const md = this.matchday;
    if (md === null) return;
    // Paused during the video: it stays paused after the verdict too.
    if (md.videoReview != null) md.videoReview.resume = false;
    md.paused = true;
    md.pauseUntil = null; // a manual pause is indefinite, not a timed stoppage
    md.pausedForPanel = false; // his own pause: closing a panel doesn't undo it
    this.emit();
  }

  resume(): void {
    const md = this.matchday;
    // Not while the referee is at the screen: the video runs to its verdict first.
    if (md === null || md.videoReview != null) return;
    md.paused = false;
    md.pauseUntil = null;
    md.videoCheck = false;
    md.pausedForPanel = false;
    this.emit();
  }

  /**
   * Play exactly one rally and reveal it. The live view calls this itself,
   * pacing repeated calls to animate the ball through each rally's contacts
   * — state.ts has no timer of its own; pacing is a presentation concern.
   * Returns the revealed rally, or null if the match was already over.
   */
  playNextRally(): MatchdayLogEntry | null {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.stage !== 'live' || md.setBreakPending) return null;

    const preSnap = sim.snapshot();
    const entry = sim.step();
    if (entry === null) return null;
    const userTeam: 0 | 1 = md.userIsHome ? 0 : 1;
    for (const inj of sim.takeInjuries()) {
      (md.injuryQueue ??= []).push({ seq: ++this.subSeq, inj, ours: inj.team === userTeam, phase: 'down' });
    }

    const logEntry: MatchdayLogEntry = {
      entry, homeCourt: preSnap.homeCourt, awayCourt: preSnap.awayCourt,
      homeLibero: preSnap.homeLibero, awayLibero: preSnap.awayLibero,
      setsBefore: [preSnap.homeSets, preSnap.awaySets],
    };
    md.log.push(logEntry);
    md.snapshot = sim.snapshot();
    this.warmUpBench();
    // The final point is left for the viewer to play out; it calls
    // completeMatchday() once it has been shown.
    if (!md.snapshot.matchOver) {
      if (md.snapshot.set !== preSnap.set) {
        // Fresh timeout allowance each set, same as the engine's own
        // substitution limit — and the viewer opens the set break once this
        // set's last point has been shown.
        md.timeoutsUsed = [0, 0];
        md.setBreakPending = true;
        this.aiPicksNextSet();
      } else {
        this.maybeAIAct();
      }
    }
    this.emit();
    return logEntry;
  }

  // ---- Help ------------------------------------------------------------------------------

  openHelp(): void {
    this.helpOpen = true;
    this.emit();
  }

  closeHelp(): void {
    this.helpOpen = false;
    this.emit();
  }

  startWelcome(): void {
    this.welcomeOpen = true;
    this.emit();
  }

  closeWelcome(): void {
    this.welcomeOpen = false;
    try {
      window.localStorage.setItem(WELCOME_KEY, 'seen');
    } catch {
      // Without storage it shows again next time.
    }
    this.emit();
  }

  // ---- The tutorial -----------------------------------------------------------------------

  /** Where the tutorial's step began: which step, what it compares against, the day. */
  tutorialStart: { step: number; snap: string; day: number } = { step: -1, snap: '', day: 0 };

  /** Start the tutorial from the beginning — kept with the career, so it goes on after a reload. */
  startTutorial(): void {
    const world = this.world;
    if (world === null) return;
    world.tutorial = 0;
    this.tutorialStart = { step: -1, snap: '', day: world.day };
    this.helpOpen = false;
    this.emit();
  }

  /** Move the tutorial to a step. */
  tutorialGoTo(step: number): void {
    const world = this.world;
    if (world === null || world.tutorial === undefined) return;
    world.tutorial = Math.max(0, step);
    this.emit();
  }

  /** Note what a step began from — without a redraw: the step waits on the player. */
  markTutorialStart(step: number, snap: string): void {
    this.tutorialStart = { step, snap, day: this.world?.day ?? 0 };
  }

  /** The tutorial is over — finished or left. */
  endTutorial(): void {
    if (this.world !== null) this.world.tutorial = undefined;
    this.closeWelcome();
  }

  // ---- Team talks --------------------------------------------------------------------

  /** The moment for a team talk now — before the match or at a set break — or null if there isn't one. */
  talkMoment(): TalkMoment | null {
    const md = this.matchday;
    if (md === null) return null;
    if (md.stage === 'lineup') return md.talks?.prematch === undefined ? 'prematch' : null;
    if (md.stage === 'setBreak') return md.talks?.sets[md.snapshot?.set ?? -1] === undefined ? 'setbreak' : null;
    return null;
  }

  /** The talk already given at this moment, if any — to show how it went. */
  givenTalk(): GivenTalk | null {
    const md = this.matchday;
    if (md === null) return null;
    if (md.stage === 'lineup') return md.talks?.prematch ?? null;
    if (md.stage === 'setBreak') return md.talks?.sets[md.snapshot?.set ?? -1] ?? null;
    return null;
  }

  /** Give the team talk: how each player takes it, and what it is worth on court. */
  giveTeamTalk(tone: TalkTone): void {
    const world = this.world;
    const md = this.matchday;
    const moment = this.talkMoment();
    if (world === null || md === null || moment === null) return;
    const userTeam: 0 | 1 = md.userIsHome ? 0 : 1;
    const side = md.sides[userTeam];
    const club = side.clubId >= 0 ? world.clubs[side.clubId] : undefined;
    const store = world.players;
    const players = moment === 'prematch'
      ? [...md.homeLineup, md.homeLibero, md.homeDefensiveLibero, ...md.homeBench].filter((p) => p >= 0)
      : [...(this.liveSim?.squadFor(userTeam) ?? [])];
    const avg = (ps: readonly number[]): number => ps.length === 0 ? 0 : ps.reduce((s, p) => s + store.currentAbility[p], 0) / ps.length;
    const best6 = (ps: readonly number[]): number[] => [...ps].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 6);
    const own = avg(md.homeLineup.filter((p) => p >= 0));
    const theirs = avg(best6(md.sides[1 - userTeam].players));
    const snap = md.snapshot;
    const setsFor = snap === null ? 0 : userTeam === 0 ? snap.homeSets : snap.awaySets;
    const setsAgainst = snap === null ? 0 : userTeam === 0 ? snap.awaySets : snap.homeSets;
    const lastScores = md.stage === 'setBreak' ? this.liveSim?.setScoresSoFar().at(-1) : undefined;
    const lastSet = lastScores === undefined ? undefined : {
      won: lastScores[userTeam] > lastScores[1 - userTeam], margin: Math.abs(lastScores[0] - lastScores[1]),
    };
    const previous = md.stage === 'setBreak'
      ? md.talks?.sets[(snap?.set ?? 0) - 1] ?? (snap?.set === 1 ? md.talks?.prematch : undefined)
      : undefined;
    const fallback = world.clubs[world.userClubId];
    const result = giveTalk(world, club ?? fallback!, players, tone, {
      moment, favourite: favouriteness(own, theirs), setsFor, setsAgainst, lastSet, importance: md.fixture.importance,
    }, previous?.tone === tone, (snap?.set ?? 0) + (md.log.length << 3));
    md.talks ??= { sets: {} };
    if (moment === 'prematch') {
      md.talks.prematch = { tone, result };
      applyTalkMorale(world, result);
    } else {
      md.talks.sets[snap?.set ?? 0] = { tone, result };
      this.liveSim?.teamTalk(userTeam, result.multiplier, 'set');
    }
    this.emit();
  }

  // ---- The video check ------------------------------------------------------------------

  /** The point just played, if it could be challenged. */
  lastCall(): LastCall | null {
    return this.liveSim?.lastCall() ?? null;
  }

  /** Why the user can't challenge the last point, or null if he can. */
  challengeError(): string | null {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return 'No match.';
    if (md.videoReview != null) return 'The video is being looked at.';
    return sim.challengeError(md.userIsHome ? 0 : 1);
  }

  /** Challenges the user's side has left this set. */
  challengesLeft(): number {
    const md = this.matchday;
    return md === null || this.liveSim === null ? 0 : this.liveSim.challengesLeft(md.userIsHome ? 0 : 1);
  }

  /**
   * The point just shown went against the other side on a close call: their
   * bench may ask for the video. Called by the live view once the point has
   * been played out on the court — never before anyone has seen it.
   */
  aiConsidersChallenge(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.timeoutActive !== null || md.videoReview != null) return;
    const aiTeam: 0 | 1 = md.userIsHome ? 1 : 0;
    const call = sim.lastCall();
    if (call !== null && call.close && call.doubt !== null && call.winner !== aiTeam && sim.challengeError(aiTeam) === null
      && Math.random() < 0.45) {
      // Their bench asks about what looked close, as a rule — now and then about something else.
      const others = challengeChecksFor(call.call, call.blockout).filter((c) => c !== call.doubt);
      const check = others.length === 0 || Math.random() < 0.85 ? call.doubt : others[Math.floor(Math.random() * others.length)];
      this.requestVideo(aiTeam, check);
    }
  }

  /** Ask for the video on the last point, about one thing: the line, a touch off the block, the net. */
  challenge(check: ChallengeCheck): void {
    const md = this.matchday;
    if (md === null) return;
    this.requestVideo(md.userIsHome ? 0 : 1, check);
  }

  /**
   * A side asks for the video: play stops, and the point is shown again on
   * the court — the live view plays it, then calls {@link finishVideoReview}.
   * Nothing is decided until the video has been seen.
   */
  private requestVideo(team: 0 | 1, check: ChallengeCheck): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.videoReview != null) return;
    const call = sim.lastCall();
    const why = sim.challengeError(team);
    const log = md.log[md.log.length - 1];
    if (why !== null || call === null || log === undefined) {
      this.notice = why ?? 'There is nothing to challenge.';
      this.emit();
      return;
    }
    md.videoReview = { seq: ++this.subSeq, team, log, call: call.call, check, verdict: null, resume: !md.paused || md.pausedForPanel === true };
    md.paused = true;
    md.pauseUntil = null;
    md.videoCheck = true;
    this.emit();
  }

  /** The video has been seen: the referee gives his verdict. */
  finishVideoReview(): void {
    const md = this.matchday;
    const review = md?.videoReview;
    if (md == null || review == null || review.verdict !== null) return;
    const result = this.resolveChallenge(review.team, review.check);
    review.verdict = result?.ok === true
      ? { overturned: result.overturned === true, text: result.verdict ?? '', mark: result.mark }
      : { overturned: false, text: result?.reason ?? 'The call stands.' };
    this.emit();
  }

  /** The verdict has been given: play goes on — unless the coach has it stopped. */
  closeVideoReview(): void {
    const md = this.matchday;
    const review = md?.videoReview;
    if (md == null || review == null) return;
    if (review.verdict === null) this.finishVideoReview();
    md.videoReview = null;
    if (review.resume && md.coachPanel === true) {
      // A panel opened during the video holds play until it is closed.
      md.pausedForPanel = true;
      md.pauseUntil = null;
    } else if (review.resume) {
      md.pauseUntil = Date.now() + 400;
    } else {
      md.videoCheck = false;
    }
    this.emit();
  }

  /** A side's challenge: the call looked at, and the match put right if it was wrong. */
  private resolveChallenge(team: 0 | 1, check: ChallengeCheck): ChallengeResult | null {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return null;
    const before = md.snapshot;
    const result = sim.challenge(team, check);
    if (!result.ok) {
      this.notice = result.reason ?? 'No challenge.';
      this.emit();
      return result;
    }
    md.lastChallenge = { seq: ++this.subSeq, team, overturned: result.overturned === true, verdict: result.verdict ?? '' };
    // The referee goes to the screen: a moment's stoppage.
    if (!md.paused) {
      md.paused = true;
      md.pauseUntil = Date.now() + 2500;
      md.videoCheck = true;
    }
    md.snapshot = sim.snapshot();
    if (result.overturned === true && !md.snapshot.matchOver && before !== null && md.snapshot.set !== before.set) {
      // The point given back ended the set.
      md.timeoutsUsed = [0, 0];
      md.setBreakPending = true;
      this.aiPicksNextSet();
    }
    this.emit();
    return result;
  }

  // ---- The dressing room ------------------------------------------------------------------

  /** The club's dressing room as it stands. */
  dressingRoom(): DressingRoom | null {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? null : dressingRoom(world, club);
  }

  /** Give one of the squad the armband. */
  makeCaptain(p: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    setCaptain(club, p);
    this.notice = `${world.players.fullName(p)} is the new captain.`;
    this.emit();
  }

  /** How one of the manager's injured players is being treated, if he was asked. */
  injuryCase(p: number): InjuryCase | null {
    return this.world?.injuryCases?.[p] ?? null;
  }

  /** The manager's call on an injured player's treatment. */
  chooseTreatment(p: number, treatment: Treatment): void {
    if (this.world === null) return;
    this.notice = chooseTreatment(this.world, p, treatment).text;
    this.emit();
  }

  /** Whether a player rushed back from an injury may still break down. */
  atRisk(p: number): boolean {
    return this.world !== null && atRisk(this.world, p);
  }

  /** The open profile's player, side by side with this one. */
  compareWith(p: number | null): void {
    this.compareTo = p;
    this.emit();
  }

  /** A young player's mentor, and who a veteran mentors. */
  mentorOf(p: number): number | null {
    return this.world === null ? null : mentorOf(this.world, p);
  }

  menteesOf(p: number): number[] {
    return this.world === null ? [] : menteesOf(this.world, p);
  }

  /** The veterans who could take a young player under their wing. */
  mentorCandidates(mentee: number): number[] {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return [];
    return club.players.filter((p) => mentorBlock(world, p, mentee) === null);
  }

  setMentor(mentee: number, mentor: number | null): void {
    if (this.world === null) return;
    this.notice = setMentor(this.world, mentee, mentor);
    this.emit();
  }

  makeViceCaptain(p: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    setViceCaptain(club, p);
    this.notice = `${world.players.fullName(p)} is the vice-captain: the armband is his if the captain goes.`;
    this.emit();
  }

  // ---- One-to-one talks -------------------------------------------------------------------

  /** Why the manager can't have this talk with a player now, or null if he can. */
  chatBlock(p: number, topic: ChatTopic): string | null {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? 'No club.' : chatBlock(world, club, p, topic);
  }

  /** Call one of the squad in for a word: the conversation opens with him answering the door. */
  openPlayerTalk(p: number): void {
    const world = this.world;
    if (world === null || this.club === null || !this.club.players.includes(p)) return;
    this.playerTalk = { p, lines: [{ who: 'him', text: chatOpening(world, p) }], asked: [] };
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.emit();
  }

  /** Say it: he answers there and then, and it shows in his morale. */
  sayToPlayer(topic: ChatTopic): void {
    const world = this.world;
    const club = this.club;
    const t = this.playerTalk;
    if (world === null || club === null || t === null) return;
    const result = talkToPlayer(world, club, t.p, topic);
    if (!result.ok) {
      this.notice = result.text;
      this.emit();
      return;
    }
    t.lines.push({ who: 'you', text: CHAT_LINES[topic] });
    t.lines.push({ who: 'him', text: result.reply });
    // How he took it, as the room would have seen it; his mood needs no telling twice.
    if (topic !== 'mood') t.lines.push({ who: 'note', text: result.text, morale: result.morale });
    t.asked.push(topic);
    this.emit();
  }

  closePlayerTalk(): void {
    this.playerTalk = null;
    this.emit();
  }

  /** Answer a player's request to leave. */
  answerTransferRequest(p: number, answer: 'list' | 'promise' | 'refuse'): void {
    const world = this.world;
    if (world === null) return;
    this.notice = answerTransferRequest(world, p, answer);
    this.emit();
  }

  // ---- Facilities, tickets, sponsors, affiliates ---------------------------------------------

  /** Why the manager can't ask for this upgrade now, or null if he can. */
  upgradeBlock(kind: FacilityKind): string | null {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? 'No club.' : upgradeBlock(world, club, kind);
  }

  /** Ask the board for a better facility. */
  /** The national coach's extras: a friendly, the provisional squad, a club match to watch. */
  arrangeFriendly(opp: number, day: number, home: boolean): boolean {
    if (this.world === null) return false;
    const r = arrangeFriendly(this.world, opp, day, home);
    this.notice = r.text;
    this.emit();
    return r.ok;
  }

  toggleFrame(p: number): void {
    if (this.world === null) return;
    this.notice = toggleFrame(this.world, p);
    this.emit();
  }

  toggleWatch(p: number): void {
    if (this.world === null) return;
    this.notice = toggleWatch(this.world, p);
    this.emit();
  }

  /** Enrol on a coaching course. */
  startCourse(id: string): void {
    if (this.world === null) return;
    this.notice = startCourse(this.world, id).text;
    this.emit();
  }

  /** Ask the board for a new stand. */
  requestExpansion(seats: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = requestExpansion(world, club, seats);
    this.emit();
  }

  /** Go to the owner for money for transfers. */
  /** The world changed by hand in the editor: marked, and shown again. */
  markEdited(): void {
    if (this.world !== null) this.world.edited = true;
    this.emit();
  }

  openSettings(): void {
    this.settingsOpen = true;
    this.emit();
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.emit();
  }

  /** Change the player's settings: kept in this browser, and put on the page at once. */
  setPreferences(p: Preferences): void {
    this.prefs = p;
    savePreferences(p);
    applyPreferences(p);
    this.emit();
  }

  /** Book the pre-season training camp. */
  bookCamp(kind: CampKind, start: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = bookCamp(world, club, kind, start);
    this.emit();
  }

  /** Put a case to the board: more money for wages, or a target the squad can reach. */
  boardRequest(kind: 'wages' | 'target'): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = kind === 'wages' ? requestWages(world, club) : requestLowerTarget(world, club);
    this.emit();
  }

  askOwner(amount: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = askOwner(world, club, amount);
    this.emit();
  }

  requestUpgrade(kind: FacilityKind): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = requestUpgrade(world, club, kind);
    this.emit();
  }

  setTicketPrice(price: number): void {
    const club = this.club;
    if (club === null) return;
    setTicketPrice(club, price);
    this.emit();
  }

  /** Sign one of this summer's sponsorship offers. */
  chooseSponsor(index: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = chooseSponsor(world, club, index);
    this.emit();
  }

  proposeAffiliation(clubId: number): void {
    const world = this.world;
    const club = this.club;
    const target = world?.clubs[clubId];
    if (world === null || club === null || target === undefined) return;
    this.notice = proposeAffiliation(world, club, target);
    this.emit();
  }

  endAffiliation(clubId: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    endAffiliation(club, clubId);
    this.notice = `${world.clubs[clubId]?.name ?? 'They'} are no longer an affiliate.`;
    this.emit();
  }

  /** Send one of the squad to an affiliate on loan. */
  loanToAffiliate(p: number, affiliateId: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    this.notice = loanToAffiliate(world, club, p, affiliateId);
    this.emit();
  }

  // ---- The coach's panels ---------------------------------------------------------

  /** The coach opens a panel — the substitutions, or a player's options: play stops after the rally under way, and stays stopped. */
  openCoachPanel(): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'live') return;
    md.coachPanel = true;
    if (!md.paused && md.timeoutActive === null && md.injury == null) {
      md.paused = true;
      md.pauseUntil = null;
      md.pausedForPanel = true;
    }
    this.emit();
  }

  /**
   * The panel is closed: play starts again if it was the panel that stopped
   * it — once the stoppage for any change made from it is over (the view's
   * loop sees to that).
   */
  closeCoachPanel(): void {
    const md = this.matchday;
    if (md === null) return;
    const restart = md.pausedForPanel === true;
    md.coachPanel = false;
    md.pausedForPanel = false;
    // The video is still running: play restarts once it is over.
    if (restart && md.videoReview != null) md.videoReview.resume = true;
    else if (restart && md.paused && md.pauseUntil === null && md.timeoutActive === null && md.injury == null) {
      md.paused = false;
    }
    this.emit();
  }

  /**
   * Who could come on for one of the user's players on court, those who can
   * first, like for like first — and why any of the rest can't: for a
   * libero, the other liberos named for the match.
   */
  subOptionsFor(out: number): Array<{ p: number; why: string | null }> {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return [];
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    const snap = md.snapshot;
    const onCourt = new Set([...(team === 0 ? snap?.homeCourt : snap?.awayCourt) ?? []]);
    const liberos = sim.liberos(team);
    const named = new Set(sim.registeredLiberosOf(team));
    const isLibero = out === liberos.reception || out === liberos.defence;
    const store = this.world!.players;
    const role = sim.roles[out];
    const options = sim.squadFor(team)
      .filter((p) => p !== out && !onCourt.has(p) && p !== liberos.reception && p !== liberos.defence &&
        this.matchAvailable(p) && !sim.isOutHurt(team, p) && named.has(p) === isLibero)
      .map((p) => ({ p, why: isLibero ? null : sim.substitutionCheck(team, out, p) }));
    return options.sort((a, b) => Number(a.why !== null) - Number(b.why !== null) ||
      Number(sim.roles[b.p] === role) - Number(sim.roles[a.p] === role) ||
      store.currentAbility[b.p] - store.currentAbility[a.p]);
  }

  // ---- Someone hurt ------------------------------------------------------------------

  /** The next stoppage for someone hurt — the rally it came in has been shown — and play halts for it. */
  beginInjuryStoppage(): LiveInjury | null {
    const md = this.matchday;
    if (md === null || (md.injuryQueue?.length ?? 0) === 0) return null;
    const live = md.injuryQueue!.shift()!;
    live.phase = 'down';
    md.injury = live;
    md.paused = true;
    md.pauseUntil = null;
    this.emit();
    return live;
  }

  /** Where the stoppage has got to. */
  setInjuryPhase(phase: InjuryPhase): void {
    const md = this.matchday;
    if (md?.injury == null) return;
    md.injury.phase = phase;
    this.emit();
  }

  /** Whether the call is the user's to make: his own player, not yet off — one who must come off, or a knock not yet answered. */
  injuryNeedsCall(live: LiveInjury): boolean {
    const sim = this.liveSim;
    if (sim === null || !live.ours || live.inj.off === true) return false;
    if (live.inj.severity === 'serious') return sim.injuryWaiting(live.inj.team)?.p === live.inj.p;
    return sim.knocks(live.inj.team).some((k) => k.p === live.inj.p) && !this.knocksAnswered.has(live.inj);
  }

  /** Knocks the user has let a player carry on with. */
  private knocksAnswered = new Set<MatchInjury>();

  /** Who may come on for the user's hurt player, the assistant's choice first, and whether each would be the exceptional substitution. */
  injuryOptions(): Array<{ p: number; exceptional: boolean; pick: boolean }> {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md?.injury == null || sim === null) return [];
    const team = md.injury.inj.team;
    const best = sim.injuryReplacement(team, md.injury.inj.p);
    return sim.injuryOptions(team, md.injury.inj.p)
      .map((o) => ({ ...o, pick: o.p === best }))
      .sort((a, b) => Number(b.pick) - Number(a.pick));
  }

  /** Take the user's hurt player off for `inc` — -1 for a libero the side goes on without. */
  injuryTakeOff(inc: number): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md?.injury == null || sim === null) return;
    const live = md.injury;
    const result = sim.injurySubstitute(live.inj.team, live.inj.p, inc);
    if (!result.ok) {
      this.notice = result.reason ?? 'That change is not allowed.';
      this.emit();
      return;
    }
    md.snapshot = sim.snapshot();
    live.phase = 'off';
    this.emit();
  }

  /** The user lets his player carry on with a knock — below himself, and at a risk. */
  injuryPlayOn(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md?.injury == null || sim === null || md.injury.inj.severity !== 'knock') return;
    sim.playOnWithKnock(md.injury.inj.team, md.injury.inj.p);
    this.knocksAnswered.add(md.injury.inj);
    md.injury.phase = 'up';
    this.emit();
  }

  /** Nobody left to bring on for a man who should come off: he carries on as best he can. */
  injuryCarryOn(): void {
    const md = this.matchday;
    if (md?.injury == null) return;
    md.injury.phase = 'up';
    this.emit();
  }

  /** The stoppage is over: play on. */
  endInjuryStoppage(): void {
    const md = this.matchday;
    if (md === null) return;
    md.injury = null;
    md.paused = false;
    md.pauseUntil = null;
    if (this.liveSim !== null) md.snapshot = this.liveSim.snapshot();
    this.emit();
  }

  /** The user's players carrying on with a knock in the live match. */
  liveKnocks(): Set<number> {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return new Set();
    return new Set([...sim.knocks(0), ...sim.knocks(1)].map((k) => k.p));
  }

  /**
   * Open the break between sets, once the set's last point has been shown:
   * the team sheet comes back, filled in with the six who started the set
   * just finished and the liberos playing now, for the user to keep or change.
   */
  openSetBreak(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || !md.setBreakPending) return;
    this.resetSetBreakSheet();
    md.stage = 'setBreak';
    md.setBreakPending = false;
    md.timeoutActive = null;
    md.paused = false;
    md.pauseUntil = null;
    // So the live view, when it comes back, doesn't re-announce an old change.
    md.lastSubstitution = null;
    this.emit();
  }

  /**
   * The AI side hands in its line-up sheet for the coming set: the same six
   * again, unless a starter is tiring or having a bad night and a reserve in
   * the same position would do better. What it changed is kept for the set
   * break to show.
   */
  private aiPicksNextSet(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return;
    const aiTeam: 0 | 1 = md.userIsHome ? 1 : 0;
    md.opponentChanges = [];
    const plan = sim.suggestStartingLineup(aiTeam);
    if (plan === null) return;
    const liberos = sim.liberos(aiTeam);
    if (sim.setStartingLineup(aiTeam, plan.lineup, liberos.reception, liberos.defence).ok) {
      md.opponentChanges = plan.changes;
      md.snapshot = sim.snapshot();
    }
  }

  /** The user's line-up sheet as the last set started it: its six and the liberos playing now. */
  lastSetSheet(): { lineup: number[]; libero: number; defensiveLibero: number } | null {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return null;
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    const liberos = sim.liberos(team);
    return { lineup: sim.startingLineup(team), libero: liberos.reception, defensiveLibero: liberos.defence };
  }

  /** Put the set-break team sheet back to the last set's — "the same team again". */
  resetSetBreakSheet(): void {
    const md = this.matchday;
    const sheet = this.lastSetSheet();
    if (md === null || sheet === null) return;
    md.homeLineup = sheet.lineup;
    md.homeLibero = sheet.libero;
    md.homeDefensiveLibero = sheet.defensiveLibero;
    this.emit();
  }

  /** Hand in the team sheet from the set break and play on. */
  startNextSet(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.stage !== 'setBreak') return;
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    const result = sim.setStartingLineup(team, md.homeLineup, md.homeLibero, md.homeDefensiveLibero);
    if (!result.ok) {
      this.notice = result.reason ?? 'That line-up is not allowed.';
      this.emit();
      return;
    }
    md.snapshot = sim.snapshot();
    md.stage = 'live';
    this.emit();
  }

  /** Close a match whose last point has been played and shown — commits the
   *  result and moves on to the report. A no-op until the match is over. */
  completeMatchday(): void {
    const md = this.matchday;
    if (md === null || this.liveSim === null || md.snapshot?.matchOver !== true) return;
    this.finalizeMatchday();
  }

  /**
   * Skip straight to the result without watching the rest of the match. The
   * engine takes both benches from here — the user's changes as the
   * assistant would make them, the opponent's as its coach would.
   */
  finishMatchdayNow(): void {
    const md = this.matchday;
    if (md === null || this.liveSim === null) return;
    this.liveSim.setAutoCoach(0, true);
    this.liveSim.setAutoCoach(1, true);
    this.liveSim.finish();
    this.finalizeMatchday();
  }

  /**
   * The shared core of every substitution, either side: applies it to the
   * live sim, then triggers the ~3-second real-stoppage pause and the "X off,
   * Y on" banner. Both the user's own substitute() and the AI's use this.
   */
  private performSubstitution(
    team: 0 | 1,
    outPlayerIdx: number,
    inPlayerIdx: number,
    why?: SubstitutionReason,
    /** The position he comes on to play, when it isn't the replaced player's — a change of system. */
    role?: Position,
  ): { ok: boolean; reason?: string } {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return { ok: false };
    // Playing on with a knock: off now, he is off hurt — out of the match.
    const knocked = sim.knocks(team).some((k) => k.p === outPlayerIdx);
    const result = knocked ? sim.injurySubstitute(team, outPlayerIdx, inPlayerIdx) : sim.substitute(team, outPlayerIdx, inPlayerIdx, role);
    if (result.ok) {
      md.snapshot = sim.snapshot();
      md.paused = true;
      md.pauseUntil = Date.now() + 3000;
      md.lastSubstitution = { team, outPlayerIdx, inPlayerIdx, seq: ++this.subSeq, reason: why };
    }
    return result;
  }

  /** Bring on a bench player for the user's own side, mid-match — one who
   *  hasn't warmed up risks a strain. */
  substitute(outPlayerIdx: number, inPlayerIdx: number): void {
    const md = this.matchday;
    // Once a set is won, changes wait for the set break's team sheet.
    if (md === null || md.stage !== 'live' || md.setBreakPending) return;
    const teamIdx = md.userIsHome ? 0 : 1;
    const warmth = this.warmthOf(inPlayerIdx);
    if (this.matchday !== null) this.matchday.videoCheck = false;
    const result = this.performSubstitution(teamIdx, outPlayerIdx, inPlayerIdx);
    if (!result.ok) this.notice = result.reason ?? 'That substitution is not allowed.';
    else if (warmth < WARM_READY && Math.random() < ((WARM_READY - warmth) / WARM_READY) * COLD_STRAIN) {
      this.coldStrain(teamIdx, inPlayerIdx);
    }
    this.emit();
  }

  /** On cold, and it went: a strain — he plays on hampered, and misses the days after. */
  private coldStrain(team: 0 | 1, p: number): void {
    const world = this.world;
    const sim = this.liveSim;
    if (world === null || sim === null) return;
    const store = world.players;
    const days = 5 + Math.floor(Math.random() * 12);
    store.injuryDaysLeft[p] = Math.max(store.injuryDaysLeft[p], days);
    store.injuryType[p] = InjuryType.MuscleStrain;
    sim.strain(team, p);
    injuryNotice(world, p, InjuryType.MuscleStrain, days);
    this.notice = `${store.shortName(p)} came on without warming up and has felt a muscle — he is struggling, ` +
      `and will be out for about ${Math.max(1, Math.round(days / 7))} week${days >= 11 ? 's' : ''} after the match.`;
  }

  /** How warm one of the user's players is, 0-1. */
  warmthOf(p: number): number {
    return this.matchday?.warmth?.get(p) ?? 1;
  }

  /** Whether one of the user's substitutes is warming up. */
  isWarming(p: number): boolean {
    return this.matchday?.warming?.has(p) ?? false;
  }

  /** Send a substitute to warm up — or bring him back to stand. */
  toggleWarmup(p: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'live') return;
    md.warming ??= new Set();
    if (md.warming.has(p)) md.warming.delete(p);
    else if (md.warming.size >= MAX_WARMING) this.notice = `Only ${MAX_WARMING} players can warm up at once.`;
    else md.warming.add(p);
    this.emit();
  }

  /** After every rally: those on court stay warm, those warming up get warmer, the rest of the bench cools. */
  private warmUpBench(): void {
    const md = this.matchday;
    const snap = md?.snapshot;
    if (md === null || snap === null || snap === undefined) return;
    md.warmth ??= new Map();
    md.warming ??= new Set();
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    const court = new Set([...(team === 0 ? snap.homeCourt : snap.awayCourt), team === 0 ? snap.homeLibero : snap.awayLibero]);
    for (const p of md.sides[team].players) {
      if (court.has(p)) {
        md.warmth.set(p, 1);
        md.warming.delete(p);
        continue;
      }
      const w = md.warmth.get(p) ?? 1;
      md.warmth.set(p, md.warming.has(p) ? Math.min(1, w + WARM_PER_RALLY) : Math.max(0, w - COOL_PER_RALLY));
    }
  }

  /**
   * Who is off the court for each side, for the bench side of the live
   * court: the substitutes, in the warm-up area; a libero, or the middle he
   * has replaced, waiting by the bench; and who is warming up — the user's
   * as he sent them, the other side's best two.
   */
  liveSideline(): CourtSideline | null {
    const md = this.matchday;
    const sim = this.liveSim;
    const snap = md?.snapshot;
    if (md === null || sim === null || snap === null || snap === undefined) return null;
    const out: CourtSideline = { bench: [[], []], waiting: [[], []], warming: new Set(md.warming ?? []), hurt: [[], []] };
    const store = this.world!.players;
    for (const team of [0, 1] as const) {
      const court = team === 0 ? snap.homeCourt : snap.awayCourt;
      const libero = team === 0 ? snap.homeLibero : snap.awayLibero;
      const floor = new Set(court.map((_, z) => effectivePlayerAt(court, z, sim.roles, libero, snap.serving === team)));
      const liberos = sim.liberos(team);
      // Off hurt: by the bench, out of it.
      out.hurt![team] = sim.squadFor(team).filter((p) => sim.isOutHurt(team, p));
      const hurt = new Set(out.hurt![team]);
      for (const p of [...court, liberos.reception, liberos.defence]) {
        if (p >= 0 && !floor.has(p) && !hurt.has(p) && !out.waiting[team].includes(p)) out.waiting[team].push(p);
      }
      out.bench[team] = sim.benchFor(team).filter((p) => !floor.has(p) && !hurt.has(p) && !out.waiting[team].includes(p));
    }
    const other: 0 | 1 = md.userIsHome ? 1 : 0;
    const warmers = [...out.bench[other]].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 2);
    for (const p of warmers) (out.warming as Set<number>).add(p);
    return out;
  }

  /**
   * Change one of the user's liberos mid-match. Libero changes are unlimited
   * and never use up a substitution, so play carries straight on — only the
   * announcement banner marks it.
   */
  changeLibero(role: 'reception' | 'defence', playerIdx: number): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.stage !== 'live') return;
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    const before = sim.liberos(team);
    const result = sim.setLibero(team, role, playerIdx);
    if (!result.ok) {
      this.notice = result.reason ?? 'That libero change is not allowed.';
      this.emit();
      return;
    }
    md.snapshot = sim.snapshot();
    if (playerIdx >= 0) {
      md.lastSubstitution = {
        team,
        outPlayerIdx: role === 'reception' ? before.reception : before.defence,
        inPlayerIdx: playerIdx,
        seq: ++this.subSeq,
        libero: role,
      };
    }
    this.emit();
  }

  /** The position one of the user's players is learning in training, if any. */
  positionTraining(p: number): Position | null {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? null : positionTarget(world, club, p);
  }

  /** Have a player learn another position in training — null to stop. */
  setPositionTraining(p: number, pos: Position | null): void {
    const club = this.club;
    if (club === null) return;
    setPositionTarget(club, p, pos);
    this.emit();
  }

  /** The position each player is playing in the live match — his own, if there is no match on. */
  liveRoles(): Uint8Array {
    return this.liveSim?.roles ?? this.world?.players.position ?? new Uint8Array();
  }

  /** The user's two libero roles in the live match; `defence` is -1 with one libero. */
  liveLiberos(): { reception: number; defence: number } {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return { reception: -1, defence: -1 };
    return sim.liberos(md.userIsHome ? 0 : 1);
  }

  /** Every player's match rating so far, both sides — recomputed after each rally. */
  liveRatings(): Map<number, number> {
    const out = new Map<number, number>();
    const sim = this.liveSim;
    const world = this.world;
    if (sim === null || world === null) return out;
    const live = sim.liveStats();
    const sides = [
      [live.home, live.homeSets, live.awaySets],
      [live.away, live.awaySets, live.homeSets],
    ] as const;
    for (const [team, setsFor, setsAgainst] of sides) {
      for (const [p, st] of team.players) {
        if (!playedInMatch(st)) continue;
        out.set(p, matchRating(st, world.players.position[p] as Position, setsFor, setsAgainst));
      }
    }
    return out;
  }

  /** Substitutions left this set for the user's own side — the engine resets this every set. */
  subsRemaining(): number {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return SUBS_PER_SET;
    return sim.subsRemaining(md.userIsHome ? 0 : 1);
  }

  /** The shared core of calling a timeout, either side. */
  private startTimeout(team: 0 | 1): void {
    const md = this.matchday;
    if (md === null) return;
    md.timeoutsUsed[team]++;
    md.timeoutActive = team;
    md.paused = true;
    md.pauseUntil = null;
    this.lastTimeoutAtRally = md.log.length;
    this.emit();
  }

  /**
   * Call one of the user's two 30-second timeouts this set. Pauses play and
   * opens the timeout window — resumeFromTimeout() ends it.
   */
  callTimeout(): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'live' || md.setBreakPending || md.timeoutActive !== null) return;
    const teamIdx = md.userIsHome ? 0 : 1;
    if (md.timeoutsUsed[teamIdx] >= 2) return;
    this.startTimeout(teamIdx);
  }

  resumeFromTimeout(): void {
    const md = this.matchday;
    if (md === null) return;
    md.timeoutActive = null;
    // With a coach's panel still open, play waits for it to be closed.
    if (md.coachPanel === true) md.pausedForPanel = true;
    else md.paused = false;
    this.emit();
  }

  /**
   * The AI side's bench decisions: call a timeout after conceding an
   * unanswered run, and make a substitution whenever the engine's coaching
   * judgement says one is needed — a starter running on empty or having a
   * bad night, with a same-position reserve who would do better right now.
   * A new change waits a few rallies for the last to settle, and a warranted
   * one isn't always made on the very next whistle. Deliberately uses
   * Math.random(), not the world's seeded rng — this is real-time UI
   * flavour, not part of the deterministic world simulation.
   */
  private maybeAIAct(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null || md.timeoutActive !== null) return;

    const aiTeam: 0 | 1 = md.userIsHome ? 1 : 0;

    const recent = md.log.slice(-3);
    const concededRun = recent.length === 3 && recent.every((l) => l.entry.winner !== aiTeam);
    if (
      concededRun && md.timeoutsUsed[aiTeam] < 2 &&
      md.log.length - this.lastTimeoutAtRally >= 6 && Math.random() < 0.4
    ) {
      this.startTimeout(aiTeam);
      return;
    }

    if (md.log.length - this.lastAISubAtRally < AI_SUB_COOLDOWN_RALLIES) return;
    const plan = sim.suggestSubstitution(aiTeam);
    if (plan === null || Math.random() >= AI_SUB_CHANCE) return;
    const result = this.performSubstitution(aiTeam, plan.outPlayerIdx, plan.inPlayerIdx, plan.reason);
    if (result.ok) this.lastAISubAtRally = md.log.length;
  }

  private finalizeMatchday(): void {
    const world = this.world;
    const md = this.matchday;
    const sim = this.liveSim;
    if (world === null || md === null || sim === null) return;

    const result = sim.buildResult();
    if (md.national !== null) {
      this.finishNationalMatch(md.national, md.fixture, result);
      return;
    }
    applyMatchResult(world, this.ctx, md.fixture, result);
    this.ctx.detailedResults.set(md.fixture.id, result);
    this.watched = {
      fixture: md.fixture,
      result,
      homeName: world.clubs[md.fixture.home]?.name ?? '?',
      awayName: world.clubs[md.fixture.away]?.name ?? '?',
    };
    this.checkChampionshipWin(world, md.fixture);
    this.showPostMatch(md.fixture);
  }

  /**
   * Fires the trophy celebration the instant the user's club wins a
   * championship playoff final — rather than waiting for the end-of-season
   * rollover, which can be many days later and, for a title decided by a
   * playoff, is really just confirming what already happened here.
   */
  private checkChampionshipWin(world: World, fixture: Fixture): void {
    if (fixture.home !== world.userClubId && fixture.away !== world.userClubId) return;
    const comp = world.competitions[fixture.competitionId];
    // A cup final — national, continental or the world championship.
    if (comp !== undefined && isCupFinal(world, fixture)) {
      const winner = fixture.homeSets > fixture.awaySets ? fixture.home : fixture.away;
      if (winner === world.userClubId) this.trophyCelebration = { clubId: world.userClubId, competitionName: comp.name };
      return;
    }
    const champGroup = comp?.playoffGroups.find((g) => g.id === 'championship');
    if (champGroup === undefined) return;
    const finalRound = champGroup.rounds[champGroup.rounds.length - 1];
    if (finalRound === undefined || finalRound.length !== 1 || finalRound[0].fixtureId !== fixture.id) return;

    const winnerClubId = fixture.homeSets > fixture.awaySets ? fixture.home : fixture.away;
    if (winnerClubId === world.userClubId) {
      this.trophyCelebration = { clubId: world.userClubId, competitionName: comp.name };
    }
  }

  // ---- The national team --------------------------------------------------

  /** The manager's nation's match today and its tournament, if it is still to be played. */
  nationalMatchToday(): { t: Tournament; m: IntlMatch } | null {
    return this.world === null ? null : userMatchToday(this.world);
  }

  /** Whether a player can play in the match on the matchday screens: fit and
   *  at the club — or, for a national team, fit. */
  matchAvailable(p: number): boolean {
    const world = this.world;
    if (world === null) return false;
    return this.matchday?.national != null ? canPlayForCountry(world, p) : world.players.isAvailable(p);
  }

  /** The tactics the user's side plays in the match on screen — the very
   *  object the live engine reads, so a change at a timeout applies at once. */
  matchTactics(): TeamTactics | null {
    const md = this.matchday;
    if (md?.national != null) return this.nationalTactics();
    return this.club?.tactics ?? null;
  }

  /** The national team's tactics, made from the defaults the first time. */
  nationalTactics(): TeamTactics | null {
    return this.nationalSheet()?.tactics ?? null;
  }

  /** The national team's tactics and default team sheet, made the first time they are looked at. */
  private nationalSheet(): SheetOwner | null {
    const world = this.world;
    const nation = world === null ? -1 : userNation(world);
    const team = world?.nationalTeams.find((t) => t.nation === nation);
    if (team === undefined) return null;
    team.tactics ??= defaultTactics();
    team.preferredLineup ??= [];
    team.preferredLibero ??= -1;
    team.preferredDefensiveLibero ??= -1;
    return team as SheetOwner;
  }

  /** Whether the team screens are about the national team: chosen, with a club as well — or the only team there is. */
  nationalView(): boolean {
    const world = this.world;
    if (world === null || userNation(world) < 0) return false;
    return this.club === null || this.teamView === 'national';
  }

  /** Look at the club, or at the national team. A screen the other has no use for gives way to the squad. */
  setTeamView(view: TeamView): void {
    const world = this.world;
    if (world === null || (view === 'national' && userNation(world) < 0) || (view === 'club' && this.club === null)) return;
    this.teamView = view;
    if (view === 'national' && (this.screen === 'training' || this.screen === 'youth')) this.screen = 'squad';
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.emit();
  }

  /** The team sheet the team screens edit: the club's, or the national team's. */
  private sheet(): SheetOwner | null {
    return this.nationalView() ? this.nationalSheet() : this.club;
  }

  /** The instructions of the team being looked at. */
  activeTactics(): TeamTactics | null {
    return this.sheet()?.tactics ?? null;
  }

  /** Whether the team being looked at has a team sheet of the manager's own, rather than the auto-pick. */
  hasPreferredSheet(): boolean {
    const s = this.sheet();
    return s !== null && (s.preferredLineup.some((p) => p >= 0) || s.preferredLibero >= 0 ||
      s.preferredDefensiveLibero >= 0 || s.preferredBench !== undefined);
  }

  /**
   * The national team's players as things stand: the squad at the tournament
   * under way, the fourteen named for the next — or the assistant's, before then.
   */
  nationalPlayers(): number[] {
    const world = this.world;
    const nation = world === null ? -1 : userNation(world);
    if (world === null || nation < 0) return [];
    const t = nextTournamentFor(world, nation);
    if (t !== undefined && t.status !== 'planned') {
      const squad = squadOf(t, nation);
      if (squad.length > 0) return squad;
    }
    const chosen = world.internationals?.chosen;
    if (t !== undefined && chosen?.tournamentId === t.id) return [...chosen.players];
    return suggestSquad(world, nation);
  }

  /** The result screen's match: the national team's, if that was the last one played. */
  resultShown(): WatchedMatch | null {
    if (this.postMatch !== null && this.postMatch < 0) return this.lastNational;
    return this.watched;
  }

  private nationalSide(t: Tournament, nation: number): MatchSide {
    return { clubId: -1, nation, name: nationName(nation), shortName: NATIONS[nation]?.code ?? '?', players: squadOf(t, nation) };
  }

  /** The national team's match as a fixture, for the matchday screens. */
  private nationalFixture(t: Tournament, m: IntlMatch): Fixture {
    return {
      id: -1 - m.id, competitionId: t.competitionId, day: m.day, home: m.home, away: m.away, round: m.round,
      format: MatchFormat.BestOf5, importance: matchImportance(m), neutralVenue: m.home !== t.host,
      played: false, homeSets: 0, awaySets: 0, setScores: [], mvp: -1,
    };
  }

  /** Open the team sheet for the national team's match today. */
  openNationalMatchday(): void {
    const world = this.world;
    const found = this.nationalMatchToday();
    if (world === null || found === null || this.processing || this.matchday !== null) return;
    if (this.openPendingDecision()) return;
    const { t, m } = found;
    const nation = userNation(world);
    const squad = squadOf(t, nation);
    // The national team's match: from now its squad, team sheet and instructions are the ones to see.
    this.teamView = 'national';
    this.selectedPlayer = null;
    // Its own team sheet, as the manager left it.
    const sheet = this.nationalSheet();
    const { lineup, libero, defensiveLibero, bench } = pickLineup(
      world.players,
      sheet !== null
        ? { ...sheet, players: squad }
        : { players: squad, preferredLineup: [], preferredLibero: -1, preferredDefensiveLibero: -1 },
      undefined,
      (p) => canPlayForCountry(world, p),
    );
    const fixture = this.nationalFixture(t, m);
    const title = `${t.name} · ${m.stage}`;
    this.matchday = {
      fixture,
      sides: [this.nationalSide(t, m.home), this.nationalSide(t, m.away)],
      title,
      national: { tournamentId: t.id, matchId: m.id, nation, title },
      stage: 'lineup',
      setBreakPending: false,
      opponentChanges: [],
      userIsHome: m.home === nation,
      homeLineup: lineup,
      homeLibero: libero,
      homeDefensiveLibero: defensiveLibero,
      homeBench: bench,
      speed: 1,
      paused: false,
      pauseUntil: null,
      log: [],
      snapshot: null,
      timeoutsUsed: [0, 0],
      timeoutActive: null,
      lastSubstitution: null,
      lastShout: null,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** The tournament and match a national matchday refers to. */
  private nationalMatch(ref: NationalMatchRef): { t: Tournament; m: IntlMatch } | null {
    const t = this.world?.internationals?.tournaments.find((x) => x.id === ref.tournamentId);
    const m = t?.matches.find((x) => x.id === ref.matchId);
    return t !== undefined && m !== undefined ? { t, m } : null;
  }

  private kickOffNational(): void {
    const world = this.world;
    const md = this.matchday;
    const found = md?.national != null ? this.nationalMatch(md.national) : null;
    const tactics = this.nationalTactics();
    if (world === null || md === null || md.national === null || found === null || tactics === null) return;
    const { t, m } = found;
    const nation = md.national.nation;
    this.handInSquad(md, (p) => canPlayForCountry(world, p));
    const userSetup: TeamSetup = {
      clubId: -1,
      name: nationName(nation),
      lineup: md.homeLineup,
      libero: md.homeLibero,
      defensiveLibero: md.homeDefensiveLibero,
      bench: md.homeBench,
      liberos: md.homeLiberos,
      tactics,
    };
    const opponent = nationSetup(world, t, md.userIsHome ? m.away : m.home);
    this.liveSim = new MatchSimulator(world.players, {
      home: md.userIsHome ? userSetup : opponent,
      away: md.userIsHome ? opponent : userSetup,
      format: MatchFormat.BestOf5,
      importance: matchImportance(m),
      neutralVenue: m.home !== t.host,
      collectLog: true,
      seed: world.rng.next(),
    });
    this.startLive();
  }

  /** A national team's match is over: into the tournament, and on to the result. */
  private finishNationalMatch(ref: NationalMatchRef, fixture: Fixture, result: MatchResult): void {
    const world = this.world;
    const found = this.nationalMatch(ref);
    if (world === null || found === null) return;
    const { t, m } = found;
    const stats = applyIntlResult(world, t, m, result);
    postMatchReport(world, t, [m], stats);
    fixture.played = true;
    fixture.homeSets = result.homeSets;
    fixture.awaySets = result.awaySets;
    fixture.setScores = result.setScores;
    fixture.mvp = result.mvp;
    this.lastNational = {
      fixture, result, homeName: nationName(m.home), awayName: nationName(m.away), national: ref,
    };
    // The press want the manager's reaction, as after a club's match.
    generateNationalPostMatchInterview(world, t, m);
    // A final won: the nation's title, celebrated as a club's is.
    const winner = m.homeSets > m.awaySets ? m.home : m.away;
    if (m.stage === 'Final' && t.kind !== 'friendly' && winner === ref.nation) {
      this.trophyCelebration = { clubId: -1, nation: ref.nation, competitionName: t.name };
    }
    this.showPostMatch(fixture);
  }

  /** The national team's match today, played without watching it. */
  private instantNationalResult(): void {
    const world = this.world;
    const found = this.nationalMatchToday();
    if (world === null || found === null) return;
    if (this.openPendingDecision()) return;
    const { t, m } = found;
    const nation = userNation(world);
    const result = simulateMatch(world.players, {
      home: nationSetup(world, t, m.home),
      away: nationSetup(world, t, m.away),
      format: MatchFormat.BestOf5,
      importance: matchImportance(m),
      neutralVenue: m.home !== t.host,
      collectLog: false,
      seed: world.rng.next(),
      autoCoach: [true, true],
    });
    const title = `${t.name} · ${m.stage}`;
    this.finishNationalMatch({ tournamentId: t.id, matchId: m.id, nation, title }, this.nationalFixture(t, m), result);
  }

  /** Name the national squad for the next tournament. */
  nameNationalSquad(players: readonly number[]): boolean {
    const world = this.world;
    if (world === null) return false;
    const problem = nameSquad(world, players);
    this.notice = problem ?? 'Squad named — the players will be told on call-up day.';
    this.emit();
    return problem === null;
  }

  /** The assistant's fourteen for the manager's nation. */
  suggestedNationalSquad(): number[] {
    const world = this.world;
    return world === null || userNation(world) < 0 ? [] : suggestSquad(world, userNation(world));
  }

  /** Apply for a national team's head coach's job. */
  applyForNationalJob(nation: number): void {
    const world = this.world;
    if (world === null) return;
    const problem = nationalApplicationBlock(world, nation);
    const answerOn = problem === null ? applyForNationalJob(world, nation) : null;
    this.notice = answerOn !== null
      ? `Application sent to the ${nationName(nation)} Volleyball Federation — expect an answer by ${this.dateLabelForDay(answerOn)}.`
      : problem ?? 'You cannot apply for that job.';
    this.emit();
  }

  /** Open the federation's message where the squad for the next tournament is named. False if there is none yet. */
  openSquadMessage(): boolean {
    const m = this.world === null ? undefined : askForSquad(this.world);
    if (m === undefined) return false;
    this.openMessage(m.id);
    return true;
  }

  /** Take a federation's offer of its national team job. */
  acceptNationalOffer(offerId: number): void {
    const world = this.world;
    if (world === null) return;
    const nation = world.internationals?.offers.find((o) => o.id === offerId)?.nation;
    this.notice = acceptNationalOffer(world, offerId) && nation !== undefined
      ? `You are the new head coach of ${nationName(nation)}.`
      : 'That offer has lapsed.';
    this.emit();
  }

  /** Turn a federation down. */
  declineNationalOffer(offerId: number): void {
    const world = this.world;
    if (world === null) return;
    declineNationalOffer(world, offerId);
    this.notice = 'Offer declined.';
    this.emit();
  }

  /** The system the team being looked at plays; its team sheet follows it (see pickLineup). */
  setFormation(formation: Formation): void {
    const sheet = this.sheet();
    if (sheet === null) return;
    sheet.tactics.formation = formation;
    this.emit();
  }

  /** The system the user's side plays in today's match — a club's or a nation's —
   *  with the six re-picked for it before kickoff, or for the next set at a set break. */
  setMatchdayFormation(formation: Formation): void {
    const tactics = this.matchTactics();
    const stage = this.matchday?.stage;
    if ((stage !== 'lineup' && stage !== 'setBreak') || tactics === null) return;
    tactics.formation = formation;
    this.repickMatchdaySix();
  }

  /**
   * Change the system mid-rally-flow, from the next rally — with the
   * substitution it takes, when it takes one: a second setter on for the
   * opposite to play a 4-2, an opposite on for one of the two setters to go
   * back to a 5-1.
   */
  changeLiveFormation(formation: Formation, change?: { out: number; in: number }): void {
    const md = this.matchday;
    const tactics = this.matchTactics();
    if (md === null || tactics === null || md.stage !== 'live' || md.setBreakPending) return;
    if (change !== undefined) {
      // Each plays his own position: the setter sets, the opposite hits.
      const own = this.world?.players.position[change.in] as Position | undefined;
      const result = this.performSubstitution(md.userIsHome ? 0 : 1, change.out, change.in, undefined, own);
      if (!result.ok) {
        this.notice = result.reason ?? 'That substitution is not allowed.';
        this.emit();
        return;
      }
    }
    tactics.formation = formation;
    this.notice = `Now playing a ${FORMATION_NAMES[formation]}.`;
    this.emit();
  }

  /** Pick the six again — before kickoff, or for the next set — for the system and team sheet now loaded. */
  private repickMatchdaySix(): void {
    const world = this.world;
    const md = this.matchday;
    const tactics = this.matchTactics();
    if (world === null || md === null || (md.stage !== 'lineup' && md.stage !== 'setBreak') || tactics === null) return;
    const mine = md.sides[md.userIsHome ? 0 : 1];
    const club = this.club;
    const pick = md.national !== null || club === null
      ? pickLineup(
        world.players,
        { players: mine.players, preferredLineup: [], preferredLibero: -1, preferredDefensiveLibero: -1, tactics },
        undefined,
        (p) => this.matchAvailable(p),
      )
      : pickLineup(world.players, club);
    md.homeLineup = pick.lineup;
    md.homeLibero = pick.libero;
    md.homeDefensiveLibero = pick.defensiveLibero;
    md.homeBench = pick.bench;
    this.emit();
  }

  // ---- Saved tactics ------------------------------------------------------

  /** The club's saved tactics, and which one is loaded. */
  savedTactics(): { slots: SavedTactic[]; active: number } | null {
    const club = this.club;
    if (club === null) return null;
    return { slots: tacticSlots(club), active: activeTactic(club) };
  }

  /** Load a saved tactic — before kickoff, the six is picked again for it. */
  loadTactic(index: number): void {
    const club = this.club;
    if (club === null || (this.matchday !== null && this.matchday.stage !== 'lineup')) return;
    if (!loadTacticSlot(club, index)) return;
    this.notice = `${tacticSlots(club)[index].name} loaded.`;
    if (this.matchday !== null && this.matchday.national === null) this.repickMatchdaySix();
    this.emit();
  }

  /**
   * Load a saved tactic during the match: its instructions apply from the
   * next rally. The engine holds on to the tactics it kicked off with, so they
   * go into that same object; the system stays as it is, since changing it
   * takes a substitution — the system the loaded tactic plays is returned for
   * the caller to offer it.
   */
  loadTacticInMatch(index: number): Formation | null {
    const club = this.club;
    const md = this.matchday;
    if (club === null || md === null || md.national !== null || (md.stage !== 'live' && md.stage !== 'setBreak')) return null;
    const live = club.tactics;
    const playing = formationOf(live);
    if (!loadTacticSlot(club, index)) return null;
    const loaded = club.tactics;
    Object.assign(live, loaded, { formation: playing });
    club.tactics = live;
    this.notice = `${tacticSlots(club)[index].name} loaded — its instructions apply from the next rally.`;
    this.emit();
    return formationOf(loaded);
  }

  /** A new tactic, from the defaults, and loaded — before kickoff, the six is picked again for it. */
  newTactic(): void {
    const club = this.club;
    if (club === null || (this.matchday !== null && this.matchday.stage !== 'lineup')) return;
    const i = newTacticSlot(club);
    this.notice = i === null
      ? `You can keep ${MAX_TACTICS} tactics — delete one to make room.`
      : `${tacticSlots(club)[i].name} created from the defaults — make it your own.`;
    if (i !== null && this.matchday !== null && this.matchday.national === null) this.repickMatchdaySix();
    this.emit();
  }

  renameTactic(index: number, name: string): void {
    const club = this.club;
    if (club === null) return;
    renameTacticSlot(club, index, name);
    this.emit();
  }

  deleteTactic(index: number): void {
    const club = this.club;
    if (club === null || this.matchday !== null) return;
    const name = tacticSlots(club)[index]?.name;
    if (deleteTacticSlot(club, index)) this.notice = `${name} deleted.`;
    this.emit();
  }

  /** Step down as national team coach. */
  resignNationalJob(): void {
    const world = this.world;
    if (world === null || this.matchday !== null || this.postMatch !== null || this.processing) return;
    const nation = userNation(world);
    if (nation < 0) return;
    leaveNationalJob(world, false);
    this.notice = `You have stepped down as head coach of ${nationName(nation)}.`;
    this.emit();
  }

  // ---- Squad ------------------------------------------------------------

  /** The default team sheet of the team being looked at — the club's, or the national team's. */
  lineup(): { lineup: number[]; libero: number; defensiveLibero: number; bench: number[]; out: number[] } | null {
    const world = this.world;
    if (world === null) return null;
    if (this.nationalView()) {
      const sheet = this.nationalSheet();
      const players = this.nationalPlayers();
      if (sheet === null || players.length === 0) return null;
      return pickLineup(world.players, { ...sheet, players }, undefined, (p) => canPlayForCountry(world, p));
    }
    return this.clubLineup();
  }

  /** The club's default team sheet, whichever team is being looked at. */
  clubLineup(): { lineup: number[]; libero: number; defensiveLibero: number; bench: number[]; out: number[] } | null {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return null;
    return pickLineup(world.players, club);
  }

  /** Senior squad, sorted by ability. */
  squad(): number[] {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return [];
    return [...club.players].sort(
      (a, b) => world.players.currentAbility[b] - world.players.currentAbility[a],
    );
  }

  /** Who would take one of the academy's players, and what they'd pay. */
  academyOffers(p: number): AcademyOffer[] {
    return this.world === null ? [] : academyOffers(this.world, p);
  }

  /** Sell an academy player to a club that offered for him. */
  sellAcademyPlayer(p: number, buyerId: number): void {
    const world = this.world;
    if (world === null) return;
    this.notice = sellAcademyPlayer(world, p, buyerId).text;
    this.emit();
  }

  /** The manager's academy side's league this season. */
  youthLeague(): YouthLeague | undefined {
    return this.world === null ? undefined : userYouthLeague(this.world);
  }

  youthSquad(): number[] {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return [];
    return [...club.youthPlayers].sort(
      (a, b) => world.players.potentialAbility[b] - world.players.potentialAbility[a],
    );
  }

  /** Free agents the club could realistically sign. */
  transferTargets(limit = 120): number[] {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return [];
    const store = world.players;
    const out: number[] = [];
    for (let i = 0; i < store.count && out.length < limit * 4; i++) {
      if (!store.isActive(i) || store.clubId[i] >= 0) continue;
      if (store.hasFlag(i, PlayerFlag.Youth)) continue;
      out.push(i);
    }
    return out
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
      .slice(0, limit);
  }

  /**
   * Players worth researching — anyone active outside the club, free agent or
   * not. A text query searches the whole player pool by name; with no query,
   * this is simply the best players in the world you don't already know.
   * `filters` narrows the pool by position, age, height, potential and price
   * so a scout can hunt for a specific profile rather than scrolling names.
   */
  scoutingPool(filters: ScoutFilters, limit = 150): number[] {
    const world = this.world;
    const club = this.club;
    if (world === null) return [];
    const store = world.players;
    const q = filters.query.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i)) continue;
      if (club !== null && store.clubId[i] === club.id) continue;
      if (store.hasFlag(i, PlayerFlag.Youth)) continue;
      if (club !== null && world.loans.some((l) => l.playerIdx === i && l.parentClubId === club.id)) continue;
      if (q !== '' && !store.fullName(i).toLowerCase().includes(q)) continue;
      if (filters.position !== null && store.position[i] !== filters.position) continue;
      if (filters.freeAgentOnly && store.clubId[i] !== NO_CLUB) continue;

      const age = store.ageOn(i, world.year, 181);
      if (filters.ageMin !== null && age < filters.ageMin) continue;
      if (filters.ageMax !== null && age > filters.ageMax) continue;

      const height = store.heightCm[i];
      if (filters.heightMin !== null && height < filters.heightMin) continue;
      if (filters.heightMax !== null && height > filters.heightMax) continue;

      if (filters.potentialMin > 0 && store.potentialAbility[i] < filters.potentialMin) continue;
      if (filters.valueMax !== null && store.value[i] > filters.valueMax) continue;

      out.push(i);
    }
    return out
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
      .slice(0, limit);
  }

  /** Dispatch a scout to watch a player; the report arrives in a week. */
  scoutPlayer(playerIdx: number): void {
    const world = this.world;
    if (world === null) return;
    if (world.scoutingQueue.some((t) => t.playerIdx === playerIdx)) {
      this.notice = 'Already scouting this player — check back in a week.';
      this.emit();
      return;
    }
    world.scoutingQueue.push({ playerIdx, completesOnDay: world.day + 7, matches: 5 });
    this.notice = `Scouts dispatched to watch ${world.players.fullName(playerIdx)}. Report in a week.`;
    this.emit();
  }

  /** Whether a player walked out of talks recently and won't negotiate yet. */
  talksBlocked(playerIdx: number): boolean {
    const until = this.world?.talksBlockedUntil.get(playerIdx);
    return until !== undefined && this.world !== null && until > this.world.day;
  }

  /** The day a player signed today would arrive: today for a free agent or
   *  while a window is open; otherwise the day the next window opens. Talks
   *  themselves are open all year. */
  joinDay(playerIdx: number): number {
    const world = this.world;
    if (world === null) return 0;
    return world.players.clubId[playerIdx] < 0 ? world.day : moveDay(world);
  }

  /** The season a player signed today would join in — contracts are counted from it. */
  joinSeason(playerIdx: number): number {
    return seasonOfDay(this.joinDay(playerIdx));
  }

  /** The deal a player has agreed and is waiting on the window for, if any. */
  pendingMoveOf(playerIdx: number): PendingMove | null {
    const world = this.world;
    return world === null ? null : pendingMoveOf(world, playerIdx) ?? null;
  }

  /** Players who have agreed to join and are waiting on the window. */
  arrivals(): PendingMove[] {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? [] : arrivalsFor(world, club.id);
  }

  /** Room left in the wage budget, with players who have agreed to join already paid for. */
  wageRoom(): number {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? 0 : wageRoom(world, club);
  }

  /** Why a player can't be approached at all right now, or null if he can: on
   *  loan, or already committed to a move waiting on the window. */
  private unavailableReason(playerIdx: number): string | null {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return null;
    const name = world.players.fullName(playerIdx);
    const move = pendingMoveOf(world, playerIdx);
    if (move !== undefined) {
      return move.toClubId === club.id
        ? `${name} has already agreed to join — he arrives on ${this.dateLabelForDay(move.movesOn)}.`
        : `${name} has already agreed a move to ${world.clubs[move.toClubId]?.name ?? 'another club'}.`;
    }
    if (loanOf(world, playerIdx) !== undefined) return `${name} is on loan — he can't move until he is back at his club.`;
    return null;
  }

  /** The window open today, or when the next one opens — for the UI to say so. */
  transferWindowStatus(): { open: boolean; label: string; untilDay: number } {
    const world = this.world;
    if (world === null) return { open: false, label: '', untilDay: 0 };
    const w = transferWindowOn(world.day);
    if (w !== null) {
      const closes = world.day - (world.day % DAYS_PER_SEASON) + w.closes;
      return { open: true, label: w.name === 'summer' ? 'Summer window' : 'January window', untilDay: closes };
    }
    const next = nextTransferWindow(world.day);
    return { open: false, label: next.window.name === 'summer' ? 'Summer window' : 'January window', untilDay: next.day };
  }

  /** The talks the open screen is showing, if any. */
  currentTalks(): Talks | null {
    const n = this.negotiation;
    if (n === null || this.world === null) return null;
    return this.world.talks.find((t) => t.id === n.talksId) ?? null;
  }

  /** Talks in progress with a player, of either kind. */
  talksWith(playerIdx: number, kind?: Talks['kind']): Talks | null {
    return this.world?.talks.find((t) => t.playerIdx === playerIdx && (kind === undefined || t.kind === kind)) ?? null;
  }

  /** Open the screen onto talks already in progress. */
  openTalksView(talksId: number): void {
    const t = this.world?.talks.find((x) => x.id === talksId);
    if (t === undefined) {
      this.notice = 'Those talks are over.';
      this.emit();
      return;
    }
    this.negotiation = {
      talksId,
      feeOffer: t.lastOffer.fee,
      termsWage: t.lastOffer.wage,
      termsRole: t.lastOffer.role,
      termsYears: t.lastOffer.years,
      loanShare: t.lastOffer.wageShare ?? 0.5,
      loanPlayingTime: t.lastOffer.playingTime ?? 'rotation',
      termsAppearance: t.lastOffer.appearanceBonus ?? 0,
      termsTitleBonus: t.lastOffer.titleBonus ?? 0,
      termsClause: t.lastOffer.releaseClause ?? 0,
      termsOption: t.lastOffer.option ?? false,
      termsAgentFee: t.lastOffer.agentFee ?? 0,
      message: null,
    };
    this.staffNegotiation = null;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Open talks to sign a player — a fee with his club first if he's contracted. */
  startNegotiation(playerIdx: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    const existing = this.talksWith(playerIdx, 'transfer');
    if (existing !== null) {
      this.openTalksView(existing.id);
      return;
    }
    const unavailable = this.unavailableReason(playerIdx);
    if (unavailable !== null) {
      this.notice = unavailable;
      this.emit();
      return;
    }
    if (squadSize(world, club) >= MAX_SQUAD) {
      this.notice = 'The squad is full — release a player first.';
      this.emit();
      return;
    }
    const store = world.players;
    if (this.talksBlocked(playerIdx)) {
      this.notice = `${store.fullName(playerIdx)} is not willing to talk to you right now.`;
      this.emit();
      return;
    }
    this.openTalksView(openTalks(world, club, playerIdx, 'transfer').id);
  }

  /** Open contract talks with one of the user's own players. */
  startRenewal(playerIdx: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    // Ours, whether here or out on loan — not a player here on loan, whose
    // contract is with his own club.
    const loan = loanOf(world, playerIdx);
    const ours = loan === undefined ? club.players.includes(playerIdx) : loan.parentClubId === club.id;
    if (!ours) return;
    if (pendingMoveOf(world, playerIdx) !== undefined) {
      this.notice = `${world.players.fullName(playerIdx)} has agreed to leave — there is nothing to renew.`;
      this.emit();
      return;
    }
    // A player stopping at the end of the season has no use for a contract — talking him round comes first.
    if (willRetire(world, playerIdx)) {
      this.notice = `${world.players.fullName(playerIdx)} is retiring at the end of the season — there is nothing to renew.`;
      this.emit();
      return;
    }
    const existing = this.talksWith(playerIdx, 'renewal');
    if (existing !== null) {
      this.openTalksView(existing.id);
      return;
    }
    const store = world.players;
    const name = store.fullName(playerIdx);
    if (this.talksBlocked(playerIdx)) {
      this.notice = `${name} is not willing to talk about a new contract right now.`;
      this.emit();
      return;
    }
    if (refusesToRenew(world, club, playerIdx)) {
      this.notice = `${name} doesn't want to discuss a new contract — he feels he has outgrown the club.`;
      this.emit();
      return;
    }
    this.openTalksView(openTalks(world, club, playerIdx, 'renewal').id);
  }

  /** The loan a player is on, into or out of the club, if any. */
  loanOf(playerIdx: number): Loan | null {
    const world = this.world;
    return world === null ? null : loanOf(world, playerIdx) ?? null;
  }

  /** What the club pays its players this season — loans split as agreed. */
  wageBill(): number {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? 0 : wageBill(world, club);
  }

  /** Players the club answers for against the 16-man limit, loaned-out ones included. */
  squadSize(): number {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? 0 : squadSize(world, club);
  }

  /** The club's own players out on loan elsewhere. */
  loanedOut(): Loan[] {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? [] : loansOutOf(world, club.id);
  }

  /** Whether a player can be asked for on loan: he is under contract elsewhere,
   *  not on loan and not committed to a move. Any day of the year — a loan
   *  agreed with the window shut starts when it opens. */
  canBorrow(playerIdx: number): boolean {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return false;
    const owner = world.players.clubId[playerIdx];
    return owner >= 0 && owner !== club.id && this.unavailableReason(playerIdx) === null;
  }

  /** When a deal done on a listing would go through: now, or once the next window opens. */
  private listingNote(): string {
    const w = this.transferWindowStatus();
    return w.open
      ? 'other clubs will be told he is available.'
      : `other clubs will be told he is available; any deal goes through when the ${w.label.toLowerCase()} opens on ${this.dateLabelForDay(w.untilDay)}.`;
  }

  /** Whether one of the club's own players can be listed — not someone only
   *  here on loan, nor one who has already agreed to leave. */
  private ownContracted(playerIdx: number): boolean {
    const world = this.world;
    const club = this.club;
    return world !== null && club !== null && club.players.includes(playerIdx) &&
      loanOf(world, playerIdx) === undefined && pendingMoveOf(world, playerIdx) === undefined;
  }

  /** Put one of your players on the transfer list, or take him off it. */
  toggleTransferList(playerIdx: number): void {
    const world = this.world;
    if (world === null || !this.ownContracted(playerIdx)) return;
    const store = world.players;
    const on = !store.hasFlag(playerIdx, PlayerFlag.Transferable);
    store.setFlag(playerIdx, PlayerFlag.Transferable, on);
    this.notice = on
      ? `${store.fullName(playerIdx)} is on the transfer list — ${this.listingNote()}`
      : `${store.fullName(playerIdx)} is off the transfer list.`;
    this.emit();
  }

  /** Offer one of your players out on loan, or withdraw the offer. */
  toggleLoanList(playerIdx: number): void {
    const world = this.world;
    if (world === null || !this.ownContracted(playerIdx)) return;
    const store = world.players;
    const on = !store.hasFlag(playerIdx, PlayerFlag.LoanListed);
    store.setFlag(playerIdx, PlayerFlag.LoanListed, on);
    this.notice = on
      ? `${store.fullName(playerIdx)} is available for loan — ${this.listingNote()}`
      : `${store.fullName(playerIdx)} is no longer available for loan.`;
    this.emit();
  }

  /** Ask another club to loan you one of its players until the end of the season. */
  startLoanRequest(playerIdx: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    const existing = this.talksWith(playerIdx, 'loan');
    if (existing !== null) {
      this.openTalksView(existing.id);
      return;
    }
    const store = world.players;
    const name = store.fullName(playerIdx);
    const owner = store.clubId[playerIdx];
    let problem: string | null = null;
    if (owner < 0 || owner === club.id) problem = 'Only players under contract at another club can be loaned.';
    else if (this.unavailableReason(playerIdx) !== null) problem = this.unavailableReason(playerIdx);
    else if (squadSize(world, club) >= MAX_SQUAD) problem = 'The squad is full — release a player first.';
    else if (this.talksBlocked(playerIdx)) problem = `${name} is not willing to talk to you right now.`;
    if (problem !== null) {
      this.notice = problem;
      this.emit();
      return;
    }
    this.openTalksView(openTalks(world, club, playerIdx, 'loan').id);
  }

  setLoanShare(share: number): void {
    if (this.negotiation === null) return;
    this.negotiation.loanShare = share;
    this.emit();
  }

  /** The playing time to promise a player you want on loan. */
  setLoanPlayingTime(playingTime: LoanPlayingTime): void {
    if (this.negotiation === null) return;
    this.negotiation.loanPlayingTime = playingTime;
    this.emit();
  }

  /** Send the loan request to his club. Their answer comes back in a few days. */
  submitLoanRequest(): void {
    const n = this.negotiation;
    const t = this.currentTalks();
    const world = this.world;
    const club = this.club;
    if (n === null || t === null || world === null || club === null || t.kind !== 'loan' || t.pending !== null) return;
    const lender = world.clubs[t.sellingClubId];
    if (lender === undefined) return;
    const cost = world.players.wage[t.playerIdx] * n.loanShare;
    if (cost > wageRoom(world, club)) {
      n.message = 'Not enough room in the wage budget for that share of his wage.';
      this.emit();
      return;
    }
    const due = submitOffer(world, t, { ...t.lastOffer, wageShare: n.loanShare, playingTime: n.loanPlayingTime });
    this.notice = `Loan request sent to ${lender.name} — they will reply by ${this.dateLabelForDay(due)}.`;
    this.negotiation = null;
    this.emit();
  }

  setFeeOffer(amount: number): void {
    if (this.negotiation === null) return;
    this.negotiation.feeOffer = amount;
    this.emit();
  }

  setTermsWage(amount: number): void {
    if (this.negotiation === null) return;
    this.negotiation.termsWage = amount;
    this.emit();
  }

  setTermsRole(role: SquadRole): void {
    if (this.negotiation === null) return;
    this.negotiation.termsRole = role;
    this.emit();
  }

  setTermsYears(years: number): void {
    if (this.negotiation === null) return;
    this.negotiation.termsYears = years;
    // An option can't take a contract past the longest anyone signs.
    if (years >= MAX_CONTRACT_YEARS) this.negotiation.termsOption = false;
    this.emit();
  }

  /** Change the small print of the offer being put together. */
  setSmallPrint(patch: Partial<SmallPrint>): void {
    if (this.negotiation === null) return;
    Object.assign(this.negotiation, patch);
    this.negotiation.message = null;
    this.emit();
  }

  /** A club's rivals: its city's other clubs, and its classic rival. */
  rivalsOf(clubId: number): Array<{ clubId: number; kind: Rivalry }> {
    return this.world === null ? [] : rivalsOf(this.world, clubId);
  }

  /** The release clause in a player's contract, if he has one. */
  releaseClause(playerIdx: number): number | null {
    return this.world === null ? null : releaseClauseOf(this.world, playerIdx);
  }

  /** Bid exactly his release clause — his club can't refuse it. */
  payReleaseClause(): void {
    const n = this.negotiation;
    const t = this.currentTalks();
    if (n === null || t === null || this.world === null) return;
    const clause = releaseClauseOf(this.world, t.playerIdx);
    if (clause === null) return;
    n.feeOffer = clause;
    this.submitFeeOffer();
  }

  /** Take up the club's option on one more season of a player's contract. */
  takeUpOption(playerIdx: number): void {
    if (this.world === null) return;
    this.notice = takeUpOption(this.world, playerIdx).text;
    this.emit();
  }

  /** Fill the offer in with exactly what the player is asking for. */
  matchDemands(): void {
    const n = this.negotiation;
    const t = this.currentTalks();
    if (n === null || t === null) return;
    n.termsWage = t.demands.wage;
    n.termsRole = t.demands.role;
    n.termsYears = Math.min(t.demands.maxYears, Math.max(t.demands.minYears, n.termsYears));
    // His agent's fee, and the way out he asks for — a lower clause than he asks is fine by him.
    n.termsAgentFee = t.demands.agentFee ?? 0;
    const max = t.demands.clauseMax ?? null;
    if (max !== null && (n.termsClause <= 0 || n.termsClause > max)) n.termsClause = max;
    n.termsOption = false;
    n.message = null;
    this.emit();
  }

  /** Send the bid to the selling club. Their answer comes back in a few days. */
  submitFeeOffer(): void {
    const n = this.negotiation;
    const t = this.currentTalks();
    const world = this.world;
    const club = this.club;
    if (n === null || t === null || world === null || club === null || t.stage !== 'fee' || t.pending !== null) return;
    const seller = world.clubs[t.sellingClubId];
    if (seller === undefined) return;
    if (n.feeOffer > Math.min(club.finances.transferBudget, club.finances.balance)) {
      n.message = 'That exceeds your transfer budget.';
      this.emit();
      return;
    }
    const due = submitOffer(world, t, {
      fee: n.feeOffer, wage: n.termsWage, role: n.termsRole, years: n.termsYears,
    });
    this.notice = `Bid sent to ${seller.name} — they will reply by ${this.dateLabelForDay(due)}.`;
    this.negotiation = null;
    this.emit();
  }

  /** Send the terms to the player. His answer — weighed against any rival
   *  offers — comes back in a few days; a renewal takes two at least. */
  submitTermsOffer(): void {
    const n = this.negotiation;
    const t = this.currentTalks();
    const world = this.world;
    const club = this.club;
    if (n === null || t === null || world === null || club === null || t.stage !== 'terms' || t.pending !== null) return;
    const store = world.players;
    const p = t.playerIdx;

    // A renewal's new wage replaces what he earns now.
    const room = wageRoom(world, club) + (t.kind === 'renewal' ? store.wage[p] : 0);
    if (n.termsWage > room) {
      n.message = 'Not enough room in the wage budget for that contract.';
      this.emit();
      return;
    }
    if (n.termsAgentFee > club.finances.balance - (t.kind === 'transfer' ? t.agreedFee : 0)) {
      n.message = 'The club can\'t afford that agent\'s fee.';
      this.emit();
      return;
    }
    const due = submitOffer(world, t, {
      fee: t.agreedFee, wage: n.termsWage, role: n.termsRole, years: n.termsYears,
      appearanceBonus: n.termsAppearance, titleBonus: n.termsTitleBonus, releaseClause: n.termsClause,
      option: n.termsOption && n.termsYears < MAX_CONTRACT_YEARS, agentFee: n.termsAgentFee,
    });
    const name = store.fullName(p);
    this.notice = t.kind === 'renewal'
      ? `Offer made to ${name} — he will give his answer by ${this.dateLabelForDay(due)}.`
      : `Terms sent to ${name}'s agent — expect a reply by ${this.dateLabelForDay(due)}.`;
    this.negotiation = null;
    this.emit();
  }

  /** Close the talks screen — the talks themselves carry on. */
  cancelNegotiation(): void {
    this.negotiation = null;
    this.emit();
  }

  /** Walk away from the talks for good. */
  withdrawTalks(): void {
    const t = this.currentTalks();
    const world = this.world;
    if (t !== null && world !== null) {
      closeTalks(world, t);
      this.notice = `You have ended talks with ${world.players.fullName(t.playerIdx)}.`;
    }
    this.negotiation = null;
    this.emit();
  }

  /** Open a bid for one of your players. */
  openOffer(offerId: number): void {
    const world = this.world;
    if (world === null) return;
    const offer = world.incomingOffers.find((o) => o.id === offerId);
    if (offer === undefined) {
      this.notice = 'That offer is no longer on the table.';
      this.emit();
      return;
    }
    this.incomingOffer = {
      offerId,
      playerIdx: offer.playerIdx,
      buyingClubId: offer.buyingClubId,
      fee: offer.fee,
      counterFee: offer.counterFee ?? offer.fee,
      counterShare: offer.counterLoan?.wageShare ?? offer.loan?.wageShare ?? 0,
      counterPlayingTime: offer.counterLoan?.playingTime ?? offer.loan?.playingTime ?? 'rotation',
      message: null,
      expiresOnDay: offer.expiresOnDay,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.staffNegotiation = null;
    this.emit();
  }

  setCounterFee(amount: number): void {
    if (this.incomingOffer === null) return;
    this.incomingOffer.counterFee = amount;
    this.emit();
  }

  /** Loan offers: the share of his wage to ask them to pay. */
  setCounterShare(share: number): void {
    if (this.incomingOffer === null) return;
    this.incomingOffer.counterShare = share;
    this.incomingOffer.message = null;
    this.emit();
  }

  /** Loan offers: the playing time to ask them to promise. */
  setCounterPlayingTime(playingTime: LoanPlayingTime): void {
    if (this.incomingOffer === null) return;
    this.incomingOffer.counterPlayingTime = playingTime;
    this.incomingOffer.message = null;
    this.emit();
  }

  /** Ask a club that wants one of yours on loan for better terms. They answer in a day or two. */
  counterLoanOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    const offer = this.reviewedOffer();
    if (n === null || world === null || offer === null || offer.loan === undefined || (offer.status ?? 'open') !== 'open') return;
    const same = n.counterShare === offer.loan.wageShare && n.counterPlayingTime === (offer.loan.playingTime ?? 'rotation');
    if (same) {
      n.message = 'Those are the terms they have offered — ask for more, or simply accept.';
      this.emit();
      return;
    }
    const due = counterLoanOffer(world, offer, { wageShare: n.counterShare, playingTime: n.counterPlayingTime });
    const buyer = world.clubs[offer.buyingClubId];
    this.notice = `Your terms have gone to ${buyer?.name ?? 'the club'} — they will answer by ${this.dateLabelForDay(due)}.`;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Sit down with the coach of a club playing one of yours on loan too little. */
  openCoachTalk(playerIdx: number): void {
    const world = this.world;
    if (world === null) return;
    const problem = coachTalkBlock(world, playerIdx);
    const requests = coachRequests(world, playerIdx);
    if (problem !== null || requests.length === 0) {
      this.notice = problem ?? 'There is nothing to ask his coach for.';
      this.emit();
      return;
    }
    this.coachTalk = { playerIdx, request: requests[0], firm: false, result: null };
    this.negotiation = null;
    this.staffNegotiation = null;
    this.incomingOffer = null;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.emit();
  }

  setCoachRequest(request: LoanPlayingTime): void {
    if (this.coachTalk === null || this.coachTalk.result !== null) return;
    this.coachTalk.request = request;
    this.emit();
  }

  setCoachFirm(firm: boolean): void {
    if (this.coachTalk === null || this.coachTalk.result !== null) return;
    this.coachTalk.firm = firm;
    this.emit();
  }

  /** Say it: the coach answers there and then. */
  speakToCoach(): void {
    const t = this.coachTalk;
    const world = this.world;
    if (t === null || world === null || t.result !== null) return;
    const result = talkToLoanCoach(world, t.playerIdx, t.request, t.firm);
    if (result === null) {
      this.notice = coachTalkBlock(world, t.playerIdx) ?? 'That is not something to ask him for.';
      this.coachTalk = null;
      this.playerTalk = null;
    } else {
      t.result = result;
    }
    this.emit();
  }

  closeCoachTalk(): void {
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Recall one of your players from a loan whose club hasn't given him the games it promised. */
  recallFromLoan(playerIdx: number): void {
    const world = this.world;
    if (world === null) return;
    const name = world.players.fullName(playerIdx);
    this.notice = recallPlayer(world, playerIdx)
      ? `${name} is back from his loan.`
      : `${name} can't be recalled — his loan club is giving him the games it promised.`;
    this.emit();
  }

  /**
   * Have the staff compile the matches of one of your players out on loan:
   * the report lands in the inbox at once, and opens.
   */
  compileLoanMatches(playerIdx: number): void {
    const world = this.world;
    if (world === null) return;
    const message = requestLoanReport(world, playerIdx);
    if (message === null) {
      this.notice = `${world.players.fullName(playerIdx)} is no longer out on loan.`;
      this.emit();
      return;
    }
    this.openMessage(message.id);
  }

  private reviewedOffer(): IncomingOffer | null {
    const n = this.incomingOffer;
    return n === null ? null : this.world?.incomingOffers.find((o) => o.id === n.offerId) ?? null;
  }

  /** Agree to the fee as offered; the player then takes a few days to decide. */
  acceptOffer(): void {
    const world = this.world;
    const offer = this.reviewedOffer();
    if (world === null || offer === null || (offer.status ?? 'open') !== 'open') return;
    const due = acceptIncomingOffer(world, offer);
    const buyer = world.clubs[offer.buyingClubId];
    const name = world.players.fullName(offer.playerIdx);
    this.notice = offer.loan !== undefined
      ? `Loan agreed with ${buyer?.name ?? 'them'} — ${name} will decide by ${this.dateLabelForDay(due)}.`
      : `${name} is talking terms with ${buyer?.name ?? 'them'} — he will decide by ${this.dateLabelForDay(due)}.`;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Ask for more; the buying club answers in a day or two. */
  counterOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    const offer = this.reviewedOffer();
    if (n === null || world === null || offer === null || (offer.status ?? 'open') !== 'open') return;
    if (offer.loan !== undefined) return; // a loan's terms go through counterLoanOffer
    if (n.counterFee <= offer.fee) {
      n.message = 'Ask for more than they have offered — or simply accept.';
      this.emit();
      return;
    }
    const due = counterIncomingOffer(world, offer, n.counterFee);
    const buyer = world.clubs[offer.buyingClubId];
    this.notice = `Asking price sent to ${buyer?.name ?? 'the club'} — they will answer by ${this.dateLabelForDay(due)}.`;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /** Reject the offer outright — the buying club walks away for good, and the player has his feelings about it. */
  declineOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    if (n === null || world === null) return;
    const offer = world.incomingOffers.find((o) => o.id === n.offerId);
    world.incomingOffers = world.incomingOffers.filter((o) => o.id !== n.offerId);
    if (offer !== undefined) bidTurnedDown(world, offer, 'declined');
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.notice = 'You turned down the offer.';
    this.emit();
  }

  /** Close the offer sheet without deciding — it stays pending and can be reopened later. */
  closeOfferView(): void {
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  /**
   * The board sets one combined envelope for wages and transfers each season;
   * moving money into one side takes it from the other.
   */
  setWageBudget(amount: number): void {
    const club = this.club;
    if (club === null) return;
    const total = club.finances.wageBudget + club.finances.transferBudget;
    const wage = Math.max(0, Math.min(total, amount));
    club.finances.wageBudget = wage;
    club.finances.transferBudget = total - wage;
    this.emit();
  }

  setTransferBudget(amount: number): void {
    const club = this.club;
    if (club === null) return;
    const total = club.finances.wageBudget + club.finances.transferBudget;
    const transfer = Math.max(0, Math.min(total, amount));
    club.finances.transferBudget = transfer;
    club.finances.wageBudget = total - transfer;
    this.emit();
  }

  releasePlayer(playerIdx: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null || !club.players.includes(playerIdx)) return;
    if (loanOf(world, playerIdx) !== undefined) {
      this.notice = `${world.players.fullName(playerIdx)} is here on loan — he goes back at the end of the season.`;
      this.emit();
      return;
    }
    if (pendingMoveOf(world, playerIdx) !== undefined) {
      this.notice = `${world.players.fullName(playerIdx)} has agreed a move — he leaves when the window opens.`;
      this.emit();
      return;
    }
    club.players = club.players.filter((p) => p !== playerIdx);
    world.players.clubId[playerIdx] = -1;
    world.players.setFlag(playerIdx, PlayerFlag.Transferable, false);
    world.players.setFlag(playerIdx, PlayerFlag.LoanListed, false);
    logTransfer(world, playerIdx, club.id, -1, 0);
    this.notice = `${world.players.fullName(playerIdx)} has been released.`;
    this.emit();
  }

  /** Promote a youth player into the senior squad, contract and all. */
  promotePlayer(playerIdx: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    club.youthPlayers = club.youthPlayers.filter((p) => p !== playerIdx);
    club.players.push(playerIdx);
    world.players.setFlag(playerIdx, PlayerFlag.Youth, false);
    world.players.contractUntil[playerIdx] = seasonEndDay(world.season + 2);
    this.notice = `${world.players.fullName(playerIdx)} has been promoted to the first team.`;
    this.emit();
  }

  // ---- Staff -------------------------------------------------------------

  /** The club's backroom — everyone but the head coach, who is the manager. */
  backroom(): Staff[] {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? [] : backroomOf(world, club);
  }

  /** Who the club could hire for a role: out of work, or in work at other clubs. */
  staffMarket(role: StaffRole, employed: boolean): StaffListing[] {
    const world = this.world;
    const club = this.club;
    return world === null || club === null ? [] : staffMarket(world, club, role, employed);
  }

  /** What one of the staff, or someone on the market, asks of the club — and how he feels about it. */
  staffTerms(staffId: number): { ask: number; interest: StaffInterest; fee: number; longest: number; block: string | null; room: number } | null {
    const world = this.world;
    const club = this.club;
    const s = world?.staff[staffId];
    if (world === null || club === null || s === undefined) return null;
    const own = s.clubId === club.id;
    return {
      ask: staffWageAsk(world, s, club),
      interest: staffInterest(world, s, club),
      fee: own ? 0 : compensationFor(world, s),
      longest: longestContract(world, s, club),
      block: staffOfferBlock(world, club, s),
      room: staffBudgetRoom(world, club, own ? s : undefined),
    };
  }

  /** Let one of the staff go, paying up the rest of his contract. */
  releaseStaffMember(staffId: number): void {
    const world = this.world;
    const club = this.club;
    const s = world?.staff[staffId];
    if (world === null || club === null || s === undefined) return;
    const cost = releaseStaff(world, club, s);
    this.notice = `${staffName(s)} has left the club${cost > 0 ? ` — ${euros(cost)} paid up on his contract` : ''}.`;
    this.emit();
  }

  /** What releasing one of the staff would cost now. */
  staffSeverance(staffId: number): number {
    const world = this.world;
    const s = world?.staff[staffId];
    return world === null || s === undefined ? 0 : severanceFor(world, s);
  }

  /** Every staff negotiation under way. */
  staffTalks(): StaffTalks[] {
    return this.world === null ? [] : staffTalksOf(this.world);
  }

  /** Talks under way with one man, if any. */
  staffTalksWith(staffId: number): StaffTalks | null {
    return this.world === null ? null : staffTalksWith(this.world, staffId) ?? null;
  }

  /** The staff talks the open screen is showing, if any. */
  currentStaffTalks(): StaffTalks | null {
    const n = this.staffNegotiation;
    return n === null || this.world === null ? null : staffTalksOf(this.world).find((t) => t.id === n.talksId) ?? null;
  }

  /**
   * Talk to a member of staff — to hire him, or to keep one of the club's own
   * — the way it is done with players: talks already under way pick up where
   * they are.
   */
  openStaffTalks(staffId: number): void {
    const world = this.world;
    const club = this.club;
    const s = world?.staff[staffId];
    if (world === null || club === null || s === undefined) return;
    const existing = staffTalksWith(world, staffId);
    if (existing !== undefined) {
      this.openStaffTalksView(existing.id);
      return;
    }
    const block = staffTalksBlock(world, club, s);
    if (block !== null) {
      this.notice = block;
      this.emit();
      return;
    }
    this.openStaffTalksView(openStaffTalks(world, club, s).id);
  }

  /** Show talks already under way. */
  openStaffTalksView(talksId: number): void {
    const t = this.world === null ? undefined : staffTalksOf(this.world).find((x) => x.id === talksId);
    if (t === undefined) {
      this.notice = 'Those talks are over.';
      this.emit();
      return;
    }
    this.staffNegotiation = { talksId, fee: t.lastOffer.fee, wage: t.lastOffer.wage, years: t.lastOffer.years, message: null };
    this.negotiation = null;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.playerTalk = null;
    this.emit();
  }

  setStaffFee(fee: number): void {
    if (this.staffNegotiation === null) return;
    this.staffNegotiation.fee = fee;
    this.staffNegotiation.message = null;
    this.emit();
  }

  setStaffWage(wage: number): void {
    if (this.staffNegotiation === null) return;
    this.staffNegotiation.wage = wage;
    this.staffNegotiation.message = null;
    this.emit();
  }

  setStaffYears(years: number): void {
    if (this.staffNegotiation === null) return;
    this.staffNegotiation.years = years;
    this.emit();
  }

  /** Fill the offer in with exactly what he is asking for. */
  matchStaffDemands(): void {
    const n = this.staffNegotiation;
    const t = this.currentStaffTalks();
    if (n === null || t === null) return;
    n.wage = t.demands.wage;
    n.years = Math.min(t.demands.maxYears, Math.max(t.demands.minYears, n.years));
    n.message = null;
    this.emit();
  }

  /** Put the compensation to his club. Their answer comes back in a few days. */
  submitStaffFee(): void {
    const n = this.staffNegotiation;
    const t = this.currentStaffTalks();
    const world = this.world;
    const club = this.club;
    if (n === null || t === null || world === null || club === null || t.stage !== 'fee' || t.pending !== null) return;
    if (n.fee > club.finances.balance) {
      n.message = 'The club can\'t find that much.';
      this.emit();
      return;
    }
    const due = submitStaffOffer(world, t, { fee: n.fee, wage: n.wage, years: n.years });
    this.notice = `Approach made to ${world.clubs[t.fromClubId]?.name ?? 'his club'} — they will reply by ${this.dateLabelForDay(due)}.`;
    this.staffNegotiation = null;
    this.emit();
  }

  /** Put the terms to him. His answer — weighed against any rival offers — comes back in a few days. */
  submitStaffTerms(): void {
    const n = this.staffNegotiation;
    const t = this.currentStaffTalks();
    const world = this.world;
    const club = this.club;
    const s = t !== null ? world?.staff[t.staffId] : undefined;
    if (n === null || t === null || world === null || club === null || s === undefined || t.stage !== 'terms' || t.pending !== null) return;
    const renewal = t.kind === 'renewal';
    if (!renewal && roleCount(world, club, s.role).have >= STAFF_SLOTS[s.role]) {
      n.message = 'Every place in his role is taken — release someone first.';
      this.emit();
      return;
    }
    if (n.wage > staffBudgetRoom(world, club, renewal ? s : undefined)) {
      n.message = 'Not enough room in the staff budget for that wage.';
      this.emit();
      return;
    }
    const due = submitStaffOffer(world, t, { fee: t.agreedFee, wage: n.wage, years: n.years });
    this.notice = `Offer made to ${staffName(s)} — he will give his answer by ${this.dateLabelForDay(due)}.`;
    this.staffNegotiation = null;
    this.emit();
  }

  /** Close the staff talks screen — the talks themselves carry on. */
  closeStaffNegotiation(): void {
    this.staffNegotiation = null;
    this.emit();
  }

  /** Walk away from the staff talks for good. */
  withdrawStaffTalks(): void {
    const t = this.currentStaffTalks();
    const world = this.world;
    if (t !== null && world !== null) {
      withdrawStaffTalks(world, t);
      const s = world.staff[t.staffId];
      this.notice = `You have ended talks with ${s !== undefined ? staffName(s) : 'him'}.`;
    }
    this.staffNegotiation = null;
    this.emit();
  }

  /** Make one of the staff available to other clubs, or take him off the list. */
  toggleStaffListed(staffId: number): void {
    const world = this.world;
    const club = this.club;
    const s = world?.staff[staffId];
    if (world === null || club === null || s === undefined || s.clubId !== club.id) return;
    setStaffListed(club, s, s.listed !== true);
    this.notice = s.listed === true
      ? `${staffName(s)} is available — other clubs will be told, and can come in for him.`
      : `${staffName(s)} is no longer available.`;
    this.emit();
  }

  // ---- Retirement ---------------------------------------------------------

  /** A player's plan to stop at the end of this season, if he has one. */
  retirementPlan(p: number): RetirementPlan | undefined {
    return this.world === null ? undefined : retirementPlan(this.world, p);
  }

  /** Try to talk one of the club's retiring players into another season. */
  persuadeToPlayOn(p: number): void {
    const world = this.world;
    if (world === null) return;
    this.notice = persuadeToPlayOn(world, p);
    this.emit();
  }

  /** Ask one of the club's retiring players to join the staff as he stops. */
  offerStaffRole(p: number, role: StaffRole): void {
    const world = this.world;
    if (world === null) return;
    this.notice = offerStaffRole(world, p, role);
    this.emit();
  }

  /** The clubs interested in a player, as his profile lists them. */
  interestedClubs(p: number): ClubInterest[] {
    return this.world === null ? [] : interestedClubs(this.world, p);
  }

  /** Answer another club's approach for one of the staff: let them talk to him — he then decides — or keep him. */
  answerStaffApproach(approachId: number, accept: boolean): void {
    const world = this.world;
    if (world === null) return;
    this.notice = answerStaffApproach(world, approachId, accept);
    this.emit();
  }

  /** Ask a club that wants one of the staff for more. */
  counterStaffApproach(approachId: number, fee: number): void {
    const world = this.world;
    if (world === null) return;
    this.notice = counterStaffApproach(world, approachId, fee);
    this.emit();
  }

  /** Called by tactics screens after mutating club.tactics in place. */
  touch(): void {
    this.emit();
  }

  // ---- Calendar ---------------------------------------------------------

  phase(): SeasonPhase {
    return this.world === null ? SeasonPhase.OffSeason : currentPhase(this.world);
  }

  dateLabel(): string {
    const world = this.world;
    if (world === null) return '';
    return this.dateLabelForDay(world.day);
  }

  /** Calendar date label for any absolute world day, past or future. */
  dateLabelForDay(day: number): string {
    const date = this.calendarDate(day);
    if (date === null) return '';
    return date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
  }

  /** Short weekday name ("Sat") for an absolute world day — for the header's date block. */
  weekdayLabelForDay(day: number): string {
    const date = this.calendarDate(day);
    if (date === null) return '';
    return date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  }

  /** "Mon, 11 January 2027" — the header's full date. */
  longDateLabel(day: number): string {
    const date = this.calendarDate(day);
    if (date === null) return '';
    const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    const month = date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    return `${weekday}, ${String(date.getUTCDate()).padStart(2, '0')} ${month} ${date.getUTCFullYear()}`;
  }

  /** The calendar date (UTC) an absolute world day falls on. */
  calendarDate(day: number): Date | null {
    const world = this.world;
    if (world === null) return null;
    // The save begins on 1 July, so season day 0 is calendar day 181. Each
    // season spans two calendar years: from 1 January (season day 184) on,
    // the date is in the year after the one the season started in.
    const seasonDay = ((day % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON;
    const doy = (seasonDay + 181) % 365;
    const year = world.startYear + Math.floor(day / DAYS_PER_SEASON) + (seasonDay >= 184 ? 1 : 0);
    // Seasons are 365 days, so the day and month come from a non-leap year —
    // otherwise every date after February drifts a day in leap years.
    const md = new Date(Date.UTC(2001, 0, 1));
    md.setUTCDate(md.getUTCDate() + doy);
    return new Date(Date.UTC(year, md.getUTCMonth(), md.getUTCDate()));
  }
}

export const game = new Game();

/** Re-render on any game state change. */
export function useGame(): Game {
  useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);
  return game;
}

/** How far the task under way has got, when that can be told: a share done, or a running count. */
export interface TaskProgress {
  /** 0 to 1; null when the whole is not known. */
  fraction: number | null;
  label: string;
}

// Kept apart from the game's store: a tick re-renders the task's window, not the whole game.
let taskProgress: TaskProgress | null = null;
const progressListeners = new Set<() => void>();

function setTaskProgress(progress: TaskProgress | null): void {
  taskProgress = progress;
  for (const listener of progressListeners) listener();
}

function subscribeTaskProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

export function useTaskProgress(): TaskProgress | null {
  return useSyncExternalStore(subscribeTaskProgress, () => taskProgress, () => taskProgress);
}

/** A progress report, passed on a few times a second at most — and always at the end. */
function progressEvery<T>(toProgress: (value: T) => TaskProgress): (value: T) => void {
  let last = 0;
  return (value) => {
    const progress = toProgress(value);
    const now = Date.now();
    if (now - last < 120 && progress.fraction !== 1) return;
    last = now;
    setTaskProgress(progress);
  };
}

/** Resolves once what the page shows now has been painted — so a window put up before work
 *  that holds the page is on screen, its animations running, before the work starts. */
function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    // A hidden tab paints nothing: don't wait on it.
    setTimeout(resolve, 150);
  });
}

/** A saved career in a line: the club and the date. */
function careerLine(meta: SaveMeta): string {
  return `${meta.clubName} · ${meta.inGameDate}`;
}

/** A large world, or one some seasons in: its window says it may take a while. */
function isBigCareer(meta: SaveMeta | undefined): boolean {
  return meta !== undefined && (meta.scale === 'large' || meta.season >= 4);
}

export const PHASE_NAMES: Record<SeasonPhase, string> = {
  [SeasonPhase.PreSeason]: 'Pre-season',
  [SeasonPhase.RegularSeason]: 'Regular season',
  [SeasonPhase.Playoffs]: 'Playoffs',
  [SeasonPhase.NationalTeam]: 'International window',
  [SeasonPhase.OffSeason]: 'Off-season',
};
