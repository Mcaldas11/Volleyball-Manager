import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFlag } from '../model/players.ts';
import { advanceDay, newSeasonContext, startSeason, type SeasonContext } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { appointManager, lastJobEnded } from './career.ts';
import { messageNeedsAction } from './inbox.ts';
import { MatchFormat, simulateMatch } from '../match/engine.ts';
import { Position } from '../model/positions.ts';
import {
  acceptNationalOffer, appointNationalCoach, internationalCalendar, applyForNationalJob, askForSquad, declineNationalOffer, leaveNationalJob, applyIntlResult, eligibleFor, internationalDay, internationals,
  matchImportance, nameSquad, nationalRecord, nationResults, nationSetup, nationTournaments, pickSquad, poolTable,
  secondNation, selectionScore, squadDue, squadOf,
  startNationalCareer, suggestSquad, userMatchToday, worldRanking, type Tournament,
} from './internationals.ts';
import { NATIONS } from './nations.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function start(seed: number): { world: World; ctx: SeasonContext } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  // The strongest top-flight club: the one most likely to have internationals.
  const club = world.clubs.filter((c) => c.tier === 1).sort((a, b) => b.reputation - a.reputation)[0];
  appointManager(world, club.id);
  return { world, ctx };
}

/** Run the days, the season turning over as the game turns it. */
function runTo(world: World, ctx: SeasonContext, day: number): void {
  while (world.day < day) {
    if (world.day % 365 >= 350) {
      endSeason(world, ctx);
      while (world.day % 365 >= 350) {
        world.day++;
        if (world.day % 365 === 0) world.year++;
      }
      startSeason(world, ctx);
      continue;
    }
    advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  }
}

const byKind = (world: World, kind: Tournament['kind']): Tournament[] =>
  internationals(world).tournaments.filter((t) => t.kind === kind);

test('the summer of 2026 is the continental championships, and every season ends with a Nations League', () => {
  const { world } = start(41);
  const continental = byKind(world, 'continental');
  assert.equal(continental.length, 5, 'one per confederation');
  const euro = continental.find((t) => t.confederation === 'CEV')!;
  assert.equal(euro.name, 'EuroVolley 2026');
  assert.equal(euro.teams.length, 24);
  assert.ok(euro.teams.every((n) => NATIONS[n].confederation === 'CEV'));
  const vnl = byKind(world, 'nationsLeague')[0];
  assert.equal(vnl.teams.length, 18);
  assert.ok(vnl.startDay > euro.knockoutDays[euro.knockoutDays.length - 1] + 200, 'the spring after');
});

test('a tournament plays out: pools, a bracket to a final and a bronze match, medals and an MVP — and everyone goes home', () => {
  const { world, ctx } = start(42);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  assert.equal(euro.status, 'done');
  assert.ok(euro.matches.every((m) => m.played));
  assert.equal(euro.matches.filter((m) => m.stage === 'Final').length, 1);
  assert.equal(euro.matches.filter((m) => m.bronze).length, 1);
  // The pool winners all reached the knockout rounds.
  for (const pool of euro.pools) {
    const winner = poolTable(euro, pool)[0].clubId;
    assert.ok(euro.matches.some((m) => m.round === 0 && (m.home === winner || m.away === winner)));
  }
  assert.equal(new Set(euro.placings).size, euro.teams.length, 'every nation placed once');
  assert.ok(euro.mvp >= 0);
  assert.equal(world.players.nation[euro.mvp], euro.placings[0], 'the MVP is one of the champions');
  const record = internationals(world).history.find((h) => h.name === 'EuroVolley 2026')!;
  assert.deepEqual(record.podium.slice(0, 3), euro.placings.slice(0, 3));
  const store = world.players;
  for (let i = 0; i < store.count; i++) assert.ok(!store.hasFlag(i, PlayerFlag.OnDuty), 'nobody is left away');
});

test('called-up players are away from their clubs until their team goes out, and earn caps when they play', () => {
  const { world, ctx } = start(43);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.callUpDay + 1);
  const store = world.players;
  const squads = euro.squads;
  assert.equal(squads.length, euro.teams.length);
  for (const [nation, squad] of squads) {
    assert.equal(squad.length, 14);
    for (const p of squad) {
      assert.ok(store.nation[p] === nation || store.nation2[p] === nation, 'eligible: his nation, or his second');
      assert.ok(!store.isAvailable(p), 'away on duty: not available to his club');
    }
  }
  const capsBefore = new Map(squads.flatMap(([, s]) => s).map((p) => [p, store.nationalCaps[p]]));
  runTo(world, ctx, euro.knockoutDays[0] + 1);
  // Out in the pools: home already.
  for (const n of euro.out) for (const p of squads.find(([x]) => x === n)![1]) assert.ok(!store.hasFlag(p, PlayerFlag.OnDuty));
  const capped = [...capsBefore].filter(([p, caps]) => store.nationalCaps[p] > caps);
  assert.ok(capped.length > 100, 'plenty of players earned caps');
});

