/**
 * Where a player has played: his spells at clubs, oldest first.
 *
 * A spell lasts as many seasons as he stays — a loan is a spell of its own,
 * and going back afterwards another. The save keeps what happens in it, match
 * by match; the years before it began are drawn up with the world — the clubs
 * and the seasons, though not what he did there.
 */

import { Rng } from '../core/rng.ts';
import { playedInMatch } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import type { Fixture, World } from './world.ts';

export interface ClubSpell {
  club: number;
  /** First and last season there — before 0, the years before the save began. */
  from: number;
  to: number;
  loan?: true;
  /** Matches played and points won there, in the save — -1 for a spell over before it began. */
  apps: number;
  points: number;
}

/**
 * How the spells are kept: one flat list of numbers a player, SPELL_FIELDS to
 * a spell — there are hundreds of thousands of them in a world, and a save
 * stores plain numbers far more compactly than as many little objects.
 */
const SPELL_FIELDS = 6;
const CLUB = 0;
const FROM = 1;
const TO = 2;
const APPS = 3;
const POINTS = 4;
const LOAN = 5;

/** A player's spells, oldest first. */
export function spellsOf(world: World, p: number): ClubSpell[] {
  const flat = world.clubSpells?.get(p) ?? [];
  const out: ClubSpell[] = [];
  for (let i = 0; i + SPELL_FIELDS <= flat.length; i += SPELL_FIELDS) {
    const s: ClubSpell = { club: flat[i + CLUB], from: flat[i + FROM], to: flat[i + TO], apps: flat[i + APPS], points: flat[i + POINTS] };
    if (flat[i + LOAN] === 1) s.loan = true;
    out.push(s);
  }
  return out;
}

function pack(spells: ClubSpell[]): number[] {
  return spells.flatMap((s) => [s.club, s.from, s.to, s.apps, s.points, s.loan === true ? 1 : 0]);
}

/** The calendar years a spell covers: from the summer it began to the one it ended. */
export function spellYears(world: World, s: ClubSpell): [number, number] {
  return [world.startYear + s.from, world.startYear + s.to + 1];
}

function onLoanAt(world: World, p: number, club: number): boolean {
  return world.loans.some((l) => l.playerIdx === p && l.loanClubId === club);
}

/** He is at `club` this season: his spell there goes on, or a new one begins. Returns where it sits in his list. */
function noteClub(world: World, p: number, club: number, season: number): { flat: number[]; at: number } {
  const spells = (world.clubSpells ??= new Map());
  let flat = spells.get(p);
  if (flat === undefined) {
    flat = [];
    spells.set(p, flat);
  }
  const loan = onLoanAt(world, p, club) ? 1 : 0;
  const at = flat.length - SPELL_FIELDS;
  if (at >= 0 && flat[at + CLUB] === club && flat[at + LOAN] === loan) {
    flat[at + TO] = Math.max(flat[at + TO], season);
    if (flat[at + APPS] < 0) {
      flat[at + APPS] = 0;
      flat[at + POINTS] = 0;
    }
    return { flat, at };
  }
  flat.push(club, season, season, 0, 0, loan);
  return { flat, at: flat.length - SPELL_FIELDS };
}

/** A club match played: everyone who got on court has it on his record at the club. */
export function recordClubMatch(
  world: World, fixture: Fixture, homeStats: Map<number, PlayerMatchStats>, awayStats: Map<number, PlayerMatchStats>,
): void {
  for (const [club, stats] of [[fixture.home, homeStats], [fixture.away, awayStats]] as const) {
    if (world.clubs[club] === undefined) continue;
    for (const [p, s] of stats) {
      if (!playedInMatch(s)) continue;
      const { flat, at } = noteClub(world, p, club, world.season);
      flat[at + APPS]++;
      flat[at + POINTS] += s.attackKills + s.serveAces + s.blockPoints;
    }
  }
}

/** A new season: every senior player's spell at his club runs into it — or begins with it. */
export function openSeasonSpells(world: World): void {
  const store = world.players;
  for (const club of world.clubs) {
    for (const p of club.players) {
      if (store.isActive(p) && !store.hasFlag(p, PlayerFlag.Youth)) noteClub(world, p, club.id, world.season);
    }
  }
}

/** Most spells drawn for the years before the save; the oldest careers had more. */
const MAX_PAST_SPELLS = 9;

/**
 * Draw every senior player's career before the save: where he is now, and
 * since when, and the clubs before — at home mostly, a stint or two abroad
 * for some, lower down the pyramid the further back. `now` is the season the
 * save is in: 0 for a new world, later for a save from before histories.
 */
export function drawPastSpells(world: World, rng: Rng, now = world.season): void {
  const store = world.players;
  const spells = (world.clubSpells ??= new Map());
  const byNation = new Map<number, Club[][]>();
  for (const c of world.clubs) {
    const tiers = byNation.get(c.nation) ?? [];
    (tiers[c.tier - 1] ??= []).push(c);
    byNation.set(c.nation, tiers);
  }
  const nations = [...byNation.keys()];
  const pickClub = (nation: number, tier: number, not: number): number => {
    const tiers = byNation.get(nation);
    if (tiers === undefined || tiers.length === 0) return -1;
    const t = Math.max(0, Math.min(tiers.length - 1, tier - 1));
    const pool = (tiers[t] ?? []).filter((c) => c.id !== not);
    if (pool.length === 0) return -1;
    return pool[rng.int(0, pool.length - 1)].id;
  };

  for (let p = 0; p < store.count; p++) {
    if (!store.isActive(p) || store.hasFlag(p, PlayerFlag.Youth) || spells.has(p)) continue;
    const clubId = store.clubId[p];
    const club = clubId >= 0 ? world.clubs[clubId] : undefined;
    const age = store.ageOn(p, world.startYear + now, 181);
    // Seasons as a senior player before this one.
    let years = Math.max(0, age - rng.int(18, 20));
    const list: ClubSpell[] = [];
    let cursor = now;
    let next = -1;
    if (club !== undefined) {
      const stay = 1 + rng.int(0, Math.min(years, age < 24 ? 4 : age < 30 ? 3 : 2));
      list.push({ club: club.id, from: now - stay + 1, to: now, apps: 0, points: 0 });
      cursor = now - stay + 1;
      years -= stay - 1;
      next = club.id;
    }
    const home = store.nation[p];
    const tierNow = club?.tier ?? 3;
    while (years > 0 && list.length < MAX_PAST_SPELLS) {
      const len = Math.min(years, rng.int(1, 4));
      // Further back, further down — and now and then abroad.
      const back = now - cursor;
      const tier = tierNow + (back > 3 && rng.chance(0.5) ? 1 : 0) + (back > 7 && rng.chance(0.4) ? 1 : 0);
      const abroad = rng.chance(club !== undefined && club.nation !== home ? 0.35 : 0.12);
      const nation = abroad ? nations[rng.int(0, nations.length - 1)] : home;
      let id = pickClub(nation, tier, next);
      if (id < 0) id = pickClub(home, tier, next);
      if (id < 0) break;
      list.unshift({ club: id, from: cursor - len, to: cursor - 1, apps: -1, points: -1 });
      cursor -= len;
      years -= len;
      next = id;
    }
    if (list.length > 0) spells.set(p, pack(list));
  }
}

/** A world's histories, drawn from dice of their own so the rest of it comes out the same. */
export function seedClubHistories(world: World, now = world.season): void {
  drawPastSpells(world, new Rng(world.seed ^ 0x0c1ab5), now);
}
