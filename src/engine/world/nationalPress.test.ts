import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from '../season/seasonEngine.ts';
import { MatchFormat, simulateMatch } from '../match/engine.ts';
import { defaultTactics } from '../match/tactics.ts';
import { appointManager, resign } from './career.ts';
import { applyPlan, suggestPlan, undoPlan } from './gamePlan.ts';
import { messageNeedsAction } from './inbox.ts';
import {
  appointNationalCoach, applyIntlResult, internationals, leaveNationalJob, matchImportance, nameSquad, nationSetup, squadOf,
  suggestSquad, type IntlMatch, type Tournament,
} from './internationals.ts';
import {
  answerInterviewQuestion, conferenceMatch, generateNationalPostMatchInterview, nationalFixtureId, type InterviewSession,
} from './interviews.ts';
import { NATIONS } from './nations.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function start(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1).sort((a, b) => b.reputation - a.reputation)[0];
  appointManager(world, club.id);
  return { world, ctx };
}

function runTo(world: World, ctx: SeasonContext, day: number): void {
  while (world.day < day) advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
}

/** Club and country, the national team's first EuroVolley match ahead. */
function clubAndCountry(seed: number): { world: World; ctx: SeasonContext; euro: Tournament; nation: number; first: IntlMatch } {
  const { world, ctx } = start(seed);
  const euro = internationals(world).tournaments.find((t) => t.kind === 'continental' && t.confederation === 'CEV')!;
  const nation = euro.teams[2];
  appointNationalCoach(world, nation);
  runTo(world, ctx, euro.callUpDay);
  assert.equal(nameSquad(world, suggestSquad(world, nation)), null);
  const first = euro.matches.filter((m) => m.home === nation || m.away === nation).sort((a, b) => a.day - b.day)[0];
  return { world, ctx, euro, nation, first };
}

const nationalSession = (world: World, m: IntlMatch, kind: 'pre' | 'post'): InterviewSession | undefined =>
  world.pendingInterviews.find((s) => s.kind === kind && s.national?.matchId === m.id);

/** Words that belong to a club's press room, not a nation's. */
const CLUB_TALK = /\bleague\b|\bboard\b|\bseason\b|\bthe club\b|derby|\btable\b/i;
const textsOf = (s: InterviewSession): string[] => s.questions.flatMap((q) => [q.prompt, ...q.options.map((o) => o.text)]);

function play(world: World, t: Tournament, m: IntlMatch, seed: number): void {
  const result = simulateMatch(world.players, {
    home: nationSetup(world, t, m.home), away: nationSetup(world, t, m.away),
    format: MatchFormat.BestOf5, importance: matchImportance(m), neutralVenue: m.home !== t.host, collectLog: false, seed,
  });
  applyIntlResult(world, t, m, result);
}

test("a national team's match: the scouts on the other nation, the press the day before, and after it", () => {
  const { world, ctx, euro, nation, first } = clubAndCountry(50);
  const opp = first.home === nation ? first.away : first.home;
  const key = nationalFixtureId(first);

  // Two days out: the scouts' report on the other nation, with their plan.
  runTo(world, ctx, first.day - 1);
  const report = world.messages.find((m) => m.subject.startsWith(`Scouting report: ${NATIONS[opp].name}`));
  assert.ok(report !== undefined, 'the scouts report on the opponent');
  assert.equal(report.fixtureId, key);
  assert.equal(report.gamePlanFor, opp);
  assert.equal(report.aboutNation, opp);
  assert.equal(report.tables?.[0].rows.length, 5);
  assert.match(report.body, /world ranking/);
  assert.equal(world.messages.filter((m) => m.fixtureId === key && m.subject.startsWith('Scouting report')).length, 1, 'once');

  // The day before: the press conference, waiting for an answer.
  runTo(world, ctx, first.day);
  const pre = nationalSession(world, first, 'pre');
  assert.ok(pre !== undefined, 'a press conference before the match');
  assert.equal(pre.fixtureId, key);
  assert.ok(pre.questions.length >= 3);
  const msg = world.messages.find((m) => m.interviewId === pre.id);
  assert.ok(msg !== undefined && messageNeedsAction(world, msg), 'the inbox asks for it');
  const cm = conferenceMatch(world, pre);
  assert.equal(cm?.oppNation, opp);
  assert.equal(cm?.oppClub, -1);
  assert.equal(cm?.played, false);

  // Answering moves the national squad's morale — not the club's players left at home.
  const store = world.players;
  const squad = squadOf(euro, nation);
  const club = world.clubs[world.userClubId];
  const atHome = club.players.find((p) => !squad.includes(p))!;
  // The answer this journalist wants: it lands, and lifts the squad.
  const q = pre.questions[0];
  const option = q.options.findIndex((o) => o.category === q.journalist.bias && o.ownMorale >= 0);
  const inSquad = squad.find((p) => store.morale[p] > 10 && store.morale[p] < 90)!;
  const before = [store.morale[inSquad], store.morale[atHome]];
  assert.ok(answerInterviewQuestion(world, pre.id, option) !== null);
  assert.notEqual(store.morale[inSquad], before[0], 'his squad heard it');
  assert.equal(store.morale[atHome], before[1], 'the club players at home did not');

  // The match, then the press want his reaction; the one before it lapses.
  play(world, euro, first, 3);
  const post = generateNationalPostMatchInterview(world, euro, first);
  assert.ok(post !== null);
  assert.equal(post.kind, 'post');
  assert.equal(post.expiresDay, world.day + 2);
  assert.equal(generateNationalPostMatchInterview(world, euro, first), post, 'the same one if asked again');
  assert.ok(world.messages.some((m) => m.interviewId === post.id && m.subject.includes('press conference')));
  assert.equal(conferenceMatch(world, post)?.played, true);
  runTo(world, ctx, world.day + 1);
  assert.equal(nationalSession(world, first, 'pre'), undefined, 'the conference before the match has gone');
  assert.ok(nationalSession(world, first, 'post') !== undefined, 'the one after it still waits');
});

