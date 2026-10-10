import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { followed, postNews, type NewsItem } from './news.ts';
import { fanComments } from './fans.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';

/** A season in the world, the manager in charge of a top-flight club, played up to `day`. */
function season(seed: number, day: number): { world: World; clubId: number; news: NewsItem[]; standing: Map<number, [number, number]> } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const clubId = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id;
  appointManager(world, clubId);
  // Stories are filed as they happen: catch each one as the day it was filed.
  const news: NewsItem[] = [];
  // Where the two clubs in a story stood the day it was filed — reputations move over a season.
  const standing = new Map<number, [number, number]>();
  let seen = world.nextNewsId;
  while (world.day < day) {
    advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
    for (const n of world.news) {
      if (n.id < seen) continue;
      news.push(n);
      if (n.clubId !== undefined && n.otherClubId !== undefined) standing.set(n.id, [world.clubs[n.clubId].reputation, world.clubs[n.otherClubId].reputation]);
    }
    seen = world.nextNewsId;
  }
  return { world, clubId, news, standing };
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
    // The manager's own club is followed wherever it plays, and whoever it deals with.
    const own = n.clubId === world.userClubId || n.otherClubId === world.userClubId;
    if (subject !== undefined && n.kind !== 'title' && !own) assert.ok(followed(world, subject), `${n.headline}: a followed club`);
  }
});

test('a rumour is a bigger club after a player whose contract is running out', () => {
  const { world, clubId, news, standing } = season(23, 300);
  const rumours = news.filter((n) => n.kind === 'rumour');
  assert.ok(rumours.length > 5);
  const store = world.players;
  for (const r of rumours) {
    const club = world.clubs[r.otherClubId!];
    const [suitorRep, clubRep] = standing.get(r.id)!;
    assert.ok(suitorRep > clubRep, 'the suitor is the bigger club');
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

test("the manager's own matches make the paper, and the fans of both sides have their say", () => {
  const { world, clubId, news } = season(25, 200);
  // While he is the club's manager, that is — a manager can be sacked.
  const left = world.career.jobs.find((j) => j.clubId === clubId)?.endDay ?? -1;
  const played = world.fixtures.filter((f) => f.played && (f.home === clubId || f.away === clubId) &&
    (left < 0 || f.day < left) &&
    !['friendly', 'international'].includes(world.competitions[f.competitionId]?.kind ?? ''));
  // One report per match — a side going top of the table is a story of its own.
  const reports = news.filter((n) => n.kind === 'result' && n.fans?.story !== 'top' && (n.clubId === clubId || n.otherClubId === clubId));
  assert.ok(played.length > 5);
  assert.equal(reports.length, played.length, 'every competitive match he plays is reported');
  assert.ok(world.news.some((n) => n.kind === 'coach' && n.clubId === clubId), 'his appointment made the news');

  const report = reports[0];
  const comments = fanComments(world, report);
  assert.ok(comments.length >= 4);
  assert.ok(comments.some((c) => c.clubId === report.clubId) && comments.some((c) => c.clubId === report.otherClubId),
    "the winners' fans and the losers'");
  assert.deepEqual(fanComments(world, report), comments, 'the same comments every time the story is read');
});

test('every story carries what the fans make of it, written out in full', () => {
  const { world, news } = season(26, 330);
  assert.ok(news.length > 0);
  const kinds = new Set<string>();
  for (const n of news) {
    assert.ok(n.fans !== undefined, `${n.headline}: a brief for the fans`);
    const comments = fanComments(world, n);
    assert.ok(comments.length > 0, `${n.headline}: comments`);
    for (const c of comments) {
      assert.ok(!/[{}]/.test(c.text) && c.text.trim().length > 0, c.text);
      assert.ok(c.handle.length > 2 && c.likes >= 0);
      assert.ok(c.clubId !== undefined || c.nation !== undefined, 'a fan of someone');
    }
    for (let i = 1; i < comments.length; i++) assert.ok(comments[i - 1].likes >= comments[i].likes, 'most liked first');
    kinds.add(n.fans!.story);
  }
  for (const story of ['match', 'rumour', 'injury', 'sacked']) assert.ok(kinds.has(story), `some ${story} stories`);
  // A story from before fans had their say has none, and is none the worse for it.
  assert.deepEqual(fanComments(world, { id: 1 }), []);
});
