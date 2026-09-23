/**
 * Fixture scheduling.
 *
 * Domestic volleyball leagues play a double round-robin — everyone home and
 * away — usually one match a week from autumn to spring, then a playoff.
 * Fixtures are laid out with the circle method, which guarantees every club
 * plays exactly once per round and no club is idle.
 */

import type { Rng } from '../core/rng.ts';
import { MatchFormat } from '../match/engine.ts';
import { newTableRow } from '../model/club.ts';
import { addFixture, type Competition, type Fixture, type World } from '../world/world.ts';

/**
 * Round-robin pairings via the circle method. One club is pinned and the rest
 * rotate around it; with an odd number of clubs a bye is added.
 */
export function roundRobin(clubIds: number[]): Array<Array<[number, number]>> {
  const teams = clubIds.slice();
  if (teams.length % 2 === 1) teams.push(-1); // bye
  const n = teams.length;
  const rounds: Array<Array<[number, number]>> = [];

  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i];
      const b = teams[n - 1 - i];
      if (a === -1 || b === -1) continue;
      // Alternate home advantage round by round so it stays balanced.
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);

    // Rotate all but the first entry.
    const last = teams.pop()!;
    teams.splice(1, 0, last);
  }
  return rounds;
}

/**
 * Lay out a full league season: a double round-robin on a weekly cadence,
 * starting once pre-season is over.
 */
export function scheduleLeagueSeason(
  world: World,
  comp: Competition,
  seasonStartDay: number,
  rng: Rng,
): void {
  const clubs = comp.participants;
  if (clubs.length < 2) return;

  // Reset the table for the new season.
  comp.table = clubs.map((c) => newTableRow(c));
  comp.fixtureIds = [];
  comp.playoffGroups = [];

  const firstHalf = roundRobin(rng.shuffle(clubs.slice()));
  // The reverse fixtures swap home and away.
  const secondHalf = firstHalf.map((round) =>
    round.map(([h, a]) => [a, h] as [number, number]),
  );
  const allRounds = [...firstHalf, ...secondHalf];

  // Matches run weekly, with the whole schedule fitting inside the regular
  // season window. Dense lower divisions compress to fit.
  const availableDays = 265 - 60;
  const spacing = Math.max(3, Math.floor(availableDays / allRounds.length));

  allRounds.forEach((round, roundIdx) => {
    const day = seasonStartDay + 60 + roundIdx * spacing;
    for (const [home, away] of round) {
      const f: Fixture = {
        id: world.fixtures.length,
        competitionId: comp.id,
        day,
        home,
        away,
        round: roundIdx,
        format: MatchFormat.BestOf5,
        // Matches matter more as the season runs out.
        importance: 0.3 + (roundIdx / allRounds.length) * 0.35,
        neutralVenue: false,
        played: false,
        homeSets: 0,
        awaySets: 0,
        setScores: [],
        mvp: -1,
      };
      addFixture(world, f);
      comp.fixtureIds.push(f.id);
    }
  });
}

/** Playoff round fixtures live at round numbers from here up, so they're
 *  never confused with a regular-season round index. */
export const PLAYOFF_ROUND_BASE = 1000;

/** The day the regular season's own fixtures are guaranteed finished by. */
export const PLAYOFF_START_OFFSET = 272;
/** Days of rest between one playoff round and the next. */
export const PLAYOFF_ROUND_GAP = 10;

/** Schedule one playoff tie as a single deciding match. Shared by every round
 *  of every bracket (championship, placement, relegation alike). */
export function schedulePlayoffFixture(
  world: World,
  comp: Competition,
  day: number,
  roundNo: number,
  home: number,
  away: number,
): number {
  const f: Fixture = {
    id: world.fixtures.length,
    competitionId: comp.id,
    day,
    home,
    away,
    round: PLAYOFF_ROUND_BASE + roundNo,
    format: MatchFormat.BestOf5,
    importance: 0.85,
    neutralVenue: false,
    played: false,
    homeSets: 0,
    awaySets: 0,
    setScores: [],
    mvp: -1,
  };
  addFixture(world, f);
  comp.fixtureIds.push(f.id);
  return f.id;
}
