/**
 * The under-21 leagues of a real-data world (worldGen.ts): beside a nation's
 * real top flight, its clubs' under-21 sides play the U21 first division, and
 * the under-21 sides of the clubs below play a second division.
 *
 * Up and down each spring, once both regular seasons are over:
 * - The second division's champions go up, and the first division's last go down.
 * - The first division's second-from-bottom and the second division's
 *   runners-up play a promotion playoff, a best of three, the first-division
 *   side at home in games one and three. The winners play in the first
 *   division next season, the losers in the second.
 * The playoff is a bracket on the first division (playoffs.ts), so it is drawn
 * and shown as every other playoff is. The moves are made as the season
 * closes (rollover.ts), before the new fixtures are drawn.
 */

import { compareTableRows } from '../model/club.ts';
import { advancePlayoffGroup, openPlayoffGroup } from '../season/playoffs.ts';
import { calendarOf } from './calendar.ts';
import { postMessage } from './inbox.ts';
import { postNews } from './news.ts';
import { under21SideOf } from './under21.ts';
import { dayOfSeason, type Competition, type PlayoffGroup, type World } from './world.ts';

/** The tiers the under-21 divisions sit at: off the bottom of every pyramid, which leaves them out of it. */
export const UNDER21_TIER = 99;
export const UNDER21_DIV2_TIER = 100;
/** The fewest sides a division needs for the promotion playoff; smaller, only the automatic places move. */
const PLAYOFF_MIN = 4;
export const UNDER21_PLAYOFF_LABEL = 'U21 Promotion Playoff';

/** A nation's under-21 divisions: the first, and the second if it has one. */
export interface Under21Divisions {
  nation: number;
  first: Competition;
  second?: Competition;
}

/** Every nation's under-21 divisions. */
export function under21Divisions(world: World): Under21Divisions[] {
  const out = new Map<number, Under21Divisions>();
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.under21 !== true || comp.tier !== UNDER21_TIER) continue;
    out.set(comp.nation, { nation: comp.nation, first: comp });
  }
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.under21 !== true || comp.tier !== UNDER21_DIV2_TIER) continue;
    const d = out.get(comp.nation);
    if (d !== undefined) d.second = comp;
  }
  return [...out.values()];
}

/** Which under-21 division a league is: 1, 2 — or 0 if it isn't one. */
export function under21Division(comp: Competition): 0 | 1 | 2 {
  if (comp.under21 !== true) return 0;
  return comp.tier === UNDER21_DIV2_TIER ? 2 : 1;
}

/** A division's table, best first. */
function standings(comp: Competition): number[] {
  return [...comp.table].sort(compareTableRows).map((r) => r.clubId);
}

/** The promotion playoff between a nation's divisions, once drawn. */
export function promotionPlayoff(d: Under21Divisions): PlayoffGroup | undefined {
  return d.first.playoffGroups.find((g) => g.id === 'promotion');
}

/** The playoff brackets a league's page shows: its own, and for a second division the playoff its runners-up play in. */
export function playoffGroupsShown(world: World, comp: Competition): PlayoffGroup[] {
  if (under21Division(comp) !== 2) return comp.playoffGroups;
  const d = under21Divisions(world).find((x) => x.second === comp);
  const po = d !== undefined ? promotionPlayoff(d) : undefined;
  return po !== undefined ? [...comp.playoffGroups, po] : comp.playoffGroups;
}

/** How a division's table is shaded: automatic places up or down, and the playoff place. */
export function under21Zones(comp: Competition): { up: number; playoffUp: number; playoffDown: number; down: number } {
  const n = comp.table.length;
  const div = under21Division(comp);
  const playoff = n >= PLAYOFF_MIN;
  if (div === 1) return { up: 0, playoffUp: 0, playoffDown: playoff ? 1 : 0, down: 1 };
  if (div === 2) return { up: 1, playoffUp: playoff ? 1 : 0, playoffDown: 0, down: 0 };
  return { up: 0, playoffUp: 0, playoffDown: 0, down: 0 };
}

/** The manager's own under-21 side among some: the side he coaches, or his club's. */
function mineAmong(world: World, clubs: readonly number[]): number {
  if (world.userClubId < 0) return -1;
  const club = world.clubs[world.userClubId];
  if (club === undefined) return -1;
  if (club.under21Of !== undefined && clubs.includes(club.id)) return club.id;
  const side = under21SideOf(world, club);
  return side !== undefined && clubs.includes(side.id) ? side.id : -1;
}

function clubName(world: World, id: number): string {
  return world.clubs[id]?.name ?? '?';
}

/**
 * The day's business: when the regular seasons are over (the day the senior playoffs start), the
 * promotion playoff drawn; after that, its games played out a few days apart.
 */
