/**
 * Transfer negotiation.
 *
 * Signing a contracted player is a two-step conversation: first a transfer
 * fee with their club, then personal terms — promised squad role and salary —
 * with the player himself. Either side can refuse. Free agents skip straight
 * to personal terms, since there is no club to pay a fee to.
 *
 * The promised role is a negotiation input only; it is not stored anywhere
 * once the deal is done. There is no ongoing "did we honour the promise"
 * mechanic — it exists purely to shape whether the player accepts.
 */

import type { Club } from '../model/club.ts';
import { DAYS_PER_SEASON, type World } from './world.ts';

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

const ROLE_VALUE: Record<SquadRole, number> = {
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

/** Finalize an agreed transfer: move the player, pay the fee, set the new contract. */
export function completeTransfer(
  world: World,
  buyingClub: Club,
  playerIdx: number,
  wage: number,
  fee: number,
): void {
  const store = world.players;
  const oldClubId = store.clubId[playerIdx];
  if (oldClubId >= 0) {
    const oldClub = world.clubs[oldClubId];
    oldClub.players = oldClub.players.filter((p) => p !== playerIdx);
    oldClub.finances.balance += fee;
    buyingClub.finances.balance -= fee;
    buyingClub.finances.transferBudget = Math.max(0, buyingClub.finances.transferBudget - fee);
  }
  buyingClub.players.push(playerIdx);
  store.clubId[playerIdx] = buyingClub.id;
  store.wage[playerIdx] = wage;
  store.contractUntil[playerIdx] = world.day + 2 * DAYS_PER_SEASON;
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
}

export const MAX_PENDING_OFFERS = 2;

/**
 * Occasionally, a rival club bids for one of the user's better players.
 * Called weekly; does nothing most weeks.
 */
export function generateIncomingOffers(world: World): void {
  world.incomingOffers = world.incomingOffers.filter((o) => o.expiresOnDay > world.day);

  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : null;
  if (club === null || club.players.length === 0) return;
  if (world.incomingOffers.length >= MAX_PENDING_OFFERS) return;

  const store = world.players;
  // Bias toward the squad's best players — that is who a bigger club would want.
  const candidates = [...club.players]
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 5);
  const playerIdx = world.rng.pick(candidates);
  const playerLevel = store.currentAbility[playerIdx] / 2000;
  const clubLevel = club.reputation / 10000;

  // Only genuinely appealing players attract interest, and only occasionally.
  const appeal = Math.max(0, playerLevel - clubLevel + 0.05);
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
    id, playerIdx, buyingClubId: buyingClub.id, fee, expiresOnDay: world.day + 14,
  });
  world.messages.push({
    id: world.messages.length,
    day: world.day,
    year: world.year,
    subject: 'Transfer offer received',
    body: `${buyingClub.name} have made an offer for ${store.fullName(playerIdx)}.`,
    offerId: id,
  });
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
