import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTableRows } from '../model/club.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { championOf, pastCupEditions, pastLeagueTable, pastSeasonsOf, seasonLabel } from './pastSeasons.ts';
import { endSeason } from './rollover.ts';
import { advanceDay, isSeasonOver, newSeasonContext, startSeason } from './seasonEngine.ts';

test('a finished season\'s table, drawn up again from its matches, is the table it ended with — and last season\'s cups are there', () => {
  const world = generateWorld({ seed: 33, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  while (!isSeasonOver(world)) advanceDay(world, ctx);

  const league = world.competitions.find((c) => c.kind === 'league' && c.table.some((r) => r.played > 0))!;
  const cup = world.competitions.find((c) => c.kind === 'cup' && c.fixtureIds.some((id) => world.fixtures[id]?.played === true));
  const ended = [...league.table].sort(compareTableRows).filter((r) => r.played > 0).map((r) => ({ ...r }));
  assert.deepEqual(pastSeasonsOf(world, league.id), [], 'nothing past while the season is on');

  endSeason(world, ctx);

  assert.deepEqual(pastSeasonsOf(world, league.id), [0]);
  assert.deepEqual(pastLeagueTable(world, league.id, 0), ended);
  assert.ok(championOf(world, league.id, 0) >= 0, 'the record says who took the title');
  assert.equal(seasonLabel(world, 0), '2026/27');

  if (cup !== undefined) {
    const [edition] = pastCupEditions(world, cup.id);
    assert.equal(edition.season, 0);
    assert.ok(edition.final !== null && edition.matches.includes(edition.final));
    const f = edition.final;
    assert.ok(edition.winner === f.home || edition.winner === f.away, 'the winners played the final');
  }
});
