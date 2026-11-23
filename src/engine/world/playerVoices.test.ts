import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailedMatchSetup, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { simulateMatch } from '../match/engine.ts';
import { appointManager, resign } from './career.ts';
import { awardQuote, departureReactions, matchVoices, seasonAwardStory } from './playerVoices.ts';
import { socialFeed } from './socialFeed.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type Fixture, type World } from './world.ts';

function fresh(seed: number): { world: World; clubId: number } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const clubId = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id;
  appointManager(world, clubId);
  return { world, clubId };
}

const NO_LONG_DASH = /—/;

test('when the manager resigns, the players speak: in the paper, on the feed, and in a digest in his inbox', () => {
  const { world, clubId } = fresh(401);
  const club = world.clubs[clubId];
  const before = world.nextNewsId;
  assert.equal(resign(world), true);
  const said = world.news.filter((n) => n.id >= before && n.quote !== undefined);
  assert.ok(said.length >= 2 && said.length <= 4, `${said.length} players spoke`);
  for (const n of said) {
    assert.ok(club.players.includes(n.quote!.p), 'a player of the club he left');
    assert.ok(n.body.includes(n.quote!.text));
    assert.ok(!NO_LONG_DASH.test(n.body) && !NO_LONG_DASH.test(n.headline), n.body);
  }
  const digest = world.messages.find((m) => /players react to your resignation/.test(m.subject));
  assert.ok(digest !== undefined, 'a digest in his inbox');
  for (const n of said) assert.ok(digest.body.includes(n.quote!.text));
  // The players post their words on the feed themselves.
  const feed = socialFeed(world);
  assert.ok(said.every((n) => feed.some((p) => p.kind === 'player' && p.key === `q${n.id}`)));
});

test('a player left out speaks against the coach who goes, and it costs the coach a little of his name', () => {
  const { world, clubId } = fresh(402);
  const club = world.clubs[clubId];
  const s = world.players;
  // The best player in the squad, frozen out and miserable, with a short fuse and no media sense.
  const dropped = [...club.players].sort((a, b) => s.currentAbility[b] - s.currentAbility[a])[0];
  s.morale[dropped] = 5;
  s.playingTime[dropped] = 0;
  s.setAttr(dropped, 'temperament', 2);
  s.setAttr(dropped, 'mediaHandling', 2);
  s.setAttr(dropped, 'professionalism', 3);
  if (club.captain === dropped) club.captain = undefined;
  const before = world.nextNewsId;
  const factor = departureReactions(world, club, 'sacked', 0);
  const his = world.news.find((n) => n.id >= before && n.quote?.p === dropped);
  assert.ok(his !== undefined, 'the dropped player has his say');
  assert.ok(/critical|relieved/.test(his.body), his.body);
  assert.equal(his.fans?.story, 'playerUpset');
  if (/critical/.test(his.body)) assert.ok(factor < 1, `a critical word costs the coach: ${factor}`);
});

test('an award comes with a dedication, and the winner of one of the manager\'s own tells his inbox', () => {
  const { world, clubId } = fresh(403);
  const p = world.clubs[clubId].players[0];
  const lines = new Set<string>();
  for (let d = 0; d < 30; d++) {
    world.day += 1;
    const text = awardQuote(world, p, 'Player of the Month');
    assert.ok(!NO_LONG_DASH.test(text));
    assert.ok(/dedicate|for |share|thank|belongs|It goes to|It is for/i.test(text), text);
    lines.add(text);
  }
  assert.ok(lines.size >= 10, `${lines.size} different dedications in a month of days`);
  const before = world.nextNewsId;
  const inbox = world.messages.length;
  seasonAwardStory(world, p, 'League Player of the Season');
  const story = world.news.find((n) => n.id >= before);
  assert.ok(story !== undefined && story.kind === 'award' && story.quote?.p === p);
  assert.ok(world.messages.slice(inbox).some((m) => m.playerIdx === p && m.body.includes(story.quote!.text)));
});

/** A league match of the manager's club, as if just played: `homeSets`-`awaySets`. */
function played(world: World, clubId: number, homeSets: number, awaySets: number): Fixture {
  const club = world.clubs[clubId];
  const other = world.clubs.find((c) => c.leagueId === club.leagueId && c.id !== clubId)!;
  return {
    id: 999_999, competitionId: club.leagueId, day: world.day, home: clubId, away: other.id, round: 1, format: 0,
    importance: 0.5, neutralVenue: false, played: true, homeSets, awaySets,
    setScores: [], mvp: -1,
  } as Fixture;
}

test('the player who gave away the last point of a tie-break says he would take it again', () => {
  const { world, clubId } = fresh(404);
  const s = world.players;
  const p = world.clubs[clubId].players.find((q) => s.position[q] !== 4)!;
  s.setAttr(p, 'confidence', 18);
  s.setAttr(p, 'composure', 17);
  const before = world.nextNewsId;
  const inbox = world.messages.length;
  matchVoices(world, played(world, clubId, 2, 3), new Map(), new Map(), { player: p, team: 0, kind: 'attackError' });
  const story = world.news.find((n) => n.id >= before && n.quote?.p === p);
  assert.ok(story !== undefined, 'he speaks');
  assert.equal(story.fans?.story, 'playerBrave');
  assert.match(story.quote!.text, /again|afraid|hiding|hundred|big moments/i);
  assert.ok(world.messages.slice(inbox).some((m) => m.playerIdx === p), 'his manager hears it');

  // Not a tie-break, nothing to say about it.
  const quiet = world.nextNewsId;
  world.day += 1;
  matchVoices(world, played(world, clubId, 0, 3), new Map(), new Map(), { player: p, team: 0, kind: 'attackError' });
  assert.ok(!world.news.some((n) => n.id >= quiet && n.fans?.story === 'playerBrave'));
});

test('the engine knows who gave away a match\'s last point: always the losing side', () => {
  const { world } = fresh(405);
  let seen = 0;
  for (const f of world.fixtures.slice(0, 20)) {
    const home = world.clubs[f.home];
    const away = world.clubs[f.away];
    if (home === undefined || away === undefined) continue;
    const r = simulateMatch(world.players, detailedMatchSetup(world, f, false, () => f.id * 7 + 1));
    if (r.lastPoint === undefined) continue;
    seen++;
    const loser = r.homeSets > r.awaySets ? 1 : 0;
    assert.equal(r.lastPoint.team, loser);
    const squad = loser === 0 ? home.players : away.players;
    assert.ok(squad.includes(r.lastPoint.player));
  }
  assert.ok(seen > 0, 'some matches end on an error');
});
