/**
 * The national teams' tournaments.
 *
 * Every summer, before the club season, there is a major: the Olympic Games
 * every fourth year, the World Championship in the odd years, and in the
 * even years between Olympics each confederation's own championship —
 * EuroVolley, the South American, NORCECA, Asian and African championships.
 * Every spring, once the club playoffs are done, the best sixteen nations
 * play the Nations League. Places go by world ranking, with each
 * confederation guaranteed its share of the World Championship and the
 * Olympics.
 *
 * A tournament is pools, then knockout rounds to a final and a bronze-medal
 * match. A week before the first match each nation names its fourteen — the
 * best of its fit players — and they are away from their clubs, unavailable
 * for selection, until their team goes out. Every match goes through the full
 * rally engine: the players earn caps, get tired, are rated, and the ratings
 * go into their records under the tournament's name. Results move the world
 * ranking. The medallists' names are kept for good.
 *
 * The manager hears about his own players: who has been called up, how they
 * did each day their team played, and how it ended when they come home. The
 * world's news reports the tournaments — the start, the shocks, the champions
 * and the MVP.
 */

import { MatchFormat, simulateMatch } from '../match/engine.ts';
import { matchRating, playedInMatch } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { defaultTactics } from '../match/tactics.ts';
import { compareTableRows, newTableRow, type LeagueTableRow } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { pickLineup } from '../season/seasonEngine.ts';
import { postMessage } from './inbox.ts';
import { CONFEDERATIONS, NATIONS, type Confederation } from './nations.ts';
import { postNews } from './news.ts';
import { recordFixture } from './records.ts';
import { dayOfSeason, DAYS_PER_SEASON, type Competition, type Fixture, type World } from './world.ts';
import { pickBalancedSquad } from './worldGen.ts';

export type TournamentKind = 'nationsLeague' | 'continental' | 'worlds' | 'olympics';

export interface IntlMatch {
  id: number;
  day: number;
  /** Nation indices. */
  home: number;
  away: number;
  /** "Pool B", "Quarter-final", "Bronze medal match"… */
  stage: string;
  /** Knockout round (0 the first), or -1 in the pools. */
  round: number;
  /** Place in its knockout round: the winners of slots 2k and 2k+1 meet next. */
  slot: number;
  bronze: boolean;
  played: boolean;
  homeSets: number;
  awaySets: number;
  setScores: Array<[number, number]>;
  mvp: number;
}

export interface Tournament {
  id: number;
  kind: TournamentKind;
  confederation: Confederation | null;
  /** "EuroVolley 2026". */
  name: string;
  year: number;
  season: number;
  /** The competition its matches are filed under in players' records. */
  competitionId: number;
  teams: number[];
  pools: Array<{ name: string; teams: number[] }>;
  /** How many from each pool go through to the knockout rounds. */
  advance: number;
  matches: IntlMatch[];
  /** Absolute days: squads named, first match, and each knockout round. */
  callUpDay: number;
  startDay: number;
  knockoutDays: number[];
  /** Each nation's fourteen, once named. */
  squads: Array<[number, number[]]>;
  status: 'planned' | 'called' | 'pools' | 'knockout' | 'done';
  /** Nations knocked out so far — their players are home again. */
  out: number[];
  /** Final placings, best first, once it is over. */
  placings: number[];
  mvp: number;
  /** Every player's tournament: [apps, points, rating sum, MVP awards]. */
  stats: Map<number, [number, number, number, number]>;
}

/** A finished tournament, kept for good. */
export interface TournamentRecord {
  name: string;
  kind: TournamentKind;
  confederation: Confederation | null;
  year: number;
  /** Gold, silver, bronze — and fourth. */
  podium: number[];
  mvp: number;
  /** The medallists' squads. */
  medallists: Array<[number, number[]]>;
}

export interface Internationals {
  tournaments: Tournament[];
  history: TournamentRecord[];
  plannedSeason: number;
  nextTournamentId: number;
  nextMatchId: number;
}

// ---- The calendar ------------------------------------------------------------------------

/** The summer major: squads named, first match (days of the season). July. */
const SUMMER_CALL_UP = 8;
const SUMMER_START = 15;
/** The Nations League, once the club playoffs are over. May and June. */
const VNL_CALL_UP = 304;
const VNL_START = 311;

const SQUAD_SHAPE: Record<number, number> = {
  [Position.Setter]: 2,
  [Position.Opposite]: 2,
  [Position.OutsideHitter]: 4,
  [Position.MiddleBlocker]: 4,
  [Position.Libero]: 2,
};

