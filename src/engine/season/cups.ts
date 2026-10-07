/**
 * Cup competitions.
 *
 * Alongside its league every club plays for silverware: its national cup, and
 * the super cup between last season's league and cup winners that opens the
 * next one. The best go further — Europe's Champions League and CEV Cup, each
 * other confederation's club championship — and every fourth year the
 * continental champions meet in December at the Club World Championship,
 * open to clubs from anywhere.
 *
 * Every one is the same machine: an optional group stage, then a knockout on
 * the bracket the league playoffs use. Each match is fitted around the
 * leagues, on a day with no other match either side of it for either club,
 * and the whole thing is over before the league playoffs begin.
 */

import { awardLeaguePoints, compareTableRows, newTableRow, type LeagueTableRow } from '../model/club.ts';
import { MatchFormat } from '../match/engine.ts';
import { formatDay, ordinal, postMessage } from '../world/inbox.ts';
import { NATIONS, type Confederation } from '../world/nations.ts';
import {
  addFixture, DAYS_PER_SEASON, euros,
  type Competition, type CompetitionKind, type CupGroup, type CupState, type Fixture, type PlayoffGroup,
  type PlayoffTie, type World,
} from '../world/world.ts';
import { buildFirstRound, buildNextRound, computeFinalOrder, finalStandingsOrder, playoffTieOf } from './playoffs.ts';
import { PLAYOFF_ROUND_BASE, roundRobin } from './schedule.ts';

// ---- Formats ----------------------------------------------------------------

interface CupFormat {
  /** Clubs in the draw. */
  size: number;
  /** Groups in the group stage; 0 for a straight knockout. */
  groups: number;
  /** Everyone plays everyone in their group home and away, or just once. */
  doubleRoundRobin: boolean;
  /** Group matchdays, in days of the season (0 = 1 July). */
  groupDays: number[];
  /** Knockout rounds, in days of the season, ending with the final. */
  knockoutDays: number[];
  neutral: CupState['neutral'];
  prizePool: number;
  reputation: number;
}

/** A national cup's rounds, latest last: a smaller draw starts later. */
const NATIONAL_CUP_DAYS = [78, 118, 158, 200, 240];

/** Nothing of any cup is played after this day of the season — the league
 *  playoffs start at 272 and are scheduled without looking for gaps. */
const LAST_CUP_DAY = 266;

const CONFEDERATIONS: readonly Confederation[] = ['CEV', 'CSV', 'NORCECA', 'AVC', 'CAVB'];

const CONTINENTAL_NAMES: Readonly<Record<string, string>> = {
  'CEV:1': 'Champions League',
  'CEV:2': 'CEV Cup',
  'CSV:1': 'South American Club Championship',
  'NORCECA:1': 'NORCECA Club Championship',
  'AVC:1': 'Asian Club Championship',
  'CAVB:1': 'African Club Championship',
};

/** Places per nation, strongest nation first: the Champions League, then the
 *  CEV Cup (from the next clubs down each table), then every other
 *  confederation's championship. */
