/**
 * Transfer and contract negotiation.
 *
 * Signing a contracted player is a two-step conversation: first a transfer
 * fee with their club, then personal terms — salary, promised squad role and
 * how long the contract runs — with the player himself. Free agents skip
 * straight to personal terms, since there is no club to pay a fee to, and a
 * renewal is personal terms alone.
 *
 * The player comes to the table with demands. An offer close to them draws a
 * counter-proposal, and he gives a little ground; one far off costs more of
 * his patience; run out of patience and he walks away from the talks.
 *
 * The promised role is a negotiation input only; it is not stored anywhere
 * once the deal is done. There is no ongoing "did we honour the promise"
 * mechanic — it exists purely to shape whether the player accepts.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { endLoan, loanOf, MAX_SQUAD, type LoanPlayingTime } from './loans.ts';
import { pendingMoveOf } from './moves.ts';
import {
  contractEndSeason, dayOfYear, euros, logTransfer, seasonEndDay, windowCloseDay, type World,
} from './world.ts';

export enum SquadRole {
  Star = 0,
  Regular = 1,
  Rotation = 2,
  Backup = 3,
}

export const SQUAD_ROLE_NAMES: Record<SquadRole, string> = {
  [SquadRole.Star]: 'Star player',
  [SquadRole.Regular]: 'First-team regular',
  [SquadRole.Rotation]: 'Rotation player',
  [SquadRole.Backup]: 'Squad backup',
};

export const ROLE_VALUE: Record<SquadRole, number> = {
  [SquadRole.Star]: 1.0,
  [SquadRole.Regular]: 0.7,
  [SquadRole.Rotation]: 0.45,
  [SquadRole.Backup]: 0.2,
};

export interface FeeResult {
  accepted: boolean;
  reason: string;
  valuation: number;
}

/** Does the selling club accept this transfer fee? */
export function evaluateFeeOffer(
  world: World,
  sellingClub: Club,
  playerIdx: number,
  offer: number,
): FeeResult {
  const store = world.players;
  const playerLevel = store.currentAbility[playerIdx] / 2000;
  const clubLevel = sellingClub.reputation / 10000;
  // A club demands a premium to sell someone who outclasses its own level —
  // losing an overperformer is harder to replace than a like-for-like sale.
  const premium = 1 + Math.max(0, playerLevel - clubLevel) * 1.6;
  const valuation = Math.round(store.value[playerIdx] * premium);
  const ratio = offer / valuation;

  if (ratio < 0.7) {
    return { accepted: false, reason: 'That offer is well below their valuation.', valuation };
  }
  const accepted = ratio >= 1 || world.rng.chance(Math.min(0.92, (ratio - 0.7) / 0.3));
  return {
    accepted,
    reason: accepted ? 'The club accepts the fee.' : 'They feel they can get more elsewhere.',
    valuation,
  };
}

export interface TermsResult {
  accepted: boolean;
  reason: string;
}

/** Does the player accept these personal terms? */
export function evaluatePersonalTerms(
  world: World,
  buyingClub: Club,
  playerIdx: number,
  wage: number,
  role: SquadRole,
): TermsResult {
  const store = world.players;
  const ambition = store.getAttr(playerIdx, 'ambition') / 20;
  const loyalty = store.getAttr(playerIdx, 'loyalty') / 20;
  const currentClub = store.clubId[playerIdx] >= 0 ? world.clubs[store.clubId[playerIdx]] : null;
  const buyingLevel = buyingClub.reputation / 10000;
  const currentLevel = currentClub !== null ? currentClub.reputation / 10000 : buyingLevel;
  const stepUp = buyingLevel - currentLevel; // positive = a bigger club than their current one

  // A move to a smaller club needs a real pay rise to compensate; a move to a
  // bigger one buys goodwill even a little below full market wage.
  const expectedWage = store.wage[playerIdx] * (1 - Math.max(-0.4, Math.min(0.4, stepUp)) * 0.5);
  const wageRatio = wage / Math.max(4000, expectedWage);

  // Ambition raises the role a player expects; a step up in club size buys
  // patience for a lesser one.
  const expectedRole = 0.3 + ambition * 0.6 - Math.max(0, stepUp) * 0.35;
  const roleGap = ROLE_VALUE[role] - expectedRole;

  if (wageRatio < 0.8) return { accepted: false, reason: 'Wants a bigger salary.' };
  if (roleGap < -0.3) return { accepted: false, reason: 'Wants more first-team assurances.' };

  const score = (wageRatio - 1) * 0.5 + roleGap * 0.5 + Math.max(0, stepUp) * 0.4 + (loyalty - 0.5) * 0.1;
  const accepted = score > 0 || world.rng.chance(Math.max(0.08, 0.55 + score));
  return { accepted, reason: accepted ? 'Accepts the terms.' : 'Is not convinced by this offer.' };
}

