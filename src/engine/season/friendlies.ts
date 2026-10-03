/**
 * Pre-season friendlies.
 *
 * July and August are for getting a squad fit and a plan learnt, and the way
 * to do both is to play. The manager invites whichever clubs he likes — at
 * home or away, on a free date — and each answers within a few days: a club
 * of its own standing or below is usually glad of the game, a much bigger one
 * less so, and one asked to travel abroad least of all. The board fixes one
 * up whenever it is asked to, and if a fortnight into the pre-season none has
 * been arranged, it books a couple itself.
 *
 * A friendly is played in full — through the full engine, live or not — but
 * counts for nothing except the practice: no table, no statistics or records,
 * no board judging it, no opposition analyst taking notes.
 */

import { MatchFormat } from '../match/engine.ts';
import type { Club } from '../model/club.ts';
import { currentJob } from '../world/career.ts';
import { formatDay, postMessage } from '../world/inbox.ts';
import {
  addFixture, DAYS_PER_SEASON, dayOfSeason,
  type Competition, type Fixture, type FriendlyRequest, type World,
} from '../world/world.ts';

/** The pre-season's window for friendlies, in days of the season: 8 July to 22 August. */
export const FRIENDLY_FIRST_DAY = 7;
export const FRIENDLY_LAST_DAY = 52;
/** As many as a pre-season has room for. */
export const MAX_FRIENDLIES = 6;
/** A date at least this far ahead — time for the answer, and the travel. */
export const FRIENDLY_NOTICE_DAYS = 4;
/** Two weeks into his pre-season with nothing in the diary, the board books some itself… */
const BOARD_STEPS_IN = 14;
/** …this many. */
const BOARD_BOOKS = 2;
/** A side short of this many players has no team to bring. */
const MIN_SQUAD = 12;

function state(world: World): NonNullable<World['friendlies']> {
  return world.friendlies ??= { requests: [], nextId: 0, boardArranged: -1 };
}

/** The friendlies' competition — one for every season, made the first time it is needed. */
export function friendlyCompetition(world: World): Competition {
  let comp = world.competitions.find((c) => c.kind === 'friendly');
  if (comp === undefined) {
    comp = {
      id: world.competitions.length,
      name: 'Friendly',
      kind: 'friendly',
      key: 'friendly',
      nation: -1,
      tier: 0,
      participants: [],
      table: [],
      fixtureIds: [],
      reputation: 800,
      promotionSlots: 0,
      relegationSlots: 0,
      hasPlayoffs: false,
      playoffTeams: 0,
      champion: -1,
      prizePool: 0,
      playoffGroups: [],
    };
    world.competitions.push(comp);
  }
  return comp;
}

export function isFriendly(world: World, f: Fixture): boolean {
  return world.competitions[f.competitionId]?.kind === 'friendly';
}

function userClub(world: World): Club | undefined {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
}

function seasonStart(world: World): number {
  return world.season * DAYS_PER_SEASON;
}

/** A club's friendlies this season, booked. */
export function friendliesOf(world: World, clubId: number): Fixture[] {
  const comp = world.competitions.find((c) => c.kind === 'friendly');
  if (comp === undefined) return [];
  const start = seasonStart(world);
  return comp.fixtureIds
    .map((id) => world.fixtures[id])
    .filter((f) => f.day >= start && f.day < start + DAYS_PER_SEASON && (f.home === clubId || f.away === clubId))
    .sort((a, b) => a.day - b.day);
}

/** The user's invitations still waiting on an answer. */
export function friendlyRequests(world: World): readonly FriendlyRequest[] {
  return world.friendlies?.requests ?? [];
}

/** No match for the club the day before, the day itself or the day after — nor, for the user's, an invitation out for it. */
export function clubFree(world: World, clubId: number, day: number): boolean {
  for (let d = day - 1; d <= day + 1; d++) {
    for (const id of world.fixturesByDay.get(d) ?? []) {
      const f = world.fixtures[id];
      if (f.home === clubId || f.away === clubId) return false;
    }
  }
  if (clubId === world.userClubId) {
    if (friendlyRequests(world).some((r) => Math.abs(r.day - day) <= 1)) return false;
  }
  return true;
}

