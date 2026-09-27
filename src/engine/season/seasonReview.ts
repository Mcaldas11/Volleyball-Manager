/**
 * The season review: the user's club's whole season on one page — where it
 * finished in every competition, who stood out, the transfer business and the
 * books — posted to the inbox at the rollover.
 *
 * It is gathered in two steps because the rollover destroys what it reads.
 * The standings, results, awards and books are taken before clubs move
 * division and the finances are settled; the review is finished — promotion
 * or relegation, who left, the closing balance — once they have been.
 */

import { compareTableRows, type Club } from '../model/club.ts';
import {
  DAYS_PER_SEASON, type Fixture, type SeasonReview, type SeasonReviewAward, type SeasonReviewMove,
  type SeasonReviewStanding, type World,
} from '../world/world.ts';
import { clubBooks } from './books.ts';
import { finalStandingsOrder } from './playoffs.ts';
import type { SeasonContext } from './seasonEngine.ts';

/** Fewest appearances, as a share of the club's matches, for a form award to count. */
const MIN_SHARE_OF_MATCHES = 0.35;

/** Oldest a player can be for the breakthrough award. */
const YOUNG_PLAYER_AGE = 21;

/** Read everything the rollover is about to reset. Null when the user has no club. */
export function beginSeasonReview(world: World, ctx: SeasonContext): SeasonReview | null {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return null;

  const books = clubBooks(world, club);
  const fixtures = seasonFixtures(world, club.id);
  const signings: SeasonReviewMove[] = world.transferLog
    .filter((t) => t.season === world.season && t.toClub === club.id)
    .map((t) => ({ playerIdx: t.playerIdx, clubId: t.fromClub, fee: t.fee }));

  return {
    season: world.season,
    clubId: club.id,
    standings: standings(world, club),
    movement: null,
    ...matchRecord(fixtures, club.id),
    awards: clubAwards(world, ctx, club, fixtures.length, signings),
    signings,
    departures: [],
    // Streams that came to nothing (no prize money, no youth wages) are left out.
    income: books.income.filter(([, v]) => v !== 0),
    costs: books.costs.filter(([, v]) => v !== 0),
    transferSpend: signings.reduce((s, m) => s + m.fee, 0),
    transferIncome: 0,
    closingBalance: club.finances.balance,
  };
}

/** Complete the review once divisions and books are settled, and post it to the inbox. */
export function postSeasonReview(world: World, review: SeasonReview): void {
  const club = world.clubs[review.clubId];
  if (club === undefined) return;
  const store = world.players;

  const league = review.standings.find((s) => world.competitions[s.competitionId]?.kind === 'league');
  if (league !== undefined) {
    const tier = world.competitions[league.competitionId].tier;
    review.movement = club.tier < tier ? 'promoted' : club.tier > tier ? 'relegated' : null;
  }

  // Departures include the summer's expired contracts, filed under the season
  // just ended; anyone released who has already found a club shows where.
  review.departures = world.transferLog
    .filter((t) => t.season === review.season && t.fromClub === club.id)
    .map((t) => ({
      playerIdx: t.playerIdx,
      clubId: t.toClub >= 0 ? t.toClub : store.clubId[t.playerIdx] !== club.id ? store.clubId[t.playerIdx] : -1,
      fee: t.fee,
    }));
  review.transferIncome = review.departures.reduce((s, m) => s + m.fee, 0);
  review.closingBalance = club.finances.balance;

  const y = world.startYear + review.season;
  world.messages.push({
    id: world.messages.length,
    day: world.day,
    year: world.year,
    subject: `${y}/${String((y + 1) % 100).padStart(2, '0')} season review`,
    body: headline(world, review, club),
    seasonReview: review,
    from: 'Board of Directors',
    clubId: club.id,
    category: 'news',
  });
}

// ---- Standings and results ----------------------------------------------------

