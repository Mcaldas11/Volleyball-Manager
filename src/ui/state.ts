/**
 * Game state for the UI.
 *
 * A deliberately thin layer: the engine owns the world and all the rules, and
 * this only holds what the *interface* needs — which club the user manages,
 * which screen is open, which player is selected, and the last match they
 * watched. Nothing here may contain simulation logic; if a rule lives in the
 * UI it cannot be tested headlessly or run in a fifty-season career.
 */

import { useSyncExternalStore } from 'react';
import {
  MatchFormat, MatchSimulator, simulateMatch, type MatchResult, type RallyLogEntry, type SubstitutionPlan,
  type SubstitutionReason, type TeamSetup,
} from '../engine/match/engine.ts';
import type { Club } from '../engine/model/club.ts';
import { matchRating, playedInMatch } from '../engine/match/playerRating.ts';
import { NO_CLUB, PlayerFlag } from '../engine/model/players.ts';
import { type Position } from '../engine/model/positions.ts';
import { StaffRole, STAFF_ROLE_NAMES, type Staff } from '../engine/model/staff.ts';
import {
  advanceDay, applyMatchResult, newSeasonContext, oppositionRead, pickLineup, playFixture, toTeamSetup,
  type SeasonContext,
} from '../engine/season/seasonEngine.ts';
import { endSeason, type RolloverReport } from '../engine/season/rollover.ts';
import { startSeason } from '../engine/season/seasonEngine.ts';
import { generateStaff, generateWorld, type WorldScale } from '../engine/world/worldGen.ts';
import {
  currentPhase, dayOfSeason, DAYS_PER_SEASON, logTransfer, nextTransferWindow, seasonEndDay, SeasonPhase,
  transferWindowOn,
  type Fixture, type GameMessage, type ManagerProfile, type World,
} from '../engine/world/world.ts';
import { refusesToRenew, SquadRole, type IncomingOffer } from '../engine/world/negotiation.ts';
import { defaultTactics, type Formation, type TeamTactics } from '../engine/match/tactics.ts';
import {
  activeTactic, deleteTactic as deleteTacticSlot, loadTactic as loadTacticSlot, MAX_TACTICS,
  newTactic as newTacticSlot, renameTactic as renameTacticSlot, tacticSlots, type SavedTactic,
} from '../engine/model/tacticSlots.ts';
import {
  acceptNationalOffer, applyForNationalJob, applyIntlResult, askForSquad, canPlayForCountry, declineNationalOffer,
  leaveNationalJob, matchImportance, nameSquad,
  nationalApplicationBlock, nationName, nationSetup, postMatchReport, squadDue, squadOf, startNationalCareer, suggestSquad,
  userMatchToday, userNation, type IntlMatch, type Tournament,
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
import {
  answerInterviewQuestion as resolveInterviewAnswer,
  closeInterview as closeInterviewSession,
  declineInterview as declineInterviewSession,
  type AnswerResult,
} from '../engine/world/interviews.ts';
import {
  deleteSave as deleteSaveFromDb, listSaves, loadGame as readSaveWorld,
  newSaveId, saveGame as writeSaveWorld, type SaveMeta,
} from './persistence.ts';

export type ScreenId =
  | 'home' | 'inbox' | 'calendar' | 'competitions' | 'squad' | 'lineup' | 'tactics' | 'rotations' | 'fixtures' | 'table'
  | 'transfers' | 'training' | 'finances' | 'staff' | 'scouting'
  | 'youth' | 'stats' | 'rankings' | 'halloffame' | 'career' | 'jobs' | 'news' | 'internationals';

/** The screens that still make sense without a club — everything a manager
 *  between jobs can look at. */
export const CLUBLESS_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>([
  'home', 'inbox', 'career', 'jobs', 'competitions', 'stats', 'rankings', 'halloffame', 'news', 'internationals',
]);

export type MenuStage = 'main' | 'load' | 'createManager' | 'worldSetup';

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
  /** A problem with the offer itself (budget, window) before it is sent. */
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
  fixtureId: number | null;
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
}

