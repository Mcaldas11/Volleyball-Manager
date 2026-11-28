import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RealDb, RealPlayer } from '../../data/real/realDb.ts';
import { appointManager } from './career.ts';
import { under21SideOf, under21Relations } from './under21.ts';
import { alignUnder21Contracts } from './under21Contracts.ts';
import { recommendBlock, recommendToSeniorCoach, RECOMMEND_COOLDOWN, seniorCoachAnswers, seniorVerdict } from './under21Recommend.ts';
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

/** The manager coaching Clube Primeiro's under-21 side. */
function coaching(): { w: World; side: number[]; senior: ReturnType<World['clubs']['find']> & object } {
  const w = generateWorld({ seed: 51, startYear: 2026, scale: 'small', manager: stubManager(), real: fakeDb() });
  alignUnder21Contracts(w);
  const senior = w.clubs.find((c) => c.name === 'Clube Primeiro')!;
  const sideClub = under21SideOf(w, senior)!;
  appointManager(w, sideClub.id);
  return { w, side: sideClub.players, senior };
}

/** Run the days until the senior coach has answered. */
function answer(w: World): void {
  for (let i = 0; i < 6; i++) {
    w.day++;
    seniorCoachAnswers(w);
  }
}

test('the under-21 coach puts a player forward: a good one is called up, with the answer in the inbox', () => {
  const { w, side, senior } = coaching();
  const store = w.players;
  const p = side[0];
  const best = Math.max(...senior.players.map((x) => store.currentAbility[x]));
  store.currentAbility[p] = best;
  store.potentialAbility[p] = Math.min(2000, best + 100);
  assert.ok(seniorVerdict(w, senior, p, 'firstTeam') >= 0.5);
  const r = recommendToSeniorCoach(w, p, 'firstTeam');
  assert.ok(r.ok, r.text);
  assert.match(recommendBlock(w, p, 'firstTeam') ?? '', /not answered/);
  answer(w);
  assert.equal(store.clubId[p], senior.id, 'up with the first team');
  const reply = w.messages.find((m) => m.playerIdx === p && m.subject.includes(': yes'));
  assert.ok(reply !== undefined, 'the senior coach answers in the inbox');
});

test('a weak player is turned down with a reason, and the senior club thinks a little less of the coach for it', () => {
  const { w, side } = coaching();
  const store = w.players;
  const p = side[1];
  store.currentAbility[p] = 300;
  store.potentialAbility[p] = 400;
  const before = under21Relations(w).goodwill;
  assert.ok(recommendToSeniorCoach(w, p, 'firstTeam').ok);
  answer(w);
  const reply = w.messages.find((m) => m.playerIdx === p && m.subject.includes('not now'))!;
  assert.match(reply.body, /not at the level of the squad/);
  assert.ok(under21Relations(w).goodwill < before);
  // And not again for six weeks.
  assert.match(recommendBlock(w, p, 'firstTeam') ?? '', /Ask again in/);
  w.day += RECOMMEND_COOLDOWN;
  assert.equal(recommendBlock(w, p, 'firstTeam'), null);
});

test('a contract word is for the last under-21 season only, and a yes is the senior club\'s first-team contract', () => {
  const { w, side, senior } = coaching();
  const store = w.players;
  const [young, last] = side;
  store.birthYear[young] = 2009;
  store.contractUntil[young] = seasonEndDay(3);
  assert.match(recommendBlock(w, young, 'contract') ?? '', /his last season/);
  store.birthYear[last] = 2006;
  store.contractUntil[last] = seasonEndDay(0);
  const best = Math.max(...senior.players.map((x) => store.currentAbility[x]));
  store.currentAbility[last] = Math.round(best * 0.9);
  store.potentialAbility[last] = Math.min(2000, best + 200);
  assert.ok(recommendToSeniorCoach(w, last, 'contract').ok);
  answer(w);
  assert.ok(store.contractUntil[last] > seasonEndDay(0), 'signed past his under-21 days');
  assert.match(recommendBlock(w, last, 'contract') ?? '', /already has a contract/);
});

test('too many words in a month wear thin', () => {
  const { w, side } = coaching();
  const before = under21Relations(w).goodwill;
  for (const p of side.slice(0, 3)) assert.ok(recommendToSeniorCoach(w, p, 'firstTeam').ok);
  assert.equal(under21Relations(w).goodwill, before, 'three a month are fine');
  const r = recommendToSeniorCoach(w, side[3], 'firstTeam');
  assert.ok(r.ok);
  assert.match(r.text, /hearing a lot from you/);
  assert.ok(under21Relations(w).goodwill < before);
});

test('only the under-21 coach can put players forward', () => {
  const w = generateWorld({ seed: 52, startYear: 2026, scale: 'small', manager: stubManager(), real: fakeDb() });
  const senior = w.clubs.find((c) => c.name === 'Clube Primeiro')!;
  appointManager(w, senior.id);
  const p = under21SideOf(w, senior)!.players[0];
  assert.match(recommendBlock(w, p, 'firstTeam') ?? '', /Only the under-21 coach/);
});
