import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { generateYouthIntake } from './progression.ts';
import {
  academyState, ACADEMY_MAX, MAX_PROGRAMMES, MAX_SEARCHES, PROGRAMME_DAYS, programmeBlock, programmeCost, programmeOf,
  programmeWeek, SEARCH_DAYS, searchBlock, searchCost, signBlock, signCandidate, startProgramme, startSearch,
} from './academy.ts';
import { Rng } from '../core/rng.ts';
import { individualOf, loadOf } from './training.ts';
import { PlayerFlag } from '../model/players.ts';

function managed(seed: number): { world: World; run: (days: number) => void } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  generateYouthIntake(world);
  generateYouthIntake(world);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  const club = world.clubs[world.userClubId];
  club.finances.balance = 5_000_000;
  return { world, run: (days) => { for (let i = 0; i < days; i++) advanceDay(world, ctx); } };
}

test('a development programme: paid up front, twelve weeks in its area, two at a time, one a season each', () => {
  const { world, run } = managed(91);
  const club = world.clubs[world.userClubId];
  const [a, b, c] = club.youthPlayers;
  const balance = club.finances.balance;
  const cost = programmeCost(club, 'normal');
  assert.ok(programmeCost(club, 'intensive') > cost, 'intensive costs more');
  assert.equal(startProgramme(world, a, 'attacking', 'normal').ok, true);
  assert.equal(club.finances.balance, balance - cost);
  assert.equal(programmeBlock(world, a), 'Already on a programme');
  assert.equal(startProgramme(world, b, 'physical', 'intensive').ok, true);
  assert.notEqual(programmeBlock(world, c), null, `only ${MAX_PROGRAMMES} at a time`);
  // While it runs his training goes where the programme says; an intensive one works him harder.
  assert.equal(individualOf(world, club, a).focus, 'attacking');
  assert.equal(loadOf(world, club, b), world.players.injuryDaysLeft[b] > 0 ? 'rest' : 'extra');
  const before = world.players.currentAbility[a];
  run(PROGRAMME_DAYS + 1);
  const state = academyState(world);
  assert.equal(programmeOf(world, a), undefined, 'over after twelve weeks');
  assert.ok(state.completed >= 1);
  assert.ok(world.players.currentAbility[a] >= before, 'never set back by it');
  assert.ok(world.messages.some((m) => m.subject.startsWith('Programme over') && m.playerIdx === a), 'the report comes in');
  assert.equal(programmeBlock(world, a), 'One programme a season');
});

test('a programme brings a prospect on faster than training alone, on average', () => {
  let withProg = 0;
  let without = 0;
  for (const seed of [101, 102, 103, 104]) {
    const { world, run } = managed(seed);
    const club = world.clubs[world.userClubId];
    const store = world.players;
    // Two of the same academy, as alike as can be: the youngest two with room to grow.
    const pair = [...club.youthPlayers].sort((x, y) => store.currentAbility[x] - store.currentAbility[y]).slice(0, 2);
    const start = pair.map((p) => store.currentAbility[p]);
    startProgramme(world, pair[0], 'attacking', 'intensive');
    run(PROGRAMME_DAYS);
    withProg += store.currentAbility[pair[0]] - start[0];
    without += store.currentAbility[pair[1]] - start[1];
  }
  assert.ok(withProg > without, `with a programme +${withProg}, without +${without}`);
});