/** The dates a new friendly could go on: in the pre-season's window, far enough ahead, and clear for the user's club. */
export function friendlyDates(world: World): number[] {
  const club = userClub(world);
  if (club === undefined) return [];
  const start = seasonStart(world);
  const out: number[] = [];
  for (let d = Math.max(start + FRIENDLY_FIRST_DAY, world.day + FRIENDLY_NOTICE_DAYS); d <= start + FRIENDLY_LAST_DAY; d++) {
    if (clubFree(world, club.id, d)) out.push(d);
  }
  return out;
}

/** Friendlies booked and invitations out — what counts against the pre-season's room. */
function arranged(world: World, clubId: number): number {
  return friendliesOf(world, clubId).length + friendlyRequests(world).length;
}

/** Why the user can't invite this club to play on this day, or null if he can. */
export function friendlyBlock(world: World, clubId: number, day: number): string | null {
  const club = userClub(world);
  const them = world.clubs[clubId];
  if (club === undefined) return 'You have no club.';
  if (dayOfSeason(world) > FRIENDLY_LAST_DAY - FRIENDLY_NOTICE_DAYS) return 'The pre-season is over — friendlies wait for the next.';
  if (arranged(world, club.id) >= MAX_FRIENDLIES) {
    return `You have ${MAX_FRIENDLIES} friendlies arranged — as many as the pre-season has room for.`;
  }
  if (them === undefined || clubId === club.id) return 'Choose another club to play.';
  if (them.players.length < MIN_SQUAD) return `${them.name} have no squad to bring.`;
  if (friendliesOf(world, club.id).some((f) => f.home === clubId || f.away === clubId) ||
    friendlyRequests(world).some((r) => r.clubId === clubId)) {
    return `You already have a friendly with ${them.name}.`;
  }
  if (!friendlyDates(world).includes(day)) return 'Pick a free date in the pre-season, at least a few days ahead.';
  if (!clubFree(world, clubId, day)) return `${them.name} have a match around that date.`;
  return null;
}

/**
 * How likely a club is to say yes, 0-1: glad of a game against anyone its own
 * size or bigger, less so the further it stands above the user's club — and
 * less again for being asked to travel, abroad most of all.
 */
export function friendlyInterest(world: World, clubId: number, home: boolean): number {
  const club = userClub(world);
  const them = world.clubs[clubId];
  if (club === undefined || them === undefined) return 0;
  let p = 0.9 - Math.max(0, them.reputation - club.reputation * 1.15) / 3500;
  if (home) p -= 0.1;
  if (them.nation !== club.nation) p -= home ? 0.15 : 0.05;
  return Math.max(0.05, Math.min(0.95, p));
}

/** Invite a club to a friendly; it answers within a few days. Null if the invitation can't be made. */
export function requestFriendly(world: World, clubId: number, day: number, home: boolean): FriendlyRequest | null {
  if (friendlyBlock(world, clubId, day) !== null) return null;
  const s = state(world);
  const answerOn = Math.max(world.day + 1, Math.min(day - 2, world.day + world.rng.int(1, 3)));
  const req: FriendlyRequest = { id: s.nextId++, clubId, day, home, sentOn: world.day, answerOn };
  s.requests.push(req);
  return req;
}

/** Take back an invitation not yet answered. */
export function withdrawFriendlyRequest(world: World, id: number): void {
  const s = state(world);
  s.requests = s.requests.filter((r) => r.id !== id);
}

function book(world: World, opponent: number, day: number, home: boolean): Fixture {
  const comp = friendlyCompetition(world);
  const f: Fixture = {
    id: world.fixtures.length,
    competitionId: comp.id,
    day,
    home: home ? world.userClubId : opponent,
    away: home ? opponent : world.userClubId,
    round: 0,
    format: MatchFormat.BestOf5,
    importance: 0.05,
    neutralVenue: false,
    played: false,
    homeSets: 0,
    awaySets: 0,
    setScores: [],
    mvp: -1,
  };
  addFixture(world, f);
  comp.fixtureIds.push(f.id);
  return f;
}

/**
 * The board books a friendly: on the first free date that leaves a few days
 * either side of the others, against a club a little below the user's own —
 * good practice, and glad of the game — from his own country if it can.
 */