const CONTINENTAL: Readonly<Record<Confederation, { name: string; champions: string }>> = {
  CEV: { name: 'EuroVolley', champions: 'European champions' },
  CSV: { name: 'South American Championship', champions: 'South American champions' },
  NORCECA: { name: 'NORCECA Championship', champions: 'NORCECA champions' },
  AVC: { name: 'Asian Championship', champions: 'Asian champions' },
  CAVB: { name: 'African Championship', champions: 'African champions' },
};

/** Each confederation's guaranteed places at the World Championship (32) and the Olympics (12). */
const WORLDS_QUOTA: Readonly<Record<Confederation, number>> = { CEV: 14, AVC: 6, CSV: 4, NORCECA: 4, CAVB: 4 };
const OLYMPIC_QUOTA: Readonly<Record<Confederation, number>> = { CEV: 5, AVC: 2, CSV: 2, NORCECA: 2, CAVB: 1 };

/** How much one result moves the world ranking, by the stage it is played on. */
const RANKING_K: Readonly<Record<TournamentKind, number>> = { nationsLeague: 10, continental: 14, worlds: 18, olympics: 20 };

export function internationals(world: World): Internationals {
  return world.internationals ??= { tournaments: [], history: [], plannedSeason: -1, nextTournamentId: 0, nextMatchId: 0 };
}

/** What the winners become: "world champions", "Olympic champions"… */
export function championsTitle(t: Pick<Tournament, 'kind' | 'confederation'>): string {
  if (t.kind === 'worlds') return 'world champions';
  if (t.kind === 'olympics') return 'Olympic champions';
  if (t.kind === 'nationsLeague') return 'Nations League winners';
  return CONTINENTAL[t.confederation ?? 'CEV'].champions;
}

function shortName(t: Tournament): string {
  return t.name.replace(/ \d{4}$/, '');
}

// ---- Who plays where ---------------------------------------------------------------------

/** The competition a kind of tournament is filed under, made the first time it is needed. */
function competitionFor(world: World, kind: TournamentKind, conf: Confederation | null): Competition {
  const key = `intl:${kind}${conf !== null ? `:${conf}` : ''}`;
  const found = world.competitions.find((c) => c.key === key);
  if (found !== undefined) return found;
  const name = kind === 'worlds' ? 'World Championship' : kind === 'olympics' ? 'Olympic Games'
    : kind === 'nationsLeague' ? 'Nations League' : CONTINENTAL[conf ?? 'CEV'].name;
  const comp: Competition = {
    id: world.competitions.length,
    name,
    kind: 'international',
    key,
    organizer: conf ?? 'FIVB',
    nation: -1,
    tier: 0,
    participants: [],
    table: [],
    fixtureIds: [],
    reputation: kind === 'olympics' ? 10000 : kind === 'worlds' ? 9500 : 8000,
    promotionSlots: 0,
    relegationSlots: 0,
    hasPlayoffs: false,
    playoffTeams: 0,
    champion: -1,
    prizePool: 0,
    playoffGroups: [],
  };
  world.competitions.push(comp);
  return comp;
}

/** Nations with a squad's worth of senior players, strongest by world ranking first. */
function rankedNations(world: World): number[] {
  const store = world.players;
  const counts = new Map<number, number>();
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth)) continue;
    counts.set(store.nation[i], (counts.get(store.nation[i]) ?? 0) + 1);
  }
  return world.nationalTeams
    .filter((t) => (counts.get(t.nation) ?? 0) >= 12)
    .sort((a, b) => b.rankingPoints - a.rankingPoints)
    .map((t) => t.nation);
}

/** Places by confederation quota, the rest to the best of everyone else. */
function byQuota(ranked: number[], quota: Readonly<Record<Confederation, number>>, total: number): number[] {
  const picked: number[] = [];
  for (const conf of Object.keys(quota) as Confederation[]) {
    picked.push(...ranked.filter((n) => NATIONS[n].confederation === conf).slice(0, quota[conf]));
  }
  for (const n of ranked) {
    if (picked.length >= total) break;
    if (!picked.includes(n)) picked.push(n);
  }
  return ranked.filter((n) => picked.includes(n)).slice(0, total);
}

/** Pools and how many go through, for a field of `n`. */
function formatFor(n: number): { pools: number; advance: number } {
  if (n >= 32) return { pools: 8, advance: 2 };
  if (n >= 24) return { pools: 4, advance: 4 };
  if (n >= 12) return { pools: 2, advance: 4 };
  if (n >= 6) return { pools: 2, advance: 2 };
  return { pools: 1, advance: n >= 4 ? 4 : 2 };
}

