import { test } from 'node:test';
import assert from 'node:assert/strict';
import { congratulate, congratulationBlock, honouredIn } from './congratulate.ts';
import { postMessage } from './inbox.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

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
