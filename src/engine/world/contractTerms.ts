/**
 * A contract's small print, beyond the wage and the length — and the agent
 * who negotiates it.
 *
 * A release clause is a fee any club may pay to take the player: his club
 * cannot refuse it, only the player can. Bonuses are paid for every
 * competitive match he plays and every trophy the club lifts, settled with
 * the season's books. A club option adds one more season on the same terms,
 * at the club's choice, taken up by 1 May of the contract's last season.
 *
 * The small print is the club's own, written in talks with the manager; it
 * holds only while the player stays at that club on that contract — a move, a
 * release or a new deal ends it. Other clubs' contracts have their clauses
 * too: about a third of their players have one, set when they signed.
 *
 * Every player has an agent, one of a dozen or so in his country, each with
 * his own way of doing business: a hard bargainer asks for more — for his
 * client and a bigger fee for himself — has less patience, and pushes his
 * clients towards a move; an easy-going one asks for less.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { bankFor } from './names.ts';
import { NATIONS } from './nations.ts';
import { hash01 } from './offerStance.ts';
import { postMessage } from './inbox.ts';
import { contractEndSeason, DAYS_PER_SEASON, euros, seasonEndDay, seasonEndYear, type World } from './world.ts';

/** The club's own small print on one player's contract. */
export interface ContractExtras {
  /** The club and the contract end it was written for: anything else, and it no longer holds. */
  clubId: number;
  until: number;
  /** A fee any club may pay to take him. */
  releaseClause?: number;
  /** Paid for every competitive match he plays in. */
  appearanceBonus?: number;
  /** Paid for every trophy the club wins. */
  titleBonus?: number;
  /** The club may add one season on the same terms. */
  option?: boolean;
}

/** The small print on a player's current contract, if his club wrote any. */
export function extrasOf(world: World, p: number): ContractExtras | undefined {
  const e = world.contractExtras?.get(p);
  if (e === undefined) return undefined;
  const store = world.players;
  return e.clubId === store.clubId[p] && e.until === store.contractUntil[p] ? e : undefined;
}

/** Write the small print of a contract. Nothing beyond the basics clears it. */
export function setExtras(world: World, p: number, extras: ContractExtras): void {
  const map = (world.contractExtras ??= new Map());
  const any = (extras.releaseClause ?? 0) > 0 || (extras.appearanceBonus ?? 0) > 0 || (extras.titleBonus ?? 0) > 0 || extras.option === true;
  if (any) map.set(p, extras);
  else map.delete(p);
}

/** Small print that no longer holds goes. */
export function pruneExtras(world: World): void {
  const map = world.contractExtras;
  if (map === undefined) return;
  for (const p of [...map.keys()]) if (extrasOf(world, p) === undefined) map.delete(p);
}

/** Share of other clubs' players with a release clause. */
const AI_CLAUSE_SHARE = 0.35;

/** The fee that buys a player out of his contract, if it has one. */
export function releaseClauseOf(world: World, p: number): number | null {
  const store = world.players;
  const club = store.clubId[p];
  if (club < 0 || store.hasFlag(p, PlayerFlag.Youth)) return null;
  if (club === world.userClubId) {
    const c = extrasOf(world, p)?.releaseClause ?? 0;
    return c > 0 ? c : null;
  }
  // Set when he signed: seven to fourteen seasons of his wage — once and a
  // half to three times what he was worth then.
  const id = store.id[p];
  if (hash01(id, 0xc1a) >= AI_CLAUSE_SHARE) return null;
  return Math.max(50_000, Math.round((store.wage[p] * (7 + 7 * hash01(id, 0xc1b))) / 10_000) * 10_000);
}

// ---- Agents ---------------------------------------------------------------------------

export type AgentStyle = 'hardball' | 'fair' | 'easy';

export const AGENT_STYLE_NAMES: Readonly<Record<AgentStyle, string>> = {
  hardball: 'Hard bargainer',
  fair: 'Fair dealer',
  easy: 'Easy-going',
};

export interface Agent {
  id: number;
  name: string;
  agency: string;
  style: AgentStyle;
}

const AGENCIES = [
  'Baseline Sports Group', 'Northpoint Management', 'Crossfield Athletes', 'Summit Sports Agency',
  'Tandem Representation', 'Highline Sports', 'Netside Agency', 'Libra Sports Partners',
  'Atlas Athlete Management', 'Blue Court Sports', 'Meridian Talent', 'Keystone Sports',
  'Apex Volley Management', 'Silverline Agency', 'Cornerstone Athletes', 'Fifth Set Management',
] as const;

/** Agents working in each country. */
const AGENTS_PER_NATION = 12;

/** A player's agent: one of the dozen in his country. */
export function agentOf(world: World, p: number): Agent {
  const store = world.players;
  const nation = store.nation[p];
  const slot = Math.floor(hash01(store.id[p], 0x4a6) * AGENTS_PER_NATION);
  const id = nation * AGENTS_PER_NATION + slot;
  const bank = bankFor(NATIONS[nation]?.nameGroup ?? '');
  const pick = <T,>(xs: readonly T[], k: number): T => xs[Math.floor(hash01(id, k) * xs.length)];
  const s = hash01(id, 0x51);
  return {
    id,
    name: `${pick(bank.first, 0x61)} ${pick(bank.last, 0x62)}`,
    agency: pick(AGENCIES, 0x63),
    style: s < 0.3 ? 'hardball' : s < 0.78 ? 'fair' : 'easy',
  };
}

