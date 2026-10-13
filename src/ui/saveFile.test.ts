import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { advanceDay, newSeasonContext, startSeason } from '../engine/season/seasonEngine.ts';
import { appointManager } from '../engine/world/career.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager, type World } from '../engine/world/world.ts';
import type { SaveMeta } from './persistence.ts';
import { careerFileName, careerReplacer, exportCareer, fileLines, importCareer, readCareerFile } from './saveFile.ts';

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

/** The lines of a file, as the file — plain, or gzipped as the game writes it. */
async function asFile(lines: Iterable<string>, gzip = false): Promise<Blob> {
  const plain = new Blob([...lines].map((l) => `${l}\n`));
  if (!gzip) return plain;
  return new Response(plain.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

test('a career file is written in pieces and read back as what it was', async () => {
  const big = Array.from({ length: 3000 }, (_, i) => ({ i, name: `p${i}`, tags: [i % 3, i % 5] }));
  const value = {
    big,
    map: new Map(Array.from({ length: 1500 }, (_, i) => [i, { at: new Map([['x', i]]), bytes: new Uint16Array([i, i + 1]) }] as const)),
    set: new Set(Array.from({ length: 800 }, (_, i) => `s${i}`)),
    typed: new Float32Array([1.5, -2, 3.25]),
    nested: { deeper: { rows: Array.from({ length: 700 }, (_, i) => [i, `r${i}`]) } },
    odd: { nan: NaN, inf: -Infinity, text: 'a line\nbreak and "quotes"', none: null },
    table: { toJSON: () => ['a', 'b', 'c'] },
    format: 'volleyball-manager-career',
    version: 2,
  };
  const lines = [...fileLines(value)];
  // Nothing is one giant line: the big array went over many.
  assert.ok(lines.length > 4);
  assert.ok(Math.max(...lines.map((l) => l.length)) < 400_000);
  for (const gzip of [false, true]) {
    const back = await readCareerFile(await asFile(lines, gzip));
    assert.deepEqual(back, { ...value, table: ['a', 'b', 'c'] });
    assert.ok(back.map instanceof Map && back.set instanceof Set && back.typed instanceof Float32Array);
  }
});

test('a piece too long for one string is taken apart instead', async () => {
  let first = true;
  // Throws as JSON.stringify does when a string would be too long — the first time only.
  const huge = { toJSON: () => { if (first) { first = false; throw new RangeError('Invalid string length'); } return [1, 2, 3]; } };
  const value = { world: { small: 1, parts: { a: huge, b: 'kept' } } };
  const back = await readCareerFile(await asFile(fileLines(value)));
  assert.deepEqual(back.world, { small: 1, parts: { a: [1, 2, 3], b: 'kept' } });
  assert.equal(first, false);
});

test('a career file from the first version still opens', async () => {
  const world = generateWorld({ seed: 17, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  for (let d = 0; d < 5; d++) advanceDay(world, ctx);
  const meta = { id: 'x', managerName: 'Old File', nationCode: 'BRA', clubName: 'Unemployed', clubNationCode: '', scale: 'small', inGameDate: '1 Jul 2026', season: 0, createdAt: 1, updatedAt: 2, schemaVersion: 1 } as SaveMeta;
  const v1 = JSON.stringify({ format: 'volleyball-manager-career', version: 1, meta, world, season: { stats: ctx.stats, seasonStartAbility: ctx.seasonStartAbility } }, careerReplacer);
  const expected = signature(world); // (it draws from the world's dice: once)
  for (const gzip of [false, true]) {
    const back = await importCareer(await asFile([v1], gzip));
    assert.deepEqual(back.meta, meta);
    assert.equal(back.world.players.count, world.players.count);
    assert.equal(back.world.players.fullName(9), world.players.fullName(9));
    assert.equal(signature(back.world), expected);
  }
});

test('a career file cut short is turned away, not half loaded', async () => {
  const lines = [...fileLines({ world: { a: Array.from({ length: 2000 }, (_, i) => i) } })];
  await assert.rejects(readCareerFile(await asFile(lines.slice(0, -1))), /damaged or incomplete/);
  const zipped = await asFile(lines, true);
  await assert.rejects(readCareerFile(zipped.slice(0, Math.floor(zipped.size / 2))), /damaged or incomplete/);
  await assert.rejects(readCareerFile(await asFile([...lines.slice(0, 2), '["k",{"broken"', ...lines.slice(2)])), /damaged or incomplete/);
  await assert.rejects(readCareerFile(new Blob([''])), /not a career/);
  await assert.rejects(readCareerFile(await asFile(['{"format":"volleyball-manager-career","version":9}'])), /newer version/);
});
