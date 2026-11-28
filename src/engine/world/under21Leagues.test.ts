import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RealDb, RealPlayer } from '../../data/real/realDb.ts';
import { compareTableRows } from '../model/club.ts';
import { advanceDay, isSeasonOver, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { NATION_BY_CODE } from './nations.ts';
import {
  promotionPlayoff, under21Divisions, under21PromotionRelegation, under21Zones, UNDER21_DIV2_TIER, UNDER21_TIER,
} from './under21Leagues.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

/** A made-up file in the real-data shape: six clubs in Portugal's top flight. */
function fakeDb(): RealDb {
  const p = (first: string, last: string, position: RealPlayer['position']): RealPlayer => ({
    first, last, position, nation: 'POR', birthYear: 1998, birthDay: 100, heightCm: 196,
    weightKg: null, spikeReachCm: null, blockReachCm: null, shirt: null,
  });
  const roster = (tag: string): RealPlayer[] => [
    p('Alfa', `Setter${tag}`, 'S'), p('Beta', `Outside${tag}`, 'OH'), p('Gama', `Outside${tag}B`, 'OH'),
    p('Delta', `Middle${tag}`, 'MB'), p('Eta', `Opp${tag}`, 'OP'), p('Teta', `Libero${tag}`, 'L'),
  ];
  const names = ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto', 'Sexto'];
  return {
    version: 1, builtAt: '2026-11-26T00:00:00Z', gender: 'men', sources: [],
    leagues: [{
      nation: 'POR', tier: 1, name: 'Test Liga', season: '2026/27', source: 'test', url: '',
      clubs: names.map((n, i) => ({ name: `Clube ${n}`, shortName: n.slice(0, 3).toUpperCase(), city: null, arena: null, standing: i + 1, players: roster(n) })),
    }],
    internationals: [],
    internationalsSource: 'test',
  };
}

function world(seed: number): World {
  return generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager(), real: fakeDb() });
}

test('beside a real top flight, the U21 second division: the under-21 sides of the best clubs below', () => {
  const w = world(31);
  const por = NATION_BY_CODE.get('POR')!;
  const d = under21Divisions(w).find((x) => x.nation === por)!;
  assert.equal(d.first.tier, UNDER21_TIER);
  assert.equal(d.first.participants.length, 6);
  assert.ok(d.second !== undefined, 'a second division');
  assert.equal(d.second.tier, UNDER21_DIV2_TIER);
  assert.equal(d.second.name, 'Portugal U21 Second Division');
  assert.ok(d.second.participants.length >= 4 && d.second.participants.length <= 12);
  for (const id of d.second.participants) {
    const side = w.clubs[id];
    assert.ok(side.under21Of !== undefined, 'an under-21 side');
    assert.equal(w.competitions[w.clubs[side.under21Of].leagueId].tier, 2, 'of a second-tier club');
    assert.ok(side.players.length > 0, 'with a squad');
  }
  // Shading: the first division's last down, the one above it to the playoff; the second's champions up, its runners-up to the playoff.
  assert.deepEqual(under21Zones(d.first), { up: 0, playoffUp: 0, playoffDown: 1, down: 1 });
  assert.deepEqual(under21Zones(d.second), { up: 1, playoffUp: 1, playoffDown: 0, down: 0 });
  // Out of the senior pyramid: nobody moves there because of them.
  assert.equal(d.second.promotionSlots + d.second.relegationSlots, 0);
});

