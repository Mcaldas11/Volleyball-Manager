/**
 * The board room: the club's philosophy, and the manager's meetings with the board.
 *
 * Every club stands for something beyond its results, and its board say what
 * at the start of each season: two principles, from who owns it — the members
 * want their young players given a chance and the books balanced, a local
 * owner a team built round the country's own, a tycoon volleyball worth the
 * ticket, investors money well spent. They follow how the side lives up to
 * them as the season goes, and at its end each one kept is a point in the
 * manager's favour, each one ignored a mark against him.
 *
 * And the manager can ask for a meeting — once every six weeks or so — to put
 * a case to them: more money for wages, or a target he can actually reach.
 * They answer on the spot, from their confidence in him and the state of the
 * books; asking them to expect less never comes free.
 */

import type { Club } from '../model/club.ts';
import { reportResult } from './matchReports.ts';
import { postMessage } from './inbox.ts';
import { wageBill } from './loans.ts';
import { ownerOf } from './owners.ts';
import { paperStrength } from './predictions.ts';
import { DAYS_PER_SEASON, dayOfSeason, euros, type World } from './world.ts';

export type PhilosophyKind = 'youth' | 'homegrown' | 'attack' | 'serve' | 'prudence';

export const PHILOSOPHY_TEXT: Readonly<Record<PhilosophyKind, { title: string; aim: string }>> = {
  youth: { title: 'Give young players their chance', aim: 'Players of 21 or under on court in 20 or more competitive appearances' },
  homegrown: { title: "Build round the country's own", aim: 'Over half the rallies played by players from our country' },
  attack: { title: 'Play attacking volleyball', aim: 'An attack efficiency of 30% or better over the season' },
  serve: { title: 'Go after them from the service line', aim: 'More than one ace a set over the season' },
  prudence: { title: 'Live within our means', aim: 'A wage bill within the wage budget' },
};

export interface Philosophy {
  season: number;
  kinds: PhilosophyKind[];
  judged?: boolean;
}

/** Days between meetings with the board. */
export const MEETING_GAP = 42;

const KEPT = 4;
const IGNORED = 3;

/** The two principles a club's owner stands for. */
function principlesFor(world: World, club: Club): PhilosophyKind[] {
  const o = ownerOf(world, club);
  switch (o.kind) {
    case 'members': return ['youth', 'prudence'];
    case 'local': return ['homegrown', o.ambition >= 3 ? 'attack' : 'youth'];
    case 'tycoon': return ['attack', 'serve'];
    case 'consortium': return ['prudence', o.ambition >= 3 ? 'attack' : 'youth'];
  }
}

/** The club's philosophy this season — set the first time anyone asks, and told to the manager. */
export function philosophyOf(world: World, club: Club): Philosophy {
  if (club.philosophy === undefined || club.philosophy.season !== world.season) {
    club.philosophy = { season: world.season, kinds: principlesFor(world, club) };
    if (club.id === world.userClubId) {
      postMessage(world, {
        category: 'board', from: 'The Board',
        subject: 'What this club stands for',
        body: `Beyond results, the board will judge the season on two things: ` +
          club.philosophy.kinds.map((k) => `${PHILOSOPHY_TEXT[k].title.toLowerCase()} (${PHILOSOPHY_TEXT[k].aim.toLowerCase()})`).join('; and ') +
          '. Keep to them and it will count in your favour.',
      });
    }
  }
  return club.philosophy;
}

/** How the club is living up to one principle this season: done or not, and the numbers. */
export function principleProgress(world: World, club: Club, kind: PhilosophyKind): { done: boolean; text: string; share: number } {
  const store = world.players;
  if (kind === 'prudence') {
    const bill = wageBill(world, club);
    const budget = club.finances.wageBudget;
    return { done: bill <= budget, text: `${euros(bill)} of ${euros(budget)}`, share: Math.min(1, budget / Math.max(1, bill)) };
  }
  // The season's competitive matches, from the box scores kept of them.
  const start = world.day - dayOfSeason(world);
  let young = 0;
  let rallies = 0;
  let ownRallies = 0;
  let kills = 0;
  let errs = 0;
  let attacks = 0;
  let aces = 0;
  let sets = 0;
  for (const [id, report] of world.matchReports ?? []) {
    const f = world.fixtures[id];
    if (f === undefined || f.day < start || f.day >= start + DAYS_PER_SEASON || (f.home !== club.id && f.away !== club.id)) continue;
    const kind = world.competitions[f.competitionId]?.kind;
    if (kind === 'friendly' || kind === 'international') continue;
    const side = f.home === club.id ? 'home' : 'away';
    const team = reportResult(f, report).stats[side];
    sets += f.setScores.length;
    for (const [p, s] of team.players) {
      if (s.ralliesPlayed <= 0) continue;
      if (store.ageOn(p, world.year, 181) <= 21) young++;
      rallies += s.ralliesPlayed;
      if (store.nation[p] === club.nation) ownRallies += s.ralliesPlayed;
      kills += s.attackKills;
      errs += s.attackErrors + s.attackBlocked;
      attacks += s.attacksTotal;
      aces += s.serveAces;
    }
  }
  switch (kind) {
    case 'youth':
      return { done: young >= 20, text: `${young} appearances of 20`, share: Math.min(1, young / 20) };
    case 'homegrown': {
      const pct = rallies > 0 ? ownRallies / rallies : 0;
      return { done: pct > 0.5, text: `${Math.round(pct * 100)}% of the rallies`, share: Math.min(1, pct / 0.5) };
    }
    case 'attack': {
      const eff = attacks > 0 ? (kills - errs) / attacks : 0;
      return { done: attacks > 0 && eff >= 0.3, text: attacks > 0 ? `${Math.round(eff * 100)}% efficiency` : 'No matches yet', share: Math.max(0, Math.min(1, eff / 0.3)) };
    }
    case 'serve': {
      const perSet = sets > 0 ? aces / sets : 0;
      return { done: sets > 0 && perSet > 1, text: sets > 0 ? `${perSet.toFixed(2)} aces a set` : 'No matches yet', share: Math.min(1, perSet) };
    }
  }
}

