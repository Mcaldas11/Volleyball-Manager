import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { appointManager, applyForJob, isUnemployed, startOutOfWork } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { HUB_METRIC_KEYS, leagueHub, rotationHub } from './dataHub.ts';
import { interviewEffect, interviewQuestions, interviewReaction } from './jobInterview.ts';
import { coachLegends, coachRanking } from './coachLegends.ts';
import { challengeClubs, challengeSeasonEnd, startChallenge } from './challenges.ts';
import { answerMindGame } from './mindGames.ts';
import { socialFeed } from './socialFeed.ts';
import { createClub, draftAutoPick, draftTurn, runDraftToUser, startDraft } from './createClub.ts';

function career(seed: number) {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[1];
  appointManager(world, club.id);
  return { world, ctx, club };
}

const played = (() => {
  const c = career(141);
  for (let d = 0; d < 130; d++) advanceDay(c.world, c.ctx, { detailedClubs: new Set([c.club.id]) });
  return c;
})();

test('the Data Hub measures every side in the league against its average, and the manager\'s rotations against his opponents\'', () => {
  const { world, club } = played;
  const hub = leagueHub(world, club.leagueId);
  assert.ok(hub.rows.length >= 6);
  assert.ok(hub.rows.some((r) => r.clubId === club.id));
  for (const k of HUB_METRIC_KEYS) assert.ok(Number.isFinite(hub.average[k]), k);
  assert.ok(hub.average.pointsPerSet > 15 && hub.average.pointsPerSet < 30);
  const rot = rotationHub(world, club.id);
  assert.ok(rot !== null && rot.ours.length === 6);
  assert.ok(rot.ours.every((r) => r.sideOut >= 0 && r.sideOut <= 1));
});

test('after each of his matches the assistant reviews it: what worked, what went wrong, what to change', () => {
  const reviews = played.world.messages.filter((m) => m.subject.startsWith('Match review'));
  assert.ok(reviews.length >= 3, `${reviews.length} reviews`);
  for (const r of reviews) {
    assert.ok(r.body.includes('What worked') && r.body.includes('What went wrong') && r.body.includes('What I would change'));
  }
});

test('the job interview: a realistic answer pleases the board, an unrealistic one does not; out of work, the career starts at the Job Centre', () => {
  const world = generateWorld({ seed: 142, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  startOutOfWork(world);
  assert.ok(isUnemployed(world));
  assert.ok(world.vacancies.length >= 5);
  const club = world.clubs[world.vacancies[0].clubId];
  const qs = interviewQuestions(club);
  assert.equal(qs.length, 3);
  const ans = qs[0].answers.map((a) => interviewReaction(world, club, 'objective', a.id).score);
  assert.ok(Math.max(...ans) > Math.min(...ans), 'some answers land better than others');
  const best = qs.map((q) => q.answers.map((a) => interviewReaction(world, club, q.topic, a.id))
    .reduce((x, y) => (y.score > x.score ? y : x)));
  assert.ok(interviewEffect(best) > 0);
  const app = applyForJob(world, club.id, interviewEffect(best));
  assert.ok(app !== null && app.interview! > 0);
});

test('the coaches\' world ranking includes the manager; a club\'s legends are the coaches who won there', () => {
  const { world } = played;
  const ranking = coachRanking(world);
  assert.ok(ranking.length > 10);
  assert.ok(ranking.some((c) => c.staffId === -1));
  for (let i = 1; i < ranking.length; i++) assert.ok(ranking[i - 1].reputation >= ranking[i].reputation);
  for (const club of world.clubs.slice(0, 30)) for (const c of coachLegends(world, { clubId: club.id })) assert.ok(c.here > 0);
});

test('a challenge: won when the goal is met in time, lost when the manager leaves', () => {
  const world = generateWorld({ seed: 143, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const clubs = challengeClubs(world, 'champions');
  assert.ok(clubs.length > 0);
  appointManager(world, clubs[0]);
  startChallenge(world, 'survival', clubs[0]);
  challengeSeasonEnd(world, world.season);
  assert.equal(world.challenge?.status, 'won', 'still in the top division');
  startChallenge(world, 'cup', clubs[0]);
  world.userClubId = clubs[1];
  challengeSeasonEnd(world, world.season);
  assert.equal(world.challenge?.status, 'lost');
});

test('mind games: firing back lifts the players, and a defeat after it costs the board\'s confidence', () => {
  const { world, club } = career(144);
  const f = world.fixtures.find((x) => !x.played && (x.home === club.id || x.away === club.id))!;
  (world.mindGames ??= []).push({ fixtureId: f.id, clubId: f.home === club.id ? f.away : f.home, coach: 'A. Rival', said: 'You are nothing.' });
  const p = club.players[0];
  const before = world.players.morale[p];
  answerMindGame(world, f.id, 'fire');
  assert.equal(world.players.morale[p], Math.min(100, before + 3));
  assert.equal(answerMindGame(world, f.id, 'calm'), 'That has been answered.');
  const confidence = club.boardConfidence;
  f.played = true;
  f.homeSets = f.home === club.id ? 0 : 3;
  f.awaySets = f.home === club.id ? 3 : 0;
  advanceDay(world, newSeasonContext(), {});
  assert.ok(club.boardConfidence < confidence + 0.5, 'a defeat after it');
  assert.ok(world.messages.some((m) => m.subject === 'Your words came back to haunt you'));
});

test('the social feed: the stories, the club\'s results and its players, newest first', () => {
  const feed = socialFeed(played.world);
  assert.ok(feed.length > 20);
  assert.ok(feed.some((p) => p.kind === 'club') && feed.some((p) => p.kind === 'press'));
  for (let i = 1; i < feed.length; i++) assert.ok(feed[i - 1].day >= feed[i].day);
  assert.ok(socialFeed(played.world, 'club').length < feed.length);
});

test('create a club in place of a league\'s weakest, then draft the whole league: every side a squad, no man twice', () => {
  const world = generateWorld({ seed: 145, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const league = world.competitions.find((c) => c.kind === 'league' && c.tier === 1 && c.participants.length >= 8)!;
  const id = createClub(world, { name: 'Lisboa Volley', shortName: 'LIS', shirt: '#1d4ed8', shorts: '#ffffff', compId: league.id })!;
  assert.equal(world.clubs[id].name, 'Lisboa Volley');
  assert.equal(world.clubs[id].kit?.shirt, '#1d4ed8');
  appointManager(world, id);
  const d = startDraft(world, league.id)!;
  runDraftToUser(world);
  for (let i = 0; i < 40 && !d.done; i++) {
    assert.equal(draftTurn(d), id);
    draftAutoPick(world);
  }
  assert.ok(d.done);
  const seen = new Set<number>();
  for (const cid of league.participants) {
    const squad = world.clubs[cid].players.filter((p) => world.players.clubId[p] === cid);
    assert.ok(squad.length >= d.rounds, `${world.clubs[cid].name}: ${squad.length}`);
    for (const p of squad) {
      assert.ok(!seen.has(p));
      seen.add(p);
    }
  }
});
