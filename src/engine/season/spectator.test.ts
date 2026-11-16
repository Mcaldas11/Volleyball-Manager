import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchSimulator, type MatchResult } from '../match/engine.ts';
import { fanComments } from '../world/fans.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager, type Fixture, type World } from '../world/world.ts';
import { advanceDay, newSeasonContext, playFixture, startSeason, type SeasonContext } from './seasonEngine.ts';
import { canWatch, commitWatched, spectatorSetup, watchableToday, watchAngle } from './spectator.ts';

/** A world with no job for the manager, on the first day with league matches of other clubs to watch. */
function matchDay(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  for (let i = 0; i < 400 && leagueMatches(world).length < 5; i++) advanceDay(world, ctx, {});
  assert.ok(leagueMatches(world).length >= 5, 'a day with matches on');
  return { world, ctx };
}

/** Today's league matches he could watch. */
function leagueMatches(world: World): Fixture[] {
  return watchableToday(world).filter((f) => world.competitions[f.competitionId].kind === 'league');
}

/** The match watched as the live screen plays it: a rally at a time, to the end. */
function watchLive(world: World, f: Fixture): MatchResult {
  const sim = new MatchSimulator(world.players, spectatorSetup(world, f));
  let rallies = 0;
  while (sim.step() !== null) rallies++;
  assert.ok(rallies > 40, 'played rally by rally');
  return sim.buildResult();
}

const tableRow = (world: World, f: Fixture, club: number) =>
  world.competitions[f.competitionId].table.find((r) => r.clubId === club);

test('a match watched from the stands is the one the season would have played', () => {
  const a = matchDay(41);
  const b = matchDay(41);
  const fa = leagueMatches(a.world)[0];
  const fb = b.world.fixtures[fa.id];
  assert.ok(canWatch(a.world, fa));

  commitWatched(a.world, a.ctx, fa, watchLive(a.world, fa));
  // The same day, the same match, played by the season engine in full.
  playFixture(b.world, b.ctx, fb, true);

  assert.equal(fa.played, true);
  assert.deepEqual([fa.homeSets, fa.awaySets, fa.setScores, fa.mvp], [fb.homeSets, fb.awaySets, fb.setScores, fb.mvp]);
  assert.ok(tableRow(a.world, fa, fa.home) !== undefined);
  assert.deepEqual(tableRow(a.world, fa, fa.home), tableRow(b.world, fb, fb.home));
  assert.ok(a.ctx.detailedResults.has(fa.id), 'its box score kept for the report');
});

// One day of matches, watched one after another.
const day = matchDay(42);