test('up and down: the champions and the playoff winners go up, the last and the playoff losers go down', () => {
  const w = world(32);
  const d = under21Divisions(w)[0];
  const second = d.second!;
  // A season played: each table in the order of its participants.
  for (const comp of [d.first, second]) {
    comp.table.forEach((r, i) => { r.played = 10; r.points = 100 - i * 5; });
  }
  const top = [...d.first.table].sort(compareTableRows).map((r) => r.clubId);
  const below = [...second.table].sort(compareTableRows).map((r) => r.clubId);
  const last = top[top.length - 1];
  const holder = top[top.length - 2];
  const champion = below[0];
  const challenger = below[1];
  // The playoff: the second division's runners-up won it.
  d.first.playoffGroups.push({
    id: 'promotion', label: 'U21 Promotion Playoff', seeds: [holder, challenger], rounds: [], currentRound: 0,
    resolved: true, finalOrder: [challenger, holder],
  });
  const sizes = [d.first.participants.length, second.participants.length];
  const moves = under21PromotionRelegation(w);
  assert.deepEqual(moves.filter((m) => m.up).map((m) => m.clubId).sort(), [champion, challenger].sort());
  assert.deepEqual(moves.filter((m) => !m.up).map((m) => m.clubId).sort(), [last, holder].sort());
  for (const id of [champion, challenger]) {
    assert.ok(d.first.participants.includes(id));
    assert.equal(w.clubs[id].leagueId, d.first.id);
    assert.equal(w.clubs[id].tier, UNDER21_TIER);
  }
  for (const id of [last, holder]) {
    assert.ok(second.participants.includes(id));
    assert.equal(w.clubs[id].leagueId, second.id);
  }
  assert.deepEqual([d.first.participants.length, second.participants.length], sizes, 'the divisions keep their size');
  assert.ok(w.news.some((n) => n.headline.includes(`up to ${d.first.name}`)), 'the papers have it');
});

test('a season of the U21 divisions: the playoff is a best of three in the spring, and its result moves the sides', () => {
  const w = world(33);
  const ctx = newSeasonContext();
  startSeason(w, ctx);
  const d = under21Divisions(w)[0];
  const second = d.second!;
  while (!isSeasonOver(w)) advanceDay(w, ctx);
  const po = promotionPlayoff(d)!;
  assert.ok(po !== undefined, 'the playoff was drawn');
  const top = [...d.first.table].sort(compareTableRows).map((r) => r.clubId);
  const below = [...second.table].sort(compareTableRows).map((r) => r.clubId);
  assert.deepEqual(po.seeds, [top[top.length - 2], below[1]], 'second from bottom against the runners-up');
  assert.ok(po.resolved, 'played out');
  const tie = po.rounds[0][0];
  assert.equal(tie.winsNeeded, 2, 'a best of three');
  const games = (tie.games ?? []).map((id) => w.fixtures[id]);
  assert.ok(games.length >= 2 && games.length <= 3);
  assert.equal(games[0].home, po.seeds[0], 'the first-division side at home in game one');
  const [winner, loser] = po.finalOrder;
  endSeason(w, ctx);
  assert.ok(d.first.participants.includes(below[0]), 'the champions are up');
  assert.ok(second.participants.includes(top[top.length - 1]), 'the last are down');
  assert.ok(d.first.participants.includes(winner), 'the playoff winners play in the first division');
  assert.ok(second.participants.includes(loser), 'its losers in the second');
  // And the new season is drawn with them where they now are.
  assert.ok(d.first.table.some((r) => r.clubId === below[0]));
  assert.ok(d.first.fixtureIds.some((id) => w.fixtures[id].home === winner || w.fixtures[id].away === winner));
});

test('U21 league stats: a first-team player who played for the under-21 side counts for that side', async () => {
  const { competitionStats } = await import('./competitionStats.ts');
  const w = world(31);
  const por = NATION_BY_CODE.get('POR')!;
  const comp = under21Divisions(w).find((x) => x.nation === por)!.first;
  const side = w.clubs[comp.participants[0]];
  const senior = w.clubs[side.under21Of!];
  const p = senior.players[0];
  w.competitionRecords.set(p, [{
    season: w.season, competitionId: comp.id, clubId: side.id, apps: 3, ratingSum: 20, points: 12, aces: 1, blocks: 2, mvps: 0,
  } as never]);
  const s = competitionStats(w, comp.id);
  const line = s.players.find((x) => x.p === p);
  assert.ok(line !== undefined, 'listed');
  assert.equal(line.clubId, side.id, 'under the under-21 side, so "My club" keeps him');
  assert.equal(s.teams.find((t) => t.clubId === side.id)!.aces, 1, 'and in its totals');
});