test('the manager hears about his players: the call-up, each match day, and the way home', () => {
  const { world, ctx } = start(44);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  const before = world.messages.length;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  const intl = world.messages.slice(before).filter((m) => m.category === 'international');
  const ours = world.clubs[world.userClubId].players.filter((p) => euro.squads.some(([, s]) => s.includes(p)));
  if (ours.length === 0) return; // nobody called up: nothing to hear
  assert.ok(intl.some((m) => m.subject.includes('called up')));
  assert.ok(intl.some((m) => m.subject.includes('how your players got on')));
  assert.ok(intl.some((m) => /return|champion/.test(m.subject)));
  assert.ok(intl.filter((m) => m.subject.includes('how your players')).every((m) => /played|did not get on court|missed/.test(m.body)));
});

test('the FIVB cycle: a World Championship in 2027, then in 2028 the Olympic Games and, after them, the continental championships', () => {
  const { world, ctx } = start(45);
  const I = internationals(world);
  const edition = (kind: Tournament['kind'], conf: string | null, year: number) =>
    I.history.find((h) => h.kind === kind && h.confederation === conf && h.year === year)!;
  // The Nations League turns over: the last-placed down, the best-ranked outside up.
  runTo(world, ctx, 365 + 1);
  const vnl = edition('nationsLeague', null, 2027);
  const down = vnl.placings![vnl.placings!.length - 1];
  assert.equal(I.vnl?.length, 18);
  assert.ok(!I.vnl!.includes(down), `${NATIONS[down].name} relegated`);
  assert.ok(I.vnlPromoted !== undefined && I.vnl!.includes(I.vnlPromoted));

  // The World Championship: the hosts, and the top three of every 2026 continental championship.
  const worlds = byKind(world, 'worlds')[0];
  assert.equal(worlds.name, 'World Championship 2027');
  assert.equal(worlds.teams.length, 32);
  assert.ok(worlds.entry?.some(([n, why]) => n === worlds.host && why === 'Hosts'));
  for (const conf of ['CEV', 'CSV', 'NORCECA', 'AVC', 'CAVB'] as const) {
    for (const n of edition('continental', conf, 2026).podium.slice(0, 3)) {
      assert.ok(worlds.teams.includes(n), `${NATIONS[n].name}, a 2026 ${conf} medallist, is in`);
    }
  }
  assert.ok(worlds.entry?.some(([, why]) => why === 'World ranking'), 'the rest by ranking');
  assert.equal(byKind(world, 'continental').filter((t) => t.year === 2027).length, 0, 'no continental championships in a World Championship year');

  // After it, the EuroVolley 2028 qualifiers: pools of four for the places the hosts and the top eight leave.
  const qualifiers = byKind(world, 'qualifier').find((t) => t.year === 2028)!;
  assert.ok(qualifiers !== undefined, 'EuroVolley 2028 qualifiers');
  assert.equal(qualifiers.name, 'EuroVolley 2028 Qualifiers');
  assert.ok(qualifiers.startDay > Math.max(...worlds.knockoutDays), 'after the World Championship');
  assert.ok(qualifiers.pools.every((p) => p.teams.length <= 4));
  const top8 = edition('continental', 'CEV', 2026).placings!.slice(0, 8);
  assert.ok(top8.every((n) => !qualifiers.teams.includes(n)), 'the top eight go straight through');
  runTo(world, ctx, qualifiers.knockoutDays[0] + 2);
  assert.equal(qualifiers.status, 'done');
  const through = I.qualified?.['continental:CEV:2028'] ?? [];
  assert.equal(through.length, qualifiers.places);

  // 2028: the Olympic Games — the hosts and the 2026 continental champions among them — then EuroVolley.
  runTo(world, ctx, 2 * 365 + 1);
  const olympics = byKind(world, 'olympics')[0];
  assert.equal(olympics.name, 'Olympic Games 2028');
  assert.equal(olympics.teams.length, 12);
  for (const conf of ['CEV', 'CSV', 'NORCECA', 'AVC', 'CAVB'] as const) {
    const champion = edition('continental', conf, 2026).podium[0];
    assert.ok(olympics.teams.includes(champion), `${NATIONS[champion].name}, 2026 ${conf} champions, are in`);
  }
  assert.ok(olympics.entry?.some(([, why]) => why.startsWith('World Championship 2027')), 'the best of the World Championship');
  const euro = byKind(world, 'continental').find((t) => t.year === 2028 && t.confederation === 'CEV');
  assert.ok(euro !== undefined, 'EuroVolley 2028');
  assert.equal(euro.teams.length, 24);
  for (const [n] of through) assert.ok(euro.teams.includes(n), 'everyone through the qualifiers is there');
  for (const n of top8) assert.ok(euro.teams.includes(n), 'and the top eight of 2026');
  assert.ok(euro.callUpDay > Math.max(...olympics.knockoutDays), 'squads named once the Games are over');
  assert.equal(byKind(world, 'worlds').filter((t) => t.year === 2028).length, 0, 'and no World Championship');
});

