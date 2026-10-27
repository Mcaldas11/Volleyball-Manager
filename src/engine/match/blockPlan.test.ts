import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { MatchFormat, MatchSimulator, SECOND_BALL, type MatchResult } from './engine.ts';
import { BlockFocus, BlockNumbers, type BlockPlan } from './tactics.ts';

/** Two sides' matches, the away side blocking every pin and the pipe to one plan. */
function play(plan: BlockPlan | null, seeds: number[]): MatchResult[] {
  const world = generateWorld({ seed: 12, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  return seeds.map((seed) => {
    const home = toTeamSetup(world.players, a);
    const away = toTeamSetup(world.players, b);
    if (plan !== null) away.tactics = { ...away.tactics, blockPlans: { outside: plan, opposite: plan, pipe: plan } };
    return new MatchSimulator(world.players, {
      home, away, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed,
    }).run();
  });
}

test('a free ball is no attack, and a setter dump is his own: the box score counts what the log shows', () => {
  for (const r of play(null, [1, 2, 3])) {
    for (const side of [0, 1] as const) {
      const team = side === 0 ? r.stats.home : r.stats.away;
      let swings = 0;
      let dumps = 0;
      for (const rally of r.log!) for (const c of rally.contacts) {
        if (c.team !== side) continue;
        if (c.kind === 'attack' || c.kind === 'kill' || c.kind === 'attackError' || c.kind === 'blocked') {
          if (c.shot !== 'recycle') swings++;
          if (c.detail === SECOND_BALL) dumps++;
        }
        if (c.kind === 'attack' && c.shot === 'recycle') swings++;
      }
      const counted = [...team.players.values()].reduce((n, s) => n + s.attacksTotal, 0);
      assert.equal(counted, swings, 'every attack in the log is in the box score — free balls are not');
      assert.ok(dumps <= swings);
    }
  }
});

test('the block plan is played: three up puts three in the block, one up never more than one, the focus as set unless it was misread', () => {
  const contacts = (rs: MatchResult[]): Array<NonNullable<MatchResult['log']>[number]['contacts'][number]> =>
    rs.flatMap((r) => r.log!.flatMap((x) => x.contacts.filter((c) => c.team === 0 && c.blockFocus !== undefined)));
  const triple = contacts(play({ focus: BlockFocus.Line, numbers: BlockNumbers.Triple }, [4, 5]));
  const single = contacts(play({ focus: BlockFocus.Cross, numbers: BlockNumbers.Single }, [4, 5]));
  assert.ok(triple.some((c) => c.blockers === 3), 'three up, sometimes all three get there');
  assert.ok(single.every((c) => (c.blockers ?? 0) <= 1), 'one up is one');
  assert.ok(single.every((c) => c.lateMiddle !== true), 'no middle to be late with one up');
  for (const c of triple) assert.equal(c.blockFocus, c.misread === true ? 'cross' : 'line');
  for (const c of single) assert.equal(c.blockFocus, c.misread === true ? 'line' : 'cross');
  // However good the plan, it goes wrong now and then.
  assert.ok(triple.some((c) => c.misread === true), 'a block reads it wrong sometimes');
  assert.ok(triple.some((c) => c.lateMiddle === true), 'a middle is late sometimes');
});
