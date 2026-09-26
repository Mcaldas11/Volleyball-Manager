/**
 * The season loop.
 *
 * Advancing a day is the fundamental operation of the game: play whatever
 * matches fall on that date, tick every player's fitness and injuries, and
 * once a week put the squads through training. Everything the user does sits
 * on top of this.
 *
 * Matches are simulated at one of two levels of detail. The user's own club,
 * and anything they ask to watch, runs through the full rally engine. Every
 * other match in the world runs through the point-level quick simulation.
 * Both write the same statistics, so the record books do not care which path
 * a match took.
 */

import type { Rng } from '../core/rng.ts';
import { awardLeaguePoints, type Club, type LeagueTableRow } from '../model/club.ts';
import { PlayerFlag, type PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { simulateMatch, type MatchResult, type TeamSetup } from '../match/engine.ts';
import { addToSeason, newSeasonLine, type PlayerMatchStats, type SeasonStatLine } from '../match/stats.ts';
import { DAYS_PER_SEASON, currentPhase, dayOfSeason, SeasonPhase, type Fixture, type World } from '../world/world.ts';
import { PLAYOFF_ROUND_BASE, scheduleLeagueSeason } from './schedule.ts';
import { quickSimulate } from './quickSim.ts';
import { progressPlayoffs } from './playoffs.ts';
import { rollInjuries, weeklyTraining } from '../world/progression.ts';
import { processScoutingQueue } from '../world/scouting.ts';
import { generateIncomingOffers } from '../world/negotiation.ts';
import { expireStaleInterviews, generateInterviewSessions } from '../world/interviews.ts';
import { recordFixture } from '../world/records.ts';

/** Season-long statistics, keyed by player index. */
export type SeasonStats = Map<number, SeasonStatLine>;

export interface SeasonContext {
  stats: SeasonStats;
  /** Detailed results the user has asked to keep, keyed by fixture id. */
  detailedResults: Map<number, MatchResult>;
  /** Every active player's ability as of the start of the current season, for
   *  the end-of-season "most improved" award. */
  seasonStartAbility: Map<number, number>;
}

export function newSeasonContext(): SeasonContext {
  return { stats: new Map(), detailedResults: new Map(), seasonStartAbility: new Map() };
}

/** Slot order used by `club.preferredLineup`, `pickLineup`'s result, and the
 *  team-sheet UI alike — slot `i` starts the set in zone `i + 1`, so this is
 *  the standard 5-1 in rotation P1: setter in 1, outsides in 2 and 5, middles
 *  in 3 and 6, opposite in 4. Setter and opposite sit diagonal, as do the two
 *  outsides and the two middles, and every other rotation follows from it. */
export const LINEUP_SLOT_POSITIONS: readonly Position[] = [
  Position.Setter, Position.OutsideHitter, Position.MiddleBlocker,
  Position.Opposite, Position.OutsideHitter, Position.MiddleBlocker,
];

/**
 * Choose a starting seven, respecting the coach's preferred lineup but
 * replacing anyone injured, sold or otherwise unavailable with the best fit
 * alternative. A second, defensive libero is only ever used when the coach
 * has named one — nobody is auto-picked for that role.
 */
export function pickLineup(
  store: PlayerStore,
  club: Club,
): { lineup: number[]; libero: number; defensiveLibero: number; bench: number[] } {
  const available = club.players.filter((p) => store.isAvailable(p));
  const availableSet = new Set(available);
  const byPos = (pos: Position): number[] =>
    available
      .filter((p) => store.position[p] === pos)
      .sort((a, b) => {
        // Rested players get the nod over marginally better tired ones.
        const score = (i: number): number =>
          store.currentAbility[i] * (0.7 + 0.3 * (store.condition[i] / 100));
        return score(b) - score(a);
      });

  const pools: Partial<Record<Position, number[]>> = {
    [Position.Setter]: byPos(Position.Setter),
    [Position.Opposite]: byPos(Position.Opposite),
    [Position.OutsideHitter]: byPos(Position.OutsideHitter),
    [Position.MiddleBlocker]: byPos(Position.MiddleBlocker),
    [Position.Libero]: byPos(Position.Libero),
  };

  const used = new Set<number>();

  // Honour whichever named starters are still fit to play their slot; an
  // empty or stale preference (nobody has set one, or the player named for
  // it left, got injured, or changed position) just falls through below.
  const lineup: number[] = LINEUP_SLOT_POSITIONS.map((pos, slot) => {
    const preferred = club.preferredLineup[slot];
    if (
      preferred !== undefined && preferred >= 0
      && availableSet.has(preferred) && store.position[preferred] === pos
      && !used.has(preferred)
    ) {
      used.add(preferred);
      return preferred;
    }
    return -1;
  });

  // Anything the preference didn't cover: best remaining player at that slot's
  // position — the auto-pick rule this has always used.
  for (let slot = 0; slot < lineup.length; slot++) {
    if (lineup[slot] !== -1) continue;
    const pick = pools[LINEUP_SLOT_POSITIONS[slot]]?.find((p) => !used.has(p));
    if (pick !== undefined) { lineup[slot] = pick; used.add(pick); }
  }

  // A position wiped out entirely by injuries: fill with anyone still fit,
  // heavily penalised by playing out of position, which is the point.
  for (let slot = 0; slot < lineup.length; slot++) {
    if (lineup[slot] !== -1) continue;
    const spare = available.find((p) => !used.has(p));
    if (spare !== undefined) { lineup[slot] = spare; used.add(spare); }
  }

  const preferredLibero = club.preferredLibero;
  const libero =
    preferredLibero >= 0 && availableSet.has(preferredLibero)
    && store.position[preferredLibero] === Position.Libero && !used.has(preferredLibero)
      ? preferredLibero
      : pools[Position.Libero]?.find((p) => !used.has(p)) ?? -1;
  if (libero !== -1) used.add(libero);

  // If the reception libero was unavailable the defensive one may already have
  // been promoted into that role above; then one libero plays throughout.
  const preferredDefensive = club.preferredDefensiveLibero ?? -1;
  const defensiveLibero =
    libero !== -1 && preferredDefensive >= 0 && availableSet.has(preferredDefensive)
    && store.position[preferredDefensive] === Position.Libero && !used.has(preferredDefensive)
      ? preferredDefensive
      : -1;
  if (defensiveLibero !== -1) used.add(defensiveLibero);

  const finalLineup = lineup.filter((p) => p !== -1);
  const bench = available.filter((p) => !used.has(p));
  return { lineup: finalLineup, libero, defensiveLibero, bench };
}

export function toTeamSetup(store: PlayerStore, club: Club): TeamSetup {
  const { lineup, libero, defensiveLibero, bench } = pickLineup(store, club);
  return {
    clubId: club.id,
    name: club.name,
    lineup,
    libero,
    defensiveLibero,
    bench,
    tactics: club.tactics,
  };
}

/**
 * Play one fixture.
 *
 * `detailed` selects the full rally engine. It is set for the user's matches
 * and for anything they choose to watch.
 */
export function playFixture(
  world: World,
  ctx: SeasonContext,
  fixture: Fixture,
  detailed: boolean,
): void {
  const store = world.players;
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  if (home === undefined || away === undefined) return;

  if (detailed) {
    const result = simulateMatch(store, {
      home: toTeamSetup(store, home),
      away: toTeamSetup(store, away),
      format: fixture.format,
      importance: fixture.importance,
      neutralVenue: fixture.neutralVenue,
      collectLog: true,
      seed: world.rng.next(),
    });
    ctx.detailedResults.set(fixture.id, result);
    applyMatchResult(world, ctx, fixture, result);
    return;
  }

  const h = pickLineup(store, home);
  const a = pickLineup(store, away);
  const result = quickSimulate(store, h, a, fixture.format, world.rng, !fixture.neutralVenue);

  fixture.played = true;
  fixture.homeSets = result.homeSets;
  fixture.awaySets = result.awaySets;
  fixture.setScores = result.setScores;
  fixture.mvp = result.mvp;

  accumulate(ctx.stats, result.homeStats, result.setScores.length);
  accumulate(ctx.stats, result.awayStats, result.setScores.length);
  recordFixture(world, fixture, result.homeStats, result.awayStats);
  applyMatchLoad(store, result.homeStats, world.rng);
  applyMatchLoad(store, result.awayStats, world.rng);

  updateTable(world, fixture);
  applyMatchFinances(world, home, away, fixture);
}

/**
 * Commit a fully-resolved detailed match into the world: the fixture record,
 * season stats, fatigue, the league table and match-day finances. Shared by
 * `playFixture`'s detailed path and the live match viewer's finalize step,
 * so both commit results identically.
 */
export function applyMatchResult(
  world: World,
  ctx: SeasonContext,
  fixture: Fixture,
  result: MatchResult,
): void {
  fixture.played = true;
  fixture.homeSets = result.homeSets;
  fixture.awaySets = result.awaySets;
  fixture.setScores = result.setScores;
  fixture.mvp = result.mvp;

  const homeStats = result.stats.home.players;
  const awayStats = result.stats.away.players;
  accumulate(ctx.stats, homeStats, result.setScores.length);
  accumulate(ctx.stats, awayStats, result.setScores.length);
  recordFixture(world, fixture, homeStats, awayStats);
  applyMatchLoad(world.players, homeStats, world.rng);
  applyMatchLoad(world.players, awayStats, world.rng);

  updateTable(world, fixture);
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  if (home !== undefined && away !== undefined) applyMatchFinances(world, home, away, fixture);
}

function accumulate(
  season: SeasonStats,
  match: Map<number, PlayerMatchStats>,
  sets: number,
): void {
  for (const [p, s] of match) {
    let line = season.get(p);
    if (line === undefined) {
      line = newSeasonLine(p);
      season.set(p, line);
    }
    addToSeason(line, s, sets);
  }
}

/**
 * Playing costs fitness and risks injury.
 *
 * Injury chance rises with minutes played, age, and the hidden Injury
 * Proneness attribute, and falls with the club's medical facilities. Serious
 * injuries carry permanent consequences, applied at the point of recovery.
 */
function applyMatchLoad(store: PlayerStore, match: Map<number, PlayerMatchStats>, rng: Rng): void {
  for (const [p] of match) {
    const drop = rng.int(8, 18);
    store.condition[p] = Math.max(20, store.condition[p] - drop);
  }
}

function updateTable(world: World, fixture: Fixture): void {
  const comp = world.competitions[fixture.competitionId];
  // Playoff ties settle who plays whom next and, eventually, final standing —
  // they must never feed back into the regular-season table they were seeded
  // from.
  if (comp === undefined || comp.kind !== 'league' || fixture.round >= PLAYOFF_ROUND_BASE) return;

  const row = (clubId: number): LeagueTableRow | undefined =>
    comp.table.find((r) => r.clubId === clubId);
  const h = row(fixture.home);
  const a = row(fixture.away);
  if (h === undefined || a === undefined) return;

  const homeWon = fixture.homeSets > fixture.awaySets;
  const [wp, lp] = awardLeaguePoints(
    Math.max(fixture.homeSets, fixture.awaySets),
    Math.min(fixture.homeSets, fixture.awaySets),
  );

  h.played++; a.played++;
  h.setsFor += fixture.homeSets; h.setsAgainst += fixture.awaySets;
  a.setsFor += fixture.awaySets; a.setsAgainst += fixture.homeSets;
  for (const [hp, ap] of fixture.setScores) {
    h.pointsFor += hp; h.pointsAgainst += ap;
    a.pointsFor += ap; a.pointsAgainst += hp;
  }
  if (homeWon) {
    h.won++; a.lost++; h.points += wp; a.points += lp;
  } else {
    a.won++; h.lost++; a.points += wp; h.points += lp;
  }
}

/** Gate receipts and match-day costs. */
function applyMatchFinances(world: World, home: Club, away: Club, fixture: Fixture): void {
  const comp = world.competitions[fixture.competitionId];
  const draw = comp !== undefined ? Math.min(1, comp.reputation / 8000) : 0.5;
  const attendance = Math.round(
    home.arenaCapacity * (0.42 + 0.5 * draw) * world.rng.range(0.78, 1.08),
  );
  const gate = Math.round(
    Math.min(attendance, home.arenaCapacity) * (home.finances.ticketIncomePerMatch / Math.max(1, home.arenaCapacity)),
  );
  home.finances.balance += gate;
  home.finances.seasonIncome += gate;

  const travel = Math.round(away.finances.travelCosts / 26);
  away.finances.balance -= travel;
  away.finances.seasonExpenditure += travel;
}

// ---- Daily advance --------------------------------------------------------

export interface AdvanceOptions {
  /** Run the full rally engine for these clubs' matches. */
  detailedClubs?: Set<number>;
  /** Run the full engine for every top-flight match. Costs time. */
  detailTopFlight?: boolean;
}

/**
 * Advance the world one day.
 */
export function advanceDay(world: World, ctx: SeasonContext, opts: AdvanceOptions = {}): void {
  const store = world.players;
  const todays = world.fixturesByDay.get(world.day);

  if (todays !== undefined) {
    for (const fid of todays) {
      const f = world.fixtures[fid];
      if (f.played) continue;
      const comp = world.competitions[f.competitionId];
      const detailed =
        (opts.detailedClubs?.has(f.home) ?? false) ||
        (opts.detailedClubs?.has(f.away) ?? false) ||
        ((opts.detailTopFlight ?? false) && comp !== undefined && comp.tier === 1);
      playFixture(world, ctx, f, detailed);
    }
  }

  // Any press conference for a match just played goes stale unfinished; line
  // up tomorrow's, if the user's club has one, before the day rolls over.
  expireStaleInterviews(world);
  generateInterviewSessions(world, world.day + 1);

  dailyRecovery(world, store);
  progressPlayoffs(world);

  // Training and injury rolls happen on a weekly cadence rather than daily, so
  // their cost does not scale with how many matches were played.
  if (world.day % 7 === 0) {
    const phase = currentPhase(world);
    if (phase !== SeasonPhase.OffSeason) {
      weeklyTraining(world);
      rollInjuries(world);
      generateIncomingOffers(world);
    }
  }

  world.day++;
  if (world.day % DAYS_PER_SEASON === 0) world.year++;

  processScoutingQueue(world);
}

/**
 * Overnight recovery and injury countdown.
 *
 * Recovery is faster for players with high Recovery and Stamina and at clubs
 * with good medical facilities, which is what makes those attributes and that
 * investment worth anything over a long season.
 */
function dailyRecovery(world: World, store: PlayerStore): void {
  const medical = new Float64Array(world.clubs.length);
  for (const c of world.clubs) medical[c.id] = 0.8 + (c.medicalFacilities / 20) * 0.5;

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;

    if (store.injuryDaysLeft[i] > 0) {
      store.injuryDaysLeft[i]--;
      if (store.injuryDaysLeft[i] === 0) {
        store.injuryType[i] = 0;
        store.setFlag(i, PlayerFlag.Injured, false);
        // Players come back short of match fitness.
        store.condition[i] = Math.min(store.condition[i], 65);
      }
      continue;
    }

    if (store.condition[i] < 100) {
      const club = store.clubId[i];
      const rate = club >= 0 ? medical[club] : 1;
      const recovery = 2.2 + (store.getAttr(i, 'recovery') / 20) * 3.4;
      store.condition[i] = Math.min(100, store.condition[i] + recovery * rate);
    }
  }
}

