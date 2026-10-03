/**
 * The national teams: their tournaments, their squads, and their coaches.
 *
 * Every summer, before the club season, there is a major: the Olympic Games
 * every fourth year, the World Championship in the odd years, and in the
 * even years between Olympics each confederation's own championship —
 * EuroVolley, the South American, NORCECA, Asian and African championships.
 * Every spring, once the club playoffs are done, the best sixteen nations
 * play the Nations League. Places go by world ranking, with each
 * confederation guaranteed its share of the World Championship and the
 * Olympics; a major has a host, who qualifies and plays at home.
 *
 * A tournament is pools, then knockout rounds to a final and a bronze-medal
 * match. A week before the first match each nation names its fourteen: the
 * best of its fit players, on ability and on current form, with the caps to
 * show for it counting a little. A player with two nationalities can be
 * called by either until he plays for one — then he belongs to it. The
 * fourteen are away from their clubs until their team goes out. Every match
 * goes through the full rally engine: caps, tiredness, ratings into the
 * players' records under the tournament's name, and points for the world
 * ranking. The medallists' names are kept for good.
 *
 * The manager can coach a national team as well as (or instead of) a club:
 * nations whose coach has gone advertise the job, and the federation weighs
 * his name against its own. His nation's fourteen are his to name — if he
 * hasn't by the day squads are due, the day waits for him — and its matches
 * are his to play, live, from the match screen. A tournament that goes badly
 * for a nation that expected more can cost its coach the job.
 *
 * The manager hears about his club's players at every step — the call-up,
 * each match they play with their numbers, and how it ended when they come
 * home — and the world's news reports the tournaments.
 */

import { Rng } from '../core/rng.ts';
import { MatchFormat, simulateMatch, type MatchResult, type TeamSetup } from '../match/engine.ts';
import { matchRating, playedInMatch } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { defaultTactics } from '../match/tactics.ts';
import { compareTableRows, newTableRow, type LeagueTableRow } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { pickLineup } from '../season/seasonEngine.ts';
import { ensureManagerAttributes } from './career.ts';
import { postMessage } from './inbox.ts';
import { CONFEDERATIONS, NATIONS, type Confederation } from './nations.ts';
import { postNews } from './news.ts';
import { recordFixture } from './records.ts';
import {
  dayOfSeason, DAYS_PER_SEASON, type Competition, type Fixture, type GameMessage, type World,
} from './world.ts';

export type TournamentKind = 'nationsLeague' | 'continental' | 'worlds' | 'olympics';

