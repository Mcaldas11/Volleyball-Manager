/**
 * The academy as the manager runs it, beyond its intake and its U19 league:
 * money and time put into the youngsters, with no promise of a star.
 *
 *  - Development programmes: twelve weeks of a prospect's training pointed at
 *    one part of his game. His week's own focus goes there, and now and then a
 *    step of development on top — more of them the more he plays for the U19s,
 *    the better his coaches, the more professional he is, the younger he is.
 *    An intensive one works him harder: more comes of it, and more tiredness,
 *    and more risk of a knock (his training load is raised — see training.ts).
 *    It never lifts what he could become, only how fast he gets there.
 *  - Youth searches: the scouts paid to look at other clubs' academies — at
 *    home, in the confederation or the world — for a position or any. In five
 *    weeks the report comes back with the names they found, if any, and their
 *    guess at what each could become; signing one is a fee of its own.
 *  - The facilities (facilities.ts) are asked for from the same screen.
 *
 * The manager's club only: the other clubs' academies run as they always have.
 */

import { Rng } from '../core/rng.ts';
import { abilityFractionAtAge } from '../model/ability.ts';
import { ATTR_COUNT, ATTR_LABELS, ATTRIBUTES, type AttributeName } from '../model/attributes.ts';
import type { Club } from '../model/club.ts';
import { InjuryType, PlayerFlag } from '../model/players.ts';
import { Position, POSITION_NAMES } from '../model/positions.ts';
import { StaffRole, staffRating } from '../model/staff.ts';
import { injuryNotice, postMessage } from './inbox.ts';
import { NATIONS } from './nations.ts';
import { newsTransfer } from './news.ts';
import { payFee } from './negotiation.ts';
import { clubCoaching, focusedDevelopment } from './progression.ts';
import { FOCUS_ATTRS, FOCUS_LABELS, type IndividualFocus } from './training.ts';
import { euros, logTransfer, seasonEndDay, type World } from './world.ts';

export type ProgrammeArea = Exclude<IndividualFocus, 'auto'>;
export type ProgrammeIntensity = 'normal' | 'intensive';
export type SearchScope = 'national' | 'continental' | 'world';

export const PROGRAMME_AREAS: readonly ProgrammeArea[] =
  ['serving', 'reception', 'attacking', 'blocking', 'setting', 'defence', 'physical', 'mental'];
export const INTENSITY_NAMES: Readonly<Record<ProgrammeIntensity, string>> = { normal: 'Normal', intensive: 'Intensive' };
export const SCOPE_NAMES: Readonly<Record<SearchScope, string>> = { national: 'National', continental: 'Continental', world: 'Worldwide' };

export interface AcademyProgramme {
  playerIdx: number;
  area: ProgrammeArea;
  intensity: ProgrammeIntensity;
  startDay: number;
  endDay: number;
  /** His ability when it began — what it has brought is measured from here. */
  startAbility: number;
  cost: number;
  /** His attributes when it began, by index — for the reports. Absent on programmes from before reports. */
  startAttrs?: number[];
  /** Weeks lost to injury, and knocks the intensive work has cost. */
  weeksLost?: number;
  knocks?: number;
}

export interface AcademySearch {
  scope: SearchScope;
  /** A position, or -1 for any. */
  position: number;
  startDay: number;
  endDay: number;
  cost: number;
}

/** A youngster a search turned up: who he is, where, the scouts' guess at his potential, and what he costs. */
export interface AcademyCandidate {
  playerIdx: number;
  /** His club, or -1 when he has none. */
  fromClubId: number;
  low: number;
  high: number;
  fee: number;
  expiresOn: number;
}

export interface AcademyState {
  /** The season the counts below are for. */
  season: number;
  programmes: AcademyProgramme[];
  /** Programmes run to the end, all careers long. */
  completed: number;
  /** The prospects who have had a programme this season — one each. */
  trained: number[];
  /** Searches paid for this season. */
  searches: number;
  search?: AcademySearch;
  candidates: AcademyCandidate[];
}