const SLOTS: Readonly<Record<string, readonly number[]>> = {
  'CEV:1': [3, 3, 2, 2, 2, 1, 1, 1, 1],
  'CEV:2': [2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  other: [2, 2, 1, 1, 1, 1],
};

function formatFor(comp: Competition, entrants: number): CupFormat {
  const key = comp.key ?? '';
  if (key === 'cont:CEV:1') {
    return {
      size: 16, groups: 4, doubleRoundRobin: true,
      groupDays: [88, 102, 116, 130, 144, 158], knockoutDays: [205, 230, 255],
      neutral: 'final', prizePool: 2_500_000, reputation: 9500,
    };
  }
  if (key === 'cont:CEV:2') {
    return {
      size: 16, groups: 0, doubleRoundRobin: false,
      groupDays: [], knockoutDays: [95, 137, 186, 236],
      neutral: 'final', prizePool: 700_000, reputation: 7500,
    };
  }
  if (comp.kind === 'continental') {
    return {
      size: 8, groups: 2, doubleRoundRobin: false,
      groupDays: [110, 140, 196], knockoutDays: [222, 250],
      neutral: 'final', prizePool: 450_000, reputation: 7000,
    };
  }
  if (comp.kind === 'clubworld') {
    return {
      size: 8, groups: 2, doubleRoundRobin: false,
      groupDays: [163, 167, 171], knockoutDays: [176, 181],
      neutral: 'all', prizePool: 1_500_000, reputation: 10000,
    };
  }
  if (comp.kind === 'supercup') {
    return {
      size: 2, groups: 0, doubleRoundRobin: false,
      groupDays: [], knockoutDays: [48],
      neutral: 'all', prizePool: comp.prizePool, reputation: comp.reputation,
    };
  }
  // A national cup: as many rounds as the draw needs, ending with the final.
  const rounds = knockoutRounds(entrants);
  return {
    size: 32, groups: 0, doubleRoundRobin: false,
    groupDays: [], knockoutDays: NATIONAL_CUP_DAYS.slice(-Math.max(1, rounds)),
    neutral: 'final', prizePool: comp.prizePool, reputation: comp.reputation,
  };
}

/** Rounds a knockout of `entrants` clubs needs. */
export function knockoutRounds(entrants: number): number {
  let size = 1;
  let rounds = 0;
  while (size < entrants) { size *= 2; rounds++; }
  return rounds;
}

/** "Final", "Semi-final"… for a knockout round, counting back from the final. */
export function knockoutRoundName(roundIdx: number, totalRounds: number): string {
  switch (totalRounds - roundIdx) {
    case 1: return 'Final';
    case 2: return 'Semi-final';
    case 3: return 'Quarter-final';
    case 4: return 'Round of 16';
    case 5: return 'Round of 32';
    default: return `Round ${roundIdx + 1}`;
  }
}

/**
 * Whether the Club World Championship is played in the season starting in
 * `year` — every fourth December, from 2026: 2026, 2030, 2034…
 */
export function clubWorldYear(year: number): boolean {
  return ((year - 2026) % 4 + 4) % 4 === 0;
}

/**
 * A Club World Championship drawn for a season that isn't one of its years —
 * in a save from before it went to every four years — is called off: its
 * matches not yet played come off the calendar, and the entrants go home.
 */
export function cancelOffCycleClubWorld(world: World): void {
  const comp = world.competitions.find((c) => c.kind === 'clubworld');
  if (comp?.cup === undefined || clubWorldYear(world.startYear + comp.cup.season)) return;
  for (const id of comp.fixtureIds) {
    const f = world.fixtures[id];
    if (f === undefined || f.played) continue;
    const list = world.fixturesByDay.get(f.day);
    if (list !== undefined) world.fixturesByDay.set(f.day, list.filter((x) => x !== id));
    f.day = -1;
  }
  comp.fixtureIds = comp.fixtureIds.filter((id) => world.fixtures[id]?.played === true);
  comp.cup = undefined;
  comp.participants = [];
}

/** The year of the next Club World Championship from the season starting in `year` on, that one included. */
export function nextClubWorldYear(year: number): number {
  let y = year;
  while (!clubWorldYear(y)) y++;
  return y;
}

export function isCupCompetition(comp: Competition): boolean {
  return comp.kind === 'cup' || comp.kind === 'supercup' || comp.kind === 'continental' || comp.kind === 'clubworld';
}

// ---- Creating the competitions ------------------------------------------------

function topFlight(world: World, nation: number): Competition | undefined {
  return world.competitions.find((c) => c.kind === 'league' && c.nation === nation && c.tier === 1);
}

/** Tier-one clubs of a nation, best first: the season's final order once one
 *  has been played, reputation before that. */
function topFlightOrder(world: World, nation: number, fromStandings: boolean): number[] {
  const league = topFlight(world, nation);
  if (league === undefined) return [];
  if (fromStandings && league.table.some((r) => r.played > 0)) return finalStandingsOrder(league);
  return [...league.participants].sort((a, b) => world.clubs[b].reputation - world.clubs[a].reputation);
}

function newCupCompetition(
  world: World, key: string, name: string, kind: CompetitionKind, nation: number, organizer: string,
  reputation: number, prizePool: number,
): Competition {
  const comp: Competition = {
    id: world.competitions.length,
    name,
    kind,
    key,
    organizer,
    nation,
    tier: 0,
    participants: [],
    table: [],
    fixtureIds: [],
    reputation,
    promotionSlots: 0,
    relegationSlots: 0,
    hasPlayoffs: false,
    playoffTeams: 0,
    champion: -1,
    prizePool,
    playoffGroups: [],
  };
  world.competitions.push(comp);
  return comp;
}

/**
 * Make sure the world has every cup competition: each nation's cup and super
 * cup, the continental club competitions and the Club World Championship.
 * Safe to call on any world — new ones are drawn up from scratch, an older
 * save gets whatever it is missing (and its unscheduled continental cups are
 * brought into line); either way they start with the next season.
 */
export function ensureCupCompetitions(world: World): void {
  const byKey = new Map(world.competitions.filter((c) => c.key !== undefined).map((c) => [c.key!, c]));
  const created: Competition[] = [];

  for (let n = 0; n < NATIONS.length; n++) {
    const league = topFlight(world, n);
    if (league === undefined) continue;
    const nationName = NATIONS[n].name;
    const organizer = `${nationName} Volleyball Federation`;
    if (!byKey.has(`cup:${NATIONS[n].code}`)) {
      created.push(newCupCompetition(
        world, `cup:${NATIONS[n].code}`, `${nationName} Cup`, 'cup', n, organizer,
        Math.round(league.reputation * 0.8), Math.round(league.prizePool * 0.35),
      ));
    }
    if (!byKey.has(`super:${NATIONS[n].code}`)) {
      created.push(newCupCompetition(
        world, `super:${NATIONS[n].code}`, `${nationName} Super Cup`, 'supercup', n, organizer,
        Math.round(league.reputation * 0.6), Math.round(league.prizePool * 0.1),
      ));
    }
  }

  for (const conf of CONFEDERATIONS) {
    for (const level of conf === 'CEV' ? [1, 2] : [1]) {
      const key = `cont:${conf}:${level}`;
      if (byKey.has(key)) continue;
      const name = CONTINENTAL_NAMES[`${conf}:${level}`];
      // Saves from before the cups were played carry the continental
      // competitions as bare, never-scheduled leagues: adopt those.
      const legacy = world.competitions.find((c) => c.kind === 'continental' && c.key === undefined && c.name === name);
      if (legacy !== undefined) {
        legacy.key = key;
        legacy.organizer = conf;
        legacy.table = [];
        legacy.hasPlayoffs = false;
        legacy.playoffTeams = 0;
        created.push(legacy);
        continue;
      }
      const f = formatFor({ key, kind: 'continental' } as Competition, 0);
      created.push(newCupCompetition(world, key, name, 'continental', -1, conf, f.reputation, f.prizePool));
    }
  }

  if (!byKey.has('clubworld')) {
    const f = formatFor({ key: 'clubworld', kind: 'clubworld' } as Competition, 0);
    created.push(newCupCompetition(world, 'clubworld', 'Club World Championship', 'clubworld', -1, 'FIVB', f.reputation, f.prizePool));
  }

  // The newcomers' first entrants, by reputation — no season has been played for them yet.
  if (created.length > 0) drawEntrants(world, created, false);
}

// ---- Who plays in what ----------------------------------------------------------

/**
 * Settle next season's entrants from the season just finished — called at the
 * rollover, once the titles are decided and before the tables are cleared.
 * National cups need no qualifying: they take the top two divisions as they
 * stand when the season starts.
 */
export function qualifyForCups(world: World): void {
  drawEntrants(world, world.competitions.filter(isCupCompetition), true);
}

function drawEntrants(world: World, comps: Competition[], fromStandings: boolean): void {
  const taken = new Map<string, Set<number>>();
  const takenIn = (conf: string): Set<number> => {
    let set = taken.get(conf);
    if (set === undefined) { set = new Set(); taken.set(conf, set); }
    return set;
  };
  // The Champions League draws first so the CEV Cup takes the next clubs down.
  const ordered = [...comps].sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));

  for (const comp of ordered) {
    const key = comp.key ?? '';
    if (comp.kind === 'supercup') {
      const order = topFlightOrder(world, comp.nation, fromStandings);
      const cupWinner = fromStandings
        ? world.competitions.find((c) => c.key === `cup:${NATIONS[comp.nation].code}`)?.champion ?? -1
        : -1;
      const champion = order[0];
      const second = cupWinner >= 0 && cupWinner !== champion ? cupWinner : order[1];
      comp.participants = [champion, second].filter((c): c is number => c !== undefined && c >= 0);
    } else if (comp.kind === 'continental') {
      const [, conf, level] = key.split(':');
      comp.participants = continentalEntrants(world, conf as Confederation, Number(level), fromStandings, takenIn(conf));
    }
  }
  // The world championship last: it takes the continental champions.
  for (const comp of ordered) {
    if (comp.kind === 'clubworld') comp.participants = clubWorldEntrants(world, fromStandings);
  }
}

