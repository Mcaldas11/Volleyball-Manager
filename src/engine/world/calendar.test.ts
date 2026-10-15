import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarOf, dateDay, intlEventDays, LEGACY_CALENDAR, seasonDay } from './calendar.ts';
import { formatDay } from './inbox.ts';

const men = { startYear: 2026, season: 0, fivbCalendarFrom: 0 } as const;
const women = { ...men, gender: 'women' } as const;
/** A day as the game shows it, with its year: "Fri 10 Sep 2027". */
const shown = (day: number): string => `${formatDay(men, day)} ${2026 + Math.floor(day / 365) + (day % 365 >= 184 ? 1 : 0)}`;
const span = (w: { start: number; end: number }): string => `${shown(w.start)} – ${shown(w.end)}`;

test('a date is a day of the season: 1 July is 0, 30 June 364, and the weekdays are the real ones', () => {
  assert.equal(seasonDay(7, 1), 0);
  assert.equal(seasonDay(6, 30), 364);
  assert.equal(seasonDay(10, 16), 107);
  assert.equal(shown(dateDay(2026, 2026, 10, 16)), 'Fri 16 Oct 2026');
  assert.equal(shown(dateDay(2026, 2027, 5, 16)), 'Sun 16 May 2027');
});

test("the national teams' summer, as the FIVB has it — the women's and the men's", () => {
  // The Nations League: three weeks, then the finals.
  assert.equal(span(intlEventDays(men, 'nationsLeague', null, 2027)), 'Wed 9 Jun 2027 – Sun 1 Aug 2027');
  assert.equal(span(intlEventDays(women, 'nationsLeague', null, 2027)), 'Wed 2 Jun 2027 – Sun 25 Jul 2027');
  assert.equal(intlEventDays(men, 'nationsLeague', null, 2027).poolDays?.length, 12);
  // In an Olympic year it is over in June.
  assert.equal(span(intlEventDays(men, 'nationsLeague', null, 2028)), 'Wed 24 May 2028 – Sun 25 Jun 2028');
  assert.equal(span(intlEventDays(women, 'nationsLeague', null, 2028)), 'Wed 10 May 2028 – Sun 11 Jun 2028');
  // The World Championship (the World Cup from 2027): the women in late August, the men in September.
  assert.equal(span(intlEventDays(men, 'worlds', null, 2027)), 'Fri 10 Sep 2027 – Sun 26 Sep 2027');
  assert.equal(span(intlEventDays(women, 'worlds', null, 2027)), 'Fri 20 Aug 2027 – Sun 5 Sep 2027');
  // Los Angeles 2028.
  assert.equal(span(intlEventDays(women, 'olympics', null, 2028)), 'Sat 15 Jul 2028 – Sun 30 Jul 2028');
  // The continental championships of 2026.
  assert.equal(span(intlEventDays(men, 'continental', 'CEV', 2026)), 'Wed 9 Sep 2026 – Sat 26 Sep 2026');
  assert.equal(span(intlEventDays(women, 'continental', 'CEV', 2026)), 'Fri 21 Aug 2026 – Sun 6 Sep 2026');
  assert.equal(span(intlEventDays(men, 'continental', 'AVC', 2026)), 'Fri 4 Sep 2026 – Sun 13 Sep 2026');
  assert.equal(span(intlEventDays(men, 'continental', 'NORCECA', 2026)), 'Fri 11 Sep 2026 – Sat 19 Sep 2026');
  assert.equal(span(intlEventDays(men, 'continental', 'CAVB', 2026)), 'Sun 13 Sep 2026 – Sat 26 Sep 2026');
  assert.equal(span(intlEventDays(men, 'continental', 'CSV', 2026)), 'Tue 15 Sep 2026 – Sun 20 Sep 2026');
  // Squads a week before.
  const w = intlEventDays(men, 'worlds', null, 2027);
  assert.equal(w.start - w.callUp, 7);
});

test("the clubs' October to May: the leagues, the Champions League's Final Four, the Club World Championship in December", () => {
  const m = calendarOf(men);
  const f = calendarOf(women);
  const at = (d: number): string => shown(d);
  assert.equal(at(m.leagueStart), 'Fri 16 Oct 2026');
  assert.equal(at(f.leagueStart), 'Fri 2 Oct 2026');
  assert.equal(at(m.championsLeague.knockoutDays[2]), 'Sun 16 May 2027');
  assert.equal(at(f.championsLeague.knockoutDays[2]), 'Sun 2 May 2027');
  assert.equal(at(m.clubWorld.groupDays[0]), 'Mon 14 Dec 2026');
  assert.equal(at(m.clubWorld.knockoutDays[1]), 'Sun 20 Dec 2026');
  assert.equal(at(f.clubWorld.knockoutDays[1]), 'Sun 13 Dec 2026');
  assert.equal(m.rollover, 364, 'the season closes on 30 June');
  // The season before the Games finishes nine days early: the Nations League starts in May.
  const olympic = calendarOf(men, 1);
  assert.equal(m.clubSeasonEnd - olympic.clubSeasonEnd, 9);
  // Everything in its order.
  for (const cal of [m, f, olympic]) {
    assert.ok(cal.supercup < cal.leagueStart && cal.leagueStart < cal.leagueEnd && cal.leagueEnd < cal.playoffStart);
    assert.ok(cal.nationalCup.every((d) => d > cal.leagueStart && d <= cal.lastCupDay));
    assert.ok(cal.lastCupDay < cal.playoffStart && cal.playoffStart < cal.clubSeasonEnd && cal.clubSeasonEnd < cal.rollover);
    assert.ok(cal.friendlies.first < cal.friendlies.last && cal.friendlies.last < cal.leagueStart);
  }
});

test('a save from before keeps the old calendar for the season it is in, and takes the FIVB\'s from the next', () => {
  const old = { ...men, season: 4, fivbCalendarFrom: 5 };
  assert.equal(calendarOf(old), LEGACY_CALENDAR);
  assert.equal(calendarOf(old, 5).fivb, true);
  assert.equal(calendarOf({ ...men, fivbCalendarFrom: undefined }).fivb, true, 'a new world is the FIVB\'s');
});
