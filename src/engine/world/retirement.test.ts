import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StaffRole } from '../model/staff.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { interestedClubs } from './interest.ts';
import {
  ageAtSeasonEnd, ANNOUNCE_DAY, offerStaffRole, persuadeToPlayOn, retirementDay, retirementHazard, retirementPlan, willRetire,
} from './retirement.ts';
import { backroomOf, releaseStaff } from './staffMarket.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, seasonEndDay, seasonEndYear, stubManager, type World } from './world.ts';

function january(seed: number): { world: World; club: World['clubs'][number]; ctx: ReturnType<typeof newSeasonContext> } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 14).sort((a, b) => b.reputation - a.reputation)[10];
  appointManager(world, club.id);
  return { world, club, ctx };
}

test('in January the players who will stop say so — in the paper, on their profiles, and to the manager when they are his', () => {
  const { world, club } = january(401);
  const store = world.players;
  // A veteran of the manager's, at the very end.
  const veteran = club.players[0];
  store.birthYear[veteran] = world.year - 44;
  store.setAttr(veteran, 'retirementPreference', 5);
  world.day = world.season * DAYS_PER_SEASON + ANNOUNCE_DAY;
  retirementDay(world);

  assert.ok(willRetire(world, veteran), 'he will stop');
  const plans = world.retirementPlans!.plans;
  const ages = Object.keys(plans).map((p) => ageAtSeasonEnd(world, Number(p)));
  assert.ok(ages.length > 20 && ages.every((a) => a >= 29), 'the ones stopping are the veterans');
  assert.ok(world.messages.some((m) => m.retirementOf === veteran && m.subject.includes('wants to retire')));
  assert.ok(world.news.some((n) => n.kind === 'retirement' && n.playerIdx === veteran), 'the paper has it');
  // Nobody signs a man about to stop.
  assert.equal(interestedClubs(world, veteran).filter((i) => i.why === 'watching').length, 0);
});

test('talked round, a player plays on another season; the rest go as the season ends, the paper saying goodbye', () => {
  const { world, club, ctx } = january(402);
  const store = world.players;
  world.day = world.season * DAYS_PER_SEASON + ANNOUNCE_DAY;
  retirementDay(world);
  const plans = world.retirementPlans!.plans;
  // Five of the manager's who mean to stop: still near their best, keen to go on, and devoted to him.
  const five = club.players.slice(0, 5);
  for (const p of five) {
    plans[p] = { clubId: club.id, announced: world.day };
    store.birthYear[p] = world.year - 33;
    store.potentialAbility[p] = store.currentAbility[p];
    store.setAttr(p, 'retirementPreference', 20);
    store.setAttr(p, 'loyalty', 20);
    store.contractUntil[p] = seasonEndDay(world.season);
  }
  const answers = five.map((p) => persuadeToPlayOn(world, p));
  assert.match(persuadeToPlayOn(world, five[0]), /already/, 'one conversation');
  const stayed = five.filter((p) => retirementPlan(world, p)?.persuaded === true);
  const going = five.filter((p) => retirementPlan(world, p)?.persuaded !== true);
  assert.ok(stayed.length >= 3, answers.join(' | '));
  for (const p of stayed) assert.equal(store.contractUntil[p], seasonEndDay(world.season + 1), 'another season on his contract');

  world.day = seasonEndDay(world.season);
  endSeason(world, ctx);
  for (const p of stayed) assert.ok(store.isActive(p) && club.players.includes(p), 'he plays on');
  for (const p of going) assert.ok(!store.isActive(p), 'he has gone');
  if (going.length > 0) assert.ok(world.news.some((n) => n.kind === 'retirement' && n.headline.endsWith('retires') && n.playerIdx === going[0]));
});

