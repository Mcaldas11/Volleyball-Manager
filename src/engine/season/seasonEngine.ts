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

import { agentsDay } from '../world/agents.ts';
import { recruitmentDay } from '../world/recruitment.ts';
import { delegationDay } from '../world/delegation.ts';
import { directorDay } from '../world/director.ts';
import { blockedMovesDay } from '../world/blockedMoves.ts';
import { staffMeetingDay } from '../world/staffMeeting.ts';
import { matchPreviews } from '../world/matchPreview.ts';
import { campDay } from '../world/camp.ts';
import { predictionsDay } from '../world/predictions.ts';
import { calendarOf } from '../world/calendar.ts';
import { watchedInMatch } from '../world/nationalExtras.ts';
import { deadlineDay, deadlineMorning, rumoursAboutUs } from '../world/market.ts';
import { achievementsDay } from '../world/achievements.ts';
import { coursesDay } from '../world/courses.ts';
import { arenaDay, fanFactor, fansAfterMatch, supportersWeek } from '../world/supporters.ts';
import { ownerDay, ownerSeasonStart } from '../world/owners.ts';
import { closeInjuryCase, relapseAfterMatch } from '../world/treatment.ts';
import { mentoringWeek } from '../world/mentoring.ts';
import { ebbLoads, noteMatchLoad, recoveryFactor, travelEve } from '../world/fatigue.ts';
import { fixtureRivalry } from '../world/rivals.ts';
import { internationalDay } from '../world/internationals.ts';
import { keepMatchReport } from '../world/matchReports.ts';
import { noteAnalysis } from '../world/analysis.ts';
import { newsDay } from '../world/news.ts';
import type { Rng } from '../core/rng.ts';
import { selectionScore } from '../model/ability.ts';
import { awardLeaguePoints, type Club, type LeagueTableRow } from '../model/club.ts';
import { PlayerFlag, type PlayerStore } from '../model/players.ts';
import { MATCHDAY_SQUAD, Position } from '../model/positions.ts';
import { simulateMatch, type MatchResult, type TeamSetup } from '../match/engine.ts';
import { formationOf, lineupSlotPositions, type TeamTactics } from '../match/tactics.ts';
import { addToSeason, newSeasonLine, type PlayerMatchStats, type SeasonStatLine } from '../match/stats.ts';
import { DAYS_PER_SEASON, currentPhase, dayOfSeason, SeasonPhase, type Fixture, type World } from '../world/world.ts';
import { PLAYOFF_ROUND_BASE, scheduleLeagueSeason } from './schedule.ts';
import { quickSimulate } from './quickSim.ts';
import { progressPlayoffs } from './playoffs.ts';
import { progressCups, scheduleCupSeason } from './cups.ts';
import { friendliesDay, isFriendly } from './friendlies.ts';
import { POSITION_MATCH, prepCoverage, trainingDay, trainPositions } from '../world/training.ts';
import { youthDay } from '../world/youth.ts';
import {
  applyMatchInjuries, matchInjuryRng, quickMatchInjuries, rollInjuries, weeklyTraining,
} from '../world/progression.ts';
import { processScoutingQueue } from '../world/scouting.ts';
import { generateIncomingOffers, generateListedBids } from '../world/negotiation.ts';
import { generateLoanOffers, loanOf, loanStarters, reviewLoanPromises } from '../world/loans.ts';
import { contractNotices } from '../world/contracts.ts';
import { generateClauseBids, processDeals } from '../world/deals.ts';
import { payAppearanceBonuses } from '../world/contractTerms.ts';
import { expireStaleInterviews, generateInterviewSessions, generateNationalInterviewSessions } from '../world/interviews.ts';
import { monthlyLoanReports, monthlyStatement, recoveryNotice, roundupNotices, tacticReadNotice } from '../world/inbox.ts';
import { readLevel, studyTactic } from '../model/tacticRead.ts';
import { recordFixture } from '../world/records.ts';
import { collectHighlights, inManagersLeague } from '../world/monthAwards.ts';
import { competitionReviewsDay } from '../world/competitionReview.ts';
import { boardResults, careerDay, setBoardExpectations } from '../world/career.ts';
import { coachesSetUp } from '../world/aiTactics.ts';
import { analysisEdge, medicalQuality, staffDay, topUpStaffPool } from '../world/staffMarket.ts';
import { processStaffDeals } from '../world/staffDeals.ts';
import { chemistryFor, noteTogether } from '../world/chemistry.ts';
import { cohesionEdge, cohesionOf, dressingRoomWeek } from '../world/dressingRoom.ts';
import { changesOfMind, playerHappinessWeek } from '../world/playerTalks.ts';
import { reportsDay } from '../world/reports.ts';
import { crowdAt, sponsorDay, ticketPriceOf } from '../world/commercial.ts';
import { facilitiesDay } from '../world/facilities.ts';
import { affiliatesDay } from '../world/affiliates.ts';
import { retirementDay } from '../world/retirement.ts';
import { noteExpectations } from '../world/accolades.ts';

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

