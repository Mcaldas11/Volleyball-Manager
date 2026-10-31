import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { agentOf } from './contractTerms.ts';
import { contractDemands } from './negotiation.ts';
import { agentPitch, agentPoaching, agentProfile, honourPreContract, preContractOf } from './agents.ts';
import { squadPlan } from './squadPlanner.ts';

function career() {
  const world = generateWorld({ seed: 84, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[2];
  appointManager(world, club.id);
  club.finances.wageBudget += 2_000_000;
  return { world, club };
}

test('every agent has a personality: how hard he bargains, his cut, clauses, his reach', () => {
  const { world, club } = career();
  const p = club.players[0];
  const prof = agentProfile(world, p);
  assert.equal(prof.style, agentOf(world, p).style);
  assert.ok(prof.commission > 0 && prof.renewalCommission === prof.commission / 2);
  assert.equal(prof.wantsClauses, prof.style === 'hardball');
  assert.ok(['local', 'international'].includes(prof.network));
});

test('a hard-bargaining agent has his client ask for a release clause', () => {
  const { world, club } = career();
  const store = world.players;
  let checked = 0;
  for (let p = 0; p < store.count && checked < 20; p++) {
    if (!store.isActive(p) || store.clubId[p] < 0 || agentOf(world, p).style !== 'hardball') continue;
    if (store.currentAbility[p] / 2000 < club.reputation / 10000 - 0.15) continue;
    assert.ok(contractDemands(world, club, p, false).clauseMax != null, 'a clause asked for');
    checked++;
  }
  assert.ok(checked > 0);
});

test('an agent offers the manager a client who would fill a gap', () => {
  const { world, club } = career();
  const store = world.players;
  // No liberos next season: a gap an agent can fill.
  for (const p of club.players) if (store.position[p] === Position.Libero) store.contractUntil[p] = seasonEndDay(world.season);
  const short = new Set(squadPlan(world, club).cells.filter((row) => row[0].gaps > 0 || row[1].gaps > 0).map((row) => row[0].position));
  assert.ok(short.has(Position.Libero), 'the squad is short of a libero');
  const p = agentPitch(world);
  assert.ok(p !== null, 'someone offered');
  // A player for a position the squad is short of — the libero, or another gap it has.
  assert.ok(short.has(store.position[p!]), `a ${store.position[p!]} for a squad short of ${[...short].join(', ')}`);
  assert.notEqual(store.clubId[p!], club.id);
  const m = world.messages.at(-1)!;
  assert.match(m.subject, /^Agent offers you/);
  assert.equal(m.playerIdx, p);
  assert.equal(agentPitch(world) === p, false, 'not the same man twice running');
});

test('an agent lines up a summer move for an unrenewed player — who goes there at the season\'s end, unless renewed', () => {
  const { world, club } = career();
  const store = world.players;
  const ours = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth) && store.ageOn(p, world.year, 181) < 30);
  for (const p of ours) store.contractUntil[p] = seasonEndDay(world.season);
  world.day = world.season * 365 + 215;
  const taken = agentPoaching(world);
  assert.ok(taken.length > 0, 'at least one agent at work');
  const [p, q] = taken;
  const pre = preContractOf(world, p)!;
  assert.ok(pre !== undefined && pre.clubId !== club.id);
  assert.ok(world.messages.some((m) => m.playerIdx === p && /signs for them/.test(m.body)));
  // Unrenewed, he goes to the club the agent found.
  assert.equal(honourPreContract(world, p), true);
  assert.equal(store.clubId[p], pre.clubId);
  assert.ok(!club.players.includes(p));
  // Renewed, the move falls through.
  if (q !== undefined) {
    store.contractUntil[q] = seasonEndDay(world.season + 2);
    assert.equal(preContractOf(world, q), undefined);
  }
});
