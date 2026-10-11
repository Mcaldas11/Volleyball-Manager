import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StaffRole } from '../model/staff.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import {
  backroomOf, HIRABLE_ROLES, medicalQuality, releaseStaff, severanceFor, signStaff, staffDay, staffInterest, staffMarket,
  staffSeasonEnd, staffWageAsk,
} from './staffMarket.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';

function managed(seed: number, rank = 20): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[rank];
  appointManager(world, club.id);
  club.finances.balance = 10_000_000;
  club.finances.transferBudget = 5_000_000;
  return { world, club };
}

test('there is a market in every role, the best asking the most, and a man far above a club will not go there', () => {
  const { world, club } = managed(301);
  for (const role of HIRABLE_ROLES) {
    const free = staffMarket(world, club, role, false);
    assert.ok(free.length >= 10, `people out of work as ${role}`);
    // Best first, and the best ask more than the worst.
    assert.ok(free[0].rating >= free[free.length - 1].rating);
    assert.ok(free[0].ask > free[free.length - 1].ask);
  }
  const small = world.clubs.filter((c) => c.players.length > 0).sort((a, b) => a.reputation - b.reputation)[0];
  const star = world.staff.filter((s) => s.clubId < 0 && s.retired !== true && s.role !== StaffRole.HeadCoach)
    .sort((a, b) => b.reputation - a.reputation)[0];
  assert.equal(staffInterest(world, star, small), 'refuses', 'the best name in the game won’t join the smallest club');
  assert.ok(staffWageAsk(world, star, small) > staffWageAsk(world, star, world.clubs.reduce((a, b) => (b.reputation > a.reputation ? b : a))),
    'a club below his standing pays to have him');
});

test('one of the staff let go before his contract is up is paid up', () => {
  const { world, club } = managed(303);
  const s = backroomOf(world, club).find((x) => x.contractUntil > world.day)!;
  const cost = severanceFor(world, s);
  assert.ok(cost > 0);
  const before = club.finances.balance;
  assert.equal(releaseStaff(world, club, s), cost);
  assert.equal(club.finances.balance, before - cost);
  assert.equal(s.clubId, -1);
  assert.ok(!club.staff.includes(s.id));
});

test('as the season ends the manager’s staff out of contract go; the other clubs keep most of theirs and fill their places', () => {
  const { world, club } = managed(304);
  const mine = backroomOf(world, club);
  const ending = mine[0];
  const staying = mine[1];
  ending.contractUntil = seasonEndDay(world.season);
  staying.contractUntil = seasonEndDay(world.season + 1);
  const others = world.clubs.filter((c) => c.id !== club.id && c.players.length > 0).slice(0, 60);
  for (const c of others) for (const s of backroomOf(world, c)) s.contractUntil = seasonEndDay(world.season);
  const before = others.reduce((n, c) => n + backroomOf(world, c).length, 0);
  staffSeasonEnd(world);
  assert.notEqual(ending.clubId, club.id, 'out of contract, he has gone');
  assert.ok(!club.staff.includes(ending.id));
  assert.ok(club.staff.includes(staying.id) || staying.retired === true);
  assert.ok(world.messages.some((m) => m.subject === 'Staff departures'));
  // Kept most, and the places filled again.
  const after = others.reduce((n, c) => n + backroomOf(world, c).length, 0);
  assert.ok(after >= before * 0.9, `${after} of ${before}`);
});

test('the doctor and the physios keep a squad fit; the psychologist lifts it', () => {
  const { world, club } = managed(306);
  const medical = medicalQuality(world, club);
  for (const s of backroomOf(world, club).filter((x) => x.role === StaffRole.Physiotherapist || x.role === StaffRole.Doctor)) {
    for (const k of ['physiotherapy', 'sportsScience'] as const) s.attributes[k] = 20;
  }
  assert.ok(medicalQuality(world, club) > medical);

  const psych = backroomOf(world, club).find((x) => x.role === StaffRole.SportsPsychologist)
    ?? (() => {
      const l = staffMarket(world, club, StaffRole.SportsPsychologist, false).find((x) => x.interest !== 'refuses')!;
      signStaff(world, club, l.s, l.ask, 1, 0);
      return l.s;
    })();
  assert.equal(psych.clubId, club.id);
  const p = club.players[0];
  world.players.morale[p] = 20;
  for (let d = 0; d < 28; d++) {
    world.day++;
    staffDay(world);
  }
  assert.ok(world.players.morale[p] > 20, 'his weeks with the squad tell');
});
