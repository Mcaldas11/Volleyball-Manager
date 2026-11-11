/**
 * A player's career, as a timeline: the clubs he has played for and the loans,
 * each season's numbers, the titles he won and the awards — all read from what
 * the save already keeps — and the moments it notes as they happen: his debut,
 * a serious injury, the armband, coming up from the academy.
 *
 * A youngster followed from the academy to the captaincy reads, here, as the
 * story it is.
 */

import { INJURY_NAMES, type InjuryType } from '../model/players.ts';
import { accoladeTitle, playerAccolades } from './accolades.ts';
import { spellsOf, spellYears } from './clubHistory.ts';
import type { World } from './world.ts';

export type PlayerEventKind = 'debut' | 'injury' | 'captain' | 'promoted' | 'academy';

/** A moment the save noted as it happened. */
export interface PlayerEvent {
  kind: PlayerEventKind;
  season: number;
  day: number;
  clubId: number;
  /** Injuries: its type and how long he was out. */
  injury?: number;
  days?: number;
  /** A debut: the competition. */
  competitionId?: number;
}

/** The most moments kept for one player — the oldest go first. */
const KEEP = 40;
/** An injury worth a place in a career: out a month or more. */
export const SERIOUS_INJURY_DAYS = 28;

/** A player of real standing: his serious injuries are worth keeping wherever he plays. */
const NOTABLE_ABILITY = 1450;

/**
 * Whether a moment is worth keeping: everything about the manager's own
 * players; elsewhere, only what a career is remembered by — a debut, and a
 * serious injury to a player of standing. (The world has thousands of
 * players: noting every academy arrival and every injury in it would swell
 * the save season after season.)
 */
function worthNoting(world: World, p: number, e: Pick<PlayerEvent, 'kind' | 'clubId'>): boolean {
  if (e.clubId === world.userClubId && world.userClubId >= 0) return true;
  if (e.kind === 'debut') return true;
  if (e.kind === 'injury') return world.players.currentAbility[p] >= NOTABLE_ABILITY;
  return e.kind === 'captain' || e.kind === 'promoted' ? world.userClubId === e.clubId : false;
}

/** Note a moment in a player's career. */
export function notePlayerEvent(world: World, p: number, e: Omit<PlayerEvent, 'season' | 'day'> & { day?: number }): void {
  if (!worthNoting(world, p, e)) return;
  const all = (world.playerEvents ??= {});
  const list = (all[p] ??= []);
  // One debut, one promotion: the first is the one that counts.
  if ((e.kind === 'debut' || e.kind === 'promoted') && list.some((x) => x.kind === e.kind)) return;
  list.push({ ...e, season: world.season, day: e.day ?? world.day });
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
}

export type TimelineKind = 'club' | 'loan' | 'season' | 'title' | 'award' | PlayerEventKind;

export interface TimelineItem {
  kind: TimelineKind;
  /** The season it belongs to; within a season, the absolute day when known. */
  season: number;
  day: number;
  title: string;
  detail?: string;
  clubId?: number;
}

/**
 * A player's career, oldest first: spells, titles, awards, each season's line,
 * and the moments noted along the way.
 */
export function playerTimeline(world: World, p: number, seasonLabel: (s: number) => string): TimelineItem[] {
  const store = world.players;
  const out: TimelineItem[] = [];
  const clubName = (id: number): string => world.clubs[id]?.name ?? 'a club';

  // His clubs, and his loans.
  const spells = spellsOf(world, p);
  for (const s of spells) {
    const [from, to] = spellYears(world, s);
    const years = from === to ? `${from}` : `${from}–${to}`;
    out.push({
      kind: s.loan === true ? 'loan' : 'club', season: s.from, day: -1, clubId: s.club,
      title: s.loan === true ? `On loan at ${clubName(s.club)}` : `Joins ${clubName(s.club)}`,
      detail: s.apps >= 0 ? `${years} · ${s.apps} matches, ${s.points} points` : years,
    });
  }

  // Each season he played, in a line.
  const bySeason = new Map<number, { apps: number; points: number; ratingSum: number; mvps: number }>();
  for (const r of world.competitionRecords.get(p) ?? []) {
    const line = bySeason.get(r.season) ?? { apps: 0, points: 0, ratingSum: 0, mvps: 0 };
    line.apps += r.apps;
    line.points += r.points;
    line.ratingSum += r.ratingSum;
    line.mvps += r.mvps;
    bySeason.set(r.season, line);
  }
  for (const [season, l] of bySeason) {
    if (l.apps === 0) continue;
    out.push({
      kind: 'season', season, day: Number.MAX_SAFE_INTEGER - 1,
      title: `${seasonLabel(season)} season`,
      detail: `${l.apps} matches · ${l.points} points · average ${(l.ratingSum / l.apps).toFixed(2)}` +
        (l.mvps > 0 ? ` · ${l.mvps} MVP${l.mvps === 1 ? '' : 's'}` : ''),
    });
  }

  // The titles: a trophy his club won in a season he played in that competition.
  for (const record of world.history) {
    for (const c of record.champions) {
      const comp = world.competitions[c.competitionId];
      if (comp === undefined || comp.kind === 'friendly') continue;
      const played = (world.competitionRecords.get(p) ?? []).some((r) =>
        r.season === record.season && r.competitionId === c.competitionId && r.apps > 0);
      if (!played) continue;
      const atWinner = spells.some((s) => s.club === c.winner && s.from <= record.season && s.to >= record.season);
      if (!atWinner) continue;
      out.push({ kind: 'title', season: record.season, day: Number.MAX_SAFE_INTEGER - 2, clubId: c.winner, title: `Wins the ${comp.name}`, detail: clubName(c.winner) });
    }
  }

  // His awards.
  for (const a of playerAccolades(world, p)) {
    out.push({ kind: 'award', season: a.season, day: Number.MAX_SAFE_INTEGER - 3, clubId: a.clubId, title: accoladeTitle(world, a) });
  }

  // The moments noted as they happened.
  for (const e of world.playerEvents?.[p] ?? []) {
    const at = clubName(e.clubId);
    const item = ((): TimelineItem | null => {
      switch (e.kind) {
        case 'debut':
          return { kind: 'debut', season: e.season, day: e.day, clubId: e.clubId, title: 'Senior debut', detail: `${at}${e.competitionId !== undefined && world.competitions[e.competitionId] !== undefined ? ` · ${world.competitions[e.competitionId].name}` : ''}` };
        case 'injury':
          return { kind: 'injury', season: e.season, day: e.day, clubId: e.clubId, title: `${INJURY_NAMES[e.injury as InjuryType] ?? 'Injury'}`, detail: `Out for about ${Math.max(1, Math.round((e.days ?? 0) / 7))} weeks` };
        case 'captain':
          return { kind: 'captain', season: e.season, day: e.day, clubId: e.clubId, title: 'Named captain', detail: at };
        case 'promoted':
          return { kind: 'promoted', season: e.season, day: e.day, clubId: e.clubId, title: 'Promoted from the academy', detail: at };
        case 'academy':
          return { kind: 'academy', season: e.season, day: e.day, clubId: e.clubId, title: 'Joins the academy', detail: at };
        default:
          return null;
      }
    })();
    if (item !== null) out.push(item);
  }

  // Born: where it all starts.
  out.sort((a, b) => a.season - b.season || a.day - b.day);
  void store;
  return out;
}
