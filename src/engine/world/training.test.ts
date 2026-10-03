import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import {
  SESSIONS, assistantFocus, assistantLoad, clubFixtureOn, dayLoad, individualOf, planOf, prepCoverage, trainingDay,
  weekEffect, weekPlan, weekSettingsFor, weekStartOf, weekdayOf,
} from './training.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { Position } from '../model/positions.ts';

function hired(seed: number): World {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return world;
}

/** The first league match of the user's club, and the Monday of its week. */
function matchWeek(world: World): { matchDay: number; monday: number } {
  let day = world.day;
  while (clubFixtureOn(world, world.userClubId, day) === undefined) day++;
  return { matchDay: day, monday: weekStartOf(world, day) };
}

test('weeks start on Monday, as the calendar shows them', () => {
  const world = hired(601);
  // 1 July 2026 was a Wednesday.
  assert.equal(weekdayOf(world, 0), 2);
  assert.equal(weekStartOf(world, 0), -2);
  assert.equal(weekdayOf(world, weekStartOf(world, 40)), 0);
});

test('the week is laid out around the match: preparation the day before, recovery the day after, a day of rest kept', () => {
  const world = hired(602);
  const club = world.clubs[world.userClubId];
  const { matchDay, monday } = matchWeek(world);
  const days = weekPlan(world, club, monday);
  assert.equal(days.length, 7);
  const at = (day: number) => days.find((d) => d.day === day);
  assert.equal(at(matchDay)?.session, 'match');
  if (at(matchDay - 1) !== undefined) assert.equal(at(matchDay - 1)?.session, 'preparation');
  if (at(matchDay + 1) !== undefined) assert.equal(at(matchDay + 1)?.session, 'recovery');
  assert.ok(days.some((d) => d.session === 'rest' || d.session === 'recovery'));
});

test('a day set by hand keeps its session — except a match day — and the week\'s focus decides the rest', () => {
  const world = hired(603);
  const club = world.clubs[world.userClubId];
  const plan = planOf(club);
  const { matchDay, monday } = matchWeek(world);
  plan.weeks[monday] = { focus: 'physical', intensity: 'high' };
  const free = weekPlan(world, club, monday).find((d) => d.session === 'physical')!;
  assert.ok(free !== undefined, 'a physical week trains the body');
  plan.days[free.day] = 'tactical';
  plan.days[matchDay] = 'rest';
  const days = weekPlan(world, club, monday);
  assert.equal(days.find((d) => d.day === free.day)?.session, 'tactical');
  assert.equal(days.find((d) => d.day === free.day)?.manual, true);
  assert.equal(days.find((d) => d.day === matchDay)?.session, 'match', 'the match is played whatever the plan says');
  assert.ok(dayLoad({ ...free, session: 'physical', intensity: 'high' }).load > dayLoad({ ...free, session: 'physical', intensity: 'low' }).load);
  // The setting carries on into the weeks after.
  assert.equal(weekPlan(world, club, monday + 7).every((d) => d.intensity === 'high'), true);
});

test('the assistant works each player on the weakest part of his game, and rests the tired ones', () => {
  const world = hired(604);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  const setter = club.players.find((p) => store.position[p] === Position.Setter)!;
  assert.ok(['setting', 'serving', 'blocking', 'defence'].includes(assistantFocus(world, setter)));
  store.condition[setter] = 50;
  assert.equal(assistantLoad(world, setter), 'rest');
  store.condition[setter] = 70;
  assert.equal(assistantLoad(world, setter), 'reduced');

  const plan = planOf(club);
  plan.assistantIndividual = false;
  plan.individual[setter] = { focus: 'physical', load: 'extra' };
  assert.deepEqual({ ...individualOf(world, club, setter), byAssistant: undefined }, { focus: 'physical', load: 'extra', byAssistant: undefined });
  store.condition[setter] = 100;
  const extra = weekEffect(world, club, setter);
  plan.individual[setter] = { focus: 'physical', load: 'reduced' };
  const reduced = weekEffect(world, club, setter);
  assert.ok(extra.dev > reduced.dev && extra.injury > reduced.injury, 'more work, more to gain — and to lose');
});

