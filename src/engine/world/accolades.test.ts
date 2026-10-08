import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../model/positions.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager } from './career.ts';
import { coachAccolades, playerAccolades } from './accolades.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager } from './world.ts';

test("a season ends with its awards: the league's and the world's players, coaches and young players of the year, and their teams on the court", () => {
  const world = generateWorld({ seed: 83, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[0];
  appointManager(world, club.id);
  assert.equal(world.expectedFinish?.season, world.season, 'where every side should finish, noted as the season starts');
  while (world.day < DAYS_PER_SEASON - 2) {
    advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
    // Kept in his job, so the league is still his as the season ends.
    if (world.userClubId !== club.id) appointManager(world, club.id);
  }
  const season = world.season;
  endSeason(world, ctx);
  const store = world.players;

  // His league's night, and the world's: each award with a shortlist of up to three, the winner first.
  const nights = world.messages.filter((m) => m.awardsNight !== undefined).map((m) => m.awardsNight!);
  const league = nights.find((n) => n.scope === club.leagueId);
  const globe = nights.find((n) => n.scope === 'world');
  assert.ok(league !== undefined && globe !== undefined);
  // The world always has its young player of the year; a league only if a young player held a place in it.
  assert.deepEqual(globe.awards.map((a) => a.kind), ['player', 'coach', 'young']);
  for (const night of [league, globe]) {
    assert.deepEqual(night.awards.map((a) => a.kind).slice(0, 2), ['player', 'coach']);
    for (const a of night.awards) {
      assert.ok(a.shortlist.length >= 1 && a.shortlist.length <= 3);
      assert.equal(new Set(a.shortlist.map((n) => n.p ?? `c${n.coach}`)).size, a.shortlist.length, 'nobody twice');
      if (a.kind === 'coach') assert.ok(a.shortlist.every((n) => n.coach !== undefined && n.p === undefined));
      else assert.ok(a.shortlist.every((n) => n.p !== undefined));
      if (a.kind === 'young') assert.ok(a.shortlist.every((n) => world.year - store.birthYear[n.p!] <= 21));
    }
    // The team: a setter, two outsides, two middles, an opposite, a libero.
    const shape = night.team.map((d) => d.pos).sort();
    assert.deepEqual(shape, [Position.Setter, Position.Opposite, Position.OutsideHitter, Position.OutsideHitter,
      Position.MiddleBlocker, Position.MiddleBlocker, Position.Libero].sort());
  }
  // The world's are judged across its leagues, not only the manager's.
  const leagueOf = (p: number): number => world.clubs[store.clubId[p]]?.leagueId ?? -1;
  const player = globe.awards.find((a) => a.kind === 'player')!;
  assert.ok(new Set(player.shortlist.map((n) => leagueOf(n.p!))).size >= 2, 'nominees from more than one league');
  assert.ok(globe.extras !== undefined && globe.extras.length > 0, 'the top scorer and the rest');

  // The league's team of the season, on the court, in a message of its own.
  const team = world.messages.find((m) => m.teamOfSeason?.competitionId === club.leagueId);
  assert.ok(team !== undefined && team.teamOfSeason!.picks.length === 7);

  // Every top flight's awards are on the record, and the winners' profiles show them.
  const tops = world.competitions.filter((c) => c.kind === 'league' && c.tier === 1 && c.table.some((r) => r.played > 0));
  for (const comp of tops) {
    assert.ok(world.accolades!.some((a) => a.scope === comp.id && a.season === season && a.kind === 'player'), comp.name);
  }
  const best = player.shortlist[0].p!;
  assert.ok(playerAccolades(world, best).some((a) => a.scope === 'world' && a.kind === 'player'));
  assert.equal(world.history[world.history.length - 1].playerOfTheYear, best, 'the record book has the World Player of the Year');
  const coach = globe.awards.find((a) => a.kind === 'coach')!.shortlist[0].coach!;
  assert.ok(coachAccolades(world, coach).some((a) => a.scope === 'world'));
});
