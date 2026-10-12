import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { challengeChecksFor, MatchFormat, MatchSimulator, type Shot } from './engine.ts';
import { ballMark, isIn, landingFor } from './landing.ts';

test('a shot comes down over its own stretch of the court — the whole court between them — and one hit out lands clearly out', () => {
  const rng = new Rng(5);
  const rnd = (): number => rng.float();
  const inShots: Shot[] = ['line', 'shortLine', 'cross', 'cut', 'tip', 'roll', 'seam', 'deep', 'quick'];
  // A grid of nine boxes over the court: every one gets balls.
  const boxes = new Set<string>();
  for (const shot of inShots) {
    for (let i = 0; i < 400; i++) {
      const l = landingFor(shot, i % 2 === 0 ? 0.9 : 0.1, rnd)!;
      assert.ok(isIn(l), `${shot} stays in`);
      assert.ok(ballMark(l).gap < -0.1, `${shot} lands clear of the lines unless the call is close`);
      boxes.add(`${Math.min(2, Math.floor(l.across * 3))}:${Math.min(2, Math.floor(l.deep * 3))}`);
    }
  }
  assert.equal(boxes.size, 9, 'the hitters reach every part of the court');
  for (const shot of ['long', 'wide', 'blockout'] as Shot[]) {
    for (let i = 0; i < 300; i++) {
      const l = landingFor(shot, 0.9, rnd)!;
      assert.ok(ballMark(l).gap > 0.14, `${shot} is out by more than a whisker`);
    }
  }
  assert.equal(landingFor('net', 0.9, rnd), undefined);
});

test('the video measures where the ball really came down: its verdict on the line always matches the mark it shows', () => {
  const world = generateWorld({ seed: 41, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  let lineCalls = 0;
  let turned = 0;
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) {
    const m = new MatchSimulator(world.players, {
      home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b),
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed,
    });
    for (let i = 0; i < 400 && !m.snapshot().matchOver; i++) {
      const entry = m.step();
      const call = m.lastCall();
      if (entry === null || call === null) continue;
      const end = entry.contacts[entry.contacts.length - 1];
      // Every kill and every attack hit out comes down somewhere, in when given in, out when given out — unless the call is wrong.
      if ((end.kind === 'kill' && end.shot !== 'blockout') || (end.kind === 'attackError' && end.shot !== 'net')) {
        assert.ok(end.land !== undefined, 'the attack came down somewhere');
        if (call.doubt !== 'inOut') assert.equal(isIn(end.land!), end.kind === 'kill', 'a clear call is right');
      }
      const loser = (1 - call.winner) as 0 | 1;
      if (call.doubt !== 'inOut' || m.challengeError(loser) !== null || !challengeChecksFor(call.call, call.blockout).includes('inOut')) continue;
      lineCalls++;
      // On the line: a few centimetres either side of it, as the court showed.
      assert.ok(Math.abs(ballMark(end.land!).gap) < 0.05);
      const calledIn = call.call !== 'attackError';
      const result = m.challenge(loser, 'inOut');
      assert.ok(result.mark !== undefined);
      const markIn = result.mark!.gap <= 0;
      // Turned over exactly when the mark says the referee got it wrong.
      assert.equal(result.overturned, markIn !== calledIn, `${result.verdict}`);
      if (result.overturned === true) turned++;
    }
  }
  assert.ok(lineCalls > 5 && turned > 0, `${lineCalls} line calls, ${turned} turned over`);
});
