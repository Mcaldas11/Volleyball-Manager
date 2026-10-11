/**
 * Team talks: the manager's words to his players before a match and at each
 * set break.
 *
 * What lands depends on the moment — telling favourites you expect a win is
 * one thing, telling underdogs another; praise after a set won, a rocket after
 * one thrown away — and on the man: a nervous one wants calming, a proud one
 * bristles at criticism, a fiery one wants the fire. Each player reacts in his
 * own way, and the room's leaders count for more in how the side as a whole
 * takes it. The same words again lose their edge.
 *
 * A talk that lands lifts the side a few per cent for the match, or the set
 * to come; one that misses costs it. Before a match it moves the players'
 * morale a little too.
 */

import { Rng } from '../core/rng.ts';
import type { Club } from '../model/club.ts';
import { dressingRoom } from './dressingRoom.ts';
import type { World } from './world.ts';

export type TalkMoment = 'prematch' | 'setbreak';
export type TalkTone = 'calm' | 'believe' | 'demand' | 'praise' | 'criticise' | 'passion';

export const TALK_OPTIONS: Readonly<Record<TalkMoment, readonly TalkTone[]>> = {
  prematch: ['calm', 'believe', 'demand', 'passion'],
  setbreak: ['praise', 'calm', 'demand', 'criticise', 'passion'],
};

export const TALK_LINES: Readonly<Record<TalkTone, string>> = {
  calm: 'Stay calm — play our game',
  believe: 'You can beat anyone',
  demand: 'I expect a win',
  praise: 'Well done — keep it going',
  criticise: 'That wasn’t good enough',
  passion: 'Show me some fire',
};

/** The situation a talk is given in. */
export interface TalkContext {
  moment: TalkMoment;
  /** How strong a favourite the side is, -1 (a big underdog) to 1 (a big favourite). */
  favourite: number;
  setsFor: number;
  setsAgainst: number;
  /** At a set break: the set just played — won or lost, and by how much. */
  lastSet?: { won: boolean; margin: number };
  /** 0-1: a friendly to a final. */
  importance: number;
}

export type ReactionLabel = 'Fired up' | 'Focused' | 'Unmoved' | 'Nervous' | 'Annoyed';

export interface TalkReaction {
  p: number;
  /** -1 to 1. */
  score: number;
  label: ReactionLabel;
}

export interface TalkResult {
  reactions: TalkReaction[];
  /** The side's take on it, -1 to 1, the leaders weighing most. */
  team: number;
  /** What it is worth on court: a multiplier on the side's play. */
  multiplier: number;
  /** A line for the manager: how it went down. */
  summary: string;
}

/** What the best talk is worth on court, either way — before a match, and for a set. */
const MATCH_TALK = 0.03;
const SET_TALK = 0.04;
/** Morale a talk can move before a match. */
const TALK_MORALE = 5;
/** The same words again: this much of their effect. */
const STALE = 0.55;

/** How well the words suit the moment, -1 to 1, before the man hearing them. */
function fit(tone: TalkTone, c: TalkContext): number {
  const behind = c.setsAgainst > c.setsFor;
  const decider = c.setsFor === c.setsAgainst && c.setsFor >= 2;
  const lost = c.lastSet !== undefined && !c.lastSet.won;
  const heavy = c.lastSet !== undefined && c.lastSet.margin >= 6;
  switch (tone) {
    case 'calm': return 0.15 + c.importance * 0.25 + (behind ? 0.2 : 0) + (decider ? 0.25 : 0) - (c.favourite > 0.5 && !behind ? 0.2 : 0);
    case 'believe': return 0.1 - c.favourite * 0.55 + (lost ? 0.15 : 0);
    case 'demand': return c.favourite * 0.55 + (behind && c.favourite > 0 ? 0.15 : 0) - (c.favourite < -0.3 ? 0.35 : 0);
    case 'praise': return c.lastSet === undefined ? 0 : c.lastSet.won ? 0.35 : -0.3;
    case 'criticise': return c.lastSet === undefined ? -0.2 : c.lastSet.won ? -0.5 : heavy ? 0.35 : 0.05;
    case 'passion': return 0.15 + (decider ? 0.25 : 0) + (lost ? 0.1 : 0);
  }
}

/** How the man hearing them takes the words: his temperament, his nerve, his pride. */
function personal(world: World, p: number, tone: TalkTone): number {
  const store = world.players;
  const a = (name: Parameters<typeof store.getAttr>[1]): number => (store.getAttr(p, name) - 10) / 10;
  switch (tone) {
    case 'calm': return -a('pressureHandling') * 0.25 - a('composure') * 0.1;
    case 'believe': return -a('confidence') * 0.25 + a('determination') * 0.1;
    case 'demand': return a('pressureHandling') * 0.25 + a('determination') * 0.15;
    case 'praise': return a('professionalism') * 0.05 - a('confidence') * 0.1;
    case 'criticise': return a('professionalism') * 0.3 + a('temperament') * 0.2;
    case 'passion': return a('aggression') * 0.25 + a('determination') * 0.1;
  }
}

function labelOf(score: number, tone: TalkTone): ReactionLabel {
  if (score >= 0.4) return 'Fired up';
  if (score >= 0.1) return 'Focused';
  if (score > -0.15) return 'Unmoved';
  return tone === 'criticise' || tone === 'demand' ? 'Annoyed' : 'Nervous';
}

/**
 * Give a talk: how each player takes it, and the side as a whole. `repeat` is
 * the same words as last time; `salt` keeps one talk's dice apart from the next.
 */
export function giveTalk(
  world: World, club: Club, players: readonly number[], tone: TalkTone, c: TalkContext, repeat: boolean, salt: number,
): TalkResult {
  const rng = new Rng((world.seed ^ Math.imul(world.day + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  const room = dressingRoom(world, club);
  const weight = new Map(room.members.map((m) => [m.p, m.tier === 'leader' ? 3 : m.tier === 'influential' ? 2 : 1]));
  const base = fit(tone, c) * (repeat ? STALE : 1);
  const reactions = players.map((p) => {
    const score = Math.max(-1, Math.min(1, base + personal(world, p, tone) + rng.gaussian(0, 0.12)));
    return { p, score, label: labelOf(score, tone) };
  });
  let sum = 0;
  let total = 0;
  for (const r of reactions) {
    const w = weight.get(r.p) ?? 1;
    sum += r.score * w;
    total += w;
  }
  const team = total > 0 ? sum / total : 0;
  const multiplier = 1 + team * (c.moment === 'prematch' ? MATCH_TALK : SET_TALK);
  const summary = team >= 0.35 ? 'The players are fired up.'
    : team >= 0.1 ? 'The message has gone down well.'
      : team > -0.1 ? 'The players seem unmoved.'
        : 'That has gone down badly.';
  return { reactions, team, multiplier, summary };
}

/** Before a match the words stay with the players a while: their morale moves with how they took them. */
export function applyTalkMorale(world: World, result: TalkResult): void {
  const store = world.players;
  for (const r of result.reactions) store.morale[r.p] = Math.max(0, Math.min(100, store.morale[r.p] + r.score * TALK_MORALE));
}

/** How strong a favourite a side is, -1 to 1, from the two sides' best six. */
export function favouriteness(ownStrength: number, theirStrength: number): number {
  return Math.max(-1, Math.min(1, (ownStrength - theirStrength) / 250));
}