test("the match-day message carries every one of his players' numbers, for the inbox to draw", () => {
  const { world, ctx } = start(44);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  const before = world.messages.length;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  const reports = world.messages.slice(before).filter((m) => m.intl?.kind === 'matchday');
  const ours = world.clubs[world.userClubId].players.filter((p) => euro.squads.some(([, s]) => s.includes(p)));
  if (ours.length === 0) return;
  assert.ok(reports.length > 0);
  for (const m of reports) {
    for (const card of m.intl!.matches!) {
      assert.equal(card.homeSets === 3 || card.awaySets === 3, true, 'a finished match');
      assert.equal(card.setScores.length, card.homeSets + card.awaySets);
      for (const l of card.players) {
        assert.ok([card.home, card.away].includes(l.nation));
        if (l.absent === undefined) {
          assert.ok(l.rating > 0, 'a rating for everyone who played');
          assert.equal(l.points, l.kills + l.aces + l.blocks);
          assert.ok(l.kills <= l.attacks && l.goodReceptions <= l.receptions);
        }
      }
    }
  }
  const home = world.messages.slice(before).find((m) => m.intl?.kind === 'homecoming');
  assert.ok(home !== undefined && home.intl!.lines!.every((l) => l.place >= -1 && l.apps >= 0));
  assert.ok(world.messages.slice(before).some((m) => m.intl?.kind === 'callup' && m.intl.callUps!.length > 0));
});

test('a few players hold a second nationality, and the first nation they play for keeps them', () => {
  const { world, ctx } = start(47);
  const store = world.players;
  let duals = 0;
  for (let i = 0; i < store.count; i++) if (secondNation(world, i) >= 0) duals++;
  assert.ok(duals > store.count * 0.01 && duals < store.count * 0.12, `${duals} of ${store.count}`);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  const I = internationals(world);
  assert.ok(I.tiedTo.size > 100, 'everyone capped is tied to his nation');
  for (const [p, n] of I.tiedTo) assert.ok(store.nation[p] === n || store.nation2[p] === n);
  // A dual national who has played is no longer on the other nation's list.
  for (const [p, n] of I.tiedTo) {
    const other = store.nation[p] === n ? secondNation(world, p) : store.nation[p];
    if (other < 0 || other === n) continue;
    assert.ok(!eligibleFor(world, other).includes(p));
  }
});

test('the call-up weighs form: a player on a hot streak takes the place of a better one in a slump', () => {
  const { world } = start(48);
  const store = world.players;
  const nation = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!.teams[0];
  const pool = eligibleFor(world, nation);
  const outsides = pool.filter((p) => store.position[p] === Position.OutsideHitter)
    .sort((a, b) => selectionScore(world, b) - selectionScore(world, a));
  const [fourth, fifth] = [outsides[3], outsides[4]];
  assert.ok(pickSquad(world, pool).includes(fourth));
  world.ratingForm.set(fourth, [4.9, 5.1, 5.0, 5.2, 4.8]);
  world.ratingForm.set(fifth, [8.6, 8.4, 8.8, 8.5, 8.7]);
  const squad = pickSquad(world, pool);
  assert.ok(squad.includes(fifth), 'in form, in the squad');
  assert.ok(!squad.includes(fourth), 'out of form, out of it');
});

test('a major has a host: in the field, and at home for every match it plays', () => {
  const { world, ctx } = start(49);
  for (const t of byKind(world, 'continental')) {
    assert.ok(t.host >= 0 && t.teams.includes(t.host));
  }
  const vnl = byKind(world, 'nationsLeague')[0];
  assert.equal(vnl.host, -1, 'the Nations League travels');
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  const hostGames = euro.matches.filter((m) => m.home === euro.host || m.away === euro.host);
  assert.ok(hostGames.length >= 3);
  assert.ok(hostGames.every((m) => m.home === euro.host));
});

