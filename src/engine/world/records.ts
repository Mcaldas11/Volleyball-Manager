/**
 * Per-competition player records: appearances and match ratings.
 *
 * Every rated match — full engine or quick-sim, the user's or anyone else's —
 * folds into one line per player, per competition, per season, so a profile
 * can show how a player has actually performed in the league and in a cup
 * separately. Only the current and the previous season are kept: a fifty-
 * season career across a large world would otherwise grow without bound, and
 * the permanent career totals already live on the player store.
 *
 * A short rolling "form" of each player's last few ratings is kept alongside,
 * across all competitions.
 */

import { matchRating, playedInMatch, type RatingPath } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import type { Position } from '../model/positions.ts';
import { courtShare, recordLoanMatch } from './loans.ts';
import type { Fixture, World } from './world.ts';

/** One player's line in one competition in one season. */
export interface CompetitionRecord {
  season: number;
  competitionId: number;
  apps: number;
  /** Sum of match ratings; divide by `apps` for the average. */
  ratingSum: number;
  /** Highest single-match rating. */
  best: number;
  points: number;
  aces: number;
  blocks: number;
  /** Player-of-the-match awards. */
  mvps: number;
  /** The rest of the box score, for the competition's awards — absent on
   *  lines written before they were kept. */
  kills?: number;
  attacks?: number;
  attackErrors?: number;
  serves?: number;
  digs?: number;
  receptions?: number;
  /** Perfect and positive passes. */
  goodPasses?: number;
  assists?: number;
}

/** How many past ratings the form guide remembers. */
export const FORM_LENGTH = 5;

export function averageRating(r: Pick<CompetitionRecord, 'apps' | 'ratingSum'>): number {
  return r.apps > 0 ? r.ratingSum / r.apps : 0;
}

function recordSide(
  world: World,
  fixture: Fixture,
  stats: Map<number, PlayerMatchStats>,
  setsFor: number,
  setsAgainst: number,
  path: RatingPath,
): void {
  const store = world.players;
  for (const [p, s] of stats) {
    if (!playedInMatch(s)) continue;
    const rating = matchRating(s, store.position[p] as Position, setsFor, setsAgainst, path);

    let lines = world.competitionRecords.get(p);
    if (lines === undefined) {
      lines = [];
      world.competitionRecords.set(p, lines);
    }
    let line = lines.find((l) => l.season === world.season && l.competitionId === fixture.competitionId);
    if (line === undefined) {
      line = {
        season: world.season,
        competitionId: fixture.competitionId,
        apps: 0, ratingSum: 0, best: 0, points: 0, aces: 0, blocks: 0, mvps: 0,
      };
      lines.push(line);
    }
    line.apps++;
    line.ratingSum += rating;
    line.best = Math.max(line.best, rating);
    line.points += s.attackKills + s.serveAces + s.blockPoints;
    line.aces += s.serveAces;
    line.blocks += s.blockPoints;
    if (fixture.mvp === p) line.mvps++;
    line.kills = (line.kills ?? 0) + s.attackKills;
    line.attacks = (line.attacks ?? 0) + s.attacksTotal;
    line.attackErrors = (line.attackErrors ?? 0) + s.attackErrors + s.attackBlocked;
    line.serves = (line.serves ?? 0) + s.servesTotal;
    line.digs = (line.digs ?? 0) + s.digsTotal;
    line.receptions = (line.receptions ?? 0) + s.receptionsTotal;
    line.goodPasses = (line.goodPasses ?? 0) + s.receptionPerfect + s.receptionPositive;
    line.assists = (line.assists ?? 0) + s.setAssists;

    let form = world.ratingForm.get(p);
    if (form === undefined) {
      form = [];
      world.ratingForm.set(p, form);
    }
    form.push(rating);
    if (form.length > FORM_LENGTH) form.shift();
  }
}

/** Rate everyone who played in a finished fixture and file it under its
 *  competition — along with how much each squad player got on court, and what
 *  any loanee at either club did. */
export function recordFixture(
  world: World,
  fixture: Fixture,
  homeStats: Map<number, PlayerMatchStats>,
  awayStats: Map<number, PlayerMatchStats>,
  /** The engine it was played through — each rates on its own yardstick. */
  path: RatingPath = 'full',
): void {
  recordSide(world, fixture, homeStats, fixture.homeSets, fixture.awaySets, path);
  recordSide(world, fixture, awayStats, fixture.awaySets, fixture.homeSets, path);
  // National teams' squads are not clubs.
  if (world.competitions[fixture.competitionId]?.kind === 'international') return;
  recordPlayingTime(world, fixture, fixture.home, homeStats);
  recordPlayingTime(world, fixture, fixture.away, awayStats);
  recordLoanMatch(world, fixture, homeStats, awayStats, path);
}

/** Weight of the latest match in a player's rolling playing time. */
const PLAYING_TIME_WEIGHT = 0.2;

/**
 * Move every squad player's rolling playing time towards his share of this
 * match: all of it for a starter who saw it out, a little for a substitute,
 * none for the bench. It is what decides how much a young player gets out of
 * his training.
 */
function recordPlayingTime(world: World, fixture: Fixture, clubId: number, stats: Map<number, PlayerMatchStats>): void {
  const club = world.clubs[clubId];
  if (club === undefined) return;
  const store = world.players;
  const rallies = Math.max(1, fixture.setScores.reduce((sum, [h, a]) => sum + h + a, 0));
  for (const p of club.players) {
    const s = stats.get(p);
    const share = s !== undefined && playedInMatch(s)
      ? Math.min(1, s.ralliesPlayed / (rallies * courtShare(store.position[p])))
      : 0;
    store.playingTime[p] = Math.round(store.playingTime[p] * (1 - PLAYING_TIME_WEIGHT) + share * 100 * PLAYING_TIME_WEIGHT);
  }
}

/** A player's lines for one season, league first then cups, in competition order. */
export function seasonRecords(world: World, playerIdx: number, season: number): CompetitionRecord[] {
  return (world.competitionRecords.get(playerIdx) ?? [])
    .filter((r) => r.season === season)
    .sort((a, b) => a.competitionId - b.competitionId);
}

/** All of a player's matches this season, across every competition. */
export function seasonTotals(world: World, playerIdx: number, season = world.season): {
  apps: number;
  ratingSum: number;
  mvps: number;
} {
  let apps = 0;
  let ratingSum = 0;
  let mvps = 0;
  for (const r of world.competitionRecords.get(playerIdx) ?? []) {
    if (r.season !== season) continue;
    apps += r.apps;
    ratingSum += r.ratingSum;
    mvps += r.mvps;
  }
  return { apps, ratingSum, mvps };
}

/** Drop lines older than last season — called as each new season begins. */
export function pruneCompetitionRecords(world: World): void {
  const keepFrom = world.season - 1;
  for (const [p, lines] of world.competitionRecords) {
    const kept = lines.filter((l) => l.season >= keepFrom);
    if (kept.length === 0) world.competitionRecords.delete(p);
    else if (kept.length !== lines.length) world.competitionRecords.set(p, kept);
  }
  // Form is about the here and now; nobody carries it over a summer.
  world.ratingForm.clear();
}
