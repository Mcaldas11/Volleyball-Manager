import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlayerStats } from '../match/stats.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { openSeasonSpells, recordClubMatch, spellsOf, spellYears } from './clubHistory.ts';
import { competitionStats } from './competitionStats.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type Fixture } from './world.ts';

test('a player\'s clubs: his career before the save drawn up, and every match and move after it kept', () => {
  const world = generateWorld({ seed: 12, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const veterans = world.clubs.flatMap((c) => c.players).filter((p) => store.ageOn(p, world.year, 181) >= 30);
  assert.ok(veterans.length > 20);
  for (const p of veterans) {
    const spells = spellsOf(world, p);
    assert.ok(spells.length >= 1);
    // Oldest first, one after the other, ending where he is now, this season.
    const last = spells[spells.length - 1];
    assert.equal(last.club, store.clubId[p]);
    assert.equal(last.to, 0);
    for (let i = 1; i < spells.length; i++) {
      assert.equal(spells[i].from, spells[i - 1].to + 1);
      assert.notEqual(spells[i].club, spells[i - 1].club);
      assert.equal(spells[i - 1].apps, -1, 'what he did before the save is not known');
    }
  }
  assert.ok(veterans.some((p) => spellsOf(world, p).length >= 3), 'a veteran has been around');
  const [a, b] = spellYears(world, { club: 0, from: -2, to: 0, apps: 0, points: 0 });
  assert.deepEqual([a, b], [2024, 2027]);

  // A match for his club counts there.
  const p = veterans[0];
  const club = store.clubId[p];
  const stats = newPlayerStats(p);
  stats.ralliesPlayed = 40;
  stats.attackKills = 9;
  stats.serveAces = 1;
  const fixture = { home: club, away: club === 0 ? 1 : 0, competitionId: world.clubs[club].leagueId } as Fixture;
  recordClubMatch(world, fixture, new Map([[p, stats]]), new Map());
  const now = spellsOf(world, p).at(-1)!;
  assert.deepEqual([now.club, now.apps, now.points], [club, 1, 10]);

  // Sold in the summer: a new spell at his new club from the new season.
  const other = world.clubs.find((c) => c.id !== club && c.tier === world.clubs[club].tier)!;
  world.clubs[club].players = world.clubs[club].players.filter((x) => x !== p);
  other.players.push(p);
  store.clubId[p] = other.id;
  world.season++;
  openSeasonSpells(world);
  const moved = spellsOf(world, p);
  assert.deepEqual(moved.at(-2)!.club, club);
  assert.deepEqual([moved.at(-1)!.club, moved.at(-1)!.from, moved.at(-1)!.apps], [other.id, 1, 0]);
  // Staying put another season, the spell runs on.
  world.season++;
  openSeasonSpells(world);
  assert.equal(spellsOf(world, p).length, moved.length);
  assert.equal(spellsOf(world, p).at(-1)!.to, 2);
});

test('a competition\'s statistics: every side\'s record matches its table, and the players\' numbers add up to the sides\'', () => {
  const world = generateWorld({ seed: 31, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  appointManager(world, world.clubs.find((c) => c.tier === 1)!.id);
  while (world.day < 130) advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  const league = world.competitions[world.clubs[world.userClubId].leagueId];
  const { teams, players } = competitionStats(world, league.id);
  assert.equal(teams.length, league.table.length);
  for (const row of league.table) {
    const t = teams.find((x) => x.clubId === row.clubId)!;
    assert.deepEqual([t.matches, t.won, t.setsWon, t.setsLost], [row.played, row.won, row.setsFor, row.setsAgainst]);
  }
  assert.ok(teams.every((t) => t.matches > 3));
  const scored = teams.reduce((s, t) => s + t.pointsFor, 0);
  assert.equal(scored, teams.reduce((s, t) => s + t.pointsAgainst, 0), 'every point scored was conceded by someone');
  // A side's kills are its players' — everyone who played for it, still there.
  const own = teams.find((t) => t.clubId === world.userClubId)!;
  const mine = players.filter((s) => s.clubId === world.userClubId);
  assert.ok(mine.length >= 7);
  assert.equal(own.kills, mine.reduce((s, x) => s + x.kills, 0));
  assert.ok(own.kills > 0 && own.aces > 0 && own.blocks > 0 && own.digs > 0);
  assert.ok(players.every((s) => s.apps > 0 && s.apps <= own.matches + 1));
});