/** Pay a transfer fee from the buying club to the selling one. */
export function payFee(world: World, buyingClub: Club, sellingClubId: number, fee: number): void {
  const seller = world.clubs[sellingClubId];
  if (seller === undefined || fee === 0) return;
  seller.finances.balance += fee;
  buyingClub.finances.balance -= fee;
  buyingClub.finances.transferBudget = Math.max(0, buyingClub.finances.transferBudget - fee);
}

/** Finalize an agreed transfer: move the player, pay the fee, set the new
 *  contract — to 30 June of `contractEnd`'s season, two seasons if unsaid.
 *  `paid` when the fee changed hands already, on a deal done while the
 *  window was shut; `logSeason` is the season the move counts towards. */
export function completeTransfer(
  world: World,
  buyingClub: Club,
  playerIdx: number,
  wage: number,
  fee: number,
  contractEnd = seasonEndDay(world.season + 1),
  { paid = false, logSeason = world.season }: { paid?: boolean; logSeason?: number } = {},
): void {
  const store = world.players;
  // A player out on loan is sold by the club that owns him, so he goes back there first.
  const loan = loanOf(world, playerIdx);
  if (loan !== undefined) endLoan(world, loan);
  store.setFlag(playerIdx, PlayerFlag.Transferable, false);
  store.setFlag(playerIdx, PlayerFlag.LoanListed, false);
  const oldClubId = store.clubId[playerIdx];
  logTransfer(world, playerIdx, oldClubId, buyingClub.id, oldClubId >= 0 || paid ? fee : 0, logSeason);
  if (oldClubId >= 0) {
    const oldClub = world.clubs[oldClubId];
    oldClub.players = oldClub.players.filter((p) => p !== playerIdx);
    if (!paid) payFee(world, buyingClub, oldClubId, fee);
  }
  buyingClub.players.push(playerIdx);
  store.clubId[playerIdx] = buyingClub.id;
  store.wage[playerIdx] = wage;
  store.contractUntil[playerIdx] = contractEnd;
}

// ---- Contract terms --------------------------------------------------------

/** What a player asks for to sign, or to re-sign: his pay, the role he
 *  expects, and how long he is willing to commit. */
export interface ContractDemands {
  wage: number;
  role: SquadRole;
  /** Shortest and longest deal he will sign, in seasons counted from this one. */
  minYears: number;
  maxYears: number;
  /** The least he will come down to, however long the talks go on. */
  floorWage: number;
}

export interface ContractOffer {
  wage: number;
  role: SquadRole;
  /** Seasons the contract runs, counting this one — it ends on 30 June. */
  years: number;
}

/** Rounds of rejected offers a player sits through before he walks out. */
export const TALKS_PATIENCE = 4;

/** Days a player refuses to talk again after walking out. */
export const TALKS_COOLDOWN_DAYS = 14;

/** Longest contract anyone signs, in seasons. */
export const MAX_CONTRACT_YEARS = 5;

/** The role a player expects at a club: where his ability would rank in its squad. */
function expectedRole(world: World, club: Club, playerIdx: number): SquadRole {
  const store = world.players;
  const ca = store.currentAbility[playerIdx];
  const better = club.players.filter((p) => p !== playerIdx && store.currentAbility[p] > ca).length;
  if (better <= 1) return SquadRole.Star;
  if (better <= 6) return SquadRole.Regular;
  if (better <= 10) return SquadRole.Rotation;
  return SquadRole.Backup;
}

/** Seasons left on a player's current contract, counting this one. */
export function yearsLeft(world: World, playerIdx: number): number {
  return Math.max(1, contractEndSeason(world.players.contractUntil[playerIdx]) - world.season + 1);
}

/**
 * What a player wants to join `club` — or, for a renewal, to stay. Wages are
 * anchored on what he earns and what his value says he is worth; ambition
 * pushes them up, loyalty (to stay) brings them down, and a move down in
 * club size has to be paid for.
 */
