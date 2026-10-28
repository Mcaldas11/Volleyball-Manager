import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { Position } from '../model/positions.ts';
import { MatchFormat, MatchSimulator, type RallyContact } from './engine.ts';
import { isCombination } from './tactics.ts';

/** Every second ball the libero played, with how good the ball he played it off was, and the attack after it. */
function liberoSets(seeds: number[]): Array<{ set: RallyContact; quality: number; attack: RallyContact | undefined }> {
  const world = generateWorld({ seed: 33, startYear: 2026, scale: 'small', manager: stubManager() });
  const clubs = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  const out: Array<{ set: RallyContact; quality: number; attack: RallyContact | undefined }> = [];
  seeds.forEach((seed, i) => {
    const r = new MatchSimulator(world.players, {
      home: toTeamSetup(world.players, clubs[i % clubs.length]), away: toTeamSetup(world.players, clubs[(i + 1) % clubs.length]),
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed,
    }).run();
    const roles = r.roles!;
    for (const rally of r.log!) {
      rally.contacts.forEach((c, k) => {
        if ((c.kind !== 'set' && c.kind !== 'setError') || roles.get(c.player) !== Position.Libero) return;
        const first = rally.contacts[k - 1];
        if (first === undefined || first.team !== c.team || first.quality === undefined) return;
        // The attack off this set: the side's very next touch — not one off a later set, after a free ball.
        const next = rally.contacts.slice(k + 1).find((x) => x.team === c.team);
        const attack = next !== undefined && (next.kind === 'attack' || next.kind === 'kill' || next.kind === 'attackError' || next.kind === 'blocked') ? next : undefined;
        out.push({ set: c, quality: first.quality, attack: c.kind === 'set' ? attack : undefined });
      });
    }
  });
  return out;
}

test('the libero never sets overhead inside the 3 m line: he bumps it, or jump-sets from behind the line — beyond it, as he likes', () => {
  const sets = liberoSets([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const inside = sets.filter((s) => s.quality >= 0.58);
  const beyond = sets.filter((s) => s.quality < 0.58);
  assert.ok(inside.length > 10 && beyond.length > 10, `${inside.length} inside, ${beyond.length} beyond`);
  for (const s of inside) assert.ok(s.set.detail === 'bump' || s.set.detail === 'jump', 'inside the line: a bump or a jump set');
  for (const s of beyond) assert.equal(s.set.detail, undefined, 'beyond the line: an ordinary set');
  // A jump set only with the ball by the line — never off a pass to the net.
  for (const s of inside.filter((x) => x.set.detail === 'jump')) assert.ok(s.quality < 0.79, `jump set off ${s.quality.toFixed(2)}`);
  assert.ok(inside.some((s) => s.set.detail === 'bump') && inside.some((s) => s.set.detail === 'jump'), 'both are seen');
  // Off a bump set nothing fast: no quick, no combination, no fast set to the pins.
  for (const s of inside.filter((x) => x.set.detail === 'bump' && x.attack !== undefined)) {
    assert.notEqual(s.attack!.detail, 'Quick (middle)');
    assert.ok(s.attack!.play === undefined || (!isCombination(s.attack!.play) && s.attack!.play !== 'fastSet'), `no ${s.attack!.play} off a bump`);
  }
});
