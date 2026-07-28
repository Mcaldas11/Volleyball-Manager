/**
 * Scouting.
 *
 * The user must never see a player's true attributes for someone they have not
 * scouted. What they see instead is a *range*, and the range narrows as the
 * club's scouts accumulate knowledge — through matches watched, and through
 * how well the assigned scout knows the country the player plays in.
 *
 * This is what makes recruitment a judgement call. A scout with 19 Judging
 * Ability and deep knowledge of Brazil will tell you a Brazilian middle blocks
 * "15-16" after ten matches. The same scout will tell you an Iranian prospect
 * blocks "11-18", which is not useful, and signing on that basis is a gamble.
 * Potential is deliberately vaguer than current ability, because estimating
 * how good someone will *become* is genuinely harder than seeing how good they
 * are now.
 */

import { hashString } from '../core/rng.ts';
import {
  ATTRIBUTES, HIDDEN_ATTR_SET, type AttributeName,
} from '../model/attributes.ts';
import { knowledgeOf, StaffRole, staffRating, type Staff } from '../model/staff.ts';
import { NATIONS } from './nations.ts';
import type { World } from './world.ts';

/** How thoroughly a club has scouted a given player. */
export interface ScoutingKnowledge {
  /** 0-1. Zero is a name on a list; one is complete certainty. */
  confidence: number;
  matchesWatched: number;
}

export interface AttributeEstimate {
  attribute: AttributeName;
  /** Lower and upper bound of the estimate, on the 1-20 scale. */
  low: number;
  high: number;
  /** True once the estimate has collapsed to a single value. */
  exact: boolean;
}

export interface ScoutReport {
  player: number;
  confidence: number;
  matchesWatched: number;
  /** Prose summary shown before any numbers are available at all. */
  summary: string[];
  attributes: AttributeEstimate[];
  /** Estimated current ability range, 0-2000. */
  abilityLow: number;
  abilityHigh: number;
  /** Estimated potential range. Always wider than current ability. */
  potentialLow: number;
  potentialHigh: number;
  /** Which scout produced this, for the UI. */
  scoutName: string | null;
}

/**
 * How many "matches watched" worth of knowledge the user's club has of a
 * player, combining any scouting work actually done with a baseline from the
 * player's public reputation — a famous international is already partly
 * known without any dedicated scouting, an obscure squad player is not.
 */
export function totalMatchesWatched(world: World, playerIdx: number): number {
  const famous = Math.round((world.players.reputation[playerIdx] / 10000) * 20);
  const scouted = world.scoutingKnowledge.get(playerIdx)?.matchesWatched ?? 0;
  return famous + scouted;
}

/**
 * Combined scouting quality a club can bring to bear on a given player:
 * the best available scout's judgement, weighted by how well they know where
 * the player is from.
 */
export function scoutingQualityFor(
  world: World,
  clubId: number,
  playerIdx: number,
): { quality: number; scout: Staff | null } {
  const club = world.clubs[clubId];
  if (club === undefined) return { quality: 0.25, scout: null };

  const nation = world.players.nation[playerIdx];
  const conf = NATIONS[nation]?.confederation ?? 'CEV';

  let best = 0.25;
  let bestScout: Staff | null = null;
  for (const sid of club.staff) {
    const s = world.staff[sid];
    if (s === undefined) continue;
    if (s.role !== StaffRole.Scout && s.role !== StaffRole.HeadScout &&
        s.role !== StaffRole.RecruitmentAnalyst) continue;

    const judgement = staffRating(s) / 20;
    const knowledge = knowledgeOf(s, nation, conf) / 20;
    // Knowing the region matters as much as raw judgement — a brilliant scout
    // in the wrong country is still guessing.
    const quality = judgement * 0.55 + knowledge * 0.45;
    if (quality > best) {
      best = quality;
      bestScout = s;
    }
  }
  return { quality: best, scout: bestScout };
}

/**
 * Build a scout report.
 *
 * `matchesWatched` drives how far the report has progressed: a fresh name
 * yields prose only, ten matches yields ranges, fifty yields near-exact
 * numbers for a good scout.
 */
