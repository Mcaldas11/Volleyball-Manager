import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager, type World } from './world.ts';
import { appointManager, careerDay, coachSpells, headCoachOf, spellTrophies } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';

function world(seed: number): World {
  const w = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(w, newSeasonContext());
  return w;
}

test('a head coach\'s results go on his spell at the club', () => {
  const w = world(501);
  const ctx = newSeasonContext();
  while (w.day < 110) advanceDay(w, ctx);
  const club = w.clubs.find((c) => c.tier === 1 && headCoachOf(w, c) !== undefined)!;
  const coach = headCoachOf(w, club)!;
  const spell = coachSpells(w, coach).find((s) => s.to < 0)!;
  assert.equal(spell.clubId, club.id);
  assert.ok(spell.won + spell.lost > 0, 'his matches are on his record');
});

test('the sack closes a coach\'s spell, and his successor opens one of his own', () => {
  const w = world(502);
  const club = w.clubs.find((c) => c.tier === 1 && headCoachOf(w, c) !== undefined)!;
  const coach = headCoachOf(w, club)!;
  const start = w.season * DAYS_PER_SEASON;
  for (let d = 80; d < 300 && coach.clubId >= 0; d++) {
    w.day = start + d;
    club.boardConfidence = 0;
    club.coachSince = -DAYS_PER_SEASON;
    careerDay(w);
  }
  assert.equal(coach.clubId, -1, 'the board acted');
  const closed = coachSpells(w, coach).find((s) => s.clubId === club.id)!;
  assert.ok(closed.to >= 0);
  assert.equal(closed.exit, 'sacked');

  for (let d = w.day + 1; headCoachOf(w, club) === undefined && d < w.day + 120; d++) {
    w.day = d;
    careerDay(w);
  }
  const successor = headCoachOf(w, club);
  assert.ok(successor !== undefined && successor !== coach);
  const open = coachSpells(w, successor).find((s) => s.to < 0)!;
  assert.equal(open.clubId, club.id);
  assert.ok(open.from > start + 80, 'from the day he was appointed');
});

test('a coach who makes way for the user is on record as replaced — with the titles won in his time', () => {
  const w = world(503);
  const club = w.clubs.find((c) => c.tier === 1 && headCoachOf(w, c) !== undefined)!;
  const coach = headCoachOf(w, club)!;
  const league = w.competitions[club.leagueId];
  w.history.push({
    season: -1, year: 2026, champions: [{ competitionId: league.id, winner: club.id }], playerOfTheYear: -1,
    topScorer: { player: -1, points: 0 }, youngPlayerOfTheYear: -1, mostImproved: { player: -1, gain: 0 },
    youngestPlayer: -1, dissolved: [],
  });
  club.coachSince = -DAYS_PER_SEASON;
  appointManager(w, club.id);

  const spell = coachSpells(w, coach).find((s) => s.clubId === club.id)!;
  assert.equal(spell.exit, 'replaced');
  assert.deepEqual(spellTrophies(w, spell), [{ competitionId: league.id, year: 2026 }]);
});
