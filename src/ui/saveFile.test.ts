import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { advanceDay, newSeasonContext, startSeason } from '../engine/season/seasonEngine.ts';
import { appointManager } from '../engine/world/career.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager, type World } from '../engine/world/world.ts';
import type { SaveMeta } from './persistence.ts';
import { careerFileName, exportCareer, importCareer } from './saveFile.ts';

/** A fingerprint of everything that moves as the world goes on. */
function signature(world: World): string {
  const h = createHash('sha1');
  const s = world.players;
  h.update(Buffer.from(s.currentAbility.buffer, s.currentAbility.byteOffset, s.currentAbility.byteLength));
  h.update(Buffer.from(s.morale.buffer, s.morale.byteOffset, s.morale.byteLength));
  h.update(Buffer.from(s.clubId.buffer, s.clubId.byteOffset, s.clubId.byteLength));
  for (const f of world.fixtures) h.update(`${f.id}:${f.played ? `${f.homeSets}-${f.awaySets}` : '-'};`);
  for (const c of world.clubs) h.update(`${c.id}:${Math.round(c.finances.balance)}:${c.players.length};`);
  h.update(`${world.day}:${world.messages.length}:${world.rng.next()}`);
  return h.digest('hex');
}

test('a career written to a file and read back carries on exactly as the one that stayed', async () => {
  const world = generateWorld({ seed: 91, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1)[0];
  appointManager(world, club.id);
  for (let d = 0; d < 40; d++) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });

  const meta: SaveMeta = {
    id: 'x', managerName: 'Alex Manager', nationCode: 'BRA', clubName: club.name, clubNationCode: 'BRA', scale: 'small',
    inGameDate: '9 Aug 2026', season: 0, createdAt: 1, updatedAt: 2, schemaVersion: 1,
  };
  const file = await exportCareer(meta, world, ctx);
  assert.ok(file.size > 1000);
  const back = await importCareer(file);
  assert.deepEqual(back.meta, meta);
  assert.equal(back.world.players.count, world.players.count);
  assert.equal(back.world.players.fullName(5), world.players.fullName(5));
  assert.ok(back.world.matchReports instanceof Map || back.world.matchReports === undefined);

  // The two go on side by side, day for day: same results, same everything.
  for (let d = 0; d < 30; d++) {
    advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });
    advanceDay(back.world, back.season, { detailedClubs: new Set([club.id]) });
  }
  assert.equal(signature(back.world), signature(world));
  assert.match(careerFileName(meta), /^Alex Manager - .+ - 9 Aug 2026\.vmcareer$/);
});

test('a file that isn\'t a career is turned away', async () => {
  await assert.rejects(importCareer(new Blob(['{"hello": 1}'])), /not a career/);
  await assert.rejects(importCareer(new Blob(['not json at all'])), /not a career/);
});
