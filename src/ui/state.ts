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
import type { MatchResult } from '../engine/match/engine.ts';
import type { Club } from '../engine/model/club.ts';
import { PlayerFlag } from '../engine/model/players.ts';
import { StaffRole, STAFF_ROLE_NAMES, type Staff } from '../engine/model/staff.ts';
import {
  advanceDay, newSeasonContext, pickLineup, playFixture,
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
  deleteSave as deleteSaveFromDb, listSaves, loadGame as readSaveWorld,
  newSaveId, saveGame as writeSaveWorld, type SaveMeta,
} from './persistence.ts';

export type ScreenId =
  | 'overview' | 'squad' | 'tactics' | 'rotations' | 'fixtures' | 'table'
  | 'transfers' | 'training' | 'finances' | 'staff' | 'scouting'
  | 'youth' | 'stats' | 'rankings' | 'halloffame';

export type MenuStage = 'main' | 'load' | 'createManager' | 'worldSetup';

export interface WatchedMatch {
  fixture: Fixture;
  result: MatchResult;
  homeName: string;
  awayName: string;
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

export interface IncomingOfferReview {
  offerId: number;
  playerIdx: number;
  buyingClubId: number;
  fee: number;
  counterFee: number;
  message: string | null;
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
  watched: WatchedMatch | null = null;
  lastRollover: RolloverReport | null = null;
  busy = false;
  notice = '';

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
    startSeason(world);
    this.world = world;
    this.ctx = newSeasonContext();
    this.watched = null;
    this.lastRollover = null;
    this.notice = '';
    this.screen = 'overview';
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.negotiation = null;
    this.incomingOffer = null;
    this.pendingManager = null;
    this.currentScale = scale;
    this.currentSaveId = newSaveId();
    this.saveCreatedAt = Date.now();
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
      this.notice = '';
      this.screen = 'overview';
      this.selectedPlayer = null;
      this.selectedClub = null;
      this.negotiation = null;
      this.incomingOffer = null;
      this.currentSaveId = id;
      const meta = this.saves.find((s) => s.id === id);
      this.currentScale = meta?.scale ?? null;
      this.saveCreatedAt = meta?.createdAt ?? Date.now();
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
    this.emit();
  }

  get club(): Club | null {
    if (this.world === null || this.world.userClubId < 0) return null;
    return this.world.clubs[this.world.userClubId];
  }

  // ---- Navigation -------------------------------------------------------

  go(screen: ScreenId): void {
    this.screen = screen;
    this.selectedPlayer = null;
    this.selectedClub = null;
    this.emit();
  }

  select(playerIdx: number | null): void {
    this.selectedPlayer = playerIdx;
    if (playerIdx !== null) {
      this.selectedClub = null;
      this.incomingOffer = null;
    }
    this.emit();
  }

  selectClub(clubId: number | null): void {
    this.selectedClub = clubId;
    if (clubId !== null) {
      this.selectedPlayer = null;
      this.incomingOffer = null;
    }
    this.emit();
  }

  /** Jump to the Scouting screen with a specific player already selected. */
  focusScouting(playerIdx: number): void {
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
      if (stopAtOwnMatch && clubId >= 0 && this.fixtureOn(world.day) !== null && d > 0) break;

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
    // Step into the new season.
    while (dayOfSeason(world) >= 350) {
      world.day++;
      if (world.day % DAYS_PER_SEASON === 0) world.year++;
    }
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

  /** Simulate the user's next match immediately, with a full rally log. */
  playNextMatch(): void {
    const world = this.world;
    if (world === null) return;
    const next = this.nextFixture();
    if (next === null) return;
    while (world.day < next.day) {
      advanceDay(world, this.ctx, {
        detailedClubs: new Set([world.userClubId]),
      });
    }
    playFixture(world, this.ctx, next, true);
    this.captureWatched(next);
    advanceDay(world, this.ctx, { detailedClubs: new Set([world.userClubId]) });
    this.emit();
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
   */
  scoutingPool(query: string, limit = 150): number[] {
    const world = this.world;
    const club = this.club;
    if (world === null) return [];
    const store = world.players;
    const q = query.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i)) continue;
      if (club !== null && store.clubId[i] === club.id) continue;
      if (store.hasFlag(i, PlayerFlag.Youth)) continue;
      if (q !== '' && !store.fullName(i).toLowerCase().includes(q)) continue;
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

  /** Walk away from the negotiation entirely. */
  declineOffer(): void {
    const n = this.incomingOffer;
    const world = this.world;
    if (n === null || world === null) return;
    world.incomingOffers = world.incomingOffers.filter((o) => o.id !== n.offerId);
    this.incomingOffer = null;
    this.notice = 'You turned down the offer.';
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
    const world = this.world;
    if (world === null) return '';
    // The save begins on 1 July, so season day 0 is calendar day 181.
    const doy = ((day % DAYS_PER_SEASON) + 181) % 365;
    const date = new Date(Date.UTC(world.year, 0, 1));
    date.setUTCDate(date.getUTCDate() + doy);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
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
