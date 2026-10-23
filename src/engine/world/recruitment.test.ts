import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { Position } from '../model/positions.ts';
import { addMission, cancelMission, isShortlisted, MAX_MISSIONS, missionsOf, shortlistOf, toggleShortlist } from './recruitment.ts';

function career() {
  const world = generateWorld({ seed: 83, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[2];
  appointManager(world, club.id);
  return { world, ctx, club };
}

test('the shortlist: a player on it, and off it again', () => {
  const { world, club } = career();
  const p = world.clubs.find((c) => c.id !== club.id && c.players.length > 0)!.players[0];
  assert.equal(toggleShortlist(world, p), true);
  assert.ok(isShortlisted(world, p) && shortlistOf(world).includes(p));
  assert.equal(toggleShortlist(world, p), false);
  assert.ok(!isShortlisted(world, p));
});

test('a mission: every week the scouts bring new names that fit the brief, onto the shortlist and into the inbox', () => {
  const { world, ctx, club } = career();
  const r = addMission(world, { position: Position.Opposite, maxAge: 24, maxValue: 200_000, minAbility: null, freeOnly: false, region: null });
  assert.ok(r.ok, r.text);
  for (let d = 0; d < 15; d++) advanceDay(world, ctx, {});
  const reports = world.messages.filter((m) => m.subject.startsWith('Scouting mission'));
  assert.equal(reports.length, 2, 'one a week');
  const store = world.players;
  const named = r.mission!.found;
  assert.ok(named.length > 0, 'someone found');
  assert.equal(new Set(named).size, named.length, 'nobody named twice');
  for (const p of named) {
    assert.equal(store.position[p], Position.Opposite);
    assert.ok(store.ageOn(p, world.year, 181) <= 24);
    assert.ok(store.clubId[p] < 0 || store.value[p] <= 200_000, 'within the price');
    assert.notEqual(store.clubId[p], club.id);
    assert.ok(isShortlisted(world, p));
  }
  assert.ok(reports[0].tables?.[0].rows.every((row) => row.p !== undefined));
});

test('the scouts run a few missions at once, and one called off stops reporting', () => {
  const { world, ctx } = career();
  const spec = { position: null, maxAge: null, maxValue: null, minAbility: null, freeOnly: true, region: null } as const;
  for (let i = 0; i < MAX_MISSIONS; i++) assert.ok(addMission(world, spec).ok);
  assert.equal(addMission(world, spec).ok, false);
  for (const m of missionsOf(world)) cancelMission(world, m.id);
  for (let d = 0; d < 8; d++) advanceDay(world, ctx, {});
  assert.ok(!world.messages.some((m) => m.subject.startsWith('Scouting mission')));
});
