/**
 * End-of-season knockout playoffs.
 *
 * A league's final table is carved into three bands once the regular season
 * finishes: the top band plays off for the title, a middle band plays off
 * for its final placing, and the bottom band plays off for who actually goes
 * down. All three are the exact same generic single-elimination bracket —
 * only the seed list and what the result is used for differ — seeded from
 * table position, with byes going to the top seeds when a band's size isn't
 * a power of two.
 *
 * A bracket cannot be scheduled all at once, because round two depends on
 * round one's results. So this runs a day at a time: `progressPlayoffs` is
 * called once per day from `advanceDay`, creates the bands the day after the
 * regular season finishes, and — each time every tie in a band's current
 * round has a result — schedules the next round or, if that was the final,
 * resolves the band's finishing order.
 */

import { compareTableRows } from '../model/club.ts';
import {
  PLAYOFF_ROUND_GAP, PLAYOFF_START_OFFSET, schedulePlayoffFixture,
} from './schedule.ts';
import {
  dayOfSeason, type Competition, type PlayoffGroup, type PlayoffGroupId, type PlayoffTie, type World,
} from '../world/world.ts';

/** Called once per day. Creates each eligible league's playoff bands the day
 *  after its regular season ends, and advances any band whose current round
 *  has just finished. */
export function progressPlayoffs(world: World): void {
  const dos = dayOfSeason(world);
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || !comp.hasPlayoffs || comp.table.length === 0) continue;

    if (dos === PLAYOFF_START_OFFSET && comp.playoffGroups.length === 0) {
      createPlayoffGroups(world, comp);
    }
    for (const group of comp.playoffGroups) {
      if (!group.resolved) advanceGroup(world, comp, group);
    }
  }
}

/**
 * The order promotion, relegation and the title should actually use: each
 * band's resolved bracket order where one exists, the plain table order for
 * anyone not covered by a band (bands that never had a genuine decision to
 * make — e.g. a relegation pool no bigger than the relegation slots — are
 * never created in the first place, so this falls back to their raw
 * position, which is exactly equivalent to relegating them outright).
 */
export function finalStandingsOrder(comp: Competition): number[] {
  const sorted = [...comp.table].sort(compareTableRows).map((r) => r.clubId);
  if (comp.playoffGroups.length === 0) return sorted;

  const champ = comp.playoffGroups.find((g) => g.id === 'championship');
  const relegation = comp.playoffGroups.find((g) => g.id === 'relegation');
  const champSize = champ?.seeds.length ?? 0;
  const relSize = relegation?.seeds.length ?? 0;
  const placement = comp.playoffGroups.find((g) => g.id === 'placement');
  const placeSize = placement?.seeds.length ?? (sorted.length - champSize - relSize);

  const bandOrder = (group: PlayoffGroup | undefined, from: number, size: number): number[] =>
    group !== undefined && group.resolved ? group.finalOrder : sorted.slice(from, from + size);

  return [
    ...bandOrder(champ, 0, champSize),
    ...bandOrder(placement, champSize, placeSize),
    ...bandOrder(relegation, champSize + placeSize, relSize),
  ];
}

// ---- Bracket construction --------------------------------------------------

/** Standard tournament seeding order for a bracket of `size` slots (a power
 *  of two): the sequence of seed ranks assigned left to right, so adjacent
 *  slots pair correctly and the top two seeds can only meet in the final. */
function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const len = order.length * 2;
    const next: number[] = [];
    for (const s of order) next.push(s, len - 1 - s);
    order = next;
  }
  return order;
}

/** First round of a bracket for `seedCount` entrants: padded with byes (up
 *  to the next power of two) awarded to the top seeds. */
function buildFirstRound(seedCount: number): PlayoffTie[] {
  let size = 1;
  while (size < seedCount) size *= 2;
  const slots = seedOrder(size).map((rank) => (rank < seedCount ? rank : -1));

  const ties: PlayoffTie[] = [];
  for (let i = 0; i < size; i += 2) {
    const home = slots[i];
    const away = slots[i + 1];
    ties.push({
      homeSeed: home,
      awaySeed: away,
      fixtureId: -1,
      winnerSeed: home === -1 ? away : away === -1 ? home : -1,
    });
  }
  return ties;
}

/** Pair up the previous round's winners for the next round. */
function buildNextRound(prevRound: PlayoffTie[]): PlayoffTie[] {
  const ties: PlayoffTie[] = [];
  for (let i = 0; i < prevRound.length; i += 2) {
    ties.push({
      homeSeed: prevRound[i].winnerSeed,
      awaySeed: prevRound[i + 1].winnerSeed,
      fixtureId: -1,
      winnerSeed: -1,
    });
  }
  return ties;
}

/** Finishing order from a resolved bracket: champion, runner-up, then each
 *  earlier round's losers (better seed first) — the standard placement
 *  convention for a bracket with no third-place playoff. */
