import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RealDb, RealPlayer } from '../../data/real/realDb.ts';
import { Position } from '../model/positions.ts';
import { StaffRole } from '../model/staff.ts';
import { NATION_BY_CODE } from './nations.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { advanceDay, isSeasonOver, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';

/** A made-up file in the real-data shape: two clubs in Portugal's top flight. */
function fakeDb(): RealDb {
  const p = (first: string, last: string, position: RealPlayer['position'], extra: Partial<RealPlayer> = {}): RealPlayer => ({
    first, last, position, nation: 'POR', birthYear: 1998, birthDay: 100, heightCm: 196,
    weightKg: null, spikeReachCm: null, blockReachCm: null, shirt: null, ...extra,
  });
  const roster = (tag: string): RealPlayer[] => [
    p('Alfa', `Setter${tag}`, 'S'), p('Beta', `Outside${tag}`, 'OH'), p('Gama', `Outside${tag}B`, 'OH'),
    p('Delta', `Middle${tag}`, 'MB', { heightCm: 207 }), p('Eta', `Opp${tag}`, 'OP', { nation: 'BRA' }),
    p('Teta', `Libero${tag}`, 'L', { heightCm: 178 }),
  ];
  return {
    version: 1, builtAt: '2026-11-26T00:00:00Z', gender: 'men', sources: [],
    leagues: [{
      nation: 'POR', tier: 1, name: 'Test Liga', season: '2026/27', source: 'test', url: '',
      clubs: [
        { name: 'Clube Primeiro', shortName: 'PRI', city: 'Norte', arena: 'Pavilhão Um', standing: 1, players: roster('A'),
          coaches: [{ first: 'Treinador', last: 'Principal', role: 'head' }] },
        { name: 'Clube Segundo', shortName: 'SEG', city: 'Sul', arena: null, standing: 2, players: roster('B') },
      ],
    }, {
      nation: 'POR', tier: 2, name: 'Test Segunda', season: '2026/27', source: 'test', url: '',
      clubs: [{ name: 'Clube Terceiro', shortName: 'TER', city: null, arena: null, standing: 1, players: roster('C') }],
    }],
    internationals: [
      { nation: 'POR', first: 'Alfa', last: 'SetterA', position: 'S' },
      { nation: 'ITA', first: 'Zeta', last: 'Azzurro', position: 'MB' },
    ],
    internationalsSource: 'test',
  };
}

test('a real-data world puts the real clubs and rosters in the covered top flight', () => {
  const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager(), real: fakeDb() });
  const por = NATION_BY_CODE.get('POR')!;
  const league = world.competitions.find((c) => c.kind === 'league' && c.nation === por && c.tier === 1)!;
  assert.equal(league.name, 'Portugal Test Liga');
  assert.equal(league.participants.length, 2);

  const first = world.clubs.find((c) => c.name === 'Clube Primeiro')!;
  const second = world.clubs.find((c) => c.name === 'Clube Segundo')!;
  assert.ok(first.reputation >= second.reputation, 'the table leader is the stronger club');
  assert.equal(first.arenaName, 'Pavilhão Um');
  const head = first.staff.map((id) => world.staff[id]).find((s) => s.role === StaffRole.HeadCoach)!;
  assert.equal(`${head.firstName} ${head.lastName}`, 'Treinador Principal');
  // The second tier, where the world has a single one: the real club is in it.
  const third = world.clubs.find((c) => c.name === 'Clube Terceiro');
  if (world.competitions.some((c) => c.kind === 'league' && c.nation === por && c.tier === 2)) assert.equal(third?.tier, 2);

  const store = world.players;
  const names = first.players.map((i) => `${store.names.get(store.firstName[i])} ${store.names.get(store.lastName[i])}`);
  assert.ok(names.includes('Delta MiddleA'));
  const middle = first.players.find((i) => store.names.get(store.lastName[i]) === 'MiddleA')!;
  assert.equal(store.heightCm[middle], 207);
  assert.equal(store.birthYear[middle], 1998);
  assert.equal(store.position[middle], Position.MiddleBlocker);
  const opp = first.players.find((i) => store.names.get(store.lastName[i]) === 'OppA')!;
  assert.equal(store.nation[opp], NATION_BY_CODE.get('BRA'));
  // Short positions filled: at least two setters and two liberos.
  assert.ok(first.players.filter((i) => store.position[i] === Position.Setter).length >= 2);
  assert.ok(first.players.filter((i) => store.position[i] === Position.Libero).length >= 2);

  // The Italian international with no club in the file takes a generated Italian middle's place.
  let found = false;
  for (let i = 0; i < store.count; i++) {
    if (store.names.get(store.lastName[i]) === 'Azzurro') {
      found = true;
      assert.equal(store.nation[i], NATION_BY_CODE.get('ITA'));
      assert.equal(store.position[i], Position.MiddleBlocker);
    }
  }
  assert.ok(found);
});

