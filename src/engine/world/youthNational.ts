/**
 * The nations' youth teams: every nation with a senior team has a U21 side
 * and a U19 side (side ids in sides.ts), and they play the same international
 * game the seniors do — the same tournaments, call-ups, matches, jobs and
 * matchday — through internationals.ts.
 *
 * - Who can play: a youth side calls its nation's players of its age or
 *   younger, academy players too, but not those the seniors are keeping —
 *   the last senior squad, and the manager's provisional squad if he coaches
 *   the seniors — unless the senior coach has sent one down to it.
 * - The summer: the U19s late in July, the U21s in mid-August, between the
 *   Nations League and the majors, both in the club's pre-season. Each age
 *   plays a world championship one summer — the U21s in the odd years, the
 *   U19s in the even ones — and the continental championships the other.
 * - Caps for a youth side are counted apart from the senior caps, and never
 *   tie a dual national to a nation. Each age keeps its own ranking.
 * - From the club side: the manager hears when his players are called up,
 *   and can put a prospect forward to a youth side's coach (a word that
 *   counts for something at the next call-up). As senior national coach he
 *   can send a young player down to the U21s or U19s, or bring one up.
 */

import { Rng } from '../core/rng.ts';
import { TYPICAL_RATING } from '../match/playerRating.ts';
import { Position } from '../model/positions.ts';
import { calendarOf, CALL_UP_DAYS, dateDay } from './calendar.ts';
import {
  createTournament, eligibleFor, fieldNotice, internationals, nationName, nextTournamentFor, recentForm, sideScore,
  squadOf, userNation, type Tournament, type TournamentWindow,
} from './internationals.ts';
import { frameOf } from './nationalExtras.ts';
import { CONFEDERATIONS, NATIONS } from './nations.ts';
import { baseNation, isYouthSide, sideAge, youthSide, YOUTH_AGES, type YouthAge } from './sides.ts';
import type { World } from './world.ts';

/** The fewest players a youth side needs to enter a tournament. */
const MIN_POOL = 12;
/** A youth world championship's field: four pools of four. */
const YOUTH_WORLDS_SIZE = 16;
/** A continental youth championship's field, at most. */
const YOUTH_CONTINENTAL_SIZE = 12;
/** How many prospects a club may put forward to the youth sides in a season. */
export const MAX_RECOMMENDATIONS = 3;
/** What a club's word is worth to a youth coach, on his scale. */
const RECOMMENDATION_WEIGHT = 45;

// ---- The teams ---------------------------------------------------------------------------

/** Every nation's U21 and U19 sides, made the first time they are needed — a new world, or a save from before them. */
export function ensureYouthTeams(world: World): void {
  const I = internationals(world);
  const list = (I.youthTeams ??= []);
  if (list.length >= world.nationalTeams.length * YOUTH_AGES.length) return;
  const have = new Set(list.map((t) => t.nation));
  for (const team of world.nationalTeams) {
    for (const age of YOUTH_AGES) {
      const side = youthSide(team.nation, age);
      if (have.has(side)) continue;
      // A strong nation's youngsters start strong: its own ranking, a little flattened.
      list.push({
        nation: side, squad: [], rankingPoints: Math.max(1, Math.round(team.rankingPoints * 0.8 + 60)),
        managedByUser: false, olympicGolds: 0, worldTitles: 0,
      });
    }
  }
}

/** A player's youth caps. */
export function youthCapsOf(world: World, p: number): { u21: number; u19: number } {
  return world.internationals?.youthCaps?.[p] ?? { u21: 0, u19: 0 };
}

/** The youth side a player of this age plays for, the youngest that takes him — or -1 if he is too old. */
export function youthSideFor(world: World, p: number, nation = world.players.nation[p]): number {
  const age = world.players.ageOn(p, world.year, 181);
  if (age <= 19) return youthSide(nation, 19);
  if (age <= 21) return youthSide(nation, 21);
  return -1;
}

/**
 * How a youth coach rates a player: ability first, then what he could still
 * become, his form and his youth caps — and a word from his club.
 */
