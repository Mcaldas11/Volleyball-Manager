/**
 * End-to-end smoke test and showcase.
 *
 * Builds a world, takes charge of a club, plays a real fixture through the full
 * rally engine, and prints the rally log, box score and rotation report. If the
 * game works, this prints a match report a volleyball coach could read.
 */

import { aggregateTeam, attackEfficiency, breakPointPct, sideOutPct } from '../engine/match/stats.ts';
import { POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import { newSeasonContext, playFixture, startSeason } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import type { RallyContact } from '../engine/match/engine.ts';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

export function runDemo(): void {
  const world = generateWorld({ seed: 20260728, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world);
  const ctx = newSeasonContext();
  const store = world.players;

  // Take the strongest club in the world and find its first fixture.
  const club = [...world.clubs].sort((a, b) => b.reputation - a.reputation)[0];
  world.userClubId = club.id;

  const fixture = world.fixtures
    .filter((f) => f.home === club.id || f.away === club.id)
    .sort((a, b) => a.day - b.day)[0];
  if (fixture === undefined) {
    console.log('No fixture found.');
    return;
  }

  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  console.log(`\n${BOLD}${home.name}${RESET} vs ${BOLD}${away.name}${RESET}`);
  console.log(`${DIM}${world.competitions[fixture.competitionId]?.name}${RESET}\n`);

  playFixture(world, ctx, fixture, true);
  const result = ctx.detailedResults.get(fixture.id)!;

  console.log(
    `${BOLD}Final: ${result.homeSets}-${result.awaySets}${RESET}  ` +
    `${DIM}${result.setScores.map(([h, a]) => `${h}-${a}`).join('  ')}${RESET}`,
  );
  console.log(`${DIM}${result.totalRallies} rallies simulated${RESET}\n`);

  // The closing rallies of the final set.
  const log = result.log ?? [];
  const lastSet = log.length > 0 ? log[log.length - 1].set : 0;
  const closing = log.filter((r) => r.set === lastSet).slice(-8);

  console.log(`${BOLD}Closing rallies of set ${lastSet + 1}${RESET}`);
  for (const r of closing) {
    const desc = r.contacts.map((c) => describe(c, store)).filter((s) => s !== '').join(' → ');
    const colour = r.winner === 0 ? GREEN : YELLOW;
    console.log(
      `  ${DIM}${String(r.scoreBefore[0]).padStart(2)}-${String(r.scoreBefore[1]).padEnd(2)}${RESET} ` +
      `${colour}│${RESET} ${desc}`,
    );
  }

  // Box score for the home side.
  console.log(`\n${BOLD}${home.name} — box score${RESET}`);
  console.log(
    `  ${DIM}${'Player'.padEnd(24)}${'Pos'.padEnd(5)}${'Pts'.padStart(5)}${'K/Att'.padStart(9)}` +
    `${'Eff'.padStart(8)}${'Ace'.padStart(5)}${'Blk'.padStart(5)}${'Rec+'.padStart(7)}${RESET}`,
  );
  const rows = [...result.stats.home.players.values()]
    .filter((s) => s.attacksTotal > 0 || s.receptionsTotal > 0)
    .sort((a, b) =>
      (b.attackKills + b.serveAces + b.blockPoints) - (a.attackKills + a.serveAces + a.blockPoints));
  for (const s of rows) {
    const recPos = s.receptionsTotal > 0
      ? ((s.receptionPerfect + s.receptionPositive) / s.receptionsTotal * 100).toFixed(0) + '%'
      : '—';
    console.log(
      `  ${store.fullName(s.playerIdx).padEnd(24)}` +
      `${POSITION_SHORT[store.position[s.playerIdx] as Position].padEnd(5)}` +
      `${String(s.attackKills + s.serveAces + s.blockPoints).padStart(5)}` +
      `${`${s.attackKills}/${s.attacksTotal}`.padStart(9)}` +
      `${(s.attacksTotal > 0 ? attackEfficiency(s).toFixed(3) : '—').padStart(8)}` +
      `${String(s.serveAces).padStart(5)}${String(s.blockPoints).padStart(5)}` +
      `${recPos.padStart(7)}`,
    );
  }
  const total = aggregateTeam(result.stats.home);
  console.log(
    `  ${DIM}${'TEAM'.padEnd(29)}` +
    `${String(total.attackKills + total.serveAces + total.blockPoints).padStart(5)}` +
    `${`${total.attackKills}/${total.attacksTotal}`.padStart(9)}` +
    `${attackEfficiency(total).toFixed(3).padStart(8)}` +
    `${String(total.serveAces).padStart(5)}${String(total.blockPoints).padStart(5)}${RESET}`,
  );

  // Rotation report — the screen that shows where a match was actually lost.
  console.log(`\n${BOLD}${home.name} — rotation report${RESET}`);
  console.log(`  ${DIM}${'Rot'.padEnd(6)}${'Side-out'.padStart(10)}${'Break pt'.padStart(10)}${RESET}`);
  result.stats.home.rotations.forEach((r, i) => {
    console.log(
      `  P${String(i + 1).padEnd(5)}` +
      `${(r.receiveRallies > 0 ? `${(sideOutPct(r) * 100).toFixed(0)}%` : '—').padStart(10)}` +
      `${(r.serveRallies > 0 ? `${(breakPointPct(r) * 100).toFixed(0)}%` : '—').padStart(10)}`,
    );
  });
  console.log();
}

function describe(c: RallyContact, store: { shortName: (i: number) => string }): string {
  const who = store.shortName(c.player);
  switch (c.kind) {
    case 'serve': return `${who} serves (${c.detail})`;
    case 'ace': return `ACE ${who}`;
    case 'serveError': return `${who} serve error`;
    case 'reception': return `${who} passes ${c.detail}`;
    case 'receptionError': return `${who} shanks it`;
    case 'setError': return `${who} set error`;
    case 'attack': return `${who} attacks ${c.detail}`;
    case 'kill': return `KILL ${who} ${c.detail}`;
    case 'attackError': return `${who} attack error`;
    case 'blocked': return `${who} STUFFED`;
    case 'blockTouch': return `${who} touch`;
    case 'dig': return `${who} digs`;
    case 'freeball': return 'free ball';
    default: return '';
  }
}
