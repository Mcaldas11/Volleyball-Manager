import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { addFixture, stubManager, type Fixture, type World } from './world.ts';
import { MatchFormat } from '../match/engine.ts';
import {
  answerInterviewQuestion, closeInterview, declineInterview,
  expireStaleInterviews, generateInterviewSessions,
} from './interviews.ts';

function addTestFixture(world: World, home: number, away: number, day: number): Fixture {
  const fixture: Fixture = {
    id: world.fixtures.length,
    competitionId: 0,
    day,
    home,
    away,
    round: 0,
    format: MatchFormat.BestOf5,
    importance: 0.5,
    neutralVenue: false,
    played: false,
    homeSets: 0,
    awaySets: 0,
    setScores: [],
    mvp: -1,
  };
  addFixture(world, fixture);
  return fixture;
}

test('generateInterviewSessions lines up a fixture once, never twice', () => {
  const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  const fixture = addTestFixture(world, world.userClubId, opponentId, world.day + 1);

  generateInterviewSessions(world, world.day + 1);
  assert.equal(world.pendingInterviews.length, 1);
  const session = world.pendingInterviews[0];
  assert.equal(session.fixtureId, fixture.id);
  assert.equal(session.currentIndex, 0);
  assert.equal(session.finished, false);
  assert.ok(session.questions.length >= 3, 'a conference should have several questions');
  for (const q of session.questions) {
    assert.equal(q.options.length, 6, 'two options per category (positive/neutral/convince)');
    assert.equal(q.answeredIndex, null);
    assert.equal(q.bodyLanguage, 'neutral');
  }
  assert.equal(world.messages.length, 1);
  assert.equal(world.messages[0].category, 'interview');
  assert.equal(world.messages[0].fixtureId, fixture.id);

  // Calling it again for the same day must not double up.
  generateInterviewSessions(world, world.day + 1);
  assert.equal(world.pendingInterviews.length, 1, 'should not duplicate the session');
  assert.equal(world.messages.length, 1, 'should not duplicate the message');
});

test('generateInterviewSessions ignores fixtures the user club is not in', () => {
  const world = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  addTestFixture(world, world.clubs[1].id, world.clubs[2].id, world.day + 1);

  generateInterviewSessions(world, world.day + 1);

  assert.equal(world.pendingInterviews.length, 0);
  assert.equal(world.messages.length, 0);
});

test('answerInterviewQuestion nudges morale, updates body language, and advances the session', () => {
  const world = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  const fixture = addTestFixture(world, world.userClubId, opponentId, world.day + 1);
  generateInterviewSessions(world, world.day + 1);
  const session = world.pendingInterviews[0];
  const questionCount = session.questions.length;

  const ownPlayer = world.clubs[world.userClubId].players[0];
  const oppPlayer = world.clubs[opponentId].players[0];
  const ownBefore = world.players.morale[ownPlayer];
  const oppBefore = world.players.morale[oppPlayer];

  // Answer the journalist's own preferred tone, which should read as "encouraged".
  const q0 = session.questions[0];
  const matchIndex = q0.options.findIndex((o) => o.category === q0.journalist.bias);
  const option = q0.options[matchIndex];
  const result = answerInterviewQuestion(world, fixture.id, matchIndex);

  assert.notEqual(result, null);
  assert.equal(result?.bodyLanguage, 'encouraged');
  assert.equal(q0.answeredIndex, matchIndex);
  assert.equal(session.currentIndex, 1);
  assert.equal(session.finished, false);
  // Encouraged reactions add one extra point of own morale on top of the category's own value.
  assert.equal(world.players.morale[ownPlayer], Math.min(100, ownBefore + option.ownMorale + 1));
  assert.equal(world.players.morale[oppPlayer], Math.min(100, oppBefore + option.opponentMorale));

  // Work through the rest of the conference.
  for (let i = 1; i < questionCount; i++) {
    const r = answerInterviewQuestion(world, fixture.id, 0);
    assert.notEqual(r, null);
  }
  assert.equal(session.finished, true);
  assert.match(world.messages[0].body, /fielded \d+ questions/);

  // Once finished, no further answers are accepted.
  assert.equal(answerInterviewQuestion(world, fixture.id, 0), null);
});

test('declineInterview removes the session with no morale effect', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  const fixture = addTestFixture(world, world.userClubId, opponentId, world.day + 1);
  generateInterviewSessions(world, world.day + 1);

  const ownPlayer = world.clubs[world.userClubId].players[0];
  const before = world.players.morale[ownPlayer];

  assert.equal(declineInterview(world, fixture.id), true);
  assert.equal(world.pendingInterviews.length, 0);
  assert.equal(world.players.morale[ownPlayer], before);
  assert.match(world.messages[0].body, /declined/);

  // Nothing left to decline a second time.
  assert.equal(declineInterview(world, fixture.id), false);
});

test('closeInterview only removes a finished session', () => {
  const world = generateWorld({ seed: 6, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  const fixture = addTestFixture(world, world.userClubId, opponentId, world.day + 1);
  generateInterviewSessions(world, world.day + 1);
  const session = world.pendingInterviews[0];

  closeInterview(world, fixture.id);
  assert.equal(world.pendingInterviews.length, 1, 'an unfinished session must not be closed');

  for (let i = 0; i < session.questions.length; i++) answerInterviewQuestion(world, fixture.id, 0);
  assert.equal(session.finished, true);

  closeInterview(world, fixture.id);
  assert.equal(world.pendingInterviews.length, 0);
});

test('expireStaleInterviews drops an unfinished session once its fixture is played, leaves a live one', () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  const fixture = addTestFixture(world, world.userClubId, opponentId, world.day + 1);
  generateInterviewSessions(world, world.day + 1);
  assert.equal(world.pendingInterviews.length, 1);

  expireStaleInterviews(world);
  assert.equal(world.pendingInterviews.length, 1, 'a session for an unplayed fixture must survive');

  fixture.played = true;
  expireStaleInterviews(world);

  assert.equal(world.pendingInterviews.length, 0);
  assert.match(world.messages[0].body, /moment passed/);
});