export { LINEUP_SLOT_POSITIONS, LINEUP_SLOT_POSITIONS_42, lineupSlotPositions } from '../match/tactics.ts';

/**
 * Choose a starting seven, respecting the coach's preferred lineup but
 * replacing anyone injured, sold or otherwise unavailable with the best fit
 * alternative. A second, defensive libero is only ever used when the coach
 * has named one — nobody is auto-picked for that role. `mustStart` names
 * players who start ahead of anyone, if fit: loanees owed the games their
 * loan promised (see loanStarters).
 */
export function pickLineup(
  store: PlayerStore,
  club: Pick<Club, 'players' | 'preferredLineup' | 'preferredLibero' | 'preferredDefensiveLibero'>
    & { tactics?: Pick<TeamTactics, 'formation'>; preferredFormation?: Club['preferredFormation']; preferredBench?: number[] },
  mustStart?: ReadonlySet<number>,
  /** Who can play — a club's fit players by default; a national team's own. */
  canPlay: (p: number) => boolean = (p) => store.isAvailable(p),
): { lineup: number[]; libero: number; defensiveLibero: number; bench: number[]; out: number[] } {
  const SLOTS = lineupSlotPositions(formationOf(club.tactics));
  const available = club.players.filter(canPlay);
  const availableSet = new Set(available);
  const byPos = (pos: Position): number[] =>
    available
      .filter((p) => store.position[p] === pos)
      // Rested players get the nod over marginally better tired ones.
      .sort((a, b) => selectionScore(store, b) - selectionScore(store, a));

  const pools: Partial<Record<Position, number[]>> = {
    [Position.Setter]: byPos(Position.Setter),
    [Position.Opposite]: byPos(Position.Opposite),
    [Position.OutsideHitter]: byPos(Position.OutsideHitter),
    [Position.MiddleBlocker]: byPos(Position.MiddleBlocker),
    [Position.Libero]: byPos(Position.Libero),
  };

  const used = new Set<number>();
  const lineup: number[] = SLOTS.map(() => -1);

  // Anyone who must start takes the first slot in his position.
  let forcedLibero = -1;
  for (const p of mustStart ?? []) {
    if (!availableSet.has(p) || used.has(p)) continue;
    if (store.position[p] === Position.Libero) {
      if (forcedLibero < 0) { forcedLibero = p; used.add(p); }
      continue;
    }
    const slot = SLOTS.findIndex((pos, s) => pos === store.position[p] && lineup[s] === -1);
    if (slot >= 0) { lineup[slot] = p; used.add(p); }
  }

  // Honour whichever named starters are still fit to play their slot — in
  // whatever slot the manager put them, if he picked the six by hand for this
  // system: whoever starts in a slot plays its position. An empty or stale
  // preference (nobody has set one, the player named for it left or got
  // injured, or it was made for the other system) just falls through below.
  const byHand = club.preferredFormation !== undefined && club.preferredFormation === formationOf(club.tactics);
  SLOTS.forEach((pos, slot) => {
    if (lineup[slot] !== -1) return;
    const preferred = club.preferredLineup[slot];
    if (
      preferred !== undefined && preferred >= 0
      && availableSet.has(preferred) && (byHand || store.position[preferred] === pos)
      && !used.has(preferred)
    ) {
      used.add(preferred);
      lineup[slot] = preferred;
    }
  });

  // Anything the preference didn't cover: best remaining player at that slot's
  // position — the auto-pick rule this has always used.
  for (let slot = 0; slot < lineup.length; slot++) {
    if (lineup[slot] !== -1) continue;
    const pick = pools[SLOTS[slot]]?.find((p) => !used.has(p));
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
  const libero = forcedLibero >= 0
    ? forcedLibero
    : preferredLibero >= 0 && availableSet.has(preferredLibero) && !used.has(preferredLibero)
      ? preferredLibero
      : pools[Position.Libero]?.find((p) => !used.has(p)) ?? -1;
  if (libero !== -1) used.add(libero);

  // If the reception libero was unavailable the defensive one may already have
  // been promoted into that role above; then one libero plays throughout.
  const preferredDefensive = club.preferredDefensiveLibero ?? -1;
  const defensiveLibero =
    libero !== -1 && preferredDefensive >= 0 && availableSet.has(preferredDefensive) && !used.has(preferredDefensive)
      ? preferredDefensive
      : -1;
  if (defensiveLibero !== -1) used.add(defensiveLibero);

  const finalLineup = lineup.filter((p) => p !== -1);
  const bench = pickBench(store, club, available.filter((p) => !used.has(p)),
    MATCHDAY_SQUAD - finalLineup.length - (libero >= 0 ? 1 : 0) - (defensiveLibero >= 0 ? 1 : 0), defensiveLibero < 0);
  const named = new Set(bench);
  const out = available.filter((p) => !used.has(p) && !named.has(p));
  return { lineup: finalLineup, libero, defensiveLibero, bench, out };
}

/** Cover each position wants on the bench, in the order it is filled. */
const BENCH_COVER: ReadonlyArray<readonly [Position, number]> = [
  [Position.Setter, 1], [Position.OutsideHitter, 1], [Position.MiddleBlocker, 1], [Position.Opposite, 1],
  [Position.OutsideHitter, 2], [Position.MiddleBlocker, 2],
];

/**
 * The reserves named for a match, `room` of them at most. A coach who has
 * named his own gets them — and, for any who can't play, the next best fit.
 * Otherwise cover for each position — a setter, an outside, a middle, an
 * opposite, a second outside and middle — and a spare libero when only one
 * plays; then the best of the rest. Everyone else watches from the stand.
 */
function pickBench(
  store: PlayerStore,
  club: { preferredBench?: number[] },
  rest: number[],
  room: number,
  spareLibero: boolean,
): number[] {
  const bench: number[] = [];
  const limit = Math.min(room, club.preferredBench?.length ?? room);
  if (limit <= 0) return bench;
  const ranked = [...rest].sort((a, b) => selectionScore(store, b) - selectionScore(store, a));
  const take = (p: number | undefined): void => {
    if (p !== undefined && bench.length < limit && !bench.includes(p)) bench.push(p);
  };
  for (const p of club.preferredBench ?? []) if (rest.includes(p)) take(p);
  const count = (pos: Position): number => bench.filter((p) => store.position[p] === pos).length;
  for (const [pos, want] of BENCH_COVER) {
    if (count(pos) < want) take(ranked.find((p) => store.position[p] === pos && !bench.includes(p)));
  }
  if (spareLibero && count(Position.Libero) === 0) take(ranked.find((p) => store.position[p] === Position.Libero));
  // The best of the rest — a libero beyond the spare only plays in the six, so last.
  for (const p of ranked) if (store.position[p] !== Position.Libero) take(p);
  for (const p of ranked) take(p);
  return bench;
}

/** What a club worked on for a match in the days before it. */
export function matchPrep(world: World, club: Club, day: number): TeamSetup['prep'] {
  // The analyst's study of the opposition adds to whatever the week's training covered.
  const prep = prepCoverage(world, club, day);
  const edge = analysisEdge(world, club);
  if (edge === 0) return prep;
  return {
    reception: Math.min(1, prep.reception + edge), transition: Math.min(1, prep.transition + edge),
    block: Math.min(1, prep.block + edge), combinations: Math.min(1, (prep.combinations ?? 0) + edge),
  };
}

/** How well the opposition reads a club's tactic: the user's, which every side studies — nobody else's. */
export function oppositionRead(world: World, club: Club): number {
  return club.id === world.userClubId ? readLevel(club.tacticRead, club.tactics) : 0;
}

/** The league has watched the user's club play once more — and the assistant speaks up as they get to know it. */
function opponentsStudy(world: World, fixture: Fixture): void {
  const club = world.clubs[world.userClubId];
  if (club === undefined || (fixture.home !== club.id && fixture.away !== club.id)) return;
  club.tacticRead ??= { seen: {} };
  studyTactic(club.tacticRead, club.tactics);
  tacticReadNotice(world, club);
}

export function toTeamSetup(store: PlayerStore, club: Club, mustStart?: ReadonlySet<number>): TeamSetup {
  const { lineup, libero, defensiveLibero, bench } = pickLineup(store, club, mustStart);
  return {
    clubId: club.id,
    name: club.name,
    lineup,
    libero,
    defensiveLibero,
    bench,
    tactics: club.tactics,
    promised: mustStart !== undefined && mustStart.size > 0 ? [...mustStart] : undefined,
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

  // A club that has promised a loanee games gives them.
  const homeOwed = loanStarters(world, home);
  const awayOwed = loanStarters(world, away);

  // Friendlies are only ever the user's, and always played in full. So is
  // every match in the user's own league: its best points and plays go in
  // the running for the month's awards — kept, not the whole log.
  const friendly = isFriendly(world, fixture);
  const ownLeague = inManagersLeague(world, fixture);
  if (detailed || friendly || ownLeague) {
    const result = simulateMatch(store, {
      home: {
        ...toTeamSetup(store, home, homeOwed), read: oppositionRead(world, home), prep: matchPrep(world, home, fixture.day),
        roomEdge: cohesionEdge(cohesionOf(world, home.id)), chemistry: chemistryFor(world),
      },
      away: {
        ...toTeamSetup(store, away, awayOwed), read: oppositionRead(world, away), prep: matchPrep(world, away, fixture.day),
        roomEdge: cohesionEdge(cohesionOf(world, away.id)), chemistry: chemistryFor(world),
      },
      format: fixture.format,
      importance: fixture.importance,
      neutralVenue: fixture.neutralVenue,
      collectLog: detailed || friendly,
      // The manager's own matches anywhere, and his league's: their best moments are kept.
      highlights: ownLeague || (detailed && !friendly),
      seed: world.rng.next(),
      // Nobody is on the bench to make the changes: the engine makes them for both sides.
      autoCoach: [true, true],
      friendly,
    });
    if (detailed || friendly) ctx.detailedResults.set(fixture.id, result);
    applyMatchResult(world, ctx, fixture, result);
    return;
  }

  const h = pickLineup(store, home, homeOwed);
  const a = pickLineup(store, away, awayOwed);
  const result = quickSimulate(store, h, a, fixture.format, world.rng, !fixture.neutralVenue);

  fixture.played = true;
  fixture.homeSets = result.homeSets;
  fixture.awaySets = result.awaySets;
  fixture.setScores = result.setScores;
  fixture.mvp = result.mvp;

  accumulate(ctx.stats, result.homeStats, result.setScores.length);
  accumulate(ctx.stats, result.awayStats, result.setScores.length);
  recordFixture(world, fixture, result.homeStats, result.awayStats, 'quick');
  // What it did to its players: the same risks as a match watched, rolled on its own dice.
  const hurt = matchInjuryRng(world, fixture.id, fixture.day);
  applyMatchInjuries(world, quickMatchInjuries(world, [result.homeStats, result.awayStats], hurt), hurt);
  applyMatchLoad(store, result.homeStats, world.rng);
  applyMatchLoad(store, result.awayStats, world.rng);

  updateTable(world, fixture);
  applyMatchFinances(world, home, away, fixture);
  aftermath(world, fixture, result.homeStats, result.awayStats, true);
  opponentsStudy(world, fixture);
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
  collectHighlights(world, fixture, result);
  // The manager's own matches: the box score is kept, to be read again — and the analyst takes his notes.
  keepMatchReport(world, fixture, result);
  noteAnalysis(world, fixture, result);

  const homeStats = result.stats.home.players;
  const awayStats = result.stats.away.players;
  // Playing out of position teaches it, a match at a time.
  for (const [p, role] of result.roles ?? []) {
    if (role === world.players.position[p]) continue;
    const s = homeStats.get(p) ?? awayStats.get(p);
    if (s === undefined || s.ralliesPlayed === 0) continue;
    world.players.setFamiliarity(p, role, world.players.familiarityWith(p, role) + POSITION_MATCH);
  }
  // A friendly is for the practice: it tires the legs and fills the stands,
  // and goes on no table, no record and nobody's statistics.
  if (isFriendly(world, fixture)) {
    aftermath(world, fixture, homeStats, awayStats, false);
    applyMatchLoad(world.players, homeStats, world.rng);
    applyMatchLoad(world.players, awayStats, world.rng);
    const home = world.clubs[fixture.home];
    const away = world.clubs[fixture.away];
    if (home !== undefined && away !== undefined) applyMatchFinances(world, home, away, fixture);
    return;
  }
  accumulate(ctx.stats, homeStats, result.setScores.length);
  accumulate(ctx.stats, awayStats, result.setScores.length);
  recordFixture(world, fixture, homeStats, awayStats);
  // Who got hurt, and how it ended — off, played on with it, worse.
  applyMatchInjuries(world, result.injuries ?? [], matchInjuryRng(world, fixture.id, fixture.day));
  applyMatchLoad(world.players, homeStats, world.rng);
  applyMatchLoad(world.players, awayStats, world.rng);

  updateTable(world, fixture);
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  if (home !== undefined && away !== undefined) applyMatchFinances(world, home, away, fixture);
  aftermath(world, fixture, homeStats, awayStats, true);
  opponentsStudy(world, fixture);
}

/**
 * What a match leaves behind besides the result, however it was played: the
 * match in the legs of everyone who took part — and, for a competitive one,
 * the appearance bonuses earned and a derby's mood in both dressing rooms.
 */
function aftermath(
  world: World, fixture: Fixture,
  homeStats: Map<number, PlayerMatchStats>, awayStats: Map<number, PlayerMatchStats>, competitive: boolean,
): void {
  // Anyone the national coach came to watch.
  watchedInMatch(world, fixture, homeStats, awayStats);
  const took = (m: Map<number, PlayerMatchStats>): number[] => [...m].filter(([, s]) => s.ralliesPlayed > 0).map(([p]) => p);
  const home = took(homeStats);
  const away = took(awayStats);
  noteMatchLoad(world, [...home, ...away]);
  // Setters and hitters on court together learn each other's timing.
  noteTogether(world, homeStats, awayStats);
  // A player rushed back from an injury may break down again.
  relapseAfterMatch(world, fixture.id, [...home, ...away]);
  if (!competitive) return;
  fansAfterMatch(world, fixture);
  payAppearanceBonuses(world, fixture.home, home);
  payAppearanceBonuses(world, fixture.away, away);
  // A derby won lifts a dressing room for days; one lost hurts as long.
  if (fixtureRivalry(world, fixture) !== null) {
    const homeWon = fixture.homeSets > fixture.awaySets;
    for (const [side, won] of [[home, homeWon], [away, !homeWon]] as const) {
      for (const p of side) world.players.morale[p] = Math.max(0, Math.min(100, world.players.morale[p] + (won ? 5 : -5)));
    }
  }
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
  // The price brings the crowd, or keeps it away — and each pays it.
  const price = ticketPriceOf(home);
  // A derby fills the place.
  const derby = fixtureRivalry(world, fixture) !== null ? 1.35 : 1;
  // A following bigger than the arena fills it; a dwindled one leaves seats empty.
  const attendance = crowdAt(home.arenaCapacity * (0.42 + 0.5 * draw) * derby * fanFactor(home) * world.rng.range(0.78, 1.08), price);
  const gate = Math.round(
    Math.min(attendance, home.arenaCapacity) * (home.finances.ticketIncomePerMatch / Math.max(1, home.arenaCapacity)) * price,
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

  // The month's books, transfer windows opening and shutting, contracts
  // running down, the answers to every offer that is due today — and the
  // job market: applications answered, coaches appointed, boards meeting.
  monthlyStatement(world);
  // The third of the month: the staff meet, and bring the manager their suggestions.
  staffMeetingDay(world);
  facilitiesDay(world);
  arenaDay(world);
  coursesDay(world);
  achievementsDay(world);
  ownerDay(world);
  sponsorDay(world);
  affiliatesDay(world);
  monthlyLoanReports(world);
  contractNotices(world);
  // Deadline day: the bids fly in and the other clubs do their late business, before the day's answers.
  deadlineDay(world);
  processDeals(world);
  // The director's next move wherever an answer has come back — and whatever the delegates have to do.
  directorDay(world);
  blockedMovesDay(world);
  delegationDay(world);
  // The scouts' missions: a report each week. And the agents' own business.
  recruitmentDay(world);
  agentsDay(world);
  careerDay(world);
  staffDay(world);
  processStaffDeals(world);
  retirementDay(world);
  friendliesDay(world);
  trainingDay(world);
  campDay(world);
  youthDay(world);

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
    // Including a match of the user's already played live earlier today.
    roundupNotices(world, todays);
    // Every result weighs on its clubs' boards — the user's may act on it.
    boardResults(world, todays);
  }

  // The national teams' tournaments, and what the papers make of the day.
  internationalDay(world);
  newsDay(world, (todays ?? []).map((id) => world.fixtures[id]));
  predictionsDay(world);

  // Any press conference for a match just played goes stale unfinished; line
  // up tomorrow's, if the user's club or national team has one, before the day rolls over.
  expireStaleInterviews(world);
  generateInterviewSessions(world, world.day + 1);
  generateNationalInterviewSessions(world, world.day + 1);
  // Tomorrow's match: the analysts' odds and the fans' calls.
  matchPreviews(world, world.day + 1);

  dailyRecovery(world, store);
  progressPlayoffs(world);
  progressCups(world);
  // A competition just finished gets its review; one about to start, a look at its field.
  competitionReviewsDay(world);
  // The staff's reports: the national squad's club form, the ranking, the assistant's week, the next opponent.
  reportsDay(world);

  // Training and injury rolls happen on a weekly cadence rather than daily, so
  // their cost does not scale with how many matches were played.
  if (world.day % 7 === 0) {
    const phase = currentPhase(world);
    if (phase !== SeasonPhase.OffSeason) {
      weeklyTraining(world);
      mentoringWeek(world);
      supportersWeek(world);
      dressingRoomWeek(world);
      playerHappinessWeek(world);
      changesOfMind(world);
      trainPositions(world);
      rollInjuries(world);
      generateIncomingOffers(world);
      rumoursAboutUs(world);
      generateClauseBids(world);
      generateListedBids(world);
      generateLoanOffers(world);
      reviewLoanPromises(world);
    }
  }

  world.day++;
  if (world.day % DAYS_PER_SEASON === 0) world.year++;
  // Sides playing away tomorrow travel today.
  travelEve(world);
  // The morning of deadline day.
  deadlineMorning(world);

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
  // The facilities and the physios and doctor who work in them.
  for (const c of world.clubs) medical[c.id] = 0.8 + medicalQuality(world, c) * 0.5;
  // The matches in everyone's legs ebb away a little.
  ebbLoads(world);

  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;

    if (store.injuryDaysLeft[i] > 0) {
      store.injuryDaysLeft[i]--;
      if (store.injuryDaysLeft[i] === 0) {
        store.injuryType[i] = 0;
        store.setFlag(i, PlayerFlag.Injured, false);
        // Players come back short of match fitness — how short, as the manager had him treated.
        store.condition[i] = world.injuryCases?.[i] !== undefined ? closeInjuryCase(world, i) : Math.min(store.condition[i], 65);
        if (store.clubId[i] === world.userClubId && world.userClubId >= 0) {
          recoveryNotice(world, i);
        } else if (world.loans.length > 0 && loanOf(world, i)?.parentClubId === world.userClubId && world.userClubId >= 0) {
          // One of his out on loan: his club still wants to know.
          recoveryNotice(world, i, world.clubs[store.clubId[i]]);
        }
      }
      continue;
    }

    if (store.condition[i] < 100) {
      const club = store.clubId[i];
      const rate = club >= 0 ? medical[club] : 1;
      const recovery = 2.2 + (store.getAttr(i, 'recovery') / 20) * 3.4;
      // A crowded run of matches slows it.
      store.condition[i] = Math.min(100, store.condition[i] + recovery * rate * recoveryFactor(world, i));
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
  // Cups and continental competitions fit around the league calendar.
  scheduleCupSeason(world);
  // Every board sets its target for the season, the divisions settled.
  setBoardExpectations(world);
  // And every other coach sets his side up for the players the summer left him.
  coachesSetUp(world, (club) => pickLineup(world.players, club).lineup);
  // People out of work in every backroom role, for anyone hiring.
  topUpStaffPool(world);
  // Where each squad should finish, for the Coach of the Year to be judged against.
  noteExpectations(world);
  // The manager's club may change hands; its owner sets his wish for the season.
  ownerSeasonStart(world);

  if (ctx !== undefined) recordSeasonStartAbility(world, ctx);
}

/** Note every active player's ability as it stands now, as the baseline for the "most improved" award. */
export function recordSeasonStartAbility(world: World, ctx: SeasonContext): void {
  const store = world.players;
  ctx.seasonStartAbility.clear();
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i)) continue;
    ctx.seasonStartAbility.set(i, store.currentAbility[i]);
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
  while (world.day < seasonEnd && !isSeasonOver(world)) {
    advanceDay(world, ctx, opts);
  }
  while (world.day < seasonEnd) {
    world.day++;
    if (world.day % DAYS_PER_SEASON === 0) world.year++;
  }
}

/** Whether the season is to be closed today: on the 30 June, or for an old save's season the 16 June. */
export function isSeasonOver(world: World): boolean {
  return dayOfSeason(world) >= calendarOf(world).rollover;
}