test("a nation's press talk of the tournament and the country — never a league, a board or a season", () => {
  const { world, ctx, euro, nation } = clubAndCountry(51);
  const asked: string[] = [];
  // Every match of the tournament: the conference before it, the match, the one after.
  for (let guard = 0; guard < 60; guard++) {
    const next = euro.matches.filter((m) => !m.played && (m.home === nation || m.away === nation)).sort((a, b) => a.day - b.day)[0];
    if (next === undefined || euro.status === 'done') break;
    runTo(world, ctx, next.day);
    if (next.played) continue;
    const pre = nationalSession(world, next, 'pre');
    if (pre !== undefined) asked.push(...textsOf(pre));
    play(world, euro, next, guard + 11);
    const post = generateNationalPostMatchInterview(world, euro, next);
    if (post !== null) asked.push(...textsOf(post));
  }
  assert.ok(asked.length > 40, `${asked.length} lines heard`);
  const wrong = asked.filter((t) => CLUB_TALK.test(t));
  assert.deepEqual(wrong, []);
});

test("the scouts' plan for a nation: from its fourteen and its instructions, into the national team's — and back", () => {
  const { world, euro, nation, first } = clubAndCountry(52);
  const opp = first.home === nation ? first.away : first.home;
  const team = world.nationalTeams.find((t) => t.nation === nation)!;
  team.tactics ??= defaultTactics();
  const own = { id: -1 - nation, players: squadOf(euro, nation), preferredLineup: [], tactics: team.tactics };
  const them = { id: -1 - opp, players: squadOf(euro, opp), preferredLineup: [], tactics: defaultTactics() };
  const plan = suggestPlan(world, own, them);
  assert.equal(plan.opponentId, -1 - opp);
  // Where to serve needs two passers to tell apart; how hard, how to block and how to defend are always there.
  assert.ok(['serve', 'block', 'shape'].every((w) => plan.parts.some((p) => p.what === w)));
  const before = JSON.stringify(team.tactics);
  applyPlan(world, own, plan, nationalFixtureId(first));
  assert.equal(world.planUndo?.clubId, -1 - nation);
  assert.ok(undoPlan(world, own));
  assert.equal(JSON.stringify(team.tactics), before);
});

test('leaving one job keeps the other\'s press: the club\'s go with the club, the nation\'s with the nation', () => {
  const { world, ctx, nation, first } = clubAndCountry(53);
  runTo(world, ctx, first.day);
  assert.ok(nationalSession(world, first, 'pre') !== undefined);
  // A club conference waiting too.
  world.pendingInterviews.push({ ...nationalSession(world, first, 'pre')!, id: 999, fixtureId: 0, national: undefined });
  assert.ok(resign(world));
  assert.ok(nationalSession(world, first, 'pre') !== undefined, 'the national team still has its press');
  assert.equal(world.pendingInterviews.some((s) => s.id === 999), false, "the club's went with the club");
  leaveNationalJob(world, false);
  assert.equal(world.pendingInterviews.length, 0, "and the nation's with the nation");
  assert.equal(world.career.nationalTeam, undefined);
  assert.ok(nation >= 0);
});
