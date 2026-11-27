/**
 * A club and its under-21 side (a real-data world's, see realWorld.ts): the
 * side's players called up to the first team, and the first team's young ones
 * sent to play for it. A first-team player of under-21 age plays for the side
 * anyway on its match days (see matchSquadClub): a call-up is about where he is
 * registered, trained and paid.
 */

import type { Club } from '../model/club.ts';
import { MAX_SQUAD } from '../model/positions.ts';
import { notePlayerEvent } from './playerTimeline.ts';
import { postMessage } from './inbox.ts';
import type { World } from './world.ts';

/** The club's under-21 side, if it has one. */
export function under21SideOf(world: World, club: Club): Club | undefined {
  return world.clubs.find((c) => c.under21Of === club.id);
}

/**
 * Whether a player is young enough for the under-21s this season: born in the
 * year the season starts less 20 or later — 2006 or later for 2026/27.
 */
export function under21Eligible(world: World, p: number): boolean {
  return world.players.birthYear[p] >= world.startYear + world.season - 20;
}

/**
 * A club's players for a match day: an under-21 side's own and the senior
 * club's of under-21 age, whom its coach calls down for the match, all but
 * those the manager, coaching the senior club, has kept back for that day.
 */
export function matchSquadPlayers(world: World, club: Club): number[] {
  if (club.under21Of === undefined) return [...club.players];
  const senior = world.clubs[club.under21Of];
  const extra = senior === undefined ? [] : seniorsEligible(world, senior)
    .filter((p) => !club.players.includes(p) && !keptBack(world, club.id, p));
  return [...club.players, ...extra];
}

/** Whether the manager has kept a senior player back from the side's match today. */
function keptBack(world: World, side: number, p: number): boolean {
  return (world.under21?.matchCalls ?? []).some((c) => c.side === side && c.day === world.day && c.kept && c.players.includes(p));
}

/** The first team's players who could also play for the side. */
export function seniorsEligible(world: World, club: Club): number[] {
  return club.players.filter((p) => under21Eligible(world, p));
}

function move(world: World, from: Club, to: Club, p: number): void {
  from.players = from.players.filter((x) => x !== p);
  from.preferredLineup = from.preferredLineup.map((x) => (x === p ? -1 : x));
  if (from.preferredLibero === p) from.preferredLibero = -1;
  if (from.preferredDefensiveLibero === p) from.preferredDefensiveLibero = -1;
  to.players.push(p);
  world.players.clubId[p] = to.id;
}

/** Bring one of the side's players into the first team. Returns what happened, in a line. */
export function callUpFromUnder21(world: World, senior: Club, p: number): { ok: boolean; text: string } {
  const side = under21SideOf(world, senior);
  const name = world.players.fullName(p);
  if (side === undefined || !side.players.includes(p)) return { ok: false, text: `${name} is not in your under-21 squad.` };
  if (senior.players.length >= MAX_SQUAD) return { ok: false, text: `The first-team squad is full (${MAX_SQUAD}).` };
  move(world, side, senior, p);
  notePlayerEvent(world, p, { kind: 'promoted', clubId: senior.id });
  const still = under21Eligible(world, p) ? ' He can still play for the under-21s on their match days.' : '';
  return { ok: true, text: `${name} joins the first team.${still}` };
}

/** Send a young first-team player to the under-21 side. Returns what happened, in a line. */
export function sendToUnder21(world: World, senior: Club, p: number): { ok: boolean; text: string } {
  const side = under21SideOf(world, senior);
  const name = world.players.fullName(p);
  if (side === undefined) return { ok: false, text: 'The club has no under-21 side.' };
  if (!senior.players.includes(p)) return { ok: false, text: `${name} is not in your first team.` };
  if (!under21Eligible(world, p)) return { ok: false, text: `${name} is too old for the under-21s.` };
  if (side.players.length >= MAX_SQUAD) return { ok: false, text: `The under-21 squad is full (${MAX_SQUAD}).` };
  move(world, senior, side, p);
  return { ok: true, text: `${name} goes to the under-21 side. You can call him up again whenever you like.` };
}

