import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPlayerStats } from '../match/stats.ts';
import { Position } from '../model/positions.ts';
import { advanceDay, isSeasonOver, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { appsLabel, positionsPlayed, recordFixture, type CompetitionRecord } from './records.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type Fixture } from './world.ts';

function line(over: Partial<CompetitionRecord>): CompetitionRecord {
  return { season: 0, competitionId: 0, apps: 0, ratingSum: 0, best: 0, points: 0, aces: 0, blocks: 0, mvps: 0, ...over };
}

test('appearances read as starts, then off the bench in brackets', () => {
  assert.equal(appsLabel([line({ apps: 5, starts: 1 })]), '1(4)');
  assert.equal(appsLabel([line({ apps: 4, starts: 0 })]), '0(4)');
  assert.equal(appsLabel([line({ apps: 12, starts: 12 })]), '12', 'no brackets when he began them all');
  assert.equal(appsLabel([line({ apps: 5, starts: 1 }), line({ apps: 3, starts: 3 })]), '4(4)', 'across competitions');
  assert.equal(appsLabel([]), '0');
});

test('a line from before starts were kept reads as its total, and never claims a split it cannot know', () => {
  const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
  const p = world.clubs[0].players[0];
  const old = line({ season: world.season, competitionId: 0, apps: 10, ratingSum: 70 });
  world.competitionRecords.set(p, [old]);
  assert.equal(appsLabel([old]), '10');

  const fixture = { id: 1, competitionId: 0, day: 0, home: 0, away: 1, homeSets: 3, awaySets: 0, setScores: [], mvp: -1, played: true } as unknown as Fixture;
  const stats = newPlayerStats(p);
  stats.ralliesPlayed = 40;
  recordFixture(world, fixture, new Map([[p, stats]]), new Map());
  assert.equal(old.apps, 11);
  assert.equal(appsLabel([old]), '11');
  assert.equal(positionsPlayed([old]).reduce((n, x) => n + x.matches, 0), 1, 'positions: only what is known');
});

test('a substitute is not a starter, and a match in two positions counts in both', () => {
  const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
  const [starter, sub] = world.clubs[0].players;
  const fixture = { id: 1, competitionId: 0, day: 0, home: 0, away: 1, homeSets: 3, awaySets: 0, setScores: [], mvp: -1, played: true } as unknown as Fixture;
  const stats = new Map([starter, sub].map((p) => {
    const s = newPlayerStats(p);
    s.ralliesPlayed = 20;
    return [p, s] as const;
  }));
  recordFixture(world, fixture, stats, new Map(), 'full', {
    starters: new Set([starter]),
    positionsPlayed: new Map([
      [starter, 1 << Position.Opposite],
      [sub, (1 << Position.Opposite) | (1 << Position.OutsideHitter)],
    ]),
  });
  const of = (p: number): CompetitionRecord => world.competitionRecords.get(p)![0];
  assert.equal(appsLabel([of(starter)]), '1');
  assert.equal(appsLabel([of(sub)]), '0(1)');
  assert.deepEqual(positionsPlayed([of(starter)]), [{ position: Position.Opposite, matches: 1 }]);
  assert.deepEqual(new Set(positionsPlayed([of(sub)]).map((x) => x.position)), new Set([Position.Opposite, Position.OutsideHitter]));
});

test('a season played: the manager\'s squad has starters and men off the bench, and every match is in a position', () => {
  const world = generateWorld({ seed: 21, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  appointManager(world, club.id);
  while (!isSeasonOver(world)) advanceDay(world, ctx);

  let bench = 0;
  let started = 0;
  for (const [, lines] of world.competitionRecords) {
    for (const l of lines) {
      assert.ok(l.starts !== undefined && l.starts <= l.apps, 'starts within appearances');
      assert.equal(l.unsplit, undefined);
      const inPositions = positionsPlayed([l]).reduce((n, x) => n + x.matches, 0);
      assert.ok(inPositions >= l.apps, 'every appearance is in at least one position');
    }
  }
  for (const p of club.players) {
    for (const l of world.competitionRecords.get(p) ?? []) {
      started += l.starts!;
      bench += l.apps - l.starts!;
    }
  }
  assert.ok(started > 0, 'somebody started');
  assert.ok(bench > 0, 'somebody came on');
});
