import { MatchFormat, MatchSimulator } from '../src/engine/match/engine.ts';
import { toTeamSetup } from '../src/engine/season/seasonEngine.ts';
import { generateWorld } from '../src/engine/world/worldGen.ts';
import { stubManager } from '../src/engine/world/world.ts';
const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager() });
const sim = new MatchSimulator(world.players, {
  home: toTeamSetup(world.players, world.clubs[0]), away: toTeamSetup(world.players, world.clubs[1]),
  format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed: 999,
});
let n = 0;
const orig = (sim as any).resolveOffense.bind(sim);
let calls = 0;
(sim as any).resolveOffense = (...args: unknown[]) => {
  calls++;
  if (calls % 100000 === 0) console.log('resolveOffense calls', calls, 'rally', n, JSON.stringify((sim as any).contacts.slice(-6)));
  if (calls > 300000) process.exit(1);
  return orig(...args);
};
while (sim.step() !== null) n++;
console.log('done', n);