// ---- Coaching the under-21 side: the senior club's requests, and the manager's ---------

/** The senior club asks for one of the side's players. */
export interface CallUpRequest {
  id: number;
  playerIdx: number;
  /** The senior club and the side. */
  senior: number;
  side: number;
  /** The last day to answer: after it, the senior club takes silence for a no. */
  expiresOn: number;
  reason: string;
}

/** What the senior club thinks of the side's coach, 0-100, and what he has given it this season. */
export interface Under21Relations {
  goodwill: number;
  promotedThisSeason: number;
  nextId: number;
  requests: CallUpRequest[];
  /** The day the senior club last asked: it does not ask every week. */
  lastAsked: number;
  /** The under-21 coach's calls for the senior club's young players, match by match, when the manager coaches the senior club. */
  matchCalls?: MatchCall[];
}

/** The under-21 coach wants some of the first team's young players for one match. */
export interface MatchCall {
  id: number;
  side: number;
  /** The match day. */
  day: number;
  players: number[];
  /** The manager's answer: kept back, or (the default) let go. */
  kept: boolean;
  answered: boolean;
}

export function under21Relations(world: World): Under21Relations {
  return (world.under21 ??= { goodwill: 60, promotedThisSeason: 0, nextId: 1, requests: [], lastAsked: -999 });
}

/** The side the manager coaches, and its senior club: both, or nothing. */
export function managedSide(world: World): { side: Club; senior: Club } | null {
  const side = world.clubs[world.userClubId];
  if (side === undefined || side.under21Of === undefined) return null;
  const senior = world.clubs[side.under21Of];
  return senior !== undefined ? { side, senior } : null;
}

const ASK_GAP = 18;
const ANSWER_DAYS = 5;

/**
 * Each day: the senior club, short at a position or with a youngster better than
 * what it has there, may ask for one of the side's players; an unanswered request
 * lapses into a no.
 */
export function under21Day(world: World): void {
  const m = managedSide(world);
  if (m === null) return;
  const { side, senior } = m;
  const R = under21Relations(world);
  const store = world.players;

  for (const r of [...R.requests]) {
    if (r.expiresOn < world.day) answerCallUp(world, r.id, false, true);
  }
  if (R.requests.length > 0 || world.day - R.lastAsked < ASK_GAP) return;
  if (senior.players.length >= MAX_SQUAD) return;
  const fit = (p: number): boolean => store.injuryDaysLeft[p] === 0;
  let best: { p: number; reason: string; weight: number } | null = null;
  for (const p of side.players) {
    if (!fit(p)) continue;
    const pos = store.position[p];
    const seniors = senior.players.filter((x) => store.position[x] === pos && fit(x));
    const worst = seniors.length > 0 ? Math.min(...seniors.map((x) => store.currentAbility[x])) : 0;
    let weight = 0;
    let reason = '';
    if (seniors.length < 2) {
      weight = 3;
      reason = 'The first team is short of fit players at his position.';
    } else if (store.currentAbility[p] > worst + 40) {
      weight = 1 + (store.currentAbility[p] - worst) / 100;
      reason = 'He is already better than some of the first team at his position.';
    }
    if (weight > 0 && (best === null || weight > best.weight)) best = { p, reason, weight };
  }
  // A small chance each day, more when the senior club is in need.
  if (best === null || !world.rng.chance(0.06 * best.weight)) return;
  R.lastAsked = world.day;
  const request: CallUpRequest = {
    id: R.nextId++, playerIdx: best.p, senior: senior.id, side: side.id, expiresOn: world.day + ANSWER_DAYS, reason: best.reason,
  };
  R.requests.push(request);
  const name = store.fullName(best.p);
  postMessage(world, {
    category: 'board', from: senior.name, clubId: senior.id, playerIdx: best.p, callUpRequestId: request.id,
    subject: `${senior.name} want ${name} in the first team`,
    body: `${senior.name}'s head coach would like to call ${name} up to the first team. ${best.reason} `
      + `He would be registered with the first team from now on${under21Eligible(world, best.p) ? ', and still play for you on your match days' : ''}. `
      + `Saying yes is what the club expects of its under-21 coach, and saying no will be remembered. Answer within ${ANSWER_DAYS} days.`,
  });
}

