/**
 * How an injury is treated: the manager's call, on the doctor's advice.
 *
 * For anything longer than a knock — ten days out or more — the medical room
 * lays out the choice. Rush him back and he is out about a third less, but
 * comes back short of fitness and, for five weeks, may break down again in
 * any match he plays — less likely the better the club's doctors, physios and
 * facilities. Take it slowly and he is out a quarter longer, but returns fit
 * and without the risk. Or let the doctors do it their way.
 */

import type { Club } from '../model/club.ts';
import { INJURY_NAMES, PlayerFlag } from '../model/players.ts';
import { hash01 } from './offerStance.ts';
import { postMessage } from './inbox.ts';
import { medicalQuality } from './staffMarket.ts';
import type { World } from './world.ts';

export type Treatment = 'rush' | 'normal' | 'rest';

export const TREATMENT_NAMES: Readonly<Record<Treatment, string>> = {
  rush: 'Rush him back', normal: 'The doctors\' way', rest: 'Take it slowly',
};

/** An injury of one of the manager's players, and how it is being treated. */
export interface InjuryCase {
  /** As first expected, in days, and of what. */
  days: number;
  type: number;
  treatment: Treatment;
  /** Whether the manager has made his call — once only. */
  decided: boolean;
  since: number;
}

/** A player rushed back, and how likely he is to break down in a match until `until`. */
export interface RelapseRisk {
  until: number;
  chance: number;
  days: number;
  type: number;
}

/** Shortest injury the manager is asked about. */
export const TREATMENT_MIN_DAYS = 10;
/** What each way does to the time out. */
const TIME: Readonly<Record<Treatment, number>> = { rush: 0.65, normal: 1, rest: 1.25 };
/** Condition he comes back with. */
export const RETURN_CONDITION: Readonly<Record<Treatment, number>> = { rush: 60, normal: 65, rest: 85 };
/** How long a rushed player stays at risk, in days. */
const RELAPSE_DAYS = 35;

/** The chance a rushed player breaks down in any one match: worse the longer the injury, better the medical room. */
export function relapseChance(world: World, club: Club | undefined, days: number): number {
  const care = club !== undefined ? medicalQuality(world, club) : 0.4;
  return Math.max(0.03, Math.min(0.3, (0.08 + days / 400) * (1.5 - care)));
}

/** The case the medical room opens on one of the manager's players: called with the injury notice. */
export function openInjuryCase(world: World, p: number, type: number, days: number): void {
  if (days < TREATMENT_MIN_DAYS) return;
  (world.injuryCases ??= {})[p] = { days, type, treatment: 'normal', decided: false, since: world.day };
}

/** The manager's call. Returns what the medical room says to it — or why it can't be made. */
export function chooseTreatment(world: World, p: number, treatment: Treatment): { ok: boolean; text: string } {
  const store = world.players;
  const c = world.injuryCases?.[p];
  if (c === undefined || store.injuryDaysLeft[p] <= 0) return { ok: false, text: 'He is not injured.' };
  if (c.decided) return { ok: false, text: 'The decision has been made.' };
  c.treatment = treatment;
  c.decided = true;
  const left = store.injuryDaysLeft[p];
  store.injuryDaysLeft[p] = Math.max(1, Math.round(left * TIME[treatment]));
  const name = store.fullName(p);
  const weeks = Math.max(1, Math.round(store.injuryDaysLeft[p] / 7));
  const text = treatment === 'rush'
    ? `We will push ${name}'s recovery: he should be back in about ${weeks} week${weeks === 1 ? '' : 's'}. ` +
      'He will not be fully fit, and for a few weeks he could break down again in any match.'
    : treatment === 'rest'
      ? `We will take our time with ${name}: about ${weeks} week${weeks === 1 ? '' : 's'}, and he will come back fit, with no risk of it going again.`
      : `${name} will be treated the usual way: about ${weeks} week${weeks === 1 ? '' : 's'}.`;
  return { ok: true, text };
}

/** Projected weeks out under each treatment, from where the injury stands. */
export function treatmentWeeks(world: World, p: number): Record<Treatment, number> {
  const left = world.players.injuryDaysLeft[p];
  const w = (t: Treatment): number => Math.max(1, Math.round(Math.max(1, Math.round(left * TIME[t])) / 7));
  return { rush: w('rush'), normal: w('normal'), rest: w('rest') };
}

/**
 * He is fit again: the condition he comes back with, by how he was treated —
 * and, if he was rushed, the weeks he is at risk. Returns his condition.
 */
export function closeInjuryCase(world: World, p: number): number {
  const c = world.injuryCases?.[p];
  if (c === undefined) return RETURN_CONDITION.normal;
  delete world.injuryCases![p];
  if (c.treatment === 'rush') {
    const club = world.clubs[world.players.clubId[p]];
    (world.relapse ??= {})[p] = { until: world.day + RELAPSE_DAYS, chance: relapseChance(world, club, c.days), days: c.days, type: c.type };
  }
  return RETURN_CONDITION[c.treatment];
}

/**
 * A match played: each player rushed back who took part may break down again.
 * Its own dice — the match's and the player's — so nothing else in the world moves.
 */
export function relapseAfterMatch(world: World, fixtureId: number, played: Iterable<number>): void {
  const risks = world.relapse;
  if (risks === undefined) return;
  const store = world.players;
  for (const p of played) {
    const r = risks[p];
    if (r === undefined) continue;
    if (world.day > r.until) { delete risks[p]; continue; }
    if (hash01(fixtureId * 31 + p, 0x7e1a) >= r.chance) continue;
    delete risks[p];
    const days = Math.round(r.days * 0.9);
    store.injuryDaysLeft[p] = days;
    store.injuryType[p] = r.type;
    store.setFlag(p, PlayerFlag.Injured, true);
    store.morale[p] = Math.max(0, store.morale[p] - 8);
    if (store.clubId[p] === world.userClubId) {
      const name = store.fullName(p);
      const injury = (INJURY_NAMES[r.type] ?? 'injury').toLowerCase();
      postMessage(world, {
        category: 'medical', from: 'Medical Department', playerIdx: p,
        subject: `${name} breaks down again`,
        body: `${name}'s ${injury} has gone again — he came back too soon. He is out for about ${Math.max(1, Math.round(days / 7))} weeks, ` +
          'and this time the doctors will do it their way.',
        injury: { type: r.type, days },
      });
    }
  }
  for (const p of Object.keys(risks)) if (world.day > risks[Number(p)].until) delete risks[Number(p)];
}

/** Whether a player is still at risk of breaking down, rushed back from an injury. */
export function atRisk(world: World, p: number): boolean {
  const r = world.relapse?.[p];
  return r !== undefined && world.day <= r.until;
}
