import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch, type MatchSetup } from '../match/engine.ts';
import { MONSTER_SPIKE_KMH, pressureOf, rateRally } from '../match/highlights.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { advanceDay, newSeasonContext, startSeason, toTeamSetup } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { describeHighlight } from './monthAwards.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function world(seed: number): World {
  return generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
}

function setup(w: World, seed: number, highlights: boolean): MatchSetup {
  const [a, b] = w.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  return {
    home: toTeamSetup(w.players, a), away: toTeamSetup(w.players, b), format: MatchFormat.BestOf5,
    importance: 0.5, neutralVenue: false, collectLog: false, highlights, seed,
  };
}

test('keeping the highlights changes nothing about how a recorded match goes', () => {
  const w = world(61);
  for (const seed of [1, 2, 3, 4]) {
    // Against a match whose rallies are written down too: the ball speeds and
    // the highlights' tie-breaks roll their own dice, not the match's.
    const logged = simulateMatch(w.players, { ...setup(w, seed, false), collectLog: true });
    const kept = simulateMatch(w.players, { ...setup(w, seed, true), collectLog: true });
    assert.deepEqual(kept.setScores, logged.setScores);
    assert.equal(logged.highlights, undefined);
    assert.ok(kept.highlights !== undefined && kept.highlights.length >= 1);
  }
});

test("a match's best point is a spike, a block or an ace, kept whole to be shown again", () => {
  const w = world(62);
  for (const seed of [5, 6, 7]) {
    const result = simulateMatch(w.players, setup(w, seed, true));
    const point = result.highlights!.find((h) => h.kind === 'point')!;
    assert.ok(['spike', 'block', 'ace'].includes(point.what));
    const last = point.contacts[point.contacts.length - 1];
    const ends = { spike: 'kill', block: 'blocked', ace: 'ace' } as Record<string, string>;
    assert.equal(last.kind, ends[point.what]);
    // Whose it was, on the side that won it, standing on the court as it was.
    assert.equal(point.starTeam, point.winner);
    const onCourt = [...point.homeCourt, ...point.awayCourt, point.homeLibero, point.awayLibero];
    assert.ok(onCourt.includes(point.star), 'the star was on court');
    assert.equal(point.homeCourt.length, 6);
    assert.ok(point.roles.length >= 12);
    if (point.what === 'spike') assert.ok(point.speed !== undefined && point.speed > 60 && point.speed < 140);
    if (point.what === 'block') assert.equal(last.by, point.star);
    const play = result.highlights!.find((h) => h.kind === 'play');
    if (play !== undefined) assert.ok(play.attacks >= 3, 'a play is a rally with some attacks in it');
  }
});

test('spikes and serves leave the hand at believable speeds, the best hitters hardest', () => {
  const w = world(63);
  const result = simulateMatch(w.players, { ...setup(w, 8, false), collectLog: true });
  const spikes = result.log!.flatMap((r) => r.contacts).filter((c) => c.kind === 'kill').map((c) => c.speed!);
  const jumps = result.log!.flatMap((r) => r.contacts).filter((c) => c.kind === 'serve' && c.detail === 'jump').map((c) => c.speed!);
  const floats = result.log!.flatMap((r) => r.contacts).filter((c) => c.kind === 'serve' && c.detail === 'float').map((c) => c.speed!);
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(spikes.length > 20);
  assert.ok(mean(spikes) > 90 && mean(spikes) < 120, `spikes average ${mean(spikes).toFixed(0)} km/h`);
  assert.ok(Math.max(...spikes) <= 134);
  assert.ok(spikes.some((s) => s >= MONSTER_SPIKE_KMH - 6), 'now and then one is a monster');
  if (jumps.length > 0 && floats.length > 0) assert.ok(mean(jumps) > mean(floats) + 20, 'a jump serve is driven, a float pushed');
});

test('a set point counts for more than a point early in the set', () => {
  assert.ok(pressureOf([24, 23], [2, 1], 25, 3) > pressureOf([24, 23], [0, 0], 25, 3), 'match point over set point');
  assert.ok(pressureOf([24, 23], [0, 0], 25, 3) > pressureOf([10, 8], [0, 0], 25, 3));
  const kill = rateRally([{ kind: 'serve', team: 0, player: 1 }, { kind: 'kill', team: 1, player: 2, speed: 124 }], 0, 0);
  const soft = rateRally([{ kind: 'serve', team: 0, player: 1 }, { kind: 'kill', team: 1, player: 2, speed: 96 }], 0, 0);
  assert.ok(kill.point!.score > soft.point!.score, 'a harder spike is a better point');
  assert.equal(rateRally([{ kind: 'serve', team: 0, player: 1 }, { kind: 'attackError', team: 1, player: 2 }], 1, 0).point, null);
});

test('the month in the manager league ends with its Point, Play and Player of the Month in his inbox', () => {
  const w = world(64);
  const ctx = newSeasonContext();
  startSeason(w, ctx);
  appointManager(w, w.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  while (w.day < 160) advanceDay(w, ctx, { detailedClubs: new Set([w.userClubId]) });
  const awards = w.messages.filter((m) => m.award !== undefined);
  for (const kind of ['point', 'play', 'player'] as const) {
    assert.ok(awards.some((m) => m.award!.kind === kind), `a ${kind} of the month`);
  }
  const league = w.clubs[w.userClubId].leagueId;
  for (const m of awards) {
    assert.equal(m.category, 'awards');
    assert.equal(m.award!.competitionId, league);
    for (const h of m.award!.highlights ?? []) {
      // Every one on the shortlist is a match from the manager's league, ready to replay.
      assert.equal(w.fixtures[h.fixtureId!].competitionId, league);
      assert.ok(h.contacts.length > 0 && h.home !== undefined && h.away !== undefined);
      assert.ok(describeHighlight(w, h).length > 10);
    }
    assert.ok((m.award!.highlights?.length ?? m.award!.players?.length ?? 0) <= 3);
  }
});

test('about one player in ten is left-handed, and nearly a third of opposites', () => {
  const w = world(65);
  const store = w.players;
  let all = 0;
  let lefties = 0;
  let opposites = 0;
  let leftOpposites = 0;
  for (let p = 0; p < store.count; p++) {
    const left = store.hasFlag(p, PlayerFlag.LeftHanded);
    all++;
    if (left) lefties++;
    if (store.position[p] === Position.Opposite) {
      opposites++;
      if (left) leftOpposites++;
    }
  }
  assert.ok(lefties / all > 0.08 && lefties / all < 0.2, `${((lefties / all) * 100).toFixed(1)}% left-handed`);
  assert.ok(leftOpposites / opposites > 0.22 && leftOpposites / opposites < 0.38, `${((leftOpposites / opposites) * 100).toFixed(1)}% of opposites`);
});
