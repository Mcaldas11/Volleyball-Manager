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
import { NO_CLUB, PlayerFlag } from '../engine/model/players.ts';
import { type Position } from '../engine/model/positions.ts';
import { StaffRole, STAFF_ROLE_NAMES, type Staff } from '../engine/model/staff.ts';
import {
  advanceDay, applyMatchResult, newSeasonContext, pickLineup, toTeamSetup,
  type SeasonContext,
} from '../engine/season/seasonEngine.ts';
import { endSeason, type RolloverReport } from '../engine/season/rollover.ts';
import { startSeason } from '../engine/season/seasonEngine.ts';
import { generateStaff, generateWorld, type WorldScale } from '../engine/world/worldGen.ts';
import {
  currentPhase, dayOfSeason, DAYS_PER_SEASON, SeasonPhase,
  type Fixture, type ManagerProfile, type World,
} from '../engine/world/world.ts';
import {
  completeTransfer, evaluateCounterFee, evaluateFeeOffer, evaluatePersonalTerms,
  resolveIncomingMove, SquadRole,
} from '../engine/world/negotiation.ts';
import { NATIONS } from '../engine/world/nations.ts';
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
  | 'overview' | 'squad' | 'lineup' | 'tactics' | 'rotations' | 'fixtures' | 'table'
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

export interface Negotiation {
  playerIdx: number;
  stage: 'fee' | 'terms';
  /** -1 for a free agent. */
  sellingClubId: number;
  feeOffer: number;
  feeValuation: number | null;
  feeMessage: string | null;
  termsWage: number;
  termsRole: SquadRole;
  termsMessage: string | null;
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
}

function sameNav(a: NavEntry, b: NavEntry): boolean {
  return a.screen === b.screen && a.selectedPlayer === b.selectedPlayer && a.selectedClub === b.selectedClub;
}

/** How many steps back the header's back button remembers. */
const NAV_HISTORY_LIMIT = 50;

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
}

export interface MatchdayState {
  fixture: Fixture;
  stage: 'lineup' | 'live';
  userIsHome: boolean;
  /** The user's side; edited pre-kickoff, regardless of home/away. */
  homeLineup: number[];
  homeLibero: number;
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
  /** The most recent substitution, either side — drives the live "X off, Y on" banner. */
  lastSubstitution: { team: 0 | 1; outPlayerIdx: number; inPlayerIdx: number; seq: number } | null;
}

class Game {
  world: World | null = null;
  ctx: SeasonContext = newSeasonContext();
  screen: ScreenId = 'overview';
  selectedPlayer: number | null = null;
  selectedClub: number | null = null;
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
    this.screen = 'overview';
    this.selectedPlayer = null;
    this.selectedClub = null;
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
      this.screen = 'overview';
      this.selectedPlayer = null;
      this.selectedClub = null;
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

