/**
 * Long-run world validation.
 *
 * A manager game lives or dies on whether the world still makes sense decades
 * in. This simulates a full career's worth of seasons and reports the world's
 * vital signs each time, so drift is visible: if the average age creeps up, or
 * potential inflates, or every club goes bankrupt, it shows here rather than
 * in a user's save forty hours into a career.
 */

import { PlayerFlag } from '../engine/model/players.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason } from '../engine/season/seasonEngine.ts';
import { endSeason } from '../engine/season/rollover.ts';
import { generateWorld, type WorldScale } from '../engine/world/worldGen.ts';
import { stubManager, type World } from '../engine/world/world.ts';

export interface SeasonSnapshot {
  season: number;
  year: number;
  activePlayers: number;
  totalPlayers: number;
  avgAge: number;
  avgCA: number;
  topCA: number;
  avgPA: number;
  retired: number;
  youthIntake: number;
  transfers: number;
  bankruptcies: number;
  hallOfFame: number;
  clubsSolvent: number;
  champion: string;
  elapsedSec: number;
}

export function runCareer(seasons: number, scale: WorldScale, seed = 20260728): {
  snapshots: SeasonSnapshot[];
  world: World;
  totalSec: number;
} {
  const world = generateWorld({ seed, startYear: 2026, scale, manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world);

  const snapshots: SeasonSnapshot[] = [];
  const t0 = process.hrtime.bigint();

  for (let s = 0; s < seasons; s++) {
    const seasonStart = process.hrtime.bigint();
    simulateRestOfSeason(world, ctx);
    const report = endSeason(world, ctx);
    const elapsed = Number(process.hrtime.bigint() - seasonStart) / 1e9;

    const store = world.players;
    let active = 0;
    let ageSum = 0;
    let caSum = 0;
    let paSum = 0;
    let topCA = 0;
    for (let i = 0; i < store.count; i++) {
      if (!store.isActive(i)) continue;
      if (store.hasFlag(i, PlayerFlag.Youth)) continue;
      active++;
      ageSum += store.ageOn(i, world.year, 181);
      caSum += store.currentAbility[i];
      paSum += store.potentialAbility[i];
      if (store.currentAbility[i] > topCA) topCA = store.currentAbility[i];
    }

    const solvent = world.clubs.filter((c) => c.finances.balance >= 0).length;

    snapshots.push({
      season: report.season,
      year: report.year,
      activePlayers: active,
      totalPlayers: store.count,
      avgAge: ageSum / Math.max(1, active),
      avgCA: caSum / Math.max(1, active),
      topCA,
      avgPA: paSum / Math.max(1, active),
      retired: report.retired,
      youthIntake: report.youthIntake,
      transfers: report.transfers,
      bankruptcies: report.bankruptcies.length,
      hallOfFame: world.hallOfFame.length,
      clubsSolvent: solvent,
      champion: report.champions[0]?.winner ?? '—',
      elapsedSec: elapsed,
    });
  }

  return {
    snapshots,
    world,
    totalSec: Number(process.hrtime.bigint() - t0) / 1e9,
  };
}
