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

import { matchRating, playedInMatch } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import type { Position } from '../model/positions.ts';
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
): void {
  const store = world.players;
  for (const [p, s] of stats) {
    if (!playedInMatch(s)) continue;
    const rating = matchRating(s, store.position[p] as Position, setsFor, setsAgainst);

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

    let form = world.ratingForm.get(p);
    if (form === undefined) {
      form = [];
      world.ratingForm.set(p, form);
    }
    form.push(rating);
    if (form.length > FORM_LENGTH) form.shift();
  }
}

/** Rate everyone who played in a finished fixture and file it under its competition. */
export function recordFixture(
  world: World,
  fixture: Fixture,
  homeStats: Map<number, PlayerMatchStats>,
  awayStats: Map<number, PlayerMatchStats>,
): void {
  recordSide(world, fixture, homeStats, fixture.homeSets, fixture.awaySets);
  recordSide(world, fixture, awayStats, fixture.awaySets, fixture.homeSets);
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
