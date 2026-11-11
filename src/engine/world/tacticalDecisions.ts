/**
 * The tactical side of the manager's career, as the save keeps it: the last
 * few matches read by the bench (see match/assistant.ts) — for the diagnosis
 * between matches — and every change he made on the assistant's word, with
 * whether he undid it.
 */

import { playStats, type PlayStats } from '../match/assistant.ts';
import type { MatchResult } from '../match/engine.ts';
import type { Fixture, World } from './world.ts';

/** One change made on the assistant's advice. */
export interface TacticDecision {
  id: number;
  season: number;
  day: number;
  /** During a match, at a set break or a pause — or between matches, from the Analysis. */
  where: 'live' | 'analysis';
  fixtureId?: number;
  /** The set it was made before, in a match. */
  set?: number;
  /** What the assistant saw, and what was changed. */
  finding: string;
  change: string;
  changeId: string;
  undone?: boolean;
}

/** A match of the manager's, as the bench read it. */
export interface RecentPlay {
  fixtureId: number;
  day: number;
  opponent: number;
  won: boolean;
  ours: PlayStats;
  theirs: PlayStats;
}

/** Matches the diagnosis between matches looks back over. */
export const RECENT_MATCHES = 5;
/** Decisions kept. */
const KEEP_DECISIONS = 80;

/** Note a match of the manager's club, played through the full engine. */
export function noteRecentPlay(world: World, fixture: Fixture, result: MatchResult): void {
  const club = world.userClubId;
  if (club < 0 || result.log === null || (fixture.home !== club && fixture.away !== club)) return;
  const us: 0 | 1 = fixture.home === club ? 0 : 1;
  const list = (world.recentPlay ??= []);
  if (list.some((r) => r.fixtureId === fixture.id)) return;
  list.push({
    fixtureId: fixture.id, day: fixture.day, opponent: us === 0 ? fixture.away : fixture.home,
    won: (us === 0 ? result.homeSets : result.awaySets) > (us === 0 ? result.awaySets : result.homeSets),
    ours: playStats(result.log, us), theirs: playStats(result.log, (1 - us) as 0 | 1),
  });
  if (list.length > RECENT_MATCHES) list.splice(0, list.length - RECENT_MATCHES);
}

/** Note a change made on the assistant's word; its id, to undo it by. */
export function noteDecision(world: World, d: Omit<TacticDecision, 'id' | 'season' | 'day'>): number {
  const list = (world.tacticDecisions ??= []);
  const id = (list.at(-1)?.id ?? 0) + 1;
  list.push({ ...d, id, season: world.season, day: world.day });
  if (list.length > KEEP_DECISIONS) list.splice(0, list.length - KEEP_DECISIONS);
  return id;
}

export function markUndone(world: World, id: number): void {
  const d = world.tacticDecisions?.find((x) => x.id === id);
  if (d !== undefined) d.undone = true;
}