test("coaching a nation: the squad is the manager's to name, the day waits for it, and his matches are his to play", () => {
  const { world, ctx } = start(50);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  const nation = euro.teams[2];
  appointNationalCoach(world, nation);
  assert.equal(world.career.nationalTeam, nation);
  assert.ok(world.messages.some((m) => m.subject === `You are the new head coach of ${NATIONS[nation].name}`));

  runTo(world, ctx, euro.callUpDay);
  assert.equal(squadDue(world), euro, 'squads are due today');
  // His fourteen: the assistant's, with the best setter left out for the next one.
  const store = world.players;
  const suggested = suggestSquad(world, nation);
  const setters = eligibleFor(world, nation).filter((p) => store.position[p] === Position.Setter && !suggested.includes(p));
  const mine = [...suggested];
  const best = mine.find((p) => store.position[p] === Position.Setter)!;
  mine[mine.indexOf(best)] = setters[0];
  assert.match(nameSquad(world, mine.slice(0, 13)) ?? '', /Pick 14/);
  assert.equal(nameSquad(world, mine), null);
  assert.equal(squadDue(world), undefined);

  advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  const squad = squadOf(euro, nation);
  assert.ok(squad.includes(setters[0]) || store.injuryDaysLeft[setters[0]] > 0, 'his pick went');
  assert.ok(!squad.includes(best), 'and the one he left out stayed home');

  // Match day: his to play — here, through the engine, as the match screen does.
  const first = euro.matches.filter((m) => m.home === nation || m.away === nation).sort((a, b) => a.day - b.day)[0];
  runTo(world, ctx, first.day);
  const today = userMatchToday(world);
  assert.ok(today !== null && today.m === first);
  const result = simulateMatch(store, {
    home: nationSetup(world, euro, first.home), away: nationSetup(world, euro, first.away),
    format: MatchFormat.BestOf5, importance: matchImportance(first), neutralVenue: first.home !== euro.host,
    collectLog: false, seed: 7,
  });
  applyIntlResult(world, euro, first, result);
  assert.ok(first.played);
  assert.equal(userMatchToday(world), null);
  const caps = new Map(squad.map((p) => [p, store.nationalCaps[p]]));
  advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  assert.equal(first.homeSets, result.homeSets, 'not played again');
  assert.ok(squad.every((p) => store.nationalCaps[p] === caps.get(p)), 'no second cap for the same match');
});

test('national jobs: always a few going, and an application is answered within a week — with an offer to accept in the inbox', () => {
  const { world, ctx } = start(51);
  const I = internationals(world);
  assert.ok(I.vacancies.length >= 3);
  world.career.reputation = 9500;
  const nation = I.vacancies[0].nation;
  const answerOn = applyForNationalJob(world, nation);
  assert.ok(answerOn !== null && answerOn - world.day >= 3 && answerOn - world.day <= 7);
  assert.equal(applyForNationalJob(world, nation), null, 'one application at a time');
  runTo(world, ctx, answerOn + 1);
  const name = NATIONS[nation].name;
  const offer = world.messages.find((m) => m.nationalOffer?.nation === nation);
  if (offer === undefined) {
    assert.ok(world.messages.some((m) => m.subject === `${name}: thank you for your application`));
    return;
  }
  assert.equal(world.career.nationalTeam, undefined, 'nothing is decided until he answers');
  assert.equal(messageNeedsAction(world, offer), true);
  assert.equal(acceptNationalOffer(world, offer.nationalOffer!.id), true);
  assert.equal(world.career.nationalTeam, nation);
  assert.equal(messageNeedsAction(world, offer), false);
});

test('federations call a manager whose name fits theirs; an offer turned down is gone', () => {
  const { world, ctx } = start(55);
  world.career.reputation = 9800;
  runTo(world, ctx, 150);
  const calls = world.messages.filter((m) => m.nationalOffer !== undefined);
  assert.ok(calls.length > 0, 'a federation has called');
  assert.ok(calls.every((m) => m.category === 'career'));
  const open = internationals(world).offers[0];
  if (open !== undefined) {
    declineNationalOffer(world, open.id);
    assert.equal(internationals(world).offers.some((o) => o.id === open.id), false);
  }
});

