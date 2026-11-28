/**
 * The under-21 coach's word with the senior coach: a player of his side put
 * forward for the first team, or for a senior contract at his age limit.
 *
 * The senior coach answers in the inbox a few days later. He weighs the
 * player against his squad (the average of its best twelve): his ability
 * now, and what he could become, the more so the more the coach likes
 * working with young players; and the under-21 coach himself, by the senior
 * club's goodwill and his name. A yes calls the player up, or signs him to a
 * first-team contract that runs past his under-21 days (see
 * under21Contracts.ts: the senior club decides, never the under-21 coach). A
 * no comes with the reason.
 *
 * One word a player each six weeks; and a coach who puts forward one player
 * after another is listened to less: past three in a month, each costs goodwill.
 */

import { Rng } from '../core/rng.ts';
import type { Club } from '../model/club.ts';
import { MAX_SQUAD } from '../model/positions.ts';
import { StaffRole } from '../model/staff.ts';
import { postMessage } from './inbox.ts';
import { notePlayerEvent } from './playerTimeline.ts';
import { agingOut } from './under21Contracts.ts';
import { callUpFromUnder21, managedSide, under21Relations } from './under21.ts';
import { contractEndSeason, seasonEndDay, type World } from './world.ts';

export type RecommendKind = 'firstTeam' | 'contract';

export interface Recommendation {
  p: number;
  kind: RecommendKind;
  day: number;
  answerOn: number;
  /** Answered: what the senior coach said. */
  answered?: boolean;
  yes?: boolean;
}

/** Days before the same player can be put forward again, for the same thing. */
export const RECOMMEND_COOLDOWN = 42;
/** Words a month the senior coach takes in good part. */
const FREE_A_MONTH = 3;
const OVERDONE_COST = 4;

function list(world: World): Recommendation[] {
  return (under21Relations(world).recommendations ??= []);
}

/** The senior squad's level: the average of its best twelve. */
function squadLevel(world: World, senior: Club): number {
  const best = senior.players.map((x) => world.players.currentAbility[x]).sort((a, b) => b - a).slice(0, 12);
  return best.length > 0 ? best.reduce((s, x) => s + x, 0) / best.length : 1;
}

/** How much the senior coach likes working with young players, 0-1 (his staff attribute; an average one without a coach). */
function youthMinded(world: World, senior: Club): number {
  const coach = senior.staff.map((id) => world.staff[id]).find((s) => s?.role === StaffRole.HeadCoach);
  return (coach?.attributes.workingWithYouth ?? 10) / 20;
}

/** The pending word on a player, if one is waiting for an answer. */
export function pendingRecommendation(world: World, p: number): Recommendation | undefined {
  return world.under21?.recommendations?.find((r) => r.p === p && r.answered !== true);
}

/** Why the manager can't put a player forward now, or null if he can. */
export function recommendBlock(world: World, p: number, kind: RecommendKind): string | null {
  const m = managedSide(world);
  const name = world.players.fullName(p);
  if (m === null) return 'Only the under-21 coach can put players forward to the senior coach.';
  if (!m.side.players.includes(p)) return `${name} is not in your under-21 squad.`;
  if (pendingRecommendation(world, p) !== undefined) return `The senior coach has not answered about ${name} yet.`;
  if (kind === 'firstTeam' && m.senior.players.length >= MAX_SQUAD) return `${m.senior.name}'s squad is full.`;
  if (kind === 'contract') {
    if (!agingOut(world, p)) return `${name} is under contract to his under-21 age limit: a senior contract is for his last season.`;
    if (contractEndSeason(world.players.contractUntil[p]) > world.season) return `${name} already has a contract for next season.`;
  }
  const last = list(world).filter((r) => r.p === p && r.kind === kind).sort((a, b) => b.day - a.day)[0];
  if (last !== undefined && world.day - last.day < RECOMMEND_COOLDOWN) {
    return `You spoke about ${name} recently. Ask again in ${RECOMMEND_COOLDOWN - (world.day - last.day)} days.`;
  }
  return null;
}

