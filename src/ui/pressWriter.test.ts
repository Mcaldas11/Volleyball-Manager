import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/world/worldGen.ts';
import { addFixture, stubManager, type World } from '../engine/world/world.ts';
import { MatchFormat } from '../engine/match/engine.ts';
import { answerInterviewQuestion, generateInterviewSessions, type InterviewSession } from '../engine/world/interviews.ts';
import { unwritten, writeQuestions, type PressAiSettings } from './pressWriter.ts';

const SETTINGS: PressAiSettings = { on: true, key: 'sk-ant-test-0123456789abcdefghij', model: 'claude-haiku-5-5' };

function conference(): { world: World; session: InterviewSession } {
  const world = generateWorld({ seed: 31, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  const opp = world.clubs.find((c) => c.leagueId === club.leagueId && c.id !== club.id)!;
  addFixture(world, {
    id: world.fixtures.length, competitionId: club.leagueId, day: world.day + 1, home: club.id, away: opp.id, round: 0,
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, played: false, homeSets: 0, awaySets: 0, setScores: [], mvp: -1,
  });
  generateInterviewSessions(world, world.day + 1);
  return { world, session: world.pendingInterviews[0] };
}

/** Stands in for the API for one call: records the request and replies as given. */
function fakeApi(reply: (body: Record<string, unknown>) => { status: number; json: unknown }): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = reply(JSON.parse(init.body as string) as Record<string, unknown>);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json } as Response;
  }) as typeof fetch;
  return { calls };
}

const written = (n: number) => ({
  content: [{
    type: 'tool_use',
    input: {
      questions: Array.from({ length: n }, (_, i) => ({
        prompt: `AI question ${i + 1}?`,
        answers: ['p1', 'p2', 'n1', 'n2', 'c1', 'c2'].map((a) => `${a} for ${i + 1}`),
        reactions: { positive: `warm ${i + 1}`, neutral: `cool ${i + 1}`, convince: `wow ${i + 1}` },
      })),
    },
  }],
});

test('with a key, the model writes the words — and only the words: who asks, the tones and what they do stay the game\'s', async () => {
  const { world, session } = conference();
  const before = session.questions.map((q) => ({ who: q.journalist.name, tones: q.options.map((o) => [o.category, o.ownMorale, o.opponentMorale]) }));
  const api = fakeApi((body) => {
    assert.equal(body.model, 'claude-haiku-5-5');
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'press_conference' });
    const text = (body.messages as Array<{ content: string }>)[0].content;
    assert.match(text, /Facts the press have/);
    assert.match(text, new RegExp(session.questions[0].journalist.name));
    return { status: 200, json: written(session.questions.length) };
  });
  const n = await writeQuestions(world, session, unwritten(session), SETTINGS);
  assert.equal(n, session.questions.length);
  const headers = api.calls[0].init.headers as Record<string, string>;
  assert.equal(api.calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers['x-api-key'], SETTINGS.key);
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(session.ai, true);
  session.questions.forEach((q, i) => {
    assert.equal(q.prompt, `AI question ${i + 1}?`);
    assert.equal(q.options[4].text, `c1 for ${i + 1}`);
    assert.equal(q.journalist.name, before[i].who);
    assert.deepEqual(q.options.map((o) => [o.category, o.ownMorale, o.opponentMorale]), before[i].tones);
  });
  assert.deepEqual(unwritten(session), [], 'nothing left to write');
  // The journalist reacts as the model wrote it.
  answerInterviewQuestion(world, session.id, 4);
  assert.equal(session.questions[0].reaction, 'wow 1');
});

test('a refused key, or a reply that is not what was asked for, leaves the game\'s own questions', async () => {
  const { world, session } = conference();
  const own = session.questions.map((q) => q.prompt);
  fakeApi(() => ({ status: 401, json: { error: { message: 'invalid x-api-key' } } }));
  await assert.rejects(writeQuestions(world, session, unwritten(session), SETTINGS), /refused/);
  assert.deepEqual(session.questions.map((q) => q.prompt), own);

  fakeApi(() => ({
    status: 200,
    json: { content: [{ type: 'tool_use', input: { questions: [{ prompt: 'Too few answers?', answers: ['a', 'b'], reactions: {} }] } }] },
  }));
  const n = await writeQuestions(world, session, unwritten(session), SETTINGS);
  assert.equal(n, 0);
  assert.equal(session.questions[0].prompt, own[0]);
  assert.notEqual(session.ai, true);
});