test("the squad is named in the federation's message: sent a week before squads are due, and needing an answer until then", () => {
  const { world, ctx } = start(56);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  const nation = euro.teams[3];
  appointNationalCoach(world, nation);
  runTo(world, ctx, euro.callUpDay - 7);
  assert.ok(!world.messages.some((m) => m.intl?.kind === 'squad'), 'not before');
  advanceDay(world, ctx, { detailedClubs: new Set([world.userClubId]) });
  const msg = world.messages.find((m) => m.intl?.kind === 'squad' && m.intl.tournamentId === euro.id);
  assert.ok(msg !== undefined);
  assert.equal(messageNeedsAction(world, msg), true);
  assert.equal(askForSquad(world)?.id, msg.id, 'sent once');
  assert.equal(nameSquad(world, suggestSquad(world, nation)), null);
  assert.equal(messageNeedsAction(world, msg), false);
});

test('a save that comes to the internationals mid-season gets the Nations League, not a summer already gone', () => {
  const { world } = start(52);
  world.internationals = undefined;
  world.day += 120;
  internationalDay(world);
  const I = internationals(world);
  assert.deepEqual(I.tournaments.map((t) => t.kind), ['nationsLeague']);
  assert.ok(I.vacancies.length >= 3);
});

test('a career can begin at a national team alone: his name from its standing, and a club calls now and then', () => {
  const world = generateWorld({ seed: 53, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const nation = worldRanking(world)[2];
  startNationalCareer(world, nation);
  assert.equal(world.userClubId, -1);
  assert.equal(world.career.nationalTeam, nation);
  assert.ok(world.career.reputation >= 3000, `${world.career.reputation}`);
  runTo(world, ctx, 250);
  assert.ok(world.messages.some((m) => m.jobOfferId !== undefined), 'a club has offered him its job');
  // Stepping down leaves him out of work — a career, not one still to begin.
  leaveNationalJob(world, false);
  assert.equal(world.career.nationalTeam, undefined);
  assert.deepEqual(world.career.nationalJobs?.map((j) => [j.nation, j.endDay]), [[nation, world.day]]);
  assert.equal(lastJobEnded(world), world.day);
});

test('club and country: the club sets his name, and the nation comes on top', () => {
  const { world } = start(54);
  const rep = world.career.reputation;
  const nation = worldRanking(world)[30];
  startNationalCareer(world, nation);
  assert.ok(world.userClubId >= 0);
  assert.equal(world.career.nationalTeam, nation);
  assert.equal(world.career.reputation, rep, "a weak nation does not lower a club coach's name");
});

test("a nation's record: its matches won and lost over a spell, the tournaments it won, and every one it played", () => {
  const { world, ctx } = start(43);
  const euro = byKind(world, 'continental').find((t) => t.confederation === 'CEV')!;
  runTo(world, ctx, euro.knockoutDays[euro.knockoutDays.length - 1] + 1);
  const champion = euro.placings[0];
  const played = euro.matches.filter((m) => m.home === champion || m.away === champion);
  const won = played.filter((m) => (m.home === champion) === (m.homeSets > m.awaySets)).length;

  const all = nationalRecord(world, champion, 0, -1);
  assert.equal(all.won, won);
  assert.equal(all.lost, played.length - won);
  assert.ok(all.titles.some((t) => t.name === 'EuroVolley 2026'));
  // A spell that ended before the final has no title in it.
  const before = nationalRecord(world, champion, 0, euro.knockoutDays[euro.knockoutDays.length - 1] - 1);
  assert.ok(!before.titles.some((t) => t.name === 'EuroVolley 2026'));

  assert.equal(nationTournaments(world, champion).find((x) => x.t.id === euro.id)?.place, 1);
  const latest = nationResults(world, champion, 3);
  assert.ok(latest.length > 0 && latest.every((r, i) => i === 0 || r.m.day <= latest[i - 1].m.day), 'newest first');
});

test('the road ahead: what is drawn this season, then what the cycle brings, in date order', () => {
  const { world } = start(46);
  const road = internationalCalendar(world, 'CEV');
  for (let i = 1; i < road.length; i++) assert.ok(road[i - 1].startDay <= road[i].startDay);
  assert.equal(road[0].name, 'EuroVolley 2026');
  assert.ok(road[0].tournament !== undefined, 'this summer is drawn');
  const names = road.map((e) => e.name);
  for (const n of ['Nations League 2027', 'World Championship 2027', 'EuroVolley 2028 Qualifiers', 'Olympic Games 2028', 'EuroVolley 2028']) {
    assert.ok(names.includes(n), `${n} on the road`);
  }
  const worlds = road.find((e) => e.name === 'World Championship 2027')!;
  assert.equal(worlds.tournament, undefined, 'not drawn until its season starts');
  assert.equal(worlds.drawDay, 365);
});
