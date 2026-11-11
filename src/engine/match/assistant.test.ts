import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { MatchFormat, MatchSimulator, type MatchResult } from './engine.ts';
import { BlockAssignment, ServeStrategy, ServeTarget, type TeamTactics } from './tactics.ts';
import { diagnose, emptyStats, mergeStats, opponentCounter, playStats, type DiagnosisContext } from './assistant.ts';
import { Position } from '../model/positions.ts';

const world = generateWorld({ seed: 12, startYear: 2026, scale: 'small', manager: stubManager() });
const strength = (c: { players: number[] }): number =>
  [...c.players].sort((a, b) => world.players.currentAbility[b] - world.players.currentAbility[a]).slice(0, 7)
    .reduce((s, p) => s + world.players.currentAbility[p], 0) / 7;
// Two sides as close as can be, so neither swamps the other.
const tier1 = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => strength(a) - strength(b));
let pair = [tier1[0], tier1[1]];
for (let i = 0, gap = Infinity; i + 1 < tier1.length; i++) {
  const d = Math.abs(strength(tier1[i]) - strength(tier1[i + 1]));
  if (d < gap) { gap = d; pair = [tier1[i], tier1[i + 1]]; }
}
const [A, B] = pair;

function play(seeds: number[], away: (t: TeamTactics) => void = () => {}, home: (t: TeamTactics) => void = () => {}): MatchResult[] {
  return seeds.map((seed) => {
    const h = toTeamSetup(world.players, A);
    const a = toTeamSetup(world.players, B);
    h.tactics = structuredClone(h.tactics);
    a.tactics = structuredClone(a.tactics);
    home(h.tactics);
    away(a.tactics);
    return new MatchSimulator(world.players, { home: h, away: a, format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed }).run();
  });
}

const ctx = (over: Partial<DiagnosisContext> = {}): DiagnosisContext => ({
  positionOf: (p) => world.players.position[p] as Position, nameOf: (p) => world.players.shortName(p), eye: 1, seed: 1, live: true, ...over,
});

test('the bench reads a match out of its rallies: every rally counted once, each rotation, the serve and the attacks', () => {
  const [r] = play([1]);
  const s = playStats(r.log!, 0);
  assert.equal(s.rallies, r.log!.length);
  const rotRallies = s.rotations.reduce((n, x) => n + x.received + x.served, 0);
  assert.equal(rotRallies, s.rallies, 'each rally is a rotation receiving or serving');
  assert.ok(s.serves > 0 && s.serveErrors <= s.serves);
  assert.equal(s.serves, [...r.stats.home.players.values()].reduce((n, p) => n + p.servesTotal, 0), 'the serves the box score counts');
  const attacks = Object.values(s.attacks).reduce((n, l) => n + l.att, 0);
  assert.ok(attacks > 30, `${attacks} attacks read`);
  // Two matches added up are the sum of the two.
  const [r2] = play([2]);
  const both = mergeStats(playStats(r.log!, 0), playStats(r2.log!, 0));
  assert.equal(both.rallies, r.log!.length + r2.log!.length);
});

test('the assistant says it is too early on a few points, and holds when nothing stands out', () => {
  const [r] = play([3]);
  const early = diagnose(playStats(r.log!.slice(0, 10), 0), toTeamSetup(world.players, A).tactics, ctx());
  assert.equal(early.verdict, 'early');
  assert.equal(early.findings.length, 0);
  const full = diagnose(playStats(r.log!, 0), toTeamSetup(world.players, A).tactics, ctx());
  assert.ok(['hold', 'adjust'].includes(full.verdict));
  assert.ok(full.findings.length <= 3, 'never more than three things at once');
  for (const f of full.findings) assert.ok(f.title.length > 0 && f.detail.length > 0);
});

test('a weak passer on the other side is found, and serving at him is offered — not offered once it is the plan', () => {
  // Read the away side's passing over several matches, from the home side's point of view.
  const rs = play([4, 5, 6, 7]);
  const ours = rs.reduce((s, r) => mergeStats(s, playStats(r.log!, 0)), emptyStats());
  const theirs = rs.reduce((s, r) => mergeStats(s, playStats(r.log!, 1)), emptyStats());
  // Make one of their passers plainly weak.
  const [p] = Object.keys(theirs.passers).map(Number).sort((a, b) => theirs.passers[b].n - theirs.passers[a].n);
  theirs.passers[p] = { n: 40, q: 40 * 0.3, errors: 6 };
  const t = toTeamSetup(world.players, A).tactics;
  const d = diagnose(ours, t, ctx({ live: false }), theirs);
  const f = d.findings.find((x) => x.id === 'serve-weakest');
  assert.ok(f !== undefined && f.change !== undefined, 'serve at him');
  const changed = structuredClone(t);
  f.change.apply(changed);
  assert.ok(changed.rotations.every((r) => r.serveTarget === ServeTarget.WeakestPasser));
  const again = diagnose(ours, changed, ctx({ live: false }), theirs);
  assert.equal(again.findings.find((x) => x.id === 'serve-weakest'), undefined, 'already the plan');
});

