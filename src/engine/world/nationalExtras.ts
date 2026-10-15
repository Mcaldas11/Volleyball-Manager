/**
 * More for the national coach to do between tournaments.
 *
 * Friendlies: in the national team's months — the end of spring, and the
 * summer before the clubs start again — he can arrange a match with another
 * nation on a free date, three a season at most; it counts for caps, not for
 * the ranking, and the squad is called three days before like any other.
 *
 * The provisional squad: up to twenty-five players in the frame, named
 * whenever he likes. The assistant's fourteen come from them first, and when
 * the squad is named the ones in the frame hear how they stand.
 *
 * And he can go and watch a player's next club match: he sees him play,
 * knows him better for it, and has the night's report in his inbox.
 */

import { calendarOn } from './calendar.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { matchRating } from '../match/playerRating.ts';
import type { Position } from '../model/positions.ts';
import { postMessage } from './inbox.ts';
import {
  createFriendly, eligibleFor, internationals, nationName, pickSquad, userNation, type Tournament,
} from './internationals.ts';
import { DAYS_PER_SEASON, phaseOfSeason, SeasonPhase, type Fixture, type World } from './world.ts';

/** Friendlies a season, at most. */
export const MAX_FRIENDLIES = 3;
/** Days ahead a friendly can be arranged: a week's notice at least, two months at most. */
const NOTICE = 7;
const HORIZON = 60;
/** Days kept clear around a tournament. */
const CLEAR = 4;

/** Whether a nation is busy on a day: a tournament of its own, call-up to final, with a few days either side. */
function busy(tournaments: readonly Tournament[], nation: number, day: number): boolean {
  return tournaments.some((t) => t.status !== 'done' && t.teams.includes(nation) &&
    day >= t.callUpDay - CLEAR && day <= t.knockoutDays[t.knockoutDays.length - 1] + CLEAR);
}

