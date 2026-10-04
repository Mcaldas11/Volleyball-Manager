/**
 * Every club's youth side: its academy players, playing an under-19 league
 * of their own beside the senior one — the same clubs, a weekly round from
 * the end of August until every side has played every other home and away.
 *
 * A youth match is decided by the strength of the two academies — the best
 * seven each can put out — and a little luck. Who plays gets minutes, and
 * minutes are where training sticks (see weeklyTraining): an academy player
 * who plays every week comes on quicker than one left out. Each player's
 * youth season is kept — matches, points, the average rating — and the
 * manager's own league's results for the academy screen.
 *
 * The youth game has dice of its own, so playing it never moves the world's.
 *
 * And a prospect the manager doesn't want can be sold: the clubs who would
 * take him make their offer, and he goes to their academy.
 */

import { Rng } from '../core/rng.ts';
import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { roundRobin } from '../season/schedule.ts';
import { postMessage } from './inbox.ts';
import { newsTransfer } from './news.ts';
import { payFee } from './negotiation.ts';
import { dayOfSeason, logTransfer, seasonEndDay, type World } from './world.ts';

export interface YouthRow {
  clubId: number;
  played: number;
  won: number;
  lost: number;
  setsFor: number;
  setsAgainst: number;
  points: number;
}

export interface YouthLeague {
  /** The senior league whose clubs' youth sides play in it. */
  leagueId: number;
  name: string;
  nation: number;
  /** In schedule order. */
  clubs: number[];
  table: YouthRow[];
  /** The next round to play, from 0. */
  round: number;
  rounds: number;
  /** Who won it, once every round is played; -1 until then. */
  champion: number;
}

export interface YouthResult {
  round: number;
  day: number;
  home: number;
  away: number;
  homeSets: number;
  awaySets: number;
  /** The best player on the court, or -1. */
  mvp: number;
}

export interface YouthState {
  season: number;
  leagues: YouthLeague[];
  /** The manager's own youth league's results this season. */
  results: YouthResult[];
  /** Each youth player's season so far: matches, points, rating sum. */
  stats: Map<number, [number, number, number]>;
}

/** The first youth round, by day of the season — late August — then one a week. */
const YOUTH_START = 58;
const YOUTH_EVERY = 7;
/** A side short of seven: the gaps are filled by trialists of this ability. */
const TRIALIST = 220;
/** Where a youth player's playing time heads: a match played, a match missed. */
const PLAYED_TARGET = 62;
const MISSED_TARGET = 25;
const PLAYING_TIME_WEIGHT = 0.2;

/** The youth game this season — the leagues drawn up afresh each summer, from the senior ones. */
export function youthState(world: World): YouthState {
  if (world.youth !== undefined && world.youth.season === world.season) return world.youth;
  const leagues: YouthLeague[] = [];
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.participants.length < 4) continue;
    const clubs = comp.participants.filter((id) => world.clubs[id] !== undefined);
    leagues.push({
      leagueId: comp.id,
      name: `${comp.name} U19`,
      nation: comp.nation,
      clubs,
      table: clubs.map((clubId) => ({ clubId, played: 0, won: 0, lost: 0, setsFor: 0, setsAgainst: 0, points: 0 })),
      round: 0,
      rounds: 2 * (clubs.length % 2 === 0 ? clubs.length - 1 : clubs.length),
      champion: -1,
    });
  }
  world.youth = { season: world.season, leagues, results: [], stats: new Map() };
  return world.youth;
}

/** A league's pairings for a round: the first half of the season, then the same again the other way round. */
export function youthRound(league: YouthLeague, round: number): Array<[number, number]> {
  const half = roundRobin(league.clubs);
  const pairs = half[round % half.length] ?? [];
  return round < half.length ? pairs : pairs.map(([h, a]) => [a, h]);
}

/** The day a youth round is played. */
export function youthRoundDay(world: World, round: number): number {
  return world.day - dayOfSeason(world) + YOUTH_START + round * YOUTH_EVERY;
}

/** The youth league the manager's club plays in, if it has one. */
export function userYouthLeague(world: World): YouthLeague | undefined {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return undefined;
  return youthState(world).leagues.find((l) => l.clubs.includes(club.id));
}

/** The seven a youth side puts out: its best fit academy players, the libero among them if it has one. */
export function youthSeven(world: World, club: Club): number[] {
  const store = world.players;
  const fit = club.youthPlayers
    .filter((p) => store.isActive(p) && store.injuryDaysLeft[p] === 0)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const libero = fit.find((p) => store.position[p] === Position.Libero);
  const rest = fit.filter((p) => p !== libero).slice(0, libero !== undefined ? 6 : 7);
  return libero !== undefined ? [...rest, libero] : rest;
}

