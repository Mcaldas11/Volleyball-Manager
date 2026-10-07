/**
 * Training: the week's plan and each player's own programme.
 *
 * The week is laid out around the matches — the match day, the day before it
 * spent preparing for that opponent, the day after on recovery — and the days
 * left are training, of the kind the week's focus asks for, at the intensity
 * set for it. The manager can change any day by hand; every week keeps at
 * least one day of rest.
 *
 * What it does: the sessions of the week decide how much the squad develops,
 * and in which direction (a physical week builds the body, a technical one the
 * skills, a tactical one the head); every training day costs condition and a
 * rest day gives some back; the harder the week, the likelier an injury. A
 * day preparing for the next opponent covers one part of the game — serve
 * receive, attack in transition, block and defence — and the side is a little
 * sharper at it in the match.
 *
 * Each player can also be given his own focus and load — or the assistant
 * does it: the weakest part of his game for his position, and less work for a
 * player who is tired or coming back from injury. And the manager can have a
 * player learn another position: a few points of familiarity a week, quicker
 * for the young and the coachable — playing there teaches it too.
 *
 * Every club trains this way. The user plans his own; every other club's
 * assistant plans for it — the week around its matches, hard in a pre-season
 * week with no match to play, light in a week with two — runs its players'
 * programmes, and prepares each match for the opponent in front of it.
 */

import { ATTR_COUNT, ATTR_INDEX, type AttributeName } from '../model/attributes.ts';
import type { Club } from '../model/club.ts';
import { Position } from '../model/positions.ts';
import { Combinations, combinationsOf } from '../match/tactics.ts';
import { postMessage } from './inbox.ts';
import { DAYS_PER_SEASON, type Fixture, type World } from './world.ts';

export type SessionType = 'rest' | 'recovery' | 'physical' | 'technical' | 'tactical' | 'balanced' | 'preparation' | 'match';
export type WeeklyFocus = 'auto' | 'physical' | 'technical' | 'tactical' | 'balanced';
export type Intensity = 'low' | 'normal' | 'high';
export type IndividualFocus =
  | 'auto' | 'serving' | 'reception' | 'attacking' | 'blocking' | 'setting' | 'defence' | 'physical' | 'mental';
export type PlayerLoad = 'rest' | 'reduced' | 'normal' | 'extra';
/** The part of the game a day's match preparation works on — the last the
 *  combination plays off the middle, with the outside and the opposite. */
export type PrepArea = 'reception' | 'transition' | 'block' | 'combinations';

export interface TrainingPlan {
  /** Each week's focus and intensity, by the absolute day its Monday falls on. */
  weeks: Record<number, { focus: WeeklyFocus; intensity: Intensity }>;
  /** Days set by hand, by absolute day. */
  days: Record<number, SessionType>;
  /** What a preparation day works on, by absolute day — set by hand; otherwise the opponent decides. */
  prep: Record<number, PrepArea>;
  /** Each player's own programme, by player index — when the manager runs it. */
  individual: Record<number, { focus: IndividualFocus; load: PlayerLoad }>;
  /** The assistant runs everyone's individual training. */
  assistantIndividual: boolean;
  /** A position each player is learning, by player index — absent on plans from before it could be set. */
  positions?: Record<number, Position>;
}

export interface Session {
  label: string;
  /** Development a day of it gives, against a normal training day's 1. */
  dev: number;
  /** What it costs in fatigue and injury risk, against a normal day's 1; negative for a day that gives back. */
  load: number;
  /** The kind of attribute it builds. */
  builds: 'physical' | 'technical' | 'tactical' | 'all' | null;
}

export const SESSIONS: Readonly<Record<SessionType, Session>> = {
  rest: { label: 'Rest', dev: 0, load: -1, builds: null },
  recovery: { label: 'Recovery', dev: 0, load: -0.5, builds: null },
  physical: { label: 'Physical', dev: 1, load: 1.15, builds: 'physical' },
  technical: { label: 'Technical', dev: 1, load: 0.9, builds: 'technical' },
  tactical: { label: 'Tactical', dev: 0.85, load: 0.7, builds: 'tactical' },
  balanced: { label: 'Balanced training', dev: 1, load: 0.95, builds: 'all' },
  preparation: { label: 'Match preparation', dev: 0.3, load: 0.5, builds: 'tactical' },
  match: { label: 'Match day', dev: 0, load: 0, builds: null },
};

