/**
 * Challenges: a career begun with a goal and a deadline. Keep the weakest side in a top division up;
 * win your continent's champions' cup within five seasons; win the national cup with an outsider;
 * take a second-division club up within three. The challenge picks — or suggests — the club; each
 * summer it is checked, and it ends in success, or in failure when the time runs out or the manager
 * leaves the club.
 */

import { postMessage } from './inbox.ts';
import type { World } from './world.ts';

export type ChallengeId = 'survival' | 'champions' | 'cup' | 'promotion';

export interface ChallengeDef {
  id: ChallengeId;
  name: string;
  goal: string;
  /** Seasons to do it in, counting the first. */
  seasons: number;
}

export const CHALLENGES: readonly ChallengeDef[] = [
  { id: 'survival', name: 'The great escape', goal: 'Keep the weakest side in a top division up', seasons: 1 },
  { id: 'champions', name: 'Champions of the continent', goal: 'Win your continent’s champions’ cup within five seasons', seasons: 5 },
  { id: 'cup', name: 'Cup giant-killers', goal: 'Win the national cup with a side outside the country’s top four, within two seasons', seasons: 2 },
  { id: 'promotion', name: 'Up from below', goal: 'Take a second-division club up within three seasons', seasons: 3 },
];

export interface Challenge {
  id: ChallengeId;
  clubId: number;
  startSeason: number;
  /** The last season it can be done in. */
  lastSeason: number;
  status: 'on' | 'won' | 'lost';
}

/** The clubs a challenge can be taken on with, best suggestion first — empty where this world has none. */
export function challengeClubs(world: World, id: ChallengeId): number[] {
  const leagues = world.competitions.filter((c) => c.kind === 'league' && c.participants.length > 0);
  const byRep = (ids: number[]): number[] => [...ids].sort((a, b) => world.clubs[a].reputation - world.clubs[b].reputation);
  switch (id) {
    case 'survival':
      // The weakest in each top division that sends anyone down.
      return byRep(leagues.filter((l) => l.tier === 1 && l.relegationSlots > 0 && leagues.some((x) => x.nation === l.nation && x.tier === 2))
        .map((l) => byRep(l.participants)[0]));
    case 'promotion':
      return byRep(leagues.filter((l) => l.tier === 2).flatMap((l) => l.participants));
    case 'cup':
      return byRep(leagues.filter((l) => l.tier === 1).flatMap((l) => byRep(l.participants).slice(0, Math.max(0, l.participants.length - 4))));
    case 'champions':
      return [...world.clubs].filter((c) => c.tier === 1 && c.players.length > 0).sort((a, b) => b.reputation - a.reputation).map((c) => c.id);
  }
}

/** Begin a challenge at the club the manager has just taken charge of. */
export function startChallenge(world: World, id: ChallengeId, clubId: number): void {
  const def = CHALLENGES.find((c) => c.id === id)!;
  world.challenge = { id, clubId, startSeason: world.season, lastSeason: world.season + def.seasons - 1, status: 'on' };
  const club = world.clubs[clubId];
  postMessage(world, {
    category: 'career', from: 'Challenge', clubId,
    subject: `Challenge: ${def.name}`,
    body: `${def.goal}. You have ${def.seasons === 1 ? 'this season' : `${def.seasons} seasons`} with ${club?.name ?? 'your club'}. Good luck.`,
  });
}

/** Done yet? The trophy, the division — whatever the goal is. */
function achieved(world: World, ch: Challenge): boolean {
  const club = world.clubs[ch.clubId];
  if (club === undefined) return false;
  const won = (kind: (key: string, k: string) => boolean): boolean => world.career.jobs
    .filter((j) => j.clubId === ch.clubId)
    .some((j) => j.trophies.some((t) => {
      const comp = world.competitions[t.competitionId];
      return comp !== undefined && t.season >= ch.startSeason && kind(comp.key ?? '', comp.kind);
    }));
  switch (ch.id) {
    case 'survival': return club.tier === 1;
    case 'promotion': return club.tier === 1;
    case 'cup': return won((_, k) => k === 'cup');
    case 'champions': return won((key, k) => k === 'continental' && key.endsWith(':1'));
  }
}

/** At the season's end: the challenge won, lost, or still on. `ended` is the season just finished. */
export function challengeSeasonEnd(world: World, ended: number): void {
  const ch = world.challenge;
  if (ch === undefined || ch.status !== 'on') return;
  const def = CHALLENGES.find((c) => c.id === ch.id)!;
  const club = world.clubs[ch.clubId];
  if (world.userClubId !== ch.clubId) {
    ch.status = 'lost';
  } else if (achieved(world, ch) && (ch.id !== 'survival' || ended >= ch.lastSeason)) {
    ch.status = 'won';
  } else if (ended >= ch.lastSeason) {
    ch.status = 'lost';
  }
  if (ch.status === 'on') return;
  postMessage(world, {
    category: 'career', from: 'Challenge', clubId: ch.clubId,
    subject: ch.status === 'won' ? `Challenge complete: ${def.name}` : `Challenge failed: ${def.name}`,
    body: ch.status === 'won'
      ? `You did it — ${def.goal.charAt(0).toLowerCase()}${def.goal.slice(1)}, with ${club?.name}. The career goes on, if you want it to.`
      : world.userClubId !== ch.clubId
        ? `You left ${club?.name ?? 'the club'} before the job was done. The career goes on.`
        : `Time is up: ${def.goal.charAt(0).toLowerCase()}${def.goal.slice(1)} was a step too far this time. The career goes on.`,
  });
}