/** How strong a youth side is: the average ability of its seven, trialists filling any gaps. */
function strength(world: World, seven: readonly number[]): number {
  let total = 0;
  for (const p of seven) total += world.players.currentAbility[p];
  return (total + TRIALIST * Math.max(0, 7 - seven.length)) / 7;
}

/** How much of a side's attack a player is, by position. */
const SCORING: Readonly<Record<Position, number>> = {
  [Position.OutsideHitter]: 1, [Position.Opposite]: 1.15, [Position.MiddleBlocker]: 0.65,
  [Position.Setter]: 0.25, [Position.Libero]: 0,
};

/** One youth match: the result, and each player's evening. */
function playYouthMatch(world: World, rng: Rng, home: Club, away: Club): YouthResult & { lines: Array<[number, number, number]> } {
  const store = world.players;
  const sides = [youthSeven(world, home), youthSeven(world, away)];
  const s = [strength(world, sides[0]), strength(world, sides[1])];
  const pHome = 1 / (1 + Math.exp(-(s[0] - s[1] + 25) / 70));
  const homeWon = rng.chance(pHome);
  // The closer the sides, the likelier a long match.
  const close = 1 - Math.abs(2 * pHome - 1);
  const loserSets = rng.weightedIndex([1 - close * 0.6, 1, 0.4 + close]);
  const homeSets = homeWon ? 3 : loserSets;
  const awaySets = homeWon ? loserSets : 3;
  const lines: Array<[number, number, number]> = [];
  let mvp = -1;
  let best = -Infinity;
  sides.forEach((seven, t) => {
    const won = t === 0 ? homeWon : !homeWon;
    const setsPlayed = homeSets + awaySets;
    const avg = strength(world, seven);
    for (const p of seven) {
      const share = SCORING[store.position[p] as Position];
      const points = Math.round(share * setsPlayed * rng.range(2, 4.4) * (store.currentAbility[p] / Math.max(1, avg)));
      const rating = Math.max(4, Math.min(9.6,
        6.2 + (won ? 0.45 : -0.3) + (store.currentAbility[p] - avg) / 350 + rng.gaussian(0, 0.45) + points * 0.02));
      lines.push([p, points, rating]);
      if (won && rating > best) {
        best = rating;
        mvp = p;
      }
    }
  });
  return { round: 0, day: world.day, home: home.id, away: away.id, homeSets, awaySets, mvp, lines };
}

function rowOf(league: YouthLeague, clubId: number): YouthRow {
  return league.table.find((r) => r.clubId === clubId)!;
}

/** Volleyball's points: three for a win in three or four sets, two in five; one for a five-set defeat. */
function award(row: YouthRow, setsFor: number, setsAgainst: number): void {
  row.played++;
  row.setsFor += setsFor;
  row.setsAgainst += setsAgainst;
  if (setsFor > setsAgainst) {
    row.won++;
    row.points += setsAgainst === 2 ? 2 : 3;
  } else {
    row.lost++;
    if (setsFor === 2) row.points += 1;
  }
}

/** The youth table, leaders first. */
export function youthTable(league: YouthLeague): YouthRow[] {
  return [...league.table].sort((a, b) =>
    b.points - a.points || b.won - a.won || (b.setsFor - b.setsAgainst) - (a.setsFor - a.setsAgainst));
}

/**
 * The day's youth football — volleyball: on a youth round's day, every youth
 * league plays it; the players' minutes move their playing time, their
 * evenings go on their youth season, and the last round crowns the champions.
 */
