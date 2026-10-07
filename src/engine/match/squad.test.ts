import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, registeredLiberos, type TeamSetup } from './engine.ts';
import { MATCHDAY_SQUAD, MAX_SQUAD, Position, SQUAD_TARGET } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { pickLineup, toTeamSetup } from '../season/seasonEngine.ts';

function world(seed: number) {
  return generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
}

test('a squad is up to twenty, of whom fourteen are named for a match — the six, the liberos and a bench that covers every position', () => {
  const w = world(91);
  const store = w.players;
  const target = Object.values(SQUAD_TARGET).reduce((s, n) => s + n, 0);
  for (const club of w.clubs.filter((c) => c.players.length > 0)) {
    assert.equal(club.players.length, target);
    assert.ok(club.players.length <= MAX_SQUAD);
  }
  for (const club of w.clubs.filter((c) => c.tier === 1).slice(0, 12)) {
    const pick = pickLineup(store, club);
    const named = [...pick.lineup, pick.libero, pick.defensiveLibero, ...pick.bench].filter((p) => p >= 0);
    assert.equal(named.length, Math.min(MATCHDAY_SQUAD, club.players.filter((p) => store.isAvailable(p)).length));
    assert.equal(new Set(named).size, named.length);
    // Everyone fit and not named is left out — and nobody is both.
    assert.equal(pick.out.length + named.length, club.players.filter((p) => store.isAvailable(p)).length);
    assert.ok(pick.out.every((p) => !named.includes(p)));
    // A spare for every position on the bench.
    const healthy = club.players.filter((p) => store.isAvailable(p));
    for (const pos of [Position.Setter, Position.OutsideHitter, Position.MiddleBlocker, Position.Opposite]) {
      if (healthy.filter((p) => store.position[p] === pos).length >= 2 + (pos === Position.OutsideHitter || pos === Position.MiddleBlocker ? 1 : 0)) {
        assert.ok(pick.bench.some((p) => store.position[p] === pos), `a spare ${pos} on the bench`);
      }
    }
    // And never more than two liberos named.
    assert.ok(registeredLiberos(store, pick).length <= 2);
  }
});

test("the manager's own bench is the one named, and someone who can't play is replaced by the next best fit", () => {
  const w = world(92);
  const store = w.players;
  const club = w.clubs.find((c) => c.tier === 1 && c.players.length >= 18)!;
  const first = pickLineup(store, club);
  // Five of the worst, by hand: a smaller bench, and exactly them.
  const chosen = [...first.bench, ...first.out].sort((a, b) => store.currentAbility[a] - store.currentAbility[b]).slice(0, 5);
  club.preferredBench = chosen;
  assert.deepEqual(new Set(pickLineup(store, club).bench), new Set(chosen));
  // One of them hurt: still five, his place taken.
  store.injuryDaysLeft[chosen[0]] = 20;
  const hurt = pickLineup(store, club);
  assert.equal(hurt.bench.length, 5);
  assert.ok(!hurt.bench.includes(chosen[0]));
  assert.ok(chosen.slice(1).every((p) => hurt.bench.includes(p)));
});

test('only two liberos are named: a third in the squad plays in the six, and those named play nowhere else', () => {
  const w = world(93);
  const store = w.players;
  const [a, b] = w.clubs.filter((c) => c.tier === 1 && c.players.length >= 18);
  const home = toTeamSetup(store, a);
  const away = toTeamSetup(store, b);
  // A third libero, borrowed for the night, among the reserves.
  const spare = home.bench.find((p) => store.position[p] === Position.Libero)!;
  const third = b.players.find((p) => store.position[p] === Position.Libero && p !== away.libero && !away.bench.includes(p))
    ?? b.players.find((p) => store.position[p] === Position.Libero && p !== away.libero)!;
  const bench = [...home.bench.filter((p) => p !== third), third];
  const setup: TeamSetup = { ...home, bench };
  const named = registeredLiberos(store, setup);
  assert.equal(named.length, 2);
  assert.ok(named.includes(home.libero) && named.includes(spare) !== named.includes(third));
  const outfield = named.includes(spare) ? third : spare;
  const benchSpare = named.includes(spare) ? spare : third;

  const sim = new MatchSimulator(store, {
    home: setup, away: { ...away, bench: away.bench.filter((p) => p !== third) },
    format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 3,
  });
  // The libero beyond the two can't play libero…
  assert.equal(sim.setLibero(0, 'reception', outfield).ok, false);
  // …but comes on in the six, as whoever he replaces.
  const oh = home.lineup.find((p) => store.position[p] === Position.OutsideHitter)!;
  assert.equal(sim.substitute(0, oh, outfield).ok, true);
  assert.equal(sim.roleOf(outfield), Position.OutsideHitter);
  // The named spare plays libero, and only libero.
  const mb = home.lineup.find((p) => store.position[p] === Position.MiddleBlocker)!;
  assert.equal(sim.substitute(0, mb, benchSpare).ok, false);
  assert.equal(sim.setLibero(0, 'reception', benchSpare).ok, true);
  assert.deepEqual(new Set(sim.squadFor(0)), new Set([...home.lineup, home.libero, ...bench]));
});