export function under21LeaguesDay(world: World): void {
  const today = dayOfSeason(world);
  const start = calendarOf(world).playoffStart;
  for (const d of under21Divisions(world)) {
    const second = d.second;
    if (second === undefined) continue;
    let po = promotionPlayoff(d);
    if (po === undefined && today === start && d.first.table.length >= PLAYOFF_MIN && second.table.length >= PLAYOFF_MIN) {
      const top = standings(d.first);
      const below = standings(second);
      const holder = top[top.length - 2];
      const challenger = below[1];
      if (holder === undefined || challenger === undefined) continue;
      po = openPlayoffGroup(world, d.first, 'promotion', UNDER21_PLAYOFF_LABEL, [holder, challenger]);
      playoffNotice(world, d, holder, challenger);
      continue;
    }
    if (po !== undefined && !po.resolved) advancePlayoffGroup(world, d.first, po);
  }
}

function playoffNotice(world: World, d: Under21Divisions, holder: number, challenger: number): void {
  const mine = mineAmong(world, [holder, challenger]);
  if (mine < 0) return;
  const other = mine === holder ? challenger : holder;
  postMessage(world, {
    subject: `${clubName(world, mine)}: into the ${UNDER21_PLAYOFF_LABEL.toLowerCase().replace('u21', 'U21')}`,
    body: mine === holder
      ? `${clubName(world, mine)} finished second from bottom of ${d.first.name} and play ${clubName(world, other)}, the runners-up of ${d.second!.name}, for a place in the first division. ` +
        'It is a best of three, with games one and three at home. Lose it and the side goes down.'
      : `${clubName(world, mine)} finished second in ${d.second!.name} and play ${clubName(world, other)} for a place in ${d.first.name}. ` +
        'It is a best of three, with games one and three away. Win it and the side goes up.',
    from: d.first.name,
    category: 'matchday',
    clubId: mine,
  });
}

/**
 * The season closing: the second division's champions and the playoff's winners up, the first
 * division's last and the playoff's losers down. Played-out seasons only. Returns the moves made.
 */
export function under21PromotionRelegation(world: World): Array<{ clubId: number; up: boolean }> {
  const moves: Array<{ clubId: number; up: boolean }> = [];
  for (const d of under21Divisions(world)) {
    const second = d.second;
    if (second === undefined || !d.first.table.some((r) => r.played > 0) || !second.table.some((r) => r.played > 0)) continue;
    const top = standings(d.first).filter((c) => d.first.participants.includes(c));
    const below = standings(second).filter((c) => second.participants.includes(c));
    if (top.length < 2 || below.length < 1) continue;
    const up = [below[0]];
    const down = [top[top.length - 1]];
    // The playoff, where it was played out: its loser goes down, or stays down.
    const po = promotionPlayoff(d);
    if (po !== undefined && po.resolved && po.finalOrder.length === 2) {
      const [winner, loser] = po.finalOrder;
      if (second.participants.includes(winner) && d.first.participants.includes(loser)) {
        up.push(winner);
        down.push(loser);
      }
    }
    for (const id of down) move(world, id, d.first, second);
    for (const id of up) move(world, id, second, d.first);
    for (const id of up) moves.push({ clubId: id, up: true });
    for (const id of down) moves.push({ clubId: id, up: false });
    announce(world, d, up, down, po);
  }
  return moves;
}

function move(world: World, clubId: number, from: Competition, to: Competition): void {
  const club = world.clubs[clubId];
  if (club === undefined) return;
  from.participants = from.participants.filter((c) => c !== clubId);
  if (!to.participants.includes(clubId)) to.participants.push(clubId);
  club.leagueId = to.id;
  club.tier = to.tier;
}

function announce(world: World, d: Under21Divisions, up: number[], down: number[], po: PlayoffGroup | undefined): void {
  const names = (ids: number[]): string => ids.map((id) => clubName(world, id)).join(' and ');
  const playoff = po?.resolved === true && po.finalOrder.length === 2 ? po.finalOrder : null;
  postNews(world, {
    kind: 'result',
    headline: `${names(up)} up to ${d.first.name}`,
    body: `${clubName(world, up[0])} won ${d.second!.name} and go up` +
      (playoff !== null && up.includes(playoff[0])
        ? `, with ${clubName(world, playoff[0])}, who beat ${clubName(world, playoff[1])} in the promotion playoff. `
        : '. ') +
      `${names(down)} go down to ${d.second!.name}.`,
    nation: d.nation,
    clubId: up[0],
  });
  const mine = mineAmong(world, [...up, ...down]);
  if (mine < 0) return;
  const promoted = up.includes(mine);
  postMessage(world, {
    subject: promoted ? `${clubName(world, mine)} promoted to ${d.first.name}` : `${clubName(world, mine)} relegated to ${d.second!.name}`,
    body: promoted
      ? `${clubName(world, mine)} will play in ${d.first.name} next season${playoff !== null && playoff[0] === mine ? ', through the promotion playoff' : ''}.`
      : `${clubName(world, mine)} go down and will play in ${d.second!.name} next season${playoff !== null && playoff[1] === mine ? ', beaten in the promotion playoff' : ''}.`,
    from: d.first.name,
    category: 'board',
    clubId: mine,
  });
}
