/**
 * Pre-contracts: a free transfer agreed in advance.
 *
 * Once a player is into the last six months of his contract — from 1 January, with his deal
 * ending on 30 June — his club can no longer stop him talking to anyone. A manager can go to
 * him directly: no fee, no talks with his club, just his personal terms (wage, role, years,
 * his agent's cut, the small print). If he agrees, the deal is signed there and then and he
 * joins on a free when his contract runs out, as the summer window opens.
 *
 * Until he signs, his club can still keep him: a loyal player may take the new deal they
 * put in front of him, and that ends the talks. It runs the other way too — other clubs'
 * agents line up summer moves for the manager's own unrenewed players (see agents.ts).
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import type { Talks } from './deals.ts';
import { loanOf, MAX_SQUAD, squadSize, wageRoom } from './loans.ts';
import { pendingMoveOf } from './moves.ts';
import { newsExtension, postNews } from './news.ts';
import { willRetire } from './retirement.ts';
import { contractEndSeason, DAYS_PER_SEASON, seasonEndDay, seasonEndYear, type World } from './world.ts';

/** The day of the season (0 = 1 July) the last six months of a contract begin: 1 January. */
export const PRE_CONTRACT_FROM = 184;
/** Chance per day, while pre-contract talks are open, that his club puts a new deal to him. */
const CLUB_RENEWS_CHANCE = 0.025;

/** Whether a player's contract is into its last six months today. */
export function inFinalSixMonths(world: World, p: number): boolean {
  const store = world.players;
  return contractEndSeason(store.contractUntil[p]) === world.season && world.day % DAYS_PER_SEASON >= PRE_CONTRACT_FROM;
}

/** Players at the club whose contracts run out this season: the places, and the wages, that free up in the summer. */
function leavingInSummer(world: World, club: Club): number[] {
  const store = world.players;
  // A player here on loan goes back to his club in the summer too.
  return club.players.filter((p) => loanOf(world, p)?.loanClubId === club.id
    || (contractEndSeason(store.contractUntil[p]) <= world.season && pendingMoveOf(world, p)?.toClubId !== club.id));
}

/** The squad next season, as it stands: everyone staying, plus everyone agreed to join. */
export function nextSeasonSquad(world: World, club: Club): number {
  return squadSize(world, club) - leavingInSummer(world, club).length;
}

/** The wage room next season: today's, plus what the players leaving in the summer earn. */
export function nextSeasonWageRoom(world: World, club: Club): number {
  return wageRoom(world, club) + leavingInSummer(world, club).reduce((s, p) => s + world.players.wage[p], 0);
}

/**
 * Why the manager can't approach a player for a pre-contract today — null when he can.
 * Free agents sign outright and the manager's own players are renewed, so neither counts.
 */
export function preContractBlock(world: World, p: number): string | null {
  const store = world.players;
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return 'You need a club to sign players.';
  const name = store.fullName(p);
  const owner = store.clubId[p];
  if (!store.isActive(p)) return `${name} has retired.`;
  if (owner < 0) return `${name} is a free agent, sign him outright.`;
  if (owner === club.id) return `${name} is your own player.`;
  if (store.hasFlag(p, PlayerFlag.Youth)) return `${name} is an academy player.`;
  const move = pendingMoveOf(world, p);
  if (move !== undefined) {
    return move.toClubId === club.id ? `${name} has already agreed to join you.` : `${name} has already agreed a move to ${world.clubs[move.toClubId]?.name ?? 'another club'}.`;
  }
  if (loanOf(world, p) !== undefined) return `${name} is on loan, his parent club holds his contract.`;
  const ends = contractEndSeason(store.contractUntil[p]);
  if (ends > world.season) return `His contract runs to 30 June ${seasonEndYear(world, ends)}, only the last six months are open to approaches.`;
  if (world.day % DAYS_PER_SEASON < PRE_CONTRACT_FROM) {
    return `His contract ends on 30 June ${seasonEndYear(world, world.season)}, you can approach him from 1 January.`;
  }
  if (willRetire(world, p)) return `${name} is retiring at the end of the season.`;
  const until = world.talksBlockedUntil.get(p);
  if (until !== undefined && until > world.day) return `${name} is not willing to talk to you right now.`;
  if (nextSeasonSquad(world, club) >= MAX_SQUAD) return 'Your squad for next season is already full.';
  // A player well above the club won't tie his summer to it.
  const ambition = store.getAttr(p, 'ambition') / 20;
  if (ambition >= 0.6 && store.currentAbility[p] / 2000 > club.reputation / 10000 + 0.25) {
    return `${name} is holding out for a bigger club than ${club.name}.`;
  }
  return null;
}

/** Turn freshly opened transfer talks into a pre-contract approach: straight to his terms, no fee. */
export function makePreContract(t: Talks): void {
  t.preContract = true;
  t.stage = 'terms';
  t.agreedFee = 0;
  t.valuation = null;
  t.lastOffer = { ...t.lastOffer, fee: 0 };
}

/** The day a pre-contract signing joins: 1 July, the first day of next season. */
export function preContractJoinDay(world: World): number {
  return (world.season + 1) * DAYS_PER_SEASON;
}

/**
 * His club's last chance, while the talks are open: a loyal player may take the new deal they
 * offer him. Returns whether he did — the talks are then over.
 */
export function clubKeepsHim(world: World, t: Talks): boolean {
  const store = world.players;
  const p = t.playerIdx;
  const club = world.clubs[store.clubId[p]];
  if (club === undefined || !world.rng.chance(CLUB_RENEWS_CHANCE)) return false;
  const loyalty = store.getAttr(p, 'loyalty') / 20;
  if (!world.rng.chance(0.2 + loyalty * 0.5)) return false;
  store.contractUntil[p] = seasonEndDay(world.season + world.rng.int(1, 3));
  store.wage[p] = Math.round((store.wage[p] * world.rng.range(1.05, 1.15)) / 1000) * 1000;
  newsExtension(world, club, p);
  return true;
}

/** The papers hear of a pre-contract: the manager's own, or one of his players lured away. */
export function newsPreContract(world: World, p: number, toClubId: number): void {
  const store = world.players;
  const to = world.clubs[toClubId];
  const from = world.clubs[store.clubId[p]];
  if (to === undefined) return;
  const name = store.fullName(p);
  postNews(world, {
    kind: 'transfer',
    headline: `${name} agrees to join ${to.name} on a free`,
    body: `${name} has signed a pre-contract with ${to.name}${from !== undefined ? `, and will leave ${from.name}` : ''} ` +
      `when his contract runs out on 30 June ${seasonEndYear(world, world.season)}. No fee will be paid.`,
    nation: to.nation,
    clubId: to.id,
    otherClubId: from?.id,
    playerIdx: p,
    fans: { story: 'signing', club: to.id, other: from?.id, player: p, fee: 0 },
  });
}