/** A training report every four weeks of a programme. */
const REPORT_EVERY = 4;
/** Twelve weeks. */
export const PROGRAMME_DAYS = 84;
export const MAX_PROGRAMMES = 2;
/** Five weeks for a search's report, two searches a season, one at a time. */
export const SEARCH_DAYS = 35;
export const MAX_SEARCHES = 2;
/** How long a candidate waits on an answer. */
const CANDIDATE_DAYS = 28;
/** The most the academy holds. */
export const ACADEMY_MAX = 14;
/**
 * Each week's chance of a step of development on top, before the player, his
 * club and his room to grow are counted in. Measured (see academy.test.ts):
 * across the world's academies a normal programme brings about as much as the
 * twelve weeks' ordinary training does again, an intensive one about half as
 * much more — a prospect on one comes on clearly faster, never past his
 * potential, and a modest one stays modest.
 */
const STEP_CHANCE: Readonly<Record<ProgrammeIntensity, number>> = { normal: 0.42, intensive: 0.64 };
/** Room to grow below which a programme starts to give less: close to his potential, little is left to find. */
const ROOM_FULL = 350;
/** A prospect already ahead of where his age would have him finds less in it. */
const AHEAD_OF_AGE = 0.6;

/** The academy's own state — the season's counts started afresh each summer. */
export function academyState(world: World): AcademyState {
  const a = (world.academy ??= { season: world.season, programmes: [], completed: 0, trained: [], searches: 0, candidates: [] });
  if (a.season !== world.season) {
    a.season = world.season;
    a.trained = a.programmes.map((p) => p.playerIdx);
    a.searches = 0;
  }
  return a;
}

function userClub(world: World): Club | undefined {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
}

/** What a programme costs: more at a bigger club, nearly double for an intensive one. */
export function programmeCost(club: Club, intensity: ProgrammeIntensity): number {
  return Math.round(((3_000 + club.reputation * 1.6) * (intensity === 'intensive' ? 1.8 : 1)) / 100) * 100;
}

/** The programme a player is on, if any. */
export function programmeOf(world: World, p: number): AcademyProgramme | undefined {
  return world.academy?.programmes.find((x) => x.playerIdx === p);
}

/** Why a prospect can't start a programme now, or null. */
export function programmeBlock(world: World, p: number, intensity: ProgrammeIntensity = 'normal'): string | null {
  const club = userClub(world);
  if (club === undefined || !club.youthPlayers.includes(p)) return 'Not in your academy';
  const a = academyState(world);
  if (programmeOf(world, p) !== undefined) return 'Already on a programme';
  if (a.trained.includes(p)) return 'One programme a season';
  if (a.programmes.length >= MAX_PROGRAMMES) return `${MAX_PROGRAMMES} programmes at a time`;
  if (world.players.injuryDaysLeft[p] > 0) return 'Injured';
  if (club.finances.balance < programmeCost(club, intensity)) return 'Not enough money';
  return null;
}

/** Put a prospect on a programme: paid now, twelve weeks from today. */
export function startProgramme(world: World, p: number, area: ProgrammeArea, intensity: ProgrammeIntensity): { ok: boolean; text: string } {
  const block = programmeBlock(world, p, intensity);
  const club = userClub(world);
  if (block !== null || club === undefined) return { ok: false, text: block ?? 'You have no club.' };
  const a = academyState(world);
  const cost = programmeCost(club, intensity);
  club.finances.balance -= cost;
  const store = world.players;
  const base = store.attrBase(p);
  a.programmes.push({
    playerIdx: p, area, intensity, startDay: world.day, endDay: world.day + PROGRAMME_DAYS, startAbility: store.currentAbility[p], cost,
    startAttrs: Array.from(store.attrs.subarray(base, base + ATTR_COUNT)), weeksLost: 0, knocks: 0,
  });
  a.trained.push(p);
  return { ok: true, text: `${store.fullName(p)}: his ${FOCUS_LABELS[area].toLowerCase()} programme (${INTENSITY_NAMES[intensity].toLowerCase()}) starts today, for ${euros(cost)}.` };
}

