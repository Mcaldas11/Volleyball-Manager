import { MatchFormat, MatchSimulator } from '../src/engine/match/engine.ts';
import { toTeamSetup } from '../src/engine/season/seasonEngine.ts';
import { generateWorld } from '../src/engine/world/worldGen.ts';
import { stubManager } from '../src/engine/world/world.ts';
for (const ac of [false, true]) for (const seed of [1, 2, 3, 4, 5]) {
  const world = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
  const setup = {
    home: toTeamSetup(world.players, world.clubs[0]), away: toTeamSetup(world.players, world.clubs[1]),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed,
  };
  const t = Date.now();
  const sim = new MatchSimulator(world.players, { ...setup, autoCoach: [ac, ac] });
  let n = 0;
  while (sim.step() !== null) { n++; if (Date.now() - t > 5000) { console.log('STUCK', ac, seed, n, JSON.stringify(sim.snapshot())); process.exit(1); } }
  console.log(ac, seed, n, Date.now() - t);
}