export function youthScore(world: World, p: number, side: number): number {
  const store = world.players;
  const caps = youthCapsOf(world, p);
  const own = sideAge(side) === 21 ? caps.u21 : caps.u19;
  const growth = Math.max(0, store.potentialAbility[p] - store.currentAbility[p]);
  const word = recommendedFor(world, side).includes(p) ? RECOMMENDATION_WEIGHT : 0;
  return store.currentAbility[p] + growth * 0.12 + (recentForm(world, p) - TYPICAL_RATING) * 60 + Math.min(own, 30) * 0.8 + word
    - (store.condition[p] < 60 ? 40 : 0);
}

/** For each nation, how many players of a youth age it has — and whether a setter and a libero are among them. */
function youthPools(world: World, age: YouthAge): Map<number, { n: number; setters: number; liberos: number }> {
  const store = world.players;
  const out = new Map<number, { n: number; setters: number; liberos: number }>();
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.ageOn(i, world.year, 181) > age) continue;
    const row = out.get(store.nation[i]) ?? { n: 0, setters: 0, liberos: 0 };
    row.n++;
    if (store.position[i] === Position.Setter) row.setters++;
    if (store.position[i] === Position.Libero) row.liberos++;
    out.set(store.nation[i], row);
  }
  return out;
}

/** The youth sides of an age that can raise a team, best ranked first. */
export function rankedYouth(world: World, age: YouthAge): number[] {
  const pools = youthPools(world, age);
  return (internationals(world).youthTeams ?? [])
    .filter((t) => sideAge(t.nation) === age)
    .filter((t) => {
      const row = pools.get(baseNation(t.nation));
      return row !== undefined && row.n >= MIN_POOL && row.setters > 0 && row.liberos > 0;
    })
    .sort((a, b) => b.rankingPoints - a.rankingPoints)
    .map((t) => t.nation);
}

// ---- The summer --------------------------------------------------------------------------

/** A youth championship's days: the U19s from 24 July, the U21s from 10 August — the women ten days ahead. */
export function youthWindow(world: World, age: YouthAge, year: number): TournamentWindow {
  const ahead = world.gender === 'women' ? 10 : 0;
  const first = age === 19 ? dateDay(world.startYear, year, 7, 24) : dateDay(world.startYear, year, 8, 10);
  const start = first - ahead;
  return { callUp: start - CALL_UP_DAYS, start, end: start + 9 };
}

/** Whether an age plays its world championship this summer: the U21s in the odd years, the U19s in the even. */
export function youthWorldsYear(age: YouthAge, year: number): boolean {
  return age === 21 ? year % 2 === 1 : year % 2 === 0;
}

/** The summer's youth tournaments, drawn with the seniors' — unless it is already too late to call a squad. */
export function planYouthTournaments(world: World, year: number, rng: Rng): void {
  if (!calendarOf(world).fivb) return;
  ensureYouthTeams(world);
  for (const age of YOUTH_AGES) {
    const when = youthWindow(world, age, year);
    if (world.day > when.callUp) continue;
    const ranked = rankedYouth(world, age);
    if (youthWorldsYear(age, year)) {
      const entries = youthWorldsField(ranked, rng, age);
      if (entries.length < 8) continue;
      const seeded = ranked.filter((n) => entries.some(([x]) => x === n));
      const full = seeded.length >= YOUTH_WORLDS_SIZE;
      const t = createTournament(world, 'worlds', null, seeded, entries[0][0], year, when, age, full ? { pools: 4, advance: 2 } : undefined);
      if (t !== null) announce(world, t, entries);
      continue;
    }
    for (const conf of CONFEDERATIONS) {
      const own = ranked.filter((n) => NATIONS[baseNation(n)]?.confederation === conf).slice(0, YOUTH_CONTINENTAL_SIZE);
      if (own.length < 4) continue;
      const host = rng.pick(own.slice(0, 6));
      const t = createTournament(world, 'continental', conf, own, host, year, when, age);
      if (t !== null) announce(world, t, own.map((n) => [n, n === host ? 'Hosts' : `U${age} ranking`]));
    }
  }
}

