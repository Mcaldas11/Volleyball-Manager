/**
 * Agents at work. Every player's agent (see contractTerms.ts) has a personality — how hard he
 * bargains, what he takes for himself, whether he insists on a way out written into his client's
 * contract, and how far his contacts reach — and he does business of his own:
 *
 * - he offers his clients to the manager: a free agent, or one whose contract is running out or
 *   who wants out, who would fill a gap in the squad;
 * - he takes the manager's own players elsewhere: one whose contract runs out in June and hasn't
 *   been renewed, he lines up with another club — renew him by the summer, or he signs for them.
 */

import { PlayerFlag } from '../model/players.ts';
import { MAX_SQUAD, POSITION_NAMES, type Position } from '../model/positions.ts';
import { agentFeeRate, agentOf, type AgentStyle } from './contractTerms.ts';
import { directorTaskFor } from './director.ts';
import { postMessage } from './inbox.ts';
import { loanOf, wageRoom } from './loans.ts';
import { completeTransfer } from './negotiation.ts';
import { hash01 } from './offerStance.ts';
import { willRetire } from './retirement.ts';
import { squadPlan } from './squadPlanner.ts';
import { contractEndSeason, DAYS_PER_SEASON, euros, seasonEndDay, seasonEndYear, type World } from './world.ts';

/** What the manager needs to know about an agent before he deals with him. */
export interface AgentProfile {
  name: string;
  agency: string;
  style: AgentStyle;
  /** His cut of a new deal, and of a renewal, as a share of a season's wage. */
  commission: number;
  renewalCommission: number;
  /** He has his clients ask for a release clause. */
  wantsClauses: boolean;
  /** How far his contacts reach: his own country, or clubs everywhere. */
  network: 'local' | 'international';
  /** How likely he is to take a client elsewhere when his contract is running out. */
  poaching: 'often' | 'sometimes' | 'rarely';
}

export function agentProfile(world: World, p: number): AgentProfile {
  const a = agentOf(world, p);
  return {
    name: a.name,
    agency: a.agency,
    style: a.style,
    commission: agentFeeRate(a.style, false),
    renewalCommission: agentFeeRate(a.style, true),
    wantsClauses: a.style === 'hardball',
    network: hash01(a.id, 0x71) < 0.4 ? 'international' : 'local',
    poaching: a.style === 'hardball' ? 'often' : a.style === 'fair' ? 'sometimes' : 'rarely',
  };
}

/** A pre-contract an agent has lined up for one of the manager's players: he joins this club in July. */
export interface PreContract {
  clubId: number;
  wage: number;
  day: number;
  season: number;
}

const POACH_CHANCE: Readonly<Record<AgentStyle, number>> = { hardball: 0.6, fair: 0.35, easy: 0.12 };
/** The days of the season agents line their clients' summer moves up: February and April. */
const POACH_DAYS = [215, 274];
/** The days of the season agents ring round offering clients: the 10th of every month. */
const PITCH_EVERY = 30;
const PITCH_OFFSET = 10;

/** Each day: whatever the agents have on today. */
export function agentsDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const d = world.day % DAYS_PER_SEASON;
  if (d % PITCH_EVERY === PITCH_OFFSET) agentPitch(world);
  if (POACH_DAYS.includes(d)) agentPoaching(world);
}

