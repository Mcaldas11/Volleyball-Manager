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

/**
 * Playoff bracket for the top N of a league. Volleyball playoffs are usually
 * best-of-five series; this schedules single deciding matches at neutral
 * venues, which keeps a fifty-season career tractable without changing who
 * tends to win.
 */
export function schedulePlayoffs(
  world: World,
  comp: Competition,
  seasonStartDay: number,
  seeds: number[],
): void {
  if (seeds.length < 2) return;
  let round = seeds.slice();
  let day = seasonStartDay + 278;
  let roundNo = 1000; // distinguishes playoff rounds from regular ones

  while (round.length > 1) {
    const next: number[] = [];
    for (let i = 0; i < round.length; i += 2) {
      const home = round[i];
      const away = round[round.length - 1 - i];
      if (home === away) {
        next.push(home);
        continue;
      }
      const f: Fixture = {
        id: world.fixtures.length,
        competitionId: comp.id,
        day,
        home,
        away,
        round: roundNo,
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
      next.push(-1); // resolved when the match is played
    }
    round = next;
    day += 7;
    roundNo++;
    if (round.length <= 1) break;
    // Subsequent rounds are scheduled once the previous ones resolve.
    break;
  }
}

/**
 * Knockout pairings for a cup: straight seeded bracket.
 */
export function seededBracket(seeds: number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const n = seeds.length;
  for (let i = 0; i < n / 2; i++) {
    pairs.push([seeds[i], seeds[n - 1 - i]]);
  }
  return pairs;
}