/** A youth world championship's sixteen: the hosts, the two best of each confederation, the rest by the ranking. */
function youthWorldsField(ranked: number[], rng: Rng, age: YouthAge): Array<[number, string]> {
  const entries: Array<[number, string]> = [];
  const add = (n: number, why: string): void => {
    if (n >= 0 && entries.length < YOUTH_WORLDS_SIZE && !entries.some(([x]) => x === n)) entries.push([n, why]);
  };
  if (ranked.length === 0) return entries;
  add(rng.pick(ranked.slice(0, 10)), 'Hosts');
  for (const conf of CONFEDERATIONS) {
    ranked.filter((n) => NATIONS[baseNation(n)]?.confederation === conf).slice(0, 2).forEach((n) => add(n, `Best of ${conf}`));
  }
  for (const n of ranked) add(n, `U${age} ranking`);
  return entries;
}

function announce(world: World, t: Tournament, entries: Array<[number, string]>): void {
  t.entry = entries;
  fieldNotice(world, t);
}

// ---- The senior coach: sending players down, and bringing them up --------------------------

/** The side a player has been sent down to, or -1. */
export function sentDownTo(world: World, p: number): number {
  const sent = world.internationals?.sentDown;
  if (sent === undefined) return -1;
  for (const [side, list] of Object.entries(sent)) if (list.includes(p)) return Number(side);
  return -1;
}

/** Why the manager can't send a player down to his nation's youth side of an age, or null if he can. */
export function sendDownBlock(world: World, p: number, age: YouthAge): string | null {
  const nation = userNation(world);
  if (nation < 0 || isYouthSide(nation)) return 'Only the senior national coach can send players down.';
  const store = world.players;
  const name = store.fullName(p);
  if (!store.isActive(p)) return `${name} has retired.`;
  if (store.nation[p] !== nation && store.nation2[p] !== nation) return `${name} can't play for ${nationName(nation)}.`;
  const tied = world.internationals?.tiedTo.get(p);
  if (tied !== undefined && tied !== nation) return `${name} has committed to ${nationName(tied)}.`;
  if (store.ageOn(p, world.year, 181) > age) return `${name} is too old for the U${age}s.`;
  return null;
}

/** Send a young player down to the U21s or U19s — out of the provisional squad — or bring him back. Returns what happened. */
export function toggleSendDown(world: World, p: number, age: YouthAge): string {
  const I = internationals(world);
  const name = world.players.fullName(p);
  const nation = userNation(world);
  const side = youthSide(nation, age);
  const sent = (I.sentDown ??= {});
  if (sent[side]?.includes(p) === true) {
    sent[side] = sent[side].filter((x) => x !== p);
    return `${name} is no longer earmarked for ${nationName(side)}.`;
  }
  const block = sendDownBlock(world, p, age);
  if (block !== null) return block;
  // One side at a time.
  for (const k of Object.keys(sent)) sent[Number(k)] = sent[Number(k)].filter((x) => x !== p);
  (sent[side] ??= []).push(p);
  if (I.frame !== undefined) I.frame.players = I.frame.players.filter((x) => x !== p);
  const t = nextTournamentFor(world, side);
  return `${name} goes down to ${nationName(side)}${t !== undefined ? ` — their coach will call him for the ${t.name}` : ''}.`;
}

/**
 * The senior coach's view of a youth side of his nation: its squad at a tournament or the last
 * one it named, else its coach's pick — and the young players the seniors are keeping.
 */
export function youthSideSquad(world: World, side: number): number[] {
  const t = nextTournamentFor(world, side);
  if (t !== undefined && t.status !== 'planned') {
    const squad = squadOf(t, side);
    if (squad.length > 0) return squad;
  }
  const pool = eligibleFor(world, side);
  return [...pool].sort((a, b) => sideScore(world, b, side) - sideScore(world, a, side)).slice(0, 14);
}

/** Young players the seniors are keeping from a youth side: in the frame or the last senior squad. */
export function keptBySeniors(world: World, side: number): number[] {
  const nation = baseNation(side);
  const age = sideAge(side);
  const store = world.players;
  const team = world.nationalTeams.find((t) => t.nation === nation);
  const keep = new Set([...(team?.squad ?? []), ...(userNation(world) === nation ? frameOf(world) : [])]);
  return [...keep].filter((p) => store.isActive(p) && age > 0 && store.ageOn(p, world.year, 181) <= age);
}

// ---- The club: its prospects and the youth sides --------------------------------------------

/** The prospects a club has put forward to a youth side this season. */
export function recommendedFor(world: World, side: number): number[] {
  return (world.internationals?.recommended ?? []).filter((r) => r.side === side && r.season === world.season).map((r) => r.p);
}