test('the papers see him there, and say why he came', () => {
  const { world, ctx } = day;
  const [jobMatch, formerMatch, shortlistMatch, nationalMatch] = leagueMatches(world);

  // Out of work: a club that might have a job for him.
  assert.equal(world.userClubId < 0, true);
  const job = commitWatched(world, ctx, jobMatch, watchLive(world, jobMatch))!;
  assert.equal(job.kind, 'coach');
  assert.match(job.headline, /Job rumours/);
  assert.match(job.body, /Out-of-work coach Alex Manager/);
  assert.ok([jobMatch.home, jobMatch.away].includes(job.clubId!));
  const comments = fanComments(world, job);
  assert.ok(comments.length > 0 && comments.every((c) => !/[{}]/.test(c.text)), 'the fans have their say');

  // His former club.
  const f = formerMatch;
  world.career.jobs.push({ clubId: f.away, startDay: 0, endDay: world.day - 30, exit: 'resigned', won: 10, lost: 8, trophies: [] });
  assert.deepEqual(watchAngle(world, f), { kind: 'former', clubId: f.away });
  const former = commitWatched(world, ctx, f, watchLive(world, f))!;
  assert.ok(former.body.includes(`for ${world.clubs[f.away].name}'s match against ${world.clubs[f.home].name} — his former club`), former.body);
  assert.equal(former.fans?.story, 'homecoming');
  assert.equal(former.clubId, f.away);
  assert.ok(fanComments(world, former).every((c) => !/[{}]/.test(c.text)));

  // Players on his shortlist: the best of them, in the headline.
  const s = shortlistMatch;
  world.shortlist = [...world.clubs[s.home].players, ...world.clubs[s.away].players];
  const spotted = commitWatched(world, ctx, s, watchLive(world, s))!;
  assert.match(spotted.headline, /spotted watching/);
  assert.match(spotted.body, /on his shortlist/);
  assert.ok(spotted.playerIdx !== undefined && world.shortlist.includes(spotted.playerIdx));
  world.shortlist = [];

  // The national coach, watching his players.
  const n = nationalMatch;
  const store = world.players;
  const squad = [...world.clubs[n.home].players, ...world.clubs[n.away].players];
  // A passport alone is no reason: the weakest player on court is nobody's international.
  const weakest = [...squad].sort((a, b) => store.currentAbility[a] - store.currentAbility[b])[0];
  world.career.nationalTeam = store.nation[weakest];
  const others = squad.filter((p) => p !== weakest && (store.nation[p] === store.nation[weakest] || store.nation2[p] === store.nation[weakest]));
  if (others.length === 0) assert.notEqual(watchAngle(world, n).kind, 'national', 'not for a passport alone');
  // One he has called up is.
  const called = squad.find((p) => store.nation[p] !== store.nation[weakest]) ?? squad[0];
  const nation = store.nation[called];
  world.career.nationalTeam = nation;
  world.internationals!.chosen = { tournamentId: -1, players: [called] };
  assert.equal(watchAngle(world, n).kind, 'national');
  const national = commitWatched(world, ctx, n, watchLive(world, n))!;
  assert.match(national.body, /national coach, Alex Manager, was at .* to watch .* of his players/);
  const p = national.playerIdx!;
  assert.ok(store.nation[p] === nation || store.nation2[p] === nation);
  world.career.nationalTeam = undefined;
  world.internationals!.chosen = null;
});

test('a watched match is not played again when the day moves on', () => {
  const { world, ctx } = day;
  const f = leagueMatches(world)[0];
  const before = tableRow(world, f, f.home)!.played;
  commitWatched(world, ctx, f, watchLive(world, f));
  const result = [f.homeSets, f.awaySets, [...f.setScores]];
  assert.equal(tableRow(world, f, f.home)!.played, before + 1);
  assert.equal(canWatch(world, f), false, 'over: nothing more to watch');
  // Watched twice (a second screen, a stale button): nothing happens.
  assert.equal(commitWatched(world, ctx, f, watchLive(world, f)), null);

  const watched = world.fixturesByDay.get(world.day)!.map((id) => world.fixtures[id]).filter((x) => x.played);
  const kept = watched.map((x) => [x.id, x.homeSets, x.awaySets, [...x.setScores]]);
  advanceDay(world, ctx, {});
  assert.deepEqual([f.homeSets, f.awaySets, f.setScores], result, 'the day kept the result watched');
  assert.deepEqual(watched.map((x) => [x.id, x.homeSets, x.awaySets, x.setScores]), kept, 'every match watched that day too');
  assert.equal(tableRow(world, f, f.home)!.played, before + 1, 'counted once in the table');
});

test('the matches worth watching come first, and his own club is never on the list', () => {
  const { world } = matchDay(47);
  const list = watchableToday(world);
  const f = list[list.length - 1];
  world.career.jobs.push({ clubId: f.home, startDay: 0, endDay: world.day - 1, exit: 'sacked', won: 1, lost: 9, trophies: [] });
  assert.equal(watchableToday(world)[0].id, f.id, 'his former club first');
  world.userClubId = f.home;
  assert.equal(watchableToday(world).some((x) => x.id === f.id), false);
});