/** The national team's months: the end of spring, and the summer before the clubs start again. */
function nationalWindow(world: World, day: number): boolean {
  const d = ((day % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON;
  const cal = calendarOn(world, day);
  return phaseOfSeason(d, cal) === SeasonPhase.NationalTeam || d < cal.summerFriendliesUntil;
}

/** The days a friendly could be played against `opp` — or against anyone, without one. */
export function friendlyDays(world: World, opp = -1): number[] {
  const mine = userNation(world);
  if (mine < 0) return [];
  const I = internationals(world);
  const out: number[] = [];
  for (let day = world.day + NOTICE; day <= world.day + HORIZON; day++) {
    if (!nationalWindow(world, day) || busy(I.tournaments, mine, day)) continue;
    if (opp >= 0 && busy(I.tournaments, opp, day)) continue;
    out.push(day);
  }
  return out;
}

/** Friendlies arranged this season. */
export function friendliesThisSeason(world: World): number {
  return internationals(world).tournaments.filter((t) => t.kind === 'friendly' && t.season === world.season && t.teams.includes(userNation(world))).length;
}

/** The nations he could play: every one with a team, the strongest first. */
export function friendlyOpponents(world: World): number[] {
  const mine = userNation(world);
  return [...world.nationalTeams].filter((t) => t.nation !== mine).sort((a, b) => b.rankingPoints - a.rankingPoints).map((t) => t.nation);
}

/** Arrange a friendly. Returns what happened, or why not. */
export function arrangeFriendly(world: World, opp: number, day: number, home: boolean): { ok: boolean; text: string } {
  const mine = userNation(world);
  if (mine < 0) return { ok: false, text: 'You don\'t coach a national team.' };
  if (friendliesThisSeason(world) >= MAX_FRIENDLIES) return { ok: false, text: `${MAX_FRIENDLIES} friendlies a season is the most the federation allows.` };
  if (!friendlyDays(world, opp).includes(day)) return { ok: false, text: 'That date doesn\'t work for one of the two teams.' };
  const t = home ? createFriendly(world, mine, opp, day) : createFriendly(world, opp, mine, day);
  return { ok: true, text: `Arranged: ${t.name.replace(' — friendly', '')}, a friendly${home ? ' at home' : ' away'}. The squad is called three days before.` };
}

// ---- The provisional squad ------------------------------------------------------------------

export const FRAME_MAX = 25;

/** The players in the frame this season. */
export function frameOf(world: World): number[] {
  const f = internationals(world).frame;
  return f !== undefined && f.season === world.season ? f.players : [];
}

/** In or out of the frame. Returns what happened. */
export function toggleFrame(world: World, p: number): string {
  const I = internationals(world);
  if (I.frame === undefined || I.frame.season !== world.season) I.frame = { season: world.season, players: [] };
  const name = world.players.fullName(p);
  if (I.frame.players.includes(p)) {
    I.frame.players = I.frame.players.filter((x) => x !== p);
    return `${name} is out of the frame.`;
  }
  if (I.frame.players.length >= FRAME_MAX) return `${FRAME_MAX} is the most the provisional squad holds.`;
  if (!eligibleFor(world, userNation(world)).includes(p)) return `${name} can't play for ${nationName(userNation(world))}.`;
  I.frame.players.push(p);
  return `${name} is in the provisional squad.`;
}

/** The assistant's fourteen, from the frame first. */
export function framedSquad(world: World, pool: readonly number[]): number[] {
  const frame = new Set(frameOf(world));
  if (frame.size === 0) return pickSquad(world, pool);
  const inFrame = pool.filter((p) => frame.has(p));
  const squad = pickSquad(world, inFrame);
  if (squad.length >= 14) return squad;
  const rest = pickSquad(world, pool.filter((p) => !squad.includes(p)));
  return [...squad, ...rest.slice(0, 14 - squad.length)];
}

/** The squad named: the ones in the frame hear how they stand. */
export function frameVerdict(world: World, squad: readonly number[]): void {
  const store = world.players;
  for (const p of frameOf(world)) {
    store.morale[p] = Math.max(0, Math.min(100, store.morale[p] + (squad.includes(p) ? 2 : -3)));
  }
}

// ---- Watching a club match --------------------------------------------------------------------

export const MAX_WATCHING = 3;

/** The players he is going to watch. */
export function watchingList(world: World): number[] {
  return (internationals(world).watching ?? []).map((w) => w.p);
}

/** Go and watch a player's next club match — or not, if he is on the list. Returns what happened. */
export function toggleWatch(world: World, p: number): string {
  const I = internationals(world);
  const list = (I.watching ??= []);
  const name = world.players.fullName(p);
  if (list.some((w) => w.p === p)) {
    I.watching = list.filter((w) => w.p !== p);
    return `You won't go to watch ${name} after all.`;
  }
  if (list.length >= MAX_WATCHING) return `You are going to watch ${MAX_WATCHING} already.`;
  if (world.players.clubId[p] < 0) return `${name} has no club to watch him with.`;
  list.push({ p, since: world.day });
  return `You will be at ${world.clubs[world.players.clubId[p]]?.name ?? 'his club'}'s next match to watch ${name}.`;
}

/**
 * A club match played: anyone the national coach went to watch who played
 * in it is seen — known better, and reported on. Called after every match.
 */
export function watchedInMatch(world: World, f: Fixture, home: ReadonlyMap<number, PlayerMatchStats>, away: ReadonlyMap<number, PlayerMatchStats>): void {
  const I = world.internationals;
  const list = I?.watching;
  if (I === undefined || list === undefined || list.length === 0) return;
  const store = world.players;
  for (const w of [...list]) {
    const side = store.clubId[w.p] === f.home ? home : store.clubId[w.p] === f.away ? away : null;
    if (side === null) continue;
    I.watching = (I.watching ?? []).filter((x) => x.p !== w.p);
    const s = side.get(w.p);
    const name = store.fullName(w.p);
    const opp = world.clubs[store.clubId[w.p] === f.home ? f.away : f.home]?.name ?? 'the opposition';
    if (s === undefined || s.ralliesPlayed === 0) {
      postMessage(world, {
        category: 'international', from: 'Your notebook', playerIdx: w.p,
        subject: `Watched: ${name} didn't play`,
        body: `You went to see ${name} against ${opp}, but he didn't get on. Another time.`,
      });
      continue;
    }
    const homeSide = store.clubId[w.p] === f.home;
    const rating = matchRating(s, store.position[w.p] as Position, homeSide ? f.homeSets : f.awaySets, homeSide ? f.awaySets : f.homeSets);
    const known = world.scoutingKnowledge.get(w.p)?.matchesWatched ?? 0;
    world.scoutingKnowledge.set(w.p, { matchesWatched: Math.min(80, known + 3) });
    const points = s.attackKills + s.serveAces + s.blockPoints;
    postMessage(world, {
      category: 'international', from: 'Your notebook', playerIdx: w.p,
      subject: `Watched: ${name} — ${rating.toFixed(1)}`,
      body: `You were there to see ${name} against ${opp}: ${points} point${points === 1 ? '' : 's'} ` +
        `(${s.attackKills} kills from ${s.attacksTotal}, ${s.serveAces} aces, ${s.blockPoints} blocks), rated ${rating.toFixed(1)}. ` +
        'You know his game better for having seen it.',
    });
  }
}
