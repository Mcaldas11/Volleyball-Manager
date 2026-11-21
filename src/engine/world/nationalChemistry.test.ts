import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlayerStats } from '../match/stats.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { chemistryOf, chemKey, CHEM_NEW } from './chemistry.ts';
import { applyIntlResult, internationalDay, nationSetup, suggestSquad, type IntlMatch, type Tournament } from './internationals.ts';
import { MatchFormat, simulateMatch } from '../match/engine.ts';
import {
  nationalCampDay, nationalChemistryOf, nationalChemKey, nationalTogether, summerNationalChemistry,
} from './nationalChemistry.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function world(): World {
  return generateWorld({ seed: 77, startYear: 2026, scale: 'small', manager: stubManager() });
}

/** A nation's squad, and a setter and a hitter from it who are not club-mates. */
function squadPair(w: World): { nation: number; squad: number[]; setter: number; hitter: number } {
  const store = w.players;
  for (const team of w.nationalTeams) {
    const squad = suggestSquad(w, team.nation);
    if (squad.length < 14) continue;
    const setter = squad.find((p) => store.position[p] === Position.Setter);
    const hitter = squad.find((p) => store.position[p] === Position.OutsideHitter && store.clubId[p] !== store.clubId[setter ?? -1]);
    if (setter !== undefined && hitter !== undefined) return { nation: team.nation, squad, setter, hitter };
  }
  throw new Error('no squad');
}

/** A tournament window: `days` together, `matches` of them played side by side. */
function window(w: World, nation: number, squad: number[], setter: number, hitter: number, days: number, matches: number): void {
  const t = { status: 'pools', squads: [[nation, squad]], out: [] } as unknown as Tournament;
  const stats = new Map([[setter, newPlayerStats(setter)], [hitter, newPlayerStats(hitter)]]);
  stats.get(setter)!.ralliesPlayed = 170;
  stats.get(hitter)!.ralliesPlayed = 170;
  for (let d = 0; d < days; d++) nationalCampDay(w, t);
  for (let m = 0; m < matches; m++) nationalTogether(w, nation, stats);
}

test('a national pair with no history starts new; caps and club-mates start ahead', () => {
  const w = world();
  const store = w.players;
  const { nation, setter, hitter } = squadPair(w);
  store.nationalCaps[setter] = 0;
  store.nationalCaps[hitter] = 0;
  assert.equal(nationalChemistryOf(w, nation, setter, hitter), CHEM_NEW);
  // Two seasoned internationals have played together before.
  store.nationalCaps[setter] = 80;
  store.nationalCaps[hitter] = 60;
  const seasoned = nationalChemistryOf(w, nation, setter, hitter);
  assert.ok(seasoned > 0.45 && seasoned < 0.6, `${seasoned}`);
  // Club-mates bring what they have at their club.
  store.nationalCaps[hitter] = 0;
  store.clubId[hitter] = store.clubId[setter];
  w.chemistry!.set(chemKey(setter, hitter), 0.72);
  assert.equal(nationalChemistryOf(w, nation, setter, hitter), 0.72);
});

test('a stable squad reaches a good understanding within a season or two of windows', () => {
  const w = world();
  const store = w.players;
  const { nation, squad, setter, hitter } = squadPair(w);
  store.nationalCaps[setter] = 0;
  store.nationalCaps[hitter] = 0;
  // A small nation: one major a summer, out after the pools.
  window(w, nation, squad, setter, hitter, 12, 5);
  const one = nationalChemistryOf(w, nation, setter, hitter);
  assert.ok(one > 0.3 && one < 0.45, `after one window ${one}`);
  summerNationalChemistry(w);
  window(w, nation, squad, setter, hitter, 12, 5);
  const two = nationalChemistryOf(w, nation, setter, hitter);
  assert.ok(two >= 0.45, `after two seasons ${two}, good`);

  // A big one: the Nations League and a major run to the final every year.
  const v = world();
  const pair = squadPair(v);
  v.players.nationalCaps[pair.setter] = 0;
  v.players.nationalCaps[pair.hitter] = 0;
  window(v, pair.nation, pair.squad, pair.setter, pair.hitter, 21, 10);
  window(v, pair.nation, pair.squad, pair.setter, pair.hitter, 18, 7);
  const season = nationalChemistryOf(v, pair.nation, pair.setter, pair.hitter);
  assert.ok(season >= 0.6 && season < 0.8, `after a full season ${season}, strong, not yet telepathic`);
});

