/**
 * The volleyball year as the FIVB lays it out — its 2025–2028 calendar,
 * approved in June 2023 and updated in December 2025 — in days of the season,
 * 0 being 1 July and 364 the 30 June after.
 *
 * The national teams have the summer: the Nations League from early June to
 * the start of August, then the summer's major — the World Championship in an
 * odd year, the continental championships in an even one, the Olympic Games
 * every fourth. The clubs have October to May: the leagues, the cups, the
 * Champions League and its Final Four in May, the Club World Championship in
 * December. The women's clubs start and finish a fortnight before the men's,
 * and in the season before an Olympic summer both finish early, the Nations
 * League starting in May.
 *
 * A save from before this keeps the old calendar for the season it was in —
 * that season's fixtures were drawn to it — and takes this one up from the
 * next.
 */

import type { Confederation } from './nations.ts';
import type { World } from './world.ts';

/** The first day of each month in the season, July first; a season is 365 days, February 28. */
const MONTH_START: Readonly<Record<number, number>> = {
  7: 0, 8: 31, 9: 62, 10: 92, 11: 123, 12: 153, 1: 184, 2: 215, 3: 243, 4: 274, 5: 304, 6: 335,
};

/** The day of the season of a date: 1 July is 0, 30 June 364. */
export function seasonDay(month: number, day: number): number {
  return MONTH_START[month] + day - 1;
}

/** The absolute day of a date, in a world whose first season began on 1 July of `startYear`. */
export function dateDay(startYear: number, year: number, month: number, day: number): number {
  const seasonYear = month >= 7 ? year : year - 1;
  return (seasonYear - startYear) * 365 + seasonDay(month, day);
}

/** A club competition's days: its group matchdays, then its knockout rounds, the final last. */
export interface CupDays {
  groupDays: number[];
  knockoutDays: number[];
}

export interface ClubCalendar {
  /** The FIVB's calendar — or the one saves from before it were drawn to. */
  fivb: boolean;
  /** The first league round, and the last day a regular-season round may be on. */
  leagueStart: number;
  leagueEnd: number;
  /** The league playoffs begin. */
  playoffStart: number;
  /** The last day of club volleyball: every club competition is over by it. */
  clubSeasonEnd: number;
  /** The day the season is closed and the next one begins. */
  rollover: number;
  /** Where the phases change: pre-season, regular season, playoffs, the national teams' weeks. */
  regularFrom: number;
  playoffsFrom: number;
  nationalFrom: number;
  /** Until this day of the summer, a national team may play a friendly. */
  summerFriendliesUntil: number;
  supercup: number;
  /** A national cup's rounds, the final last; a smaller draw starts later. */
  nationalCup: number[];
  /** Nothing of a national cup, the CEV Cup or the Champions League before its Final Four after this day. */
  lastCupDay: number;
  championsLeague: CupDays;
  cevCup: number[];
  clubWorld: CupDays;
  /** The other confederations' club championships: a week at one venue each. */
  continental: Readonly<Record<Exclude<Confederation, 'CEV'>, CupDays>>;
  /** The clubs' pre-season friendlies. */
  friendlies: { first: number; last: number };
}

/** The calendar saves from before the FIVB's were drawn to: the clubs from late August to May. */
export const LEGACY_CALENDAR: ClubCalendar = {
  fivb: false,
  leagueStart: 60,
  leagueEnd: 265,
  playoffStart: 272,
  clubSeasonEnd: 309,
  rollover: 350,
  regularFrom: 55,
  playoffsFrom: 275,
  nationalFrom: 310,
  summerFriendliesUntil: 45,
  supercup: 48,
  nationalCup: [78, 118, 158, 200, 240],
  lastCupDay: 266,
  championsLeague: { groupDays: [88, 102, 116, 130, 144, 158], knockoutDays: [205, 230, 255] },
  cevCup: [95, 137, 186, 236],
  clubWorld: { groupDays: [163, 167, 171], knockoutDays: [176, 181] },
  continental: {
    CSV: { groupDays: [110, 140, 196], knockoutDays: [222, 250] },
    NORCECA: { groupDays: [110, 140, 196], knockoutDays: [222, 250] },
    AVC: { groupDays: [110, 140, 196], knockoutDays: [222, 250] },
    CAVB: { groupDays: [110, 140, 196], knockoutDays: [222, 250] },
  },
  friendlies: { first: 7, last: 52 },
};