function continentalEntrants(
  world: World, conf: Confederation, level: number, fromStandings: boolean, taken: Set<number>,
): number[] {
  const size = conf === 'CEV' ? 16 : 8;
  const slots = SLOTS[conf === 'CEV' ? `CEV:${level}` : 'other'];
  const nations = NATIONS.map((_, i) => i)
    .filter((i) => NATIONS[i].confederation === conf)
    .sort((a, b) => NATIONS[b].strength - NATIONS[a].strength);

  const out: number[] = [];
  nations.forEach((n, rank) => {
    const want = slots[rank] ?? 0;
    if (want === 0) return;
    // Clubs already in the Champions League are taken, so the CEV Cup gets the next ones down.
    const order = topFlightOrder(world, n, fromStandings).filter((c) => !taken.has(c));
    for (const c of order.slice(0, want)) {
      if (out.length >= size) break;
      out.push(c);
      taken.add(c);
    }
  });
  // Nations short of clubs leave places: the best of the rest take them.
  if (out.length < size) {
    const rest = nations
      .flatMap((n) => topFlight(world, n)?.participants ?? [])
      .filter((c) => !taken.has(c))
      .sort((a, b) => world.clubs[b].reputation - world.clubs[a].reputation);
    for (const c of rest) {
      if (out.length >= size) break;
      out.push(c);
      taken.add(c);
    }
  }
  return seeded(world, out);
}

/** The continental champions, the Champions League runner-up, and the best of
 *  the rest by reputation to make eight. */