test("what is built for the country stays the country's: club chemistry is untouched, and another nation's is apart", () => {
  const w = world();
  const { nation, squad, setter, hitter } = squadPair(w);
  const clubBefore = new Map(w.chemistry!);
  window(w, nation, squad, setter, hitter, 14, 6);
  assert.deepEqual(new Map(w.chemistry!), clubBefore, 'the clubs keep exactly what they had');
  assert.equal(chemistryOf(w, setter, hitter), clubBefore.get(chemKey(setter, hitter)) ?? CHEM_NEW);
  assert.ok(w.nationalChemistry!.has(nationalChemKey(nation, setter, hitter)));
  assert.equal(w.nationalChemistry!.has(nationalChemKey(nation + 1, setter, hitter)), false);
});

test('between windows a national pair keeps most of it, whatever clubs they move to, and a retired one is forgotten', () => {
  const w = world();
  const store = w.players;
  const { nation, squad, setter, hitter } = squadPair(w);
  const other = squad.find((p) => p !== hitter && store.position[p] === Position.MiddleBlocker)!;
  w.nationalChemistry = new Map([
    [nationalChemKey(nation, setter, hitter), 0.7],
    [nationalChemKey(nation, setter, other), 0.7],
  ]);
  store.clubId[hitter] = w.clubs.find((c) => c.id !== store.clubId[setter])!.id;
  store.setFlag(other, PlayerFlag.Retired, true);
  summerNationalChemistry(w);
  const kept = w.nationalChemistry.get(nationalChemKey(nation, setter, hitter))!;
  assert.ok(kept > 0.6 && kept < 0.7, `${kept}`);
  assert.equal(w.nationalChemistry.has(nationalChemKey(nation, setter, other)), false);
});

test("a nation's matches play to its own chemistry, and teach it", () => {
  const w = world();
  const a = squadPair(w);
  const b = w.nationalTeams.find((t) => t.nation !== a.nation && suggestSquad(w, t.nation).length >= 14)!.nation;
  const t = {
    id: 1, competitionId: -50, squads: [[a.nation, a.squad], [b, suggestSquad(w, b)]], out: [], stats: new Map(), host: -1, kind: 'friendly',
  } as unknown as Tournament;
  const setup = nationSetup(w, t, a.nation);
  assert.equal(setup.chemistry?.(a.setter, a.hitter), nationalChemistryOf(w, a.nation, a.setter, a.hitter));
  const m: IntlMatch = {
    id: 9, day: w.day, home: a.nation, away: b, stage: 'Friendly', round: -1, slot: 0, bronze: false, played: false,
    homeSets: 0, awaySets: 0, setScores: [], mvp: -1,
  };
  const result = simulateMatch(w.players, {
    home: setup, away: nationSetup(w, t, b), format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 5,
  });
  const before = w.nationalChemistry?.size ?? 0;
  const clubBefore = new Map(w.chemistry!);
  applyIntlResult(w, t, m, result);
  assert.ok((w.nationalChemistry?.size ?? 0) > before, 'the pairs on court learnt something');
  assert.deepEqual(new Map(w.chemistry!), clubBefore);
});

test("in a new world each nation's core has played together before: building to good, short of a club's", () => {
  const w = world();
  assert.equal(w.nationalChemistry, undefined);
  internationalDay(w);
  const { nation, setter, hitter } = squadPair(w);
  const c = nationalChemistryOf(w, nation, setter, hitter);
  assert.ok(c >= 0.32 && c <= 0.55, `${c}`);
  // Seeded once: a day later it is what the days have made it, not seeded again.
  w.nationalChemistry!.set(nationalChemKey(nation, setter, hitter), 0.9);
  internationalDay(w);
  assert.equal(nationalChemistryOf(w, nation, setter, hitter), 0.9);
});
