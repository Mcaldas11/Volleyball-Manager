import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch } from '../match/engine.ts';
import { computeRatings } from '../match/ratings.ts';
import { Position } from '../model/positions.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { bankFor, feminineSurname, NAME_BANKS } from './names.ts';
import { NATIONS, nationStrength } from './nations.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

test('every naming tradition has its women\'s names — and surnames take the feminine form where the language does', () => {
  for (const group of Object.keys(NAME_BANKS)) {
    const women = bankFor(group, true);
    assert.ok(women.first.length >= 15, group);
    // A few names are worn by both.
    assert.ok(women.first.filter((n) => NAME_BANKS[group].first.includes(n)).length <= 3, group);
  }
  assert.equal(feminineSurname('polish', 'Kowalski'), 'Kowalska');
  assert.equal(feminineSurname('polish', 'Nowak'), 'Nowak');
  assert.equal(feminineSurname('czech', 'Novák'), 'Nováková');
  assert.equal(feminineSurname('czech', 'Novotný'), 'Novotná');
  assert.equal(feminineSurname('czech', 'Svoboda'), 'Svobodová');
  assert.equal(feminineSurname('czech', 'Jelínek'), 'Jelínková');
  assert.equal(feminineSurname('russian', 'Ivanov'), 'Ivanova');
  assert.equal(feminineSurname('ukrainian', 'Shevchenko'), 'Shevchenko');
  assert.equal(feminineSurname('greek', 'Papadopoulos'), 'Papadopoulou');
  assert.equal(feminineSurname('greek', 'Papadakis'), 'Papadaki');
  assert.equal(feminineSurname('latvian', 'Bērziņš'), 'Bērziņa');
  assert.equal(feminineSurname('italian', 'Rossi'), 'Rossi');
});

function world(gender: 'men' | 'women', seed = 191): World {
  return generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager(), gender });
}

test('the women\'s game: its players named and built as women, its nations ranked as the women\'s game ranks them', () => {
  const men = world('men');
  const menHeights = Array.from({ length: men.players.count }, (_, i) => men.players.heightCm[i]);
  const menReach = Array.from({ length: men.players.count }, (_, i) => men.players.spikeReachCm[i]);
  const women = world('women');
  const store = women.players;
  assert.equal(women.gender, 'women');
  assert.equal(store.women, true);
  const heights = Array.from({ length: store.count }, (_, i) => store.heightCm[i]);
  const reach = Array.from({ length: store.count }, (_, i) => store.spikeReachCm[i]);
  assert.ok(mean(menHeights) - mean(heights) > 9 && mean(menHeights) - mean(heights) < 15, `${mean(menHeights)} vs ${mean(heights)}`);
  assert.ok(mean(menReach) - mean(reach) > 24 && mean(menReach) - mean(reach) < 35, `${mean(menReach)} vs ${mean(reach)}`);
  // Names from the women's banks.
  const firsts = new Set(Object.keys(NAME_BANKS).flatMap((g) => bankFor(g, true).first));
  const sample = Array.from({ length: 200 }, (_, k) => store.names.get(store.firstName[(k * 37) % store.count]));
  assert.ok(sample.filter((n) => firsts.has(n)).length > 190);
  // The women's map: Türkiye and the United States up, Iran down.
  const code = (c: string): number => NATIONS.findIndex((n) => n.code === c);
  assert.ok(nationStrength(code('TUR')) > nationStrength(code('IRI')) + 20);
  const turkey = women.clubs.filter((c) => c.nation === code('TUR') && c.tier === 1);
  const iran = women.clubs.filter((c) => c.nation === code('IRI') && c.tier === 1);
  assert.ok(mean(turkey.map((c) => c.reputation)) > mean(iran.map((c) => c.reputation)));
  // And back to the men's for a men's world.
  world('men');
  assert.ok(nationStrength(code('IRI')) > nationStrength(code('TUR')));
});

test('the engine measures a woman against the women\'s game: her ratings, and so the matches, come out like the men\'s', () => {
  const ratingsOf = (w: World): number[] => {
    const store = w.players;
    const out: number[] = [];
    for (const c of w.clubs.filter((x) => x.tier === 1).slice(0, 60)) {
      for (const p of c.players) out.push(computeRatings(store, p, store.position[p] as Position).attackPower);
    }
    return out;
  };
  const men = world('men', 192);
  const m = mean(ratingsOf(men));
  const women = world('women', 192);
  const f = mean(ratingsOf(women));
  assert.ok(Math.abs(m - f) / m < 0.06, `attack power ${m.toFixed(1)} men, ${f.toFixed(1)} women`);

  // A women's match: the ball slower, the result as close-fought.
  const [a, b] = women.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  const r = simulateMatch(women.players, {
    home: toTeamSetup(women.players, a), away: toTeamSetup(women.players, b), format: MatchFormat.BestOf5,
    importance: 0.5, neutralVenue: false, collectLog: true, seed: 5,
  });
  const spikes = r.log!.flatMap((x) => x.contacts).filter((c) => c.kind === 'kill' && c.speed !== undefined).map((c) => c.speed!);
  assert.ok(spikes.length > 10 && mean(spikes) < 100, `spikes ${mean(spikes).toFixed(0)} km/h`);
});
