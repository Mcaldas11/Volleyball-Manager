import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../model/positions.ts';
import { hasTrait, Trait, traitClaim } from '../model/traits.ts';
import { weeklyTraining } from './progression.ts';
import { abilityFractionAtAge } from '../model/ability.ts';
import {
  MAX_MENTEES, mentorBlock, mentorChance, menteesOf, mentoringWeek, mentorOf, mentorQuality, setMentor,
} from './mentoring.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function squad(seed: number): { world: World; club: World['clubs'][number]; young: number[]; old: number[] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const age = (p: number): number => world.players.ageOn(p, world.year, 181);
  // Room to grow: below what his potential says he should be at his age.
  const room = (p: number): number => world.players.potentialAbility[p] * abilityFractionAtAge(age(p)) - world.players.currentAbility[p];
  const club = world.clubs.find((c) => c.tier === 1 && c.players.filter((p) => age(p) <= 23).length >= 3 &&
    c.players.filter((p) => age(p) >= 28).length >= 2)!;
  world.userClubId = club.id;
  const young = club.players.filter((p) => age(p) <= 23).sort((a, b) => room(b) - room(a));
  return { world, club, young, old: club.players.filter((p) => age(p) >= 28) };
}

test('a veteran takes young players under his wing — two at most, at his own club', () => {
  const { world, young, old } = squad(111);
  assert.match(mentorBlock(world, young[0], old[0])!, /23 and under/);
  assert.match(mentorBlock(world, young[1], young[0])!, /28 or over/);
  const elsewhere = world.clubs.find((c) => c.id !== world.players.clubId[young[0]])!.players[0];
  assert.match(mentorBlock(world, elsewhere, young[0])!, /same club/);

  assert.match(setMentor(world, young[0], old[0]), /under his wing/);
  setMentor(world, young[1], old[0]);
  assert.equal(mentorOf(world, young[0]), old[0]);
  assert.deepEqual(menteesOf(world, old[0]).sort(), [young[0], young[1]].sort());
  assert.match(mentorBlock(world, old[0], young[2])!, new RegExp(`${MAX_MENTEES}`));
  // A new mentor replaces the old one.
  setMentor(world, young[0], old[1]);
  assert.equal(mentorOf(world, young[0]), old[1]);
  assert.equal(menteesOf(world, old[0]).length, 1);
  setMentor(world, young[0], null);
  assert.equal(mentorOf(world, young[0]), null);
});

test('a mentored young player comes on quicker — most with a mentor of his own position', () => {
  // The one with the most room to grow, over most of a season.
  const run = (mentored: boolean, seed: number): number => {
    const { world, young, old } = squad(seed);
    // Two with plenty of room to grow.
    const kids = young.slice(0, 2);
    // His age's share of his potential 150 above where he stands.
    for (const k of kids) {
      const frac = abilityFractionAtAge(world.players.ageOn(k, world.year, 181));
      world.players.potentialAbility[k] = Math.min(2000, Math.round((world.players.currentAbility[k] + 150) / frac));
    }
    if (mentored) for (const k of kids) setMentor(world, k, old[0]);
    const start = kids.map((k) => world.players.currentAbility[k]);
    for (let w = 0; w < 40; w++) { weeklyTraining(world); mentoringWeek(world); }
    return kids.reduce((s, k, i) => s + world.players.currentAbility[k] - start[i], 0);
  };
  // Over a few squads, so one week's luck doesn't decide it.
  const seeds = [112, 113, 115, 116];
  const plain = seeds.reduce((s, x) => s + run(false, x), 0);
  const helped = seeds.reduce((s, x) => s + run(true, x), 0);
  assert.ok(helped > plain + 20, `${helped} > ${plain}`);

  const { world, young, old } = squad(113);
  const kid = young[0];
  const samePos = old.find((p) => world.players.position[p] === world.players.position[kid]);
  const otherPos = old.find((p) => world.players.position[p] !== world.players.position[kid]);
  if (samePos !== undefined && otherPos !== undefined) {
    const same = mentorChance(world, { mentor: samePos, mentee: kid }) / mentorQuality(world, samePos);
    const other = mentorChance(world, { mentor: otherPos, mentee: kid }) / mentorQuality(world, otherPos);
    assert.ok(same > other, 'his own position counts most');
  }
});

test('something of the mentor rubs off — a trait now and then — and it ends when one of them goes', () => {
  const { world, club, young, old } = squad(114);
  const store = world.players;
  // A libero-to-libero or outside-to-outside pairing that can pass on "digs everything".
  const kid = young.find((p) => store.position[p] === Position.OutsideHitter || store.position[p] === Position.Libero) ?? young[0];
  store.position[kid] = Position.OutsideHitter;
  const mentor = old[0];
  store.traits[mentor] |= 1 << Trait.DigMachine;
  store.traits[kid] = 0;
  store.setAttr(kid, 'digging', 15);
  store.setAttr(kid, 'agility', 15);
  assert.ok(traitClaim(store, kid, Trait.DigMachine) >= 0.25);
  store.setAttr(mentor, 'professionalism', 20);
  store.setAttr(mentor, 'determination', 20);
  store.setAttr(kid, 'professionalism', 6);
  store.setAttr(kid, 'determination', 6);
  setMentor(world, kid, mentor);
  const before = store.getAttr(kid, 'professionalism') + store.getAttr(kid, 'determination');
  for (let w = 0; w < 400 && !hasTrait(store.traits[kid], Trait.DigMachine); w++) mentoringWeek(world);
  assert.ok(hasTrait(store.traits[kid], Trait.DigMachine), 'the trait passed on');
  assert.ok(world.messages.some((m) => m.subject === `${store.fullName(kid)} picks up a trait`));
  assert.ok(store.getAttr(kid, 'professionalism') + store.getAttr(kid, 'determination') > before, 'his work rubbed off');

  // The mentor leaves: it is over.
  club.players = club.players.filter((p) => p !== mentor);
  store.clubId[mentor] = -1;
  mentoringWeek(world);
  assert.equal(mentorOf(world, kid), null);
});
