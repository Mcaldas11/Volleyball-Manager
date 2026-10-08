import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StaffRole, staffRating } from '../model/staff.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import {
  answerStaffApproach, backroomOf, compensationFor, HIRABLE_ROLES, medicalQuality, offerToStaff, releaseStaff, roleCount,
  severanceFor, STAFF_SLOTS, staffBudgetRoom, staffDay, staffInterest, staffMarket, staffSeasonEnd, staffWageAsk,
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

test('an offer at his ask is signed, a little short of it he names his price, well short he turns down — and stops listening', () => {
  const { world, club } = managed(302);
  const role = StaffRole.SportsPsychologist;
  for (const s of backroomOf(world, club).filter((x) => x.role === role)) releaseStaff(world, club, s);
  const [one, two] = staffMarket(world, club, role, false).filter((l) => l.interest !== 'refuses' && l.ask < staffBudgetRoom(world, club));
  assert.ok(one !== undefined && two !== undefined);

  const low = offerToStaff(world, club, two.s, { wage: Math.round(two.ask * 0.5), years: 2 });
  assert.equal(low.outcome, 'rejected');
  const near = offerToStaff(world, club, two.s, { wage: Math.round(two.ask * 0.9), years: 2 });
  assert.equal(near.outcome, 'counter');
  assert.equal(near.ask, two.ask);
  assert.equal(offerToStaff(world, club, two.s, { wage: 1, years: 2 }).outcome, 'rejected');
  assert.equal(offerToStaff(world, club, two.s, { wage: two.ask, years: 2 }).outcome, 'refused', 'three no’s and he stops talking');

  const room = staffBudgetRoom(world, club);
  const yes = offerToStaff(world, club, one.s, { wage: one.ask, years: 2 });
  assert.equal(yes.outcome, 'accepted');
  assert.equal(one.s.clubId, club.id);
  assert.equal(one.s.wage, one.ask);
  assert.equal(one.s.contractUntil, seasonEndDay(world.season + 1));
  assert.equal(staffBudgetRoom(world, club), room - one.ask, 'out of the staff budget');
  // The places are limited.
  assert.equal(roleCount(world, club, role).have, STAFF_SLOTS[role]);
  const third = staffMarket(world, club, role, false).find((l) => l.interest !== 'refuses')!;
  assert.equal(offerToStaff(world, club, third.s, { wage: third.ask, years: 1 }).outcome, 'refused');
});

test('a man in work elsewhere comes for his compensation; one let go is paid up', () => {
  const { world, club } = managed(303);
  const role = StaffRole.Physiotherapist;
  const target = staffMarket(world, club, role, true).find((l) => l.interest !== 'refuses' && l.ask < staffBudgetRoom(world, club) + 300_000)!;
  const from = world.clubs[target.s.clubId];
  // Room for him.
  for (const s of backroomOf(world, club).filter((x) => x.role === role)) releaseStaff(world, club, s);
  const balance = club.finances.balance;
  const theirs = from.finances.balance;
  const fee = compensationFor(world, target.s);
  assert.ok(fee > 0);
  const reply = offerToStaff(world, club, target.s, { wage: staffWageAsk(world, target.s, club), years: 2 });
  assert.equal(reply.outcome, 'accepted', reply.text);
  assert.equal(club.finances.balance, balance - fee);
  assert.equal(from.finances.balance, theirs + fee);
  assert.ok(!from.staff.includes(target.s.id) && club.staff.includes(target.s.id));

  // Releasing him pays out what is left of his contract.
  const cost = severanceFor(world, target.s);
  assert.ok(cost > 0);
  const before = club.finances.balance;
  assert.equal(releaseStaff(world, club, target.s), cost);
  assert.equal(club.finances.balance, before - cost);
  assert.equal(target.s.clubId, -1);
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

test('other clubs come in for the manager’s best staff — let one go for the fee, keep another and he is unsettled', () => {
  const { world, club } = managed(305, 40);
  // A very good assistant, at a smaller club than many.
  const s = backroomOf(world, club).find((x) => x.role === StaffRole.AssistantCoach)!;
  for (const k of Object.keys(s.attributes) as Array<keyof typeof s.attributes>) s.attributes[k] = 19;
  let approaches = 0;
  for (let d = 0; d < 2000 && approaches < 2; d++) {
    world.day++;
    staffDay(world);
    const open = (world.staffApproaches ?? []).filter((a) => a.status === 'open');
    if (open.length === 0) continue;
    approaches++;
    const a = open[0];
    const wanted = world.staff[a.staffId];
    assert.ok(world.messages.some((m) => m.staffApproachId === a.id));
    if (approaches === 1) {
      assert.match(answerStaffApproach(world, a.id, false), /not for sale/);
      assert.equal(wanted.clubId, club.id);
      // Kept from a bigger club he wanted, he'll want more to stay.
      if (world.clubs[a.clubId].reputation > club.reputation && wanted.attributes.ambition >= 11) assert.equal(wanted.unsettled, true);
    } else {
      const balance = club.finances.balance;
      answerStaffApproach(world, a.id, true);
      assert.equal(wanted.clubId, a.clubId);
      assert.equal(club.finances.balance, balance + a.fee);
    }
  }
  assert.equal(approaches, 2, 'two clubs came in for him');
  assert.ok(staffRating(s) > 15);
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
      offerToStaff(world, club, l.s, { wage: l.ask, years: 1 });
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