export function contractDemands(world: World, club: Club, playerIdx: number, renewal: boolean): ContractDemands {
  const store = world.players;
  const ambition = store.getAttr(playerIdx, 'ambition') / 20;
  const loyalty = store.getAttr(playerIdx, 'loyalty') / 20;
  const age = store.ageOn(playerIdx, world.year, dayOfYear(world));
  const marketWage = Math.round(store.value[playerIdx] * 0.22);
  const current = store.wage[playerIdx];
  const playerLevel = store.currentAbility[playerIdx] / 2000;
  const clubLevel = club.reputation / 10000;
  const unhappy = store.morale[playerIdx] < 40;

  let wage: number;
  if (renewal) {
    // Staying put: what he earns, or what he is now worth if he has outgrown
    // it. A veteran will take a cut to stay.
    const base = age >= 31 ? Math.max(marketWage, current * 0.85) : Math.max(marketWage, current);
    wage = base * (1.03 + ambition * 0.1 - loyalty * 0.08 + (unhappy ? 0.1 : 0));
  } else {
    const currentClub = store.clubId[playerIdx] >= 0 ? world.clubs[store.clubId[playerIdx]] : undefined;
    const stepUp = clubLevel - (currentClub !== undefined ? currentClub.reputation / 10000 : clubLevel);
    // A move to a smaller club needs a real pay rise; a bigger one buys goodwill.
    wage = Math.max(marketWage, current) * (1 - Math.max(-0.4, Math.min(0.4, stepUp)) * 0.5) * (1.04 + ambition * 0.08);
  }
  wage = Math.max(4000, Math.round((wage * world.rng.range(0.96, 1.06)) / 1000) * 1000);

  // Veterans want security; an ambitious youngster at a club beneath him —
  // or anyone unhappy — won't be tied down for long.
  let minYears = age >= 29 ? 2 : 1;
  const restless = (age <= 26 && ambition > 0.6 && playerLevel > clubLevel + 0.05) || (renewal && unhappy);
  let maxYears = restless ? 2 : MAX_CONTRACT_YEARS;
  // A new deal has to run past the one he already has.
  if (renewal) minYears = Math.max(minYears, yearsLeft(world, playerIdx) + 1);
  maxYears = Math.max(minYears, maxYears);

  return {
    wage,
    role: expectedRole(world, club, playerIdx),
    minYears,
    maxYears,
    floorWage: Math.round((wage * 0.9) / 1000) * 1000,
  };
}

/** Whether a player will even discuss a new deal — an ambitious one who has
 *  outgrown the club would rather see out his contract and move on. */
export function refusesToRenew(world: World, club: Club, playerIdx: number): boolean {
  const store = world.players;
  const ambition = store.getAttr(playerIdx, 'ambition') / 20;
  return ambition >= 0.75 && store.currentAbility[playerIdx] / 2000 > club.reputation / 10000 + 0.22;
}

export type OfferOutcome = 'accepted' | 'counter' | 'walkout';

export interface OfferResponse {
  outcome: OfferOutcome;
  /** How far off a refused offer was: a near miss, or nowhere near. */
  gap: 'close' | 'far' | null;
  /** His position after this round — he gives a little ground on a near miss. */
  demands: ContractDemands;
  patience: number;
}

/** The player's answer to an offer of terms. */
export function respondToOffer(demands: ContractDemands, offer: ContractOffer, patience: number): OfferResponse {
  const wageGap = offer.wage / demands.wage - 1;
  // A smaller role than he expects is a real cost; a bigger one than he
  // expects is worth something, but not as much.
  const roleGap = ROLE_VALUE[offer.role] - ROLE_VALUE[demands.role];
  const roleTerm = roleGap > 0 ? roleGap * 0.15 : roleGap * 0.3;
  const yearsGap = offer.years < demands.minYears
    ? demands.minYears - offer.years
    : offer.years > demands.maxYears ? offer.years - demands.maxYears : 0;
  const score = wageGap + roleTerm - yearsGap * 0.12;
  if (score >= -0.015) return { outcome: 'accepted', gap: null, demands, patience };

  const far = score < -0.2;
  const left = patience - (far ? 2 : 1);
  if (left <= 0) return { outcome: 'walkout', gap: far ? 'far' : 'close', demands, patience: 0 };

  // On a near miss he meets you part of the way on money.
  const next: ContractDemands = { ...demands };
  if (!far && offer.wage < demands.wage) {
    const give = Math.round((demands.wage - (demands.wage - offer.wage) * 0.35) / 1000) * 1000;
    next.wage = Math.max(demands.floorWage, give);
  }
  return { outcome: 'counter', gap: far ? 'far' : 'close', demands: next, patience: left };
}