/** Put a player forward to the senior coach. He answers in the inbox in a few days. Returns what happened. */
export function recommendToSeniorCoach(world: World, p: number, kind: RecommendKind): { ok: boolean; text: string } {
  const block = recommendBlock(world, p, kind);
  if (block !== null) return { ok: false, text: block };
  const m = managedSide(world)!;
  const R = under21Relations(world);
  // One word after another wears thin.
  const lately = list(world).filter((r) => world.day - r.day < 30).length;
  const overdone = lately >= FREE_A_MONTH;
  if (overdone) R.goodwill = Math.max(0, R.goodwill - OVERDONE_COST);
  const answerOn = world.day + new Rng(`u21rec:${world.seed}:${p}:${world.day}`).int(2, 5);
  list(world).push({ p, kind, day: world.day, answerOn });
  const what = kind === 'firstTeam' ? 'for the first team' : 'for a senior contract';
  return {
    ok: true,
    text: `You have put ${world.players.fullName(p)} forward ${what}. ${m.senior.name}'s coach will answer in a few days.` +
      (overdone ? ' He is hearing a lot from you lately.' : ''),
  };
}

/**
 * The senior coach's verdict, 0-1 against a bar of 0.5: the player against his squad, ability and
 * potential, weighed by how much the coach likes young players; and the under-21 coach's standing.
 */
export function seniorVerdict(world: World, senior: Club, p: number, kind: RecommendKind): number {
  const store = world.players;
  const level = squadLevel(world, senior);
  const youth = youthMinded(world, senior);
  const now = store.currentAbility[p] / level;
  const later = store.potentialAbility[p] / level;
  // A first-team place is about now; a contract more about what is to come.
  const potentialWeight = (kind === 'contract' ? 0.5 : 0.25) + youth * 0.25;
  const player = now * (1 - potentialWeight) + later * potentialWeight;
  const standing = (under21Relations(world).goodwill - 50) / 400 + world.career.reputation / 100_000;
  return player - 0.4 + standing;
}

/** The day's answers from the senior coach. */
export function seniorCoachAnswers(world: World): void {
  const recs = world.under21?.recommendations;
  if (recs === undefined) return;
  const m = managedSide(world);
  for (const r of recs) {
    if (r.answered === true || r.answerOn > world.day) continue;
    r.answered = true;
    const store = world.players;
    const name = store.fullName(r.p);
    // He has gone, or the manager has: nothing to answer.
    if (m === null || !m.side.players.includes(r.p)) continue;
    const { side, senior } = m;
    const score = seniorVerdict(world, senior, r.p, r.kind);
    const level = squadLevel(world, senior);
    const R = under21Relations(world);
    let yes = score >= 0.5;
    let body: string;
    if (yes && r.kind === 'firstTeam') {
      const done = callUpFromUnder21(world, senior, r.p);
      yes = done.ok;
      if (done.ok) R.promotedThisSeason++;
      body = done.ok
        ? `"I have watched ${name} and you are right, he is ready to train and play with us." ${done.text}`
        : `"I would take ${name}, but ${done.text.charAt(0).toLowerCase()}${done.text.slice(1)}"`;
    } else if (yes) {
      store.contractUntil[r.p] = seasonEndDay(world.season + 2);
      store.wage[r.p] = Math.round((store.wage[r.p] * 1.5) / 1000) * 1000;
      notePlayerEvent(world, r.p, { kind: 'promoted', clubId: senior.id });
      body = `"We see a future for ${name} here." ${senior.name} have signed him to a first-team contract until 30 June ` +
        `${world.startYear + world.season + 3}. He joins the senior squad when his under-21 days are over.`;
    } else {
      const short = store.currentAbility[r.p] < level * 0.8;
      const reason = r.kind === 'firstTeam'
        ? short ? `he is not at the level of the squad yet (${store.currentAbility[r.p]} against about ${Math.round(level)})` : 'there is no place for him in the squad as things stand'
        : store.potentialAbility[r.p] < level ? 'he does not see him growing into a first-team player here' : 'he wants to see more of him before committing to a contract';
      body = `"Not now: ${reason}." Keep developing him and ask again later.`;
      if (short) R.goodwill = Math.max(0, R.goodwill - 2);
    }
    if (yes) R.goodwill = Math.min(100, R.goodwill + 2);
    r.yes = yes;
    postMessage(world, {
      subject: `${senior.name} coach on ${name}: ${yes ? 'yes' : 'not now'}`,
      body,
      from: `${senior.name} head coach`,
      playerIdx: r.p,
      category: 'board',
      clubId: side.id,
    });
  }
  // Answers older than a season are not needed for the cooldowns.
  const R = under21Relations(world);
  R.recommendations = recs.filter((r) => r.answered !== true || world.day - r.day < 365);
}
