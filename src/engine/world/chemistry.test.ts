import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { Position } from '../model/positions.ts';
import { newPlayerStats } from '../match/stats.ts';
import { MatchFormat, MatchSimulator } from '../match/engine.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { chemistryOf, chemKey, CHEM_NEW, CLICKED, clubChemistry, noteTogether, summerChemistry } from './chemistry.ts';

function world() {
  return generateWorld({ seed: 61, startYear: 2026, scale: 'small', manager: stubManager() });
}

test('a squad that has trained together knows each other; a pair who never played together starts from scratch', () => {
  const w = world();
  const club = w.clubs.find((c) => c.players.length >= 12)!;
  const pairs = clubChemistry(w, club.players);
  assert.ok(pairs.length >= 8);
  for (const { c } of pairs) assert.ok(c >= 0.42 && c <= 0.75, `${c}`);
  const other = w.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const setter = club.players.find((p) => w.players.position[p] === Position.Setter)!;
  const stranger = other.players.find((p) => w.players.position[p] === Position.OutsideHitter)!;
  assert.equal(chemistryOf(w, setter, stranger), CHEM_NEW);
});

test('every match together brings a pair closer — and the manager hears when one of his clicks', () => {
  const w = world();
  const club = w.clubs.find((c) => c.players.length >= 12)!;
  w.userClubId = club.id;
  const store = w.players;
  const setter = club.players.find((p) => store.position[p] === Position.Setter)!;
  const [hitter, benched] = club.players.filter((p) => store.position[p] === Position.OutsideHitter);
  w.chemistry!.set(chemKey(setter, hitter), 0.3);
  w.chemistry!.set(chemKey(setter, benched), 0.3);
  const stats = new Map([[setter, newPlayerStats(setter)], [hitter, newPlayerStats(hitter)], [benched, newPlayerStats(benched)]]);
  stats.get(setter)!.ralliesPlayed = 180;
  stats.get(hitter)!.ralliesPlayed = 180;
  stats.get(benched)!.ralliesPlayed = 30;
  const messages = w.messages.length;
  let matches = 0;
  while (chemistryOf(w, setter, hitter) < CLICKED && matches < 100) {
    noteTogether(w, stats);
    matches++;
  }
  assert.ok(matches > 10 && matches < 40, `${matches} matches to click`);
  assert.ok(chemistryOf(w, setter, benched) < chemistryOf(w, setter, hitter) - 0.2, 'a few rallies together teach less');
  assert.equal(w.messages.length, messages + 1);
  assert.match(w.messages.at(-1)!.subject, /clicked/);
});

test('over the summer a pair split up is forgotten, and the rest lose a little', () => {
  const w = world();
  const club = w.clubs.find((c) => c.players.length >= 12)!;
  const other = w.clubs.find((c) => c.id !== club.id)!;
  const store = w.players;
  const setter = club.players.find((p) => store.position[p] === Position.Setter)!;
  const [stays, goes] = club.players.filter((p) => store.position[p] === Position.MiddleBlocker);
  w.chemistry!.set(chemKey(setter, stays), 0.9);
  w.chemistry!.set(chemKey(setter, goes), 0.9);
  store.clubId[goes] = other.id;
  summerChemistry(w);
  assert.ok(chemistryOf(w, setter, stays) < 0.9 && chemistryOf(w, setter, stays) > 0.8);
  assert.equal(w.chemistry!.has(chemKey(setter, goes)), false);
});

test('on court, a side whose setter and hitters know each other beats the same side meeting for the first time', () => {
  const w = world();
  const club = w.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[0];
  let won = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const r = new MatchSimulator(w.players, {
      home: { ...toTeamSetup(w.players, club), chemistry: () => 0.95 },
      away: { ...toTeamSetup(w.players, club), chemistry: () => CHEM_NEW },
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 300 + i,
    }).run();
    if (r.homeSets > r.awaySets) won++;
  }
  assert.ok(won / N > 0.54, `${((won / N) * 100).toFixed(0)}% won`);
  assert.ok(won / N < 0.75, 'an edge, not a certainty');
});
