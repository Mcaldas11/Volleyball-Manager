import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator } from './engine.ts';
import { matchRating } from './playerRating.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';

const world = generateWorld({ seed: 11, startYear: 2026, scale: 'small', manager: stubManager() });
const clubs = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);

test("the MVP is the winning side's best rating — not always its top scorer", () => {
  let notTopScorer = 0;
  let n = 0;
  for (let i = 0; i < 24; i++) {
    const a = clubs[i % clubs.length];
    const b = clubs[(i + 1) % clubs.length];
    const sim = new MatchSimulator(world.players, {
      home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b),
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: false, seed: 100 + i,
    });
    const r = sim.run();
    const homeWon = r.homeSets > r.awaySets;
    const stats = homeWon ? r.stats.home : r.stats.away;
    const [won, lost] = homeWon ? [r.homeSets, r.awaySets] : [r.awaySets, r.homeSets];
    let bestRating = -1;
    let topScorer = -1;
    let topPoints = -1;
    for (const s of stats.players.values()) {
      const pts = s.attackKills + s.serveAces + s.blockPoints;
      if (pts > topPoints) { topPoints = pts; topScorer = s.playerIdx; }
      if (s.ralliesPlayed > 0) bestRating = Math.max(bestRating, matchRating(s, sim.roleOf(s.playerIdx) as Position, won, lost));
    }
    const mvp = stats.players.get(r.mvp);
    assert.ok(mvp !== undefined, 'the MVP played for the winners');
    assert.equal(matchRating(mvp, sim.roleOf(r.mvp) as Position, won, lost), bestRating, 'the MVP has the best rating');
    n++;
    if (r.mvp !== topScorer) notTopScorer++;
  }
  assert.ok(notTopScorer >= 4, `not the top scorer in ${notTopScorer} of ${n}`);
});