/** How many days before its match the side's coach asks for the first team's young players. */
const CALL_AHEAD = 2;

/**
 * Each day, when the manager coaches a senior club with an under-21 side: the
 * side's coach, two days before a match, asks for the first-team players of
 * under-21 age he would put on the court. They go unless the manager keeps
 * them back; the matches fall on different days.
 */
export function seniorCallDay(world: World): void {
  if (managedSide(world) !== null) return;
  const senior = world.clubs[world.userClubId];
  if (senior === undefined) return;
  const side = under21SideOf(world, senior);
  if (side === undefined) return;
  const R = under21Relations(world);
  R.matchCalls = (R.matchCalls ?? []).filter((c) => c.day >= world.day - 7);
  const day = world.day + CALL_AHEAD;
  if (R.matchCalls.some((c) => c.side === side.id && c.day === day)) return;
  const fixture = (world.fixturesByDay.get(day) ?? []).map((id) => world.fixtures[id])
    .find((f) => f !== undefined && (f.home === side.id || f.away === side.id));
  if (fixture === undefined) return;
  const store = world.players;
  const fit = (p: number): boolean => store.injuryDaysLeft[p] === 0;
  // The ones he would start: among the two best at their position, the side's own and the seniors together.
  const young = seniorsEligible(world, senior).filter(fit);
  const pool = [...side.players.filter(fit), ...young];
  const wanted = young.filter((p) => {
    const better = pool.filter((x) => x !== p && store.position[x] === store.position[p] && store.currentAbility[x] > store.currentAbility[p]);
    return better.length < 2;
  });
  if (wanted.length === 0) return;
  const call: MatchCall = { id: R.nextId++, side: side.id, day, players: wanted, kept: false, answered: false };
  R.matchCalls.push(call);
  const opponent = world.clubs[fixture.home === side.id ? fixture.away : fixture.home];
  const names = wanted.map((p) => store.fullName(p));
  const one = names.length === 1;
  const list = one ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  postMessage(world, {
    category: 'board', from: `${side.name} coach`, clubId: side.id, playerIdx: wanted[0], matchCallId: call.id,
    subject: `${side.name} want ${one ? names[0] : `${names.length} of your players`} for their match`,
    body: `The under-21 coach would like ${list} for the match against ${opponent?.name ?? 'their opponents'} in ${CALL_AHEAD} days. `
      + `The under-21s play on other days, so ${one ? 'he stays' : 'they stay'} available to you. `
      + `${one ? 'He goes' : 'They go'} unless you keep ${one ? 'him' : 'them'} back.`,
  });
}

/** The manager's answer to the side's call for a match: let them go, or keep them back. */
export function answerMatchCall(world: World, id: number, letGo: boolean): string {
  const call = (world.under21?.matchCalls ?? []).find((c) => c.id === id);
  if (call === undefined || call.answered || call.day < world.day) return 'That match has been played.';
  call.answered = true;
  call.kept = !letGo;
  const side = world.clubs[call.side];
  const n = call.players.length;
  const who = n === 1 ? world.players.fullName(call.players[0]) : `The ${n} players`;
  return letGo
    ? `${who} will play for ${side?.name ?? 'the under-21s'}.`
    : `${who} ${n === 1 ? 'stays' : 'stay'} with the first team for that match.`;
}

/** Whether the side's call for a match still waits on the manager. */
export function matchCallPending(world: World, id: number): boolean {
  return (world.under21?.matchCalls ?? []).some((c) => c.id === id && !c.answered && c.day >= world.day);
}