export interface IntlMatch {
  id: number;
  day: number;
  /** Nation indices; the host, when it plays, is always at home. */
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
  /** In world-ranking order at the draw: the seeds. */
  teams: number[];
  /** The nation playing at home, or -1 (the Nations League travels). */
  host: number;
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

/** A federation's offer of its head coach's job, waiting on the manager's answer in the inbox. */
export interface NationalOffer {
  id: number;
  nation: number;
  madeOn: number;
  /** The last day it can be accepted. */
  expiresOn: number;
  /** The answer to an application of his, rather than an approach. */
  applied: boolean;
}

/** A national team without a head coach, and when it means to have one. */
export interface NationalVacancy {
  nation: number;
  since: number;
  fillsOn: number;
}

export interface Internationals {
  tournaments: Tournament[];
  history: TournamentRecord[];
  plannedSeason: number;
  nextTournamentId: number;
  nextMatchId: number;
  /** The nation each capped dual national has played for — his for good. */
  tiedTo: Map<number, number>;
  vacancies: NationalVacancy[];
  /** The manager's applications for national jobs, and when each is answered. */
  applications: Array<{ nation: number; answerOn: number }>;
  /** The fourteen the manager has named for his nation's next tournament. */
  chosen: { tournamentId: number; players: number[] } | null;
  /** Players below this store index have been looked at for a second nationality. */
  dualFrom: number;
  /** Federations' offers of their job, waiting on the manager. */
  offers: NationalOffer[];
  nextOfferId: number;
  /** Day a federation last approached him unprompted, -1 if never. */
  lastApproach: number;
  /** Tournaments the manager has been sent the squad message for. */
  squadAsked: number[];
}

// ---- What the manager is told: the reports behind the messages ----------------------------

/** One of the manager's club players in one international match. */
export interface IntlPlayerLine {
  p: number;
  nation: number;
  /** Why he didn't play, if he didn't. */
  absent?: 'bench' | 'injured';
  rating: number;
  points: number;
  kills: number;
  attacks: number;
  aces: number;
  blocks: number;
  receptions: number;
  /** Perfect and positive passes. */
  goodReceptions: number;
  digs: number;
  assists: number;
  mvp: boolean;
}

export interface IntlMatchCard {
  stage: string;
  home: number;
  away: number;
  homeSets: number;
  awaySets: number;
  setScores: Array<[number, number]>;
  mvp: number;
  players: IntlPlayerLine[];
}

/** One player's whole tournament, as he comes home. */
export interface IntlTournamentLine {
  p: number;
  nation: number;
  apps: number;
  points: number;
  avg: number;
  mvps: number;
  /** His nation's final place, 0 for the gold. */
  place: number;
  finish: string;
  tournamentMvp: boolean;
}

/** The structured part of an international message, which the inbox draws. */
export interface IntlReport {
  kind: 'callup' | 'matchday' | 'homecoming' | 'squad';
  tournamentId: number;
  tournament: string;
  callUps?: Array<{ p: number; nation: number; caps: number }>;
  matches?: IntlMatchCard[];
  lines?: IntlTournamentLine[];
}

// ---- The calendar ------------------------------------------------------------------------

/** The summer major: squads named, first match (days of the season). July. */
const SUMMER_CALL_UP = 8;
const SUMMER_START = 15;
/** The Nations League, once the club playoffs are over. May and June. */
const VNL_CALL_UP = 304;
const VNL_START = 311;

export const SQUAD_SIZE = 14;
export const SQUAD_SHAPE: Readonly<Record<number, number>> = {
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

/** National jobs: always a few open, and how long one waits for the manager. */
const MIN_VACANCIES = 3;
const VACANCY_DAYS = 90;
/** Places worse than its seed a nation can finish before its coach is in trouble. */
const DISAPPOINTMENT = 6;

export function internationals(world: World): Internationals {
  const I = world.internationals ??= {
    tournaments: [], history: [], plannedSeason: -1, nextTournamentId: 0, nextMatchId: 0,
    tiedTo: new Map(), vacancies: [], applications: [], chosen: null, dualFrom: 0,
    offers: [], nextOfferId: 0, lastApproach: -1, squadAsked: [],
  };
  // Saves from before national jobs and dual nationals.
  I.tiedTo ??= new Map();
  I.vacancies ??= [];
  I.applications ??= [];
  I.chosen ??= null;
  I.dualFrom ??= 0;
  I.offers ??= [];
  I.nextOfferId ??= 0;
  I.lastApproach ??= -1;
  I.squadAsked ??= [];
  return I;
}

/** The nation the manager coaches, or -1. */
export function userNation(world: World): number {
  return world.career.nationalTeam ?? -1;
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

export function nationName(n: number): string {
  return NATIONS[n]?.name ?? '?';
}

function teamOf(world: World, nation: number) {
  return world.nationalTeams.find((x) => x.nation === nation);
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

/** Every national team by world ranking, best first. */
export function worldRanking(world: World): number[] {
  return [...world.nationalTeams].sort((a, b) => b.rankingPoints - a.rankingPoints).map((t) => t.nation);
}

/** Places by confederation quota, the rest to the best of everyone else — the host always in. */
function byQuota(ranked: number[], quota: Readonly<Record<Confederation, number>>, total: number, host: number): number[] {
  const picked: number[] = host >= 0 ? [host] : [];
  for (const conf of Object.keys(quota) as Confederation[]) {
    for (const n of ranked.filter((x) => NATIONS[x].confederation === conf).slice(0, quota[conf])) {
      if (!picked.includes(n)) picked.push(n);
    }
  }
  for (const n of ranked) {
    if (picked.length >= total) break;
    if (!picked.includes(n)) picked.push(n);
  }
  // Too many with the host in: the lowest-ranked of the rest makes way.
  const field = ranked.filter((n) => picked.includes(n));
  while (field.length > total) {
    const drop = [...field].reverse().find((n) => n !== host);
    field.splice(field.indexOf(drop!), 1);
  }
  return field;
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

/** The host plays at home. */
function orient(t: Pick<Tournament, 'host'>, a: number, b: number): [number, number] {
  return b === t.host ? [b, a] : [a, b];
}

/** Draw a tournament: snake-seeded pools, every pool match on its day. */
function createTournament(
  world: World, kind: TournamentKind, conf: Confederation | null, teams: number[], host: number, year: number,
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
    host,
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
      for (const [a, b] of round) {
        const [home, away] = orient(t, a, b);
        t.matches.push(newMatch(I, day, home, away, pool.name, -1, 0));
      }
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

/** A host for a major: one of the stronger nations that could stage it. */
function pickHost(rng: Rng, candidates: number[]): number {
  return candidates.length === 0 ? -1 : rng.pick(candidates.slice(0, 12));
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
  assignDualNationals(world);
  const d = dayOfSeason(world);
  const base = world.season * DAYS_PER_SEASON;
  const year = world.startYear + world.season;
  const ranked = rankedNations(world);
  // Hosts and jobs on a generator of their own: the world's own draws stay as they were.
  const rng = new Rng(`intl:${world.seed}:${world.season}`);
  if (d <= SUMMER_CALL_UP) {
    if (year % 4 === 0) {
      const host = pickHost(rng, ranked);
      createTournament(world, 'olympics', null, byQuota(ranked, OLYMPIC_QUOTA, 12, host), host, year,
        base + SUMMER_CALL_UP, base + SUMMER_START, 1);
    } else if (year % 2 === 1) {
      const host = pickHost(rng, ranked);
      createTournament(world, 'worlds', null, byQuota(ranked, WORLDS_QUOTA, 32, host), host, year,
        base + SUMMER_CALL_UP, base + SUMMER_START, 1);
    } else {
      for (const conf of CONFEDERATIONS) {
        const field = ranked.filter((n) => NATIONS[n].confederation === conf).slice(0, conf === 'CEV' ? 24 : 12);
        if (field.length >= 4) {
          createTournament(world, 'continental', conf, field, pickHost(rng, field), year,
            base + SUMMER_CALL_UP, base + SUMMER_START, 1);
        }
      }
    }
  }
  if (d <= VNL_CALL_UP) {
    createTournament(world, 'nationsLeague', null, ranked.slice(0, 16), -1, year + 1, base + VNL_CALL_UP, base + VNL_START, 2);
  }
  ensureVacancies(world, ranked, rng);
}

// ---- Dual nationals --------------------------------------------------------------------------

/** A foreign player of this age or more at a club may have taken its country's passport… */
const NATURALISED_AGE = 24;
const NATURALISED_CHANCE = 0.12;
/** …and a few players anywhere have a parent from another country of their confederation. */
const HERITAGE_CHANCE = 0.025;

/**
 * Second nationalities, for the players new to the world since the last
 * look: some who made their career abroad have taken their adopted
 * country's passport, and a few were born to a parent from another country
 * of their confederation. Rolled on a generator of its own, so the world's
 * own draws are the same with them or without.
 */
export function assignDualNationals(world: World): void {
  const I = internationals(world);
  const store = world.players;
  const rng = new Rng(`dual:${world.seed}:${world.season}:${I.dualFrom}`);
  for (let i = I.dualFrom; i < store.count; i++) {
    if (!store.isActive(i) || store.nation2[i] !== 0xffff) continue;
    const own = store.nation[i];
    const club = store.clubId[i] >= 0 ? world.clubs[store.clubId[i]] : undefined;
    const age = store.ageOn(i, world.year, 181);
    if (club !== undefined && club.nation !== own && age >= NATURALISED_AGE && rng.chance(NATURALISED_CHANCE)) {
      store.nation2[i] = club.nation;
    } else if (rng.chance(HERITAGE_CHANCE)) {
      const conf = NATIONS[own]?.confederation;
      const options = NATIONS.map((_, n) => n).filter((n) => n !== own && NATIONS[n].confederation === conf);
      if (options.length > 0) store.nation2[i] = rng.pick(options);
    }
  }
  I.dualFrom = store.count;
}

/** The other nation a player could play for, or -1. */
export function secondNation(world: World, p: number): number {
  const n2 = world.players.nation2[p];
  return n2 !== 0xffff && n2 !== world.players.nation[p] ? n2 : -1;
}

// ---- Squads ------------------------------------------------------------------------------

export function squadOf(t: Tournament, nation: number): number[] {
  return t.squads.find(([n]) => n === nation)?.[1] ?? [];
}

/** The user's own club players among a set of players. */
function ours(world: World, players: readonly number[]): number[] {
  return world.userClubId < 0 ? [] : players.filter((p) => world.players.clubId[p] === world.userClubId);
}

/** Fit to play for his country now: active and not injured. */
export function canPlayForCountry(world: World, p: number): boolean {
  return world.players.isActive(p) && world.players.injuryDaysLeft[p] === 0;
}

/** The nations a player could turn out for: his own, a second if he has one —
 *  unless he has already played for one of them. */
function nationsOf(world: World, p: number): number[] {
  const tied = internationals(world).tiedTo.get(p);
  if (tied !== undefined) return [tied];
  const second = secondNation(world, p);
  return second >= 0 ? [world.players.nation[p], second] : [world.players.nation[p]];
}

/** The nation a capped dual national has committed to, if he has. */
export function tiedNation(world: World, p: number): number | undefined {
  return world.internationals?.tiedTo?.get(p);
}

/** Everyone a nation could call: senior players eligible for it, fit, not away with another team. */
export function eligibleFor(world: World, nation: number): number[] {
  const store = world.players;
  const out: number[] = [];
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth)) continue;
    if (store.nation[i] !== nation && store.nation2[i] !== nation) continue;
    if (!nationsOf(world, i).includes(nation)) continue;
    out.push(i);
  }
  return out;
}

/** His average rating over his last few matches, or a neutral 6.5 without any. */
export function recentForm(world: World, p: number): number {
  const form = world.ratingForm.get(p);
  return form !== undefined && form.length > 0 ? form.reduce((s, r) => s + r, 0) / form.length : 6.5;
}

/** How a national coach rates a player: ability first, form next, caps a little. */
export function selectionScore(world: World, p: number): number {
  const store = world.players;
  return store.currentAbility[p] + (recentForm(world, p) - 6.5) * 80 + Math.min(store.nationalCaps[p], 60) * 0.8
    - (store.condition[p] < 60 ? 40 : 0);
}

/** The best fourteen from a pool in the usual shape, the spares to the best left. */
export function pickSquad(world: World, pool: readonly number[]): number[] {
  const store = world.players;
  const ranked = [...pool].sort((a, b) => selectionScore(world, b) - selectionScore(world, a));
  const squad: number[] = [];
  for (const [pos, count] of Object.entries(SQUAD_SHAPE)) {
    squad.push(...ranked.filter((p) => store.position[p] === Number(pos)).slice(0, count));
  }
  for (const p of ranked) {
    if (squad.length >= SQUAD_SIZE) break;
    if (!squad.includes(p)) squad.push(p);
  }
  return squad;
}

/** The assistant's fourteen for a nation: the best of its fit, eligible players. */
export function suggestSquad(world: World, nation: number): number[] {
  return pickSquad(world, eligibleFor(world, nation).filter((p) =>
    canPlayForCountry(world, p) && !world.players.hasFlag(p, PlayerFlag.OnDuty)));
}

/** The next tournament the nation plays in that has not finished. */
export function nextTournamentFor(world: World, nation: number): Tournament | undefined {
  return world.internationals?.tournaments
    .filter((t) => t.status !== 'done' && t.teams.includes(nation))
    .sort((a, b) => a.startDay - b.startDay)[0];
}

/** Why a squad can't be named as it stands, or null if it can. */
export function squadProblem(world: World, players: readonly number[]): string | null {
  const store = world.players;
  if (players.length !== SQUAD_SIZE) return `Pick ${SQUAD_SIZE} players — you have ${players.length}.`;
  const setters = players.filter((p) => store.position[p] === Position.Setter).length;
  const liberos = players.filter((p) => store.position[p] === Position.Libero).length;
  if (setters === 0) return 'Take at least one setter.';
  if (liberos === 0) return 'Take at least one libero.';
  return null;
}

/** The manager names his nation's fourteen for its next tournament. */
export function nameSquad(world: World, players: readonly number[]): string | null {
  const nation = userNation(world);
  const t = nation >= 0 ? nextTournamentFor(world, nation) : undefined;
  if (t === undefined) return 'Your nation has no tournament coming up.';
  if (t.status !== 'planned') return 'The squad for this tournament has already been named.';
  const problem = squadProblem(world, players);
  if (problem !== null) return problem;
  internationals(world).chosen = { tournamentId: t.id, players: [...players] };
  return null;
}

/** The tournament whose squad the manager must name today, if any. */
export function squadDue(world: World): Tournament | undefined {
  const nation = userNation(world);
  if (nation < 0) return undefined;
  const t = nextTournamentFor(world, nation);
  const I = internationals(world);
  return t !== undefined && t.status === 'planned' && world.day >= t.callUpDay && I.chosen?.tournamentId !== t.id ? t : undefined;
}

/** A week before the first match: every nation names its fourteen, and they report. */
function callUp(world: World, t: Tournament): void {
  const store = world.players;
  const I = internationals(world);
  // Who each nation could call: fit, not away with another team — a dual
  // national on both lists until one of them takes him.
  const pools = new Map<number, number[]>(t.teams.map((n) => [n, []]));
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth) || store.injuryDaysLeft[i] > 0) continue;
    if (store.hasFlag(i, PlayerFlag.OnDuty)) continue;
    for (const n of nationsOf(world, i)) pools.get(n)?.push(i);
  }
  const mine = userNation(world);
  const order = [...t.teams].sort((a, b) => Number(b === mine) - Number(a === mine));
  const taken = new Set<number>();
  for (const n of order) {
    const pool = (pools.get(n) ?? []).filter((p) => !taken.has(p));
    let squad: number[];
    if (n === mine && I.chosen?.tournamentId === t.id) {
      // The manager's own fourteen — topped up by the assistant if any have since got hurt.
      squad = I.chosen.players.filter((p) => pool.includes(p));
      if (squad.length < SQUAD_SIZE) squad.push(...pickSquad(world, pool.filter((p) => !squad.includes(p))).slice(0, SQUAD_SIZE - squad.length));
    } else {
      squad = pickSquad(world, pool);
    }
    for (const p of squad) taken.add(p);
    t.squads.push([n, squad]);
    const team = teamOf(world, n);
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
  if (I.chosen?.tournamentId === t.id) I.chosen = null;

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
      intl: {
        kind: 'callup', tournamentId: t.id, tournament: t.name,
        callUps: called.map(([p, n]) => ({ p, nation: n, caps: store.nationalCaps[p] })),
      },
    });
  }
}

