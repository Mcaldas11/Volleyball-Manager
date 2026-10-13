import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { injuryNotice, messageNeedsAction } from './inbox.ts';
import {
  atRisk, chooseTreatment, relapseAfterMatch, relapseChance, RETURN_CONDITION, TREATMENT_MIN_DAYS, treatmentWeeks,
} from './treatment.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { PlayerFlag } from '../model/players.ts';

function injure(world: World, p: number, days: number): void {
  const store = world.players;
  store.injuryDaysLeft[p] = days;
  store.injuryType[p] = 4;
  store.setFlag(p, PlayerFlag.Injured, true);
  injuryNotice(world, p, 4, days);
}

function setup(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  return { world, club };
}

test('the medical room asks how a real injury is treated — and each way costs what it says', () => {
  const { world, club } = setup(121);
  const store = world.players;
  const [a, b, c, knock] = club.players;
  injure(world, knock, TREATMENT_MIN_DAYS - 3);
  assert.equal(world.messages[world.messages.length - 1].treatmentFor, undefined, 'a knock: nothing to decide');

  for (const p of [a, b, c]) injure(world, p, 40);
  const msg = world.messages.find((m) => m.treatmentFor === a)!;
  assert.ok(messageNeedsAction(world, msg), 'waiting on the manager');
  const weeks = treatmentWeeks(world, a);
  assert.ok(weeks.rush < weeks.normal && weeks.normal < weeks.rest);

  assert.ok(chooseTreatment(world, a, 'rush').ok);
  assert.ok(chooseTreatment(world, b, 'normal').ok);
  assert.ok(chooseTreatment(world, c, 'rest').ok);
  assert.equal(chooseTreatment(world, a, 'rest').ok, false, 'once only');
  assert.ok(!messageNeedsAction(world, msg));
  assert.ok(store.injuryDaysLeft[a] < store.injuryDaysLeft[b] && store.injuryDaysLeft[b] < store.injuryDaysLeft[c]);

  // Back: rushed short of fitness and at risk; rested fit and not.
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  for (let d = 0; d < 60; d++) advanceDay(world, ctx);
  assert.ok(atRisk(world, a) || store.injuryDaysLeft[a] > 0, 'rushed: at risk for weeks after');
  assert.ok(!atRisk(world, b) && !atRisk(world, c));
  assert.ok(RETURN_CONDITION.rest > RETURN_CONDITION.normal && RETURN_CONDITION.normal > RETURN_CONDITION.rush);
});

test('a player rushed back may break down in a match — less often with good doctors', () => {
  const { world, club } = setup(122);
  const store = world.players;
  // The medical room matters.
  const poor = { ...club, medicalFacilities: 1, staff: [] };
  const good = { ...club, medicalFacilities: 20 };
  assert.ok(relapseChance(world, poor, 60) > relapseChance(world, good, 60));

  // Many rushed returns, one match each: some break down, most don't.
  let broke = 0;
  const players = club.players.slice(0, 10);
  for (let round = 0; round < 10; round++) {
    for (const p of players) {
      store.injuryDaysLeft[p] = 0;
      (world.relapse ??= {})[p] = { until: world.day + 35, chance: 0.2, days: 30, type: 4 };
    }
    relapseAfterMatch(world, 1000 + round, players);
    for (const p of players) if (store.injuryDaysLeft[p] > 0) { broke++; store.injuryDaysLeft[p] = 0; }
  }
  assert.ok(broke > 5 && broke < 45, `${broke} of 100 broke down at a 20% risk`);
  assert.ok(world.messages.some((m) => m.subject.endsWith('breaks down again')));
  // Past the risk window, nothing.
  const p = players[0];
  world.relapse = { [p]: { until: world.day - 1, chance: 1, days: 30, type: 4 } };
  relapseAfterMatch(world, 5000, [p]);
  assert.equal(store.injuryDaysLeft[p], 0);
});
