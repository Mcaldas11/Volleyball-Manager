import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { addFixture, stubManager, type Fixture, type World } from './world.ts';
import { MatchFormat } from '../match/engine.ts';
import {
  answerInterviewQuestion, closeInterview, declineInterview,
  expireStaleInterviews, generateInterviewSessions, generatePostMatchInterview,
} from './interviews.ts';

function addTestFixture(world: World, home: number, away: number, day: number, competitionId = 0): Fixture {
  const fixture: Fixture = {
    id: world.fixtures.length,
    competitionId,
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
  assert.equal(world.messages[0].interviewId, session.id);

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
  addTestFixture(world, world.userClubId, opponentId, world.day + 1);
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
  const result = answerInterviewQuestion(world, session.id, matchIndex);

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
    const r = answerInterviewQuestion(world, session.id, 0);
    assert.notEqual(r, null);
  }
  assert.equal(session.finished, true);
  assert.match(world.messages[0].body, /fielded \d+ questions/);

  // Once finished, no further answers are accepted.
  assert.equal(answerInterviewQuestion(world, session.id, 0), null);
});

test('declineInterview removes the session with no morale effect', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  addTestFixture(world, world.userClubId, opponentId, world.day + 1);
  generateInterviewSessions(world, world.day + 1);
  const session = world.pendingInterviews[0];

  const ownPlayer = world.clubs[world.userClubId].players[0];
  const before = world.players.morale[ownPlayer];

  assert.equal(declineInterview(world, session.id), true);
  assert.equal(world.pendingInterviews.length, 0);
  assert.equal(world.players.morale[ownPlayer], before);
  assert.match(world.messages[0].body, /declined/);

  // Nothing left to decline a second time.
  assert.equal(declineInterview(world, session.id), false);
});

test('closeInterview only removes a finished session', () => {
  const world = generateWorld({ seed: 6, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const opponentId = world.clubs[1].id;
  addTestFixture(world, world.userClubId, opponentId, world.day + 1);
  generateInterviewSessions(world, world.day + 1);
  const session = world.pendingInterviews[0];

  closeInterview(world, session.id);
  assert.equal(world.pendingInterviews.length, 1, 'an unfinished session must not be closed');

  for (let i = 0; i < session.questions.length; i++) answerInterviewQuestion(world, session.id, 0);
  assert.equal(session.finished, true);

  closeInterview(world, session.id);
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

/** A manager at a top-flight club, and a club from another city in his league. */
function managed(seed: number): { world: World; opponentId: number } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  const city = (name: string): string => name.split(' ').find((w) => w.length > 3) ?? name;
  const opponent = world.clubs.find((c) => c.leagueId === club.leagueId && c.id !== club.id && city(c.name) !== city(club.name))!;
  return { world, opponentId: opponent.id };
}

test('a final fills the press room and runs long; a routine league night is a few regulars and three questions', () => {
  const { world, opponentId } = managed(7);
  const club = world.clubs[world.userClubId];
  const supercup = world.competitions.find((c) => c.kind === 'supercup')!;
  addTestFixture(world, world.userClubId, opponentId, world.day + 1, club.leagueId);
  addTestFixture(world, world.userClubId, opponentId, world.day + 2, supercup.id);

  generateInterviewSessions(world, world.day + 1);
  generateInterviewSessions(world, world.day + 2);
  const [league, final] = world.pendingInterviews;
  assert.equal(league.stakes, 'routine');
  assert.equal(league.questions.length, 3);
  assert.equal(final.stakes, 'huge');
  assert.equal(final.questions.length, 6);
  assert.ok(final.crowd > league.crowd * 2, `${final.crowd} journalists at the final, ${league.crowd} at the league match`);
  assert.match(final.occasion, /final/i);
  assert.ok(final.questions.some((q) => /final|trophy/i.test(q.prompt)), 'the final is what they ask about');
  // A bigger occasion, a bigger effect.
  const max = (s: typeof final): number => Math.max(...s.questions[0].options.map((o) => o.ownMorale));
  assert.ok(max(final) > max(league));
  assert.match(world.messages[1].body, /packed/);
});

test('after the match the press want a reaction to the result — and praise for the player of the match lifts him', () => {
  const { world, opponentId } = managed(8);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  const supercup = world.competitions.find((c) => c.kind === 'supercup')!;
  let praised = false;
  for (let k = 0; k < 6 && !praised; k++) {
    const f = addTestFixture(world, world.userClubId, opponentId, world.day, supercup.id);
    Object.assign(f, { played: true, homeSets: 3, awaySets: 0, setScores: [[25, 20], [25, 18], [25, 22]], mvp: club.players[0] });
    const session = generatePostMatchInterview(world, f)!;
    assert.equal(session.kind, 'post');
    assert.equal(generatePostMatchInterview(world, f), session, 'one conference per match');
    assert.ok(session.questions.some((q) => /won the|win|trophy/i.test(q.prompt)), 'they ask about the trophy and the win');
    const q = session.questions.findIndex((x) => x.options.some((o) => o.playerIdx === club.players[0]));
    if (q < 0) continue;
    for (let i = 0; i < q; i++) answerInterviewQuestion(world, session.id, 2);
    const before = store.morale[club.players[0]];
    const praise = session.questions[q].options.findIndex((o) => o.category === 'positive');
    answerInterviewQuestion(world, session.id, praise);
    assert.ok(store.morale[club.players[0]] > before + 2 || store.morale[club.players[0]] === 100);
    praised = true;
  }
  assert.ok(praised, 'the player of the match is asked about');
  assert.equal(world.messages.at(-1)?.subject, `Press conference: ${supercup.name} winners`);
});

test('a post-match conference waits a day or two, then the press move on', () => {
  const { world, opponentId } = managed(9);
  const f = addTestFixture(world, world.userClubId, opponentId, world.day, world.clubs[world.userClubId].leagueId);
  Object.assign(f, { played: true, homeSets: 1, awaySets: 3, setScores: [[20, 25], [25, 23], [19, 25], [22, 25]], mvp: -1 });
  const session = generatePostMatchInterview(world, f)!;
  assert.ok(session.questions.some((q) => /wrong|defeat|lost|board|turn this around|explain/i.test(q.prompt)));
  expireStaleInterviews(world);
  assert.equal(world.pendingInterviews.length, 1, 'still wanted the day after the match');
  world.day += 3;
  expireStaleInterviews(world);
  assert.equal(world.pendingInterviews.length, 0);
  assert.match(world.messages.at(-1)!.body, /moved on/);
});