function clubWorldEntrants(world: World, fromStandings: boolean): number[] {
  const out: number[] = [];
  const add = (c: number | undefined): void => {
    if (c !== undefined && c >= 0 && !out.includes(c) && out.length < 8) out.push(c);
  };
  for (const conf of CONFEDERATIONS) {
    const comp = world.competitions.find((c) => c.key === `cont:${conf}:1`);
    if (fromStandings && comp !== undefined && comp.champion >= 0) {
      add(comp.champion);
    } else {
      const best = world.clubs
        .filter((c) => c.tier === 1 && NATIONS[c.nation].confederation === conf)
        .sort((a, b) => b.reputation - a.reputation)[0];
      add(best?.id);
    }
  }
  const cl = world.competitions.find((c) => c.key === 'cont:CEV:1');
  if (fromStandings && cl?.cup?.bracket?.resolved === true) add(cl.cup.bracket.finalOrder[1]);
  const byReputation = world.clubs.filter((c) => c.tier === 1).sort((a, b) => b.reputation - a.reputation);
  for (const c of byReputation) add(c.id);
  return seeded(world, out);
}

/** Best first, by reputation — the seeding every draw uses. */
function seeded(world: World, clubs: number[]): number[] {
  return [...clubs].sort((a, b) => world.clubs[b].reputation - world.clubs[a].reputation);
}

function nationalCupEntrants(world: World, nation: number): number[] {
  const clubs = world.clubs.filter((c) =>
    c.nation === nation && c.tier <= 2 && c.players.length >= 7 && world.competitions[c.leagueId]?.kind === 'league');
  return clubs
    .sort((a, b) => a.tier - b.tier || b.reputation - a.reputation)
    .slice(0, 32)
    .map((c) => c.id);
}

// ---- Finding room in the calendar -----------------------------------------------

/** Each club's match days this season — built once per season and kept up to
 *  date as cup matches are added, so fitting a match in is a set lookup. */
const busyCache = new WeakMap<World, { season: number; days: Map<number, Set<number>> }>();

function busyDays(world: World): Map<number, Set<number>> {
  let cache = busyCache.get(world);
  if (cache === undefined || cache.season !== world.season) {
    const days = new Map<number, Set<number>>();
    const start = world.season * DAYS_PER_SEASON;
    for (let d = start - 1; d <= start + DAYS_PER_SEASON; d++) {
      for (const id of world.fixturesByDay.get(d) ?? []) {
        const f = world.fixtures[id];
        markBusy(days, f.home, d);
        markBusy(days, f.away, d);
      }
    }
    cache = { season: world.season, days };
    busyCache.set(world, cache);
  }
  return cache.days;
}

function markBusy(days: Map<number, Set<number>>, club: number, day: number): void {
  let set = days.get(club);
  if (set === undefined) { set = new Set(); days.set(club, set); }
  set.add(day);
}

/** The first day from `from` on which none of `clubs` plays the day before,
 *  the day itself or the day after — or, failing that, just not that day. */
function findFreeDay(world: World, clubs: readonly number[], from: number, to: number): number {
  const busy = busyDays(world);
  const free = (d: number, buffer: number): boolean => clubs.every((c) => {
    const set = busy.get(c);
    if (set === undefined) return true;
    for (let x = d - buffer; x <= d + buffer; x++) if (set.has(x)) return false;
    return true;
  });
  for (const buffer of [1, 0]) {
    for (let d = from; d <= Math.max(from, to); d++) if (free(d, buffer)) return d;
  }
  return from;
}

function addCupFixture(
  world: World, comp: Competition, day: number, home: number, away: number, round: number,
  neutral: boolean, importance: number,
): number {
  const f: Fixture = {
    id: world.fixtures.length,
    competitionId: comp.id,
    day,
    home,
    away,
    round,
    format: MatchFormat.BestOf5,
    importance,
    neutralVenue: neutral,
    played: false,
    homeSets: 0,
    awaySets: 0,
    setScores: [],
    mvp: -1,
  };
  addFixture(world, f);
  comp.fixtureIds.push(f.id);
  const busy = busyDays(world);
  markBusy(busy, home, day);
  markBusy(busy, away, day);
  return f.id;
}

// ---- The season's draw ---------------------------------------------------------------

/**
 * Draw and schedule every cup for the season about to start — called from
 * `startSeason` once the leagues are laid out, so cup matches fit around them.
 */
export function scheduleCupSeason(world: World): void {
  const seasonStart = world.season * DAYS_PER_SEASON;
  const order: CompetitionKind[] = ['supercup', 'clubworld', 'continental', 'cup'];
  const comps = world.competitions
    .filter(isCupCompetition)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id - b.id);

  for (const comp of comps) {
    comp.fixtureIds = [];
    comp.cup = undefined;
    // The world championship waits for its year; the continental champions
    // qualified for it go home.
    if (comp.kind === 'clubworld' && !clubWorldYear(world.startYear + world.season)) {
      comp.participants = [];
      continue;
    }
    const entrants = (comp.kind === 'cup' ? nationalCupEntrants(world, comp.nation) : comp.participants)
      .filter((c) => world.clubs[c] !== undefined && world.clubs[c].players.length >= 7);
    comp.participants = entrants;
    if (entrants.length < 2) continue;

    const format = formatFor(comp, entrants.length);
    const useGroups = format.groups > 0 && entrants.length >= format.groups * 3;
    const cup: CupState = {
      season: world.season,
      entrants,
      groups: [],
      advancePerGroup: 2,
      bracket: null,
      roundDays: format.knockoutDays.map((d) => seasonStart + d),
      neutral: format.neutral,
    };
    comp.cup = cup;

    if (useGroups) {
      drawGroupStage(world, comp, cup, format, seasonStart);
    } else {
      cup.bracket = newBracket(entrants, buildFirstRound(entrants.length));
      scheduleKnockoutRound(world, comp, 0);
    }
  }
  entryNotices(world);
}