test('serving safer is advised only for a serve that is truly wild — the engine rewards pressure', () => {
  const rs = play([8, 9]);
  const s = rs.reduce((acc, r) => mergeStats(acc, playStats(r.log!, 0)), emptyStats());
  const t = { ...toTeamSetup(world.players, A).tactics, serve: ServeStrategy.Risky };
  // An ordinary night's misses: no advice to back off.
  assert.equal(diagnose(s, t, ctx()).findings.find((f) => f.id === 'serve-down'), undefined);
  // A wild one: back off.
  const wild = { ...s, serves: 60, serveErrors: 22, aces: 1 };
  assert.ok(diagnose(wild, t, ctx()).findings.some((f) => f.id === 'serve-down'));
});

test('a poor assistant misses some of what a good one sees', () => {
  const rs = play([10, 11, 12, 13]);
  let good = 0;
  let poor = 0;
  for (let seed = 0; seed < 40; seed++) {
    for (const r of rs) {
      const s = playStats(r.log!, 0);
      const t = toTeamSetup(world.players, A).tactics;
      good += diagnose(s, t, ctx({ eye: 1, seed })).findings.length;
      poor += diagnose(s, t, ctx({ eye: 0.1, seed }), undefined).findings.length;
    }
  }
  assert.ok(good >= poor, `good ${good}, poor ${poor}`);
});

test('the other bench counters what it sees: a better coach sooner, the same change never twice', () => {
  const rs = play([14, 15, 16, 17, 18, 19]);
  const s = rs.reduce((acc, r) => mergeStats(acc, playStats(r.log!, 0)), emptyStats());
  const theirs = toTeamSetup(world.players, B).tactics;
  let goodMoves = 0;
  let poorMoves = 0;
  for (let seed = 0; seed < 60; seed++) {
    if (opponentCounter(s, theirs, 1, seed, new Set()) !== null) goodMoves++;
    if (opponentCounter(s, theirs, 0, seed, new Set()) !== null) poorMoves++;
  }
  assert.ok(goodMoves > poorMoves, `a good coach ${goodMoves}, a poor one ${poorMoves}`);
  const move = Array.from({ length: 20 }, (_, seed) => opponentCounter(s, theirs, 1, seed, new Set())).find((m) => m !== null);
  assert.ok(move !== undefined && move !== null, 'something to answer');
  assert.ok(move.message.startsWith('They'));
  for (let seed = 0; seed < 20; seed++) assert.notEqual(opponentCounter(s, theirs, 1, seed, new Set([move.id]))?.id, move.id, 'not the same twice');
});

test('calibration: the counters the other bench uses cost the side they are aimed at, over many matches', () => {
  const seeds = Array.from({ length: 24 }, (_, i) => 500 + i);
  const middleKill = (rs: MatchResult[]): number => {
    const s = rs.reduce((acc, r) => mergeStats(acc, playStats(r.log!, 0)), emptyStats());
    return s.attacks.middle.kills / Math.max(1, s.attacks.middle.att);
  };
  const passQ = (rs: MatchResult[]): number => {
    const s = rs.reduce((acc, r) => mergeStats(acc, playStats(r.log!, 0)), emptyStats());
    const all = Object.values(s.passers);
    return all.reduce((n, l) => n + l.q, 0) / Math.max(1, all.reduce((n, l) => n + l.n, 0));
  };
  const base = play(seeds);
  const committed = play(seeds, (t) => { for (const r of t.rotations) r.blockAssignment = BlockAssignment.CommitMiddle; });
  assert.ok(middleKill(committed) < middleKill(base), `committing on the quick: ${middleKill(base).toFixed(3)} → ${middleKill(committed).toFixed(3)}`);
  const served = play(seeds, (t) => { for (const r of t.rotations) r.serveTarget = ServeTarget.WeakestPasser; });
  assert.ok(passQ(served) < passQ(base), `serving the weakest passer: ${passQ(base).toFixed(3)} → ${passQ(served).toFixed(3)}`);
});
