import { generateWorld } from './engine/world/worldGen.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason } from './engine/season/seasonEngine.ts';
import { endSeason } from './engine/season/rollover.ts';
import { stubManager } from './engine/world/world.ts';
import { ageAtSeasonEnd } from './engine/world/retirement.ts';
import { POSITION_SHORT, type Position } from './engine/model/positions.ts';
const mode = process.argv[2];
if (mode === 'gen') {
  const tally: Record<number, number> = {};
  for (let seed = 1; seed <= 40; seed++) {
    const w = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
    let max = 0;
    for (let i = 0; i < w.players.count; i++) if (w.players.isActive(i)) max = Math.max(max, w.players.ageOn(i, w.year, 181));
    tally[max] = (tally[max] ?? 0) + 1;
  }
  console.log('oldest at start, over 40 worlds:', JSON.stringify(tally));
} else {
  const world = generateWorld({ seed: 20260728, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext(); startSeason(world, ctx);
  const store = world.players;
  for (let s = 0; s < Number(mode ?? 20); s++) {
    simulateRestOfSeason(world, ctx);
    let oldest = -1; let n40 = 0; let n44 = 0; let n46 = 0;
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i) || store.clubId[i] < 0) continue;
      const a = ageAtSeasonEnd(world, i);
      if (a >= 40) n40++; if (a >= 44) n44++; if (a >= 46) n46++;
      if (oldest < 0 || a > ageAtSeasonEnd(world, oldest)) oldest = i;
    }
    const o = oldest;
    console.log(`season ${s + 1}: oldest ${ageAtSeasonEnd(world, o)} (${POSITION_SHORT[store.position[o] as Position]}, CA ${store.currentAbility[o]}, tier ${world.clubs[store.clubId[o]].tier}, pref ${store.getAttr(o, 'retirementPreference')})  40+: ${n40}  44+: ${n44}  46+: ${n46}`);
    endSeason(world, ctx);
  }
}
