import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { followed, postNews, type NewsItem } from './news.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';

/** A season in the world, the manager in charge of a top-flight club, played up to `day`. */
function season(seed: number, day: number): { world: World; clubId: number; news: NewsItem[] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const clubId = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id;
  appointManager(world, clubId);
  // Stories are filed as they happen: catch each one as the day it was filed.
  const news: NewsItem[] = [];
  let seen = world.nextNewsId;
  while (world.day < day) {
    advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
    for (const n of world.news) if (n.id >= seen) news.push(n);
    seen = world.nextNewsId;
  }
  return { world, clubId, news };
}

test('a season makes the news: coaches, rumours, injuries, results and the monthly awards', () => {
  const { news } = season(21, 330);
  for (const kind of ['coach', 'rumour', 'injury', 'result', 'award'] as const) {
    assert.ok(news.some((n) => n.kind === kind), `some ${kind} news`);
  }
  assert.ok(news.some((n) => n.headline.includes('Player of the Month')));
  assert.ok(news.some((n) => n.headline.includes('Coach of the Month')));
  // A paper, not a firehose: a handful of stories a week.
  assert.ok(news.length > 60 && news.length < 400, `${news.length} stories in a season`);
});

test('the paper covers the leagues that matter, and every story names its country', () => {
  const { world, news } = season(22, 200);
  for (const n of news) {
    assert.ok(n.headline.length > 0 && n.body.length > 0);
    assert.ok(n.nation >= -1);
    const club = n.clubId !== undefined ? world.clubs[n.clubId] : undefined;
    // A rumour is filed under the suitor, who may be from anywhere; the player's club is followed.
    const subject = n.kind === 'rumour' ? (n.otherClubId !== undefined ? world.clubs[n.otherClubId] : undefined) : club;
    if (subject !== undefined && n.kind !== 'title') assert.ok(followed(world, subject), `${n.headline}: a followed club`);
  }
});

test('a rumour is a bigger club after a player whose contract is running out', () => {
  const { world, clubId, news } = season(23, 300);
  const rumours = news.filter((n) => n.kind === 'rumour');
  assert.ok(rumours.length > 5);
  const store = world.players;
  for (const r of rumours) {
    const suitor = world.clubs[r.clubId!];
    const club = world.clubs[r.otherClubId!];
    assert.ok(suitor.reputation > club.reputation, 'the suitor is the bigger club');
    assert.notEqual(club.id, clubId, 'not about the manager\'s own players');
    const p = r.playerIdx!;
    // Still in his last season, unless he has moved since.
    if (store.clubId[p] === club.id) assert.ok(store.contractUntil[p] <= seasonEndDay(world.season));
  }
  // Nobody is rumoured twice inside six weeks.
  const last = new Map<number, number>();
  for (const r of rumours) {
    const prev = last.get(r.playerIdx!);
    if (prev !== undefined) assert.ok(r.day - prev >= 45);
    last.set(r.playerIdx!, r.day);
  }
});

test('the summer brings champions and signings, and the feed keeps only its latest stories', () => {
  const { world } = season(24, 349);
  const before = world.nextNewsId;
  endSeason(world, newSeasonContext());
  const summer = world.news.filter((n) => n.id >= before);
  assert.ok(summer.some((n) => n.kind === 'title'), 'champions crowned');
  assert.ok(summer.some((n) => n.kind === 'transfer' || n.kind === 'contract'), 'players moving or staying');

  for (let i = 0; i < 500; i++) postNews(world, { kind: 'result', headline: 'x', body: 'y', nation: 0 });
  assert.equal(world.news.length, 400);
  assert.equal(world.news[world.news.length - 1].id, world.nextNewsId - 1, 'the newest kept');
});