/** A week's tournament at one venue: three group days running, the semi-finals and the final. */
function week(first: number, semi: number): CupDays {
  return { groupDays: [first, first + 1, first + 2], knockoutDays: [semi, semi + 1] };
}

function fivbCalendar(women: boolean, olympicClose: boolean): ClubCalendar {
  const d = seasonDay;
  // The women's clubs start and finish a fortnight ahead of the men's…
  const w = women ? 14 : 0;
  // …and in the season before an Olympic summer everyone finishes nine days early.
  const o = olympicClose ? 9 : 0;
  // Men: 16 October to 17 May (2026–27); women: 2 October to 3 May.
  const leagueStart = d(10, 16) - w;
  const playoffStart = d(3, 30) - w - o;
  const clubSeasonEnd = d(5, 17) - w - o;
  return {
    fivb: true,
    leagueStart,
    leagueEnd: playoffStart - 7,
    playoffStart,
    clubSeasonEnd,
    // The season closes on 30 June.
    rollover: 364,
    regularFrom: leagueStart,
    playoffsFrom: playoffStart,
    nationalFrom: clubSeasonEnd + 1,
    summerFriendliesUntil: leagueStart - 14,
    // The super cups open the season, a few days before the leagues.
    supercup: leagueStart - 5,
    nationalCup: [d(10, 29), d(11, 26), d(1, 7), d(1, 28), d(2, 25)].map((x) => x - w),
    lastCupDay: playoffStart - 6,
    // The Champions League: matchdays from December to March, the Final Four in May
    // (15–16 May for the men in 2027, 1–2 May for the women).
    championsLeague: {
      groupDays: [d(12, 9), d(1, 6), d(1, 20), d(2, 3), d(2, 17), d(3, 3)].map((x) => x - w),
      knockoutDays: [d(3, 17) - w, d(5, 15) - w - o, d(5, 16) - w - o],
    },
    cevCup: [d(11, 12), d(12, 3), d(1, 28), d(3, 11)].map((x) => x - w),
    // The Club World Championship: 14–20 December for the men, 7–13 for the women (2026).
    clubWorld: women ? week(d(12, 7), d(12, 12)) : week(d(12, 14), d(12, 19)),
    continental: women
      ? {
        // South America 18–22 February (Lima 2026); Asia 26–30 April (Goyang 2026); Africa in April.
        CSV: week(d(2, 18), d(2, 21)),
        AVC: week(d(4, 26) - o, d(4, 29) - o),
        CAVB: week(d(4, 9) - o, d(4, 12) - o),
        NORCECA: week(d(3, 13) - w, d(3, 16) - w),
      }
      : {
        // Asia 13–17 May (Pontianak 2026); Africa 20 April – 3 May (Rwanda 2026).
        CSV: week(d(2, 25), d(2, 28)),
        AVC: week(d(5, 13) - o, d(5, 16) - o),
        CAVB: week(d(4, 25) - o, d(5, 2) - o),
        NORCECA: week(d(3, 13), d(3, 16)),
      },
    friendlies: { first: leagueStart - 35, last: leagueStart - 4 },
  };
}

const CALENDARS = new Map<string, ClubCalendar>();

/** The club calendar of a world's season: the FIVB's — a woman's or a man's, Olympic or not — or, for the season a save from before it was in, the old one. */
export function calendarOf(world: Pick<World, 'season' | 'startYear' | 'gender' | 'fivbCalendarFrom'>, season = world.season): ClubCalendar {
  if (season < (world.fivbCalendarFrom ?? 0)) return LEGACY_CALENDAR;
  const women = world.gender === 'women';
  // The season ends in the June of the year after it starts: an Olympic year, every fourth.
  const olympicClose = (world.startYear + season + 1) % 4 === 0;
  const key = `${women}:${olympicClose}`;
  let cal = CALENDARS.get(key);
  if (cal === undefined) CALENDARS.set(key, cal = fivbCalendar(women, olympicClose));
  return cal;
}