/** "18 July 2026" for a day, as the messages put it. */
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

/** A nation's side for a match: its fit squad players, picked as a club picks,
 *  playing the manager's tactics if it is his nation. */
export function nationSetup(world: World, t: Tournament, nation: number): TeamSetup {
  const store = world.players;
  const pick = pickLineup(
    store,
    { players: squadOf(t, nation), preferredLineup: [], preferredLibero: -1, preferredDefensiveLibero: -1 },
    undefined,
    (p) => canPlayForCountry(world, p),
  );
  return { clubId: -1, name: nationName(nation), ...pick, tactics: teamOf(world, nation)?.tactics ?? defaultTactics() };
}

/** How much a match matters: a pool match, a knockout tie, the final. */
export function matchImportance(m: IntlMatch): number {
  return m.round < 0 ? 0.6 : m.stage === 'Final' ? 1 : 0.8;
}

/** Play one match through the rally engine. */
function play(world: World, t: Tournament, m: IntlMatch): Map<number, PlayerMatchStats> {
  const result = simulateMatch(world.players, {
    home: nationSetup(world, t, m.home),
    away: nationSetup(world, t, m.away),
    format: MatchFormat.BestOf5,
    importance: matchImportance(m),
    neutralVenue: m.home !== t.host,
    collectLog: false,
    seed: world.rng.next(),
    autoCoach: [true, true],
  });
  return applyIntlResult(world, t, m, result);
}

