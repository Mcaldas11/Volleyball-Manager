import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, CHALLENGES_PER_SET, challengeChecksFor, type ChallengeCheck } from './engine.ts';
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

test('a video challenge on what looked close: a wrong call is turned over — the point, the serve and the box score — and the challenge kept', () => {
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
      assert.ok(call.doubt !== null && challengeChecksFor(call.call, call.blockout).includes(call.doubt), 'a close call has something that looked close');
      const result = m.challenge(loser, call.doubt!);
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
        // (Unless the point given back won the set: a new set starts with its own two.)
        if (now.set === after.set) assert.equal(m.challengesLeft(loser), left, 'a challenge that is upheld is kept');
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

test('the video only turns over what it is asked about: the wrong question loses the challenge, even on a call the referee got wrong', () => {
  let missed = 0;
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    // Two of the same match, side by side: one asks about what looked close, the other about something else.
    const right = sim(seed);
    const wrong = sim(seed);
    for (let i = 0; i < 400 && !right.snapshot().matchOver; i++) {
      right.step();
      wrong.step();
      const call = right.lastCall();
      if (call === null || !call.close) continue;
      const loser = (1 - call.winner) as 0 | 1;
      if (right.challengeError(loser) !== null) continue;
      const other: ChallengeCheck = challengeChecksFor(call.call, call.blockout).find((c) => c !== call.doubt) ?? 'blockTouch';
      const left = wrong.challengesLeft(loser);
      const a = right.challenge(loser, call.doubt!);
      const b = wrong.challenge(loser, other);
      assert.equal(b.overturned, false, 'asked about the wrong thing, the call stands');
      assert.equal(wrong.challengesLeft(loser), left - 1, 'and the challenge is lost');
      if (a.overturned === true) missed++;
      // The two matches part ways once one has had a point turned over.
      if (a.overturned === true) break;
    }
  }
  assert.ok(missed > 0, 'some of those calls were wrong — and only the right question turned them over');
});

test('a side can only challenge a point it lost, and has two a set', () => {
  const m = sim(9);
  const entry = m.step()!;
  const call = m.lastCall();
  if (call !== null) assert.match(m.challengeError(call.winner) ?? '', /won that point/);
  assert.equal(m.challengesLeft(entry.winner), CHALLENGES_PER_SET);
});

/** A live match: the end of each set held for the video, as the match screen plays it. */
function live(seed: number, highlights = false): MatchSimulator {
  const world = generateWorld({ seed: 41, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  const m = new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed, highlights,
  });
  m.holdSetEnds = true;
  return m;
}

test('a set\'s last point can be challenged: the set waits for the video, and a call turned over plays on', () => {
  let looked = 0;
  let kept = 0;
  for (let seed = 30; seed < 70 && kept === 0; seed++) {
    const m = live(seed);
    for (let i = 0; i < 400 && !m.snapshot().matchOver; i++) {
      const entry = m.step();
      if (entry === null || !m.setDecided()) continue;
      const before = m.snapshot();
      const call = m.lastCall();
      // Decided, but not closed: the same set, its last point on the board.
      assert.equal(before.set, entry.set);
      if (call === null || !call.close) {
        m.closeSet();
        assert.equal(m.snapshot().set > before.set || m.snapshot().matchOver, true, 'closed, the set is over');
        continue;
      }
      const loser = (1 - call.winner) as 0 | 1;
      assert.equal(m.challengeError(loser), m.challengesLeft(loser) > 0 ? null : 'No challenges left this set.');
      if (m.challengesLeft(loser) === 0) {
        m.closeSet();
        continue;
      }
      looked++;
      const result = m.challenge(loser, call.doubt!);
      if (result.overturned === true) {
        kept++;
        const now = m.snapshot();
        assert.equal(now.set, before.set, 'the set goes on');
        assert.equal(now.matchOver, false);
        const score = (t: 0 | 1, s: typeof now): number => (t === 0 ? s.homeScore : s.awayScore);
        assert.equal(score(call.winner, now), score(call.winner, before) - 1);
        assert.equal(score(loser, now), score(loser, before) + 1);
        assert.equal(m.setDecided(), false, 'nobody has won it yet');
      } else {
        // The call stands: the set is the winner's once it is closed.
        m.closeSet();
        assert.ok(m.snapshot().set > before.set || m.snapshot().matchOver);
      }
    }
  }
  assert.ok(looked > 0, 'set points were challenged');
  assert.ok(kept > 0, 'and one was turned over, and the set went on');
});

test('points turned over on video leave the box score as the log has them: kills, aces, every rotation\'s points', () => {
  let overturned = 0;
  for (const seed of [71, 72, 73, 74]) {
    const m = live(seed, true);
    while (!m.snapshot().matchOver) {
      if (m.step() === null) break;
      const call = m.lastCall();
      // Every close call challenged, on what looked close: plenty are turned over.
      if (call !== null && call.close) {
        const loser = (1 - call.winner) as 0 | 1;
        if (m.challengeError(loser) === null && m.challenge(loser, call.doubt!).overturned === true) overturned++;
      }
    }
    const r = m.buildResult();
    for (const side of [0, 1] as const) {
      const team = side === 0 ? r.stats.home : r.stats.away;
      let kills = 0;
      let aces = 0;
      let won = 0;
      for (const e of r.log!) {
        if (e.winner === side) won++;
        const end = e.contacts[e.contacts.length - 1];
        if (end === undefined || end.team !== side) continue;
        // What the point really was, after the video.
        if (e.overturned === true) {
          if (end.kind === 'attackError' && e.doubt !== 'netTouch') kills++;
        } else if (end.kind === 'kill') kills++;
        else if (end.kind === 'ace' || end.kind === 'receptionError') aces++;
      }
      // A reception error is the server's ace too — logged by the passer's side.
      for (const e of r.log!) {
        const end = e.contacts[e.contacts.length - 1];
        if (end?.kind === 'receptionError' && end.team !== side && e.serveTeam === side) aces++;
        if (end?.kind === 'receptionError' && end.team === side) aces--;
      }
      const players = [...team.players.values()];
      assert.equal(players.reduce((n, s) => n + s.attackKills, 0), kills, 'kills');
      assert.equal(players.reduce((n, s) => n + s.serveAces, 0), aces, 'aces');
      // Every point won is in exactly one rotation's book: won serving, or sided out.
      assert.equal(team.rotations.reduce((n, x) => n + x.servePointsWon + x.sideOutsWon, 0), won, 'rotations');
    }
    // The match's best point is never one the video took away.
    const best = r.highlights?.find((h) => h.kind === 'point');
    if (best !== undefined) {
      const e = r.log!.find((x) => x.contacts === best.contacts);
      assert.notEqual(e?.overturned, true, 'the best point stood');
    }
  }
  assert.ok(overturned > 3, `${overturned} turned over`);
});

test('a simulated match still ends each set on its last point, and a live one only once it is closed', () => {
  const quick = sim(80).run();
  assert.ok(quick.setScores.length >= 3);
  const m = live(80);
  m.finish();
  assert.equal(m.snapshot().matchOver, true, 'finished, the held sets are closed as play goes on');
  assert.deepEqual(m.buildResult().setScores, quick.setScores, 'the same match either way');
});