/** A revealed rally, plus the court arrangement that was in effect while it
 *  was played (rotation only changes between rallies), so the live view can
 *  place each contact in its true zone for the ball animation. */
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
  homeBench: number[];
  speed: 0.75 | 1 | 1.5;
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
}

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
  incomingOffer: IncomingOfferReview | null = null;
  /** A word with the coach of a club playing one of ours on loan. */
  coachTalk: CoachTalk | null = null;
  /** Fixture id of the press conference currently open full-screen, if any. */
  activeInterviewFixtureId: number | null = null;
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
  /** What the career being created takes charge of. */
  careerMode: CareerMode = 'club';
  /** Club and country: the club is taken, the nation still to pick. */
  private nationStepPending = false;
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

  newGame(scale: WorldScale, seed: number): void {
    const manager = this.pendingManager;
    if (manager === null) return;
    const world = generateWorld({ seed, startYear: 2026, scale, manager });
    this.ctx = newSeasonContext();
    startSeason(world, this.ctx);
    this.world = world;
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
    this.incomingOffer = null;
    this.coachTalk = null;
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
    this.busy = true;
    this.emit();
    try {
      const { world, season } = await readSaveWorld(id);
      this.world = world;
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
      this.incomingOffer = null;
      this.coachTalk = null;
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
    this.busy = false;
    this.emit();
  }

  async saveCurrentGame(): Promise<void> {
    const world = this.world;
    if (world === null) return;
    if (this.currentSaveId === null) this.currentSaveId = newSaveId();
    const nationalTeam = world.career.nationalTeam ?? -1;
    this.busy = true;
    this.emit();
    try {
      const meta: SaveMeta = {
        id: this.currentSaveId,
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
      };
      await writeSaveWorld(this.currentSaveId, meta, world, this.ctx);
      this.notice = 'Game saved.';
    } catch (err) {
      this.notice = err instanceof Error ? err.message : 'Could not save this career.';
    }
    this.busy = false;
    this.emit();
  }

  async exitToMenu(): Promise<void> {
    await this.saveCurrentGame();
    this.resetHistory();
    this.world = null;
    this.currentSaveId = null;
    this.saveCreatedAt = null;
    this.currentScale = null;
    this.menuStage = 'main';
    await this.refreshSaves();
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
    this.incomingOffer = null;
    this.coachTalk = null;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedCompetition = null;
    this.watched = null;
    this.postMatch = null;
    this.activeInterviewFixtureId = null;
    if (this.club === null && !CLUBLESS_SCREENS.has(this.screen)) this.screen = 'home';
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
    this.incomingOffer = null;
    this.coachTalk = null;
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
    this.incomingOffer = null;
    this.coachTalk = null;
    this.emit();
  }

  select(playerIdx: number | null): void {
    if (playerIdx !== null) {
      this.pushHistory({ screen: this.screen, selectedPlayer: playerIdx, selectedClub: null, selectedReview: null, selectedCompetition: null });
    }
    this.selectedPlayer = playerIdx;
    if (playerIdx !== null) {
      this.selectedClub = null;
      this.selectedCoach = null;
      this.selectedNation = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
      this.coachTalk = null;
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
    this.incomingOffer = null;
    this.coachTalk = null;
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
    this.incomingOffer = null;
    this.coachTalk = null;
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
    this.incomingOffer = null;
    this.coachTalk = null;
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

  /** Open the full-screen press conference for a fixture the user chose to
   *  attend — a no-op if there's no open session for it. */
  openInterview(fixtureId: number): void {
    const world = this.world;
    if (world === null) return;
    if (!world.pendingInterviews.some((s) => s.fixtureId === fixtureId)) return;
    const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === fixtureId);
    if (msg !== undefined) msg.read = true;
    this.activeInterviewFixtureId = fixtureId;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.emit();
  }

  /** Skip a press conference entirely — always safe: no morale risk, but no
   *  boost either. */
  declineInterview(fixtureId: number): void {
    const world = this.world;
    if (world === null) return;
    if (!declineInterviewSession(world, fixtureId)) return;
    const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === fixtureId);
    if (msg !== undefined) msg.read = true;
    this.notice = 'You declined the press conference.';
    this.emit();
  }

  /** Answer the current question of the open press conference. Nudges both
   *  squads' morale, updates that journalist's body language, and advances
   *  to the next question (or finishes the conference). */
  answerInterviewQuestion(fixtureId: number, optionIndex: number): AnswerResult | null {
    const world = this.world;
    if (world === null) return null;
    const result = resolveInterviewAnswer(world, fixtureId, optionIndex);
    if (result === null) return null;
    // Answering is itself reading the message — without this, a manager who
    // goes straight into the conference from the notification would still
    // see it flagged unread afterwards.
    const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === fixtureId);
    if (msg !== undefined) msg.read = true;
    this.emit();
    return result;
  }

  /** Close a finished press conference's summary and return to the game. */
  closeInterview(): void {
    const world = this.world;
    const fixtureId = this.activeInterviewFixtureId;
    if (world !== null && fixtureId !== null) closeInterviewSession(world, fixtureId);
    this.activeInterviewFixtureId = null;
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
    if (world === null || this.processing || this.matchday !== null || this.activeInterviewFixtureId !== null) return;
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
      if (s.finished || world.fixtures[s.fixtureId]?.played !== false) continue;
      const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === s.fixtureId);
      return {
        kind: 'interview', label: 'Press conference', fixtureId: s.fixtureId, offerId: null, messageId: msg?.id ?? null,
        reason: 'The press are waiting — attend the press conference or decline it before you go on.',
      };
    }
    for (const o of world.incomingOffers) {
      if ((o.status ?? 'open') !== 'open') continue;
      const msg = world.messages.find((m) => m.offerId === o.id);
      const club = world.clubs[o.buyingClubId]?.name ?? 'A club';
      return {
        kind: 'offer', label: 'Respond to offer', fixtureId: null, offerId: o.id, messageId: msg?.id ?? null,
        reason: `${club} want an answer about ${world.players.fullName(o.playerIdx)} — accept, counter or reject the offer before you go on.`,
      };
    }
    const due = squadDue(world);
    if (due !== undefined) {
      return {
        kind: 'squad', label: 'Name your squad', fixtureId: null, offerId: null, messageId: null,
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
    } else if (d.messageId !== null) this.openMessage(d.messageId);
    else if (d.fixtureId !== null) this.openInterview(d.fixtureId);
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
      if (s.finished || !declineInterviewSession(world, s.fixtureId)) continue;
      const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === s.fixtureId);
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
    if (dayOfSeason(world) >= 350) {
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
    this.incomingOffer = null;
    this.coachTalk = null;
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
    while (dayOfSeason(world) >= 350) {
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

  /** Replay the user's most recent completed match through the full engine. */
  reviewLast(): WatchedMatch | null {
    return this.watched;
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

    const { lineup, libero, defensiveLibero, bench } = pickLineup(world.players, club);
    const side = (id: number): MatchSide => {
      const c = world.clubs[id];
      return { clubId: id, nation: -1, name: c?.name ?? '—', shortName: c?.shortName ?? '—', players: c?.players ?? [] };
    };
    this.matchday = {
      fixture: next,
      sides: [side(next.home), side(next.away)],
      title: world.competitions[next.competitionId]?.name ?? 'Match',
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
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
    this.emit();
  }

  /** Swap a starter on the team sheet — before kickoff or at a set break. */
  setMatchdayPlayer(zoneIdx: number, playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage === 'live') return;
    md.homeLineup[zoneIdx] = playerIdx;
    this.emit();
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
    if (md === null || md.stage === 'live') return;
    if (playerIdx === md.homeDefensiveLibero) md.homeDefensiveLibero = md.homeLibero;
    md.homeLibero = playerIdx;
    this.emit();
  }

  /** Name (or with -1, drop) the second libero who plays whenever the team serves. */
  setMatchdayDefensiveLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage === 'live') return;
    if (playerIdx >= 0 && playerIdx === md.homeLibero) {
      if (md.homeDefensiveLibero < 0) return;
      md.homeLibero = md.homeDefensiveLibero;
    }
    md.homeDefensiveLibero = playerIdx;
    this.emit();
  }

  /**
   * Edit the club's saved starting lineup directly — from the Squad screen,
   * any time, not just right before kickoff. `pickLineup` reads this first
   * and only falls back to auto-picking whichever slots it doesn't cover
   * (empty, or a name who's since left or gotten hurt), so this is a genuine
   * default rather than a one-off arrangement that gets thrown away.
   */
  setPreferredLineupSlot(slot: number, playerIdx: number): void {
    const club = this.club;
    if (club === null) return;
    while (club.preferredLineup.length <= slot) club.preferredLineup.push(-1);
    club.preferredLineup[slot] = playerIdx;
    this.emit();
  }

  swapPreferredLineupSlots(slotA: number, slotB: number): void {
    const club = this.club;
    if (club === null) return;
    while (club.preferredLineup.length < 6) club.preferredLineup.push(-1);
    const a = club.preferredLineup[slotA];
    club.preferredLineup[slotA] = club.preferredLineup[slotB];
    club.preferredLineup[slotB] = a;
    this.emit();
  }

  /** Set the default (reception) libero; naming the defensive one swaps the roles. */
  setPreferredLibero(playerIdx: number): void {
    const club = this.club;
    const picked = this.lineup();
    if (club === null || picked === null) return;
    if (playerIdx === picked.defensiveLibero) club.preferredDefensiveLibero = picked.libero;
    club.preferredLibero = playerIdx;
    this.emit();
  }

  /** Name the default defensive libero, or -1 to play one libero throughout. */
  setPreferredDefensiveLibero(playerIdx: number): void {
    const club = this.club;
    const picked = this.lineup();
    if (club === null || picked === null) return;
    if (playerIdx >= 0 && playerIdx === picked.libero) {
      if (picked.defensiveLibero < 0) return;
      club.preferredLibero = picked.defensiveLibero;
    }
    club.preferredDefensiveLibero = playerIdx;
    this.emit();
  }

  /** Clear the saved lineup so every slot goes back to auto-picking the best available player. */
  resetPreferredLineup(): void {
    const club = this.club;
    if (club === null) return;
    club.preferredLineup = [];
    club.preferredLibero = -1;
    club.preferredDefensiveLibero = -1;
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

    // The bench is rebuilt from the final team sheet: anyone swapped out of
    // the six (or out of a libero role) on the lineup screen must still be
    // available to come on, and anyone swapped in must not be listed twice.
    const liberos = new Set([md.homeLibero, md.homeDefensiveLibero].filter((p) => p >= 0));
    md.homeBench = club.players.filter((p) =>
      world.players.isAvailable(p) && !md.homeLineup.includes(p) && !liberos.has(p));
    const userSetup: TeamSetup = {
      clubId: club.id,
      name: club.name,
      lineup: md.homeLineup,
      libero: md.homeLibero,
      defensiveLibero: md.homeDefensiveLibero,
      bench: md.homeBench,
      tactics: club.tactics,
      // A friendly teaches the opposition nothing.
      read: isFriendly(world, md.fixture) ? 0 : oppositionRead(world, club),
    };
    // The other side keeps any promise of games it has made a loanee.
    const homeSetup = md.userIsHome ? userSetup : toTeamSetup(world.players, homeClub, loanStarters(world, homeClub));
    const awaySetup = md.userIsHome ? toTeamSetup(world.players, awayClub, loanStarters(world, awayClub)) : userSetup;

    this.liveSim = new MatchSimulator(world.players, {
      home: homeSetup,
      away: awaySetup,
      format: md.fixture.format,
      importance: md.fixture.importance,
      neutralVenue: md.fixture.neutralVenue,
      collectLog: true,
      seed: world.rng.next(),
      friendly: isFriendly(world, md.fixture),
    });
    this.startLive();
  }

  /** The match under way, from the first serve. */
  private startLive(): void {
    const md = this.matchday;
    if (md === null || this.liveSim === null) return;
    md.stage = 'live';
    md.log = [];
    md.timeoutsUsed = [0, 0];
    // Both cooldowns count rallies in md.log, which starts again from zero.
    this.lastTimeoutAtRally = -Infinity;
    this.lastAISubAtRally = -Infinity;
    md.snapshot = this.liveSim.snapshot();
    this.emit();
  }

  setSpeed(speed: 0.75 | 1 | 1.5): void {
    const md = this.matchday;
    if (md === null) return;
    md.speed = speed;
    this.emit();
  }

  pause(): void {
    const md = this.matchday;
    if (md === null) return;
    md.paused = true;
    md.pauseUntil = null; // a manual pause is indefinite, not a timed stoppage
    this.emit();
  }

  resume(): void {
    const md = this.matchday;
    if (md === null) return;
    md.paused = false;
    md.pauseUntil = null;
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

    const logEntry: MatchdayLogEntry = {
      entry, homeCourt: preSnap.homeCourt, awayCourt: preSnap.awayCourt,
      homeLibero: preSnap.homeLibero, awayLibero: preSnap.awayLibero,
      setsBefore: [preSnap.homeSets, preSnap.awaySets],
    };
    md.log.push(logEntry);
    md.snapshot = sim.snapshot();
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
  ): { ok: boolean; reason?: string } {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return { ok: false };
    const result = sim.substitute(team, outPlayerIdx, inPlayerIdx);
    if (result.ok) {
      md.snapshot = sim.snapshot();
      md.paused = true;
      md.pauseUntil = Date.now() + 3000;
      md.lastSubstitution = { team, outPlayerIdx, inPlayerIdx, seq: ++this.subSeq, reason: why };
    }
    return result;
  }

  /** Bring on a bench player for the user's own side, mid-match. */
  substitute(outPlayerIdx: number, inPlayerIdx: number): void {
    const md = this.matchday;
    // Once a set is won, changes wait for the set break's team sheet.
    if (md === null || md.stage !== 'live' || md.setBreakPending) return;
    const teamIdx = md.userIsHome ? 0 : 1;
    const result = this.performSubstitution(teamIdx, outPlayerIdx, inPlayerIdx);
    if (!result.ok) this.notice = result.reason ?? 'That substitution is not allowed.';
    this.emit();
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
    if (md === null || sim === null) return 5;
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
   * opens the tactics/substitutions window — resumeFromTimeout() ends it.
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
    md.paused = false;
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
    const world = this.world;
    const nation = world === null ? -1 : userNation(world);
    const team = world?.nationalTeams.find((t) => t.nation === nation);
    if (team === undefined) return null;
    team.tactics ??= defaultTactics();
    return team.tactics;
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
    const { lineup, libero, defensiveLibero, bench } = pickLineup(
      world.players,
      {
        players: squad, preferredLineup: [], preferredLibero: -1, preferredDefensiveLibero: -1,
        tactics: this.nationalTactics() ?? undefined,
      },
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
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.incomingOffer = null;
    this.coachTalk = null;
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
    const liberos = new Set([md.homeLibero, md.homeDefensiveLibero].filter((p) => p >= 0));
    md.homeBench = squadOf(t, nation).filter((p) =>
      canPlayForCountry(world, p) && !md.homeLineup.includes(p) && !liberos.has(p));
    const userSetup: TeamSetup = {
      clubId: -1,
      name: nationName(nation),
      lineup: md.homeLineup,
      libero: md.homeLibero,
      defensiveLibero: md.homeDefensiveLibero,
      bench: md.homeBench,
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

  /** The system the user's club plays; its team sheet follows it (see pickLineup). */
  setFormation(formation: Formation): void {
    const club = this.club;
    if (club === null) return;
    club.tactics.formation = formation;
    this.emit();
  }

  /** The system the user's side plays in today's match — a club's or a nation's —
   *  with the six re-picked for it before kickoff. */
  setMatchdayFormation(formation: Formation): void {
    const tactics = this.matchTactics();
    if (this.matchday?.stage !== 'lineup' || tactics === null) return;
    tactics.formation = formation;
    this.repickMatchdaySix();
  }

  /** Pick the six again before kickoff, for the system and team sheet now loaded. */
  private repickMatchdaySix(): void {
    const world = this.world;
    const md = this.matchday;
    const tactics = this.matchTactics();
    if (world === null || md === null || md.stage !== 'lineup' || tactics === null) return;
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

  lineup(): { lineup: number[]; libero: number; defensiveLibero: number; bench: number[] } | null {
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
      message: null,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedCoach = null;
    this.selectedNation = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.coachTalk = null;
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
    const due = submitOffer(world, t, {
      fee: t.agreedFee, wage: n.termsWage, role: n.termsRole, years: n.termsYears,
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
    } else {
      t.result = result;
    }
    this.emit();
  }

  closeCoachTalk(): void {
    this.coachTalk = null;
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
    this.emit();
  }

  /** Reject the offer outright — the buying club walks away for good. */
  declineOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    if (n === null || world === null) return;
    world.incomingOffers = world.incomingOffers.filter((o) => o.id !== n.offerId);
    this.incomingOffer = null;
    this.coachTalk = null;
    this.notice = 'You turned down the offer.';
    this.emit();
  }

  /** Close the offer sheet without deciding — it stays pending and can be reopened later. */
  closeOfferView(): void {
    this.incomingOffer = null;
    this.coachTalk = null;
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

  /** Generate a fresh batch of unattached candidates for a role, to browse and hire. */
  recruitStaffCandidates(role: StaffRole, count = 3): Staff[] {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return [];
    const out: Staff[] = [];
    for (let i = 0; i < count; i++) {
      out.push(generateStaff(world, world.rng, club.nation, role, club.reputation));
    }
    return out;
  }

  hireStaffMember(staffId: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    const s = world.staff[staffId];
    if (s === undefined || s.clubId >= 0) return;
    s.clubId = club.id;
    club.staff.push(s.id);
    this.notice = `${s.firstName} ${s.lastName} has joined as ${STAFF_ROLE_NAMES[s.role]}.`;
    this.emit();
  }

  fireStaffMember(staffId: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    const s = world.staff[staffId];
    if (s === undefined) return;
    club.staff = club.staff.filter((id) => id !== staffId);
    s.clubId = -1;
    this.notice = `${s.firstName} ${s.lastName} has left the club.`;
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

export const PHASE_NAMES: Record<SeasonPhase, string> = {
  [SeasonPhase.PreSeason]: 'Pre-season',
  [SeasonPhase.RegularSeason]: 'Regular season',
  [SeasonPhase.Playoffs]: 'Playoffs',
  [SeasonPhase.NationalTeam]: 'International window',
  [SeasonPhase.OffSeason]: 'Off-season',
};