/** The calendar of the season an absolute day falls in. */
export function calendarOn(world: Pick<World, 'season' | 'startYear' | 'gender' | 'fivbCalendarFrom'>, day: number): ClubCalendar {
  return calendarOf(world, Math.floor(day / 365));
}

// ---- The national teams' -------------------------------------------------------------

/** A date in a year: month and day. */
type MonthDay = readonly [number, number];

/** A tournament's span: the first match and the last, and — for the Nations League — the days of its preliminary weeks. */
export interface EventDates {
  start: MonthDay;
  end: MonthDay;
  /** Match days before the knockout rounds, where they are fixed: the Nations League's three weeks. */
  poolDays?: readonly MonthDay[];
}

/** A Nations League week: four match days of five. */
function vnlWeek(month: number, day: number): MonthDay[] {
  const out: MonthDay[] = [];
  for (const k of [0, 1, 3, 4]) {
    const s = seasonDay(month, day) + k;
    out.push(monthDayOf(s));
  }
  return out;
}

function monthDayOf(s: number): MonthDay {
  let month = 7;
  for (const m of [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]) if (MONTH_START[m] <= s) month = m;
  return [month, s - MONTH_START[month] + 1];
}

/**
 * The Nations League of a year. 2025–2027 as the FIVB set them; an Olympic
 * year's in May and June, ending a month before the Games; every other year
 * as 2026's: the women 3 June to 26 July, the men 10 June to 2 August — three
 * preliminary weeks, and the finals.
 */
function nationsLeagueDates(year: number, women: boolean): EventDates {
  if (year % 4 === 0) {
    // 2028: the women 8 May – 11 June, the men 22 May – 25 June.
    return women
      ? { start: [5, 10], end: [6, 11], poolDays: [...vnlWeek(5, 10), ...vnlWeek(5, 20), ...vnlWeek(5, 30)] }
      : { start: [5, 24], end: [6, 25], poolDays: [...vnlWeek(5, 24), ...vnlWeek(6, 3), ...vnlWeek(6, 13)] };
  }
  if (year === 2025) {
    return women
      ? { start: [6, 4], end: [7, 27], poolDays: [...vnlWeek(6, 4), ...vnlWeek(6, 18), ...vnlWeek(7, 9)] }
      : { start: [6, 11], end: [7, 27], poolDays: [...vnlWeek(6, 11), ...vnlWeek(6, 25), ...vnlWeek(7, 16)] };
  }
  if (year === 2027) {
    return women
      ? { start: [6, 2], end: [7, 25], poolDays: [...vnlWeek(6, 2), ...vnlWeek(6, 16), ...vnlWeek(7, 7)] }
      : { start: [6, 9], end: [8, 1], poolDays: [...vnlWeek(6, 9), ...vnlWeek(6, 23), ...vnlWeek(7, 14)] };
  }
  return women
    ? { start: [6, 3], end: [7, 26], poolDays: [...vnlWeek(6, 3), ...vnlWeek(6, 17), ...vnlWeek(7, 8)] }
    : { start: [6, 10], end: [8, 2], poolDays: [...vnlWeek(6, 10), ...vnlWeek(6, 24), ...vnlWeek(7, 15)] };
}

/** The World Championship — the FIVB's World Cup from 2027 — every odd year: the women in late August, the men in September. */
function worldsDates(year: number, women: boolean): EventDates {
  // 2025 (Thailand, the Philippines): 22 August – 7 September and 12–28 September.
  if (((year - 2025) % 4 + 4) % 4 === 0) return women ? { start: [8, 22], end: [9, 7] } : { start: [9, 12], end: [9, 28] };
  // 2027 (USA and Canada, Poland): 20 August – 5 September and 10–26 September.
  return women ? { start: [8, 20], end: [9, 5] } : { start: [9, 10], end: [9, 26] };
}

/** The Olympic Games: Los Angeles 2028, 15–30 July (the men's final the day before the women's); Brisbane 2032 later in the summer. */
function olympicDates(year: number, women: boolean): EventDates {
  if (year === 2032) return women ? { start: [7, 24], end: [8, 8] } : { start: [7, 24], end: [8, 7] };
  return women ? { start: [7, 15], end: [7, 30] } : { start: [7, 15], end: [7, 29] };
}