function newBracket(seeds: number[], firstRound: PlayoffTie[]): PlayoffGroup {
  return {
    id: 'championship', label: 'Knockout', seeds, rounds: [firstRound], currentRound: 0, resolved: false, finalOrder: [],
  };
}

/** Pots of equal strength, one club from each pot per group, and — where the
 *  draw allows — no two clubs from the same nation in a group. */
function drawGroupStage(world: World, comp: Competition, cup: CupState, format: CupFormat, seasonStart: number): void {
  const n = format.groups;
  const groups: number[][] = Array.from({ length: n }, () => []);
  const entrants = comp.participants;
  for (let pot = 0; pot * n < entrants.length; pot++) {
    const drawn = world.rng.shuffle(entrants.slice(pot * n, pot * n + n));
    for (const club of drawn) {
      const open = groups.map((_, i) => i).filter((i) => groups[i].length === pot);
      const nation = world.clubs[club].nation;
      const clean = open.filter((i) => !groups[i].some((c) => world.clubs[c].nation === nation));
      groups[(clean.length > 0 ? clean : open)[0]].push(club);
    }
  }

  cup.groups = groups.map((clubIds, i): CupGroup => ({ name: String.fromCharCode(65 + i), clubIds, fixtureIds: [] }));
  const neutral = format.neutral === 'all';
  for (const group of cup.groups) {
    const first = roundRobin(group.clubIds);
    const rounds = format.doubleRoundRobin
      ? [...first, ...first.map((r) => r.map(([h, a]) => [a, h] as [number, number]))]
      : first;
    rounds.forEach((pairs, md) => {
      const target = seasonStart + (format.groupDays[md] ?? format.groupDays[format.groupDays.length - 1] + md * 7);
      const day = findFreeDay(world, group.clubIds, target, Math.min(target + 12, seasonStart + LAST_CUP_DAY));
      for (const [home, away] of pairs) {
        group.fixtureIds.push(addCupFixture(world, comp, day, home, away, md, neutral, 0.55));
      }
    });
  }
}

/** Put a knockout round's ties in the calendar, each on the first good day on or after the round's date. */
function scheduleKnockoutRound(world: World, comp: Competition, roundIdx: number): void {
  const cup = comp.cup!;
  const bracket = cup.bracket!;
  const total = knockoutRounds(bracket.seeds.length);
  const isFinal = roundIdx === total - 1;
  const seasonStart = world.season * DAYS_PER_SEASON;
  const limit = seasonStart + LAST_CUP_DAY;
  const target = Math.min(limit, Math.max(cup.roundDays[roundIdx] ?? world.day + 7, world.day + 3));
  const neutral = cup.neutral === 'all' || (cup.neutral === 'final' && isFinal);
  const importance = total <= 1 ? 0.8 : 0.6 + 0.35 * (roundIdx / (total - 1));

  for (const tie of bracket.rounds[roundIdx]) {
    if (tie.winnerSeed !== -1 || tie.homeSeed < 0 || tie.awaySeed < 0) continue;
    const home = bracket.seeds[tie.homeSeed];
    const away = bracket.seeds[tie.awaySeed];
    const day = findFreeDay(world, [home, away], target, limit);
    tie.fixtureId = addCupFixture(world, comp, day, home, away, PLAYOFF_ROUND_BASE + roundIdx, neutral, importance);
  }
}

// ---- Day by day ------------------------------------------------------------------------

/** A group's table, from its results so far. */
export function cupGroupTable(world: World, group: CupGroup): LeagueTableRow[] {
  const rows = new Map(group.clubIds.map((c) => [c, newTableRow(c)]));
  for (const id of group.fixtureIds) {
    const f = world.fixtures[id];
    if (f === undefined || !f.played) continue;
    const h = rows.get(f.home);
    const a = rows.get(f.away);
    if (h === undefined || a === undefined) continue;
    const homeWon = f.homeSets > f.awaySets;
    const [wp, lp] = awardLeaguePoints(Math.max(f.homeSets, f.awaySets), Math.min(f.homeSets, f.awaySets));
    h.played++; a.played++;
    h.setsFor += f.homeSets; h.setsAgainst += f.awaySets;
    a.setsFor += f.awaySets; a.setsAgainst += f.homeSets;
    for (const [hp, ap] of f.setScores) {
      h.pointsFor += hp; h.pointsAgainst += ap;
      a.pointsFor += ap; a.pointsAgainst += hp;
    }
    if (homeWon) { h.won++; a.lost++; h.points += wp; a.points += lp; } else { a.won++; h.lost++; a.points += wp; h.points += lp; }
  }
  return [...rows.values()].sort(compareTableRows);
}