// ---- Incoming offers -------------------------------------------------------

/** An AI club's unsolicited bid for one of the user's own players. */
export interface IncomingOffer {
  id: number;
  playerIdx: number;
  buyingClubId: number;
  fee: number;
  /** Absolute world.day this offer expires if never acted on. */
  expiresOnDay: number;
  /** Where the deal stands: an open bid; your asking price awaiting their
   *  answer; or agreed, with the player deciding. Absent on older saves = open. */
  status?: 'open' | 'countered' | 'accepted';
  /** Your asking price, while it is with them. */
  counterFee?: number;
  /** The day the pending answer comes back. */
  resolvesOn?: number;
  /** Set when they want him on loan to the end of the season rather than to
   *  buy him: the share of his wage they would pay, and the playing time they
   *  promise him (absent on offers made before it was part of the deal). `fee` is then 0. */
  loan?: { wageShare: number; playingTime?: LoanPlayingTime };
  /** Loan offers: the terms you asked for, while they are with them. */
  counterLoan?: { wageShare: number; playingTime: LoanPlayingTime };
}

export const MAX_PENDING_OFFERS = 2;

/**
 * Occasionally, a rival club bids for one of the user's better players.
 * Called weekly; does nothing most weeks.
 */
export function generateIncomingOffers(world: World): void {
  // Bids never acted on lapse; ones already in motion are seen through.
  world.incomingOffers = world.incomingOffers.filter((o) => (o.status ?? 'open') !== 'open' || o.expiresOnDay > world.day);
  // Unsolicited bids only come in while a transfer window is open; one agreed
  // after it shuts is completed when the next one opens.
  if (windowCloseDay(world.day) === null) return;

  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : null;
  if (club === null || club.players.length === 0) return;
  // Bids drawn by the transfer and loan lists don't crowd out unsolicited ones.
  if (world.incomingOffers.filter((o) => o.loan === undefined).length >= MAX_PENDING_OFFERS) return;

  const store = world.players;
  // Bias toward the squad's best players — that is who a bigger club would
  // want. Anyone only here on loan belongs to another club, which sells him.
  const candidates = club.players
    .filter((p) => loanOf(world, p) === undefined && pendingMoveOf(world, p) === undefined)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 5);
  if (candidates.length === 0) return;
  const playerIdx = world.rng.pick(candidates);
  const playerLevel = store.currentAbility[playerIdx] / 2000;

  // Interest is driven by standing out from your own squad, not by your
  // club's reputation — reputation compounds much faster than ability ever
  // can (a title alone lifts it 3.5%), so a successful club's reputation
  // routinely outruns what its players are actually worth. Comparing the two
  // directly made good, well-run clubs receive almost no offers at all.
  const squadLevel =
    club.players.reduce((sum, p) => sum + store.currentAbility[p], 0) / club.players.length / 2000;

  // Only genuinely appealing players attract interest, and only occasionally.
  const appeal = Math.max(0, playerLevel - squadLevel + 0.05);
  if (!world.rng.chance(Math.min(0.35, appeal * 1.8 + 0.02))) return;

  const suitors = world.clubs.filter(
    (c) => c.id !== club.id && c.reputation / 10000 >= playerLevel - 0.15,
  );
  if (suitors.length === 0) return;
  const buyingClub = world.rng.pick(suitors);
  const fee = Math.round(store.value[playerIdx] * world.rng.range(0.65, 1.05));
  if (fee > buyingClub.finances.transferBudget || fee > buyingClub.finances.balance) return;

  const id = world.nextOfferId++;
  world.incomingOffers.push({
    id, playerIdx, buyingClubId: buyingClub.id, fee, expiresOnDay: world.day + 14, status: 'open',
  });
  world.messages.push({
    id: world.messages.length,
    day: world.day,
    year: world.year,
    subject: `Transfer offer: ${euros(fee)} for ${store.fullName(playerIdx)}`,
    body: `${buyingClub.name} have tabled a formal offer of ${euros(fee)} for ${store.fullName(playerIdx)}. ` +
      'Accept it, ask for more, or turn it down.',
    offerId: id,
    playerIdx,
    from: buyingClub.name,
    clubId: buyingClub.id,
    category: 'offer',
  });
}