export function youthDay(world: World): void {
  const state = youthState(world);
  const d = dayOfSeason(world);
  if (d < YOUTH_START || (d - YOUTH_START) % YOUTH_EVERY !== 0) return;
  const round = (d - YOUTH_START) / YOUTH_EVERY;
  const store = world.players;
  const mine = world.userClubId;
  state.leagues.forEach((league, li) => {
    if (league.round !== round || round >= league.rounds) return;
    const rng = new Rng(world.season * 100_003 + li * 1_009 + round * 17 + 1);
    const played = new Set<number>();
    for (const [h, a] of youthRound(league, round)) {
      const home = world.clubs[h];
      const away = world.clubs[a];
      if (home === undefined || away === undefined) continue;
      const r = playYouthMatch(world, rng, home, away);
      award(rowOf(league, h), r.homeSets, r.awaySets);
      award(rowOf(league, a), r.awaySets, r.homeSets);
      for (const [p, points, rating] of r.lines) {
        const line = state.stats.get(p) ?? [0, 0, 0];
        line[0]++;
        line[1] += points;
        line[2] += rating;
        state.stats.set(p, line);
        played.add(p);
      }
      if (league.clubs.includes(mine)) {
        state.results.push({ round, day: world.day, home: h, away: a, homeSets: r.homeSets, awaySets: r.awaySets, mvp: r.mvp });
      }
    }
    // Minutes are where training sticks.
    for (const clubId of league.clubs) {
      for (const p of world.clubs[clubId]?.youthPlayers ?? []) {
        const target = played.has(p) ? PLAYED_TARGET : MISSED_TARGET;
        store.playingTime[p] = Math.round(store.playingTime[p] * (1 - PLAYING_TIME_WEIGHT) + target * PLAYING_TIME_WEIGHT);
      }
    }
    league.round++;
    if (league.round >= league.rounds) {
      league.champion = youthTable(league)[0]?.clubId ?? -1;
      if (league.champion === mine && mine >= 0) {
        postMessage(world, {
          subject: `Your U19s are champions of the ${league.name}`,
          body: `The academy side have won the ${league.name}. ` +
            'A generation that wins together tends to come through together.',
          clubId: mine,
          category: 'matchday',
        });
      }
    }
  });
}

// ---- Selling a prospect -------------------------------------------------------------

export interface AcademyOffer {
  clubId: number;
  fee: number;
}

/**
 * Who would take one of the manager's academy players, and what they'd pay:
 * clubs of his country with room in their academy and the standing to want
 * him, the biggest offering most. The same offers for the rest of the week.
 */
export function academyOffers(world: World, p: number): AcademyOffer[] {
  const store = world.players;
  const own = world.clubs[world.userClubId];
  if (own === undefined || !own.youthPlayers.includes(p)) return [];
  const rng = new Rng(store.id[p] * 31 + Math.floor(world.day / 7) * 7919);
  const value = Math.max(2_000, store.value[p]);
  const pool = world.clubs
    .filter((c) => c.id !== own.id && c.nation === own.nation && c.youthPlayers.length < 14 && c.reputation >= own.reputation * 0.45)
    .map((c) => ({ c, pull: c.reputation * rng.range(0.6, 1.4) }))
    .sort((a, b) => b.pull - a.pull)
    .slice(0, 3);
  return pool
    .map(({ c }) => ({
      clubId: c.id,
      fee: Math.max(2_000, Math.round((value * rng.range(0.55, 1.05) * (0.8 + c.reputation / 25_000)) / 1000) * 1000),
    }))
    .sort((a, b) => b.fee - a.fee);
}

/** A fee as the paper prints it: "€24k", "€1.2M". */
export function feeText(fee: number): string {
  return fee >= 1_000_000 ? `€${(fee / 1_000_000).toFixed(1)}M` : `€${Math.round(fee / 1000)}k`;
}

/**
 * Sell an academy player to a club that offered for him: to its academy, the
 * fee to the manager's club, a note in his inbox. Returns what happened, for
 * the manager — or why it couldn't.
 */
export function sellAcademyPlayer(world: World, p: number, buyerId: number): { ok: boolean; text: string } {
  const own = world.clubs[world.userClubId];
  const buyer = world.clubs[buyerId];
  const offer = academyOffers(world, p).find((o) => o.clubId === buyerId);
  if (own === undefined || buyer === undefined || offer === undefined) {
    return { ok: false, text: 'That offer is no longer on the table.' };
  }
  const store = world.players;
  own.youthPlayers = own.youthPlayers.filter((x) => x !== p);
  buyer.youthPlayers.push(p);
  store.clubId[p] = buyer.id;
  store.setFlag(p, PlayerFlag.Youth, true);
  store.setFlag(p, PlayerFlag.Transferable, false);
  store.contractUntil[p] = seasonEndDay(world.season + 2);
  payFee(world, buyer, own.id, offer.fee);
  logTransfer(world, p, own.id, buyer.id, offer.fee);
  newsTransfer(world, p, own.id, buyer.id, offer.fee);
  const text = `${store.fullName(p)} has left the academy for ${buyer.name}, for ${feeText(offer.fee)}.`;
  postMessage(world, { subject: `${store.fullName(p)} sold to ${buyer.name}`, body: text, clubId: buyer.id, category: 'offer' });
  return { ok: true, text };
}
