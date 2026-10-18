/**
 * The press's predictions: before every league starts, the papers tip how its
 * table will finish, and when it is over they own up to how wrong they were.
 *
 * The tips are the pundits' reading of the squads — the best seven of each
 * club, the setter and the libero counting for a little more — with a dose of
 * their own opinion, so the favourites are usually tipped right and a club or
 * two always surprises them. The manager hears where his own side is tipped;
 * his board hear it too, and when the season is done, beating the papers by
 * a distance pleases them — and falling well short of them does not.
 */

import { Rng } from '../core/rng.ts';
import { compareTableRows } from '../model/club.ts';
import { Position } from '../model/positions.ts';
import { postMessage } from './inbox.ts';
import { followed, postNews } from './news.ts';
import type { World } from './world.ts';

export interface Prediction {
  season: number;
  leagueId: number;
  /** When the papers printed it. */
  day: number;
  /** Club ids, the tipped champions first. */
  order: number[];
  /** Owned up to, once the season was over. */
  settled?: boolean;
  /** Worked out after the league had already begun — a career from before the papers printed tips —
   *  so the table has them; nobody read them in the summer, so the board judges nothing by them. */
  late?: boolean;
}

/** How long before a league's first match the tips come out, days. */
const AHEAD = 4;
/** The pundits' own opinion, in ability points either way. */
const OPINION_SD = 28;
/** Places above or below the tip that the board notice, and what it does to their confidence. */
const NOTICED = 3;
const BOARD_PLEASED = 5;
const BOARD_DISPLEASED = 4;

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/**
 * Whether the paper prints a league's tips: the manager's own league, and his country's top flight
 * if the paper follows it — a preview a summer, not one for every league in the world.
 */
function inThePaper(world: World, comp: { nation: number; tier: number; participants: readonly number[] }, mine: boolean): boolean {
  if (mine) return true;
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  return own !== undefined && comp.tier === 1 && comp.nation === own.nation && followed(world, world.clubs[comp.participants[0]]);
}

/** How strong a squad looks on paper: its best seven, the setter and the libero weighed a little more. */
export function paperStrength(world: World, players: readonly number[]): number {
  const store = world.players;
  const fit = [...players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 9);
  let total = 0;
  let weight = 0;
  for (const p of fit.slice(0, 7)) {
    const pos = store.position[p];
    const w = pos === Position.Setter ? 1.3 : pos === Position.Libero ? 1.1 : 1;
    total += store.currentAbility[p] * w;
    weight += w;
  }
  return weight > 0 ? total / weight : 0;
}

/** This season's tip for a league, if it has been made. */
export function predictionFor(world: World, leagueId: number, season = world.season): Prediction | undefined {
  return world.predictions?.find((p) => p.leagueId === leagueId && p.season === season);
}

/** Where a club was tipped to finish this season, from 1 — or 0 if nobody tipped it. */
export function tippedPlace(world: World, leagueId: number, clubId: number): number {
  const p = predictionFor(world, leagueId);
  return p === undefined ? 0 : p.order.indexOf(clubId) + 1;
}

/** The day a league's first match is played this season, or -1. */
function firstDay(world: World, fixtureIds: readonly number[]): number {
  let first = -1;
  for (const id of fixtureIds) {
    const f = world.fixtures[id];
    if (f !== undefined && !f.played && f.day >= world.day && (first < 0 || f.day < first)) first = f.day;
  }
  return first;
}

/**
 * A few days before each league begins, the tips: printed in the paper for the leagues it
 * follows, and for the manager's own league, put to him.
 */