/**
 * Lay out every domestic league for the coming season.
 */
export function startSeason(world: World, ctx?: SeasonContext): void {
  const seasonStart = world.season * DAYS_PER_SEASON;
  for (const comp of world.competitions) {
    if (comp.kind !== 'league') continue;
    scheduleLeagueSeason(world, comp, seasonStart, world.rng);
  }

  if (ctx !== undefined) {
    const store = world.players;
    ctx.seasonStartAbility.clear();
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i)) continue;
      ctx.seasonStartAbility.set(i, store.currentAbility[i]);
    }
  }
}

/** Advance until the given absolute day, or until the season ends. */
export function advanceTo(
  world: World,
  ctx: SeasonContext,
  targetDay: number,
  opts: AdvanceOptions = {},
): void {
  while (world.day < targetDay) advanceDay(world, ctx, opts);
}

/** Run the remainder of the current season's fixtures. */
export function simulateRestOfSeason(
  world: World,
  ctx: SeasonContext,
  opts: AdvanceOptions = {},
): void {
  const seasonEnd = (world.season + 1) * DAYS_PER_SEASON;
  while (world.day < seasonEnd && currentPhase(world) !== SeasonPhase.OffSeason) {
    advanceDay(world, ctx, opts);
  }
  while (world.day < seasonEnd) {
    world.day++;
    if (world.day % DAYS_PER_SEASON === 0) world.year++;
  }
}

export function isSeasonOver(world: World): boolean {
  return dayOfSeason(world) >= 350;
}