test('each real top-flight club has an under-21 side in a league of its own, its real under-21s there', () => {
  const db = fakeDb();
  const club = db.leagues[0].clubs[0];
  club.players[1].secondary = 'OP';
  club.youth = [{
    first: 'Jovem', last: 'Promessa', position: 'MB', nation: 'POR', birthYear: 2007, birthDay: 10, heightCm: 199,
    weightKg: null, spikeReachCm: null, blockReachCm: null, shirt: 21,
  }];
  const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager(), real: db });
  const store = world.players;
  const first = world.clubs.find((c) => c.name === 'Clube Primeiro')!;
  const u21 = world.clubs.find((c) => c.name === 'Clube Primeiro U21')!;
  assert.equal(u21.under21Of, first.id);
  assert.ok(first.affiliates?.includes(u21.id), 'the senior club works with it');
  const league = world.competitions[u21.leagueId];
  assert.equal(league.under21, true);
  assert.equal(league.participants.length, 2);
  assert.ok(!world.clubs.some((c) => c.name.includes('Promessa')));
  const kid = u21.players.find((i) => store.names.get(store.lastName[i]) === 'Promessa')!;
  assert.ok(kid !== undefined, 'the real under-21 plays for the under-21 side');
  assert.equal(store.position[kid], Position.MiddleBlocker);
  assert.equal(store.heightCm[kid], 199);
  assert.ok(u21.players.length >= 12, 'a full squad');
  for (const p of u21.players) assert.ok(2026 - store.birthYear[p] <= 21, 'no one older than 21');
  const oh = first.players.find((i) => store.names.get(store.lastName[i]) === 'OutsideA')!;
  assert.equal(store.secondary[oh], Position.Opposite);
});

test('an under-21 league is left out of the pyramid, plays its season, and its 22-year-olds move up', () => {
  const world = generateWorld({ seed: 11, startYear: 2026, scale: 'small', manager: stubManager(), real: fakeDb() });
  const u21 = world.clubs.find((c) => c.name === 'Clube Primeiro U21')!;
  const league = world.competitions[u21.leagueId];
  assert.equal(league.promotionSlots + league.relegationSlots, 0);
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  assert.ok(league.fixtureIds.length > 0, 'it has fixtures');
  const store = world.players;
  const leaving = u21.players.filter((p) => 2027 - store.birthYear[p] > 21);
  while (!isSeasonOver(world)) advanceDay(world, ctx);
  assert.ok(league.table.every((r) => r.played > 0), 'every side played its season');
  endSeason(world, ctx);
  for (const p of leaving) assert.notEqual(store.clubId[p], u21.id, 'gone from the under-21s at 22');
  for (const p of u21.players) assert.ok(2027 - store.birthYear[p] <= 21, 'signings no older than 21');
  assert.equal(u21.under21Of, world.clubs.find((c) => c.name === 'Clube Primeiro')!.id);
});

test('a hand-written player on a real roster is that player, not a second copy', () => {
  const db = fakeDb();
  db.leagues[0].clubs[0].players.push({
    first: 'Diogo', last: 'Couto', position: 'L', nation: 'POR', birthYear: 2005, birthDay: 175, heightCm: 184,
    weightKg: null, spikeReachCm: null, blockReachCm: null, shirt: 9,
  });
  const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager(), real: db });
  const store = world.players;
  let copies = 0;
  for (let i = 0; i < store.count; i++) {
    if (store.names.get(store.firstName[i]) === 'Diogo' && store.names.get(store.lastName[i]) === 'Couto') copies++;
  }
  assert.equal(copies, 1);
  const i = world.uniquePlayers!['diogo-couto'];
  assert.equal(world.clubs[store.clubId[i]].name, 'Clube Primeiro');
});

test('without a file, or in the women\'s game, nothing changes', () => {
  const a = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
  const b = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager(), gender: 'women', real: fakeDb() });
  assert.ok(!a.clubs.some((c) => c.name === 'Clube Primeiro'));
  assert.ok(!b.clubs.some((c) => c.name === 'Clube Primeiro'));
});