export const INTENSITY: Readonly<Record<Intensity, { label: string; dev: number; load: number }>> = {
  low: { label: 'Low', dev: 0.75, load: 0.7 },
  normal: { label: 'Normal', dev: 1, load: 1 },
  high: { label: 'High', dev: 1.2, load: 1.4 },
};

export const PLAYER_LOAD: Readonly<Record<PlayerLoad, { label: string; dev: number; load: number }>> = {
  rest: { label: 'Rest', dev: 0, load: 0.3 },
  reduced: { label: 'Reduced', dev: 0.6, load: 0.6 },
  normal: { label: 'Normal', dev: 1, load: 1 },
  extra: { label: 'Extra', dev: 1.25, load: 1.35 },
};

export const PREP_AREAS: ReadonlyArray<readonly [PrepArea, string]> = [
  ['reception', 'Serve receive'],
  ['transition', 'Attack transition'],
  ['block', 'Block defence'],
  ['combinations', 'Combination plays'],
];

/** The attributes each individual focus works on. */
export const FOCUS_ATTRS: Readonly<Record<Exclude<IndividualFocus, 'auto'>, readonly AttributeName[]>> = {
  serving: ['floatServe', 'jumpServe', 'powerServe', 'servingAccuracy', 'servingPower'],
  reception: ['reception', 'ballControl'],
  attacking: ['spikeTechnique', 'quickAttack', 'backRowAttack', 'pipeAttack'],
  blocking: ['blocking'],
  setting: ['setting', 'ballControl'],
  defence: ['digging', 'agility'],
  physical: ['acceleration', 'verticalJump', 'agility', 'stamina'],
  mental: ['composure', 'concentration', 'determination', 'pressureHandling', 'teamwork'],
};

/** The same, as attribute indices. */
const FOCUS_IDX = Object.fromEntries(
  Object.entries(FOCUS_ATTRS).map(([f, attrs]) => [f, attrs.map((a) => ATTR_INDEX[a])]),
) as unknown as Readonly<Record<Exclude<IndividualFocus, 'auto'>, readonly number[]>>;

/** The attributes each kind of session builds, as attribute indices. */
const KIND_IDX: Readonly<Record<'physical' | 'technical' | 'tactical', readonly number[]>> = {
  physical: (['acceleration', 'verticalJump', 'agility', 'balance', 'stamina'] as const).map((a) => ATTR_INDEX[a]),
  technical: (['setting', 'reception', 'digging', 'blocking', 'spikeTechnique', 'ballControl', 'servingAccuracy'] as const)
    .map((a) => ATTR_INDEX[a]),
  tactical: (['composure', 'concentration', 'teamwork', 'pressureHandling'] as const).map((a) => ATTR_INDEX[a]),
};

export const FOCUS_LABELS: Readonly<Record<IndividualFocus, string>> = {
  auto: 'General', serving: 'Serving', reception: 'Reception', attacking: 'Attacking', blocking: 'Blocking',
  setting: 'Setting', defence: 'Defence', physical: 'Physical', mental: 'Mental',
};

/** The parts of the game that matter to each position — what the assistant chooses between. */
const POSITION_FOCUSES: Readonly<Record<Position, ReadonlyArray<Exclude<IndividualFocus, 'auto'>>>> = {
  [Position.Setter]: ['setting', 'serving', 'blocking', 'defence'],
  [Position.OutsideHitter]: ['reception', 'attacking', 'serving', 'defence'],
  [Position.Opposite]: ['attacking', 'blocking', 'serving'],
  [Position.MiddleBlocker]: ['blocking', 'attacking', 'serving'],
  [Position.Libero]: ['reception', 'defence', 'mental'],
};

/**
 * A typical week's development and load across a season — a match most
 * weeks, a hard pre-season, the odd week of two — which the week's effect is
 * measured against, so the world develops and gets injured at the rate it was
 * calibrated for (see `npm run vm career`).
 */
const NORMAL_WEEK_DEV = 4;
const NORMAL_WEEK_LOAD = 4.3;

export function newTrainingPlan(): TrainingPlan {
  return { weeks: {}, days: {}, prep: {}, individual: {}, assistantIndividual: true, positions: {} };
}

export function planOf(club: Club): TrainingPlan {
  return club.training ??= newTrainingPlan();
}

