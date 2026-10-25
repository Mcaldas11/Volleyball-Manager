/**
 * Mind games. Before a big match — a derby or a classic, a final, a meeting of two sides near the top
 * of the table — the other side's coach has something to say about the manager's team, two days out.
 * The manager can fire back, play it down or praise them, in the press. Firing back lifts his own
 * dressing room — and his words are remembered: win, and he is the man who called it, the board and
 * the players behind him; lose, and they come back to haunt him. A quiet answer risks nothing.
 */

import { trophyAtStake } from '../season/cups.ts';
import { headCoachOf } from './career.ts';
import { postMessage } from './inbox.ts';
import { postNews } from './news.ts';
import { hash01 } from './offerStance.ts';
import { fixtureRivalry } from './rivals.ts';
import type { Fixture, World } from './world.ts';

export type MindGameReply = 'fire' | 'calm' | 'praise';

export const MIND_GAME_REPLIES: ReadonlyArray<{ id: MindGameReply; name: string; line: string; hint: string }> = [
  { id: 'fire', name: 'Fire back', line: 'Let them talk. We will do our talking on the court — and they won’t like what they hear.', hint: 'Lifts your players — win, and the board loves it; lose, and it haunts you' },
  { id: 'calm', name: 'Play it down', line: 'Every coach has his opinion. We focus on ourselves.', hint: 'A calm room, and nothing to lose' },
  { id: 'praise', name: 'Praise them', line: 'They are a very good side and he is a very good coach. It will be a great match.', hint: 'Takes the heat out of it' },
];

export interface MindGame {
  fixtureId: number;
  clubId: number;
  coach: string;
  said: string;
  reply?: MindGameReply;
  /** Its consequences once the match is played: dealt with. */
  settled?: boolean;
}

/** What makes a match one to talk up: why, in a few words — or null. */
function bigMatch(world: World, f: Fixture): string | null {
  const rivalry = fixtureRivalry(world, f);
  if (rivalry !== null) return rivalry === 'derby' ? 'derby' : 'classic';
  if (trophyAtStake(world, f) !== null) return 'final';
  const comp = world.competitions[f.competitionId];
  if (comp?.kind !== 'league') return null;
  const order = [...comp.table].sort((a, b) => b.points - a.points || b.setsFor - a.setsFor).map((r) => r.clubId);
  const a = order.indexOf(f.home);
  const b = order.indexOf(f.away);
  const played = comp.table.find((r) => r.clubId === f.home)?.played ?? 0;
  return played >= 4 && a >= 0 && b >= 0 && a < 4 && b < 4 ? 'top' : null;
}

const SAYINGS: Readonly<Record<string, readonly string[]>> = {
  derby: [
    'This city has only one real club, and on {day} everyone will see which one it is.',
    'They have been living off their history for years. We are the present.',
  ],
  classic: [
    '{them} are not the force they think they are. Their big names are getting old.',
    'Everybody says {them} are favourites. I think they are scared of us.',
  ],
  final: [
    'Finals are about nerve. I am not sure {them} have it.',
    '{them} have been lucky to get this far. Luck runs out in a final.',
  ],
  top: [
    'They have had an easy run of fixtures. Now they meet a real team.',
    '{them} at the top? We will see how long that lasts after {day}.',
  ],
};

