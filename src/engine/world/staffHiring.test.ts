import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { generateStaff, generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { StaffRole, staffRating } from '../model/staff.ts';
import { setDelegation } from './delegation.ts';
import { backroomOf, releaseStaff, staffBudgetRoom } from './staffMarket.ts';
import {
  cancelStaffHire, judgedRating, pendingStaffHires, planStaffHires, setStaffHiringBrief, staffHiringOf, HIRE_NOTICE_DAYS,
} from './staffHiring.ts';

function career() {
  const world = generateWorld({ seed: 82, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[3];
  appointManager(world, club.id);
  // A Director of Football to hand it to, and no doctor: a role nobody does.
  const dof = generateStaff(world, new Rng(9), club.nation, StaffRole.DirectorOfFootball, 8000);
  dof.clubId = club.id;
  club.staff.push(dof.id);
  for (const s of backroomOf(world, club).filter((x) => x.role === StaffRole.Doctor)) releaseStaff(world, club, s);
  club.finances.wageBudget += 400_000;
  return { world, ctx, club, dof };
}

test('staff hiring handed to the director: he fills the empty role within the budget and the limit, and reports it', () => {
  const { world, ctx, club } = career();
  assert.match(setDelegation(world, 'staff', 'director'), /takes care/);
  setStaffHiringBrief(world, { maxWage: 30_000, scope: 'empty' });
  const room = staffBudgetRoom(world, club);
  const lined = planStaffHires(world);
  const doctor = lined.find((h) => h.role === StaffRole.Doctor);
  assert.ok(doctor !== undefined, 'a doctor is lined up');
  for (const h of lined) assert.ok(h.wage <= 30_000, 'never over the limit');
  assert.ok(lined.reduce((s, h) => s + h.wage, 0) <= room, 'within the staff budget');
  assert.ok(world.messages.some((m) => m.category === 'staff' && /lined up/.test(m.subject)), 'the plan is put to the manager');
  // Nothing signs until the notice is up.
  assert.equal(world.staff[doctor!.staffId].clubId, -1);
  for (let d = 0; d <= HIRE_NOTICE_DAYS; d++) advanceDay(world, ctx, {});
  assert.equal(world.staff[doctor!.staffId].clubId, club.id, 'he has signed');
  assert.equal(world.staff[doctor!.staffId].wage, doctor!.wage);
  assert.ok(world.messages.some((m) => m.subject === `Staff signed: ${world.staff[doctor!.staffId].firstName} ${world.staff[doctor!.staffId].lastName}`),
    'the signing is reported');
  assert.ok(backroomOf(world, club).some((s) => s.role === StaffRole.Doctor));
});

test('the limit holds: too low a limit and nobody is lined up', () => {
  const { world } = career();
  setDelegation(world, 'staff', 'assistant');
  setStaffHiringBrief(world, { maxWage: 1_000 });
  assert.equal(planStaffHires(world).length, 0);
});

test('a hire the manager stops never goes through, and the man is not put up again', () => {
  const { world, ctx, club } = career();
  setDelegation(world, 'staff', 'director');
  setStaffHiringBrief(world, { maxWage: 30_000 });
  const doctor = planStaffHires(world).find((h) => h.role === StaffRole.Doctor)!;
  assert.match(cancelStaffHire(world, doctor.id), /will not be hired/);
  assert.equal(pendingStaffHires(world).some((h) => h.id === doctor.id), false);
  for (let d = 0; d <= HIRE_NOTICE_DAYS; d++) advanceDay(world, ctx, {});
  assert.notEqual(world.staff[doctor.staffId].clubId, club.id);
  assert.ok(!pendingStaffHires(world).some((h) => h.staffId === doctor.staffId));
  assert.ok(!staffHiringOf(world).hires.some((h) => h.staffId === doctor.staffId && h.status === 'done'));
});

test('kept by the manager, nothing is hired', () => {
  const { world, ctx, club } = career();
  for (let d = 0; d < 10; d++) advanceDay(world, ctx, {});
  assert.ok(!backroomOf(world, club).some((s) => s.role === StaffRole.Doctor));
  assert.equal(world.staffHiring, undefined);
});

test('a better judge sees them truer', () => {
  const { world, club } = career();
  const good = generateStaff(world, new Rng(1), club.nation, StaffRole.DirectorOfFootball, 9000);
  const poor = generateStaff(world, new Rng(2), club.nation, StaffRole.DirectorOfFootball, 9000);
  good.attributes.judgingAbility = 20; good.attributes.manManagement = 20;
  poor.attributes.judgingAbility = 1; poor.attributes.manManagement = 1;
  const pool = world.staff.filter((s) => s.clubId < 0 && s.retired !== true && s.role === StaffRole.Doctor);
  const err = (j: typeof good): number => pool.reduce((sum, s) => sum + Math.abs(judgedRating(j, s) - staffRating(s)), 0) / pool.length;
  assert.ok(err(good) < err(poor) / 3, `good ${err(good).toFixed(2)} vs poor ${err(poor).toFixed(2)}`);
});

test('asked to, he replaces a weak man whose contract runs out with a clearly better one', () => {
  const { world, club } = career();
  setDelegation(world, 'staff', 'director');
  setStaffHiringBrief(world, { maxWage: 250_000, replaceExpiring: true, scope: 'empty' });
  const weak = backroomOf(world, club).find((s) => s.role === StaffRole.Physiotherapist)
    ?? (() => { const s = generateStaff(world, new Rng(5), club.nation, StaffRole.Physiotherapist, 500); s.clubId = club.id; club.staff.push(s.id); return s; })();
  for (const k of Object.keys(weak.attributes) as (keyof typeof weak.attributes)[]) weak.attributes[k] = 1;
  weak.contractUntil = seasonEndDay(world.season);
  world.day = world.season * 365 + 243;
  const lined = planStaffHires(world);
  assert.ok(lined.some((h) => h.replaces === weak.id), 'a replacement is lined up');
});

test('taken back before the notice is up, what was lined up lapses', () => {
  const { world, ctx, club } = career();
  setDelegation(world, 'staff', 'director');
  setStaffHiringBrief(world, { maxWage: 30_000 });
  const lined = planStaffHires(world);
  assert.ok(lined.length > 0);
  setDelegation(world, 'staff', 'manager');
  for (let d = 0; d <= HIRE_NOTICE_DAYS; d++) advanceDay(world, ctx, {});
  for (const h of lined) assert.notEqual(world.staff[h.staffId].clubId, club.id);
  assert.equal(pendingStaffHires(world).length, 0);
});
