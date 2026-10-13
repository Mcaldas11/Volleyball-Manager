import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dressingRoom, dressingRoomWeek, noteDeparture, setCaptain, setViceCaptain } from './dressingRoom.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('the vice-captain takes the armband when the captain goes — and the room takes it better', () => {
  const shock = (withVice: boolean): { cohesionDrop: number; captain: number | undefined; heir: number } => {
    const world = generateWorld({ seed: 101, startYear: 2026, scale: 'small', manager: stubManager() });
    const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
    const room = dressingRoom(world, club);
    const [cap, vice] = room.members.filter((m) => m.tier === 'leader').map((m) => m.p);
    setCaptain(club, cap);
    if (withVice) setViceCaptain(club, vice);
    const before = dressingRoom(world, club).cohesion;
    // As a transfer has it: the room hears, then he goes.
    noteDeparture(world, club, cap);
    club.players = club.players.filter((p) => p !== cap);
    return { cohesionDrop: before - dressingRoom(world, club).cohesion, captain: club.captain, heir: vice };
  };
  const without = shock(false);
  const withVice = shock(true);
  assert.equal(without.captain, undefined, 'nobody named: the room picks');
  assert.equal(withVice.captain, withVice.heir, 'the vice-captain wears the armband');
  assert.ok(withVice.cohesionDrop < without.cohesionDrop, `${withVice.cohesionDrop} < ${without.cohesionDrop}`);

  // The armbands don't overlap.
  const world = generateWorld({ seed: 102, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs[0];
  const [a, b] = club.players;
  setCaptain(club, a);
  setViceCaptain(club, a);
  assert.equal(club.viceCaptain, undefined, 'the captain is not his own deputy');
  setViceCaptain(club, b);
  setCaptain(club, b);
  assert.equal(club.captain, b);
  assert.equal(club.viceCaptain, undefined);
});

test('the room\'s groups: by country and by age; an isolated newcomer, an unhappy group, the veterans', () => {
  const world = generateWorld({ seed: 103, startYear: 2026, scale: 'small', manager: stubManager() });
  world.season = 1; // newcomers only count once the save has a past
  world.year += 1;
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  const store = world.players;
  const room = dressingRoom(world, club);
  const home = room.groups.find((g) => g.key === `n${club.nation}`);
  assert.ok(home !== undefined && home.members.every((p) => store.nation[p] === club.nation));
  for (const g of room.groups) assert.ok(g.members.length >= 2);

  // A foreigner alone, new this season: isolated.
  const foreign = world.clubs.flatMap((c) => c.players).find((p) => store.nation[p] !== club.nation &&
    !club.players.some((q) => store.nation[q] === store.nation[p]))!;
  club.players.push(foreign);
  store.clubId[foreign] = club.id;
  const after = dressingRoom(world, club);
  assert.ok(after.isolated.includes(foreign));
  assert.ok(after.effects.some((e) => e.points < 0 && e.why.includes('nobody from home')));

  // An unhappy group costs the room; the group's mood draws its members together.
  const big = after.groups.find((g) => g.members.length >= 3)!;
  const settled = after.cohesion;
  for (const p of big.members) store.morale[p] = 20;
  const glum = dressingRoom(world, club);
  assert.ok(glum.effects.some((e) => e.why.includes('unhappy')));
  assert.ok(glum.cohesion < settled);
  store.morale[big.members[0]] = 90;
  dressingRoomWeek(world);
  assert.ok(store.morale[big.members[0]] < 90, 'the group pulls him down a little');
});