/** Each confederation's championship, every even year — after the Games in an Olympic one. As in 2026. */
const CONTINENTAL_DATES: Readonly<Record<Confederation, { women: EventDates; men: EventDates }>> = {
  // EuroVolley: the women 21 August – 6 September, the men 9–26 September.
  CEV: { women: { start: [8, 21], end: [9, 6] }, men: { start: [9, 9], end: [9, 26] } },
  // Asia: the women 21–30 August (Tianjin), the men 4–13 September (Fukuoka).
  AVC: { women: { start: [8, 21], end: [8, 30] }, men: { start: [9, 4], end: [9, 13] } },
  // NORCECA: the women 21–29 August (Santo Domingo), the men 11–19 September (Moncton).
  NORCECA: { women: { start: [8, 21], end: [8, 29] }, men: { start: [9, 11], end: [9, 19] } },
  // Africa: the women 23 August – 5 September (Nairobi), the men 13–26 September (Tunis).
  CAVB: { women: { start: [8, 23], end: [9, 5] }, men: { start: [9, 13], end: [9, 26] } },
  // South America: the women mid-September, the men 15–20 September (Rio de Janeiro).
  CSV: { women: { start: [9, 10], end: [9, 16] }, men: { start: [9, 15], end: [9, 20] } },
};

/** The continental qualifiers, every odd year: in August, between the Nations League and the World Championship. */
function qualifierDates(women: boolean): EventDates {
  return women ? { start: [8, 4], end: [8, 15] } : { start: [8, 11], end: [8, 22] };
}

export type IntlKind = 'nationsLeague' | 'continental' | 'worlds' | 'olympics' | 'qualifier';

/** The dates of a national teams' tournament of a year, the women's or the men's. */
export function intlEventDates(kind: IntlKind, conf: Confederation | null, year: number, women: boolean): EventDates {
  switch (kind) {
    case 'nationsLeague': return nationsLeagueDates(year, women);
    case 'worlds': return worldsDates(year, women);
    case 'olympics': return olympicDates(year, women);
    case 'continental': return CONTINENTAL_DATES[conf ?? 'CEV'][women ? 'women' : 'men'];
    case 'qualifier': return qualifierDates(women);
  }
}

/** Squads are named a week before the first match. */
export const CALL_UP_DAYS = 7;

/**
 * A tournament drawn in a season still on the old calendar — a save from
 * before, in the season it was in: on the old days (season days), all of it
 * over before that season closed on 16 June.
 */
function legacyEventDays(world: Pick<World, 'season'>, kind: IntlKind, year: number): { callUp: number; start: number; end: number } {
  const base = world.season * 365;
  const at = (callUp: number, start: number, runs: number): { callUp: number; start: number; end: number } =>
    ({ callUp: base + callUp, start: base + start, end: base + start + runs });
  switch (kind) {
    case 'nationsLeague': return at(304, 311, 24);
    case 'qualifier': return at(31, 38, 4);
    case 'continental': return year % 4 === 0 ? at(31, 38, 14) : at(8, 15, 14);
    default: return at(8, 15, 12);
  }
}

/** The days a tournament is drawn to in the season being planned: the FIVB's dates — or, in a season still on the old calendar, the old ones. */
export function plannedEventDays(
  world: Pick<World, 'season' | 'startYear' | 'gender' | 'fivbCalendarFrom'>, kind: IntlKind, conf: Confederation | null, year: number,
): { callUp: number; start: number; end: number; poolDays?: number[] } {
  return calendarOf(world).fivb ? intlEventDays(world, kind, conf, year) : legacyEventDays(world, kind, year);
}

/** A tournament's days, as absolute days of a world: call-up, first match, last match, and any fixed match days. */
export function intlEventDays(
  world: Pick<World, 'startYear' | 'gender'>, kind: IntlKind, conf: Confederation | null, year: number,
): { callUp: number; start: number; end: number; poolDays?: number[] } {
  const e = intlEventDates(kind, conf, year, world.gender === 'women');
  const at = ([m, dd]: MonthDay): number => dateDay(world.startYear, year, m, dd);
  const start = at(e.start);
  return {
    callUp: start - CALL_UP_DAYS,
    start,
    end: at(e.end),
    ...(e.poolDays !== undefined ? { poolDays: e.poolDays.map(at) } : {}),
  };
}