/** Rejected offers a player sits through with this agent beside him. */
export function agentPatience(style: AgentStyle): number {
  return style === 'hardball' ? 3 : style === 'easy' ? 5 : 4;
}

/** What the agent does to his client's wage demand. */
export function agentWageFactor(style: AgentStyle): number {
  return style === 'hardball' ? 1.04 : style === 'easy' ? 0.97 : 1;
}

/** The agent's own fee on a deal, as a share of a season's wage — half that on a renewal. */
export function agentFeeRate(style: AgentStyle, renewal: boolean): number {
  const rate = style === 'hardball' ? 0.15 : style === 'easy' ? 0.06 : 0.1;
  return renewal ? rate / 2 : rate;
}

/** How hard the agent pushes his client towards a move he would take a cut of. */
export function agentPush(world: World, p: number): number {
  const style = agentOf(world, p).style;
  return style === 'hardball' ? 0.06 : style === 'easy' ? -0.03 : 0;
}

// ---- Bonuses --------------------------------------------------------------------------

/** Pay the appearance bonuses for a competitive match: every player who took part. */
export function payAppearanceBonuses(world: World, clubId: number, played: Iterable<number>): void {
  if (world.contractExtras === undefined || world.contractExtras.size === 0) return;
  const club = world.clubs[clubId];
  if (club === undefined) return;
  for (const p of played) {
    const bonus = extrasOf(world, p)?.appearanceBonus ?? 0;
    if (bonus > 0) club.finances.bonuses = (club.finances.bonuses ?? 0) + bonus;
  }
}

/** A trophy won: every player on a title bonus earns it. */
export function payTitleBonuses(world: World, clubId: number, trophy: string): void {
  if (world.contractExtras === undefined || world.contractExtras.size === 0) return;
  const club = world.clubs[clubId];
  if (club === undefined) return;
  let total = 0;
  let players = 0;
  for (const p of club.players) {
    const bonus = extrasOf(world, p)?.titleBonus ?? 0;
    if (bonus <= 0) continue;
    total += bonus;
    players++;
  }
  if (total === 0) return;
  club.finances.bonuses = (club.finances.bonuses ?? 0) + total;
  if (club.id === world.userClubId) {
    postMessage(world, {
      category: 'finance', from: 'Finance Office',
      subject: `Title bonuses: ${trophy}`,
      body: `The ${trophy} triggers the title bonus in ${players} contract${players === 1 ? '' : 's'}: ${euros(total)}, ` +
        'paid with the season\'s wages.',
    });
  }
}

/** The club's chance of a trophy in a season, as a player weighs a title bonus: its standing among its league rivals. */
export function titleOdds(world: World, club: Club): number {
  const rivals = world.clubs.filter((c) => c.leagueId === club.leagueId && c.players.length > 0);
  const rank = rivals.filter((c) => c.reputation > club.reputation).length;
  return Math.max(0.03, Math.min(0.6, 0.6 * Math.pow(0.62, rank)));
}

// ---- The club's option --------------------------------------------------------------

/** 1 May: the last day an option can be taken up. */
export const OPTION_DEADLINE = 304;

/** Why the club can't take up its option on a player now — or null when it can. */
export function optionBlock(world: World, p: number): string | null {
  const e = extrasOf(world, p);
  if (e === undefined || e.option !== true) return 'There is no option in his contract.';
  if (e.clubId !== world.userClubId) return 'He is not your player.';
  if (contractEndSeason(world.players.contractUntil[p]) !== world.season) return 'The option can only be taken up in the last season of his contract.';
  if (world.day % DAYS_PER_SEASON > OPTION_DEADLINE) return 'The option had to be taken up by 1 May.';
  return null;
}

/** Take up the club's option: one more season, on the same terms. Returns what happened, or why not. */
export function takeUpOption(world: World, p: number): { ok: boolean; text: string } {
  const block = optionBlock(world, p);
  if (block !== null) return { ok: false, text: block };
  const store = world.players;
  const e = extrasOf(world, p)!;
  const until = seasonEndDay(world.season + 1);
  store.contractUntil[p] = until;
  // The same terms — less the option, now spent.
  setExtras(world, p, { ...e, until, option: undefined });
  const name = store.fullName(p);
  // One who wanted to be free to move on takes it badly.
  const restless = store.morale[p] < 45 || world.transferRequests?.[p] !== undefined;
  if (restless) store.morale[p] = Math.max(0, store.morale[p] - 6);
  const text = `The club has taken up the option in ${name}'s contract: he stays on the same terms until 30 June ${seasonEndYear(world, world.season + 1)}.` +
    (restless ? ' He is not pleased — he had hoped to be free to go.' : '');
  postMessage(world, { category: 'contract', from: 'Director of Football', playerIdx: p, subject: `Option taken up: ${name}`, body: text });
  return { ok: true, text };
}
