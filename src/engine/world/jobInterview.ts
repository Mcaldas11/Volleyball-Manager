/**
 * The job interview. Apply for a head coach's job and the board sits down with you first: what you
 * think the club can achieve, how you would work with the money there is, how you want the team to
 * play. Each board wants something of its own — a big club a title, a small one survival and sense;
 * a rich club ambition, a poor one prudence; and the club's own principles — and how near your answers
 * come to it moves its decision one way or the other, on top of what your name is worth to it.
 */

import type { Club } from '../model/club.ts';
import { philosophyOf, type PhilosophyKind } from './board.ts';
import type { World } from './world.ts';

export type InterviewTopic = 'objective' | 'budget' | 'style';

export interface InterviewAnswer {
  id: string;
  text: string;
}

export interface InterviewQuestion {
  topic: InterviewTopic;
  ask: string;
  answers: InterviewAnswer[];
}

/** How the board takes an answer: -1 not at all, 1 exactly what it wanted to hear. */
export interface InterviewReaction {
  score: number;
  line: string;
}

/** Where the club's board expects to finish, as a share down the table: 0 the title, 1 the bottom. */
function ambition(world: World, club: Club): number {
  const league = world.competitions[club.leagueId];
  const n = Math.max(2, league?.participants.length ?? 12);
  return Math.min(1, Math.max(0, ((club.boardExpectation ?? Math.ceil(n / 2)) - 1) / (n - 1)));
}

/** A club with money to spend, against its own league. */
function wealthy(world: World, club: Club): boolean {
  const league = world.competitions[club.leagueId];
  const others = (league?.participants ?? []).map((id) => world.clubs[id]).filter((c) => c !== undefined);
  if (others.length === 0) return false;
  const median = [...others].sort((a, b) => a.finances.wageBudget - b.finances.wageBudget)[Math.floor(others.length / 2)];
  return club.finances.wageBudget > median.finances.wageBudget * 1.15;
}

export function interviewQuestions(club: Club): InterviewQuestion[] {
  return [
    {
      topic: 'objective',
      ask: `What do you think ${club.name} can achieve next season?`,
      answers: [
        { id: 'title', text: 'Win the league. I only work to win titles.' },
        { id: 'top', text: 'Push for the top places and a place in Europe.' },
        { id: 'mid', text: 'A solid season in the top half, and build from there.' },
        { id: 'survive', text: 'Stay up first. Then we grow.' },
      ],
    },
    {
      topic: 'budget',
      ask: 'How would you work with the budget we have?',
      answers: [
        { id: 'invest', text: 'I need investment — the right signings will pay for themselves.' },
        { id: 'within', text: 'I work within what the board gives me. Every euro counts.' },
        { id: 'sell', text: 'Sell well, buy smart: the squad pays for its own improvement.' },
      ],
    },
    {
      topic: 'style',
      ask: 'How do you want the team to play?',
      answers: [
        { id: 'attack', text: 'Fast and aggressive: a quick tempo, everyone attacking.' },
        { id: 'serve', text: 'From the service line: put them under pressure every rally.' },
        { id: 'youth', text: 'Brave with young players: give the academy its chance.' },
        { id: 'solid', text: 'Organised and hard to beat: block, defence, few errors.' },
      ],
    },
  ];
}

/** How the board takes one answer. */
export function interviewReaction(world: World, club: Club, topic: InterviewTopic, answer: string): InterviewReaction {
  if (topic === 'objective') {
    const a = ambition(world, club);
    const target = { title: 0, top: 0.2, mid: 0.45, survive: 0.85 }[answer] ?? 0.5;
    const gap = Math.abs(target - a);
    if (gap < 0.17) return { score: 1, line: 'The chairman nods — that is exactly the season the board has in mind.' };
    if (target < a) {
      return gap > 0.45
        ? { score: -1, line: 'Glances round the table. The board thinks you are promising what this squad cannot deliver.' }
        : { score: 0, line: 'Ambitious. The board likes the hunger, if not quite the realism.' };
    }
    return gap > 0.4
      ? { score: -1, line: 'The sporting director frowns: this club expects far more than that.' }
      : { score: -0.3, line: 'A cautious answer. The board was hoping for a little more ambition.' };
  }
  if (topic === 'budget') {
    const rich = wealthy(world, club);
    const prudent = philosophyOf(world, club).kinds.includes('prudence');
    if (answer === 'invest') {
      return rich && !prudent
        ? { score: 1, line: 'The owner smiles. There is money to spend, and he wants someone who will spend it well.' }
        : { score: -1, line: 'An awkward silence. There is no money for that here.' };
    }
    if (answer === 'within') {
      return prudent || !rich
        ? { score: 1, line: 'Music to the finance director\'s ears.' }
        : { score: 0.2, line: 'Sensible — though the board would back a bolder plan.' };
    }
    return rich ? { score: 0.2, line: 'Smart business. The board can live with that.' } : { score: 0.8, line: 'The board likes that very much: a club like this has to trade well.' };
  }
  const principles = philosophyOf(world, club).kinds;
  const wants: Record<string, PhilosophyKind[]> = { attack: ['attack'], serve: ['serve'], youth: ['youth', 'homegrown'], solid: ['prudence'] };
  const match = (wants[answer] ?? []).some((k) => principles.includes(k));
  return match
    ? { score: 1, line: 'That is this club\'s way. The board is visibly pleased.' }
    : { score: 0, line: 'The board listens politely. It is not quite how this club sees itself.' };
}

/** What the whole interview does to the board's decision: added to the chance of being offered the job. */
export function interviewEffect(reactions: readonly InterviewReaction[]): number {
  const total = reactions.reduce((s, r) => s + r.score, 0);
  return Math.max(-0.35, Math.min(0.3, total * 0.1));
}

/** The board's verdict, in a line, from how the interview went. */
export function interviewVerdict(effect: number): string {
  if (effect >= 0.2) return 'The interview went very well — the board was impressed.';
  if (effect >= 0.05) return 'The interview went well.';
  if (effect > -0.1) return 'A mixed interview. Your name will have to do the rest.';
  return 'The interview went badly. You will need your reputation to carry you.';
}