/** How many prospects the manager has put forward this season. */
export function recommendationsUsed(world: World): number {
  return (world.internationals?.recommended ?? []).filter((r) => r.season === world.season).length;
}

/** Why the manager can't put a player forward to his youth side, or null if he can. */
export function recommendBlock(world: World, p: number): string | null {
  const store = world.players;
  const name = store.fullName(p);
  if (world.userClubId < 0 || store.clubId[p] !== world.userClubId) return `${name} is not one of your players.`;
  const side = youthSideFor(world, p);
  if (side < 0) return `${name} is too old for the youth sides.`;
  if (recommendedFor(world, side).includes(p)) return `You have already put ${name} forward to ${nationName(side)}.`;
  const t = nextTournamentFor(world, side);
  if (t !== undefined && t.status !== 'planned' && squadOf(t, side).includes(p)) return `${name} is already with ${nationName(side)}.`;
  if (recommendationsUsed(world) >= MAX_RECOMMENDATIONS) return `${MAX_RECOMMENDATIONS} recommendations a season is as many as the federations will hear.`;
  return null;
}

/** Put a prospect forward to his youth side's coach: it counts for him at the next call-up. Returns what happened. */
export function recommendToYouthSide(world: World, p: number): { ok: boolean; text: string } {
  const block = recommendBlock(world, p);
  if (block !== null) return { ok: false, text: block };
  const side = youthSideFor(world, p);
  (internationals(world).recommended ??= []).push({ p, side, season: world.season });
  const t = nextTournamentFor(world, side);
  return {
    ok: true,
    text: `${nationName(side)}'s coach has your word on ${world.players.fullName(p)}` +
      `${t !== undefined ? ` — he will be looked at for the ${t.name}` : ''}.`,
  };
}

/** Where a young player stands with his youth side. */
export type YouthStatus = 'away' | 'named' | 'contention' | 'watched' | 'outside';

export interface YouthIntlLine {
  p: number;
  side: number;
  status: YouthStatus;
  /** His place in his youth coach's pecking order, 1 the first. */
  order: number;
  u21: number;
  u19: number;
  seniorCaps: number;
  recommended: boolean;
  /** Kept back by the seniors. */
  senior: boolean;
  next?: Tournament;
}

/**
 * A club's young players and their youth sides: who is away with one now,
 * who was in the last squad, who is in contention, and where each stands in
 * his coach's eyes — the academy's international picture.
 */
export function clubYouthInternationals(world: World, players: readonly number[]): YouthIntlLine[] {
  const store = world.players;
  const orders = new Map<number, number[]>();
  const orderOf = (side: number): number[] => {
    let o = orders.get(side);
    if (o === undefined) {
      o = [...eligibleFor(world, side)].sort((a, b) => sideScore(world, b, side) - sideScore(world, a, side));
      orders.set(side, o);
    }
    return o;
  };
  const out: YouthIntlLine[] = [];
  for (const p of players) {
    const side = youthSideFor(world, p);
    if (side < 0) continue;
    const team = internationals(world).youthTeams?.find((t) => t.nation === side);
    const next = nextTournamentFor(world, side);
    const away = next !== undefined && next.status !== 'planned' && squadOf(next, side).includes(p) && !next.out.includes(side);
    const senior = keptBySeniors(world, side).includes(p);
    const order = orderOf(side).indexOf(p) + 1;
    const caps = youthCapsOf(world, p);
    const status: YouthStatus = away ? 'away'
      : team?.squad.includes(p) === true ? 'named'
        : order > 0 && order <= 20 ? 'contention'
          : order > 0 && order <= 40 ? 'watched' : 'outside';
    out.push({
      p, side, status, order, u21: caps.u21, u19: caps.u19, seniorCaps: store.nationalCaps[p],
      recommended: recommendedFor(world, side).includes(p), senior, next,
    });
  }
  return out;
}

/** The youth side's verdict in a few words. */
export const YOUTH_STATUS_LABEL: Readonly<Record<YouthStatus, string>> = {
  away: 'Away with the squad',
  named: 'In the last squad',
  contention: 'In contention',
  watched: 'On the radar',
  outside: 'Not in the picture',
};