export function boardArrangeFriendly(world: World): Fixture | null {
  const club = userClub(world);
  if (club === undefined || dayOfSeason(world) > FRIENDLY_LAST_DAY - FRIENDLY_NOTICE_DAYS) return null;
  if (arranged(world, club.id) >= MAX_FRIENDLIES) return null;
  const booked = friendliesOf(world, club.id);
  const dates = friendlyDates(world);
  const spaced = dates.filter((d) => booked.every((f) => Math.abs(f.day - d) >= 4));
  const playedWith = new Set(booked.flatMap((f) => [f.home, f.away]));
  for (const r of friendlyRequests(world)) playedWith.add(r.clubId);

  for (const day of [...spaced, ...dates]) {
    const target = club.reputation * 0.85;
    const candidates = world.clubs
      .filter((c) => c.id !== club.id && !playedWith.has(c.id) && c.players.length >= MIN_SQUAD &&
        c.reputation >= club.reputation * 0.45 && c.reputation <= club.reputation * 1.1 && clubFree(world, c.id, day))
      .sort((a, b) =>
        Number(b.nation === club.nation) - Number(a.nation === club.nation) ||
        Math.abs(a.reputation - target) - Math.abs(b.reputation - target));
    if (candidates.length === 0) continue;
    const opponent = candidates[world.rng.int(0, Math.min(5, candidates.length) - 1)];
    const home = booked.filter((f) => f.home === club.id).length <= booked.filter((f) => f.away === club.id).length;
    return book(world, opponent.id, day, home);
  }
  return null;
}

/** "Opponent (H) on Sat 12 Jul" */
function describe(world: World, f: Fixture): string {
  const home = f.home === world.userClubId;
  const opp = world.clubs[home ? f.away : f.home];
  return `${home ? 'at home to' : 'away at'} ${opp?.name ?? 'a club'} on ${formatDay(world, f.day)}`;
}

/**
 * The friendlies' day: invitations due an answer get one — the date still
 * free and the club willing, or not — and a fortnight into his pre-season
 * with nothing arranged, the board books a couple itself.
 */
export function friendliesDay(world: World): void {
  const club = userClub(world);
  const s = world.friendlies;
  if (s !== undefined) {
    for (const req of [...s.requests]) {
      if (req.answerOn > world.day) continue;
      s.requests = s.requests.filter((r) => r !== req);
      const them = world.clubs[req.clubId];
      if (club === undefined || them === undefined) continue;
      const free = clubFree(world, club.id, req.day) && clubFree(world, them.id, req.day) && req.day > world.day;
      if (free && world.rng.chance(friendlyInterest(world, them.id, req.home))) {
        const f = book(world, them.id, req.day, req.home);
        postMessage(world, {
          subject: `${them.name} accept your invitation`,
          body: `${them.name} will be glad of the game: a friendly ${describe(world, f)}.`,
          from: them.name,
          clubId: them.id,
          category: 'matchday',
        });
      } else {
        postMessage(world, {
          subject: `${them.name} decline your invitation`,
          body: free
            ? `${them.name} thank you for the invitation, but cannot fit a friendly with ${club.name} into their pre-season.`
            : `${them.name} thank you for the invitation, but the date no longer suits them.`,
          from: them.name,
          clubId: them.id,
          category: 'matchday',
        });
      }
    }
  }

  const job = currentJob(world);
  if (club === undefined || job === undefined || state(world).boardArranged === world.season) return;
  const d = dayOfSeason(world);
  if (d > FRIENDLY_LAST_DAY) return;
  if (arranged(world, club.id) > 0) {
    state(world).boardArranged = world.season;
    return;
  }
  if (d < BOARD_STEPS_IN || world.day - job.startDay < 7) return;
  state(world).boardArranged = world.season;
  const booked: Fixture[] = [];
  for (let i = 0; i < BOARD_BOOKS; i++) {
    const f = boardArrangeFriendly(world);
    if (f !== null) booked.push(f);
  }
  if (booked.length === 0) return;
  postMessage(world, {
    subject: 'Pre-season friendlies arranged',
    body: `With nothing in the diary, the board has arranged ${booked.length === 1 ? 'a friendly' : `${booked.length} friendlies`} ` +
      `for the pre-season: ${booked.map((f) => describe(world, f)).join('; ')}. You can arrange more from the Calendar.`,
    from: `${club.name} Board`,
    clubId: club.id,
    category: 'board',
  });
}