function computeFinalOrder(group: PlayoffGroup): number[] {
  const rounds = group.rounds;
  const final = rounds[rounds.length - 1][0];
  const runnerUpSeed = final.winnerSeed === final.homeSeed ? final.awaySeed : final.homeSeed;
  const order = [final.winnerSeed, runnerUpSeed];

  for (let r = rounds.length - 2; r >= 0; r--) {
    const losers: number[] = [];
    for (const tie of rounds[r]) {
      if (tie.homeSeed === -1 || tie.awaySeed === -1) continue; // a bye has no loser
      losers.push(tie.winnerSeed === tie.homeSeed ? tie.awaySeed : tie.homeSeed);
    }
    losers.sort((a, b) => a - b);
    order.push(...losers);
  }
  return order.map((seedIdx) => group.seeds[seedIdx]);
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function makeGroup(
  world: World, comp: Competition, id: PlayoffGroupId, label: string, seeds: number[],
): PlayoffGroup {
  const group: PlayoffGroup = {
    id, label, seeds, rounds: [], currentRound: 0, resolved: false, finalOrder: [],
  };
  const round0 = buildFirstRound(seeds.length);
  const day = world.day + 3;
  for (const tie of round0) {
    if (tie.winnerSeed === -1) {
      tie.fixtureId = schedulePlayoffFixture(world, comp, day, 0, seeds[tie.homeSeed], seeds[tie.awaySeed]);
    }
  }
  group.rounds.push(round0);
  return group;
}

/**
 * How the final table splits into bands, before any bracket actually exists —
 * shared by bracket construction and the table screen's zone shading, so the
 * two can never drift apart.
 *
 * The relegation band is twice the number of relegation slots — enough for a
 * real decision (half the band goes down) — but only when the league is big
 * enough to spare that many clubs beyond the championship band; a smaller
 * pool would just be "everyone in it is relegated" with nothing to decide.
 */
export function playoffBandSizes(comp: Competition): { championship: number; relegation: number } {
  const n = comp.table.length;
  if (!comp.hasPlayoffs || n === 0) return { championship: 0, relegation: 0 };
  const championship = Math.min(comp.playoffTeams, n);
  const relegation = Math.min(comp.relegationSlots * 2, n - championship);
  return { championship, relegation };
}

/** Split the final regular-season table into championship, placement and
 *  relegation bands and schedule each one's first round. */
function createPlayoffGroups(world: World, comp: Competition): void {
  const sorted = [...comp.table].sort(compareTableRows).map((r) => r.clubId);
  const n = sorted.length;
  const { championship: champSize, relegation: relegationPoolSize } = playoffBandSizes(comp);
  const placementSize = n - champSize - relegationPoolSize;

  const championshipSeeds = sorted.slice(0, champSize);
  const placementSeeds = sorted.slice(champSize, champSize + placementSize);
  const relegationSeeds = sorted.slice(champSize + placementSize);

  if (championshipSeeds.length >= 2) {
    comp.playoffGroups.push(makeGroup(world, comp, 'championship', 'Championship Playoff', championshipSeeds));
  }
  if (placementSeeds.length >= 2) {
    const label = `${ordinal(champSize + 1)}–${ordinal(champSize + placementSize)} Place Playoff`;
    comp.playoffGroups.push(makeGroup(world, comp, 'placement', label, placementSeeds));
  }
  if (relegationSeeds.length >= 2 && relegationSeeds.length > comp.relegationSlots) {
    comp.playoffGroups.push(makeGroup(world, comp, 'relegation', 'Relegation Playoff', relegationSeeds));
  }
}

/** Read results for the active round; schedule the next one, or resolve the
 *  band, once every tie in it has a winner. */
function advanceGroup(world: World, comp: Competition, group: PlayoffGroup): void {
  const round = group.rounds[group.rounds.length - 1];
  for (const tie of round) {
    if (tie.winnerSeed !== -1 || tie.fixtureId === -1) continue;
    const fixture = world.fixtures[tie.fixtureId];
    if (fixture === undefined || !fixture.played) continue;
    tie.winnerSeed = fixture.homeSets > fixture.awaySets ? tie.homeSeed : tie.awaySeed;
  }
  if (!round.every((t) => t.winnerSeed !== -1)) return;

  if (round.length === 1) {
    group.resolved = true;
    group.finalOrder = computeFinalOrder(group);
    return;
  }

  const next = buildNextRound(round);
  const day = world.day + PLAYOFF_ROUND_GAP;
  for (const tie of next) {
    tie.fixtureId = schedulePlayoffFixture(world, comp, day, group.rounds.length, group.seeds[tie.homeSeed], group.seeds[tie.awaySeed]);
  }
  group.rounds.push(next);
  group.currentRound++;
}