  /** Clubs the user may take over, best first. */
  selectableClubs(limit = 60): Club[] {
    if (this.world === null) return [];
    return [...this.world.clubs]
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, limit);
  }

  takeCharge(clubId: number): void {
    if (this.world === null) return;
    this.world.userClubId = clubId;
    this.screen = 'overview';
    this.resetHistory();
    this.emit();
  }

  get club(): Club | null {
    if (this.world === null || this.world.userClubId < 0) return null;
    return this.world.clubs[this.world.userClubId];
  }

  // ---- Navigation -------------------------------------------------------

  private navEntry(): NavEntry {
    return { screen: this.screen, selectedPlayer: this.selectedPlayer, selectedClub: this.selectedClub };
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
    this.pushHistory({ screen, selectedPlayer: null, selectedClub: null });
    this.screen = screen;
    this.selectedPlayer = null;
    this.selectedClub = null;
    // Navigating away must always work, even mid-negotiation — the deal
    // itself is untouched (it lives in world.incomingOffers), only the
    // full-screen prompt for it closes.
    this.negotiation = null;
    this.incomingOffer = null;
    this.emit();
  }

  select(playerIdx: number | null): void {
    if (playerIdx !== null) this.pushHistory({ screen: this.screen, selectedPlayer: playerIdx, selectedClub: null });
    this.selectedPlayer = playerIdx;
    if (playerIdx !== null) {
      this.selectedClub = null;
      this.incomingOffer = null;
    }
    this.emit();
  }

  selectClub(clubId: number | null): void {
    if (clubId !== null) this.pushHistory({ screen: this.screen, selectedPlayer: null, selectedClub: clubId });
    this.selectedClub = clubId;
    if (clubId !== null) {
      this.selectedPlayer = null;
      this.incomingOffer = null;
    }
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
  markMessageRead(messageId: number): void {
    const world = this.world;
    if (world === null) return;
    const m = world.messages.find((x) => x.id === messageId);
    if (m === undefined || m.read === true) return;
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
    this.pushHistory({ screen: 'scouting', selectedPlayer: null, selectedClub: null });
    this.scoutingFocus = playerIdx;
    this.screen = 'scouting';
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.incomingOffer = null;
    this.emit();
  }

  /** Called by the Scouting screen once it has read scoutingFocus on mount. */
  clearScoutingFocus(): void {
    this.scoutingFocus = null;
  }

  // ---- Time -------------------------------------------------------------

  /**
   * Advance the world, stopping early if one of the user's own matches comes
   * up — the user should never skip past their own fixture by accident.
   */
  advance(days: number, stopAtOwnMatch = true): void {
    const world = this.world;
    if (world === null) return;
    const clubId = world.userClubId;
    const messagesBefore = world.messages.length;

    for (let d = 0; d < days; d++) {
      if (dayOfSeason(world) >= 350) {
        this.rollover();
        continue;
      }
      // `d > 0` used to gate this, which meant a match scheduled for *today*
      // (the very first day of this call) got simulated headlessly instead of
      // stopping for the interactive Matchday screen — exactly the accident
      // this check exists to prevent. Must apply from the first day too.
      if (stopAtOwnMatch && clubId >= 0 && this.fixtureOn(world.day) !== null) break;

      // The user's own matches always run through the full rally engine.
      advanceDay(world, this.ctx, {
        detailedClubs: clubId >= 0 ? new Set([clubId]) : undefined,
      });

      // Keep the most recent of the user's matches available to review.
      const played = this.fixtureOn(world.day - 1);
      if (played !== null && played.played) this.captureWatched(played);
    }
    if (world.messages.length > messagesBefore && this.notice === '') {
      this.notice = 'You have new messages.';
    }
    this.emit();
  }

  /** Advance to the user's next fixture and play it. */
  advanceToNextMatch(): void {
    const world = this.world;
    if (world === null || world.userClubId < 0) return;
    const next = this.nextFixture();
    if (next === null) {
      this.advance(7);
      return;
    }
    const gap = Math.max(1, next.day - world.day + 1);
    this.advance(gap, false);
  }

  private rollover(): void {
    const world = this.world;
    if (world === null) return;
    this.lastRollover = endSeason(world, this.ctx);
    this.notice = `Season ${world.year} complete.`;

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
      return comp === undefined || !comp.hasPlayoffs;
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

    const { lineup, libero, bench } = pickLineup(world.players, club);
    this.matchday = {
      fixture: next,
      stage: 'lineup',
      userIsHome: next.home === club.id,
      homeLineup: lineup,
      homeLibero: libero,
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

  /** Change the libero on the pre-match lineup screen. */
  setMatchdayLibero(playerIdx: number): void {
    const md = this.matchday;
    if (md === null || md.stage !== 'lineup') return;
    md.homeLibero = playerIdx;
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

  setPreferredLibero(playerIdx: number): void {
    const club = this.club;
    if (club === null) return;
    club.preferredLibero = playerIdx;
    this.emit();
  }

  /** Clear the saved lineup so every slot goes back to auto-picking the best available player. */
  resetPreferredLineup(): void {
    const club = this.club;
    if (club === null) return;
    club.preferredLineup = [];
    club.preferredLibero = -1;
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

    const userSetup: TeamSetup = {
      clubId: club.id,
      name: club.name,
      lineup: md.homeLineup,
      libero: md.homeLibero,
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
    };
    md.log.push(logEntry);
    md.snapshot = sim.snapshot();
    // Fresh timeout allowance each set, same as the engine's own substitution limit.
    if (md.snapshot.set !== preSnap.set) md.timeoutsUsed = [0, 0];
    if (md.snapshot.matchOver) {
      this.finalizeMatchday();
    } else {
      this.maybeAIAct();
      this.emit();
    }
    return logEntry;
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
    this.liveSim = null;
    this.matchday = null;
    advanceDay(world, this.ctx, { detailedClubs: new Set([world.userClubId]) });
    this.go('fixtures');
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

  lineup(): { lineup: number[]; libero: number; bench: number[] } | null {
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

  /** Open a negotiation for a player — a fee stage first if they're contracted. */
  startNegotiation(playerIdx: number): void {
    const world = this.world;
    const club = this.club;
    if (world === null || club === null) return;
    if (club.players.length >= 16) {
      this.notice = 'The squad is full — release a player first.';
      this.emit();
      return;
    }
    const store = world.players;
    const sellingClubId = store.clubId[playerIdx];
    this.negotiation = {
      playerIdx,
      stage: sellingClubId >= 0 ? 'fee' : 'terms',
      sellingClubId,
      feeOffer: store.value[playerIdx],
      feeValuation: null,
      feeMessage: null,
      termsWage: store.wage[playerIdx],
      termsRole: SquadRole.Rotation,
      termsMessage: null,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.incomingOffer = null;
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

  submitFeeOffer(): void {
    const n = this.negotiation;
    const world = this.world;
    const club = this.club;
    if (n === null || world === null || club === null || n.sellingClubId < 0) return;
    const sellingClub = world.clubs[n.sellingClubId];
    if (sellingClub === undefined) return;

    const ceiling = Math.min(club.finances.transferBudget, club.finances.balance);
    if (n.feeOffer > ceiling) {
      n.feeMessage = 'That exceeds your transfer budget.';
      this.emit();
      return;
    }

    const result = evaluateFeeOffer(world, sellingClub, n.playerIdx, n.feeOffer);
    n.feeValuation = result.valuation;
    n.feeMessage = result.reason;
    if (result.accepted) n.stage = 'terms';
    this.emit();
  }

  submitTermsOffer(): void {
    const n = this.negotiation;
    const world = this.world;
    const club = this.club;
    if (n === null || world === null || club === null) return;
    const store = world.players;

    let committed = 0;
    for (const p of club.players) committed += store.wage[p];
    if (committed + n.termsWage > club.finances.wageBudget) {
      n.termsMessage = 'Not enough room in the wage budget for that contract.';
      this.emit();
      return;
    }

    const result = evaluatePersonalTerms(world, club, n.playerIdx, n.termsWage, n.termsRole);
    n.termsMessage = result.reason;
    if (result.accepted) {
      const fee = n.sellingClubId >= 0 ? n.feeOffer : 0;
      completeTransfer(world, club, n.playerIdx, n.termsWage, fee);
      this.notice = `${store.fullName(n.playerIdx)} has signed.`;
      this.negotiation = null;
    }
    this.emit();
  }

  cancelNegotiation(): void {
    this.negotiation = null;
    this.emit();
  }

  /** Open a pending incoming offer for review. */
  openOffer(offerId: number): void {
    const world = this.world;
    if (world === null) return;
    const offer = world.incomingOffers.find((o) => o.id === offerId);
    if (offer === undefined) return;
    this.incomingOffer = {
      offerId,
      playerIdx: offer.playerIdx,
      buyingClubId: offer.buyingClubId,
      fee: offer.fee,
      counterFee: offer.fee,
      message: null,
      expiresOnDay: offer.expiresOnDay,
    };
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.negotiation = null;
    this.emit();
  }

  setCounterFee(amount: number): void {
    if (this.incomingOffer === null) return;
    this.incomingOffer.counterFee = amount;
    this.emit();
  }

  /** Agree to the fee as offered; the player then decides for himself. */
  acceptOffer(): void {
    const n = this.incomingOffer;
    if (n === null) return;
    this.resolveIncomingOffer(n.fee);
  }

  /** Ask for more; the buying club can accept, refuse (retry), or hold firm. */
  counterOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    if (n === null || world === null) return;
    const buyingClub = world.clubs[n.buyingClubId];
    if (buyingClub === undefined) return;

    const result = evaluateCounterFee(world, buyingClub, n.playerIdx, n.fee, n.counterFee);
    if (result.accepted) {
      this.resolveIncomingOffer(n.counterFee);
    } else {
      n.message = result.reason;
      this.emit();
    }
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

  /** Once a fee is agreed (accept or successful counter), the player decides. */
  private resolveIncomingOffer(fee: number): void {
    const n = this.incomingOffer;
    const world = this.world;
    if (n === null || world === null) return;
    const buyingClub = world.clubs[n.buyingClubId];
    if (buyingClub === undefined) return;
    const store = world.players;

    const result = resolveIncomingMove(world, buyingClub, n.playerIdx);
    world.incomingOffers = world.incomingOffers.filter((o) => o.id !== n.offerId);

    if (result.accepted) {
      completeTransfer(world, buyingClub, n.playerIdx, result.wage, fee);
      world.messages.push({
        id: world.messages.length,
        day: world.day,
        year: world.year,
        subject: 'Transfer completed',
        body: `${store.fullName(n.playerIdx)} has accepted the move to ${buyingClub.name}.`,
      });
      this.notice = `${store.fullName(n.playerIdx)} has completed a move to ${buyingClub.name}.`;
    } else {
      world.messages.push({
        id: world.messages.length,
        day: world.day,
        year: world.year,
        subject: 'Transfer rejected by player',
        body: `${store.fullName(n.playerIdx)} turned down the move to ${buyingClub.name} — he is staying.`,
      });
      this.notice = `${store.fullName(n.playerIdx)} turned down the move.`;
    }
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
    world.players.contractUntil[playerIdx] = world.day + 2 * DAYS_PER_SEASON;
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

  private calendarDate(day: number): Date | null {
    const world = this.world;
    if (world === null) return null;
    // The save begins on 1 July, so season day 0 is calendar day 181.
    const doy = ((day % DAYS_PER_SEASON) + 181) % 365;
    const date = new Date(Date.UTC(world.year, 0, 1));
    date.setUTCDate(date.getUTCDate() + doy);
    return date;
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