/** Called once a day, after the day's matches: close group stages that are
 *  done, settle ties, draw the next rounds, crown the winners. */
export function progressCups(world: World): void {
  for (const comp of world.competitions) {
    const cup = comp.cup;
    if (cup === undefined || cup.season !== world.season) continue;

    if (cup.bracket === null) {
      const done = cup.groups.every((g) => g.fixtureIds.every((id) => world.fixtures[id]?.played === true));
      if (!done) continue;
      closeGroupStage(world, comp, cup);
      continue;
    }

    const bracket = cup.bracket;
    if (bracket.resolved) continue;
    const round = bracket.rounds[bracket.rounds.length - 1];
    const roundIdx = bracket.rounds.length - 1;
    for (const tie of round) {
      if (tie.winnerSeed !== -1 || tie.fixtureId === -1) continue;
      const f = world.fixtures[tie.fixtureId];
      if (f === undefined || !f.played) continue;
      tie.winnerSeed = f.homeSets > f.awaySets ? tie.homeSeed : tie.awaySeed;
      knockoutNotice(world, comp, tie, roundIdx);
    }
    if (!round.every((t) => t.winnerSeed !== -1)) continue;

    if (round.length === 1) {
      crownWinner(world, comp, bracket);
      continue;
    }
    bracket.rounds.push(buildNextRound(round));
    bracket.currentRound++;
    scheduleKnockoutRound(world, comp, bracket.rounds.length - 1);
    drawNotice(world, comp, bracket.rounds.length - 1);
  }
}

/** The group stage is over: the top two of each group go into a bracket where
 *  every winner meets another group's runner-up. */
function closeGroupStage(world: World, comp: Competition, cup: CupState): void {
  const tables = cup.groups.map((g) => cupGroupTable(world, g).map((r) => r.clubId));
  const winners = tables.map((t) => t[0]);
  const runners = tables.map((t) => t[1]);
  const g = cup.groups.length;
  const ties: PlayoffTie[] = [];
  // Winners of A and B are kept apart until the final (C and D likewise).
  for (let i = 0; i + 1 < g; i += 2) ties.push({ homeSeed: i, awaySeed: g + i + 1, fixtureId: -1, winnerSeed: -1 });
  for (let i = 0; i + 1 < g; i += 2) ties.push({ homeSeed: i + 1, awaySeed: g + i, fixtureId: -1, winnerSeed: -1 });
  cup.bracket = newBracket([...winners, ...runners], ties);
  scheduleKnockoutRound(world, comp, 0);
  groupStageNotice(world, comp, cup, tables);
}

function crownWinner(world: World, comp: Competition, bracket: PlayoffGroup): void {
  bracket.resolved = true;
  bracket.finalOrder = computeFinalOrder(bracket);
  const winner = bracket.finalOrder[0];
  comp.champion = winner;

  // Prize money down the bracket: the final pays best, each earlier exit less.
  const format = formatFor(comp, bracket.seeds.length);
  bracket.finalOrder.forEach((clubId, i) => {
    const share = i === 0 ? 1 : i === 1 ? 0.5 : i < 4 ? 0.25 : i < 8 ? 0.12 : i < 16 ? 0.06 : 0.03;
    const club = world.clubs[clubId];
    if (club === undefined) return;
    const amount = Math.round(format.prizePool * share);
    club.finances.balance += amount;
    club.finances.seasonIncome += amount;
    club.finances.prizeMoney += amount;
  });

  const club = world.clubs[winner];
  if (club !== undefined) {
    const lift: Readonly<Record<CompetitionKind, number>> = {
      league: 1, supercup: 1.005, cup: 1.015, continental: 1.03, clubworld: 1.04, international: 1, friendly: 1,
    };
    club.reputation = Math.min(10000, Math.round(club.reputation * lift[comp.kind] + 20));
  }
  winnerNotice(world, comp, bracket);
}

// ---- Labels -----------------------------------------------------------------------------

/** What a fixture is: "Matchday 12", "Group B · Matchday 3", "Quarter-final"… */
export function stageLabel(world: World, fixture: Fixture): string {
  const comp = world.competitions[fixture.competitionId];
  if (comp === undefined) return '';
  if (comp.kind === 'friendly') return 'Pre-season';
  if (comp.kind === 'league' || comp.kind === 'international') {
    if (fixture.round < PLAYOFF_ROUND_BASE) return `Matchday ${fixture.round + 1}`;
    const at = playoffTieOf(comp, fixture.id);
    if (at === null) return 'Playoffs';
    if (at.group.id === 'relegation') return 'Relegation playoff';
    if (at.group.id === 'placement') return 'Placement playoff';
    return at.stage === 'final' ? 'Playoff final' : at.stage === 'thirdPlace' ? 'Third-place match'
      : at.stage === 'semi' ? 'Playoff semi-final' : 'Playoff quarter-final';
  }
  const cup = comp.cup;
  if (fixture.round < PLAYOFF_ROUND_BASE) {
    const group = cup?.groups.find((g) => g.fixtureIds.includes(fixture.id));
    return group !== undefined ? `Group ${group.name} · Matchday ${fixture.round + 1}` : `Matchday ${fixture.round + 1}`;
  }
  const idx = fixture.round - PLAYOFF_ROUND_BASE;
  const total = cup?.bracket !== null && cup?.bracket !== undefined
    ? knockoutRounds(cup.bracket.seeds.length)
    : cup?.roundDays.length ?? idx + 1;
  return knockoutRoundName(idx, total);
}

