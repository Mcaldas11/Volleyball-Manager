/**
 * The Director of Football: the man who does the club's deals for the manager. Hand him a player —
 * to sign, or one of your own to keep — with the most he may spend, and he runs the talks himself
 * through the same negotiations the manager would: the bid to the selling club, raised as it is
 * turned down, the terms with the player and his agent, and the small print his agent asks for.
 * A good negotiator opens lower and gets closer to the price; none of them goes past your limit.
 * When it is done, or he has had to walk away, he reports to the inbox.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { negotiatingRating, StaffRole, type Staff } from '../model/staff.ts';
import { closeTalks, openTalks, submitOffer, type Talks, type TalksOffer } from './deals.ts';
import { postMessage } from './inbox.ts';
import { loanOf, squadSize, wageRoom } from './loans.ts';
import { MAX_SQUAD } from '../model/positions.ts';
import { pendingMoveOf } from './moves.ts';
import { contractEndSeason, euros, type World } from './world.ts';

export interface DirectorTask {
  id: number;
  kind: 'transfer' | 'renewal';
  p: number;
  /** The most he may pay the selling club, and the most a season in wages. */
  maxFee: number;
  maxWage: number;
  talksId: number;
  day: number;
  status: 'working' | 'done' | 'failed' | 'cancelled';
  /** What came of it, once over. */
  outcome?: string;
  /** For a renewal: the contract's end before the talks, to tell a new one from it. */
  until?: number;
}

/** The club's Director of Football, if it has one. */
export function directorOf(world: World, club: Club): Staff | undefined {
  return world.staff.find((s) => s.clubId === club.id && s.role === StaffRole.DirectorOfFootball && s.retired !== true);
}

/** His skill at a deal, 0-1. */
export function directorSkill(s: Staff): number {
  return Math.max(0, Math.min(1, (negotiatingRating(s.attributes) - 1) / 19));
}

export function directorTasks(world: World): DirectorTask[] {
  return world.directorTasks ?? [];
}

/** The task for a player still in hand, if there is one. */
export function directorTaskFor(world: World, p: number): DirectorTask | undefined {
  return directorTasks(world).find((t) => t.p === p && t.status === 'working');
}

/** Why the director can't take this deal on, or null if he can. */
export function directorBlock(world: World, club: Club, p: number, kind: DirectorTask['kind']): string | null {
  const store = world.players;
  if (directorOf(world, club) === undefined) return 'The club has no Director of Football — hire one on the Staff screen.';
  if (directorTaskFor(world, p) !== undefined) return 'He is already handling this one.';
  if (!store.isActive(p)) return 'He is no longer playing.';
  if ((world.talksBlockedUntil.get(p) ?? -1) > world.day) return 'He walked out of talks recently and won\'t talk yet.';
  if (pendingMoveOf(world, p) !== undefined) return 'He has already agreed a move.';
  if (kind === 'renewal') {
    const ours = club.players.includes(p) || loanOf(world, p)?.parentClubId === club.id;
    if (!ours) return 'He is not one of yours.';
    if (store.hasFlag(p, PlayerFlag.Youth)) return 'An academy player is promoted, not renewed.';
    return null;
  }
  if (store.clubId[p] === club.id) return 'He is already yours.';
  if (squadSize(world, club) >= MAX_SQUAD) return 'The squad is full.';
  if (world.talks.some((t) => t.playerIdx === p && t.kind === 'loan')) return 'You are already talking to his club about a loan.';
  return null;
}

/**
 * Hand a deal to the director. Talks already open with the player are his from now on; otherwise
 * he opens them, and makes his first offer at once.
 */
export function delegateDeal(
  world: World, club: Club, p: number, kind: DirectorTask['kind'], maxFee: number, maxWage: number,
): { ok: boolean; text: string } {
  const block = directorBlock(world, club, p, kind);
  if (block !== null) return { ok: false, text: block };
  const store = world.players;
  const director = directorOf(world, club)!;
  const talks = world.talks.find((t) => t.playerIdx === p && t.kind === kind) ?? openTalks(world, club, p, kind);
  talks.byDirector = true;
  const tasks = (world.directorTasks ??= []);
  const task: DirectorTask = {
    id: (tasks.at(-1)?.id ?? 0) + 1, kind, p,
    maxFee: kind === 'renewal' ? 0 : Math.max(0, Math.round(maxFee)),
    maxWage: Math.max(1000, Math.round(maxWage)),
    talksId: talks.id, day: world.day, status: 'working',
    ...(kind === 'renewal' ? { until: store.contractUntil[p] } : {}),
  };
  tasks.push(task);
  if (tasks.length > 40) tasks.splice(0, tasks.length - 40);
  if (talks.pending === null) nextMove(world, club, director, task, talks);
  const limit = kind === 'renewal'
    ? `up to ${euros(task.maxWage)} a season`
    : `up to ${euros(task.maxFee)} for him and ${euros(task.maxWage)} a season in wages`;
  return { ok: true, text: `${director.firstName} ${director.lastName} is handling ${kind === 'renewal' ? 'the new contract for' : 'the move for'} ${store.fullName(p)}: ${limit}.` };
}

/** Take a deal back: the talks stay open, now the manager's own again. */
export function cancelDirectorTask(world: World, taskId: number): void {
  const task = directorTasks(world).find((t) => t.id === taskId && t.status === 'working');
  if (task === undefined) return;
  task.status = 'cancelled';
  task.outcome = 'Taken back: the talks are yours again.';
  const talks = world.talks.find((t) => t.id === task.talksId);
  if (talks !== undefined) talks.byDirector = false;
}

