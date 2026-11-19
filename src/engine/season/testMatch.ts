/**
 * The tutorial's practice match.
 *
 * A new manager should not have to wait weeks of the calendar to learn the
 * bench, so the tutorial books one on the day it reaches its matchday
 * chapter: the manager's side against a made-up Tutorial XI, played through
 * the normal matchday — team sheet, coin toss, kick-off, the live match.
 *
 * It counts for nothing at all: no table, no record, no statistics, no
 * achievements, not even tired legs — the friendly path, with even its
 * practice taken out. The side to coach is the club's own; a national
 * coach's is his provisional fourteen, lent for the day; a coach out of work
 * takes a scratch side. Once played, the made-up players go, and the sides
 * that lent their names are left empty, out of every league.
 */

import { Rng } from '../core/rng.ts';
import { MatchFormat } from '../match/engine.ts';
import { defaultTactics } from '../match/tactics.ts';
import { newClub, type Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { nationName, suggestSquad, userNation } from '../world/internationals.ts';
import { generatePlayer } from '../world/playerGen.ts';
import { addFixture, seasonEndDay, type Fixture, type World } from '../world/world.ts';
import { friendlyCompetition } from './friendlies.ts';

export const TEST_SIDE_NAME = 'Tutorial XI';
export const SCRATCH_SIDE_NAME = 'Scratch XI';

export interface TestMatchState {
  fixtureId: number;
  /** The Tutorial XI. */
  opponent: number;
  /** The side the manager coaches in it: his club, or one lent for the day. */
  side: number;
  /** A side lent for the day: while he coaches it, the club he had before (-1 for none). */
  coaching?: { was: number };
  /** Over: the made-up players gone. */
  settled?: boolean;
}

/** The fourteen a made-up side brings, by position. */
const SHAPE: ReadonlyArray<readonly [Position, number]> = [
  [Position.Setter, 2], [Position.Opposite, 2], [Position.OutsideHitter, 4], [Position.MiddleBlocker, 4], [Position.Libero, 2],
];

export function isTestMatch(world: World, f: Fixture): boolean {
  return world.testMatch !== undefined && world.testMatch.fixtureId === f.id;
}

/** The practice match, while it is still to be played today. */
export function testMatchToday(world: World): Fixture | null {
  const t = world.testMatch;
  if (t === undefined || t.settled === true) return null;
  const f = world.fixtures[t.fixtureId];
  return f !== undefined && !f.played && f.day === world.day ? f : null;
}

/** A made-up side's club: no league, no money worth the name, no part in anything else. */
function exhibitionClub(world: World, name: string, nation: number): Club {
  const club = newClub(world.clubs.length, name, nation, 0);
  club.exhibition = true;
  club.shortName = name === TEST_SIDE_NAME ? 'TUT' : name.slice(0, 3).toUpperCase();
  club.reputation = 500;
  club.arenaName = 'Training Hall';
  club.arenaCapacity = 300;
  club.titlesWon = 0;
  club.kit = name === TEST_SIDE_NAME
    ? { hue: 140, shirt: '#2f8f5b', shorts: '#f2f2f2', libero: '#f2f2f2' }
    : { hue: 30, shirt: '#c9772b', shorts: '#2b2b2b', libero: '#2b2b2b' };
  world.clubs.push(club);
  return club;
}

/** Fourteen made-up players around an ability, 0-2000 — on dice of their own, so the world's are untouched. */
function makeSquad(world: World, club: Club, level: number, rng: Rng): void {
  const store = world.players;
  const made: number[] = [];
  for (const [pos, n] of SHAPE) {
    for (let i = 0; i < n; i++) {
      const p = generatePlayer(store, rng, {
        nation: club.nation,
        age: rng.int(22, 30),
        potential: Math.round(Math.max(200, Math.min(1900, level * (i === 0 ? 1.04 : 0.94) * rng.gaussianClamped(1, 0.05, 0.85, 1.15)))),
        position: pos,
        currentYear: world.year,
        abilityFraction: 1,
      });
      store.clubId[p] = club.id;
      store.contractUntil[p] = seasonEndDay(world.season);
      store.wage[p] = 0;
      made.push(p);
    }
  }
  club.players = made;
  const best = (pos: Position): number[] => made.filter((p) => store.position[p] === pos)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const s = best(Position.Setter);
  const o = best(Position.Opposite);
  const oh = best(Position.OutsideHitter);
  const mb = best(Position.MiddleBlocker);
  club.preferredLineup = [s[0], oh[0], mb[0], o[0], oh[1], mb[1]];
  club.preferredLibero = best(Position.Libero)[0];
  club.preferredDefensiveLibero = -1;
}

/** The average ability of a squad's best twelve. */
function levelOf(world: World, players: readonly number[]): number {
  const ca = [...players].map((p) => world.players.currentAbility[p]).sort((a, b) => b - a).slice(0, 12);
  return ca.length === 0 ? 900 : ca.reduce((a, b) => a + b, 0) / ca.length;
}

/**
 * Book the practice match for today: the manager's side at home to the
 * Tutorial XI — a little weaker than his, so the first match is a fair one.
 * Once a career; null when it has been booked already, or there is no side to give him.
 */
export function bookTestMatch(world: World): Fixture | null {
  if (world.testMatch !== undefined) return null;
  const rng = new Rng(`test-match:${world.seed}:${world.day}`);
  const nation = userNation(world);
  let side: Club | undefined;
  if (world.userClubId >= 0) {
    side = world.clubs[world.userClubId];
  } else if (nation >= 0) {
    // The national team's fourteen, lent for the day — they stay their clubs' players.
    const squad = suggestSquad(world, nation).slice(0, 14);
    if (squad.length < 12) return null;
    side = exhibitionClub(world, nationName(nation), nation);
    side.shortName = nationName(nation).slice(0, 3).toUpperCase();
    side.players = squad;
    const team = world.nationalTeams.find((t) => t.nation === nation);
    side.tactics = structuredClone(team?.tactics ?? defaultTactics());
    const lineup = team?.preferredLineup ?? [];
    side.preferredLineup = lineup.length === 6 && lineup.every((p) => squad.includes(p)) ? [...lineup] : [];
    side.preferredLibero = team?.preferredLibero !== undefined && squad.includes(team.preferredLibero) ? team.preferredLibero : -1;
    side.preferredDefensiveLibero = -1;
  } else {
    side = exhibitionClub(world, SCRATCH_SIDE_NAME, world.manager?.nation ?? 0);
    makeSquad(world, side, 950, rng);
  }
  if (side === undefined) return null;
  const opponent = exhibitionClub(world, TEST_SIDE_NAME, side.nation);
  makeSquad(world, opponent, levelOf(world, side.players) * 0.92, rng);

  const comp = friendlyCompetition(world);
  const f: Fixture = {
    id: world.fixtures.length,
    competitionId: comp.id,
    day: world.day,
    home: side.id,
    away: opponent.id,
    round: 0,
    format: MatchFormat.BestOf5,
    importance: 0.02,
    neutralVenue: false,
    played: false,
    homeSets: 0,
    awaySets: 0,
    setScores: [],
    mvp: -1,
  };
  addFixture(world, f);
  comp.fixtureIds.push(f.id);
  world.testMatch = { fixtureId: f.id, opponent: opponent.id, side: side.id };
  return f;
}

/** The manager takes the lent side for the match: the matchday's screens are a club's. */
export function beginTestCoaching(world: World): boolean {
  const t = world.testMatch;
  if (t === undefined || testMatchToday(world) === null || world.userClubId === t.side) return false;
  t.coaching = { was: world.userClubId };
  world.userClubId = t.side;
  return true;
}

/** …and gives it back, the match over (or left). */
export function endTestCoaching(world: World): void {
  const t = world.testMatch;
  if (t?.coaching === undefined) return;
  if (world.userClubId === t.side) world.userClubId = t.coaching.was;
  t.coaching = undefined;
}

/**
 * The practice match over — or its day gone by: the made-up players go (retired, out of the
 * world), and the sides that lent their names keep none. Safe to call any day, and on loading.
 */
export function settleTestMatch(world: World): void {
  const t = world.testMatch;
  if (t === undefined || t.settled === true) return;
  const f = world.fixtures[t.fixtureId];
  if (f !== undefined && !f.played && f.day >= world.day) return;
  endTestCoaching(world);
  const store = world.players;
  for (const id of [t.opponent, t.side]) {
    const club = world.clubs[id];
    if (club === undefined || club.exhibition !== true) continue;
    for (const p of club.players) {
      // Players lent by their clubs (a national coach's fourteen) go back to them as they were.
      if (store.clubId[p] !== club.id) continue;
      store.clubId[p] = -1;
      store.setFlag(p, PlayerFlag.Retired, true);
    }
    club.players = [];
    club.youthPlayers = [];
    club.preferredLineup = [];
    club.preferredLibero = -1;
  }
  t.settled = true;
}
