import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch } from '../match/engine.ts';
import { PlayerFlag } from '../model/players.ts';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import {
  appointNationalCoach, applyIntlResult, eligibleFor, internationals, matchImportance, nameSquad, nationalTeamOf, nationName,
  nationalOfferTerms, nationSetup, offerNationalJob, squadDue, squadOf, suggestSquad, userMatchToday, userNation, type Tournament,
} from './internationals.ts';
import { toggleFrame } from './nationalExtras.ts';
import { baseNation, sideAge, youthSide } from './sides.ts';
import {
  clubYouthInternationals, recommendToYouthSide, recommendedFor, toggleSendDown, youthCapsOf, youthScore, youthSideFor,
} from './youthNational.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function start(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1).sort((a, b) => b.reputation - a.reputation)[0];
  appointManager(world, club.id);
  return { world, ctx };
}

function runTo(world: World, ctx: SeasonContext, day: number): void {
  while (world.day < day) advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
}

const youthOf = (world: World, age: 21 | 19): Tournament[] =>
  internationals(world).tournaments.filter((t) => t.youth === age);

test('every nation has U21 and U19 sides, and the summer of 2026 brings the U19 Worlds and the U21 continentals', () => {
  const { world } = start(71);
  const I = internationals(world);
  assert.equal(I.youthTeams?.length, world.nationalTeams.length * 2, 'two youth sides a nation');
  const n = world.nationalTeams[0].nation;
  assert.equal(nationName(youthSide(n, 21)), `${nationName(n)} U21`);
  assert.equal(baseNation(youthSide(n, 19)), n);
  assert.ok(nationalTeamOf(world, youthSide(n, 19)) !== undefined);

  const u19 = youthOf(world, 19);
  const u21 = youthOf(world, 21);
  assert.equal(u19.length, 1, 'one U19 tournament');
  assert.equal(u19[0].kind, 'worlds');
  assert.match(u19[0].name, /^U19 World Championship 2026$/);
  assert.ok(u21.length >= 1 && u21.every((t) => t.kind === 'continental'), 'the U21s play their continental championships');
  for (const t of [...u19, ...u21]) {
    assert.ok(t.teams.every((s) => sideAge(s) === t.youth), 'youth sides only');
    // Late July and mid-August: before the clubs' season, and apart from the senior majors' first matches.
    const senior = internationals(world).tournaments.filter((x) => x.youth === undefined && x.kind !== 'nationsLeague');
    assert.ok(senior.every((x) => x.startDay !== t.startDay));
  }
  // The seniors' own calendar is as it was: five continental championships, one Nations League.
  assert.equal(I.tournaments.filter((t) => t.youth === undefined && t.kind === 'continental').length, 5);
});

test('a youth squad is drawn by age — academy players too — and its caps are youth caps', () => {
  const { world, ctx } = start(72);
  const t = youthOf(world, 19)[0];
  const store = world.players;
  const seniorCaps = new Map<number, number>();
  for (let p = 0; p < store.count; p++) if (store.isActive(p)) seniorCaps.set(p, store.nationalCaps[p]);
  runTo(world, ctx, t.callUpDay + 1);
  assert.equal(t.status, 'called');
  let academy = 0;
  for (const [side, squad] of t.squads) {
    assert.ok(squad.length >= 12 && squad.length <= 14, `${nationName(side)} named ${squad.length}`);
    for (const p of squad) {
      assert.ok(store.ageOn(p, world.year, 181) <= 19, `${store.fullName(p)} is too old for the U19s`);
      assert.ok(store.nation[p] === baseNation(side) || store.nation2[p] === baseNation(side));
      assert.ok(store.hasFlag(p, PlayerFlag.OnDuty), 'away with the U19s');
      if (store.hasFlag(p, PlayerFlag.Youth)) academy++;
    }
  }
  assert.ok(academy > 0, 'academy players are called up');
  // The pools are played: youth caps up, senior caps untouched, nobody tied by a youth cap.
  runTo(world, ctx, t.startDay + 2);
  const played = t.matches.filter((m) => m.played);
  assert.ok(played.length > 0);
  const capped = t.squads.flatMap(([, s]) => s).filter((p) => youthCapsOf(world, p).u19 > 0);
  assert.ok(capped.length > 0, 'youth caps counted');
  for (const p of capped) {
    assert.equal(store.nationalCaps[p], seniorCaps.get(p), 'a youth cap is not a senior cap');
    assert.equal(youthCapsOf(world, p).u21, 0);
  }
});

