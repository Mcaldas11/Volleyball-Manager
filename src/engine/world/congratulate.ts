/**
 * A word of congratulation: the manager's own players honoured in a message —
 * a milestone for the club, the Player, Point or Play of the Month, a place in
 * a team of the month or of the season, a season's award — called in and
 * told well done. One of them, one to one; several, the group together. Once
 * a message: a second word on the same honour means nothing.
 */

import type { Club } from '../model/club.ts';
import type { GameMessage, World } from './world.ts';

/** What a word of congratulation does for a man's morale — alone, and as one of a group. */
const ONE = 7;
const GROUP = 4;

/** A club milestone's subject: "Name: 100 games for Club". */
const MILESTONE = /: \d+ games for /;

/** The manager's own players a message honours, in the order it names them. */
export function honouredIn(world: World, m: GameMessage): number[] {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return [];
  const ours = (p: number | undefined): p is number => p !== undefined && p >= 0 && club.players.includes(p);
  const out: number[] = [];
  const add = (p: number | undefined): void => {
    if (ours(p) && !out.includes(p)) out.push(p);
  };
  if (m.playerIdx !== undefined && MILESTONE.test(m.subject)) add(m.playerIdx);
  if (m.award !== undefined) {
    if (m.award.kind === 'player') add(m.award.players?.[0]?.p);
    else add(m.award.highlights?.[0]?.star);
  }
  for (const pick of m.teamOfSeason?.picks ?? []) add(pick.p);
  if (m.awardsNight !== undefined) {
    for (const a of m.awardsNight.awards) if (a.kind !== 'coach') add(a.shortlist[0]?.p);
    for (const pick of m.awardsNight.team) add(pick.p);
    for (const line of m.awardsNight.extras ?? []) add(line.playerIdx);
  }
  for (const line of m.seasonAwards ?? []) add(line.playerIdx);
  return out;
}

/** Why the manager can't congratulate anyone on this message, or null if he can. */
export function congratulationBlock(world: World, m: GameMessage): string | null {
  if (world.congratulated?.[m.id] === true) return 'You have congratulated them already.';
  return honouredIn(world, m).length === 0 ? 'None of your players to congratulate.' : null;
}

/** Congratulate the players a message honours: how it went, and what they say. */
export function congratulate(world: World, club: Club, m: GameMessage): { ok: boolean; text: string; reply: string } {
  const block = congratulationBlock(world, m);
  if (block !== null) return { ok: false, text: block, reply: '' };
  const store = world.players;
  const who = honouredIn(world, m).filter((p) => club.players.includes(p));
  const lift = who.length === 1 ? ONE : GROUP;
  for (const p of who) store.morale[p] = Math.min(100, store.morale[p] + lift);
  (world.congratulated ??= {})[m.id] = true;
  if (who.length === 1) {
    const name = store.fullName(who[0]);
    return {
      ok: true,
      text: `You congratulate ${name}. He is clearly touched that you took the time.`,
      reply: 'Thanks, boss — it means a lot, coming from you.',
    };
  }
  const names = who.map((p) => store.shortName(p));
  const listed = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return {
    ok: true,
    text: `You gather ${listed} and congratulate them together. The group is in high spirits.`,
    reply: 'Thanks, boss — we did it together.',
  };
}
