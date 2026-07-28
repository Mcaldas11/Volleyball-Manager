/**
 * Headless command line for the simulation.
 *
 * The engine is deliberately usable without the UI: calibration, long-run
 * world testing, and performance work all happen here, where a fifty-season
 * career can be run in seconds and its output inspected.
 */

import { runCalibration } from './calibrate.ts';
import { generateWorld, type WorldScale } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import { PlayerFlag } from '../engine/model/players.ts';
import { runCareer } from './career.ts';
import { runDemo } from './demo.ts';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function cmdCalibrate(args: string[]): void {
  const matches = Number(args[0] ?? 400);
  console.log(`\n${BOLD}Engine calibration${RESET} ${DIM}(${matches} matches)${RESET}\n`);

  const report = runCalibration(matches);

  let pass = 0;
  let fail = 0;
  for (const t of report.targets) {
    const ok = t.actual >= t.min && t.actual <= t.max;
    if (ok) pass++;
    else fail++;
    const mark = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    const range = `${DIM}[${t.format(t.min)} - ${t.format(t.max)}]${RESET}`;
    console.log(
      `  ${mark}  ${t.name.padEnd(26)} ${t.format(t.actual).padStart(8)}  ${range}`,
    );
  }

  console.log(`\n  ${DIM}Rallies per match:${RESET} ${report.avgRalliesPerMatch.toFixed(1)}`);
  console.log(
    `  ${DIM}Throughput:${RESET} ${Math.round(report.ralliesPerSecond).toLocaleString()} rallies/sec`,
  );

  const scores = [...report.setScoreHistogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  console.log(`\n  ${DIM}Most common set scores:${RESET}`);
  console.log(
    `    ${scores.map(([k, v]) => `${k} (${v})`).join('   ')}`,
  );

  const colour = fail === 0 ? GREEN : YELLOW;
  console.log(`\n  ${colour}${pass} passed, ${fail} outside target range${RESET}\n`);
  if (fail > 0) process.exitCode = 1;
}

function cmdWorld(args: string[]): void {
  const scale = (args[0] ?? 'standard') as WorldScale;
  console.log(`\n${BOLD}Generating world${RESET} ${DIM}(scale: ${scale})${RESET}\n`);

  const t0 = process.hrtime.bigint();
  const world = generateWorld({ seed: 20260728, startYear: 2026, scale, manager: stubManager() });
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;

  const store = world.players;
  console.log(`  ${DIM}Generated in${RESET} ${elapsed.toFixed(2)}s`);
  console.log(`  ${DIM}Clubs:${RESET}         ${world.clubs.length.toLocaleString()}`);
  console.log(`  ${DIM}Players:${RESET}       ${store.count.toLocaleString()}`);
  console.log(`  ${DIM}Staff:${RESET}         ${world.staff.length.toLocaleString()}`);
  console.log(`  ${DIM}Competitions:${RESET}  ${world.competitions.length.toLocaleString()}`);

  // Memory footprint of the player columns, the dominant cost in a long career.
  let bytes = 0;
  for (const key of Object.keys(store) as Array<keyof typeof store>) {
    const v = store[key] as unknown;
    if (ArrayBuffer.isView(v)) bytes += (v as ArrayBufferView).byteLength;
  }
  console.log(`  ${DIM}Player columns:${RESET} ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  // Height by position — the clearest single check that generation is sane.
  console.log(`\n  ${BOLD}Anthropometrics by position${RESET}`);
  for (const pos of [0, 1, 2, 3, 4] as Position[]) {
    let n = 0, h = 0, sr = 0;
    for (let i = 0; i < store.count; i++) {
      if (store.position[i] !== pos) continue;
      n++; h += store.heightCm[i]; sr += store.spikeReachCm[i];
    }
    console.log(
      `    ${POSITION_SHORT[pos].padEnd(4)} n=${String(n).padStart(6)}  ` +
      `height ${(h / n).toFixed(1)}cm  spike reach ${(sr / n).toFixed(1)}cm`,
    );
  }

  // Strongest clubs in the world, which should be top-flight sides from the
  // strongest volleyball nations.
  const top = [...world.clubs]
    .sort((a, b) => {
      const av = a.players.reduce((s, p) => s + store.currentAbility[p], 0) / (a.players.length || 1);
      const bv = b.players.reduce((s, p) => s + store.currentAbility[p], 0) / (b.players.length || 1);
      return bv - av;
    })
    .slice(0, 10);
  console.log(`\n  ${BOLD}Strongest squads${RESET}`);
  for (const c of top) {
    const avg = c.players.reduce((s, p) => s + store.currentAbility[p], 0) / c.players.length;
    console.log(
      `    ${c.name.padEnd(30)} ${NATIONS[c.nation].code}  ` +
      `avg CA ${avg.toFixed(0).padStart(4)}  rep ${String(c.reputation).padStart(5)}  ` +
      `${DIM}${c.arenaCapacity.toLocaleString()} seats${RESET}`,
    );
  }

  // The best players in the world, by ability.
  const best = Array.from({ length: store.count }, (_, i) => i)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 10);
  console.log(`\n  ${BOLD}Best players${RESET}`);
  for (const p of best) {
    const club = store.clubId[p] >= 0 ? world.clubs[store.clubId[p]].name : 'Free agent';
    console.log(
      `    ${store.fullName(p).padEnd(26)} ${NATIONS[store.nation[p]].code} ` +
      `${POSITION_SHORT[store.position[p] as Position].padEnd(4)} ` +
      `age ${String(store.ageOn(p, world.year, 181)).padStart(2)}  ` +
      `CA ${String(store.currentAbility[p]).padStart(4)}/PA ${String(store.potentialAbility[p]).padStart(4)}  ` +
      `${store.heightCm[p]}cm  ${DIM}${club}${RESET}`,
    );
  }
  console.log();
}

function cmdCareer(args: string[]): void {
  const seasons = Number(args[0] ?? 50);
  const scale = (args[1] ?? 'standard') as WorldScale;
  console.log(`\n${BOLD}Simulating ${seasons} seasons${RESET} ${DIM}(scale: ${scale})${RESET}\n`);

  const { snapshots, world, totalSec } = runCareer(seasons, scale);

  console.log(
    `  ${DIM}${'Yr'.padEnd(6)}${'Active'.padStart(8)}${'AvgAge'.padStart(8)}` +
    `${'AvgCA'.padStart(7)}${'TopCA'.padStart(7)}${'Retire'.padStart(8)}` +
    `${'Youth'.padStart(7)}${'Xfers'.padStart(7)}${'Bank'.padStart(6)}${'HoF'.padStart(6)}` +
    `  Champion${RESET}`,
  );
  for (const s of snapshots) {
    // Print every season for short runs, every fifth for long ones.
    if (seasons > 12 && s.season % 5 !== 0 && s.season !== seasons - 1) continue;
    console.log(
      `  ${String(s.year).padEnd(6)}${s.activePlayers.toLocaleString().padStart(8)}` +
      `${s.avgAge.toFixed(1).padStart(8)}${s.avgCA.toFixed(0).padStart(7)}` +
      `${String(s.topCA).padStart(7)}${String(s.retired).padStart(8)}` +
      `${String(s.youthIntake).padStart(7)}${String(s.transfers).padStart(7)}` +
      `${String(s.bankruptcies).padStart(6)}${String(s.hallOfFame).padStart(6)}` +
      `  ${DIM}${s.champion}${RESET}`,
    );
  }

  // Stability is measured from the point the world has settled, not from
  // season zero. The generated starting world is an artificial snapshot —
  // every club holding exactly its target squad, nobody mid-transfer, no free
  // agents — and the first few seasons are the world relaxing out of it. What
  // matters is whether it holds steady afterwards.
  const settleAt = Math.min(snapshots.length - 1, Math.floor(snapshots.length / 3));
  const first = snapshots[settleAt];
  const last = snapshots[snapshots.length - 1];
  console.log(
    `\n  ${BOLD}Stability check${RESET} ` +
    `${DIM}(season ${first.season} vs ${last.season}, after the world settles)${RESET}`,
  );
  const drift = (label: string, a: number, b: number, tolerance: number, fmt = 0): void => {
    const change = b - a;
    const rel = a !== 0 ? Math.abs(change / a) : 0;
    const ok = rel <= tolerance;
    console.log(
      `    ${ok ? GREEN + 'STABLE' + RESET : YELLOW + 'DRIFT ' + RESET}  ${label.padEnd(20)} ` +
      `${a.toFixed(fmt).padStart(8)} -> ${b.toFixed(fmt).padStart(8)}  ` +
      `${DIM}(${(rel * 100).toFixed(1)}%, tolerance ${(tolerance * 100).toFixed(0)}%)${RESET}`,
    );
  };
  drift('Active players', first.activePlayers, last.activePlayers, 0.25);
  drift('Average age', first.avgAge, last.avgAge, 0.12, 1);
  drift('Average ability', first.avgCA, last.avgCA, 0.20);
  drift('Peak ability', first.topCA, last.topCA, 0.15);

  // The whole point of a long career: the original players must be gone.
  const store = world.players;
  let survivors = 0;
  for (let i = 0; i < Math.min(store.count, 200_000); i++) {
    if (store.isActive(i) && !store.hasFlag(i, PlayerFlag.Regen)) survivors++;
  }
  console.log(
    `\n  ${DIM}Original (non-regen) players still active:${RESET} ${survivors.toLocaleString()}`,
  );
  console.log(`  ${DIM}Total players ever created:${RESET} ${store.count.toLocaleString()}`);
  console.log(`  ${DIM}Hall of Fame:${RESET} ${world.hallOfFame.length.toLocaleString()}`);
  console.log(
    `  ${DIM}Total time:${RESET} ${totalSec.toFixed(1)}s ` +
    `(${(totalSec / seasons).toFixed(2)}s per season)\n`,
  );
}

function usage(): void {
  console.log(`
${BOLD}Volleyball Manager${RESET} — simulation CLI

  ${BOLD}calibrate${RESET} [matches]         Check engine output against real volleyball statistics
  ${BOLD}world${RESET} [small|standard|large]  Generate a world and report its shape
  ${BOLD}career${RESET} [seasons] [scale]    Simulate a long career and check the world for drift
  ${BOLD}demo${RESET}                        Play one match through the full engine and print the report
`);
}

const [, , command, ...rest] = process.argv;
switch (command) {
  case 'calibrate':
    cmdCalibrate(rest);
    break;
  case 'world':
    cmdWorld(rest);
    break;
  case 'career':
    cmdCareer(rest);
    break;
  case 'demo':
    runDemo();
    break;
  default:
    usage();
}
