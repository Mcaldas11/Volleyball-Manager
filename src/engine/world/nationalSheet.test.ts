import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTactics, Formation } from '../match/tactics.ts';
import { Position } from '../model/positions.ts';
import { nationSetup, suggestSquad, type Tournament } from './internationals.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test("a national team plays to its own instructions and team sheet — not its coach's club's", () => {
  const world = generateWorld({ seed: 91, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const team = world.nationalTeams.find((t) => suggestSquad(world, t.nation).length >= 14)!;
  const squad = suggestSquad(world, team.nation);
  const t = { squads: [[team.nation, squad]] } as unknown as Tournament;
  const setters = (lineup: number[]): number => lineup.filter((p) => store.position[p] === Position.Setter).length;

  // A club in a 5-1 does not make its coach's country one.
  const club = world.clubs.find((c) => c.players.length >= 14)!;
  club.tactics.formation = Formation.FiveOne;
  team.tactics = defaultTactics();
  team.tactics.formation = Formation.FourTwo;
  const twoSetters = nationSetup(world, t, team.nation);
  assert.equal(twoSetters.tactics.formation, Formation.FourTwo);
  assert.equal(setters(twoSetters.lineup), 2, 'a 4-2 starts two setters');

  // The six he named for it start, wherever he put them.
  team.tactics.formation = Formation.FiveOne;
  const auto = nationSetup(world, t, team.nation);
  assert.equal(setters(auto.lineup), 1);
  const benched = squad.find((p) => !auto.lineup.includes(p) && store.position[p] === auto.lineup.map((x) => store.position[x])[3] &&
    store.isAvailable(p));
  assert.ok(benched !== undefined, 'a man on the bench for that place');
  team.preferredLineup = [...auto.lineup];
  team.preferredLineup[3] = benched;
  team.preferredFormation = Formation.FiveOne;
  assert.equal(nationSetup(world, t, team.nation).lineup[3], benched, 'his own six');
  // Nobody's sheet: the auto-pick, as ever.
  team.preferredLineup = undefined;
  assert.deepEqual(nationSetup(world, t, team.nation).lineup, auto.lineup);
  assert.equal(club.tactics.formation, Formation.FiveOne, 'the club untouched');
});
