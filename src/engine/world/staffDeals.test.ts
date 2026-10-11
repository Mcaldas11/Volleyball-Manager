import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StaffRole, staffRating } from '../model/staff.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import {
  answerStaffApproach, counterStaffApproach, openStaffTalks, processStaffDeals, setStaffListed, staffTalksBlock, staffTalksOf,
  staffValuation, submitStaffOffer,
} from './staffDeals.ts';
import {
  backroomOf, releaseStaff, roleCount, STAFF_SLOTS, staffBudgetRoom, staffDay, staffMarket,
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

/** The days go by, and the deals with them. */
function days(world: World, n: number): void {
  for (let i = 0; i < n; i++) {
    world.day++;
    staffDay(world);
    processStaffDeals(world);
  }
}

test('hiring staff is talks, as signing a player is: his demands, an answer days later, a near miss met halfway, and only so much patience', () => {
  const { world, club } = managed(302);
  const role = StaffRole.SportsPsychologist;
  for (const s of backroomOf(world, club).filter((x) => x.role === role)) releaseStaff(world, club, s);
  const [one, two] = staffMarket(world, club, role, false).filter((l) => l.interest !== 'refuses' && l.ask < staffBudgetRoom(world, club) * 0.4);
  assert.ok(one !== undefined && two !== undefined);

  // Out of work: terms alone.
  const t = openStaffTalks(world, club, two.s);
  t.rivals = [];
  assert.equal(t.stage, 'terms');
  const asked = t.demands.wage;
  const due = submitStaffOffer(world, t, { fee: 0, wage: Math.round(asked * 0.9 / 1000) * 1000, years: 2 });
  assert.ok(due > world.day, 'the answer takes days');
  days(world, due - world.day - 1);
  assert.notEqual(t.pending, null, 'not yet');
  days(world, 1);
  assert.equal(t.pending, null);
  assert.equal(t.reply, 'close');
  assert.ok(t.demands.wage < asked && t.demands.wage >= t.demands.floorWage, 'he gives a little ground');
  assert.ok(world.messages.some((m) => m.staffTalksId === t.id && /close to agreeing/.test(m.body)));
  assert.equal(two.s.clubId, -1);

  // Nowhere near, twice: he walks out, and won't talk again for a while.
  for (let i = 0; i < 2; i++) days(world, submitStaffOffer(world, t, { fee: 0, wage: 2_000, years: 2 }) - world.day);
  assert.ok(!staffTalksOf(world).includes(t), 'talks over');
  assert.match(staffTalksBlock(world, club, two.s) ?? '', /enough of talking/);

  // At his ask: signed, out of the staff budget.
  const room = staffBudgetRoom(world, club);
  const t1 = openStaffTalks(world, club, one.s);
  t1.rivals = [];
  const wage = t1.demands.wage;
  days(world, submitStaffOffer(world, t1, { fee: 0, wage, years: 2 }) - world.day);
  assert.equal(one.s.clubId, club.id);
  assert.equal(one.s.wage, wage);
  assert.equal(one.s.contractUntil, seasonEndDay(world.season + 1));
  assert.equal(staffBudgetRoom(world, club), room - wage);
  assert.equal(roleCount(world, club, role).have, STAFF_SLOTS[role]);
  // The place filled, there's no talking to another.
  const third = staffMarket(world, club, role, false).find((l) => l.interest !== 'refuses' && l.s !== two.s)!;
  assert.match(staffTalksBlock(world, club, third.s) ?? '', /release one first/);
});

test('one in work at another club: his compensation agreed with it first, then his terms — and the fee goes to his club', () => {
  const { world, club } = managed(303);
  const role = StaffRole.Physiotherapist;
  for (const s of backroomOf(world, club).filter((x) => x.role === role)) releaseStaff(world, club, s);
  const target = staffMarket(world, club, role, true).find((l) => l.interest !== 'refuses' && l.ask < staffBudgetRoom(world, club) * 0.6)!;
  const from = world.clubs[target.s.clubId];
  const t = openStaffTalks(world, club, target.s);
  t.rivals = [];
  assert.equal(t.stage, 'fee');

  // Well short: turned down, and his club says what it wants.
  days(world, submitStaffOffer(world, t, { fee: 1_000, wage: 0, years: 2 }) - world.day);
  assert.equal(t.reply, 'feeRejected');
  assert.equal(t.valuation, staffValuation(world, target.s));
  assert.equal(t.stage, 'fee');
  // What they want: agreed.
  const fee = t.valuation!;
  days(world, submitStaffOffer(world, t, { fee, wage: 0, years: 2 }) - world.day);
  assert.equal(t.stage, 'terms');
  assert.equal(t.agreedFee, fee);
  assert.equal(target.s.clubId, from.id, 'still theirs until he agrees terms');

  const balance = club.finances.balance;
  const theirs = from.finances.balance;
  days(world, submitStaffOffer(world, t, { fee, wage: t.demands.wage, years: 2 }) - world.day);
  assert.equal(target.s.clubId, club.id);
  assert.equal(club.finances.balance, balance - fee);
  assert.equal(from.finances.balance, theirs + fee);
  assert.ok(!from.staff.includes(target.s.id) && club.staff.includes(target.s.id));
});

test('a rival offering more hires him from under you', () => {
  const { world, club } = managed(307);
  const role = StaffRole.PerformanceAnalyst;
  for (const s of backroomOf(world, club).filter((x) => x.role === role)) releaseStaff(world, club, s);
  const target = staffMarket(world, club, role, false).find((l) => l.interest !== 'refuses' && l.ask < staffBudgetRoom(world, club) * 0.5)!;
  const rival = world.clubs.find((c) => c.id !== club.id && c.players.length > 0 && c.reputation >= club.reputation)!;
  const t = openStaffTalks(world, club, target.s);
  t.rivals = [{ clubId: rival.id, wage: t.demands.wage * 2 }];
  days(world, submitStaffOffer(world, t, { fee: 0, wage: t.demands.wage, years: 2 }) - world.day);
  assert.equal(target.s.clubId, rival.id);
  assert.ok(!staffTalksOf(world).includes(t));
  assert.ok(world.messages.some((m) => m.subject === `${target.s.firstName} ${target.s.lastName} joins ${rival.name}`));
});

test('other clubs come in for the manager’s best staff: keep one and he is unsettled; ask for more, agree, and he decides to go', () => {
  const { world, club } = managed(305, 40);
  // A very good assistant, at a smaller club than many.
  const s = backroomOf(world, club).find((x) => x.role === StaffRole.AssistantCoach)!;
  for (const k of Object.keys(s.attributes) as Array<keyof typeof s.attributes>) s.attributes[k] = 19;
  let approaches = 0;
  for (let d = 0; d < 2000 && approaches < 2; d++) {
    days(world, 1);
    const open = (world.staffApproaches ?? []).filter((a) => a.status === 'open');
    if (open.length === 0) continue;
    approaches++;
    const a = open[0];
    // Whoever they are after — the assistant, or another of the good ones.
    const wanted = world.staff[a.staffId];
    assert.ok(world.messages.some((m) => m.staffApproachId === a.id));
    if (approaches === 1) {
      assert.match(answerStaffApproach(world, a.id, false), /not for sale/);
      assert.equal(wanted.clubId, club.id);
      if (world.clubs[a.clubId].reputation > club.reputation && wanted.attributes.ambition >= 11) assert.equal(wanted.unsettled, true);
      continue;
    }
    // Ask for a little more: the answer takes a day or two, then he takes a few to decide.
    const balance = club.finances.balance;
    const asked = Math.round(a.fee * 1.1 / 1000) * 1000;
    counterStaffApproach(world, a.id, asked);
    const status = (): string => a.status;
    assert.equal(status(), 'countered');
    wanted.attributes.loyalty = 1;
    for (let i = 0; i < 10 && status() !== 'accepted' && status() !== 'open'; i++) days(world, 1);
    if (status() === 'open') {
      // They wouldn't pay more: their offer stands, and is taken.
      answerStaffApproach(world, a.id, true);
      for (let i = 0; i < 6 && status() === 'deciding'; i++) days(world, 1);
    }
    assert.equal(status(), 'accepted', JSON.stringify(world.staffApproaches));
    assert.equal(wanted.clubId, a.clubId);
    assert.ok(!club.staff.includes(wanted.id));
    assert.equal(club.finances.balance, balance + a.fee);
  }
  assert.equal(approaches, 2, 'two clubs came in for him');
  assert.ok(staffRating(s) > 15);
});

test('one of the staff made available draws approaches', () => {
  const { world, club } = managed(308);
  const s = backroomOf(world, club).find((x) => x.role === StaffRole.Physiotherapist)!;
  setStaffListed(club, s, true);
  for (let d = 0; d < 120 && !(world.staffApproaches ?? []).some((a) => a.staffId === s.id); d++) days(world, 1);
  const a = (world.staffApproaches ?? []).find((x) => x.staffId === s.id);
  assert.ok(a !== undefined, 'a club came in for him');
  assert.ok(world.messages.some((m) => m.staffApproachId === a.id && /available/.test(m.body)));
});
