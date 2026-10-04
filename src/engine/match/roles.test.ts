import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, simulateMatch, type TeamSetup } from './engine.ts';
import { Formation } from './tactics.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager, type World } from '../world/world.ts';
import { appointManager } from '../world/career.ts';
import { positionTarget, setPositionTarget, trainPositions } from '../world/training.ts';
import { newSeasonContext, pickLineup, playFixture, startSeason, toTeamSetup } from '../season/seasonEngine.ts';

const ATTACKS = new Set(['attack', 'kill', 'attackError', 'blocked']);

function sides(seed: number): { world: World; home: TeamSetup; away: TeamSetup } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  return { world, home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b) };
}

test('receiving in P1 a 5-1 stays put: the outside passing in zone 2 hits on the right, the opposite on the left, all rally', () => {
  const { world, home, away } = sides(71);
  const store = world.players;
  const where = { p1: { oh: new Set<string>(), opp: new Set<string>() }, served: { oh: new Set<string>() } };
  for (const seed of [1, 2, 3, 4]) {
    const r = simulateMatch(store, {
      home, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed,
    });
    for (const rally of r.log ?? []) {
      if (rally.homeRotation !== 0) continue;
      for (const c of rally.contacts) {
        if (c.team !== 0 || !ATTACKS.has(c.kind) || c.detail === undefined) continue;
        const role = store.position[c.player];
        if (rally.serveTeam === 1) {
          if (role === Position.OutsideHitter) where.p1.oh.add(c.detail);
          if (role === Position.Opposite) where.p1.opp.add(c.detail);
        } else if (role === Position.OutsideHitter) where.served.oh.add(c.detail);
      }
    }
  }
  assert.deepEqual([...where.p1.oh], ['Opposite'], 'the receiving outside hits from the right');
  assert.deepEqual([...where.p1.opp], ['Outside'], 'and the opposite from the left');
  assert.ok(where.served.oh.has('Outside'), 'serving in P1, they switch as usual');
});

test('whoever starts in a slot plays its position — an outside as opposite, a libero as an outside — and so does whoever replaces him', () => {
  const { world, home, away } = sides(72);
  const store = world.players;
  const oh = home.bench.find((p) => store.position[p] === Position.OutsideHitter)!;
  const libero = home.libero;
  const lineup = [...home.lineup];
  const [opposite, outside] = [lineup[3], lineup[1]];
  lineup[3] = oh;
  lineup[1] = libero;
  const setup: TeamSetup = {
    ...home, lineup, libero: -1, bench: [...home.bench.filter((p) => p !== oh), opposite, outside],
  };
  const sim = new MatchSimulator(store, {
    home: setup, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed: 5,
  });
  assert.equal(sim.roleOf(oh), Position.Opposite);
  assert.equal(sim.roleOf(libero), Position.OutsideHitter);
  for (let i = 0; i < 4; i++) sim.step();

  // A middle on for the "opposite" plays opposite too.
  const middle = setup.bench.find((p) => store.position[p] === Position.MiddleBlocker)!;
  assert.equal(sim.substitute(0, oh, middle).ok, true);
  assert.equal(sim.roleOf(middle), Position.Opposite);

  sim.finish();
  const result = sim.buildResult();
  assert.equal(result.roles?.get(libero), Position.OutsideHitter);
  const line = result.stats.home.players.get(libero);
  assert.ok((line?.attacksTotal ?? 0) > 0, 'the libero attacks — he is an outside hitter tonight');
});

test('a player can learn a position in training, and playing there teaches it too', () => {
  const world = generateWorld({ seed: 73, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  appointManager(world, club.id);
  const store = world.players;
  const oh = club.players.find((p) => store.position[p] === Position.OutsideHitter && store.injuryDaysLeft[p] === 0)!;

  setPositionTarget(club, oh, Position.Opposite);
  assert.equal(positionTarget(world, club, oh), Position.Opposite);
  const before = store.familiarityWith(oh, Position.Opposite);
  trainPositions(world);
  const after = store.familiarityWith(oh, Position.Opposite);
  assert.ok(after > before, `${before} -> ${after} after a week`);
  // Weeks of it, and he has it.
  for (let w = 0; w < 40 && positionTarget(world, club, oh) !== null; w++) trainPositions(world);
  assert.equal(store.familiarityWith(oh, Position.Opposite), 100);
  assert.equal(positionTarget(world, club, oh), null, 'learnt in full, he goes back to his normal training');
  assert.ok(world.messages.some((m) => m.subject.includes('can play opposite')));

  // Put in the middle by hand, and played there: he knows it better afterwards.
  const pick = pickLineup(store, club);
  const lineup = [...pick.lineup];
  const mb = lineup.findIndex((_, i) => i === 2);
  const playing = club.players.find((p) => store.position[p] === Position.OutsideHitter && p !== oh && !lineup.includes(p)
    && store.injuryDaysLeft[p] === 0) ?? oh;
  lineup[mb] = playing;
  club.preferredLineup = lineup;
  club.preferredFormation = Formation.FiveOne;
  club.tactics.formation = Formation.FiveOne;
  const known = store.familiarityWith(playing, Position.MiddleBlocker);
  const f = world.fixtures.filter((x) => !x.played && (x.home === club.id || x.away === club.id)).sort((a, b) => a.day - b.day)[0];
  world.day = f.day;
  playFixture(world, ctx, f, true);
  assert.ok(store.familiarityWith(playing, Position.MiddleBlocker) > known, 'a match in the middle teaches the middle');
});
