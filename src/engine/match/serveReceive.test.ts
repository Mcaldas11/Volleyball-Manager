import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, type RallyLogEntry } from './engine.ts';
import {
  defaultReceivePlans, overheadReception, receiveFit, receivePreset, receiveSpots, usualZone, type ReceivePlans,
} from './serveReceive.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';

test('the usual receive line is worth exactly what it always was; up close helps against a float, deep against a jump serve', () => {
  const usual = defaultReceivePlans();
  assert.equal(receiveFit(usual, 'float'), 1);
  assert.equal(receiveFit(usual, 'jump'), 1);
  const with_ = (float: ReturnType<typeof receivePreset>, jump: ReturnType<typeof receivePreset>): ReceivePlans => ({ float, jump });
  const close = with_(receivePreset('close'), receivePreset('close'));
  const deep = with_(receivePreset('deep'), receivePreset('deep'));
  assert.ok(receiveFit(close, 'float') > 1, 'up close to a float: better');
  assert.ok(receiveFit(deep, 'float') < 1, 'deep to a float: it dies in front of them');
  assert.ok(receiveFit(close, 'jump') < receiveFit(deep, 'jump'), 'a jump serve is better taken deep');
  assert.ok(receiveFit(close, 'jump') < 0.95, 'up close to a jump serve costs');
  // None of it decides a match on its own: a few per cent at most.
  for (const plans of [close, deep]) for (const k of ['float', 'jump'] as const) assert.ok(Math.abs(receiveFit(plans, k) - 1) < 0.12);
});

test('a float taken overhead suits the passer with a setter\'s hands, and costs the one without', () => {
  assert.ok(overheadReception(60, 60) > 60, 'good hands: a cleaner ball');
  assert.ok(overheadReception(80, 40) < 80, 'a libero who can\'t set passes it worse overhead');
});

test('a line of two stands between the spots, three on them, four spread across them, left to right', () => {
  const l = receivePreset('normal');
  for (const n of [2, 3, 4]) {
    const spots = receiveSpots(l, n);
    assert.equal(spots.length, n);
    for (let i = 1; i < n; i++) assert.ok(spots[i].u > spots[i - 1].u, `${n}: left to right`);
    assert.ok(spots.every((s) => s.u > 0.1 && s.u < 0.9 && s.v > 0.5 && s.v < 0.7));
  }
});

test('left to himself, a server mostly serves from behind zone 1, some from 6 and a few from 5 — always the same man the same', () => {
  const zones = Array.from({ length: 400 }, (_, p) => usualZone(p));
  const share = (z: number): number => zones.filter((x) => x === z).length / zones.length;
  assert.ok(share(1) > 0.45 && share(6) > 0.15 && share(5) > 0.08, `1 ${share(1)}, 6 ${share(6)}, 5 ${share(5)}`);
  assert.equal(usualZone(17), usualZone(17));
});

/** A match between two top-flight sides, home's tactics changed by `orders`. */
function match(orders: (home: ReturnType<typeof generateWorld>['clubs'][number]) => void, rallies = 220): RallyLogEntry[] {
  const world = generateWorld({ seed: 31, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  orders(a);
  const sim = new MatchSimulator(store, {
    home: toTeamSetup(store, a), away: toTeamSetup(store, b), format: MatchFormat.BestOf5,
    importance: 0.5, neutralVenue: false, collectLog: true, seed: 5,
  });
  const log: RallyLogEntry[] = [];
  for (let i = 0; i < rallies; i++) {
    if (sim.snapshot().matchOver) break;
    const e = sim.step();
    if (e === null) break;
    log.push(e);
  }
  return log;
}

test('a server serves as he was told: every home serve a jump float when the coach says so', () => {
  const log = match((a) => {
    a.tactics = { ...a.tactics, servers: Object.fromEntries(a.players.map((p) => [p, { style: 'jumpFloat' as const }])) };
  });
  const serves = log.filter((e) => e.serveTeam === 0).map((e) => e.contacts[0]);
  assert.ok(serves.length > 30);
  assert.ok(serves.every((c) => c.detail === 'jumpFloat'), 'all jump floats');
  assert.ok(serves.every((c) => c.speed === undefined || (c.speed > 50 && c.speed < 100)), 'at a float\'s pace');
});

test('a line told to take the float overhead does so — and only against a float', () => {
  const log = match((a) => {
    a.tactics = { ...a.tactics, receive: { ...defaultReceivePlans(), float: { ...receivePreset('close'), overhead: true } } };
  }, 400);
  let floats = 0;
  let jumps = 0;
  for (const e of log) {
    if (e.serveTeam !== 1) continue;
    const pass = e.contacts.find((c) => c.kind === 'reception');
    if (pass === undefined) continue;
    const kind = e.contacts[0].detail;
    if (kind === 'float' || kind === 'jumpFloat') {
      floats++;
      assert.equal(pass.overhead, true, 'a float: overhead');
    } else {
      jumps++;
      assert.notEqual(pass.overhead, true, 'a jump serve: on the forearms');
    }
  }
  assert.ok(floats > 5, `floats received: ${floats}`);
  assert.ok(jumps > 5, `jump serves received: ${jumps}`);
});