/** Every pair once, round by round (the circle method). */
function roundRobin(teams: number[]): Array<Array<[number, number]>> {
  const list: number[] = [...teams];
  if (list.length % 2 === 1) list.push(-1);
  const rounds: Array<Array<[number, number]>> = [];
  const n = list.length;
  for (let r = 0; r < n - 1; r++) {
    const round: Array<[number, number]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a >= 0 && b >= 0) round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

/** Draw a tournament: snake-seeded pools, every pool match on its day. */
function createTournament(
  world: World, kind: TournamentKind, conf: Confederation | null, teams: number[], year: number,
  callUp: number, start: number, gap: number,
): Tournament | null {
  if (teams.length < 2) return null;
  const I = internationals(world);
  const comp = competitionFor(world, kind, conf);
  const { pools: poolCount, advance } = formatFor(teams.length);
  const pools = Array.from({ length: poolCount }, (_, i) => ({ name: `Pool ${String.fromCharCode(65 + i)}`, teams: [] as number[] }));
  teams.forEach((n, i) => {
    const lap = Math.floor(i / poolCount);
    const k = i % poolCount;
    pools[lap % 2 === 0 ? k : poolCount - 1 - k].teams.push(n);
  });
  const t: Tournament = {
    id: I.nextTournamentId++,
    kind,
    confederation: conf,
    name: `${comp.name} ${year}`,
    year,
    season: world.season,
    competitionId: comp.id,
    teams,
    pools,
    advance: Math.min(advance, Math.min(...pools.map((p) => p.teams.length))),
    matches: [],
    callUpDay: callUp,
    startDay: start,
    knockoutDays: [],
    squads: [],
    status: 'planned',
    out: [],
    placings: [],
    mvp: -1,
    stats: new Map(),
  };
  let lastPoolDay = start;
  for (const pool of pools) {
    roundRobin(pool.teams).forEach((round, r) => {
      const day = start + r * gap;
      lastPoolDay = Math.max(lastPoolDay, day);
      for (const [home, away] of round) t.matches.push(newMatch(I, day, home, away, pool.name, -1, 0));
    });
  }
  const qualifiers = t.advance * pools.length;
  const rounds = Math.max(1, Math.round(Math.log2(qualifiers)));
  t.knockoutDays = Array.from({ length: rounds }, (_, r) => lastPoolDay + 3 + r * 2);
  I.tournaments.push(t);
  return t;
}

function newMatch(I: Internationals, day: number, home: number, away: number, stage: string, round: number, slot: number, bronze = false): IntlMatch {
  return {
    id: I.nextMatchId++, day, home, away, stage, round, slot, bronze,
    played: false, homeSets: 0, awaySets: 0, setScores: [], mvp: -1,
  };
}

/**
 * The season's tournaments, drawn on its first day (or the first day a save
 * comes to it): the summer's major, unless it is already too late for it,
 * and the Nations League.
 */
export function planInternationals(world: World): void {
  const I = internationals(world);
  if (I.plannedSeason === world.season) return;
  I.plannedSeason = world.season;
  I.tournaments = I.tournaments.filter((t) => t.season >= world.season - 1);
  const d = dayOfSeason(world);
  const base = world.season * DAYS_PER_SEASON;
  const year = world.startYear + world.season;
  const ranked = rankedNations(world);
  if (d <= SUMMER_CALL_UP) {
    if (year % 4 === 0) {
      createTournament(world, 'olympics', null, byQuota(ranked, OLYMPIC_QUOTA, 12), year, base + SUMMER_CALL_UP, base + SUMMER_START, 1);
    } else if (year % 2 === 1) {
      createTournament(world, 'worlds', null, byQuota(ranked, WORLDS_QUOTA, 32), year, base + SUMMER_CALL_UP, base + SUMMER_START, 1);
    } else {
      for (const conf of CONFEDERATIONS) {
        const field = ranked.filter((n) => NATIONS[n].confederation === conf).slice(0, conf === 'CEV' ? 24 : 12);
        if (field.length >= 4) createTournament(world, 'continental', conf, field, year, base + SUMMER_CALL_UP, base + SUMMER_START, 1);
      }
    }
  }
  if (d <= VNL_CALL_UP) {
    createTournament(world, 'nationsLeague', null, ranked.slice(0, 16), year + 1, base + VNL_CALL_UP, base + VNL_START, 2);
  }
}

// ---- Squads ------------------------------------------------------------------------------

function squadOf(t: Tournament, nation: number): number[] {
  return t.squads.find(([n]) => n === nation)?.[1] ?? [];
}

/** The user's own players among a set of players. */
function ours(world: World, players: readonly number[]): number[] {
  return world.userClubId < 0 ? [] : players.filter((p) => world.players.clubId[p] === world.userClubId);
}

function nationName(n: number): string {
  return NATIONS[n]?.name ?? '?';
}

/** A week before the first match: every nation names its best fit fourteen, and they report. */
function callUp(world: World, t: Tournament): void {
  const store = world.players;
  const pools = new Map<number, number[]>();
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth) || store.injuryDaysLeft[i] > 0) continue;
    if (store.hasFlag(i, PlayerFlag.OnDuty)) continue;
    const n = store.nation[i];
    if (!t.teams.includes(n)) continue;
    let list = pools.get(n);
    if (list === undefined) pools.set(n, list = []);
    list.push(i);
  }
  for (const n of t.teams) {
    const squad = pickBalancedSquad(store, pools.get(n) ?? [], SQUAD_SHAPE);
    t.squads.push([n, squad]);
    const team = world.nationalTeams.find((x) => x.nation === n);
    if (team !== undefined) {
      for (const p of team.squad) store.setFlag(p, PlayerFlag.NationalTeam, false);
      team.squad = [...squad];
    }
    for (const p of squad) {
      store.setFlag(p, PlayerFlag.NationalTeam, true);
      store.setFlag(p, PlayerFlag.OnDuty, true);
      store.morale[p] = Math.min(100, store.morale[p] + 3);
    }
  }
  t.status = 'called';

  const called = t.squads.flatMap(([n, squad]) => ours(world, squad).map((p) => [p, n] as const));
  if (called.length > 0) {
    const finalDay = t.knockoutDays[t.knockoutDays.length - 1];
    const lines = called.map(([p, n]) =>
      `• ${store.fullName(p)} — ${nationName(n)}${store.nationalCaps[p] === 0 ? ' (first call-up)' : ` (${store.nationalCaps[p]} caps)`}`);
    postMessage(world, {
      subject: called.length === 1
        ? `${store.fullName(called[0][0])} called up for the ${t.name}`
        : `${called.length} players called up for the ${t.name}`,
      body: `${called.length === 1 ? 'One of your players has' : `${called.length} of your players have`} been named ` +
        `in their national squads for the ${t.name}, which starts on ${dateLabel(world, t.startDay)}:\n${lines.join('\n')}\n` +
        `They are with their national teams — and unavailable to you — until their team goes out. ` +
        `The final is on ${dateLabel(world, finalDay)}.`,
      from: called.length === 1 ? `${nationName(called[0][1])} Volleyball Federation` : 'International Desk',
      playerIdx: called[0][0],
      category: 'international',
    });
  }
}