test('a training day costs condition, a rest day gives it back', () => {
  const world = hired(605);
  const club = world.clubs[world.userClubId];
  const plan = planOf(club);
  const store = world.players;
  const p = club.players.find((x) => store.injuryDaysLeft[x] === 0)!;
  const { monday } = matchWeek(world);
  const day = weekPlan(world, club, monday).find((d) => d.session !== 'match' && d.session !== 'preparation' && d.session !== 'recovery')!;
  world.day = day.day;

  plan.days[day.day] = 'physical';
  store.condition[p] = 90;
  trainingDay(world);
  assert.ok(store.condition[p] < 90);

  plan.days[day.day] = 'rest';
  store.condition[p] = 80;
  trainingDay(world);
  assert.ok(store.condition[p] > 80);
});

test('the day before a match prepares for it, in the part of the game chosen for it', () => {
  const world = hired(606);
  const club = world.clubs[world.userClubId];
  const { matchDay } = matchWeek(world);
  const before = weekPlan(world, club, weekStartOf(world, matchDay - 1)).find((d) => d.day === matchDay - 1)!;
  if (before.session !== 'preparation') return; // two matches on consecutive days: nothing to prepare
  planOf(club).prep[before.day] = 'block';
  const cover = prepCoverage(world, club, matchDay);
  assert.equal(cover.block, 1);
  assert.ok(cover.reception < 1, 'the rest only as much as a tactical day gives');
});

test('every other club trains too: its assistant plans the week around its matches and prepares for the opponent', () => {
  const world = hired(607);
  const club = world.clubs.find((c) => c.id !== world.userClubId && c.tier === 1 && c.players.length >= 12)!;
  let matchDay = world.day;
  while (clubFixtureOn(world, club.id, matchDay) === undefined) matchDay++;
  const days = weekPlan(world, club, weekStartOf(world, matchDay));
  assert.equal(days.find((d) => d.day === matchDay)?.session, 'match');
  assert.ok(days.every((d) => d.intensity === days[0].intensity));
  const before = days.find((d) => d.day === matchDay - 1);
  if (before?.session === 'preparation') {
    assert.ok(before.prep !== undefined, 'the assistant picks what to prepare');
    const cover = prepCoverage(world, club, matchDay);
    assert.ok(cover.reception + cover.transition + cover.block > 0);
  }
  assert.equal(club.training, undefined, 'nothing is written to a club the user does not run');

  // A training day costs its players condition, as it does the user's.
  const store = world.players;
  const train = weekPlan(world, club, weekStartOf(world, matchDay + 7)).find((d) => SESSIONS[d.session].load > 0 && d.session !== 'preparation');
  if (train === undefined) return;
  world.day = train.day;
  const p = club.players.find((x) => store.injuryDaysLeft[x] === 0)!;
  store.condition[p] = 90;
  trainingDay(world);
  assert.ok(store.condition[p] < 90);
});

test('a club\'s assistant trains hard in a pre-season week with no match, and lightly in a week of two', () => {
  const world = hired(608);
  const club = world.clubs.find((c) => c.id !== world.userClubId && c.players.length >= 12)!;
  const settings = (monday: number) => weekSettingsFor(world, club, monday);
  const empty = weekStartOf(world, 7);
  let matches = 0;
  for (let i = 0; i < 7; i++) if (clubFixtureOn(world, club.id, empty + i) !== undefined) matches++;
  if (matches === 0) assert.equal(settings(empty).intensity, 'high');
  for (let monday = weekStartOf(world, 60); monday < 300; monday += 7) {
    let n = 0;
    for (let i = 0; i < 7; i++) if (clubFixtureOn(world, club.id, monday + i) !== undefined) n++;
    if (n >= 2) {
      assert.equal(settings(monday).intensity, 'low');
      return;
    }
  }
});