/**
 * A finished match into the world — the one the engine just simulated, or
 * the one the manager played live: the score, each player's record under the
 * tournament's name, caps, tiredness, a dual national tied to the nation he
 * played for, and the world ranking.
 */
export function applyIntlResult(world: World, t: Tournament, m: IntlMatch, result: MatchResult): Map<number, PlayerMatchStats> {
  const store = world.players;
  const I = internationals(world);
  m.played = true;
  m.homeSets = result.homeSets;
  m.awaySets = result.awaySets;
  m.setScores = result.setScores;
  m.mvp = result.mvp;

  const fixture = {
    id: -1 - m.id, competitionId: t.competitionId, day: m.day, home: m.home, away: m.away,
    homeSets: m.homeSets, awaySets: m.awaySets, setScores: m.setScores, mvp: m.mvp, played: true,
  } as unknown as Fixture;
  const homeStats = result.stats.home.players;
  const awayStats = result.stats.away.players;
  recordFixture(world, fixture, homeStats, awayStats);

  const all = new Map<number, PlayerMatchStats>([...homeStats, ...awayStats]);
  const sides = [[homeStats, m.home, m.homeSets, m.awaySets], [awayStats, m.away, m.awaySets, m.homeSets]] as const;
  for (const [stats, nation, setsFor, setsAgainst] of sides) {
    for (const [p, s] of stats) {
      if (!playedInMatch(s)) continue;
      store.nationalCaps[p] = Math.min(65535, store.nationalCaps[p] + 1);
      store.condition[p] = Math.max(20, store.condition[p] - world.rng.int(8, 18));
      if (!I.tiedTo.has(p)) I.tiedTo.set(p, nation);
      const line = t.stats.get(p) ?? [0, 0, 0, 0];
      line[0]++;
      line[1] += s.attackKills + s.serveAces + s.blockPoints;
      line[2] += matchRating(s, store.position[p] as Position, setsFor, setsAgainst);
      if (m.mvp === p) line[3]++;
      t.stats.set(p, line);
    }
  }

  // The world ranking: an upset is worth more than a win the ranking expected.
  const home = teamOf(world, m.home);
  const away = teamOf(world, m.away);
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
    const [home, away] = orient(t, seeds[order[i] - 1], seeds[order[i + 1] - 1]);
    t.matches.push(newMatch(I, day, home, away, roundName(seeds.length), 0, i / 2));
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
    const [home, away] = orient(t, winnerOf(main[i]), winnerOf(main[i + 1]));
    t.matches.push(newMatch(I, day, home, away, roundName(main.length), round + 1, i / 2));
  }
  if (main.length === 2) {
    const [home, away] = orient(t, loserOf(main[0]), loserOf(main[1]));
    t.matches.push(newMatch(I, day, home, away, 'Bronze medal match', round + 1, 1, true));
  } else {
    for (const m of main) release(world, t, loserOf(m));
  }
}