export function buildScoutReport(
  world: World,
  clubId: number,
  playerIdx: number,
  knowledge: ScoutingKnowledge,
): ScoutReport {
  const store = world.players;
  const { quality, scout } = scoutingQualityFor(world, clubId, playerIdx);

  // Observation saturates: the first ten matches teach far more than the
  // fiftieth does.
  const observation = 1 - Math.exp(-knowledge.matchesWatched / 18);
  const confidence = Math.min(0.98, observation * (0.45 + quality * 0.62));

  // Uncertainty in attribute points. Even perfect scouting leaves a little.
  const spread = (1 - confidence) * 9;

  const attributes: AttributeEstimate[] = [];
  for (const attr of ATTRIBUTES) {
    // Hidden attributes are never estimated numerically, only hinted at in prose.
    if (HIDDEN_ATTR_SET.has(attr)) continue;
    const trueValue = store.getAttr(playerIdx, attr);
    // The error is deterministic per player and attribute, so the same report
    // does not jitter every time the user opens it.
    const jitter = stableNoise(store.id[playerIdx], attr);
    const centre = trueValue + jitter * spread * 0.5;
    const low = Math.max(1, Math.round(centre - spread / 2));
    const high = Math.min(20, Math.round(centre + spread / 2));
    attributes.push({ attribute: attr, low, high: Math.max(low, high), exact: high === low });
  }

  const ca = store.currentAbility[playerIdx];
  const pa = store.potentialAbility[playerIdx];
  const caSpread = (1 - confidence) * 520;
  // Potential is harder to judge than current ability, so its band is wider
  // and closes more slowly.
  const paSpread = (1 - confidence * 0.72) * 780;

  return {
    player: playerIdx,
    confidence,
    matchesWatched: knowledge.matchesWatched,
    summary: prose(world, playerIdx, confidence),
    attributes,
    abilityLow: Math.max(0, Math.round(ca - caSpread / 2)),
    abilityHigh: Math.min(2000, Math.round(ca + caSpread / 2)),
    potentialLow: Math.max(0, Math.round(pa - paSpread / 2)),
    potentialHigh: Math.min(2000, Math.round(pa + paSpread / 2)),
    scoutName: scout !== null ? `${scout.firstName} ${scout.lastName}` : null,
  };
}

/**
 * The prose summary a scout files before they can put numbers on anything.
 * Picks out whatever is genuinely distinctive about the player, described the
 * way a scout would describe it.
 */
function prose(world: World, i: number, confidence: number): string[] {
  const store = world.players;
  const lines: string[] = [];
  const get = (a: AttributeName): number => store.getAttr(i, a);

  const notable: Array<[number, string]> = [
    [get('blocking'), 'Reads the block well and closes quickly'],
    [get('jumpServe'), 'Dangerous jump serve'],
    [get('floatServe'), 'Serves a difficult float'],
    [get('reception'), 'Reliable in serve reception'],
    [get('digging'), 'Covers the floor exceptionally well'],
    [get('setting'), 'Distributes intelligently under pressure'],
    [get('quickAttack'), 'Runs a fast quick attack'],
    [get('spikeTechnique'), 'Technically excellent attacker'],
    [get('verticalJump'), 'Outstanding leaper'],
    [get('ballControl'), 'Excellent hands and ball control'],
  ];
  const weak: Array<[number, string]> = [
    [get('reception'), 'Struggles to pass a tough serve'],
    [get('ballControl'), 'Ball control lets him down'],
    [get('blocking'), 'Late and passive at the net'],
    [get('composure'), 'Can unravel when the score tightens'],
    [get('stamina'), 'Fades badly in long matches'],
  ];

  for (const [value, text] of notable.sort((a, b) => b[0] - a[0]).slice(0, 3)) {
    if (value >= 15) lines.push(text);
  }
  for (const [value, text] of weak.sort((a, b) => a[0] - b[0]).slice(0, 2)) {
    if (value <= 8) lines.push(text);
  }

  // Personality shows through only once the scout has spent real time on them.
  if (confidence > 0.5) {
    const pro = get('professionalism');
    const ambition = get('ambition');
    if (pro >= 16) lines.push('A model professional');
    else if (pro <= 7) lines.push('Questions about his attitude and application');
    if (ambition >= 17) lines.push('Highly ambitious — will not sit on a bench');
    const injury = get('injuryProneness');
    if (injury >= 15) lines.push('Worrying injury record');
  }

  if (lines.length === 0) lines.push('No standout qualities identified yet');
  if (confidence < 0.25) lines.unshift('Report is preliminary — limited viewings');
  return lines;
}

/**
 * Deterministic pseudo-noise in [-1, 1] for a player/attribute pair, so a
 * scout's error is consistent rather than re-rolled on every render.
 */
function stableNoise(playerId: number, attr: string): number {
  const h = hashString(`${playerId}:${attr}`);
  return (h / 0xffffffff) * 2 - 1;
}

/** Format an estimate the way it should appear on screen. */
export function formatEstimate(e: AttributeEstimate): string {
  return e.exact ? String(e.low) : `${e.low}-${e.high}`;
}

/** A scout dispatched to watch a player, resolving on a future day. */
export interface ScoutAssignment {
  playerIdx: number;
  /** Absolute world.day this assignment resolves on. */
  completesOnDay: number;
  /** Matches-watched added to scoutingKnowledge once it resolves. */
  matches: number;
}

/** Apply any scouting assignments whose time has come, and log a message for each. */
export function processScoutingQueue(world: World): void {
  if (world.scoutingQueue.length === 0) return;
  const remaining: ScoutAssignment[] = [];
  for (const task of world.scoutingQueue) {
    if (world.day < task.completesOnDay) { remaining.push(task); continue; }
    const current = world.scoutingKnowledge.get(task.playerIdx)?.matchesWatched ?? 0;
    world.scoutingKnowledge.set(task.playerIdx, {
      confidence: 0, matchesWatched: Math.min(80, current + task.matches),
    });
    world.messages.push({
      id: world.messages.length,
      day: world.day,
      year: world.year,
      subject: 'Scouting report ready',
      body: `Your scouts have filed a new report on ${world.players.fullName(task.playerIdx)}.`,
      playerIdx: task.playerIdx,
    });
  }
  world.scoutingQueue = remaining;
}