/** An agent rings with a client to offer: someone who would fill a gap in the squad. */
export function agentPitch(world: World): number | null {
  const club = world.clubs[world.userClubId];
  if (club === undefined) return null;
  const store = world.players;
  const plan = squadPlan(world, club);
  // The positions the squad is short of, now or next season.
  const wanted = new Set<number>();
  for (const row of plan.cells) if (row[0].gaps > 0 || row[1].gaps > 0) wanted.add(row[0].position);
  if (wanted.size === 0) return null;
  const seniors = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
  const level = seniors.map((p) => store.currentAbility[p]).sort((a, b) => a - b)[Math.floor(seniors.length / 2)] ?? 0;
  const room = Math.max(0, wageRoom(world, club));
  const pitched = (world.agentPitches ??= {});
  const candidates: number[] = [];
  for (let p = 0; p < store.count; p++) {
    if (!store.isActive(p) || store.hasFlag(p, PlayerFlag.Youth) || store.clubId[p] === club.id) continue;
    if (!wanted.has(store.position[p]) || store.currentAbility[p] < level * 0.85) continue;
    if ((pitched[p] ?? -1e9) > world.day - 120) continue;
    const free = store.clubId[p] < 0;
    const leaving = !free && (contractEndSeason(store.contractUntil[p]) <= world.season
      || store.hasFlag(p, PlayerFlag.Transferable) || store.morale[p] < 40);
    if (!free && !leaving) continue;
    if (store.wage[p] > room * 1.3 + 20_000) continue;
    candidates.push(p);
  }
  if (candidates.length === 0) return null;
  const p = candidates.sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[Math.floor(hash01(world.day, club.id) * Math.min(3, candidates.length))];
  pitched[p] = world.day;
  const prof = agentProfile(world, p);
  const where = store.clubId[p] < 0 ? 'He is a free agent: no fee.'
    : contractEndSeason(store.contractUntil[p]) <= world.season
      ? `His contract at ${world.clubs[store.clubId[p]]?.name} runs out on 30 June ${seasonEndYear(world, world.season)} — his club would take a small fee now, or he comes for nothing in the summer.`
      : `He wants out of ${world.clubs[store.clubId[p]]?.name}, and they would listen to offers.`;
  const temper = prof.style === 'hardball' ? 'I won\'t pretend he comes cheap.' : prof.style === 'easy' ? 'We are not looking to hold anyone to ransom.' : 'We can find terms that work for everyone.';
  postMessage(world, {
    category: 'offer', from: `${prof.name}, ${prof.agency}`,
    subject: `Agent offers you ${store.fullName(p)}`,
    body: `I represent ${store.fullName(p)}, a ${POSITION_NAMES[store.position[p] as Position].toLowerCase()} of ${store.ageOn(p, world.year, 181)}. ` +
      `I hear ${club.name} could use one. ${where} He would want around ${euros(Math.round(store.wage[p] * 1.1 / 1000) * 1000)} a season. ${temper} ` +
      `(My fee: ${Math.round(prof.commission * 100)}% of a season's wage.)`,
    playerIdx: p,
  });
  return p;
}

/** Agents line up summer moves for the manager's players whose contracts are running out. */
export function agentPoaching(world: World): number[] {
  const club = world.clubs[world.userClubId];
  if (club === undefined) return [];
  const store = world.players;
  const pre = (world.preContracts ??= {});
  const taken: number[] = [];
  for (const p of club.players) {
    if (store.hasFlag(p, PlayerFlag.Youth) || loanOf(world, p) !== undefined) continue;
    if (contractEndSeason(store.contractUntil[p]) !== world.season || pre[p]?.season === world.season) continue;
    if (store.ageOn(p, world.year, 181) >= 33 || willRetire(world, p)) continue;
    if (directorTaskFor(world, p) !== undefined || world.talks.some((t) => t.playerIdx === p)) continue;
    const prof = agentProfile(world, p);
    if (hash01(store.id[p] + world.day, 0x90a) >= POACH_CHANCE[prof.style]) continue;
    // A club at his level or better, with room for him — abroad, if the agent's contacts reach.
    const level = store.currentAbility[p] / 2000 * 10000;
    const suitors = world.clubs.filter((c) => c.id !== club.id && c.players.length > 0 && c.players.length < MAX_SQUAD
      && c.reputation >= Math.min(level, club.reputation) * 0.9 && (prof.network === 'international' || c.nation === club.nation))
      .sort((a, b) => b.reputation - a.reputation);
    if (suitors.length === 0) continue;
    const suitor = suitors[Math.floor(hash01(store.id[p], world.day) * Math.min(5, suitors.length))];
    const wage = Math.round(store.wage[p] * (1.15 + 0.15 * hash01(store.id[p], 0x77)) / 1000) * 1000;
    pre[p] = { clubId: suitor.id, wage, day: world.day, season: world.season };
    taken.push(p);
    postMessage(world, {
      category: 'contract', from: `${prof.name}, ${prof.agency}`,
      subject: `${suitor.name} want ${store.fullName(p)}`,
      body: `${suitor.name} have offered my client ${store.fullName(p)} a contract from July: ${euros(wage)} a season. ` +
        `His deal with you runs out on 30 June ${seasonEndYear(world, world.season)}. Unless you put a new contract on the table he is happy with before then, he signs for them on a free.`,
      playerIdx: p,
      clubId: suitor.id,
    });
  }
  return taken;
}

/**
 * At the season's end, one of the manager's players whose contract has run out: if his agent
 * lined up a move, he goes there instead of onto the free-agent list. Returns whether he did.
 */
export function honourPreContract(world: World, p: number): boolean {
  const pre = world.preContracts?.[p];
  if (pre === undefined) return false;
  delete world.preContracts![p];
  const club = world.clubs[pre.clubId];
  if (club === undefined || pre.season !== world.season || !world.players.isActive(p)) return false;
  completeTransfer(world, club, p, pre.wage, 0, seasonEndDay(world.season + 2));
  return true;
}

/** A pre-contract no longer stands once the manager has renewed the player. */
export function preContractOf(world: World, p: number): PreContract | undefined {
  const pre = world.preContracts?.[p];
  if (pre === undefined) return undefined;
  return contractEndSeason(world.players.contractUntil[p]) > pre.season ? undefined : pre;
}
