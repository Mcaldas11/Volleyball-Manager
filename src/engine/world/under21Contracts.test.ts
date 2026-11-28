import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RealDb, RealPlayer } from '../../data/real/realDb.ts';
import { appointManager } from './career.ts';
import {
  agingOut, alignUnder21Contracts, letUnder21PlayerGo, seniorKeeps, settleUnder21Contracts, under21ContractEnd,
  under21ContractsDay, under21RenewalIsMine,
} from './under21Contracts.ts';
import { under21SideOf } from './under21.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';

function fakeDb(): RealDb {
  const p = (first: string, last: string, position: RealPlayer['position']): RealPlayer => ({
    first, last, position, nation: 'POR', birthYear: 1998, birthDay: 100, heightCm: 196,
    weightKg: null, spikeReachCm: null, blockReachCm: null, shirt: null,
  });
  const roster = (tag: string): RealPlayer[] => [
    p('Alfa', `Setter${tag}`, 'S'), p('Beta', `Outside${tag}`, 'OH'), p('Gama', `Outside${tag}B`, 'OH'),
    p('Delta', `Middle${tag}`, 'MB'), p('Eta', `Opp${tag}`, 'OP'), p('Teta', `Libero${tag}`, 'L'),
  ];
  return {
    version: 1, builtAt: '2026-11-26T00:00:00Z', gender: 'men', sources: [],
    leagues: [{
      nation: 'POR', tier: 1, name: 'Test Liga', season: '2026/27', source: 'test', url: '',
      clubs: ['Primeiro', 'Segundo', 'Terceiro', 'Quarto'].map((n, i) => ({
        name: `Clube ${n}`, shortName: n.slice(0, 3).toUpperCase(), city: null, arena: null, standing: i + 1, players: roster(n),
      })),
    }],
    internationals: [],
    internationalsSource: 'test',
  };
}

function world(): World {
  const w = generateWorld({ seed: 41, startYear: 2026, scale: 'small', manager: stubManager(), real: fakeDb() });
  alignUnder21Contracts(w);
  return w;
}

const sideOf = (w: World, name: string) => {
  const senior = w.clubs.find((c) => c.name === name)!;
  return { senior, side: under21SideOf(w, senior)! };
};

test('an under-21 contract runs to the end of the last season he is under-21', () => {
  const w = world();
  const { side } = sideOf(w, 'Clube Primeiro');
  const store = w.players;
  assert.ok(side.players.length > 0);
  for (const p of side.players) {
    // Born 2006 is under-21 in 2026/27 (season 0) only; born 2010, until 2030/31 (season 4).
    const last = store.birthYear[p] + 20 - 2026;
    assert.equal(store.contractUntil[p], seasonEndDay(Math.max(0, last)), `${store.fullName(p)}, born ${store.birthYear[p]}`);
  }
  // A sixteen-year-old: five seasons.
  const kid = side.players[0];
  store.birthYear[kid] = 2010;
  assert.equal(under21ContractEnd(w, kid), seasonEndDay(4));
  assert.equal(agingOut(w, kid), false);
});

test('at the age limit an AI senior club keeps who is good enough for it and releases the rest', () => {
  const w = world();
  const { senior, side } = sideOf(w, 'Clube Segundo');
  const store = w.players;
  const [good, poor, young] = side.players;
  for (const p of [good, poor]) store.birthYear[p] = 2006;
  store.birthYear[young] = 2008;
  for (const p of [good, poor, young]) store.contractUntil[p] = seasonEndDay(0);
  const best = Math.max(...senior.players.map((p) => store.currentAbility[p]));
  store.currentAbility[good] = best;
  store.currentAbility[poor] = 200;
  store.potentialAbility[poor] = 300;
  assert.ok(seniorKeeps(w, senior, good));
  assert.ok(!seniorKeeps(w, senior, poor));
  const released = settleUnder21Contracts(w);
  assert.ok(store.contractUntil[good] > seasonEndDay(0), 'a first-team contract');
  assert.ok(released.includes(poor) && store.clubId[poor] === -1, 'released');
  assert.ok(!side.players.includes(poor));
  assert.equal(store.contractUntil[young], seasonEndDay(2), 'still under-21: on to his age limit, 2028/29');
  assert.equal(store.clubId[young], side.id);
});

test('the senior manager decides: warned, he renews or lets go; the under-21 coach is only told', () => {
  const w = world();
  const { senior, side } = sideOf(w, 'Clube Terceiro');
  const store = w.players;
  const [a, b] = side.players;
  for (const p of [a, b]) {
    store.birthYear[p] = 2006;
    store.contractUntil[p] = seasonEndDay(0);
    // Good enough that an AI club would keep them: the manager's club decides for itself.
    store.currentAbility[p] = 1999;
  }
  appointManager(w, senior.id);
  assert.ok(under21RenewalIsMine(w, a));
  w.day = 184;
  under21ContractsDay(w);
  const warned = w.messages.filter((m) => m.under21Contract === true);
  // Both warned: and any of the side's real players in their last under-21 season with them, warned the same way.
  const warnedFor = warned.map((m) => m.playerIdx!);
  assert.ok(warnedFor.includes(a) && warnedFor.includes(b));
  for (const x of warnedFor) assert.ok(under21RenewalIsMine(w, x), 'only players at the age limit');
  assert.ok(letUnder21PlayerGo(w, b).ok);
  // He renews one (as the talks would); the other goes.
  store.contractUntil[a] = seasonEndDay(2);
  settleUnder21Contracts(w);
  assert.equal(store.clubId[a], side.id, 'renewed: he moves up with the summer');
  assert.equal(store.clubId[b], -1, 'let go');
  assert.ok(w.messages.some((m) => m.subject.includes(`leave ${side.name}`) || m.subject.includes(`leaves ${side.name}`)));

  // Coaching the under-21 side instead: no say, only the news.
  const w2 = world();
  const s2 = sideOf(w2, 'Clube Terceiro');
  const [c] = s2.side.players;
  w2.players.birthYear[c] = 2006;
  w2.players.contractUntil[c] = seasonEndDay(0);
  appointManager(w2, s2.side.id);
  assert.equal(under21RenewalIsMine(w2, c), false, 'not his decision');
  assert.equal(letUnder21PlayerGo(w2, c).ok, false);
  w2.day = 184;
  under21ContractsDay(w2);
  assert.ok(!w2.messages.some((m) => m.under21Contract === true), 'no renew or release buttons');
  settleUnder21Contracts(w2);
  assert.ok(w2.messages.some((m) => m.subject === `${s2.senior.name} decide on the players leaving ${s2.side.name}`), 'told what the first team decided');
});