const round1k = (v: number): number => Math.round(v / 1000) * 1000;

/** The director's next offer in talks out of his hands until now — or the end of them. */
function nextMove(world: World, club: Club, director: Staff, task: DirectorTask, t: Talks): void {
  const store = world.players;
  const skill = directorSkill(director);
  const last = t.lastOffer;
  if (t.stage === 'fee') {
    const value = Math.max(1000, store.value[t.playerIdx]);
    let fee: number;
    if (t.rivalBid !== undefined) {
      fee = t.rivalBid.fee + Math.max(5000, t.rivalBid.fee * 0.04);
    } else if (t.reply === 'feeRejected' && t.valuation !== null) {
      // Meet them most of the way — a good negotiator still shaves a little off.
      fee = Math.max(last.fee * 1.06, t.valuation * (1.0 - 0.05 * skill));
    } else {
      // The opening bid: a good director starts lower.
      fee = value * (0.92 - 0.2 * skill);
    }
    fee = round1k(fee);
    if (fee > task.maxFee) {
      if (last.fee >= task.maxFee || task.maxFee < (t.valuation ?? 0) * 0.9) {
        finish(world, director, task, t, 'failed',
          `${t.sellingClubId >= 0 ? world.clubs[t.sellingClubId]?.name ?? 'His club' : 'They'} want around ${euros(Math.max(t.valuation ?? 0, t.rivalBid?.fee ?? 0, fee))} — more than the ${euros(task.maxFee)} you gave me. I have walked away.`);
        return;
      }
      fee = task.maxFee;
    }
    submitOffer(world, t, { ...last, fee });
    return;
  }

  // Terms with the player and his agent.
  const d = t.demands;
  if (d.floorWage > task.maxWage) {
    finish(world, director, task, t, 'failed',
      `${store.fullName(t.playerIdx)} will not go below ${euros(d.floorWage)} a season — more than the ${euros(task.maxWage)} you allowed. I have left it there.`);
    return;
  }
  const room = wageRoom(world, club) + (t.kind === 'renewal' ? store.wage[t.playerIdx] : 0);
  const firstRound = t.reply === null;
  // First time round he tries a little under the asking; after that, what is asked, if it fits.
  let wage = firstRound ? Math.max(d.floorWage, d.wage * (1 - 0.07 * skill)) : t.patience <= 1 ? d.wage : (d.wage + Math.max(d.floorWage, last.wage)) / 2;
  wage = Math.min(task.maxWage, round1k(wage));
  if (wage > room) {
    finish(world, director, task, t, 'failed', `There is no room in the wage budget for ${euros(wage)} a season. I have had to stop.`);
    return;
  }
  const years = Math.max(d.minYears, Math.min(d.maxYears, t.kind === 'renewal' ? d.minYears + 1 : 3));
  const offer: TalksOffer = {
    fee: t.agreedFee, wage, role: d.role, years,
    agentFee: d.agentFee ?? 0,
    releaseClause: d.clauseMax ?? 0,
  };
  submitOffer(world, t, offer);
}

function finish(world: World, director: Staff, task: DirectorTask, t: Talks | undefined, status: 'done' | 'failed', text: string): void {
  task.status = status;
  task.outcome = text;
  if (t !== undefined && status === 'failed') closeTalks(world, t);
  const name = world.players.fullName(task.p);
  postMessage(world, {
    category: task.kind === 'renewal' ? 'contract' : 'offer',
    from: `${director.firstName} ${director.lastName}`,
    subject: status === 'done'
      ? task.kind === 'renewal' ? `Done: ${name} has signed a new contract` : `Done: ${name} is ours`
      : `${name}: I have had to walk away`,
    body: text,
    playerIdx: task.p,
  });
}

/** Each day: the director makes his next move wherever an answer has come back. */
export function directorDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const tasks = world.directorTasks;
  if (club === undefined || tasks === undefined) return;
  const store = world.players;
  for (const task of tasks) {
    if (task.status !== 'working') continue;
    const director = directorOf(world, club);
    const t = world.talks.find((x) => x.id === task.talksId);
    if (t === undefined) {
      // The talks are over: how did they end?
      const signed = task.kind === 'transfer'
        ? store.clubId[task.p] === club.id || pendingMoveOf(world, task.p)?.toClubId === club.id
        : store.contractUntil[task.p] > (task.until ?? 0);
      const who = director ?? { firstName: 'Director', lastName: 'of Football' } as Staff;
      if (signed) {
        finish(world, who, task, undefined, 'done', task.kind === 'renewal'
          ? `${store.fullName(task.p)} has agreed: ${euros(store.wage[task.p])} a season, until the end of ${world.startYear + contractEndSeason(store.contractUntil[task.p]) + 1}.`
          : `${store.fullName(task.p)} has agreed terms: ${euros(store.wage[task.p])} a season. It went through within the limits you gave me.`);
      } else {
        finish(world, who, task, undefined, 'failed', `The talks for ${store.fullName(task.p)} came to nothing — he went elsewhere, or broke them off.`);
      }
      continue;
    }
    if (director === undefined) {
      // He has left the club: the talks go back to the manager.
      cancelDirectorTask(world, task.id);
      task.outcome = 'The Director of Football has left: the talks are yours again.';
      continue;
    }
    if (t.pending === null) nextMove(world, club, director, task, t);
  }
}