/** How much a programme's weeks take, 0-1 and over: minutes, coaching, the man himself, his age. */
function programmeYield(world: World, p: number): number {
  const store = world.players;
  const minutes = store.playingTime[p] / 100;
  const coaching = clubCoaching(world, store.clubId[p]);
  const drive = (store.getAttr(p, 'professionalism') + store.getAttr(p, 'determination') + store.getAttr(p, 'coachability')) / 60;
  const age = store.ageOn(p, world.year, 181);
  const young = age <= 16 ? 1.15 : age <= 17 ? 1.05 : 0.95;
  // How much is left to find: all of it far below his potential, less and less as he nears it.
  const ca = store.currentAbility[p];
  const pa = store.potentialAbility[p];
  const room = Math.max(0, Math.min(1, (pa - ca) / ROOM_FULL));
  const ahead = ca > pa * abilityFractionAtAge(age) ? AHEAD_OF_AGE : 1;
  return (0.45 + minutes * 0.6) * (0.55 + coaching * 0.6) * (0.5 + drive * 0.7) * young * room * ahead;
}

/** An intensive programme's week: the chance of a knock — tiredness or a turned ankle — on top of the usual. */
const INTENSIVE_KNOCK = 0.02;

/**
 * One week of a programme for its player: perhaps a step of development in
 * its area (never past what he could be at his age), and on an intensive one
 * perhaps a knock. An injured player's week is lost. Returns what happened.
 */
export function programmeWeek(world: World, prog: AcademyProgramme, rng: Rng): { stepped: boolean; knock: number } {
  const store = world.players;
  const p = prog.playerIdx;
  if (store.injuryDaysLeft[p] > 0) {
    prog.weeksLost = (prog.weeksLost ?? 0) + 1;
    return { stepped: false, knock: 0 };
  }
  let stepped = false;
  if (rng.chance(Math.min(0.95, STEP_CHANCE[prog.intensity] * programmeYield(world, p)))) {
    stepped = focusedDevelopment(world, p, FOCUS_ATTRS[prog.area] as readonly AttributeName[]);
  }
  let knock = 0;
  if (prog.intensity === 'intensive' && rng.chance(INTENSIVE_KNOCK * (0.7 + store.getAttr(p, 'injuryProneness') / 20 * 0.6))) {
    const sprain = rng.chance(0.35);
    knock = sprain ? rng.int(7, 21) : rng.int(3, 10);
    store.injuryDaysLeft[p] = knock;
    store.injuryType[p] = sprain ? InjuryType.AnkleSprain : InjuryType.Fatigue;
    store.setFlag(p, PlayerFlag.Injured, true);
    prog.knocks = (prog.knocks ?? 0) + 1;
    if (store.clubId[p] === world.userClubId) injuryNotice(world, p, store.injuryType[p], knock);
  }
  return { stepped, knock };
}

// ---- The training reports -------------------------------------------------------------

/** The attributes that have gone up since a programme began, most first: "Spike technique +2, Quick attack +1". */
function attributeGains(world: World, prog: AcademyProgramme): Array<[AttributeName, number]> {
  const start = prog.startAttrs;
  if (start === undefined) return [];
  const store = world.players;
  const base = store.attrBase(prog.playerIdx);
  const out: Array<[AttributeName, number]> = [];
  ATTRIBUTES.forEach((name, i) => {
    const d = store.attrs[base + i] - start[i];
    if (d > 0) out.push([name, d]);
  });
  return out.sort((x, y) => y[1] - x[1]);
}