function standings(world: World, club: Club): SeasonReviewStanding[] {
  const out: SeasonReviewStanding[] = [];
  for (const comp of world.competitions) {
    if (comp.kind === 'international') continue;
    const row = comp.table.find((r) => r.clubId === club.id);
    if (row === undefined || row.played === 0) continue;

    const table = [...comp.table].sort(compareTableRows).map((r) => r.clubId);
    const order = finalStandingsOrder(comp);
    // A title decided by playoffs only counts once the final has been played.
    const championship = comp.playoffGroups.find((g) => g.id === 'championship');
    const settled = championship === undefined || championship.resolved;
    out.push({
      competitionId: comp.id,
      position: order.indexOf(club.id) + 1,
      tablePosition: table.indexOf(club.id) + 1,
      teams: comp.table.length,
      won: row.won,
      lost: row.lost,
      points: row.points,
      setsFor: row.setsFor,
      setsAgainst: row.setsAgainst,
      champion: settled && order[0] === club.id,
    });
  }
  // The league first, then continental competition.
  const rank = (s: SeasonReviewStanding): number => (world.competitions[s.competitionId].kind === 'league' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The club's played matches this season, in date order — every club competition. */
function seasonFixtures(world: World, clubId: number): Fixture[] {
  const start = world.season * DAYS_PER_SEASON;
  return world.fixtures
    .filter((f) =>
      f.played && f.day >= start && f.day < start + DAYS_PER_SEASON &&
      (f.home === clubId || f.away === clubId) &&
      world.competitions[f.competitionId]?.kind !== 'international')
    .sort((a, b) => a.day - b.day);
}

type MatchRecord = Pick<
  SeasonReview,
  'won' | 'lost' | 'homeWon' | 'homeLost' | 'awayWon' | 'awayLost' | 'longestWinStreak' | 'biggestWin'
>;

function matchRecord(fixtures: readonly Fixture[], clubId: number): MatchRecord {
  const r: MatchRecord = {
    won: 0, lost: 0, homeWon: 0, homeLost: 0, awayWon: 0, awayLost: 0, longestWinStreak: 0, biggestWin: null,
  };
  let streak = 0;
  let bestMargin = -Infinity;
  for (const f of fixtures) {
    const home = f.home === clubId;
    const setsFor = home ? f.homeSets : f.awaySets;
    const setsAgainst = home ? f.awaySets : f.homeSets;
    const won = setsFor > setsAgainst;
    if (won) {
      r.won++;
      if (home) r.homeWon++; else r.awayWon++;
      streak++;
      r.longestWinStreak = Math.max(r.longestWinStreak, streak);

      // Most one-sided: the widest sets margin, then the widest points margin.
      const setScores = f.setScores.map(([h, a]): [number, number] => (home ? [h, a] : [a, h]));
      const pointsMargin = setScores.reduce((s, [a, b]) => s + a - b, 0);
      const margin = (setsFor - setsAgainst) * 1000 + pointsMargin;
      if (margin > bestMargin) {
        bestMargin = margin;
        r.biggestWin = { fixtureId: f.id, opponent: home ? f.away : f.home, setsFor, setsAgainst, setScores };
      }
    } else {
      r.lost++;
      if (home) r.homeLost++; else r.awayLost++;
      streak = 0;
    }
  }
  return r;
}

// ---- The club's own awards ------------------------------------------------------

interface SeasonLine {
  p: number;
  apps: number;
  rating: number;
  points: number;
  mvps: number;
}

/** A player's whole season across every competition. */
function seasonLine(world: World, p: number): SeasonLine {
  let apps = 0;
  let ratingSum = 0;
  let points = 0;
  let mvps = 0;
  for (const r of world.competitionRecords.get(p) ?? []) {
    if (r.season !== world.season) continue;
    apps += r.apps;
    ratingSum += r.ratingSum;
    points += r.points;
    mvps += r.mvps;
  }
  return { p, apps, rating: apps > 0 ? ratingSum / apps : 0, points, mvps };
}

function clubAwards(
  world: World,
  ctx: SeasonContext,
  club: Club,
  matches: number,
  signings: readonly SeasonReviewMove[],
): SeasonReviewAward[] {
  const store = world.players;
  const lines = [...club.players, ...club.youthPlayers]
    .map((p) => seasonLine(world, p))
    .filter((l) => l.apps > 0);
  const minApps = Math.max(3, Math.round(matches * MIN_SHARE_OF_MATCHES));
  const regulars = lines.filter((l) => l.apps >= minApps);
  const featured = lines.filter((l) => l.apps >= Math.max(2, Math.round(minApps / 2)));
  const byRating = (a: SeasonLine, b: SeasonLine): number => b.rating - a.rating;

  const award = (kind: SeasonReviewAward['kind'], l: SeasonLine, fee = 0, gain = 0): SeasonReviewAward => ({
    kind, playerIdx: l.p, rating: l.rating, apps: l.apps, points: l.points, mvps: l.mvps, fee, gain,
  });
  const awards: SeasonReviewAward[] = [];

  const best = [...regulars].sort(byRating)[0];
  if (best !== undefined) awards.push(award('player', best));

  const scorer = [...lines].sort((a, b) => b.points - a.points || b.rating - a.rating)[0];
  if (scorer !== undefined && scorer.points > 0) awards.push(award('scorer', scorer));

  // The best signing is judged on form, among those who stayed and played.
  const fees = new Map(signings.map((s) => [s.playerIdx, s.fee]));
  const signing = featured.filter((l) => fees.has(l.p) && store.clubId[l.p] === club.id).sort(byRating)[0];
  if (signing !== undefined) awards.push(award('signing', signing, fees.get(signing.p) ?? 0));

  const young = featured
    .filter((l) => store.ageOn(l.p, world.year, 181) <= YOUNG_PLAYER_AGE)
    .sort(byRating)[0];
  if (young !== undefined) awards.push(award('young', young));

  let improved: { line: SeasonLine; gain: number } | null = null;
  for (const l of lines) {
    const start = ctx.seasonStartAbility.get(l.p);
    if (start === undefined) continue;
    const gain = store.currentAbility[l.p] - start;
    if (gain > 0 && (improved === null || gain > improved.gain)) improved = { line: l, gain };
  }
  if (improved !== null) awards.push(award('improved', improved.line, 0, improved.gain));

  return awards;
}

// ---- The headline -----------------------------------------------------------------

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Two or three sentences for the inbox list and the top of the review. */
function headline(world: World, review: SeasonReview, club: Club): string {
  const parts: string[] = [];
  const league = review.standings.find((s) => world.competitions[s.competitionId]?.kind === 'league');
  if (league !== undefined) {
    const name = world.competitions[league.competitionId].name;
    parts.push(league.champion
      ? `Champions! ${club.name} won the ${name}.`
      : `${club.name} finished ${ordinal(league.position)} of ${league.teams} in the ${name}.`);
  }
  if (review.movement === 'promoted') parts.push('Promotion secured — next season is a division higher.');
  if (review.movement === 'relegated') parts.push('Relegated — next season starts a division lower.');
  for (const s of review.standings) {
    if (s === league || !s.champion) continue;
    parts.push(`Winners of the ${world.competitions[s.competitionId].name} too.`);
  }
  parts.push(`${review.won} win${review.won === 1 ? '' : 's'} and ${review.lost} defeat${review.lost === 1 ? '' : 's'} in all competitions.`);
  const best = review.awards.find((a) => a.kind === 'player');
  if (best !== undefined) {
    parts.push(`${world.players.fullName(best.playerIdx)} was the player of the season, averaging ${best.rating.toFixed(2)}.`);
  }
  return parts.join(' ');
}
