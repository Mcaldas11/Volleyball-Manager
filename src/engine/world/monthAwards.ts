/**
 * The manager's league's monthly honours, in his inbox: the Player of the
 * Month, and the Point and the Play of the Month — each with its shortlist,
 * and every point and play on it there to be watched again.
 *
 * Every league match the manager's league plays runs on the full rally
 * engine, which keeps each match's best point and best play (highlights.ts);
 * the month's best of them wait here until the 1st, when the awards go out.
 */

import type { MatchResult } from '../match/engine.ts';
import { keepBest, sameRally, type Highlight } from '../match/highlights.ts';
import { postMessage } from './inbox.ts';
import { keepCompetitionHighlight } from './competitionReview.ts';
import type { Fixture, World } from './world.ts';

/** How many of a month's candidates are kept, and how many make a shortlist. */
const POOL = 8;
const SHORTLIST = 3;

/** One player's month on a Player of the Month shortlist. */
export interface MonthPlayerLine {
  p: number;
  clubId: number;
  apps: number;
  avg: number;
  points: number;
}

/** A monthly honour as the inbox shows it. */
export interface MonthAward {
  kind: 'point' | 'play' | 'player';
  competitionId: number;
  /** "October". */
  month: string;
  /** A point or play: the winner first, then the rest of the shortlist. */
  highlights?: Highlight[];
  /** The Player of the Month: the winner first, then the runners-up. */
  players?: MonthPlayerLine[];
}

/** The league the manager's club plays in, if he has one. */
export function managersLeague(world: World): number {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  return club?.leagueId ?? -1;
}

/** Whether a fixture is a match in the manager's league — the ones whose best moments are kept. */
export function inManagersLeague(world: World, fixture: Fixture): boolean {
  const league = managersLeague(world);
  return league >= 0 && fixture.competitionId === league;
}

/** A match in the manager's league just played: its best point and play go in the month's running. */
export function collectHighlights(world: World, fixture: Fixture, result: MatchResult): void {
  if (result.highlights === undefined || result.highlights.length === 0) return;
  // Every competition keeps its best for its review; the month's running is the league's.
  for (const h of result.highlights) {
    keepCompetitionHighlight(world, {
      ...h, fixtureId: fixture.id, competitionId: fixture.competitionId, day: fixture.day, home: fixture.home, away: fixture.away,
    });
  }
  if (!inManagersLeague(world, fixture)) return;
  if (world.highlights === undefined || world.highlights.season !== world.season) {
    world.highlights = { season: world.season, point: [], play: [] };
  }
  for (const h of result.highlights) {
    const tagged: Highlight = {
      ...h, fixtureId: fixture.id, competitionId: fixture.competitionId, day: fixture.day,
      home: fixture.home, away: fixture.away,
    };
    keepBest(h.kind === 'point' ? world.highlights.point : world.highlights.play, tagged, POOL);
  }
}

/** Ordinal set names, for the write-ups. */
const SET_NAMES = ['first', 'second', 'third', 'fourth', 'fifth'];

/** "the fourth set" — or "the tie-break". */
function setName(h: Highlight): string {
  return h.setTarget === 15 ? 'the tie-break' : `the ${SET_NAMES[h.set] ?? `${h.set + 1}th`} set`;
}

