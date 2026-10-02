import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFlag } from '../model/players.ts';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { internationals, poolTable, type Tournament } from './internationals.ts';
import { NATIONS } from './nations.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function start(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // The strongest top-flight club: the one most likely to have internationals.
  const club = world.clubs.filter((c) => c.tier === 1).sort((a, b) => b.reputation - a.reputation)[0];
  appointManager(world, club.id);
  return { world, ctx };
}

/** Run the days, the season turning over as the game turns it. */
function runTo(world: World, ctx: SeasonContext, day: number): void {
  while (world.day < day) {
    if (world.day % 365 >= 350) {
      endSeason(world, ctx);
      while (world.day % 365 >= 350) {
        world.day++;
        if (world.day % 365 === 0) world.year++;
      }
      startSeason(world, ctx);
      continue;
    }
    advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  }
}

const byKind = (world: World, kind: Tournament['kind']): Tournament[] =>
  internationals(world).tournaments.filter((t) => t.kind === kind);

test('the summer of 2026 is the continental championships, and every season ends with a Nations League', () => {
  const { world } = start(41);
  const continental = byKind(world, 'continental');
  assert.equal(continental.length, 5, 'one per confederation');
  const euro = continental.find((t) => t.confederation === 'CEV')!;
  assert.equal(euro.name, 'EuroVolley 2026');
  assert.equal(euro.teams.length, 24);
  assert.ok(euro.teams.every((n) => NATIONS[n].confederation === 'CEV'));
  const vnl = byKind(world, 'nationsLeague')[0];
  assert.equal(vnl.teams.length, 16);
  assert.ok(vnl.startDay > euro.knockoutDays[euro.knockoutDays.length - 1] + 200, 'the spring after');
});

test('a tournament plays out: pools, a bracket to a final and a bronze match, medals and an MVP — and everyone goes home', () => {
  const { world, ctx } = start(42);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  assert.equal(euro.status, 'done');
  assert.ok(euro.matches.every((m) => m.played));
  assert.equal(euro.matches.filter((m) => m.stage === 'Final').length, 1);
  assert.equal(euro.matches.filter((m) => m.bronze).length, 1);
  // The pool winners all reached the knockout rounds.
  for (const pool of euro.pools) {
    const winner = poolTable(euro, pool)[0].clubId;
    assert.ok(euro.matches.some((m) => m.round === 0 && (m.home === winner || m.away === winner)));
  }
  assert.equal(new Set(euro.placings).size, euro.teams.length, 'every nation placed once');
  assert.ok(euro.mvp >= 0);
  assert.equal(world.players.nation[euro.mvp], euro.placings[0], 'the MVP is one of the champions');
  const record = internationals(world).history.find((h) => h.name === 'EuroVolley 2026')!;
  assert.deepEqual(record.podium.slice(0, 3), euro.placings.slice(0, 3));
  const store = world.players;
  for (let i = 0; i < store.count; i++) assert.ok(!store.hasFlag(i, PlayerFlag.OnDuty), 'nobody is left away');
});

test('called-up players are away from their clubs until their team goes out, and earn caps when they play', () => {
  const { world, ctx } = start(43);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.callUpDay + 1);
  const store = world.players;
  const squads = euro.squads;
  assert.equal(squads.length, euro.teams.length);
  for (const [nation, squad] of squads) {
    assert.equal(squad.length, 14);
    for (const p of squad) {
      assert.equal(store.nation[p], nation);
      assert.ok(!store.isAvailable(p), 'away on duty: not available to his club');
    }
  }
  const capsBefore = new Map(squads.flatMap(([, s]) => s).map((p) => [p, store.nationalCaps[p]]));
  runTo(world, ctx, euro.knockoutDays[0] + 1);
  // Out in the pools: home already.
  for (const n of euro.out) for (const p of squads.find(([x]) => x === n)![1]) assert.ok(!store.hasFlag(p, PlayerFlag.OnDuty));
  const capped = [...capsBefore].filter(([p, caps]) => store.nationalCaps[p] > caps);
  assert.ok(capped.length > 100, 'plenty of players earned caps');
});

test('the manager hears about his players: the call-up, each match day, and the way home', () => {
  const { world, ctx } = start(44);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  const before = world.messages.length;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  const intl = world.messages.slice(before).filter((m) => m.category === 'international');
  const ours = world.clubs[world.userClubId].players.filter((p) => euro.squads.some(([, s]) => s.includes(p)));
  if (ours.length === 0) return; // nobody called up: nothing to hear
  assert.ok(intl.some((m) => m.subject.includes('called up')));
  assert.ok(intl.some((m) => m.subject.includes('how your players got on')));
  assert.ok(intl.some((m) => /return|champion/.test(m.subject)));
  assert.ok(intl.filter((m) => m.subject.includes('how your players')).every((m) => /played|did not get on court|missed/.test(m.body)));
});

test('the cycle: a World Championship in 2027 and the Olympic Games in 2028, places shared by confederation', () => {
  const { world, ctx } = start(45);
  runTo(world, ctx, 365 + 1);
  const worlds = byKind(world, 'worlds')[0];
  assert.equal(worlds.name, 'World Championship 2027');
  assert.equal(worlds.teams.length, 32);
  for (const conf of ['CSV', 'NORCECA', 'AVC', 'CAVB'] as const) {
    assert.ok(worlds.teams.filter((n) => NATIONS[n].confederation === conf).length >= 4, `${conf} has its places`);
  }
  runTo(world, ctx, 2 * 365 + 1);
  const olympics = byKind(world, 'olympics')[0];
  assert.equal(olympics.name, 'Olympic Games 2028');
  assert.equal(olympics.teams.length, 12);
});