/** "Sat 18 Jul" for a day, as the messages put it. */
function dateLabel(world: World, day: number): string {
  const seasonDay = ((day % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON;
  const doy = (seasonDay + 181) % 365;
  const year = world.startYear + Math.floor(day / DAYS_PER_SEASON) + (seasonDay >= 184 ? 1 : 0);
  const date = new Date(Date.UTC(2001, 0, 1));
  date.setUTCDate(date.getUTCDate() + doy);
  return `${date.getUTCDate()} ${date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })} ${year}`;
}

/** Back to their clubs: a nation's players, once it is out. */
function release(world: World, t: Tournament, nation: number): void {
  if (t.out.includes(nation)) return;
  t.out.push(nation);
  for (const p of squadOf(t, nation)) world.players.setFlag(p, PlayerFlag.OnDuty, false);
}

// ---- Playing ------------------------------------------------------------------------------

/** A nation's side for a match: its fit squad players, picked as a club picks. */
function setupFor(world: World, t: Tournament, nation: number) {
  const store = world.players;
  const squad = squadOf(t, nation);
  const pick = pickLineup(
    store,
    { players: squad, preferredLineup: [], preferredLibero: -1, preferredDefensiveLibero: -1 },
    undefined,
    (p) => store.isActive(p) && store.injuryDaysLeft[p] === 0,
  );
  return { clubId: -1, name: nationName(nation), ...pick, tactics: defaultTactics() };
}

/** Play one match: through the rally engine, into the records, the caps and the ranking. */
function play(world: World, t: Tournament, m: IntlMatch): Map<number, PlayerMatchStats> {
  const store = world.players;
  const importance = m.round < 0 ? 0.6 : m.stage === 'Final' ? 1 : 0.8;
  const result = simulateMatch(store, {
    home: setupFor(world, t, m.home),
    away: setupFor(world, t, m.away),
    format: MatchFormat.BestOf5,
    importance,
    neutralVenue: true,
    collectLog: false,
    seed: world.rng.next(),
  });
  m.played = true;
  m.homeSets = result.homeSets;
  m.awaySets = result.awaySets;
  m.setScores = result.setScores;
  m.mvp = result.mvp;

  // Into each player's record, under the tournament's name.
  const fixture = {
    id: -1 - m.id, competitionId: t.competitionId, day: m.day, home: m.home, away: m.away,
    homeSets: m.homeSets, awaySets: m.awaySets, setScores: m.setScores, mvp: m.mvp, played: true,
  } as unknown as Fixture;
  const homeStats = result.stats.home.players;
  const awayStats = result.stats.away.players;
  recordFixture(world, fixture, homeStats, awayStats);

  const all = new Map<number, PlayerMatchStats>([...homeStats, ...awayStats]);
  for (const [stats, setsFor, setsAgainst] of [[homeStats, m.homeSets, m.awaySets], [awayStats, m.awaySets, m.homeSets]] as const) {
    for (const [p, s] of stats) {
      if (!playedInMatch(s)) continue;
      store.nationalCaps[p] = Math.min(65535, store.nationalCaps[p] + 1);
      store.condition[p] = Math.max(20, store.condition[p] - world.rng.int(8, 18));
      const line = t.stats.get(p) ?? [0, 0, 0, 0];
      line[0]++;
      line[1] += s.attackKills + s.serveAces + s.blockPoints;
      line[2] += matchRating(s, store.position[p] as Position, setsFor, setsAgainst);
      if (m.mvp === p) line[3]++;
      t.stats.set(p, line);
    }
  }

  // The world ranking: an upset is worth more than a win the ranking expected.
  const home = world.nationalTeams.find((x) => x.nation === m.home);
  const away = world.nationalTeams.find((x) => x.nation === m.away);
  if (home !== undefined && away !== undefined) {
    const expected = 1 / (1 + Math.pow(10, (away.rankingPoints - home.rankingPoints) / 120));
    const homeWon = m.homeSets > m.awaySets ? 1 : 0;
    const shift = Math.round(RANKING_K[t.kind] * (homeWon - expected));
    home.rankingPoints = Math.max(1, home.rankingPoints + shift);
    away.rankingPoints = Math.max(1, away.rankingPoints - shift);
  }
  return all;
}

function winnerOf(m: IntlMatch): number {
  return m.homeSets > m.awaySets ? m.home : m.away;
}

function loserOf(m: IntlMatch): number {
  return m.homeSets > m.awaySets ? m.away : m.home;
}

/** A pool's standings, best first. */
export function poolTable(t: Tournament, pool: { teams: number[] }): LeagueTableRow[] {
  const rows = new Map(pool.teams.map((n) => [n, newTableRow(n)]));
  for (const m of t.matches) {
    if (m.round >= 0 || !m.played) continue;
    const h = rows.get(m.home);
    const a = rows.get(m.away);
    if (h === undefined || a === undefined) continue;
    const homeWon = m.homeSets > m.awaySets;
    const loserSets = Math.min(m.homeSets, m.awaySets);
    const [winPts, losePts] = loserSets <= 1 ? [3, 0] : [2, 1];
    for (const [row, won, setsFor, setsAgainst] of [[h, homeWon, m.homeSets, m.awaySets], [a, !homeWon, m.awaySets, m.homeSets]] as const) {
      row.played++;
      if (won) row.won++;
      else row.lost++;
      row.points += won ? winPts : losePts;
      row.setsFor += setsFor;
      row.setsAgainst += setsAgainst;
    }
    for (const [hp, ap] of m.setScores) {
      h.pointsFor += hp;
      h.pointsAgainst += ap;
      a.pointsFor += ap;
      a.pointsAgainst += hp;
    }
  }
  return [...rows.values()].sort(compareTableRows);
}

/** The bracket order that keeps the top seeds apart until the end: 1, 8, 4, 5, 2, 7, 3, 6… */
function bracketOrder(k: number): number[] {
  let order = [1];
  while (order.length < k) {
    const size = order.length * 2;
    order = order.flatMap((s) => [s, size + 1 - s]);
  }
  return order;
}

function roundName(teamsLeft: number): string {
  if (teamsLeft === 2) return 'Final';
  if (teamsLeft === 4) return 'Semi-final';
  if (teamsLeft === 8) return 'Quarter-final';
  return `Round of ${teamsLeft}`;
}

/** Out of the pools: the qualifiers seeded — pool winners first — into the bracket. */
function drawKnockout(world: World, t: Tournament): void {
  const I = internationals(world);
  const tables = t.pools.map((p) => poolTable(t, p));
  const seeds: number[] = [];
  for (let pos = 0; pos < t.advance; pos++) {
    const tier = tables.map((tb) => tb[pos]).filter((r) => r !== undefined).sort(compareTableRows);
    seeds.push(...tier.map((r) => r.clubId));
  }
  for (const tb of tables) for (const r of tb.slice(t.advance)) release(world, t, r.clubId);
  const order = bracketOrder(seeds.length);
  const day = t.knockoutDays[0];
  for (let i = 0; i < order.length; i += 2) {
    t.matches.push(newMatch(I, day, seeds[order[i] - 1], seeds[order[i + 1] - 1], roundName(seeds.length), 0, i / 2));
  }
  t.status = 'knockout';
}

/** After a knockout round: the next one, the medal matches — or the end. */
function nextRound(world: World, t: Tournament): void {
  const I = internationals(world);
  const round = Math.max(...t.matches.map((m) => m.round));
  const ties = t.matches.filter((m) => m.round === round).sort((a, b) => Number(a.bronze) - Number(b.bronze) || a.slot - b.slot);
  if (!ties.every((m) => m.played)) return;
  const main = ties.filter((m) => !m.bronze);
  if (main.length === 1) {
    finish(world, t, main[0], ties.find((m) => m.bronze));
    return;
  }
  const day = t.knockoutDays[round + 1] ?? t.knockoutDays[t.knockoutDays.length - 1] + 2;
  for (let i = 0; i < main.length; i += 2) {
    t.matches.push(newMatch(I, day, winnerOf(main[i]), winnerOf(main[i + 1]), roundName(main.length), round + 1, i / 2));
  }
  if (main.length === 2) {
    t.matches.push(newMatch(I, day, loserOf(main[0]), loserOf(main[1]), 'Bronze medal match', round + 1, 1, true));
  } else {
    for (const m of main) release(world, t, loserOf(m));
  }
}

/** The pool record a placing goes on: the better record, the better place. */
function poolRow(t: Tournament, nation: number): LeagueTableRow {
  for (const p of t.pools) {
    const row = poolTable(t, p).find((r) => r.clubId === nation);
    if (row !== undefined) return row;
  }
  return newTableRow(nation);
}

/** The final: medals, placings, the MVP, the record book — and everyone home. */
function finish(world: World, t: Tournament, final: IntlMatch, bronze: IntlMatch | undefined): void {
  const store = world.players;
  const podium = [winnerOf(final), loserOf(final)];
  if (bronze !== undefined) podium.push(winnerOf(bronze), loserOf(bronze));
  // Everyone else: the further they got, the higher — then on their pool record.
  const exit = new Map<number, number>();
  for (const m of t.matches) {
    if (m.round < 0 || !m.played || m.bronze) continue;
    exit.set(loserOf(m), m.round);
  }
  const rest = t.teams.filter((n) => !podium.includes(n))
    .sort((a, b) => (exit.get(b) ?? -1) - (exit.get(a) ?? -1) || compareTableRows(poolRow(t, a), poolRow(t, b)));
  t.placings = [...podium, ...rest];

  // MVP: the best rating over the tournament in the champions' squad.
  const champions = squadOf(t, podium[0]);
  let mvp = -1;
  let best = 0;
  for (const p of champions) {
    const s = t.stats.get(p);
    if (s === undefined || s[0] < 3) continue;
    const avg = s[2] / s[0];
    if (avg > best) {
      best = avg;
      mvp = p;
    }
  }
  t.mvp = mvp;
  t.status = 'done';

  const team = world.nationalTeams.find((x) => x.nation === podium[0]);
  if (team !== undefined) {
    if (t.kind === 'olympics') team.olympicGolds++;
    else if (t.kind === 'worlds') team.worldTitles++;
    else if (t.kind === 'continental') team.continentalTitles = (team.continentalTitles ?? 0) + 1;
    else team.nationsLeagueTitles = (team.nationsLeagueTitles ?? 0) + 1;
  }
  const comp = world.competitions[t.competitionId];
  if (comp !== undefined) comp.champion = podium[0];

  // Medals: pride, and a name that travels.
  const medal = [1.08, 1.04, 1.04];
  podium.slice(0, 3).forEach((n, i) => {
    for (const p of squadOf(t, n)) {
      store.morale[p] = Math.min(100, store.morale[p] + (i === 0 ? 12 : 6));
      store.reputation[p] = Math.min(10000, Math.round(store.reputation[p] * medal[i] + (p === mvp ? 400 : 0)));
    }
  });

  internationals(world).history.push({
    name: t.name,
    kind: t.kind,
    confederation: t.confederation,
    year: t.year,
    podium: podium.slice(0, 4),
    mvp,
    medallists: podium.slice(0, 3).map((n) => [n, [...squadOf(t, n)]]),
  });
  for (const n of t.teams) release(world, t, n);

  const score = `${Math.max(final.homeSets, final.awaySets)}-${Math.min(final.homeSets, final.awaySets)}`;
  postNews(world, {
    kind: 'title',
    headline: `${nationName(podium[0])} are ${championsTitle(t)}`,
    body: `${nationName(podium[0])} beat ${nationName(podium[1])} ${score} in the final of the ${t.name}.` +
      `${podium[2] !== undefined ? ` ${nationName(podium[2])} took bronze, beating ${nationName(podium[3])}.` : ''}` +
      `${mvp >= 0 ? ` ${store.fullName(mvp)} was named the tournament's Most Valuable Player.` : ''}`,
    nation: podium[0],
    playerIdx: mvp >= 0 ? mvp : undefined,
    competitionId: t.competitionId,
  });
}

// ---- What the manager hears, and the papers --------------------------------------------------

/** A line for one of the user's players in one match today. */
function matchLine(world: World, p: number, nation: number, m: IntlMatch, stats: Map<number, PlayerMatchStats>): string {
  const store = world.players;
  const opp = m.home === nation ? m.away : m.home;
  const us = m.home === nation ? m.homeSets : m.awaySets;
  const them = m.home === nation ? m.awaySets : m.homeSets;
  const fixture = `${nationName(nation)} ${us}-${them} ${nationName(opp)} (${m.stage})`;
  const s = stats.get(p);
  if (s === undefined || !playedInMatch(s)) {
    return store.injuryDaysLeft[p] > 0
      ? `• ${store.fullName(p)} — ${fixture}: missed the match injured.`
      : `• ${store.fullName(p)} — ${fixture}: did not get on court.`;
  }
  const pts = s.attackKills + s.serveAces + s.blockPoints;
  const rating = matchRating(s, store.position[p] as Position, us, them);
  return `• ${store.fullName(p)} — ${fixture}: played, ${pts} point${pts === 1 ? '' : 's'}, rating ${rating.toFixed(1)}` +
    `${m.mvp === p ? ' — man of the match' : ''}.`;
}

/** How a nation's tournament ended, in words. */
function finishLine(t: Tournament, nation: number): string {
  const place = t.placings.indexOf(nation);
  if (place === 0) return `won gold — ${nationName(nation)} are ${championsTitle(t)}`;
  if (place === 1) return 'won silver';
  if (place === 2) return 'won bronze';
  if (place === 3) return 'finished fourth';
  const lost = t.matches.find((m) => m.round >= 0 && m.played && !m.bronze && loserOf(m) === nation);
  return lost !== undefined ? `went out in the ${lost.stage.toLowerCase()} to ${nationName(winnerOf(lost))}` : 'went out in the pools';
}

/** Players home today: how their tournament went. */
function homecoming(world: World, t: Tournament, nations: number[]): void {
  const store = world.players;
  const back = nations.flatMap((n) => ours(world, squadOf(t, n)).map((p) => [p, n] as const));
  if (back.length === 0) return;
  const lines = back.map(([p, n]) => {
    const s = t.stats.get(p);
    const line = s === undefined || s[0] === 0
      ? 'did not play a match'
      : `played ${s[0]} match${s[0] === 1 ? '' : 'es'} — ${s[1]} points, average rating ${(s[2] / s[0]).toFixed(2)}`;
    return `• ${store.fullName(p)} (${nationName(n)}) ${line}. ${nationName(n)} ${finishLine(t, n)}.` +
      `${t.mvp === p ? ' He was named the tournament\'s Most Valuable Player!' : ''}`;
  });
  const gold = back.find(([, n]) => t.placings[0] === n);
  postMessage(world, {
    subject: gold !== undefined
      ? `${store.fullName(gold[0])} is ${championsTitle(t).replace(/s$/, '')}!`
      : back.length === 1
        ? `${store.fullName(back[0][0])} returns from the ${t.name}`
        : `${back.length} players return from the ${t.name}`,
    body: `${back.length === 1 ? 'One of your players is' : 'Your players are'} back from the ${t.name} and available again:\n` +
      `${lines.join('\n')}\nExpect them to need a few days to recover their condition.`,
    from: 'International Desk',
    playerIdx: back[0][0],
    category: 'international',
  });
}

/** The papers: the tournament under way, and any shock along the way. */
function headlines(world: World, t: Tournament, today: IntlMatch[]): void {
  // The field by world ranking, best first.
  const points = (n: number): number => world.nationalTeams.find((x) => x.nation === n)?.rankingPoints ?? 0;
  const rank = [...t.teams].sort((a, b) => points(b) - points(a));
  if (world.day === t.startDay) {
    const favourites = rank.slice(0, 3).map(nationName);
    postNews(world, {
      kind: 'result',
      headline: `The ${t.name} gets under way`,
      body: `${t.teams.length} nations, ${t.pools.length} pool${t.pools.length === 1 ? '' : 's'}, and one title. ` +
        `The world ranking makes ${favourites.join(', ')} the favourites.`,
      nation: -1,
      competitionId: t.competitionId,
    });
  }
  // A shock: one of the favourites beaten by a side ranked well below it.
  const gap = Math.max(4, Math.round(t.teams.length / 3));
  for (const m of today) {
    const w = winnerOf(m);
    const l = loserOf(m);
    const rw = rank.indexOf(w);
    const rl = rank.indexOf(l);
    if (rl > 3 || rw - rl < gap) continue;
    postNews(world, {
      kind: 'result',
      headline: `Shock at the ${shortName(t)}: ${nationName(w)} beat ${nationName(l)}`,
      body: `${nationName(w)} stunned ${nationName(l)} ${Math.max(m.homeSets, m.awaySets)}-${Math.min(m.homeSets, m.awaySets)} ` +
        `in the ${m.stage.toLowerCase()} of the ${t.name}.`,
      nation: w,
      competitionId: t.competitionId,
    });
  }
}

// ---- Each day -----------------------------------------------------------------------------

/** The day's international business: squads named, matches played, rounds drawn, players home. */
export function internationalDay(world: World): void {
  planInternationals(world);
  const I = internationals(world);
  for (const t of I.tournaments) {
    if (t.status === 'done' || t.season !== world.season) continue;
    if (t.status === 'planned') {
      if (world.day >= t.callUpDay) callUp(world, t);
      else continue;
    }
    const today = t.matches.filter((m) => m.day === world.day && !m.played);
    if (today.length === 0) continue;
    if (t.status === 'called') t.status = 'pools';
    const outBefore = t.out.length;
    const stats = new Map<number, PlayerMatchStats>();
    for (const m of today) for (const [p, s] of play(world, t, m)) stats.set(p, s);

    if (t.status === 'pools' && t.matches.every((m) => m.played)) drawKnockout(world, t);
    else if (t.status === 'knockout') nextRound(world, t);

    // The manager's players who played today, and those now heading home.
    const lines: string[] = [];
    for (const m of today) {
      for (const nation of [m.home, m.away]) {
        for (const p of ours(world, squadOf(t, nation))) lines.push(matchLine(world, p, nation, m, stats));
      }
    }
    if (lines.length > 0) {
      postMessage(world, {
        subject: `${t.name}: how your players got on`,
        body: `Today at the ${t.name}:\n${lines.join('\n')}`,
        from: 'International Desk',
        category: 'international',
      });
    }
    const goneHome = t.out.slice(outBefore);
    if (goneHome.length > 0) homecoming(world, t, goneHome);
    headlines(world, t, today);
  }
}

/** The tournaments a day is part of — for the calendar. */
export function internationalNotes(world: World, day: number): Array<{ label: string; kind: 'intl' }> {
  const I = world.internationals;
  if (I === undefined) return [];
  const notes = new Map<string, string>();
  const continental = I.tournaments.filter((t) => t.kind === 'continental');
  for (const t of I.tournaments) {
    const short = t.kind === 'continental' && continental.length > 1 ? 'Continental championships' : shortName(t);
    if (day === t.callUpDay) notes.set(`${short}-call`, `${short}: squads named`);
    if (day === t.startDay) notes.set(`${short}-start`, `${short} begins`);
    if (day === t.knockoutDays[t.knockoutDays.length - 1]) notes.set(`${short}-final`, `${short} final`);
  }
  return [...notes.values()].map((label) => ({ label, kind: 'intl' as const }));
}