/** Chance each week, while a window is open, that a transfer-listed player draws a bid. */
const LISTED_BID_CHANCE = 0.45;
/** Most bids a transfer-listed player can draw at once. */
const MAX_LISTED_BIDS = 2;

/**
 * The user's transfer-listed players draw bids: the club has said he can go,
 * so interest doesn't depend on him outshining the squad, a wider range of
 * clubs come in, and they pitch below his value, expecting a deal. Called
 * weekly, all year: a sale agreed while the window is shut completes when it
 * opens.
 */
export function generateListedBids(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const store = world.players;

  for (const p of club.players) {
    if (!store.hasFlag(p, PlayerFlag.Transferable) || loanOf(world, p) !== undefined) continue;
    if (pendingMoveOf(world, p) !== undefined) continue;
    const bids = world.incomingOffers.filter((o) => o.playerIdx === p && o.loan === undefined);
    if (bids.length >= MAX_LISTED_BIDS || !world.rng.chance(LISTED_BID_CHANCE)) continue;

    const level = store.currentAbility[p] / 2000;
    const suitors = world.clubs.filter((c) =>
      c.id !== club.id && c.players.length > 0 && c.players.length < MAX_SQUAD &&
      c.reputation / 10000 >= level - 0.25 && !bids.some((o) => o.buyingClubId === c.id));
    if (suitors.length === 0) continue;
    const buyer = world.rng.pick(suitors);
    const fee = Math.round((store.value[p] * world.rng.range(0.7, 1.0)) / 1000) * 1000;
    if (fee > buyer.finances.transferBudget || fee > buyer.finances.balance) continue;

    const id = world.nextOfferId++;
    world.incomingOffers.push({
      id, playerIdx: p, buyingClubId: buyer.id, fee, expiresOnDay: world.day + 14, status: 'open',
    });
    world.messages.push({
      id: world.messages.length,
      day: world.day,
      year: world.year,
      subject: `Bid for ${store.fullName(p)}: ${euros(fee)}`,
      body: `${buyer.name} have seen ${store.fullName(p)} on the transfer list and bid ${euros(fee)} for him. ` +
        'Accept it, ask for more, or turn it down.',
      offerId: id,
      playerIdx: p,
      from: buyer.name,
      clubId: buyer.id,
      category: 'offer',
    });
  }
}

/** Will the buying club pay more than their original offer? */
export function evaluateCounterFee(
  world: World,
  buyingClub: Club,
  playerIdx: number,
  originalOffer: number,
  counterFee: number,
): FeeResult {
  const store = world.players;
  const playerLevel = store.currentAbility[playerIdx] / 2000;
  const clubLevel = buyingClub.reputation / 10000;
  // A club stretches further for a player who would be a clear upgrade.
  const stretch = 1.15 + Math.max(0, playerLevel - clubLevel) * 0.6;
  const ceiling = Math.min(
    Math.round(originalOffer * stretch),
    buyingClub.finances.transferBudget,
    buyingClub.finances.balance,
  );
  const ratio = counterFee / Math.max(1, ceiling);

  if (ratio > 1.15) return { accepted: false, reason: 'That is too rich for them.', valuation: ceiling };
  const accepted = ratio <= 1 || world.rng.chance(Math.max(0.05, 1.3 - ratio));
  return {
    accepted,
    reason: accepted ? 'They agree to the higher fee.' : 'They will not go that high.',
    valuation: ceiling,
  };
}

/** Once a fee is agreed, does the player himself want to make the move? */
export function resolveIncomingMove(
  world: World,
  buyingClub: Club,
  playerIdx: number,
): TermsResult & { wage: number } {
  const store = world.players;
  const playerLevel = store.currentAbility[playerIdx] / 2000;
  const clubLevel = buyingClub.reputation / 10000;
  const role = playerLevel > clubLevel + 0.1 ? SquadRole.Star : SquadRole.Regular;
  const wage = Math.round(store.wage[playerIdx] * world.rng.range(1.0, 1.3));
  return { ...evaluatePersonalTerms(world, buyingClub, playerIdx, wage, role), wage };
}