/** Once the day's matches are in: the bracket drawn, the next round, or the end. */
function progress(world: World, t: Tournament): void {
  if (t.status === 'pools' && t.matches.every((m) => m.played)) drawKnockout(world, t);
  else if (t.status === 'knockout') nextRound(world, t);
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
  let mvp = -1;
  let best = 0;
  for (const p of squadOf(t, podium[0])) {
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

  const team = teamOf(world, podium[0]);
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
  // The manager's name, if his nation did well.
  const mine = userNation(world);
  const place = t.placings.indexOf(mine);
  if (place >= 0 && place < 3) {
    world.career.reputation = Math.min(10000, Math.round(world.career.reputation * (place === 0 ? 1.06 : 1.03) + 50));
  }

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
    body: `${nationName(podium[0])} beat ${nationName(podium[1])} ${score} in the final of the ${t.name}` +
      `${t.host >= 0 ? `, played in ${nationName(t.host)}` : ''}.` +
      `${podium[2] !== undefined ? ` ${nationName(podium[2])} took bronze, beating ${nationName(podium[3])}.` : ''}` +
      `${mvp >= 0 ? ` ${store.fullName(mvp)} was named the tournament's Most Valuable Player.` : ''}`,
    nation: podium[0],
    playerIdx: mvp >= 0 ? mvp : undefined,
    competitionId: t.competitionId,
  });
  judgeCoaches(world, t);
}

// ---- National jobs ---------------------------------------------------------------------------

/** A nation's standing in the world, on the scale of a club's reputation (0-10000). */
export function nationStanding(world: World, nation: number): number {
  const rank = worldRanking(world).indexOf(nation);
  return Math.max(1500, 7500 - Math.max(0, rank) * 160);
}

/**
 * A career that begins at a national team, with or without a club: the
 * manager takes over the nation, and — if it is his first job of all — his
 * name starts where the nation's standing puts it, the way a club's does for
 * a club career.
 */
export function startNationalCareer(world: World, nation: number): void {
  if (world.career.jobs.length === 0 && world.userClubId < 0) {
    world.career.reputation = Math.round(Math.max(600, nationStanding(world, nation) * 0.7));
  }
  appointNationalCoach(world, nation);
}

/** How likely a federation is to want the manager, 0-1: his name against its
 *  standing in the world — and a federation likes one of its own. */
export function nationalHiringChance(world: World, nation: number): number {
  const standing = nationStanding(world, nation);
  const own = nation === world.manager.nation ? 0.15 : 0;
  return Math.max(0.03, Math.min(0.95, 0.5 + own + (world.career.reputation - standing * 0.85) / 2200));
}

/** Always a few national jobs open, among the nations the manager could aspire to. */
function ensureVacancies(world: World, ranked: number[], rng: Rng): void {
  const I = internationals(world);
  const mine = userNation(world);
  const candidates = ranked.slice(4, 40).filter((n) => n !== mine && !I.vacancies.some((v) => v.nation === n));
  while (I.vacancies.length < MIN_VACANCIES && candidates.length > 0) {
    const n = candidates.splice(rng.int(0, candidates.length - 1), 1)[0];
    I.vacancies.push({ nation: n, since: world.day, fillsOn: world.day + VACANCY_DAYS });
  }
}

/** Why the manager can't apply for a nation's job now, or null if he can. */
export function nationalApplicationBlock(world: World, nation: number): string | null {
  const I = internationals(world);
  if (userNation(world) === nation) return `You already coach ${nationName(nation)}.`;
  if (!I.vacancies.some((v) => v.nation === nation)) return `${nationName(nation)} are not looking for a head coach.`;
  if (I.applications.some((a) => a.nation === nation)) return `You have applied — ${nationName(nation)} will answer soon.`;
  return null;
}

/** Apply for a national job; the federation answers within a week. Returns the answer day, or null. */
export function applyForNationalJob(world: World, nation: number): number | null {
  if (nationalApplicationBlock(world, nation) !== null) return null;
  const answerOn = world.day + world.rng.int(3, 7);
  internationals(world).applications.push({ nation, answerOn });
  return answerOn;
}

/** The manager takes over a nation — leaving the one he had, if any. */
export function appointNationalCoach(world: World, nation: number): void {
  const I = internationals(world);
  const old = userNation(world);
  if (old >= 0) leaveNationalJob(world, false);
  world.career.nationalTeam = nation;
  ensureManagerAttributes(world);
  (world.career.nationalJobs ??= []).push({ nation, startDay: world.day, endDay: -1 });
  const team = teamOf(world, nation);
  if (team !== undefined) team.managedByUser = true;
  I.vacancies = I.vacancies.filter((v) => v.nation !== nation);
  I.applications = I.applications.filter((a) => a.nation !== nation);
  I.offers = I.offers.filter((o) => o.nation !== nation);
  const next = nextTournamentFor(world, nation);
  postMessage(world, {
    subject: `You are the new head coach of ${nationName(nation)}`,
    body: `The ${nationName(nation)} Volleyball Federation has appointed you head coach of the national team` +
      `${world.userClubId >= 0 ? `, alongside your job at ${world.clubs[world.userClubId]?.name ?? 'your club'}` : ''}. ` +
      (next !== undefined
        ? `Your first tournament is the ${next.name}, and your fourteen are due by ${dateLabel(world, next.callUpDay)}. ` +
          'A week before, the federation will send you the players to choose from — you name the squad in that message.'
        : 'Your nation has no tournament coming up just yet.'),
    from: `${nationName(nation)} Volleyball Federation`,
    category: 'career',
  });
  askForSquad(world);
  postNews(world, {
    kind: 'coach',
    headline: `${nationName(nation)} appoint ${world.manager.firstName} ${world.manager.lastName}`,
    body: `${world.manager.firstName} ${world.manager.lastName} is the new head coach of the ${nationName(nation)} national team.`,
    nation,
  });
}

