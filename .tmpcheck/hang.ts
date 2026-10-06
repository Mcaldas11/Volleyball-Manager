import { MatchFormat, MatchSimulator } from '../src/engine/match/engine.ts';
import { toTeamSetup } from '../src/engine/season/seasonEngine.ts';
import { generateWorld } from '../src/engine/world/worldGen.ts';
import { stubManager } from '../src/engine/world/world.ts';
const world = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
for (const seed of [1, 2, 3, 4, 5]) {
  const sim = new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, world.clubs[0]), away: toTeamSetup(world.players, world.clubs[1]),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed, autoCoach: [true, true],
  });
  let n = 0;
  const t0 = Date.now();
  while (sim.step() !== null) {
    n++;
    if (Date.now() - t0 > 4000) { console.log('seed', seed, 'stuck after', n, 'rallies', JSON.stringify(sim.snapshot())); break; }
  }
  console.log('seed', seed, 'rallies', n, Date.now() - t0, 'ms');
}
for (const seed of [1, 2, 3, 4, 5]) {
  const w = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
  const t0 = Date.now();
  const r = new MatchSimulator(w.players, {
    home: toTeamSetup(w.players, w.clubs[0]), away: toTeamSetup(w.players, w.clubs[1]),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed, autoCoach: [false, false],
  }).run();
  console.log('run seed', seed, r.setScores.length, Date.now() - t0, 'ms');
}
