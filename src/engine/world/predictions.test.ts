import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { paperStrength, predictionFor, predictionVerdicts, tippedPlace } from './predictions.ts';

function career() {
  const world = generateWorld({ seed: 91, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[3];
  appointManager(world, club.id);
  return { world, ctx, club };
}

test('before a league starts, the papers tip its table — the strongest squads at the top — and the manager hears his tip', () => {
  const { world, ctx, club } = career();
  const league = world.competitions[club.leagueId];
  for (let d = 0; d < 200 && predictionFor(world, league.id) === undefined; d++) advanceDay(world, ctx, {});
  const tip = predictionFor(world, league.id)!;
  assert.ok(tip !== undefined, 'tipped');
  assert.ok(league.table.every((r) => r.played === 0), 'before a ball is served');
  assert.equal(tip.order.length, league.participants.length);
  // The favourites are among the three strongest squads on paper.
  const byPaper = [...league.participants].sort((a, b) => paperStrength(world, world.clubs[b].players) - paperStrength(world, world.clubs[a].players));
  assert.ok(byPaper.slice(0, 3).includes(tip.order[0]));
  assert.ok(tippedPlace(world, league.id, club.id) >= 1);
  assert.ok(world.messages.some((m) => /The press tip/.test(m.subject)));
  assert.ok(world.news.some((n) => /tip/.test(n.headline)));
});

test('the season over, beating the tips by a distance pleases the board, falling well short does not', () => {
  for (const [tipped, finished, sign] of [[8, 2, 1], [2, 9, -1]] as const) {
    const { world, club } = career();
    const league = world.competitions[club.leagueId];
    const others = league.participants.filter((id) => id !== club.id);
    const order = [...others];
    order.splice(tipped - 1, 0, club.id);
    world.predictions = [{ season: world.season, leagueId: league.id, day: world.day, order }];
    // The table as it finished: the club where it finished, the rest in the tipped order.
    const final = [...others];
    final.splice(finished - 1, 0, club.id);
    for (const r of league.table) r.points = 100 - final.indexOf(r.clubId) * 3;
    const before = club.boardConfidence;
    predictionVerdicts(world);
    assert.equal(Math.sign(club.boardConfidence - before), sign, `tipped ${tipped}, finished ${finished}`);
    assert.match(world.messages.at(-1)!.subject, new RegExp(`tipped`));
    assert.equal(world.predictions[0].settled, true);
  }
});