/** The manager leaves his national job — by choice, or the federation's. */
export function leaveNationalJob(world: World, sacked: boolean, why = ''): void {
  const nation = userNation(world);
  if (nation < 0) return;
  const I = internationals(world);
  const team = teamOf(world, nation);
  if (team !== undefined) team.managedByUser = false;
  world.career.nationalTeam = undefined;
  const spell = world.career.nationalJobs?.find((j) => j.nation === nation && j.endDay < 0);
  if (spell !== undefined) spell.endDay = world.day;
  I.chosen = null;
  I.vacancies.push({ nation, since: world.day, fillsOn: world.day + VACANCY_DAYS });
  if (sacked) {
    world.career.reputation = Math.round(world.career.reputation * 0.95);
    postMessage(world, {
      subject: `${nationName(nation)} relieve you of your duties`,
      body: `The ${nationName(nation)} Volleyball Federation has decided to make a change. ${why}`.trim(),
      from: `${nationName(nation)} Volleyball Federation`,
      category: 'career',
    });
  }
  postNews(world, {
    kind: 'coach',
    headline: sacked
      ? `${nationName(nation)} part company with ${world.manager.firstName} ${world.manager.lastName}`
      : `${world.manager.firstName} ${world.manager.lastName} steps down as ${nationName(nation)} coach`,
    body: `The ${nationName(nation)} national team is looking for a new head coach.`,
    nation,
  });
}