/** Whether a fixture is the final of a cup competition. */
export function isCupFinal(world: World, fixture: Fixture): boolean {
  const comp = world.competitions[fixture.competitionId];
  const bracket = comp?.cup?.bracket;
  if (comp === undefined || !isCupCompetition(comp) || bracket === null || bracket === undefined) return false;
  return fixture.round === PLAYOFF_ROUND_BASE + knockoutRounds(bracket.seeds.length) - 1;
}

// ---- The manager's post ----------------------------------------------------------------

function venue(f: Fixture, club: number): string {
  if (f.neutralVenue) return 'at a neutral venue';
  return f.home === club ? 'at home' : 'away';
}

function opponentOf(f: Fixture, club: number): number {
  return f.home === club ? f.away : f.home;
}

function nextFixtureIn(world: World, comp: Competition, club: number): Fixture | undefined {
  return comp.fixtureIds
    .map((id) => world.fixtures[id])
    .filter((f) => !f.played && (f.home === club || f.away === club))
    .sort((a, b) => a.day - b.day)[0];
}

/**
 * The draw for every competition the user's club has entered this season.
 * Posted at the start of each season, and when a manager first takes charge.
 */
export function entryNotices(world: World): void {
  const me = world.userClubId;
  if (me < 0) return;
  const club = world.clubs[me];
  for (const comp of world.competitions) {
    const cup = comp.cup;
    if (cup === undefined || cup.season !== world.season || !cup.entrants.includes(me)) continue;
    const next = nextFixtureIn(world, comp, me);
    const group = cup.groups.find((g) => g.clubIds.includes(me));
    let body: string;
    if (group !== undefined) {
      const others = group.clubIds.filter((c) => c !== me).map((c) => world.clubs[c].name);
      body = `${club.name} have been drawn in Group ${group.name} with ${listNames(others)}.`;
    } else if (next !== undefined) {
      body = `${club.name} face ${world.clubs[opponentOf(next, me)].name} in the ${stageLabel(world, next).toLowerCase()}.`;
    } else {
      body = `${club.name} have a bye through the first round.`;
    }
    if (next !== undefined) {
      body += ` First up: ${world.clubs[opponentOf(next, me)].name}, ${venue(next, me)}, on ${formatDay(world, next.day)}.`;
    }
    postMessage(world, {
      subject: `${comp.name}: the draw`,
      body,
      from: comp.organizer,
      clubId: next !== undefined ? opponentOf(next, me) : undefined,
      category: 'matchday',
    });
  }
}

function drawNotice(world: World, comp: Competition, roundIdx: number): void {
  const me = world.userClubId;
  const bracket = comp.cup?.bracket;
  if (bracket === undefined || bracket === null) return;
  const tie = bracket.rounds[roundIdx].find((t) => bracket.seeds[t.homeSeed] === me || bracket.seeds[t.awaySeed] === me);
  if (tie === undefined || tie.fixtureId < 0) return;
  const f = world.fixtures[tie.fixtureId];
  const round = knockoutRoundName(roundIdx, knockoutRounds(bracket.seeds.length));
  const opp = world.clubs[opponentOf(f, me)];
  postMessage(world, {
    subject: round === 'Final' ? `${comp.name}: into the final` : `${comp.name}: ${round.toLowerCase()} draw`,
    body: `${world.clubs[me].name} will play ${opp.name} in the ${round.toLowerCase()} — ${venue(f, me)}, on ${formatDay(world, f.day)}.`,
    from: comp.organizer,
    clubId: opp.id,
    category: 'matchday',
  });
}

function groupStageNotice(world: World, comp: Competition, cup: CupState, tables: number[][]): void {
  const me = world.userClubId;
  const gi = cup.groups.findIndex((g) => g.clubIds.includes(me));
  if (me < 0 || gi < 0) return;
  const pos = tables[gi].indexOf(me) + 1;
  const through = pos <= cup.advancePerGroup;
  const club = world.clubs[me];
  const next = through ? nextFixtureIn(world, comp, me) : undefined;
  postMessage(world, {
    subject: through ? `${comp.name}: through to the knockout stage` : `${comp.name}: out at the group stage`,
    body: through
      ? `${club.name} finished ${ordinal(pos)} in Group ${cup.groups[gi].name}.` +
        (next !== undefined
          ? ` Next, the ${stageLabel(world, next).toLowerCase()}: ${world.clubs[opponentOf(next, me)].name}, ` +
            `${venue(next, me)}, on ${formatDay(world, next.day)}.`
          : '')
      : `${club.name} finished ${ordinal(pos)} in Group ${cup.groups[gi].name} — not enough to go through. ` +
        `The ${comp.name} is over for this season.`,
    from: comp.organizer,
    clubId: next !== undefined ? opponentOf(next, me) : me,
    category: 'matchday',
  });
}

