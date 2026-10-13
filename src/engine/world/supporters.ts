/**
 * The supporters, and what they bring in.
 *
 * Every club has its following — about three for every seat in its arena to
 * begin with — and it grows with wins, derbies won, trophies and stars signed,
 * shrinks a little with defeats, and drifts towards what the club's standing
 * would draw. A following bigger than the arena fills it, and more; one that
 * has dwindled leaves seats empty. Shirts and scarves sell with it: the
 * merchandise takings follow the following.
 *
 * And the arena can be made bigger: a new stand, paid for up front if the
 * board has the money and trusts the manager, months in the building — worth
 * it only to a club whose following would fill it.
 */

import type { Club } from '../model/club.ts';
import { postMessage } from './inbox.ts';
import { fixtureRivalry } from './rivals.ts';
import { euros, type Fixture, type World } from './world.ts';

/** The following and the merchandise takings a club started with: what the takings scale from. */
export interface FanRef {
  fans: number;
  merch: number;
}

/** Supporters for every seat, to begin with. */
const FANS_PER_SEAT = 3;

/** A club's following — found the first time anyone asks. */
export function fansOf(club: Club): number {
  if (club.fans === undefined) {
    club.fans = club.arenaCapacity * FANS_PER_SEAT;
    club.fanRef = { fans: club.fans, merch: club.finances.merchandiseIncome };
  }
  return club.fans;
}

/** How the following fills the arena: 1 when it is the usual size for it, more when it outgrows it, less when it has dwindled. */
export function fanFactor(club: Club): number {
  const p = fansOf(club) / Math.max(1, club.arenaCapacity * FANS_PER_SEAT);
  return Math.max(0.7, Math.min(1.25, Math.pow(p, 0.6)));
}

/** The following a club's standing draws, in the long run. */
function equilibrium(club: Club): number {
  return FANS_PER_SEAT * (400 + Math.pow(club.reputation / 10000, 1.35) * 11_500);
}

function grow(club: Club, by: number): void {
  club.fans = Math.max(100, Math.round(fansOf(club) * by));
}

/** A competitive match played: the winners' following grows a little, the losers' less so the other way — a derby counts double. */
export function fansAfterMatch(world: World, f: Fixture): void {
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  if (home === undefined || away === undefined) return;
  const derby = fixtureRivalry(world, f) !== null ? 2 : 1;
  const homeWon = f.homeSets > f.awaySets;
  grow(homeWon ? home : away, 1 + 0.003 * derby);
  grow(homeWon ? away : home, 1 - 0.0015 * derby);
}

/** A trophy brings the town out. */
export function fansTrophy(world: World, clubId: number): void {
  const club = world.clubs[clubId];
  if (club !== undefined) grow(club, 1.06);
}

/** A star signed: the shirts sell. */
export function fansSigning(world: World, club: Club, p: number): void {
  const store = world.players;
  const better = club.players.filter((q) => q !== p && store.currentAbility[q] > store.currentAbility[p]).length;
  if (better > 1) return;
  grow(club, 1.03);
  if (club.id === world.userClubId) {
    postMessage(world, {
      category: 'finance', from: 'Commercial Department', playerIdx: p,
      subject: `${store.fullName(p)} shirts sell out`,
      body: `The club shop can't keep ${store.fullName(p)}'s shirt on the shelves — a signing like that brings new supporters in.`,
    });
  }
}

/** The week: every following drifts towards what its club's standing draws, and the merchandise follows it. */
export function supportersWeek(world: World): void {
  for (const club of world.clubs) {
    if (club.players.length === 0) continue;
    const fans = fansOf(club);
    club.fans = Math.round(fans + (equilibrium(club) - fans) * 0.01);
    const ref = club.fanRef!;
    club.finances.merchandiseIncome = Math.round(ref.merch * (club.fans / Math.max(1, ref.fans)));
  }
}

// ---- A bigger arena -------------------------------------------------------------------------

export interface ArenaProject {
  seats: number;
  cost: number;
  /** The board's answer, then — once approved — the day the stand opens. */
  until: number;
  stage: 'asked' | 'building';
}

/** What the board weighs a new stand on. */
const ARENA_REFUSAL_DAYS = 120;

/** The two stands the club could build: a tenth more, or a quarter. */
export function expansionOptions(club: Club): Array<{ seats: number; cost: number; days: number }> {
  return [0.1, 0.25].map((share) => {
    const seats = Math.max(200, Math.round((club.arenaCapacity * share) / 100) * 100);
    const cost = Math.round((seats * (700 + club.reputation / 10000 * 900)) / 10_000) * 10_000;
    return { seats, cost, days: Math.min(300, 120 + Math.round(seats / 40)) };
  });
}

/** Why the manager can't ask for a new stand now — or null when he can. */
export function expansionBlock(world: World, club: Club): string | null {
  const project = club.arenaProject;
  if (project !== undefined) return project.stage === 'asked' ? 'The board is still considering it.' : 'A new stand is already being built.';
  if ((club.arenaRefusedUntil ?? -1) > world.day) return `The board turned it down — ask again in ${club.arenaRefusedUntil! - world.day} days.`;
  return null;
}

/** Ask the board for a bigger arena. They answer in a few days. */
export function requestExpansion(world: World, club: Club, seats: number): string {
  const block = expansionBlock(world, club);
  if (block !== null) return block;
  const option = expansionOptions(club).find((o) => o.seats === seats);
  if (option === undefined) return 'There is no such plan.';
  club.arenaProject = { seats, cost: option.cost, until: world.day + 4 + (world.day % 4), stage: 'asked' };
  return `Your plan for ${seats.toLocaleString('en-GB')} more seats (${euros(option.cost)}) is with the board.`;
}

/** Each day: the board's answer, and the stand opening. The manager's club only. */
export function arenaDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const project = club?.arenaProject;
  if (club === undefined || project === undefined || project.until > world.day) return;
  const f = club.finances;
  if (project.stage === 'asked') {
    const affordable = f.balance >= project.cost * 1.15;
    const trusted = club.boardConfidence >= 45;
    if (!affordable || !trusted) {
      club.arenaProject = undefined;
      club.arenaRefusedUntil = world.day + ARENA_REFUSAL_DAYS;
      postMessage(world, {
        category: 'board', from: 'The Board',
        subject: 'New stand turned down',
        body: !affordable
          ? `The board can't find ${euros(project.cost)} for a new stand — the club would want well over that in the bank first.`
          : 'The board isn\'t ready to build on your say-so with results as they are.',
      });
      return;
    }
    const days = expansionOptions(club).find((o) => o.seats === project.seats)?.days ?? 180;
    f.balance -= project.cost;
    club.arenaProject = { ...project, stage: 'building', until: world.day + days };
    postMessage(world, {
      category: 'board', from: 'The Board',
      subject: 'New stand approved',
      body: `The board has agreed to spend ${euros(project.cost)} on ${project.seats.toLocaleString('en-GB')} more seats. ` +
        `The builders start now; it should open in about ${Math.round(days / 30)} months.`,
    });
    return;
  }
  // The stand opens: more seats, the same takings a seat, a little more to keep up.
  const before = club.arenaCapacity;
  club.arenaCapacity += project.seats;
  f.ticketIncomePerMatch = Math.round(f.ticketIncomePerMatch * (club.arenaCapacity / before));
  f.arenaMaintenance += project.seats * 38;
  club.arenaProject = undefined;
  postMessage(world, {
    category: 'board', from: 'The Board',
    subject: 'The new stand opens',
    body: `${club.arenaName} now holds ${club.arenaCapacity.toLocaleString('en-GB')}. Fill it.`,
  });
}