export function predictionsDay(world: World): void {
  const list = (world.predictions ??= []);
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.participants.length < 4) continue;
    if (list.some((p) => p.leagueId === comp.id && p.season === world.season)) continue;
    const rng = new Rng(`tips:${world.season}:${comp.id}`);
    const tips = (): number[] => comp.participants
      .map((id) => ({ id, s: paperStrength(world, world.clubs[id]?.players ?? []) + rng.gaussian(0, OPINION_SD) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.id);
    // A league already under way with no tips — a career from before the papers printed them:
    // worked out quietly now, from the squads as they stand, so the table has them.
    if (comp.table.some((r) => r.played > 0)) {
      list.push({ season: world.season, leagueId: comp.id, day: world.day, order: tips(), late: true });
      continue;
    }
    // Only once the season's fixtures are out, and only in the days before the first.
    const first = firstDay(world, comp.fixtureIds);
    if (first < 0 || world.day < first - AHEAD) continue;
    const order = tips();
    list.push({ season: world.season, leagueId: comp.id, day: world.day, order });
    const name = (id: number): string => world.clubs[id]?.name ?? '?';
    const mine = own !== undefined && own.leagueId === comp.id;
    if (inThePaper(world, comp, mine)) {
      postNews(world, {
        kind: 'press',
        headline: `The papers tip ${name(order[0])} for the ${comp.name}`,
        body: `Ahead of the new ${comp.name} season the press have ${name(order[0])} as favourites, ` +
          `with ${name(order[1])} and ${name(order[2])} close behind. ` +
          `At the other end, ${name(order[order.length - 1])} are tipped to struggle.`,
        nation: comp.nation ?? world.clubs[order[0]]?.nation ?? 0,
        clubId: order[0],
        otherClubId: order[1],
        competitionId: comp.id,
        fans: { story: 'tips', club: order[0], other: order[1], comp: comp.name },
      });
    }
    if (mine) {
      const at = order.indexOf(own.id) + 1;
      postMessage(world, {
        category: 'board',
        from: 'Press office',
        subject: `The press tip ${own.name} to finish ${ordinal(at)}`,
        body: `The season previews are out: the papers have ${own.name} ${ordinal(at)} of ${order.length} in the ${comp.name}, ` +
          `${at === 1 ? 'the favourites for the title' : `behind ${name(order[0])}`}. ` +
          'The board read them too — finish well above where you are tipped and they will notice; well below, and they will notice that as well.',
      });
    }
  }
  // Two seasons of tips are plenty.
  if (list.length > 0) world.predictions = list.filter((p) => p.season >= world.season - 1);
}

/**
 * The season over: the papers look back at their tips for the manager's league, and his board
 * weigh his finish against them.
 */
export function predictionVerdicts(world: World): void {
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  for (const p of world.predictions ?? []) {
    if (p.season !== world.season || p.settled === true) continue;
    p.settled = true;
    const comp = world.competitions[p.leagueId];
    if (comp === undefined) continue;
    const table = [...comp.table].sort(compareTableRows).map((r) => r.clubId);
    if (table.length === 0) continue;
    const name = (id: number): string => world.clubs[id]?.name ?? '?';
    // The biggest surprise of the season, either way.
    let surprise = table[0];
    let most = 0;
    for (const id of table) {
      const d = Math.abs(p.order.indexOf(id) - table.indexOf(id));
      if (d > most) { most = d; surprise = id; }
    }
    const mine = own !== undefined && own.leagueId === p.leagueId;
    // Tips nobody printed in the summer: nothing to own up to, nothing for the board to weigh.
    if (p.late === true) continue;
    if (inThePaper(world, comp, mine)) {
      const right = p.order[0] === table[0];
      postNews(world, {
        kind: 'press',
        headline: right ? `The papers called it: ${name(table[0])} top the ${comp.name}` : `${name(table[0])} prove the papers wrong`,
        body: `${name(table[0])} finished the ${comp.name} on top${right ? ', as tipped before a ball was served' : `, tipped ${ordinal(p.order.indexOf(table[0]) + 1)} in the previews`}. ` +
          (most >= 3 ? `The season's biggest surprise: ${name(surprise)}, tipped ${ordinal(p.order.indexOf(surprise) + 1)}, finished ${ordinal(table.indexOf(surprise) + 1)}.` : ''),
        nation: comp.nation ?? world.clubs[table[0]]?.nation ?? 0,
        clubId: table[0],
        competitionId: comp.id,
        fans: { story: 'tips', club: table[0], comp: comp.name },
      });
    }
    if (!mine || own === undefined) continue;
    const tipped = p.order.indexOf(own.id) + 1;
    const finished = table.indexOf(own.id) + 1;
    if (tipped <= 0 || finished <= 0) continue;
    const beat = tipped - finished;
    let verdict: string;
    if (beat >= NOTICED) {
      own.boardConfidence = Math.min(100, own.boardConfidence + BOARD_PLEASED);
      verdict = 'The board are delighted: you made the previews look foolish.';
    } else if (beat <= -NOTICED) {
      own.boardConfidence = Math.max(0, own.boardConfidence - BOARD_DISPLEASED);
      verdict = 'The board had hoped for better: even the papers expected more.';
    } else {
      verdict = beat > 0 ? 'A little better than they expected.' : beat < 0 ? 'A little short of what they expected.' : 'Just where they had you.';
    }
    postMessage(world, {
      category: 'board',
      from: 'Press office',
      subject: `${ordinal(finished)}, tipped ${ordinal(tipped)}`,
      body: `${own.name} finished ${ordinal(finished)} in the ${comp.name}; the press had tipped ${ordinal(tipped)}. ${verdict}`,
    });
  }
}
