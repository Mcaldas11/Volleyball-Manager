import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { NATIONS } from '../world/nations.ts';
import { DAYS_PER_SEASON, stubManager, type World } from '../world/world.ts';
import {
  clubWorldYear, cupGroupTable, cupProgress, ensureCupCompetitions, isCupCompetition, knockoutRoundName,
  nextClubWorldYear, qualifyForCups, stageLabel,
} from './cups.ts';
import { endSeason } from './rollover.ts';
import { advanceDay, newSeasonContext, startSeason } from './seasonEngine.ts';

/** One world played through a whole season, shared by the tests below. */
function playedSeason(): { world: World; ctx: ReturnType<typeof newSeasonContext> } {
  const world = generateWorld({ seed: 91, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  world.userClubId = world.clubs.find((c) => c.tier === 1 && NATIONS[c.nation].code === 'POL')!.id;
  while (world.day % DAYS_PER_SEASON < 350) advanceDay(world, ctx);
  return { world, ctx };
}

const season = playedSeason();

test('every nation with a league gets a cup and a super cup; each confederation a club championship', () => {
  const world = generateWorld({ seed: 90, startYear: 2026, scale: 'small', manager: stubManager() });
  const nations = new Set(world.competitions.filter((c) => c.kind === 'league').map((c) => c.nation));
  for (const n of nations) {
    assert.ok(world.competitions.some((c) => c.key === `cup:${NATIONS[n].code}`), `${NATIONS[n].name} has a cup`);
    assert.ok(world.competitions.some((c) => c.key === `super:${NATIONS[n].code}`), `${NATIONS[n].name} has a super cup`);
  }
  for (const key of ['cont:CEV:1', 'cont:CEV:2', 'cont:CSV:1', 'cont:NORCECA:1', 'cont:AVC:1', 'cont:CAVB:1', 'clubworld']) {
    assert.ok(world.competitions.some((c) => c.key === key), key);
  }
});

test('the Champions League is European, the world championship is open to anyone, cups are national', () => {
  const { world } = season;
  const cl = world.competitions.find((c) => c.key === 'cont:CEV:1')!;
  assert.equal(cl.participants.length, 16);
  for (const c of cl.participants) assert.equal(NATIONS[world.clubs[c].nation].confederation, 'CEV');
  const cwc = world.competitions.find((c) => c.kind === 'clubworld')!;
  const confs = new Set(cwc.participants.map((c) => NATIONS[world.clubs[c].nation].confederation));
  assert.ok(confs.size >= 4, 'clubs from across the world');
  for (const comp of world.competitions.filter((c) => c.kind === 'cup' && c.cup !== undefined)) {
    for (const c of comp.participants) assert.equal(world.clubs[c].nation, comp.nation);
  }
});

test('a season of cups: every one finished, no club ever plays twice in a day, all before the playoffs', () => {
  const { world } = season;
  const start = world.season * DAYS_PER_SEASON;
  const perDay = new Map<string, number>();
  for (const f of world.fixtures) {
    if (f.day < start || f.day >= start + DAYS_PER_SEASON) continue;
    for (const c of [f.home, f.away]) perDay.set(`${c}:${f.day}`, (perDay.get(`${c}:${f.day}`) ?? 0) + 1);
  }
  assert.ok([...perDay.values()].every((n) => n === 1), 'one match a day at most');

  for (const comp of world.competitions.filter((c) => isCupCompetition(c) && c.cup !== undefined)) {
    assert.equal(comp.cup!.bracket?.resolved, true, `${comp.name} has a winner`);
    assert.ok(comp.participants.includes(comp.champion));
    for (const id of comp.fixtureIds) {
      assert.ok(world.fixtures[id].played, `${comp.name}: every match played`);
      assert.ok(world.fixtures[id].day - start < 272, `${comp.name}: done before the playoffs`);
    }
  }
});

test('the top two of each group go through, and group winners meet runners-up', () => {
  const { world } = season;
  const cl = world.competitions.find((c) => c.key === 'cont:CEV:1')!;
  const cup = cl.cup!;
  assert.equal(cup.groups.length, 4);
  const tables = cup.groups.map((g) => cupGroupTable(world, g).map((r) => r.clubId));
  const seeds = cup.bracket!.seeds;
  assert.deepEqual(seeds.slice(0, 4), tables.map((t) => t[0]));
  assert.deepEqual(seeds.slice(4), tables.map((t) => t[1]));
  for (const tie of cup.bracket!.rounds[0]) assert.ok(tie.homeSeed < 4 && tie.awaySeed >= 4);
  assert.equal(stageLabel(world, world.fixtures[cup.bracket!.rounds[2][0].fixtureId]), 'Final');
  assert.equal(knockoutRoundName(0, 3), 'Quarter-final');
});

test('the rollover records the cup winners and qualifies next season\'s entrants', () => {
  const { world, ctx } = season;
  const cl = world.competitions.find((c) => c.key === 'cont:CEV:1')!;
  const clWinner = cl.champion;
  const poland = NATIONS.findIndex((n) => n.code === 'POL');
  const polishCupWinner = world.competitions.find((c) => c.key === 'cup:POL')!.champion;
  const progress = cupProgress(world.competitions.find((c) => c.key === 'cup:POL')!, world.userClubId);
  assert.ok(progress !== null && progress.stage !== '');
  const playedIn = world.competitions.filter((c) => isCupCompetition(c) && c.fixtureIds.some((id) => {
    const f = world.fixtures[id];
    return f.played && (f.home === world.userClubId || f.away === world.userClubId);
  }));
  assert.ok(playedIn.length >= 1);
  const cwc = world.competitions.find((c) => c.kind === 'clubworld')!;
  qualifyForCups(world);
  assert.ok(cwc.participants.includes(clWinner), 'the European champions qualify for the world championship');

  endSeason(world, ctx);
  // The season review lists every cup the club played in, however far it got.
  const review = world.messages.find((m) => m.seasonReview !== undefined)!.seasonReview!;
  for (const comp of playedIn) {
    const s = review.standings.find((x) => x.competitionId === comp.id);
    assert.ok(s !== undefined && s.stage !== undefined, `${comp.name} in the review`);
  }
  const record = world.history[world.history.length - 1];
  assert.ok(record.champions.some((c) => c.competitionId === cl.id && c.winner === clWinner));

  // …which waits for its year: 2027 has none.
  assert.equal(cwc.cup, undefined);
  const superCup = world.competitions.find((c) => c.key === 'super:POL')!;
  assert.ok(superCup.participants.includes(polishCupWinner) || superCup.participants.length === 2);
  assert.ok(superCup.participants.every((c) => world.clubs[c].nation === poland));
});

test('an old save without cups gets them, adopting its unplayed continental competitions', () => {
  const world = generateWorld({ seed: 92, startYear: 2026, scale: 'small', manager: stubManager() });
  const cups = world.competitions.filter(isCupCompetition).length;
  const cl = world.competitions.find((c) => c.key === 'cont:CEV:1')!;
  // Undo the cups the way an older save stored them: continental cups as
  // bare competitions with no key, and nothing else.
  const legacyId = cl.id;
  world.competitions = world.competitions.filter((c) => c.kind === 'league' || c.id === legacyId);
  cl.key = undefined;
  cl.table = [];
  ensureCupCompetitions(world);
  assert.equal(world.competitions.find((c) => c.key === 'cont:CEV:1'), cl, 'the old Champions League is kept');
  assert.ok(world.competitions.some((c) => c.kind === 'clubworld'));
  assert.equal(world.competitions.filter(isCupCompetition).length, cups, 'every cup a new world has');
  ensureCupCompetitions(world);
  assert.equal(new Set(world.competitions.map((c) => c.key).filter((k) => k !== undefined)).size,
    world.competitions.filter((c) => c.key !== undefined).length, 'running it twice adds nothing');
});

test('the Club World Championship is played every fourth year, and only then', () => {
  assert.deepEqual([2026, 2027, 2028, 2029, 2030, 2034].map(clubWorldYear), [true, false, false, false, true, true]);
  assert.equal(nextClubWorldYear(2026), 2026);
  assert.equal(nextClubWorldYear(2027), 2030);

  const on = generateWorld({ seed: 93, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(on, newSeasonContext());
  const played = on.competitions.find((c) => c.kind === 'clubworld')!;
  assert.ok(played.cup !== undefined && played.fixtureIds.length > 0 && played.participants.length === 8);

  const off = generateWorld({ seed: 93, startYear: 2027, scale: 'small', manager: stubManager() });
  startSeason(off, newSeasonContext());
  const cwc = off.competitions.find((c) => c.kind === 'clubworld')!;
  assert.equal(cwc.cup, undefined);
  assert.deepEqual(cwc.fixtureIds, []);
  assert.deepEqual(cwc.participants, []);
  assert.ok(off.competitions.find((c) => c.key === 'cont:CEV:1')!.cup !== undefined, 'the rest are played as ever');
});