test('a youth search: paid for, one at a time, two a season; its finds can be signed for the academy', () => {
  const { world, run } = managed(92);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  assert.ok(searchCost(club, 'world') > searchCost(club, 'continental') && searchCost(club, 'continental') > searchCost(club, 'national'));
  const balance = club.finances.balance;
  assert.equal(startSearch(world, 'national', -1).ok, true);
  assert.equal(club.finances.balance, balance - searchCost(club, 'national'));
  assert.equal(searchBlock(world), 'A search is already under way');
  run(SEARCH_DAYS + 1);
  const state = academyState(world);
  assert.equal(state.search, undefined, 'the report is in');
  assert.ok(world.messages.some((m) => m.subject.startsWith('Youth search')));
  // A second, then no more this season.
  assert.equal(startSearch(world, 'world', -1).ok, true);
  run(SEARCH_DAYS + 1);
  assert.equal(searchBlock(world), `${MAX_SEARCHES} searches a season`);
  const found = academyState(world).candidates;
  for (const c of found) {
    assert.ok(c.low <= c.high);
    assert.ok(store.potentialAbility[c.playerIdx] >= c.low - 400 && store.potentialAbility[c.playerIdx] <= c.high + 400, 'a guess, near the truth');
  }
  const c = found.find((x) => signBlock(world, x) === null);
  if (c !== undefined) {
    const from = c.fromClubId;
    const before = club.finances.balance;
    assert.equal(signCandidate(world, c.playerIdx).ok, true);
    assert.ok(club.youthPlayers.includes(c.playerIdx));
    assert.equal(store.clubId[c.playerIdx], club.id);
    assert.ok(store.hasFlag(c.playerIdx, PlayerFlag.Youth));
    assert.equal(club.finances.balance, before - c.fee);
    if (from >= 0) assert.ok(!world.clubs[from].youthPlayers.includes(c.playerIdx));
    assert.equal(signCandidate(world, c.playerIdx).ok, false, 'not twice');
  }
});

test('a search position is respected, and a full academy signs no one', () => {
  const { world, run } = managed(93);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  for (let i = 0; i < 6; i++) {
    const state = academyState(world);
    state.searches = 0;
    startSearch(world, 'world', 0);
    run(SEARCH_DAYS + 1);
  }
  const found = academyState(world).candidates;
  for (const c of found) assert.equal(store.position[c.playerIdx], 0);
  if (found.length > 0) {
    while (club.youthPlayers.length < ACADEMY_MAX) club.youthPlayers.push(club.youthPlayers[0]);
    assert.match(signBlock(world, found[0]) ?? '', /full/);
  }
});

test('balance: a programme clearly helps, an intensive one more and at a cost — and nobody passes his potential', () => {
  for (const intensity of ['normal', 'intensive'] as const) {
    const { world } = managed(301);
    const store = world.players;
    const ys = world.clubs.flatMap((c) => c.youthPlayers);
    const start = ys.map((p) => store.currentAbility[p]);
    let knocked = 0;
    ys.forEach((p) => {
      const prog = { playerIdx: p, area: 'attacking' as const, intensity, startDay: 0, endDay: 84, startAbility: store.currentAbility[p], cost: 0 };
      let hit = false;
      for (let k = 0; k < 12; k++) {
        if (programmeWeek(world, prog, new Rng(p * 977 + k)).knock > 0) hit = true;
        store.injuryDaysLeft[p] = Math.max(0, store.injuryDaysLeft[p] - 7);
      }
      if (hit) knocked++;
    });
    const gains = ys.map((p, i) => store.currentAbility[p] - start[i]);
    const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
    // Twelve weeks' ordinary training brings a prospect about +9: a programme about as much again, an intensive one more.
    if (intensity === 'normal') assert.ok(mean > 6 && mean < 16, `normal +${mean.toFixed(1)}`);
    else assert.ok(mean > 11 && mean < 22, `intensive +${mean.toFixed(1)}`);
    assert.equal(ys.filter((p) => store.currentAbility[p] > store.potentialAbility[p]).length, 0, 'never past his potential');
    if (intensity === 'normal') assert.equal(knocked, 0, 'a normal programme is no risk');
    else assert.ok(knocked / ys.length > 0.08 && knocked / ys.length < 0.35, `intensive knocks ${knocked}/${ys.length}`);
  }
});

test('a programme sends training reports to the inbox every four weeks, and a final one', () => {
  const { world, run } = managed(94);
  const club = world.clubs[world.userClubId];
  const p = club.youthPlayers[0];
  startProgramme(world, p, 'serving', 'normal');
  run(PROGRAMME_DAYS + 1);
  const reports = world.messages.filter((m) => m.playerIdx === p && (m.subject.startsWith('Training report') || m.subject.startsWith('Programme over')));
  assert.deepEqual(reports.map((m) => m.subject.replace(/: .*/, '')), ['Training report', 'Training report', 'Programme over']);
  assert.match(reports[0].subject, /week 4 of 12/);
  assert.match(reports[1].subject, /week 8 of 12/);
  for (const r of reports) assert.match(r.body, /Ability: \d+ → \d+/);
});