/** Every day: two days before a big match of the manager's, the other coach has his say. */
export function mindGamesDay(world: World): void {
  const clubId = world.userClubId;
  const user = world.clubs[clubId];
  const games = (world.mindGames ??= []);
  if (user !== undefined) {
    for (const f of world.fixtures) {
      if (f.played || f.day - world.day !== 2 || (f.home !== clubId && f.away !== clubId)) continue;
      if (games.some((g) => g.fixtureId === f.id)) continue;
      const why = bigMatch(world, f);
      if (why === null) continue;
      const oppId = f.home === clubId ? f.away : f.home;
      const opp = world.clubs[oppId];
      const coach = opp !== undefined ? headCoachOf(world, opp) : undefined;
      if (opp === undefined || coach === undefined) continue;
      // Not every coach plays these games.
      if (hash01(f.id, coach.id) < 0.25) continue;
      const lines = SAYINGS[why];
      const said = lines[Math.floor(hash01(f.id, 7) * lines.length)]
        .replace('{them}', user.name).replace('{day}', why === 'final' ? 'the final' : 'matchday');
      const name = `${coach.firstName} ${coach.lastName}`;
      games.push({ fixtureId: f.id, clubId: oppId, coach: name, said });
      postMessage(world, {
        category: 'interview', from: 'Press Office', clubId: oppId, mindGameOf: f.id,
        subject: `${name} has his say before the ${why === 'top' ? 'top-of-the-table clash' : why}`,
        body: `${opp.name}'s coach ${name} told the press today: "${said}"\n\nThe journalists want your reply.`,
      });
      postNews(world, {
        kind: 'press', headline: `${name}: "${said.split('.')[0]}."`, body: `${opp.name}'s coach ${name} turns up the heat before meeting ${user.name}.`,
        nation: opp.nation, clubId: oppId, otherClubId: clubId, staffId: coach.id, competitionId: f.competitionId,
        fans: { story: 'pressBold', club: oppId, other: clubId, coach: name },
      });
    }
  }
  // Played: what the words led to.
  for (const g of games) {
    if (g.settled === true) continue;
    const f = world.fixtures[g.fixtureId];
    if (f === undefined || !f.played) continue;
    g.settled = true;
    if (g.reply !== 'fire' || user === undefined || (f.home !== clubId && f.away !== clubId)) continue;
    const won = (f.home === clubId) === (f.homeSets > f.awaySets);
    const store = world.players;
    for (const p of user.players) store.morale[p] = Math.max(0, Math.min(100, store.morale[p] + (won ? 4 : -3)));
    user.boardConfidence = Math.max(0, Math.min(100, user.boardConfidence + (won ? 3 : -3)));
    postMessage(world, {
      category: 'board', from: `${user.name} Board`,
      subject: won ? 'Your words, backed up on the court' : 'Your words came back to haunt you',
      body: won
        ? `You fired back at ${g.coach} — and your team backed you up. The dressing room and the board loved it.`
        : `You fired back at ${g.coach}, and then lost. The press are enjoying it; the board and the players are not.`,
    });
  }
}

/** The manager's answer to what was said. */
export function answerMindGame(world: World, fixtureId: number, reply: MindGameReply): string {
  const g = world.mindGames?.find((x) => x.fixtureId === fixtureId);
  const user = world.clubs[world.userClubId];
  if (g === undefined || g.reply !== undefined || user === undefined) return 'That has been answered.';
  g.reply = reply;
  const store = world.players;
  const lift = reply === 'fire' ? 3 : reply === 'calm' ? 1 : 0;
  for (const p of user.players) store.morale[p] = Math.min(100, store.morale[p] + lift);
  const said = MIND_GAME_REPLIES.find((r) => r.id === reply)!.line;
  const manager = `${world.manager.firstName} ${world.manager.lastName}`;
  postNews(world, {
    kind: 'press',
    headline: reply === 'fire' ? `${manager} hits back at ${g.coach}` : reply === 'praise' ? `${manager} full of praise for ${g.coach}'s side` : `${manager} refuses to be drawn`,
    body: `"${said}"`, nation: user.nation, clubId: user.id, otherClubId: g.clubId,
    fans: { story: reply === 'fire' ? 'pressBold' : 'press', club: user.id, other: g.clubId, coach: manager },
  });
  return reply === 'fire'
    ? 'Your reply is all over the papers. The players love it — now you have to back it up.'
    : reply === 'calm' ? 'You kept it calm. The dressing room stays focused.' : 'You took the heat out of it.';
}

export function mindGameFor(world: World, fixtureId: number): MindGame | undefined {
  return world.mindGames?.find((g) => g.fixtureId === fixtureId);
}