/** The youth coach's word on how it is going, from the pace of it. */
function coachVerdict(world: World, prog: AcademyProgramme, weeks: number): string {
  const store = world.players;
  const p = prog.playerIdx;
  const gain = store.currentAbility[p] - prog.startAbility;
  const perWeek = gain / Math.max(1, weeks);
  const lines: string[] = [];
  if (store.currentAbility[p] >= store.potentialAbility[p] - 20) lines.push('He is close to as good as he is ever likely to be — there is little left for a programme to find.');
  else if (perWeek >= 2.5) lines.push('He is flying. Whatever we are doing, it is working.');
  else if (perWeek >= 1) lines.push('Steady progress — it is going in the right direction.');
  else if (perWeek > 0) lines.push('Slow going so far. These things often take a while to show.');
  else lines.push('Nothing to show for it yet. Not every lad takes to it.');
  if (store.playingTime[p] < 40) lines.push('He needs more minutes for the U19s — the work sticks far better when he plays.');
  if ((prog.knocks ?? 0) > 0) lines.push(`The intensive work has cost him ${prog.knocks === 1 ? 'a knock' : `${prog.knocks} knocks`} — it is the price of pushing him.`);
  else if ((prog.weeksLost ?? 0) > 0) lines.push(`He has missed ${prog.weeksLost} week${prog.weeksLost === 1 ? '' : 's'} of it injured.`);
  return lines.join(' ');
}

/** A training report to the inbox: the ability, the attributes that have gone up, and the coach's verdict. */
function programmeReport(world: World, prog: AcademyProgramme, week: number, final: boolean): void {
  const store = world.players;
  const p = prog.playerIdx;
  const name = store.fullName(p);
  const area = FOCUS_LABELS[prog.area].toLowerCase();
  const now = store.currentAbility[p];
  const gain = now - prog.startAbility;
  const gains = attributeGains(world, prog).slice(0, 6).map(([a, d]) => `${ATTR_LABELS[a]} +${d}`);
  const ability = `Ability: ${prog.startAbility} → ${now} (${gain >= 0 ? '+' : ''}${gain}).`;
  const improved = gains.length > 0 ? `Improved: ${gains.join(', ')}.` : 'No attribute has moved yet.';
  postMessage(world, {
    category: 'staff', from: 'Youth development',
    subject: final ? `Programme over: ${name}` : `Training report: ${name} — week ${week} of 12`,
    body: (final
      ? `${name}'s twelve-week ${area} programme (${INTENSITY_NAMES[prog.intensity].toLowerCase()}) is over.`
      : `${name}, ${week} weeks into his ${area} programme (${INTENSITY_NAMES[prog.intensity].toLowerCase()}).`) +
      `\n${ability}\n${improved}\n${coachVerdict(world, prog, week)}`,
    playerIdx: p,
  });
}

// ---- Searches -------------------------------------------------------------------------

/** What a search costs: the further the scouts go, the more. */
export function searchCost(club: Club, scope: SearchScope): number {
  const reach = scope === 'national' ? 1 : scope === 'continental' ? 1.9 : 3.2;
  return Math.round(((5_000 + club.reputation * 2.2) * reach) / 100) * 100;
}

/** Why a search can't be paid for now, or null. */
export function searchBlock(world: World, scope: SearchScope = 'national'): string | null {
  const club = userClub(world);
  if (club === undefined) return 'You have no club.';
  const a = academyState(world);
  if (a.search !== undefined) return 'A search is already under way';
  if (a.searches >= MAX_SEARCHES) return `${MAX_SEARCHES} searches a season`;
  if (club.finances.balance < searchCost(club, scope)) return 'Not enough money';
  return null;
}

/** Send the scouts out: paid now, their report in five weeks. */
export function startSearch(world: World, scope: SearchScope, position: number): { ok: boolean; text: string } {
  const block = searchBlock(world, scope);
  const club = userClub(world);
  if (block !== null || club === undefined) return { ok: false, text: block ?? 'You have no club.' };
  const a = academyState(world);
  const cost = searchCost(club, scope);
  club.finances.balance -= cost;
  a.search = { scope, position, startDay: world.day, endDay: world.day + SEARCH_DAYS, cost };
  a.searches++;
  const what = position >= 0 ? `${POSITION_NAMES[position as Position].toLowerCase()}s` : 'prospects';
  return { ok: true, text: `The scouts are looking for ${what} (${SCOPE_NAMES[scope].toLowerCase()}, ${euros(cost)}). Their report is due in five weeks.` };
}