/** The manager's answer to a request. Silence, when the request lapses, counts as a no, a little less sharply. */
export function answerCallUp(world: World, id: number, yes: boolean, lapsed = false): string {
  const R = under21Relations(world);
  const r = R.requests.find((x) => x.id === id);
  if (r === undefined) return 'That request has been answered.';
  R.requests = R.requests.filter((x) => x !== r);
  const senior = world.clubs[r.senior];
  const side = world.clubs[r.side];
  const name = world.players.fullName(r.playerIdx);
  if (senior === undefined || side === undefined) return '';
  if (yes) {
    const done = callUpFromUnder21(world, senior, r.playerIdx);
    if (!done.ok) return done.text;
    R.goodwill = Math.min(100, R.goodwill + 6);
    R.promotedThisSeason++;
    side.boardConfidence = Math.min(100, side.boardConfidence + 3);
    return `${name} goes up to the first team. ${senior.name} are grateful.`;
  }
  R.goodwill = Math.max(0, R.goodwill - (lapsed ? 5 : 9));
  side.boardConfidence = Math.max(0, side.boardConfidence - (lapsed ? 1 : 2));
  postMessage(world, {
    category: 'board', from: senior.name, clubId: senior.id, playerIdx: r.playerIdx,
    subject: lapsed ? `No answer about ${name}` : `${senior.name} take note`,
    body: lapsed
      ? `${senior.name} heard nothing back about ${name} and went with what they have. They will not forget it was left unanswered.`
      : `${senior.name} accept that ${name} stays with the under-21s for now, but the head coach was not pleased.`,
  });
  return `${name} stays with the under-21s.`;
}

/** Whether a request is still waiting on the manager. */
export function callUpPending(world: World, id: number): boolean {
  return (world.under21?.requests ?? []).some((r) => r.id === id);
}

/**
 * The manager asks the senior club for one of its young players who is hardly
 * playing. It answers on the spot: yes for a player getting few minutes, more
 * readily the better it thinks of the manager.
 */
export function askForSenior(world: World, p: number): { ok: boolean; text: string } {
  const m = managedSide(world);
  const name = world.players.fullName(p);
  if (m === null) return { ok: false, text: 'You do not coach an under-21 side.' };
  const { side, senior } = m;
  void side;
  if (!senior.players.includes(p)) return { ok: false, text: `${name} is not in ${senior.name}'s squad.` };
  if (!under21Eligible(world, p)) return { ok: false, text: `${name} is too old for the under-21s.` };
  const R = under21Relations(world);
  const minutes = world.players.playingTime[p];
  const chance = Math.max(0.05, Math.min(0.95, 0.9 - minutes / 100 + (R.goodwill - 50) / 120));
  if (!world.rng.chance(chance)) {
    return {
      ok: false,
      text: `${senior.name} want to keep ${name}: ${minutes >= 50 ? 'he plays for them' : 'they see him as part of the first-team squad'}. He can still play for you on your match days.`,
    };
  }
  const done = sendToUnder21(world, senior, p);
  if (!done.ok) return done;
  return { ok: true, text: `${senior.name} agree: ${name} joins the under-21s.` };
}

/** At the end of the season: the board's verdict on what the side gave the first team. */
export function under21SeasonEnd(world: World, movedUp: number): void {
  const m = managedSide(world);
  if (m === null) return;
  const R = under21Relations(world);
  const total = R.promotedThisSeason + movedUp;
  m.side.boardConfidence = Math.min(100, m.side.boardConfidence + Math.min(15, total * 3));
  postMessage(world, {
    category: 'board', from: `${m.side.name} board`, clubId: m.side.id,
    subject: total > 0 ? `${total} player${total === 1 ? '' : 's'} into the first team` : 'No one into the first team this season',
    body: total > 0
      ? `The board measures the under-21s by the players they give the first team as much as by results: ${total} went up this season. Their confidence in you rises.`
      : 'The board measures the under-21s by the players they give the first team as much as by results. None went up this season, and they expect better next year.',
  });
  R.promotedThisSeason = 0;
}
