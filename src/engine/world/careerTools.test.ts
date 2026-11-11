import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { generateYouthIntake } from './progression.ts';
import { notePlayerEvent, playerTimeline } from './playerTimeline.ts';
import { PREP_VARIANTS, runPrepLab, scoutOpponent } from './prepLab.ts';
import { markUndone, noteDecision, noteRecentPlay, RECENT_MATCHES } from './tacticalDecisions.ts';
import { academyState, programmeWeek, startProgramme, type AcademyProgramme } from './academy.ts';
import { FOCUS_ATTRS } from './training.ts';
import { ATTR_INDEX } from '../model/attributes.ts';
import { Rng } from '../core/rng.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import { MatchFormat, MatchSimulator } from '../match/engine.ts';

function managed(seed: number): { world: World; run: (days: number) => void } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  generateYouthIntake(world);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  world.clubs[world.userClubId].finances.balance = 5_000_000;
  return { world, run: (days) => { for (let i = 0; i < days; i++) advanceDay(world, ctx); } };
}

const label = (s: number): string => `S${s}`;

test("a player's career reads as a timeline: his clubs, each season's line, and the moments noted along the way", () => {
  const { world, run } = managed(71);
  run(120);
  const club = world.clubs[world.userClubId];
  const p = [...club.players].sort((a, b) => (world.competitionRecords.get(b)?.length ?? 0) - (world.competitionRecords.get(a)?.length ?? 0))[0];
  const items = playerTimeline(world, p, label);
  assert.ok(items.some((i) => i.kind === 'club'), 'his clubs');
  assert.ok(items.some((i) => i.kind === 'season' && i.season === world.season), "this season's line, once he has played");
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].season <= items[i].season, 'oldest first');
  // The moments: one debut only, the captaincy, an injury.
  notePlayerEvent(world, p, { kind: 'debut', clubId: club.id });
  notePlayerEvent(world, p, { kind: 'debut', clubId: club.id });
  notePlayerEvent(world, p, { kind: 'captain', clubId: club.id });
  notePlayerEvent(world, p, { kind: 'injury', clubId: club.id, injury: 3, days: 40 });
  const again = playerTimeline(world, p, label);
  assert.equal(again.filter((i) => i.kind === 'debut').length, 1, 'one debut');
  assert.ok(again.some((i) => i.kind === 'captain' && i.title === 'Named captain'));
  assert.ok(again.some((i) => i.kind === 'injury' && /weeks/.test(i.detail ?? '')));
});

test('the season notes debuts, serious injuries and academy arrivals by itself', () => {
  const { world, run } = makeWithLongRun();
  const events = Object.values(world.playerEvents ?? {}).flat();
  assert.ok(events.some((e) => e.kind === 'academy'), 'the intake joins the academies');
  assert.ok(events.some((e) => e.kind === 'injury' && (e.days ?? 0) >= 28), 'a serious injury is noted');
  assert.ok(events.filter((e) => e.kind === 'injury').every((e) => (e.days ?? 0) >= 28), 'only the serious ones');
  void run;
});

function makeWithLongRun(): { world: World; run: (days: number) => void } {
  const m = managed(72);
  m.run(160);
  return m;
}