/** After a tournament: coaches whose nation finished far below where it was seeded are in trouble. */
function judgeCoaches(world: World, t: Tournament): void {
  const I = internationals(world);
  const mine = userNation(world);
  const rng = new Rng(`judge:${world.seed}:${t.id}`);
  t.teams.forEach((n, seed) => {
    const place = t.placings.indexOf(n);
    if (place - seed < DISAPPOINTMENT || seed > 11) return;
    if (n === mine) {
      if (rng.chance(0.4)) {
        leaveNationalJob(world, true, `Seeded ${ordinal(seed + 1)}, the team finished ${ordinal(place + 1)} at the ${t.name}.`);
      }
    } else if (!I.vacancies.some((v) => v.nation === n) && rng.chance(0.3)) {
      I.vacancies.push({ nation: n, since: world.day, fillsOn: world.day + VACANCY_DAYS });
      postNews(world, {
        kind: 'coach',
        headline: `${nationName(n)} part company with their head coach`,
        body: `After a disappointing ${t.name} — seeded to go deep, out in ${ordinal(place + 1)} place — ` +
          `${nationName(n)} are looking for a new national team coach.`,
        nation: n,
      });
    }
  });
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/** The job market's day: applications answered, vacancies filled once they have waited long enough. */
function nationalJobsDay(world: World): void {
  const I = internationals(world);
  I.offers = I.offers.filter((o) => o.expiresOn >= world.day);
  for (const a of [...I.applications]) {
    if (a.answerOn > world.day) continue;
    I.applications = I.applications.filter((x) => x !== a);
    if (!I.vacancies.some((v) => v.nation === a.nation)) continue;
    if (world.rng.chance(nationalHiringChance(world, a.nation))) {
      offerNationalJob(world, a.nation, true);
    } else {
      postMessage(world, {
        subject: `${nationName(a.nation)}: thank you for your application`,
        body: `The ${nationName(a.nation)} Volleyball Federation has decided to look elsewhere for its head coach.`,
        from: `${nationName(a.nation)} Volleyball Federation`,
        category: 'career',
      });
    }
  }
  nationalApproaches(world);
  for (const v of [...I.vacancies]) {
    if (v.fillsOn > world.day || I.applications.some((a) => a.nation === v.nation)) continue;
    if (I.offers.some((o) => o.nation === v.nation)) continue;
    I.vacancies = I.vacancies.filter((x) => x !== v);
    postNews(world, {
      kind: 'coach',
      headline: `${nationName(v.nation)} name a new national team coach`,
      body: `The ${nationName(v.nation)} Volleyball Federation has filled the head coach's job.`,
      nation: v.nation,
    });
  }
}

/** How long a federation's offer stands. */
const NATIONAL_OFFER_DAYS = 10;
/** A federation approaches him at most this often. */
const NATIONAL_APPROACH_GAP = 56;

/** A federation offers the manager its job — in the inbox, to accept or turn down. */
export function offerNationalJob(world: World, nation: number, applied: boolean): NationalOffer {
  const I = internationals(world);
  const offer: NationalOffer = {
    id: I.nextOfferId++, nation, madeOn: world.day, expiresOn: world.day + NATIONAL_OFFER_DAYS, applied,
  };
  I.offers.push(offer);
  const next = nextTournamentFor(world, nation);
  const rank = worldRanking(world).indexOf(nation) + 1;
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  postMessage(world, {
    subject: applied ? `${nationName(nation)} offer you the national team job` : `${nationName(nation)} want you as their head coach`,
    body: (applied
      ? `The ${nationName(nation)} Volleyball Federation has considered your application and would like you to coach the national team.`
      : `The ${nationName(nation)} Volleyball Federation is looking for a head coach for the national team, and would like it to be you.`) +
      ` ${nationName(nation)} are ${ordinal(rank)} in the world ranking` +
      `${next !== undefined ? `, and their next tournament is the ${next.name}, starting on ${dateLabel(world, next.startDay)}` : ''}.` +
      `${club !== undefined ? ` The job goes alongside your work at ${club.name}.` : ''}` +
      `${userNation(world) >= 0 ? ` Accepting it means leaving ${nationName(userNation(world))}.` : ''}` +
      ` The offer stands until ${dateLabel(world, offer.expiresOn)}.`,
    from: `${nationName(nation)} Volleyball Federation`,
    nationalOffer: { id: offer.id, nation },
    category: 'career',
  });
  return offer;
}

/** The manager takes a federation's offer. False if it has lapsed. */
export function acceptNationalOffer(world: World, offerId: number): boolean {
  const I = internationals(world);
  const offer = I.offers.find((o) => o.id === offerId);
  if (offer === undefined) return false;
  I.offers = I.offers.filter((o) => o !== offer);
  appointNationalCoach(world, offer.nation);
  return true;
}

/** The manager turns a federation down; it looks elsewhere, and soon. */
export function declineNationalOffer(world: World, offerId: number): void {
  const I = internationals(world);
  const offer = I.offers.find((o) => o.id === offerId);
  if (offer === undefined) return;
  I.offers = I.offers.filter((o) => o !== offer);
  const v = I.vacancies.find((x) => x.nation === offer.nation);
  if (v !== undefined) v.fillsOn = Math.min(v.fillsOn, world.day + 7);
}

/**
 * Federations looking for a coach call the manager when his name fits theirs:
 * one that would be keen to have him, now and then — or, if he already has a
 * nation, one well above it in the world.
 */
function nationalApproaches(world: World): void {
  const I = internationals(world);
  if (world.day % 7 !== 5 || I.offers.length > 0) return;
  if (I.lastApproach >= 0 && world.day - I.lastApproach < NATIONAL_APPROACH_GAP) return;
  const mine = userNation(world);
  const ranking = worldRanking(world);
  const rng = new Rng(`napp:${world.seed}:${world.day}`);
  const candidates = I.vacancies
    .map((v) => v.nation)
    .filter((n) => !I.applications.some((a) => a.nation === n) && nationalHiringChance(world, n) >= 0.55)
    .filter((n) => mine < 0 || ranking.indexOf(n) + 8 <= ranking.indexOf(mine));
  for (const n of candidates) {
    if (!rng.chance(mine < 0 ? 0.12 : 0.05)) continue;
    offerNationalJob(world, n, false);
    I.lastApproach = world.day;
    return;
  }
}

// ---- What the manager hears, and the papers --------------------------------------------------

/** One of the manager's club players in one match, for the report. */
function playerLine(world: World, p: number, nation: number, m: IntlMatch, stats: Map<number, PlayerMatchStats>): IntlPlayerLine {
  const store = world.players;
  const s = stats.get(p);
  const base = { p, nation, mvp: m.mvp === p };
  if (s === undefined || !playedInMatch(s)) {
    return {
      ...base, absent: store.injuryDaysLeft[p] > 0 ? 'injured' : 'bench',
      rating: 0, points: 0, kills: 0, attacks: 0, aces: 0, blocks: 0, receptions: 0, goodReceptions: 0, digs: 0, assists: 0,
    };
  }
  const us = m.home === nation ? m.homeSets : m.awaySets;
  const them = m.home === nation ? m.awaySets : m.homeSets;
  return {
    ...base,
    rating: matchRating(s, store.position[p] as Position, us, them),
    points: s.attackKills + s.serveAces + s.blockPoints,
    kills: s.attackKills,
    attacks: s.attacksTotal,
    aces: s.serveAces,
    blocks: s.blockPoints,
    receptions: s.receptionsTotal,
    goodReceptions: s.receptionPerfect + s.receptionPositive,
    digs: s.digsTotal,
    assists: s.setAssists,
  };
}

/** A line of text for the same, for the message's preview. */
function lineText(world: World, l: IntlPlayerLine, m: IntlMatch): string {
  const name = world.players.fullName(l.p);
  const opp = m.home === l.nation ? m.away : m.home;
  const us = m.home === l.nation ? m.homeSets : m.awaySets;
  const them = m.home === l.nation ? m.awaySets : m.homeSets;
  const fixture = `${nationName(l.nation)} ${us}-${them} ${nationName(opp)} (${m.stage})`;
  if (l.absent === 'injured') return `• ${name} — ${fixture}: missed the match injured.`;
  if (l.absent === 'bench') return `• ${name} — ${fixture}: did not get on court.`;
  return `• ${name} — ${fixture}: played, ${l.points} point${l.points === 1 ? '' : 's'}, rating ${l.rating.toFixed(1)}` +
    `${l.mvp ? ' — man of the match' : ''}.`;
}

/** The day's report on the manager's club players at a tournament. */
export function postMatchReport(world: World, t: Tournament, matches: IntlMatch[], stats: Map<number, PlayerMatchStats>): void {
  const cards: IntlMatchCard[] = [];
  const text: string[] = [];
  for (const m of matches) {
    const players: IntlPlayerLine[] = [];
    for (const nation of [m.home, m.away]) {
      for (const p of ours(world, squadOf(t, nation))) players.push(playerLine(world, p, nation, m, stats));
    }
    if (players.length === 0) continue;
    cards.push({
      stage: m.stage, home: m.home, away: m.away, homeSets: m.homeSets, awaySets: m.awaySets,
      setScores: m.setScores, mvp: m.mvp, players,
    });
    text.push(...players.map((l) => lineText(world, l, m)));
  }
  if (cards.length === 0) return;
  postMessage(world, {
    subject: `${t.name}: how your players got on`,
    body: `Today at the ${t.name}:\n${text.join('\n')}`,
    from: 'International Desk',
    playerIdx: cards[0].players[0].p,
    category: 'international',
    intl: { kind: 'matchday', tournamentId: t.id, tournament: t.name, matches: cards },
  });
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
  const lines: IntlTournamentLine[] = back.map(([p, n]) => {
    const s = t.stats.get(p);
    return {
      p, nation: n, apps: s?.[0] ?? 0, points: s?.[1] ?? 0, avg: s !== undefined && s[0] > 0 ? s[2] / s[0] : 0,
      mvps: s?.[3] ?? 0, place: t.placings.indexOf(n), finish: finishLine(t, n), tournamentMvp: t.mvp === p,
    };
  });
  const text = lines.map((l) => {
    const played = l.apps === 0 ? 'did not play a match'
      : `played ${l.apps} match${l.apps === 1 ? '' : 'es'} — ${l.points} points, average rating ${l.avg.toFixed(2)}`;
    return `• ${store.fullName(l.p)} (${nationName(l.nation)}) ${played}. ${nationName(l.nation)} ${l.finish}.` +
      `${l.tournamentMvp ? ' He was named the tournament\'s Most Valuable Player!' : ''}`;
  });
  const gold = back.find(([, n]) => t.placings[0] === n);
  postMessage(world, {
    subject: gold !== undefined
      ? `${store.fullName(gold[0])} is ${championsTitle(t).replace(/s$/, '')}!`
      : back.length === 1
        ? `${store.fullName(back[0][0])} returns from the ${t.name}`
        : `${back.length} players return from the ${t.name}`,
    body: `${back.length === 1 ? 'One of your players is' : 'Your players are'} back from the ${t.name} and available again:\n` +
      `${text.join('\n')}\nExpect them to need a few days to recover their condition.`,
    from: 'International Desk',
    playerIdx: back[0][0],
    category: 'international',
    intl: { kind: 'homecoming', tournamentId: t.id, tournament: t.name, lines },
  });
}

/** The papers: the tournament under way, and any shock along the way. */
function headlines(world: World, t: Tournament, today: IntlMatch[]): void {
  // The field by world ranking, best first.
  const points = (n: number): number => teamOf(world, n)?.rankingPoints ?? 0;
  const rank = [...t.teams].sort((a, b) => points(b) - points(a));
  if (world.day === t.startDay) {
    const favourites = rank.slice(0, 3).map(nationName);
    postNews(world, {
      kind: 'result',
      headline: `The ${t.name} gets under way${t.host >= 0 ? ` in ${nationName(t.host)}` : ''}`,
      body: `${t.teams.length} nations, ${t.pools.length} pool${t.pools.length === 1 ? '' : 's'}, and one title. ` +
        `The world ranking makes ${favourites.join(', ')} the favourites` +
        `${t.host >= 0 ? `; ${nationName(t.host)} have home advantage` : ''}.`,
      nation: t.host >= 0 ? t.host : -1,
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

/** The manager's national team's match today, still to be played — his to play live. */
export function userMatchToday(world: World): { t: Tournament; m: IntlMatch } | null {
  const nation = userNation(world);
  if (nation < 0 || world.internationals === undefined) return null;
  for (const t of world.internationals.tournaments) {
    if (t.status === 'planned' || t.status === 'done') continue;
    const m = t.matches.find((x) => x.day === world.day && !x.played && (x.home === nation || x.away === nation));
    if (m !== undefined) return { t, m };
  }
  return null;
}

/** A week before squads are due, the federation reminds the manager to name his. */
const SQUAD_REMINDER_DAYS = 7;

/**
 * A week before squads are due — or the day he takes over, if that is later —
 * the federation sends the manager the players to choose from: the message is
 * where he names his fourteen. Sent once a tournament; returns it, if there is one.
 */
export function askForSquad(world: World): GameMessage | undefined {
  const nation = userNation(world);
  const t = nation >= 0 ? nextTournamentFor(world, nation) : undefined;
  if (t === undefined || t.status !== 'planned' || world.day < t.callUpDay - SQUAD_REMINDER_DAYS) return undefined;
  const I = internationals(world);
  if (I.squadAsked.includes(t.id)) {
    return [...world.messages].reverse().find((m) => m.intl?.kind === 'squad' && m.intl.tournamentId === t.id);
  }
  I.squadAsked.push(t.id);
  return postMessage(world, {
    subject: `${nationName(nation)}: name your squad for the ${t.name}`,
    body: `The ${t.name} starts on ${dateLabel(world, t.startDay)}${t.host >= 0 ? ` in ${nationName(t.host)}` : ''}, ` +
      `and the federation needs your fourteen by ${dateLabel(world, t.callUpDay)}. Here are the players you can call — ` +
      'two setters, two opposites, four outside hitters, four middles and two liberos is the usual shape. ' +
      'Until you confirm your squad, the day squads are due will wait for you.',
    from: `${nationName(nation)} Volleyball Federation`,
    category: 'international',
    intl: { kind: 'squad', tournamentId: t.id, tournament: t.name },
  });
}

/** The day's international business: squads named, matches played, rounds drawn, players home, jobs. */
export function internationalDay(world: World): void {
  planInternationals(world);
  const I = internationals(world);
  askForSquad(world);
  for (const t of I.tournaments) {
    if (t.status === 'done' || t.season !== world.season) continue;
    if (t.status === 'planned') {
      if (world.day >= t.callUpDay) callUp(world, t);
      else continue;
    }
    if (t.status === 'called' && world.day >= t.startDay) t.status = 'pools';
    const outBefore = t.out.length;
    const today = t.matches.filter((m) => m.day === world.day && !m.played);
    const stats = new Map<number, PlayerMatchStats>();
    for (const m of today) for (const [p, s] of play(world, t, m)) stats.set(p, s);
    progress(world, t);
    if (today.length > 0) postMatchReport(world, t, today, stats);
    const goneHome = t.out.slice(outBefore);
    if (goneHome.length > 0) homecoming(world, t, goneHome);
    headlines(world, t, today);
  }
  nationalJobsDay(world);
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
  // The manager's own nation's matches.
  const mine = userNation(world);
  if (mine >= 0) {
    for (const t of I.tournaments) {
      for (const m of t.matches) {
        if (m.day !== day || (m.home !== mine && m.away !== mine)) continue;
        const opp = m.home === mine ? m.away : m.home;
        notes.set(`m${m.id}`, `${nationName(mine)} v ${nationName(opp)}`);
      }
    }
  }
  return [...notes.values()].map((label) => ({ label, kind: 'intl' as const }));
}
