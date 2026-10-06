import { MatchFormat, MatchSimulator } from '../src/engine/match/engine.ts';
import { toTeamSetup } from '../src/engine/season/seasonEngine.ts';
import { generateWorld } from '../src/engine/world/worldGen.ts';
import { stubManager } from '../src/engine/world/world.ts';
const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
const clubs = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
const count: Record<string, Record<string, number>> = {};
let recycles = 0; let matches = 0; let attacks = 0;
for (let m = 0; m < 10; m++) {
  const r = new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, clubs[m % clubs.length]), away: toTeamSetup(world.players, clubs[(m + 1) % clubs.length]),
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: false, collectLog: true, seed: 100 + m,
  }).run();
  matches++;
  for (const e of r.log!) for (const c of e.contacts) {
    if (c.shot === undefined) continue;
    if (c.kind === 'dig') continue;
    attacks++;
    if (c.shot === 'recycle') recycles++;
    (count[c.kind] ??= {})[c.shot] = ((count[c.kind] ??= {})[c.shot] ?? 0) + 1;
  }
}
console.log('per match: attacks', (attacks / matches).toFixed(0), 'recycles', (recycles / matches).toFixed(1));
for (const [k, v] of Object.entries(count)) console.log(k, JSON.stringify(v));