/** A tie involving the user's club has been settled: out, or through (the next draw says who's next). */
function knockoutNotice(world: World, comp: Competition, tie: PlayoffTie, roundIdx: number): void {
  const me = world.userClubId;
  const bracket = comp.cup?.bracket;
  if (bracket === undefined || bracket === null || me < 0) return;
  const home = bracket.seeds[tie.homeSeed];
  const away = bracket.seeds[tie.awaySeed];
  if (home !== me && away !== me) return;
  const winner = bracket.seeds[tie.winnerSeed];
  const total = knockoutRounds(bracket.seeds.length);
  if (winner === me || roundIdx === total - 1) return; // the final has its own notice
  const f = world.fixtures[tie.fixtureId];
  const round = knockoutRoundName(roundIdx, total).toLowerCase();
  postMessage(world, {
    subject: `${comp.name}: knocked out`,
    body: `${world.clubs[winner].name} beat ${world.clubs[me].name} ${Math.max(f.homeSets, f.awaySets)}-` +
      `${Math.min(f.homeSets, f.awaySets)} in the ${round}. The ${comp.name} is over for this season.`,
    from: comp.organizer,
    clubId: winner,
    category: 'matchday',
  });
}

function winnerNotice(world: World, comp: Competition, bracket: PlayoffGroup): void {
  const me = world.userClubId;
  if (me < 0) return;
  const [winner, runnerUp] = bracket.finalOrder;
  const final = bracket.rounds[bracket.rounds.length - 1][0];
  const f = world.fixtures[final.fixtureId];
  const score = f !== undefined ? `${Math.max(f.homeSets, f.awaySets)}-${Math.min(f.homeSets, f.awaySets)}` : '';
  const format = formatFor(comp, bracket.seeds.length);
  if (winner === me || runnerUp === me) {
    const won = winner === me;
    postMessage(world, {
      subject: won ? `${comp.name} winners!` : `${comp.name}: beaten in the final`,
      body: won
        ? `${world.clubs[me].name} beat ${world.clubs[runnerUp].name} ${score} in the final — the ${comp.name} is ours. ` +
          `${euros(format.prizePool)} in prize money comes with it.`
        : `${world.clubs[winner].name} beat ${world.clubs[me].name} ${score} in the final. So close.`,
      from: comp.organizer,
      clubId: won ? runnerUp : winner,
      category: 'matchday',
    });
    return;
  }
  // Other clubs' triumphs worth hearing about: your own nation's cup, your
  // confederation's top competition, and the world championship.
  const club = world.clubs[me];
  const relevant = comp.kind === 'clubworld' ||
    (comp.kind === 'cup' && comp.nation === club.nation) ||
    (comp.key === `cont:${NATIONS[club.nation].confederation}:1`);
  if (!relevant) return;
  postMessage(world, {
    subject: `${world.clubs[winner].name} win the ${comp.name}`,
    body: `${world.clubs[winner].name} beat ${world.clubs[runnerUp].name} ${score} in the final of the ${comp.name}.`,
    from: comp.organizer,
    clubId: winner,
    category: 'news',
  });
}

function listNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}

/** How far a club got in a cup this season — for the season review and the
 *  competitions screen. Null when it did not take part. */
export function cupProgress(comp: Competition, clubId: number): {
  stage: string; alive: boolean; champion: boolean;
} | null {
  const cup = comp.cup;
  // The draw's own entrant list: by the rollover `participants` already holds next season's.
  if (cup === undefined || !cup.entrants.includes(clubId)) return null;
  const bracket = cup.bracket;
  const group = cup.groups.find((g) => g.clubIds.includes(clubId));
  if (bracket === null) {
    return { stage: group !== undefined ? `Group ${group.name}` : 'Drawn', alive: true, champion: false };
  }
  const seed = bracket.seeds.indexOf(clubId);
  if (seed < 0) return { stage: 'Group stage', alive: false, champion: false };
  const total = knockoutRounds(bracket.seeds.length);
  for (let r = 0; r < bracket.rounds.length; r++) {
    const tie = bracket.rounds[r].find((t) => t.homeSeed === seed || t.awaySeed === seed);
    if (tie === undefined) continue;
    const name = knockoutRoundName(r, total);
    if (tie.winnerSeed === -1) return { stage: name, alive: true, champion: false };
    if (tie.winnerSeed !== seed) return { stage: r === total - 1 ? 'Runners-up' : name, alive: false, champion: false };
    if (r === total - 1) return { stage: 'Winners', alive: false, champion: true };
  }
  return { stage: knockoutRoundName(bracket.rounds.length, total), alive: true, champion: false };
}
