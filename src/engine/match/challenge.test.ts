import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, CHALLENGES_PER_SET } from './engine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';

function sim(seed: number): MatchSimulator {
  const world = generateWorld({ seed: 41, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  return new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed,
  });
}

test('a video challenge: a wrong call is turned over — the point, the serve and the box score — and the challenge kept', () => {
  let overturned = 0;
  let upheld = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const m = sim(seed);
    for (let i = 0; i < 400 && !m.snapshot().matchOver; i++) {
      const before = m.snapshot();
      const entry = m.step();
      const call = m.lastCall();
      if (entry === null || call === null || !call.close) continue;
      const loser = (1 - call.winner) as 0 | 1;
      if (m.challengeError(loser) !== null) continue;
      const after = m.snapshot();
      const left = m.challengesLeft(loser);
      const result = m.challenge(loser);
      assert.equal(result.ok, true);
      const now = m.snapshot();
      if (result.overturned === true) {
        overturned++;
        // The point went the other way: one fewer for the side it was given to, one more for the side that asked.
        const scored = (t: 0 | 1, s: typeof now): number => (t === 0 ? s.homeScore : s.awayScore);
        if (now.set === before.set) {
          assert.equal(scored(call.winner, now), scored(call.winner, before));
          assert.equal(scored(loser, now), scored(loser, before) + 1);
        }
        assert.equal(entry.winner, loser, 'the log says so too');
        assert.equal(m.challengesLeft(loser), left, 'a challenge that is upheld is kept');
      } else {
        upheld++;
        assert.deepEqual([now.homeScore, now.awayScore], [after.homeScore, after.awayScore]);
        assert.equal(m.challengesLeft(loser), left - 1, 'one that is not is lost');
      }
      // A call is looked at once.
      assert.notEqual(m.challengeError(loser), null);
    }
  }
  assert.ok(overturned > 0 && upheld > 0, `${overturned} overturned, ${upheld} upheld`);
});

test('a side can only challenge a point it lost, and has two a set', () => {
  const m = sim(9);
  const entry = m.step()!;
  const call = m.lastCall();
  if (call !== null) assert.match(m.challengeError(call.winner) ?? '', /won that point/);
  assert.equal(m.challengesLeft(entry.winner), CHALLENGES_PER_SET);
});
