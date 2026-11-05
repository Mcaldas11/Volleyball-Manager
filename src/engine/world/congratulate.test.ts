import { test } from 'node:test';
import assert from 'node:assert/strict';
import { congratulate, congratulationBlock, honouredIn } from './congratulate.ts';
import { newPlayerStats } from '../match/stats.ts';
import { Position } from '../model/positions.ts';
import { recordClubMatch } from './clubHistory.ts';
import { postMessage } from './inbox.ts';
import { clubRecordHeadline, clubRecordSheet, type ClubRecord } from './matchReports.ts';
import { mainPosition } from './records.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type Fixture, type World } from './world.ts';

function career(): { world: World; mine: number[]; theirs: number } {
  const world = generateWorld({ seed: 21, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  const other = world.clubs.find((c) => c.id !== club.id && c.players.length > 0)!;
  for (const p of club.players) world.players.morale[p] = 50;
  return { world, mine: club.players, theirs: other.players[0] };
}

test('a milestone or a Player of the Month of ours: congratulate him, once, and his morale lifts', () => {
  const { world, mine } = career();
  const club = world.clubs[world.userClubId];
  const p = mine[0];
  const m = postMessage(world, {
    category: 'news', from: 'Club Media', playerIdx: p, subject: `${world.players.fullName(p)}: 100 games for ${club.name}`, body: '',
  });
  assert.deepEqual(honouredIn(world, m), [p]);
  const r = congratulate(world, club, m);
  assert.ok(r.ok && r.reply !== '');
  assert.equal(world.players.morale[p], 57);
  assert.notEqual(congratulationBlock(world, m), null, 'once only');
  assert.equal(congratulate(world, club, m).ok, false);
  assert.equal(world.players.morale[p], 57);

  const month = postMessage(world, {
    category: 'awards', from: 'League', subject: 'Player of the Month', body: '',
    award: { kind: 'player', competitionId: club.leagueId, month: 'October', players: [{ p: mine[1], clubId: club.id, apps: 4, avg: 7.5, points: 60 }] },
  } as Parameters<typeof postMessage>[1]);
  assert.deepEqual(honouredIn(world, month), [mine[1]]);
});

test('a team of the season with several of ours in it: the group is congratulated together — nobody else\'s players', () => {
  const { world, mine, theirs } = career();
  const club = world.clubs[world.userClubId];
  const picks = [mine[0], mine[1], mine[2], theirs].map((p, i) => ({ pos: i, p, clubId: i < 3 ? club.id : -1, rating: 7 }));
  const m = postMessage(world, {
    category: 'awards', from: 'League', subject: 'Team of the Season', body: '',
    teamOfSeason: { title: 'Team of the Season', season: 0, picks },
  } as Parameters<typeof postMessage>[1]);
  assert.deepEqual(honouredIn(world, m), [mine[0], mine[1], mine[2]]);
  const r = congratulate(world, club, m);
  assert.match(r.text, /together/);
  for (const p of [mine[0], mine[1], mine[2]]) assert.equal(world.players.morale[p], 54);
  assert.equal(world.players.morale[theirs] === 54, false);

  // A message about nobody of ours: nothing to congratulate.
  const none = postMessage(world, { category: 'news', from: 'League', subject: 'Round-up', body: '' });
  assert.deepEqual(honouredIn(world, none), []);
  assert.notEqual(congratulationBlock(world, none), null);
});

test('the club marks a milestone by the job: a hitter\'s points, no "0 points" for a libero', () => {
  const { world, mine } = career();
  const club = world.clubs[world.userClubId];
  const fixture = { home: club.id, away: club.id === 0 ? 1 : 0, competitionId: club.leagueId } as Fixture;
  const bodyFor = (pos: Position): string => {
    const p = mine.find((x) => world.players.position[x] === pos)!;
    const stats = newPlayerStats(p);
    stats.ralliesPlayed = 40;
    for (let i = 0; i < 600; i++) {
      const before = world.messages.length;
      recordClubMatch(world, fixture, new Map([[p, stats]]), new Map());
      const m = world.messages.slice(before).find((x) => x.playerIdx === p && / games for /.test(x.subject));
      if (m !== undefined) return m.body;
    }
    throw new Error('no milestone reached');
  };
  assert.doesNotMatch(bodyFor(Position.Libero), /points/);
  assert.doesNotMatch(bodyFor(Position.Setter), /points/);
  assert.match(bodyFor(Position.OutsideHitter), /with \d+ points along the way/);
});

function record(): ClubRecord {
  return {
    games: 100, sets: 350, points: 40, kills: 10, attacks: 30, attackErrors: 5, aces: 20, blocks: 10, digs: 700,
    passes: 900, goodPasses: 600, perfectPasses: 300, passErrors: 30, assists: 2800, setsMade: 6000, setErrors: 40,
  };
}

test('a club record is read for the position: a libero\'s digs and passes, a setter\'s assists, a middle\'s blocks', () => {
  const labels = (pos: Position): string[] => clubRecordSheet(pos, record()).figures.flat().map(([label]) => label);
  assert.ok(labels(Position.Libero).includes('Digs') && labels(Position.Libero).includes('Good passes'));
  assert.equal(labels(Position.Libero).some((l) => /Points|Kills|Aces|Blocks|Assists/.test(l)), false, 'nothing a libero is not there to do');
  assert.equal(clubRecordSheet(Position.Libero, record()).rows.some(([k]) => k === 'Serve' || k === 'Block' || k === 'Attack'), false);
  assert.equal(labels(Position.Setter)[0], 'Assists');
  assert.equal(labels(Position.MiddleBlocker)[0], 'Blocks');
  assert.equal(labels(Position.Opposite)[0], 'Points');
  assert.match(clubRecordHeadline(Position.Libero, record()), /700 digs and 67% of his passes good/);
  assert.match(clubRecordHeadline(Position.Setter, record()), /2800 assists/);
});

test('the main position is what he has played the most for his club, not his own — and congratulating says so', () => {
  const { world, mine } = career();
  const club = world.clubs[world.userClubId];
  const p = mine.find((x) => world.players.position[x] === Position.OutsideHitter)!;
  assert.equal(mainPosition(world, p), Position.OutsideHitter, 'nothing kept: his own');
  world.competitionRecords.set(p, [{
    season: 0, competitionId: club.leagueId, apps: 12, ratingSum: 0, best: 0, points: 0, aces: 0, blocks: 0, mvps: 0, starts: 12,
    positions: { [Position.Opposite]: 10, [Position.OutsideHitter]: 2 },
  }]);
  assert.equal(mainPosition(world, p), Position.Opposite);

  const libero = mine.find((x) => world.players.position[x] === Position.Libero)!;
  const m = postMessage(world, {
    category: 'news', from: 'Club Media', playerIdx: libero, subject: `${world.players.fullName(libero)}: 100 games for ${club.name}`, body: '',
  });
  const r = congratulate(world, club, m);
  assert.match(r.text, /on 100 games for the club/);
  assert.match(r.reply, /digs/);
});