/** What a highlight was, in a line: "a 121 km/h spike to make it 24-22 in the third set against Ankara". */
export function describeHighlight(world: World, h: Highlight): string {
  const theirClub = h.starTeam === 0 ? h.away : h.home;
  const them = theirClub !== undefined ? world.clubs[theirClub]?.name ?? 'their opponents' : 'their opponents';
  const after: [number, number] = [h.scoreBefore[0] + (h.winner === 0 ? 1 : 0), h.scoreBefore[1] + (h.winner === 1 ? 1 : 0)];
  const own = h.starTeam === 0 ? after[0] : after[1];
  const other = h.starTeam === 0 ? after[1] : after[0];
  const won = own >= h.setTarget && own - other >= 2;
  const stake = won ? `to win ${setName(h)}` : `to make it ${own}–${other} in ${setName(h)}`;
  const speed = h.speed !== undefined ? `${h.speed} km/h ` : '';
  const jump = h.contacts.find((c) => c.kind === 'serve')?.detail === 'jump';
  const shot = h.contacts[h.contacts.length - 1]?.shot;
  const spike = shot === 'blockout' ? `a ${speed}block-out` : shot === 'cut' ? 'a cut shot across the 3 m line'
    : shot === 'tip' ? 'a tip over the block' : shot === 'roll' ? 'a roll shot into the open court'
      : shot === 'line' ? `a ${speed}line shot` : `a ${speed}spike`;
  const what = h.what === 'spike' ? spike
    : h.what === 'block' ? 'a stuff block'
      : h.what === 'ace' ? `${jump ? `a ${speed}jump serve` : 'a float serve'} for an ace`
        : `the ${h.contacts[h.contacts.length - 1]?.kind === 'blocked' ? 'block' : 'kill'} that ended a ${h.attacks}-attack rally`;
  return `${what} ${stake} against ${them}`;
}

/** Who a highlight belongs to: "S. Kowalski (Ankara)". */
function creditOf(world: World, h: Highlight): string {
  const club = (h.starTeam === 0 ? h.home : h.away) ?? -1;
  return `${world.players.fullName(h.star)}${world.clubs[club] !== undefined ? ` of ${world.clubs[club].name}` : ''}`;
}

/**
 * On the 1st: the month just gone's Point and Play of the Month in the
 * manager's league, each to his inbox with its shortlist — and the running
 * starts again.
 */
export function highlightAwards(world: World, competitionId: number, month: string): void {
  const pool = world.highlights;
  world.highlights = { season: world.season, point: [], play: [] };
  if (pool === undefined || pool.season !== world.season) return;
  const comp = world.competitions[competitionId];
  if (comp === undefined) return;
  const mine = world.userClubId;

  const points = pool.point.slice(0, SHORTLIST);
  // A rally that won the Point of the Month isn't up for the Play as well.
  const plays = pool.play.filter((h) => points[0] === undefined || !sameRally(h, points[0])).slice(0, SHORTLIST);

  const post = (kind: 'point' | 'play', list: Highlight[]): void => {
    const top = list[0];
    if (top === undefined) return;
    const label = kind === 'point' ? 'Point of the Month' : 'Play of the Month';
    const ours = (top.starTeam === 0 ? top.home : top.away) === mine;
    postMessage(world, {
      category: 'awards',
      from: comp.name,
      clubId: (top.starTeam === 0 ? top.home : top.away),
      subject: `${label}: ${world.players.shortName(top.star)}${ours ? ' — one of yours' : ''}`,
      body: `The ${comp.name} ${label} for ${month} goes to ${creditOf(world, top)}, for ${describeHighlight(world, top)}.` +
        (list.length > 1 ? ' Here is the shortlist — every one of them there to watch again.' : ' Watch it again below.'),
      playerIdx: top.star,
      award: { kind, competitionId, month, highlights: list },
    });
  };
  post('point', points);
  post('play', plays);
}

/** The Player of the Month in the manager's league, to his inbox with the runners-up. */
export function playerOfMonthMessage(world: World, competitionId: number, month: string, lines: MonthPlayerLine[]): void {
  const comp = world.competitions[competitionId];
  const top = lines[0];
  if (comp === undefined || top === undefined) return;
  const ours = top.clubId === world.userClubId;
  const club = world.clubs[top.clubId];
  postMessage(world, {
    category: 'awards',
    from: comp.name,
    clubId: top.clubId,
    subject: `Player of the Month: ${world.players.shortName(top.p)}${ours ? ' — one of yours' : ''}`,
    body: `${world.players.fullName(top.p)}${club !== undefined ? ` of ${club.name}` : ''} is the ${comp.name} Player of the ` +
      `Month for ${month}: ${top.points} points in ${top.apps} matches at an average rating of ${top.avg.toFixed(2)}.` +
      (ours ? ' A fine month — and the dressing room knows it.' : ''),
    playerIdx: top.p,
    award: { kind: 'player', competitionId, month, players: lines },
  });
}