/** The user's best judge of a youngster, 0-1: his scouts — or a guess without any. */
function scoutJudgement(world: World, club: Club): number {
  let best = 6;
  for (const sid of club.staff) {
    const s = world.staff[sid];
    if (s !== undefined && (s.role === StaffRole.Scout || s.role === StaffRole.HeadScout || s.role === StaffRole.RecruitmentAnalyst)) {
      best = Math.max(best, staffRating(s));
    }
  }
  return best / 20;
}

/** The youngsters a search could turn up: other academies' players, and unattached ones of their age, in its reach. */
function searchPool(world: World, club: Club, search: AcademySearch): Array<{ p: number; from: number }> {
  const store = world.players;
  const home = club.nation;
  const confed = NATIONS[home]?.confederation;
  const inReach = (nation: number): boolean =>
    search.scope === 'world' || nation === home || (search.scope === 'continental' && NATIONS[nation]?.confederation === confed);
  const fits = (p: number): boolean => store.isActive(p) && (search.position < 0 || store.position[p] === search.position);
  const out: Array<{ p: number; from: number }> = [];
  for (const c of world.clubs) {
    if (c.id === club.id || !inReach(c.nation)) continue;
    for (const p of c.youthPlayers) if (fits(p)) out.push({ p, from: c.id });
  }
  for (let p = 0; p < store.count; p++) {
    if (store.clubId[p] !== -1 || !fits(p) || store.hasFlag(p, PlayerFlag.Retired) || !inReach(store.nation[p])) continue;
    const age = store.ageOn(p, world.year, 181);
    if (age >= 15 && age <= 17) out.push({ p, from: -1 });
  }
  return out;
}

/** The report comes in: up to three names, the best the scouts could find — or none. */
function finishSearch(world: World, club: Club, a: AcademyState, search: AcademySearch): void {
  const store = world.players;
  const rng = new Rng(world.season * 7_919 + search.startDay * 31 + club.id);
  const judge = scoutJudgement(world, club);
  const reach = club.youthRecruitment / 20;
  // Whether they find anyone, and how many.
  const found = rng.chance(0.55 + reach * 0.25 + judge * 0.15) ? 1 + rng.weightedIndex([1, 0.8 + reach, 0.3 + judge]) : 0;
  const known = new Set(a.candidates.map((c) => c.playerIdx));
  const picks = searchPool(world, club, search)
    .filter((x) => !known.has(x.p))
    .map((x) => ({ ...x, pull: store.potentialAbility[x.p] * rng.range(0.6, 1.4) }))
    .sort((x, y) => y.pull - x.pull)
    .slice(0, found);
  const lines: string[] = [];
  for (const { p, from } of picks) {
    const pa = store.potentialAbility[p];
    // The better the scout, the closer the guess.
    const err = 80 + (1 - judge) * 380;
    const low = Math.max(100, Math.round((pa - err * rng.range(0.3, 1)) / 10) * 10);
    const high = Math.min(2000, Math.round((pa + err * rng.range(0.3, 1)) / 10) * 10);
    const fee = from >= 0
      ? Math.max(5_000, Math.round((Math.max(2_000, store.value[p]) * rng.range(0.9, 1.4)) / 1000) * 1000)
      : Math.round(rng.range(2_000, 6_000) / 500) * 500;
    a.candidates.push({ playerIdx: p, fromClubId: from, low, high, fee, expiresOn: world.day + CANDIDATE_DAYS });
    const where = from >= 0 ? world.clubs[from]?.name ?? '?' : 'no club';
    lines.push(`${store.fullName(p)} (${POSITION_NAMES[store.position[p] as Position]}, ${store.ageOn(p, world.year, 181)}, ${where}) — potential ${low}–${high}, ${euros(fee)}`);
  }
  a.search = undefined;
  const what = search.position >= 0 ? `${POSITION_NAMES[search.position as Position].toLowerCase()}s` : 'prospects';
  postMessage(world, {
    category: 'staff', from: 'Youth recruitment',
    subject: lines.length > 0 ? `Youth search: ${lines.length} name${lines.length === 1 ? '' : 's'}` : 'Youth search: nobody worth it',
    body: lines.length > 0
      ? `The scouts' report on ${what} (${SCOPE_NAMES[search.scope].toLowerCase()}):\n${lines.join('\n')}\n` +
        `They can be signed for the academy from its Recruitment tab for the next four weeks. The potential is the scouts' guess, not a promise.`
      : `The scouts looked at ${what} (${SCOPE_NAMES[search.scope].toLowerCase()}) and found nobody worth bringing in. It happens.`,
  });
}