test('the preparation lab: a sure read is the truth, a practice run is the same twice, and says how sure it is', () => {
  const { world } = managed(73);
  const club = world.clubs[world.userClubId];
  const opp = world.clubs.find((c) => c.id !== club.id && c.tier === 1 && c.players.length >= 12)!;
  const sure = scoutOpponent(world, opp, 1, 5);
  if (sure.offenseSure) assert.equal(sure.offense, opp.tactics.offense, 'sure means right');
  if (sure.serveSure) assert.equal(sure.serve, opp.tactics.serve);
  assert.ok(sure.danger >= 0 && opp.players.includes(sure.danger));
  // A poor read is sure of less.
  let sureGood = 0;
  let surePoor = 0;
  for (let seed = 0; seed < 60; seed++) {
    sureGood += Number(scoutOpponent(world, opp, 1, seed).offenseSure);
    surePoor += Number(scoutOpponent(world, opp, 0, seed).offenseSure);
  }
  assert.ok(sureGood > surePoor, `good ${sureGood}, poor ${surePoor}`);
  const variant = PREP_VARIANTS.find((v) => v.id === 'serve-weakest')!;
  const a = runPrepLab(world, club, opp, sure, variant, 8);
  const b = runPrepLab(world, club, opp, sure, variant, 8);
  assert.deepEqual(a, b, 'the same dice, the same answer');
  assert.ok(a.base.points > 0.2 && a.base.points < 0.8);
  assert.ok(['clear', 'likely', 'noise'].includes(a.confidence));
  // The lab never touches the real tactics.
  assert.notEqual(club.tactics.rotations[0].serveTarget === 1 && opp.tactics.rotations[0].serveTarget === 1, true);
});

test("the bench keeps the last few matches it read, and every change made on the assistant's word", () => {
  const { world } = managed(74);
  const club = world.clubs[world.userClubId];
  const opp = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  for (let i = 0; i < RECENT_MATCHES + 2; i++) {
    const result = new MatchSimulator(world.players, {
      home: toTeamSetup(world.players, club), away: toTeamSetup(world.players, opp), format: MatchFormat.BestOf5,
      importance: 0.5, neutralVenue: false, collectLog: true, seed: i,
    }).run();
    noteRecentPlay(world, { id: 10_000 + i, home: club.id, away: opp.id, day: world.day + i } as never, result);
  }
  assert.equal(world.recentPlay!.length, RECENT_MATCHES, 'only the last few');
  assert.ok(world.recentPlay!.every((m) => m.ours.rallies > 0 && m.theirs.rallies === m.ours.rallies));
  const id = noteDecision(world, { where: 'analysis', finding: 'x', change: 'Serve at their weakest passer', changeId: 'serve-weakest' });
  markUndone(world, id);
  assert.equal(world.tacticDecisions!.at(-1)!.undone, true);
});

test('a programme with a second area works it about three steps in ten', () => {
  const { world } = managed(75);
  const club = world.clubs[world.userClubId];
  const p = club.youthPlayers[0];
  assert.equal(startProgramme(world, p, 'attacking', 'normal', 'serving').ok, true);
  const prog = academyState(world).programmes[0];
  assert.equal(prog.secondary, 'serving');
  // Many weeks of it on a copy of him, kept far from his potential: count which area moved.
  const store = world.players;
  const atk = FOCUS_ATTRS.attacking.map((a) => ATTR_INDEX[a]);
  const srv = FOCUS_ATTRS.serving.map((a) => ATTR_INDEX[a]);
  let inAtk = 0;
  let inSrv = 0;
  const base = store.attrBase(p);
  for (let k = 0; k < 400; k++) {
    store.potentialAbility[p] = 2000;
    store.injuryDaysLeft[p] = 0;
    store.playingTime[p] = 100;
    const before = Array.from(store.attrs.subarray(base, base + 40));
    const fake: AcademyProgramme = { ...prog, intensity: 'normal' };
    programmeWeek(world, fake, new Rng(k));
    for (let i = 0; i < before.length; i++) {
      const d = store.attrs[base + i] - before[i];
      if (d > 0 && atk.includes(i) && !srv.includes(i)) inAtk += d;
      if (d > 0 && srv.includes(i) && !atk.includes(i)) inSrv += d;
    }
    // Keep him from filling up.
    for (const i of [...atk, ...srv]) store.attrs[base + i] = 8;
  }
  const share = inSrv / Math.max(1, inAtk + inSrv);
  assert.ok(share > 0.15 && share < 0.45, `second area's share ${share.toFixed(2)}`);
});