test('asked onto the staff, a retiring player becomes a coach as he stops — what he did on court is what he teaches', () => {
  const { world, club, ctx } = january(403);
  const store = world.players;
  for (const s of backroomOf(world, club).filter((x) => x.role === StaffRole.AssistantCoach)) releaseStaff(world, club, s);
  world.day = world.season * DAYS_PER_SEASON + ANNOUNCE_DAY;
  retirementDay(world);
  const plans = world.retirementPlans!.plans;
  // Leaders and professionals, every one: someone will say yes.
  const candidates = club.players.slice(0, 6);
  for (const p of candidates) {
    plans[p] = { clubId: club.id, announced: world.day };
    for (const k of ['leadership', 'professionalism', 'loyalty', 'teamwork'] as const) store.setAttr(p, k, 20);
  }
  let coach = -1;
  for (const p of candidates) {
    offerStaffRole(world, p, StaffRole.AssistantCoach);
    if (retirementPlan(world, p)?.staffRole === StaffRole.AssistantCoach) { coach = p; break; }
  }
  assert.ok(coach >= 0, 'one of them takes it');
  assert.match(persuadeToPlayOn(world, coach), /staff/, 'and is stopping for it');
  const name = store.fullName(coach);
  const attack = store.getAttr(coach, 'spikeTechnique');

  world.day = seasonEndDay(world.season);
  endSeason(world, ctx);
  assert.ok(!store.isActive(coach));
  const s = backroomOf(world, club).find((x) => `${x.firstName} ${x.lastName}` === name);
  assert.ok(s !== undefined && s.role === StaffRole.AssistantCoach, 'on the staff');
  assert.ok(Math.abs(s.attributes.coachAttacking - attack) <= 7, 'his attacking is what he coaches');
  assert.ok(world.messages.some((m) => m.subject === `${name} joins the staff`));
});

test("a player's profile names the clubs after him: who has bid, and who is keeping tabs", () => {
  const { world, club } = january(404);
  const store = world.players;
  const star = [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
  const bidder = world.clubs.find((c) => c.id !== club.id && c.tier === 1 && c.players.length > 0)!;
  world.incomingOffers.push({ id: 999, playerIdx: star, buyingClubId: bidder.id, fee: 250_000, expiresOnDay: world.day + 10, status: 'open' });
  const list = interestedClubs(world, star);
  assert.ok(list.some((i) => i.clubId === bidder.id && i.why === 'bid' && i.fee === 250_000));
  assert.ok(list.every((i) => i.clubId !== club.id), 'not his own club');
  // A good player elsewhere has clubs keeping tabs.
  const other = world.clubs.find((c) => c.id !== club.id && c.tier === 2 && c.players.length > 0)!;
  const best = [...other.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
  assert.ok(interestedClubs(world, best).some((i) => i.why === 'watching'));
});

test('volleyball careers run long: a new world has its forty-somethings, the oldest about 43 — one who wants to go on usually does, and the odd one goes on near 50', () => {
  const world = generateWorld({ seed: 405, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const ages: number[] = [];
  for (let i = 0; i < store.count; i++) if (store.isActive(i)) ages.push(store.ageOn(i, world.year, 181));
  const oldest = Math.max(...ages);
  assert.ok(ages.filter((a) => a >= 40).length >= 10, 'plenty past 40');
  assert.ok(oldest >= 41 && oldest <= 43, `the oldest is ${oldest}`);

  // A player of 41 by the summer, still near his level, who always meant to go on — and the same man older.
  const p = world.clubs.find((c) => c.players.length > 0)!.players[0];
  const at = (age: number): number => {
    store.birthYear[p] = seasonEndYear(world, world.season) - age;
    store.birthDay[p] = 1;
    return retirementHazard(world, p);
  };
  store.potentialAbility[p] = store.currentAbility[p];
  store.setAttr(p, 'retirementPreference', 18);
  store.setAttr(p, 'professionalism', 10);
  store.setAttr(p, 'durability', 10);
  assert.ok(at(41) < 0.35, `he plays on more often than not (${at(41).toFixed(2)})`);
  assert.ok(at(36) < at(41) && at(41) < at(44), 'the older, the likelier');
  assert.ok(at(46) > 0.5, `at 46 he stops, more often than not (${at(46).toFixed(2)})`);

  // The exception of exceptions — Miguel Maia played at 52: he never meant to stop, and looked after himself.
  for (const k of ['retirementPreference', 'professionalism', 'durability'] as const) store.setAttr(p, k, 20);
  assert.ok(at(48) < 0.45, `the devoted one may play on towards 50 (${at(48).toFixed(2)})`);
  assert.equal(at(53), 1, 'but nobody plays at 53');
});