/** The season over: the board weigh the season against what the club stands for. */
export function judgePhilosophy(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const p = club?.philosophy;
  if (club === undefined || p === undefined || p.season !== world.season || p.judged === true) return;
  p.judged = true;
  const lines: string[] = [];
  let delta = 0;
  for (const k of p.kinds) {
    const { done, text } = principleProgress(world, club, k);
    delta += done ? KEPT : -IGNORED;
    lines.push(`${PHILOSOPHY_TEXT[k].title}: ${done ? 'kept' : 'not kept'} (${text}).`);
  }
  club.boardConfidence = Math.max(0, Math.min(100, club.boardConfidence + delta));
  postMessage(world, {
    category: 'board', from: 'The Board',
    subject: delta > 0 ? 'The board: true to the club' : delta < 0 ? 'The board: not the club we are' : 'The board on the season',
    body: `${lines.join(' ')} ${delta > 0 ? 'That counts in your favour.' : delta < 0 ? 'That counts against you.' : 'One kept, one not.'}`,
  });
}

// ---- Meetings ----------------------------------------------------------------------------

/** Why the board won't meet now — or null if they will. */
export function meetingBlock(world: World, club: Club): string | null {
  const last = club.boardMeeting?.last;
  if (last !== undefined && world.day - last < MEETING_GAP) {
    return `The board met you only recently — they will see you again in ${MEETING_GAP - (world.day - last)} days.`;
  }
  return null;
}

/** The board's answer to a request for more wages: granted from confidence and the books, or not. */
export function requestWages(world: World, club: Club): string {
  const block = meetingBlock(world, club);
  if (block !== null) return block;
  club.boardMeeting = { last: world.day };
  const f = club.finances;
  const o = ownerOf(world, club);
  let answer: string;
  if (club.boardConfidence < 50) {
    answer = 'The board turned you down: they want to see results before they put more money in.';
  } else if (f.balance < f.wageBudget * 0.15) {
    answer = 'The board turned you down: the books will not stand it this season.';
  } else {
    const raise = Math.round((f.wageBudget * (0.05 + 0.015 * o.wealth)) / 5000) * 5000;
    f.wageBudget += raise;
    answer = `The board agreed: the wage budget goes up by ${euros(raise)} a season, to ${euros(f.wageBudget)}.`;
  }
  postMessage(world, { category: 'board', from: 'The Board', subject: 'Board meeting: the wage budget', body: answer });
  return answer;
}

/** Where the squad stands in its league on paper, from 1. */
export function paperRank(world: World, club: Club): number {
  const league = world.competitions[club.leagueId];
  if (league === undefined) return 1;
  const mine = paperStrength(world, club.players);
  return 1 + league.participants.filter((id) => id !== club.id && paperStrength(world, world.clubs[id]?.players ?? []) > mine).length;
}

/** The board's answer to a request for a lower target: only if the squad really isn't up to it — and never free. */
export function requestLowerTarget(world: World, club: Club): string {
  const block = meetingBlock(world, club);
  if (block !== null) return block;
  club.boardMeeting = { last: world.day };
  const rank = paperRank(world, club);
  const target = club.boardExpectation;
  let answer: string;
  if (club.boardConfidence < 35) {
    answer = 'The board would not hear of it: with things as they are, lowering the bar looks like an excuse.';
  } else if (rank <= target + 1) {
    answer = `The board said no: on paper this squad is ${rank === 1 ? 'the strongest' : `the ${rank}${rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} strongest`} in the league, and ${target === 1 ? 'first' : `${target}th`} is within its reach.`;
  } else {
    const now = Math.min(rank, target + 2);
    club.boardExpectation = now;
    club.boardConfidence = Math.max(0, club.boardConfidence - 4);
    answer = `The board agreed, reluctantly: the target is now ${now}th or better. They will not forget that you asked.`;
  }
  postMessage(world, { category: 'board', from: 'The Board', subject: 'Board meeting: the season target', body: answer });
  return answer;
}