test('the seniors keep their young players unless the senior coach sends one down', () => {
  const { world, ctx } = start(73);
  const t = youthOf(world, 21)[0];
  const side = t.teams[0];
  const nation = baseNation(side);
  appointNationalCoach(world, nation);
  const store = world.players;
  // The two best under-21s: one in the senior frame, one sent down from it.
  const young = eligibleFor(world, side).sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const kept = young[0];
  const sent = young[1];
  toggleFrame(world, kept);
  toggleFrame(world, sent);
  assert.ok(!eligibleFor(world, side).includes(kept), 'in the frame: not the U21s\' to call');
  assert.match(toggleSendDown(world, sent, 21), /goes down to/);
  assert.ok(eligibleFor(world, side).includes(sent));
  assert.ok(!internationals(world).frame!.players.includes(sent), 'out of the provisional squad');
  assert.ok(suggestSquad(world, side).includes(sent), 'the U21 coach takes him');
  runTo(world, ctx, t.callUpDay + 1);
  const squad = squadOf(t, side);
  assert.ok(!squad.includes(kept), 'the seniors kept theirs');
  assert.ok(squad.includes(sent) || store.injuryDaysLeft[sent] > 0, 'and the one sent down went');
  assert.equal(internationals(world).sentDown?.[side], undefined, 'gone with his side: the seniors may call him again');
});

test('coaching a U21 side: the job, the squad, the call-up day and the match are the manager\'s', () => {
  const { world, ctx } = start(74);
  const t = youthOf(world, 21)[0];
  const side = t.teams[1];
  appointNationalCoach(world, side);
  assert.equal(userNation(world), side);
  assert.ok(nationalTeamOf(world, side)!.managedByUser);
  assert.ok(world.messages.some((m) => m.subject === `You are the new head coach of ${nationName(side)}`));
  // Alongside his club.
  assert.ok(world.userClubId >= 0);

  runTo(world, ctx, t.callUpDay);
  assert.equal(squadDue(world), t, 'his squad is due');
  const mine = suggestSquad(world, side);
  assert.ok(mine.every((p) => world.players.ageOn(p, world.year, 181) <= 21));
  assert.equal(nameSquad(world, mine), null);
  advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  assert.ok(squadOf(t, side).filter((p) => mine.includes(p)).length >= 12, 'his fourteen went');

  const first = t.matches.filter((m) => m.home === side || m.away === side).sort((a, b) => a.day - b.day)[0];
  runTo(world, ctx, first.day);
  const today = userMatchToday(world);
  assert.ok(today !== null && today.m === first, 'his match to play');
  const result = simulateMatch(world.players, {
    home: nationSetup(world, t, first.home), away: nationSetup(world, t, first.away),
    format: MatchFormat.BestOf5, importance: matchImportance(first), neutralVenue: first.home !== t.host,
    collectLog: false, seed: 9,
  });
  applyIntlResult(world, t, first, result);
  assert.ok(first.played);
  assert.equal(userMatchToday(world), null);
  assert.ok(squadOf(t, side).some((p) => youthCapsOf(world, p).u21 > 0));
});

test('youth jobs are advertised, and pay less than the seniors\'', () => {
  const { world } = start(75);
  const I = internationals(world);
  const youthJobs = I.vacancies.filter((v) => sideAge(v.nation) > 0);
  assert.ok(youthJobs.length >= 2, 'youth sides looking for a coach');
  assert.ok(I.vacancies.filter((v) => sideAge(v.nation) === 0).length >= 3, 'and the senior jobs as before');
  // A nation's youth side offers less than its seniors.
  const y = youthJobs[0].nation;
  const youthWage = nationalOfferTerms(world, offerNationalJob(world, y, false)).wage;
  const seniorWage = nationalOfferTerms(world, offerNationalJob(world, baseNation(y), false)).wage;
  assert.ok(youthWage < seniorWage, `${youthWage} < ${seniorWage}`);
});

test('the academy: a prospect put forward counts with the youth coach, and the club sees where each stands', () => {
  const { world } = start(76);
  const store = world.players;
  const club = world.clubs[world.userClubId];
  const young = [...club.youthPlayers, ...club.players].filter((p) => youthSideFor(world, p) >= 0);
  assert.ok(young.length > 0);
  const p = young[0];
  const side = youthSideFor(world, p);
  const before = youthScore(world, p, side);
  const r = recommendToYouthSide(world, p);
  assert.ok(r.ok, r.text);
  assert.ok(recommendedFor(world, side).includes(p));
  assert.ok(youthScore(world, p, side) > before, 'a word in the coach\'s ear');
  assert.equal(recommendToYouthSide(world, p).ok, false, 'once a season');
  const lines = clubYouthInternationals(world, young);
  const line = lines.find((l) => l.p === p)!;
  assert.equal(line.side, side);
  assert.ok(line.recommended);
  assert.ok(lines.every((l) => store.ageOn(l.p, world.year, 181) <= 21));
});