/** Why a candidate can't be signed now, or null. */
export function signBlock(world: World, c: AcademyCandidate): string | null {
  const club = userClub(world);
  if (club === undefined) return 'You have no club.';
  const store = world.players;
  if (!store.isActive(c.playerIdx) || store.clubId[c.playerIdx] !== c.fromClubId) return 'He is no longer available';
  if (club.youthPlayers.length >= ACADEMY_MAX) return `The academy is full (${ACADEMY_MAX})`;
  if (club.finances.balance < c.fee) return 'Not enough money';
  return null;
}

/** Sign a candidate for the academy: the fee to his club (or to him, without one), and he is yours. */
export function signCandidate(world: World, p: number): { ok: boolean; text: string } {
  const club = userClub(world);
  const a = academyState(world);
  const c = a.candidates.find((x) => x.playerIdx === p);
  if (club === undefined || c === undefined) return { ok: false, text: 'He is no longer on the list.' };
  const block = signBlock(world, c);
  if (block !== null) return { ok: false, text: block };
  const store = world.players;
  const from = c.fromClubId >= 0 ? world.clubs[c.fromClubId] : undefined;
  if (from !== undefined) {
    from.youthPlayers = from.youthPlayers.filter((x) => x !== p);
    payFee(world, club, from.id, c.fee);
  } else {
    club.finances.balance -= c.fee;
  }
  club.youthPlayers.push(p);
  store.clubId[p] = club.id;
  store.setFlag(p, PlayerFlag.Youth, true);
  store.setFlag(p, PlayerFlag.Transferable, false);
  store.contractUntil[p] = seasonEndDay(world.season + 2);
  logTransfer(world, p, c.fromClubId, club.id, c.fee);
  newsTransfer(world, p, c.fromClubId, club.id, c.fee);
  a.candidates = a.candidates.filter((x) => x !== c);
  return { ok: true, text: `${store.fullName(p)} joins the academy${from !== undefined ? ` from ${from.name}` : ''}, for ${euros(c.fee)}.` };
}

/** Turn a candidate down. */
export function dismissCandidate(world: World, p: number): void {
  const a = academyState(world);
  a.candidates = a.candidates.filter((x) => x.playerIdx !== p);
}

// ---- Each day -------------------------------------------------------------------------

/**
 * The academy's day: a programme's week done (a step of development, maybe),
 * a programme over (its report), a search's report in, a candidate no longer
 * waiting.
 */
export function academyDay(world: World): void {
  const club = userClub(world);
  const a = world.academy;
  if (club === undefined || a === undefined) return;
  const store = world.players;
  for (const prog of [...a.programmes]) {
    const p = prog.playerIdx;
    // Gone from the academy — promoted, sold, lent, released: the programme goes with him.
    if (!club.youthPlayers.includes(p) || !store.isActive(p)) {
      a.programmes = a.programmes.filter((x) => x !== prog);
      continue;
    }
    const days = world.day - prog.startDay;
    if (days > 0 && days % 7 === 0) {
      programmeWeek(world, prog, new Rng(store.id[p] * 101 + world.day));
      // A training report every four weeks; the last one is the final word.
      const week = days / 7;
      if (week % REPORT_EVERY === 0 && world.day < prog.endDay) programmeReport(world, prog, week, false);
    }
    if (world.day >= prog.endDay) {
      a.programmes = a.programmes.filter((x) => x !== prog);
      a.completed++;
      programmeReport(world, prog, PROGRAMME_DAYS / 7, true);
    }
  }
  if (a.search !== undefined && world.day >= a.search.endDay) finishSearch(world, club, a, a.search);
  if (a.candidates.length > 0) a.candidates = a.candidates.filter((c) => c.expiresOn > world.day);
}
