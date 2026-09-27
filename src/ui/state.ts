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
  MatchSimulator, type MatchResult, type RallyLogEntry, type TeamSetup,
} from '../engine/match/engine.ts';
import type { Club } from '../engine/model/club.ts';
import { matchRating, playedInMatch } from '../engine/match/playerRating.ts';
import { NO_CLUB, PlayerFlag } from '../engine/model/players.ts';
import { type Position } from '../engine/model/positions.ts';
import { StaffRole, STAFF_ROLE_NAMES, type Staff } from '../engine/model/staff.ts';
import {
  advanceDay, applyMatchResult, newSeasonContext, pickLineup, playFixture, toTeamSetup,
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
import {
  acceptIncomingOffer, closeTalks, counterIncomingOffer, openTalks, submitOffer, type Talks,
} from '../engine/world/deals.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { welcomeMessages } from '../engine/world/inbox.ts';
import { entryNotices, isCupFinal } from '../engine/season/cups.ts';
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
  | 'youth' | 'stats' | 'rankings' | 'halloffame';

export type MenuStage = 'main' | 'load' | 'createManager' | 'worldSetup';

export interface WatchedMatch {
  fixture: Fixture;
  result: MatchResult;
  homeName: string;
  awayName: string;
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
  message: string | null;
  expiresOnDay: number;
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
}

function sameNav(a: NavEntry, b: NavEntry): boolean {
  return a.screen === b.screen && a.selectedPlayer === b.selectedPlayer &&
    a.selectedClub === b.selectedClub && a.selectedReview === b.selectedReview &&
    a.selectedCompetition === b.selectedCompetition;
}

/** How many steps back the header's back button remembers. */
const NAV_HISTORY_LIMIT = 50;

/** How long each day stays on screen while Continue runs the calendar on —
 *  long enough to watch the date tick over, short enough that a quiet month
 *  passes in a second or two. */
const DAY_TICK_MS = 45;

/** The furthest a single Continue runs without anything happening. */
const MAX_CONTINUE_DAYS = 62;

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
  stage: 'lineup' | 'live';
  userIsHome: boolean;
  /** The user's side; edited pre-kickoff, regardless of home/away. */
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
   *  `libero` marks a libero change rather than a regular substitution. */
  lastSubstitution: {
    team: 0 | 1;
    outPlayerIdx: number;
    inPlayerIdx: number;
    seq: number;
    libero?: 'reception' | 'defence';
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
  /** The user's match that has just finished: its result stays on screen
   *  until they continue, which brings in the rest of the matchday. */
  postMatch: number | null = null;
  selectedPlayer: number | null = null;
  selectedClub: number | null = null;
  /** Id of the inbox message whose season review is open full-screen, if any. */
  selectedReview: number | null = null;
  /** Competition whose page is open over the current screen, if any. */
  selectedCompetition: number | null = null;
  /** Player the Scouting screen should jump to next time it opens; consumed once. */
  scoutingFocus: number | null = null;
  negotiation: Negotiation | null = null;
  incomingOffer: IncomingOfferReview | null = null;
  /** Fixture id of the press conference currently open full-screen, if any. */
  activeInterviewFixtureId: number | null = null;
  matchday: MatchdayState | null = null;
  private liveSim: MatchSimulator | null = null;
  /** Distinguishes each substitution for React, even if the same two players swap twice. */
  private subSeq = 0;
  /** Index into matchday.log at the last timeout (either side) — a simple anti-spam cooldown for the AI. */
  private lastTimeoutAtRally = -Infinity;
  watched: WatchedMatch | null = null;
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.incomingOffer = null;
    this.matchday = null;
    this.liveSim = null;
    this.pendingManager = null;
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
      const world = await readSaveWorld(id);
      this.world = world;
      this.ctx = newSeasonContext();
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
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.negotiation = null;
      this.incomingOffer = null;
      this.matchday = null;
      this.liveSim = null;
      this.currentSaveId = id;
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
    this.busy = true;
    this.emit();
    try {
      const meta: SaveMeta = {
        id: this.currentSaveId,
        managerName: `${world.manager.firstName} ${world.manager.lastName}`,
        nationCode: NATIONS[world.manager.nation]?.code ?? '???',
        clubName: this.club?.name ?? 'Unemployed',
        clubNationCode: this.club ? NATIONS[this.club.nation].code : '',
        scale: this.currentScale ?? 'standard',
        inGameDate: this.dateLabel(),
        season: world.season,
        createdAt: this.saveCreatedAt ?? Date.now(),
        updatedAt: Date.now(),
        schemaVersion: 1,
      };
      await writeSaveWorld(this.currentSaveId, meta, world);
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

  takeCharge(clubId: number): void {
    if (this.world === null) return;
    this.world.userClubId = clubId;
    welcomeMessages(this.world);
    entryNotices(this.world);
    this.screen = 'home';
    this.resetHistory();
    this.emit();
  }

  get club(): Club | null {
    if (this.world === null || this.world.userClubId < 0) return null;
    return this.world.clubs[this.world.userClubId];
  }

  // ---- Navigation -------------------------------------------------------

  private navEntry(): NavEntry {
    return {
      screen: this.screen,
      selectedPlayer: this.selectedPlayer,
      selectedClub: this.selectedClub,
      selectedReview: this.selectedReview,
      selectedCompetition: this.selectedCompetition,
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
    this.negotiation = null;
    this.incomingOffer = null;
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    // Navigating away must always work, even mid-negotiation — the deal
    // itself is untouched (it lives in world.incomingOffers), only the
    // full-screen prompt for it closes.
    this.negotiation = null;
    this.incomingOffer = null;
    this.emit();
  }

  select(playerIdx: number | null): void {
    if (playerIdx !== null) {
      this.pushHistory({ screen: this.screen, selectedPlayer: playerIdx, selectedClub: null, selectedReview: null, selectedCompetition: null });
    }
    this.selectedPlayer = playerIdx;
    if (playerIdx !== null) {
      this.selectedClub = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
    }
    this.emit();
  }

  selectClub(clubId: number | null): void {
    if (clubId !== null) {
      this.pushHistory({ screen: this.screen, selectedPlayer: null, selectedClub: clubId, selectedReview: null, selectedCompetition: null });
    }
    this.selectedClub = clubId;
    if (clubId !== null) {
      this.selectedPlayer = null;
      this.selectedReview = null;
      this.selectedCompetition = null;
      this.incomingOffer = null;
    }
    this.emit();
  }

  /** Open a competition's page: its groups, bracket and results. */
  openCompetition(compId: number): void {
    this.pushHistory({
      screen: this.screen, selectedPlayer: null, selectedClub: null, selectedReview: null, selectedCompetition: compId,
    });
    this.selectedCompetition = compId;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedReview = null;
    this.negotiation = null;
    this.incomingOffer = null;
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
    this.negotiation = null;
    this.incomingOffer = null;
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.incomingOffer = null;
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
    this.emit();
  }

  /** Called by the Scouting screen once it has read scoutingFocus on mount. */
  clearScoutingFocus(): void {
    this.scoutingFocus = null;
  }

  // ---- Time -------------------------------------------------------------

  /**
   * The big button: run the calendar on, a day at a time, until something
   * happens — news in the inbox, or one of the user's own matches (time never
   * skips past a fixture). New post opens in the Inbox, the way a manager's
   * day starts with the desk. `maxDays` caps a single run.
   */
  async continueGame(maxDays = MAX_CONTINUE_DAYS): Promise<void> {
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

    this.processing = true;
    this.emit();
    const before = world.messages.length;
    for (let d = 0; d < maxDays; d++) {
      this.stepDay();
      this.emit();
      if (this.world !== world) break;
      if (world.messages.length > before || this.ownFixtureToday() !== null || this.trophyCelebration !== null) break;
      await sleep(DAY_TICK_MS);
      if (this.world !== world) break;
    }
    this.processing = false;

    // A season review opened by the rollover keeps the screen; otherwise the
    // first of the new post is waiting in the inbox.
    if (this.world === world && world.messages.length > before && this.selectedReview === null) {
      this.openMessage(world.messages[before].id);
    }
    this.emit();
  }

  /** One day of the world — or, once the season is over, the rollover into the next. */
  private stepDay(): void {
    const world = this.world;
    if (world === null) return;
    if (dayOfSeason(world) >= 350) {
      this.rollover();
      return;
    }
    const clubId = world.userClubId;
    // The user's own matches always run through the full rally engine.
    advanceDay(world, this.ctx, {
      detailedClubs: clubId >= 0 ? new Set([clubId]) : undefined,
    });
    // Keep the most recent of the user's matches available to review.
    const played = this.fixtureOn(world.day - 1);
    if (played !== null && played.played) this.captureWatched(played);
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
    if (world === null || f === null || this.processing) return;
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.incomingOffer = null;
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
    const before = world.messages.length;
    advanceDay(world, this.ctx, { detailedClubs: new Set([world.userClubId]) });
    const fresh = world.messages.slice(before);
    const first = fresh.find((m) => m.roundup !== undefined) ?? fresh[0];
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

  /** Fast-forward to the user's next fixture and open the pre-match lineup screen. */
  openMatchday(): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    const next = this.nextFixture();
    if (next === null) return;
    while (world.day < next.day) {
      advanceDay(world, this.ctx, { detailedClubs: new Set([world.userClubId]) });
    }

    const { lineup, libero, defensiveLibero, bench } = pickLineup(world.players, club);
    this.matchday = {
      fixture: next,
      stage: 'lineup',
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
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.negotiation = null;
    this.incomingOffer = null;
    this.emit();
  }

  /** Swap a starter on the pre-match lineup screen. */
  setMatchdayPlayer(zoneIdx: number, playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return;
    md.homeLineup[zoneIdx] = playerIdx;
    this.emit();
  }

  /** Swap two starting zones' players — dragging one starter onto another on the team sheet. */
  swapMatchdayPlayers(zoneA: number, zoneB: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return;
    const a = md.homeLineup[zoneA];
    md.homeLineup[zoneA] = md.homeLineup[zoneB];
    md.homeLineup[zoneB] = a;
    this.emit();
  }

  /** Change the (reception) libero on the pre-match lineup screen. Naming the
   *  defensive libero swaps the two roles over. */
  setMatchdayLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return;
    if (playerIdx === md.homeDefensiveLibero) md.homeDefensiveLibero = md.homeLibero;
    md.homeLibero = playerIdx;
    this.emit();
  }

  /** Name (or with -1, drop) the second libero who plays whenever the team serves. */
  setMatchdayDefensiveLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return;
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
    };
    const homeSetup = md.userIsHome ? userSetup : toTeamSetup(world.players, homeClub);
    const awaySetup = md.userIsHome ? toTeamSetup(world.players, awayClub) : userSetup;

    this.liveSim = new MatchSimulator(world.players, {
      home: homeSetup,
      away: awaySetup,
      format: md.fixture.format,
      importance: md.fixture.importance,
      neutralVenue: md.fixture.neutralVenue,
      collectLog: true,
      seed: world.rng.next(),
    });
    md.stage = 'live';
    md.log = [];
    md.timeoutsUsed = [0, 0];
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
    if (md === null || sim === null || md.stage !== 'live') return null;

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
    // Fresh timeout allowance each set, same as the engine's own substitution limit.
    if (md.snapshot.set !== preSnap.set) md.timeoutsUsed = [0, 0];
    // The final point is left for the viewer to play out; it calls
    // completeMatchday() once it has been shown.
    if (!md.snapshot.matchOver) this.maybeAIAct();
    this.emit();
    return logEntry;
  }

  /** Close a match whose last point has been played and shown — commits the
   *  result and moves on to the report. A no-op until the match is over. */
  completeMatchday(): void {
    const md = this.matchday;
    if (md === null || this.liveSim === null || md.snapshot?.matchOver !== true) return;
    this.finalizeMatchday();
  }

  /** Skip straight to the result without watching the rest of the match. */
  finishMatchdayNow(): void {
    const md = this.matchday;
    if (md === null || this.liveSim === null) return;
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
  ): { ok: boolean; reason?: string } {
    const md = this.matchday;
    const sim = this.liveSim;
    if (md === null || sim === null) return { ok: false };
    const result = sim.substitute(team, outPlayerIdx, inPlayerIdx);
    if (result.ok) {
      md.snapshot = sim.snapshot();
      md.paused = true;
      md.pauseUntil = Date.now() + 3000;
      md.lastSubstitution = { team, outPlayerIdx, inPlayerIdx, seq: ++this.subSeq };
    }
    return result;
  }

  /** Bring on a bench player for the user's own side, mid-match. */
  substitute(outPlayerIdx: number, inPlayerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'live') return;
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
    if (md === null || md.stage !== 'live' || md.timeoutActive !== null) return;
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
   * A simple heuristic for the AI side's timeouts and substitutions — not
   * real tactical reasoning, just enough that the opponent isn't a
   * fire-and-forget spectator: call a timeout after conceding an unanswered
   * run, and occasionally strengthen a clearly weak matchup off the bench.
   * Deliberately uses Math.random(), not the world's seeded rng — this is
   * real-time UI flavour, not part of the deterministic world simulation.
   */
  private maybeAIAct(): void {
    const md = this.matchday;
    const sim = this.liveSim;
    const world = this.world;
    if (md === null || sim === null || world === null || md.timeoutActive !== null) return;
    const snap = md.snapshot;
    if (snap === null) return;

    const aiTeam: 0 | 1 = md.userIsHome ? 1 : 0;
    const store = world.players;

    const recent = md.log.slice(-3);
    const concededRun = recent.length === 3 && recent.every((l) => l.entry.winner !== aiTeam);
    if (
      concededRun && md.timeoutsUsed[aiTeam] < 2 &&
      md.log.length - this.lastTimeoutAtRally >= 6 && Math.random() < 0.4
    ) {
      this.startTimeout(aiTeam);
      return;
    }

    if (sim.subsRemaining(aiTeam) > 0 && Math.random() < 0.012) {
      const court = aiTeam === 0 ? snap.homeCourt : snap.awayCourt;
      const bench = sim.benchFor(aiTeam);
      let bestOut = -1;
      let bestIn = -1;
      let bestGain = 80; // only a meaningful upgrade is worth using a sub on
      for (const onCourtIdx of court) {
        const pos = store.position[onCourtIdx];
        for (const benchIdx of bench) {
          if (store.position[benchIdx] !== pos) continue;
          const gain = store.currentAbility[benchIdx] - store.currentAbility[onCourtIdx];
          if (gain > bestGain) { bestGain = gain; bestOut = onCourtIdx; bestIn = benchIdx; }
        }
      }
      if (bestOut !== -1) this.performSubstitution(aiTeam, bestOut, bestIn);
    }
  }

  private finalizeMatchday(): void {
    const world = this.world;
    const md = this.matchday;
    const sim = this.liveSim;
    if (world === null || md === null || sim === null) return;

    const result = sim.buildResult();
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

  /** Whether a player can be bought today: players under contract only move
   *  while a transfer window is open; free agents sign at any time. */
  canBuy(playerIdx: number): boolean {
    const world = this.world;
    if (world === null) return false;
    return world.players.clubId[playerIdx] < 0 || transferWindowOn(world.day) !== null;
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
      message: null,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.selectedReview = null;
    this.selectedCompetition = null;
    this.incomingOffer = null;
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
    if (club.players.length >= 16) {
      this.notice = 'The squad is full — release a player first.';
      this.emit();
      return;
    }
    const store = world.players;
    if (!this.canBuy(playerIdx)) {
      this.notice = `The transfer window is closed — it reopens on ${this.dateLabelForDay(nextTransferWindow(world.day).day)}.`;
      this.emit();
      return;
    }
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
    if (world === null || club === null || !club.players.includes(playerIdx)) return;
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
    let committed = 0;
    for (const q of club.players) committed += store.wage[q];
    if (t.kind === 'renewal') committed -= store.wage[p];
    if (committed + n.termsWage > club.finances.wageBudget) {
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
      message: null,
      expiresOnDay: offer.expiresOnDay,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
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

  private reviewedOffer(): IncomingOffer | null {
    const n = this.incomingOffer;
    return n === null ? null : this.world?.incomingOffers.find((o) => o.id === n.offerId) ?? null;
  }

  /** Agree to the fee as offered; the player then takes a few days to decide. */
  acceptOffer(): void {
    const world = this.world;
    const offer = this.reviewedOffer();
    if (world === null || offer === null || (offer.status ?? 'open') !== 'open') return;
    if (transferWindowOn(world.day) === null) {
      world.incomingOffers = world.incomingOffers.filter((o) => o.id !== offer.id);
      this.incomingOffer = null;
      this.notice = 'The transfer window has closed — the offer has lapsed.';
      this.emit();
      return;
    }
    const due = acceptIncomingOffer(world, offer);
    const buyer = world.clubs[offer.buyingClubId];
    this.notice = `${world.players.fullName(offer.playerIdx)} is talking terms with ${buyer?.name ?? 'them'} — ` +
      `he will decide by ${this.dateLabelForDay(due)}.`;
    this.incomingOffer = null;
    this.emit();
  }

  /** Ask for more; the buying club answers in a day or two. */
  counterOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    const offer = this.reviewedOffer();
    if (n === null || world === null || offer === null || (offer.status ?? 'open') !== 'open') return;
    if (n.counterFee <= offer.fee) {
      n.message = 'Ask for more than they have offered — or simply accept.';
      this.emit();
      return;
    }
    const due = counterIncomingOffer(world, offer, n.counterFee);
    const buyer = world.clubs[offer.buyingClubId];
    this.notice = `Asking price sent to ${buyer?.name ?? 'the club'} — they will answer by ${this.dateLabelForDay(due)}.`;
    this.incomingOffer = null;
    this.emit();
  }

  /** Reject the offer outright — the buying club walks away for good. */
  declineOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    if (n === null || world === null) return;
    world.incomingOffers = world.incomingOffers.filter((o) => o.id !== n.offerId);
    this.incomingOffer = null;
    this.notice = 'You turned down the offer.';
    this.emit();
  }

  /** Close the offer sheet without deciding — it stays pending and can be reopened later. */
  closeOfferView(): void {
    this.incomingOffer = null;
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
    if (world === null || club === null) return;
    club.players = club.players.filter((p) => p !== playerIdx);
    world.players.clubId[playerIdx] = -1;
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