/** Every other club's plan: nothing set by hand, the assistant running it all. Never written to. */
const ASSISTANT_PLAN: TrainingPlan = newTrainingPlan();

/** The plan a club trains to: the user's own, or its assistant's. */
function readPlan(world: World, club: Club): TrainingPlan {
  return club.id === world.userClubId ? planOf(club) : ASSISTANT_PLAN;
}

// ---- The calendar ---------------------------------------------------------------------

/** The weekday an absolute day falls on, Monday 0 to Sunday 6 — the calendar the interface shows. */
export function weekdayOf(world: Pick<World, 'startYear'>, day: number): number {
  const seasonDay = ((day % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON;
  const doy = (seasonDay + 181) % 365;
  const year = world.startYear + Math.floor(day / DAYS_PER_SEASON) + (seasonDay >= 184 ? 1 : 0);
  const md = new Date(Date.UTC(2001, 0, 1 + doy));
  const sunday0 = new Date(Date.UTC(year, md.getUTCMonth(), md.getUTCDate())).getUTCDay();
  return (sunday0 + 6) % 7;
}

/** The Monday of the week a day is in. */
export function weekStartOf(world: Pick<World, 'startYear'>, day: number): number {
  return day - weekdayOf(world, day);
}

/** Each day's club matches by club — rebuilt for a day whenever its list of fixtures has grown. */
const dayIndex = new WeakMap<World, Map<number, { n: number; byClub: Map<number, Fixture> }>>();

/** The club's match on a day, if any. */
export function clubFixtureOn(world: World, clubId: number, day: number): Fixture | undefined {
  const list = world.fixturesByDay.get(day);
  if (list === undefined) return undefined;
  let days = dayIndex.get(world);
  if (days === undefined) {
    days = new Map();
    dayIndex.set(world, days);
  }
  let entry = days.get(day);
  if (entry === undefined || entry.n !== list.length) {
    const byClub = new Map<number, Fixture>();
    for (const id of list) {
      const f = world.fixtures[id];
      // National teams' matches name nations, not clubs.
      if (world.competitions[f.competitionId]?.kind === 'international') continue;
      byClub.set(f.home, f);
      byClub.set(f.away, f);
    }
    entry = { n: list.length, byClub };
    days.set(day, entry);
  }
  return entry.byClub.get(clubId);
}

// ---- The week -------------------------------------------------------------------------

export interface PlannedDay {
  day: number;
  session: SessionType;
  intensity: Intensity;
  /** Set by hand rather than by the plan. */
  manual: boolean;
  fixture?: Fixture;
  /** What a preparation day works on. */
  prep?: PrepArea;
}

/** A week's focus and intensity: as set for it, or carried over from the latest week set before it. */
export function weekSettings(plan: TrainingPlan, monday: number): { focus: WeeklyFocus; intensity: Intensity } {
  const set = plan.weeks[monday];
  if (set !== undefined) return set;
  const earlier = Object.keys(plan.weeks).map(Number).filter((d) => d < monday).sort((a, b) => b - a)[0];
  return earlier !== undefined ? plan.weeks[earlier] : { focus: 'auto', intensity: 'normal' };
}

/**
 * A week's focus and intensity for a club: the user's as he set them; any
 * other club's as its assistant sees the week — hard in a pre-season week with
 * no match, light in a week of two, normal otherwise.
 */
export function weekSettingsFor(world: World, club: Club, monday: number): { focus: WeeklyFocus; intensity: Intensity } {
  if (club.id === world.userClubId) return weekSettings(planOf(club), monday);
  let matches = 0;
  for (let i = 0; i < 7; i++) if (clubFixtureOn(world, club.id, monday + i) !== undefined) matches++;
  const preSeason = ((monday % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON < 48;
  return { focus: 'auto', intensity: matches >= 2 ? 'low' : matches === 0 && preSeason ? 'high' : 'normal' };
}

/** The training a day holds when the plan decides it. */
function plannedSession(focus: WeeklyFocus, day: number, weekday: number): SessionType {
  if (focus === 'physical' || focus === 'technical' || focus === 'tactical' || focus === 'balanced') return focus;
  // Automatic: the body in the pre-season, then the skills and the plan in turn.
  if (day % DAYS_PER_SEASON < 55) return weekday % 3 === 2 ? 'technical' : 'physical';
  return (['technical', 'tactical', 'balanced'] as const)[weekday % 3];
}

/**
 * What the opponent is best at, and so what to prepare for: big servers mean
 * serve receive, big hitters the block, a big block the attack in transition.
 */
export function autoPrep(world: World, club: Club, fixture: Fixture | undefined): PrepArea {
  if (fixture === undefined) return 'reception';
  const opp = world.clubs[fixture.home === club.id ? fixture.away : fixture.home];
  if (opp === undefined || opp.players.length === 0) return 'reception';
  const store = world.players;
  const avg = (attrs: readonly AttributeName[]): number => {
    let total = 0;
    for (const p of opp.players) for (const a of attrs) total += store.getAttr(p, a);
    return total / (opp.players.length * attrs.length);
  };
  const serve = avg(['jumpServe', 'powerServe', 'servingAccuracy']);
  const attack = avg(['spikeTechnique', 'quickAttack']);
  const block = avg(['blocking']);
  if (serve >= attack && serve >= block) return 'reception';
  if (attack >= block) return 'block';
  // A big block: beat it in transition — or, for a side that lives on its
  // combinations, with the combinations.
  return combinationsOf(club.tactics) === Combinations.Often ? 'combinations' : 'transition';
}

/**
 * The seven days of the week that starts on `monday`, as they will be
 * trained. `withPrep` false skips working out what preparation days work on,
 * for callers that only need the sessions.
 */
export function weekPlan(world: World, club: Club, monday: number, withPrep = true): PlannedDay[] {
  const plan = readPlan(world, club);
  const { focus, intensity } = weekSettingsFor(world, club, monday);
  const days: PlannedDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = monday + i;
    const fixture = clubFixtureOn(world, club.id, day);
    const next = clubFixtureOn(world, club.id, day + 1);
    let session: SessionType;
    if (fixture !== undefined) session = 'match';
    else if (next !== undefined) session = 'preparation';
    else if (clubFixtureOn(world, club.id, day - 1) !== undefined) session = 'recovery';
    else session = plannedSession(focus, day, i);
    const own = plan.days[day];
    const manual = own !== undefined && session !== 'match' && own !== 'match';
    if (manual) session = own;
    days.push({
      day, session, intensity, manual, fixture,
      prep: session === 'preparation' && withPrep
        ? plan.prep[day] ?? autoPrep(world, club, next ?? clubFixtureOn(world, club.id, day + 2))
        : undefined,
    });
  }
  // Every week keeps a day of rest: the first training day the plan chose itself.
  if (!days.some((d) => d.session === 'rest' || d.session === 'recovery')) {
    const free = days.find((d) => !d.manual && SESSIONS[d.session].dev >= 0.85);
    if (free !== undefined) free.session = 'rest';
  }
  return days;
}

/** A day of the plan, as the profile under the week shows it: development and fatigue, against a normal day. */
export function dayLoad(d: PlannedDay): { dev: number; load: number } {
  const s = SESSIONS[d.session];
  const i = INTENSITY[d.intensity];
  return { dev: s.dev * i.dev, load: Math.max(0, s.load * i.load) };
}

// ---- Each player ----------------------------------------------------------------------

/** What the assistant would set a player to work on: the weakest part of his game for his position. */
export function assistantFocus(world: World, p: number): Exclude<IndividualFocus, 'auto'> {
  const store = world.players;
  const options = POSITION_FOCUSES[store.position[p] as Position];
  const base = p * ATTR_COUNT;
  let best = options[0];
  let lowest = Infinity;
  for (const f of options) {
    const idx = FOCUS_IDX[f];
    let sum = 0;
    for (const a of idx) sum += store.attrs[base + a];
    const avg = sum / idx.length;
    if (avg < lowest) {
      lowest = avg;
      best = f;
    }
  }
  return best;
}

/** And how hard: a player coming back from injury or short of condition does less. */
export function assistantLoad(world: World, p: number): PlayerLoad {
  const store = world.players;
  if (store.injuryDaysLeft[p] > 0 || store.condition[p] < 60) return 'rest';
  if (store.condition[p] < 75) return 'reduced';
  return 'normal';
}

/** A player's programme as it stands: his own, or the assistant's. */
export function individualOf(world: World, club: Club, p: number): { focus: IndividualFocus; load: PlayerLoad; byAssistant: boolean } {
  const plan = readPlan(world, club);
  const own = plan.individual[p];
  if (plan.assistantIndividual || own === undefined) {
    return { focus: assistantFocus(world, p), load: assistantLoad(world, p), byAssistant: plan.assistantIndividual };
  }
  return { ...own, byAssistant: false };
}

/** Just how hard a player's programme has him working — all the daily and injury sums need. */
export function loadOf(world: World, club: Club, p: number): PlayerLoad {
  const plan = readPlan(world, club);
  const own = plan.individual[p];
  return plan.assistantIndividual || own === undefined ? assistantLoad(world, p) : own.load;
}

// ---- What it does ----------------------------------------------------------------------

/**
 * The day's training at every club: condition spent on a training day (as
 * hard as the session, the week and the player's own load make it), given
 * back on a day of rest. Called each morning, before the day's recovery.
 */
export function trainingDay(world: World): void {
  const monday = weekStartOf(world, world.day);
  const store = world.players;
  for (const club of world.clubs) {
    if (club.players.length === 0) continue;
    const today = weekPlan(world, club, monday, false)[world.day - monday];
    if (today === undefined || today.session === 'match') continue;
    const s = SESSIONS[today.session];
    for (const p of club.players) {
      if (store.injuryDaysLeft[p] > 0) continue;
      const own = PLAYER_LOAD[loadOf(world, club, p)];
      const change = s.load >= 0 ? -s.load * INTENSITY[today.intensity].load * own.load * 2.4 : -s.load * 3;
      store.condition[p] = Math.max(25, Math.min(100, store.condition[p] + change));
    }
  }
  // Days gone by have nothing more to look up.
  const days = dayIndex.get(world);
  if (days !== undefined) for (const d of days.keys()) if (d < world.day - 14) days.delete(d);
}

/**
 * The week a club has just trained, summed up: its development and load, and
 * the pull its sessions had on each attribute — with each individual focus on
 * top, worked out the first time a player of the club has it.
 */
export interface ClubWeek {
  dev: number;
  load: number;
  bias: Map<IndividualFocus, Float64Array>;
}

export function clubWeek(world: World, club: Club): ClubWeek {
  const days = weekPlan(world, club, weekStartOf(world, world.day - 1), false);
  let dev = 0;
  let load = 0;
  const kinds = { physical: 0, technical: 0, tactical: 0 };
  for (const d of days) {
    const l = dayLoad(d);
    dev += l.dev;
    load += l.load;
    const b = SESSIONS[d.session].builds;
    if (b === 'physical' || b === 'technical' || b === 'tactical') kinds[b] += l.dev;
  }
  // The kind of sessions the week held pulls development their way.
  const bias = new Float64Array(ATTR_COUNT).fill(1);
  const total = Math.max(0.01, dev);
  for (const k of ['physical', 'technical', 'tactical'] as const) {
    for (const a of KIND_IDX[k]) bias[a] += (kinds[k] / total) * 1.5;
  }
  return { dev, load, bias: new Map([['auto', bias]]) };
}

/** How much likelier an injury a player's week has made him. */
export function weekInjury(world: World, club: Club, p: number, week: ClubWeek): number {
  return Math.max(0.5, (week.load / NORMAL_WEEK_LOAD) * PLAYER_LOAD[loadOf(world, club, p)].load);
}

/**
 * The week just trained, as weeklyTraining applies it to one player: how much
 * of a typical week's development he gets, which attributes it goes into (his
 * own focus, and the kind of sessions the week held), and how much likelier
 * an injury his week has made.
 */
export function weekEffect(world: World, club: Club, p: number, week: ClubWeek = clubWeek(world, club)): {
  dev: number; bias: Float64Array; injury: number;
} {
  const own = individualOf(world, club, p);
  const ownLoad = PLAYER_LOAD[own.load];
  // His own focus pulls hardest of all.
  let bias = week.bias.get(own.focus);
  if (bias === undefined) {
    bias = Float64Array.from(week.bias.get('auto')!);
    if (own.focus !== 'auto') for (const a of FOCUS_IDX[own.focus]) bias[a] += 2.5;
    week.bias.set(own.focus, bias);
  }
  return {
    dev: (week.dev / NORMAL_WEEK_DEV) * ownLoad.dev,
    bias,
    injury: Math.max(0.5, (week.load / NORMAL_WEEK_LOAD) * ownLoad.load),
  };
}

// ---- Learning a position ------------------------------------------------------------

/** Familiarity a normal week's work on a new position brings, 0-100. */
const POSITION_WEEK = 4.5;
/** And a match played there. */
export const POSITION_MATCH = 3;

/** The position a player of the user's is learning, if any. */
export function positionTarget(world: World, club: Club, p: number): Position | null {
  if (club.id !== world.userClubId) return null;
  const target = club.training?.positions?.[p];
  return target === undefined || target === world.players.position[p] ? null : target;
}

/** Set it — null to stop. */
export function setPositionTarget(club: Club, p: number, pos: Position | null): void {
  const plan = planOf(club);
  plan.positions ??= {};
  if (pos === null) delete plan.positions[p];
  else plan.positions[p] = pos;
}

/**
 * A week's work on new positions at the user's club: each player learning one
 * gains a few points of familiarity — more if he is young and coachable,
 * nothing if he is injured or resting. A position learnt in full is his;
 * the manager hears of it, and the player goes back to his normal work.
 */
export function trainPositions(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const plan = club?.training?.positions;
  if (club === undefined || plan === undefined) return;
  const store = world.players;
  for (const key of Object.keys(plan)) {
    const p = Number(key);
    const pos = plan[p];
    if (!club.players.includes(p) || store.position[p] === pos) {
      delete plan[p];
      continue;
    }
    if (store.injuryDaysLeft[p] > 0) continue;
    const age = store.ageOn(p, world.year, 181);
    const young = age <= 21 ? 1.3 : age <= 25 ? 1.1 : age <= 29 ? 1 : 0.75;
    const coachable = 0.7 + (store.getAttr(p, 'coachability') / 20) * 0.6;
    const load = PLAYER_LOAD[loadOf(world, club, p)].dev;
    const before = store.familiarityWith(p, pos);
    store.setFamiliarity(p, pos, before + POSITION_WEEK * young * coachable * load);
    if (store.familiarityWith(p, pos) >= 100) {
      delete plan[p];
      postMessage(world, {
        subject: `${store.fullName(p)} can play ${POSITION_NAME_LOWER[pos]}`,
        body: `${store.fullName(p)} has learnt to play ${POSITION_NAME_LOWER[pos]} — he is accomplished there now, ` +
          'and goes back to his normal training.',
        playerIdx: p,
        from: 'Coaching Staff',
        category: 'task',
      });
    }
  }
}

const POSITION_NAME_LOWER: Readonly<Record<Position, string>> = {
  [Position.Setter]: 'setter',
  [Position.OutsideHitter]: 'outside hitter',
  [Position.Opposite]: 'opposite',
  [Position.MiddleBlocker]: 'middle blocker',
  [Position.Libero]: 'libero',
};

/**
 * The next match's preparation: how much of each part of the game the days
 * before it covered (1 a day's work on it, at most 1). The engine gives the
 * side a little more in each.
 */
export function prepCoverage(world: World, club: Club, matchDay: number): Record<PrepArea, number> {
  const out: Record<PrepArea, number> = { reception: 0, transition: 0, block: 0, combinations: 0 };
  for (let d = matchDay - 3; d < matchDay; d++) {
    const day = weekPlan(world, club, weekStartOf(world, d)).find((x) => x.day === d);
    if (day?.session === 'preparation' && day.prep !== undefined) {
      out[day.prep] = Math.min(1, out[day.prep] + INTENSITY[day.intensity].dev);
    } else if (day?.session === 'tactical') {
      // A tactical day gives a little of everything.
      for (const k of Object.keys(out) as PrepArea[]) out[k] = Math.min(1, out[k] + 0.25);
    }
  }
  return out;
}

/** The squad as the week finds it: on reduced work or resting, injured, and at risk of breaking down. */
export function squadReadiness(world: World, club: Club): { lighter: number; injured: number; atRisk: number } {
  const store = world.players;
  let lighter = 0;
  let injured = 0;
  let atRisk = 0;
  for (const p of club.players) {
    if (store.injuryDaysLeft[p] > 0) {
      injured++;
      continue;
    }
    const load = individualOf(world, club, p).load;
    if (load === 'rest' || load === 'reduced') lighter++;
    if (store.condition[p] < 60 || (store.getAttr(p, 'injuryProneness') >= 15 && load === 'extra')) atRisk++;
  }
  return { lighter, injured, atRisk };
}
