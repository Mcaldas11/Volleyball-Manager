import { MatchFormat, MatchSimulator } from '../src/engine/match/engine.ts';
import { toTeamSetup } from '../src/engine/season/seasonEngine.ts';
import { generateWorld } from '../src/engine/world/worldGen.ts';
import { stubManager } from '../src/engine/world/world.ts';
let t = Date.now();
const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager() });
console.log('world', Date.now() - t); t = Date.now();
const r = new MatchSimulator(world.players, {
  home: toTeamSetup(world.players, world.clubs[0]), away: toTeamSetup(world.players, world.clubs[1]),
  format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed: 999,
}).run();
console.log('run', Date.now() - t, r.setScores);
