import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { oddsFor, previewReplies } from './matchPreview.ts';
import { paperStrength } from './predictions.ts';

function career() {
  const world = generateWorld({ seed: 57, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[2];
  appointManager(world, club.id);
  return { world, ctx, club };
}

test('the day before a league match, the manager gets the odds, every result and the fans\' calls — once', () => {
  const { world, ctx, club } = career();
  const league = world.competitions[club.leagueId];
  for (let d = 0; d < 260 && !world.messages.some((m) => m.preview !== undefined); d++) advanceDay(world, ctx, {});
  const m = world.messages.find((x) => x.preview !== undefined)!;
  assert.ok(m !== undefined, 'a preview');
  const pv = m.preview!;
  const f = world.fixtures[pv.fixtureId];
  assert.ok(f.home === club.id || f.away === club.id);
  assert.equal(f.competitionId, league.id);
  assert.equal(f.day, world.day, 'there for the match day');
  assert.ok(pv.homeWin >= 0 && pv.homeWin <= 100);
  assert.equal(pv.results.length, 6, 'from 3-0 to 0-3');
  const total = pv.results.reduce((s, r) => s + r.pct, 0);
  assert.ok(Math.abs(total - 100) <= 4, `the results add up: ${total}`);
  const homeWins = pv.results.filter((r) => r.score[0] > r.score[1]).reduce((s, r) => s + r.pct, 0);
  assert.ok(Math.abs(homeWins - pv.homeWin) <= 3, 'the win chance is the sum of the wins');
  assert.ok(pv.poll >= 6 && pv.poll <= 94);
  assert.equal(pv.comments.length, 7);
  assert.ok(pv.comments.some((c) => c.clubId === f.home) && pv.comments.some((c) => c.clubId === f.away), 'both sides\' fans');
  for (const c of pv.comments) assert.ok(pv.results.some((r) => r.score[0] === c.call[0] && r.score[1] === c.call[1]), 'a real score');
  assert.equal(previewReplies(world, pv).length, 0, 'nothing to say about a match not yet played');

  // Played: the thread carries on, and whoever called it says so.
  advanceDay(world, ctx, {});
  assert.ok(f.played);
  assert.equal(world.messages.filter((x) => x.preview?.fixtureId === f.id).length, 1, 'one preview a match');
  const replies = previewReplies(world, pv);
  assert.ok(replies.length >= 2);
  const right = pv.comments.filter((c) => c.call[0] === f.homeSets && c.call[1] === f.awaySets);
  if (right.length > 0) assert.ok(replies.some((r) => /Called it|exactly as I said|Told you/.test(r.text)));
  else assert.ok(replies.some((r) => /Not one of you called/.test(r.text)));
});

test('the stronger squad is the favourite, and more so at home', () => {
  const { world, club } = career();
  const league = world.competitions[club.leagueId];
  const byPaper = [...league.participants].sort((a, b) => paperStrength(world, world.clubs[b].players) - paperStrength(world, world.clubs[a].players));
  const [best, worst] = [byPaper[0], byPaper.at(-1)!];
  const base = world.fixtures.find((f) => f.competitionId === league.id)!;
  const careers = (): number => [...world.clubs[best].players, ...world.clubs[worst].players]
    .reduce((s, p) => s + world.players.careerMatches[p] + world.players.careerPoints[p], 0);
  const before = careers();
  const atHome = oddsFor(world, { ...base, id: 900001, home: best, away: worst, neutralVenue: false })!;
  const away = oddsFor(world, { ...base, id: 900002, home: worst, away: best, neutralVenue: false })!;
  assert.ok(atHome.homeWin > 60, `the best at home: ${atHome.homeWin}%`);
  assert.ok(away.homeWin < 40, `the worst at home: ${away.homeWin}%`);
  assert.equal(careers(), before, 'four hundred matches played over, and nobody\'s career a match longer');
});
