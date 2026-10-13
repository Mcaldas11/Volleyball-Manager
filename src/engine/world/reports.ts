/**
 * The reports the staff send in, on their own schedule.
 *
 * For the national team: every fortnight of the club season, how the squad
 * is getting on at their clubs — games, ratings, points, who is hurt — and
 * who is knocking on the door; and each month, where the side stands in the
 * world ranking. A manager with only a country to coach still hears about
 * his players every couple of weeks.
 *
 * For the club: the assistant's weekly report — who is in form, who isn't,
 * who is tired, low or hurt — and, two days before every competitive match,
 * the scouts' report on the opposition: their form, their table position,
 * how they play and who to watch.
 *
 * Each comes as a message with its tables, which the inbox lays out.
 */

import { fixturesAhead, loadOf, tripTo } from './fatigue.ts';
import { fixtureRivalry, rivalryName } from './rivals.ts';
import { compareTableRows, type Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { POSITION_SHORT, type Position } from '../model/positions.ts';
import { StaffRole } from '../model/staff.ts';
import { OffensiveSystem, ServeStrategy, Tempo } from '../match/tactics.ts';
import { MONTH_STARTS, postMessage } from './inbox.ts';
import { worldRanking } from './internationals.ts';
import { NATIONS } from './nations.ts';
import { currentPhase, dayOfSeason, inboxPrefsOf, SeasonPhase, type ReportTable, type World } from './world.ts';

/** A player's recent match ratings, the latest last: the last `n`. */
function recent(world: World, p: number, n: number): number[] {
  return (world.ratingForm.get(p) ?? []).slice(-n);
}

function avg(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** His season for his club so far: matches, average rating, points — the national team's games left out. */
function clubSeason(world: World, p: number): { apps: number; avg: number; points: number } {
  let apps = 0;
  let sum = 0;
  let points = 0;
  for (const line of world.competitionRecords.get(p) ?? []) {
    if (line.season !== world.season || world.competitions[line.competitionId]?.kind === 'international') continue;
    apps += line.apps;
    sum += line.ratingSum;
    points += line.points;
  }
  return { apps, avg: apps > 0 ? sum / apps : 0, points };
}

/** Someone on the staff of a club, by role, by name — or the role itself. */
function staffName(world: World, clubId: number, roles: readonly StaffRole[], fallback: string): string {
  for (const role of roles) {
    const s = world.staff.find((x) => x.clubId === clubId && x.role === role);
    if (s !== undefined) return `${s.firstName} ${s.lastName}`;
  }
  return fallback;
}

const shortClub = (world: World, id: number): string => world.clubs[id]?.shortName ?? 'Free agent';
const pos = (world: World, p: number): string => POSITION_SHORT[world.players.position[p] as Position] ?? '';
const fixed1 = (v: number): string => (v > 0 ? v.toFixed(1) : '—');

// ---- The national team ------------------------------------------------------------------

/** Days between the national team's club form reports: weekly with only a country to coach, fortnightly with a club as well. */
const FORM_REPORT_DAYS = 14;

/** The club season: when there is club form to report on. */
function clubSeasonOn(world: World): boolean {
  const phase = currentPhase(world);
  return phase === SeasonPhase.RegularSeason || phase === SeasonPhase.Playoffs;
}

/** The national squad as it stands — or, before one is named, the country's best. */
function nationalPool(world: World, nation: number): number[] {
  const team = world.nationalTeams.find((t) => t.nation === nation);
  if (team !== undefined && team.squad.length > 0) return team.squad.filter((p) => world.players.isActive(p));
  const store = world.players;
  const pool: number[] = [];
  for (let p = 0; p < store.count; p++) {
    if (store.isActive(p) && store.nation[p] === nation && !store.hasFlag(p, PlayerFlag.Youth)) pool.push(p);
  }
  return pool.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 14);
}

/** Every fortnight of the club season: the national squad at their clubs, and who is knocking on the door. */
export function nationalFormReport(world: World): void {
  const nation = world.career.nationalTeam;
  const pref = inboxPrefsOf(world).nationalForm;
  if (pref === 'off') return;
  const every = pref === 'weekly' ? 7 : pref === 'fortnightly' ? FORM_REPORT_DAYS : world.userClubId >= 0 ? FORM_REPORT_DAYS : 7;
  if (nation === undefined || nation < 0 || !clubSeasonOn(world) || world.day % every !== 3) return;
  const store = world.players;
  const squad = nationalPool(world, nation);
  if (squad.length === 0) return;
  const inSquad = new Set(squad);
  const rows: ReportTable['rows'] = squad.map((p): ReportTable['rows'][number] => {
    const s = clubSeason(world, p);
    const form = avg(recent(world, p, 5));
    const hurt = store.injuryDaysLeft[p];
    return {
      p, clubId: store.clubId[p],
      cells: [store.fullName(p), shortClub(world, store.clubId[p]), pos(world, p), s.apps, fixed1(s.avg), fixed1(form), s.points,
        hurt > 0 ? `Injured · ${Math.ceil(hurt / 7)} wk` : 'Fit'],
      tone: hurt > 0 || (form > 0 && form < 5.9) ? 'bad' : form >= 7 ? 'good' : undefined,
    };
  }).sort((a, b) => Number(b.cells[5]) - Number(a.cells[5]) || 0);

  // Knocking on the door: the country's players in form who aren't in the squad.
  const knocking: number[] = [];
  for (let p = 0; p < store.count; p++) {
    if (!store.isActive(p) || inSquad.has(p) || (store.nation[p] !== nation && store.nation2[p] !== nation)) continue;
    if (store.hasFlag(p, PlayerFlag.Youth) || recent(world, p, 5).length < 3) continue;
    knocking.push(p);
  }
  knocking.sort((a, b) => avg(recent(world, b, 5)) - avg(recent(world, a, 5)));
  const door = knocking.slice(0, 5).filter((p) => avg(recent(world, p, 5)) >= 6.6);

  const inForm = rows.filter((r) => r.tone === 'good').map((r) => store.shortName(r.p!));
  const hurt = squad.filter((p) => store.injuryDaysLeft[p] > 0).map((p) => store.shortName(p));
  const name = NATIONS[nation]?.name ?? 'The national team';
  const lines = [
    `How ${name}'s players are getting on at their clubs.`,
    inForm.length > 0 ? `In form: ${inForm.slice(0, 3).join(', ')}.` : 'Nobody is setting the world alight just now.',
    hurt.length > 0 ? `Injured: ${hurt.join(', ')} — keep an eye on their recovery.` : 'No injuries in the squad.',
    door.length > 0 ? `Pushing for a place: ${door.map((p) => store.shortName(p)).join(', ')}.` : '',
  ].filter((l) => l !== '');
  postMessage(world, {
    category: 'international', from: 'National Team Scout',
    subject: `Club form: ${name}'s players`,
    body: lines.join(' '),
    tables: [
      {
        label: 'The squad at their clubs', columns: ['Player', 'Club', 'Pos', 'Apps', 'Avg', 'Last 5', 'Pts', 'Status'],
        rows,
      },
      ...(door.length > 0 ? [{
        label: 'Knocking on the door', columns: ['Player', 'Club', 'Pos', 'Apps', 'Avg', 'Last 5', 'Pts'],
        rows: door.map((p) => {
          const s = clubSeason(world, p);
          return {
            p, clubId: store.clubId[p], tone: 'good' as const,
            cells: [store.fullName(p), shortClub(world, store.clubId[p]), pos(world, p), s.apps, fixed1(s.avg), fixed1(avg(recent(world, p, 5))), s.points],
          };
        }),
      }] : []),
    ],
  });
}

/**
 * The national squad's injuries at their clubs, as they happen: who is out
 * and for how long — and when he is fit again. Daily; only the squad.
 */
export function nationalInjuryNews(world: World): void {
  const nation = world.career.nationalTeam;
  if (nation === undefined || nation < 0 || !inboxPrefsOf(world).nationalInjuries) return;
  const team = world.nationalTeams.find((t) => t.nation === nation);
  if (team === undefined) return;
  const store = world.players;
  const seen = (world.intlInjuries ??= {});
  const name = NATIONS[nation]?.name ?? 'the national team';
  for (const p of team.squad) {
    const out = store.injuryDaysLeft[p];
    if (out > 0 && seen[p] === undefined) {
      seen[p] = world.day;
      const weeks = Math.ceil(out / 7);
      postMessage(world, {
        category: 'international', from: 'National Team Doctor', playerIdx: p,
        subject: `${store.fullName(p)} injured at ${shortClub(world, store.clubId[p])}`,
        body: `${store.fullName(p)} has been hurt playing for ${world.clubs[store.clubId[p]]?.name ?? 'his club'} and will be out for ` +
          `about ${weeks} week${weeks === 1 ? '' : 's'}. ${weeks >= 6 ? `He is a doubt for ${name}'s next games.` : 'He should be back well before he is needed.'}`,
      });
    } else if (out === 0 && seen[p] !== undefined) {
      delete seen[p];
      postMessage(world, {
        category: 'international', from: 'National Team Doctor', playerIdx: p,
        subject: `${store.fullName(p)} fit again`,
        body: `${store.fullName(p)} is back in training at ${world.clubs[store.clubId[p]]?.name ?? 'his club'} and available for selection.`,
      });
    }
  }
}

/** On the first of each month: where the national side stands in the world. */
export function rankingReport(world: World): void {
  const nation = world.career.nationalTeam;
  if (nation === undefined || nation < 0 || !MONTH_STARTS.includes(dayOfSeason(world)) || !inboxPrefsOf(world).ranking) return;
  const order = worldRanking(world);
  const rank = order.indexOf(nation) + 1;
  if (rank <= 0) return;
  const last = (world.lastRanks ??= {})[nation];
  world.lastRanks[nation] = rank;
  const move = last === undefined || last === rank ? 'unchanged' : last > rank ? `up ${last - rank}` : `down ${rank - last}`;
  const name = NATIONS[nation]?.name ?? 'The national team';
  const show = new Set([...order.slice(0, 8), ...order.slice(Math.max(0, rank - 3), rank + 2)]);
  postMessage(world, {
    category: 'international', from: 'FIVB',
    subject: `World ranking: ${name} ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}`,
    body: `${name} are ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} in the world ranking — ${move} on last month.`,
    tables: [{
      label: 'World ranking', columns: ['#', 'Nation', 'Points'],
      rows: order.map((n, i) => ({ n, i })).filter(({ n }) => show.has(n)).map(({ n, i }) => ({
        cells: [i + 1, NATIONS[n]?.name ?? '?', Math.round(world.nationalTeams.find((t) => t.nation === n)?.rankingPoints ?? 0)],
        tone: n === nation ? 'good' as const : undefined,
      })),
    }],
  });
}

// ---- The club ---------------------------------------------------------------------------

/** Every Monday of the season: the assistant's word on the squad. */
export function assistantReport(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const phase = currentPhase(world);
  const pref = inboxPrefsOf(world).assistant;
  if (club === undefined || pref === 'off' || world.day % (pref === 'fortnightly' ? 14 : 7) !== 1) return;
  if (phase === SeasonPhase.OffSeason || phase === SeasonPhase.NationalTeam) return;
  const store = world.players;
  const senior = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
  const rated = senior.filter((p) => recent(world, p, 3).length >= 2);
  const byForm = [...rated].sort((a, b) => avg(recent(world, b, 3)) - avg(recent(world, a, 3)));
  const hot = byForm.slice(0, 3).filter((p) => avg(recent(world, p, 3)) >= 6.6);
  const cold = byForm.slice(-3).reverse().filter((p) => avg(recent(world, p, 3)) < 6.1 && !hot.includes(p));
  const worries: ReportTable['rows'] = [];
  for (const p of senior) {
    const why: string[] = [];
    if (store.injuryDaysLeft[p] > 0) why.push(`injured, ${Math.ceil(store.injuryDaysLeft[p] / 7)} wk`);
    else if (store.condition[p] < 72) why.push(`tired (${store.condition[p]}%)`);
    else if (loadOf(world, p) >= 2.2) why.push('heavy legs: a lot of matches lately');
    if (store.morale[p] < 35) why.push('low morale');
    if (world.transferRequests?.[p]?.status === 'open') why.push('wants to leave');
    if (why.length > 0) worries.push({ p, cells: [store.fullName(p), pos(world, p), why.join(' · ')], tone: 'bad' });
  }
  const next = world.fixtures
    .filter((f) => !f.played && f.day >= world.day && (f.home === club.id || f.away === club.id))
    .sort((a, b) => a.day - b.day)[0];
  const opp = next !== undefined ? world.clubs[next.home === club.id ? next.away : next.home] : undefined;
  const tired = senior.filter((p) => store.injuryDaysLeft[p] === 0 && store.condition[p] < 72);
  // A crowded run ahead: rotate, or run out of legs.
  const ahead = fixturesAhead(world, club.id, 8);
  const abroad = ahead.filter((f) => tripTo(world, f, club.id) === 'abroad').length;
  const busy = ahead.length >= 3
    ? `A busy run: ${ahead.length} matches in the next eight days${abroad > 0 ? `, ${abroad === 1 ? 'one' : abroad} of them abroad` : ''}. ` +
      'We will have to rotate, or we will run out of legs.'
    : '';
  const lines = [
    busy,
    hot.length > 0 ? `${store.shortName(hot[0])} is flying — ${fixed1(avg(recent(world, hot[0], 3)))} on average in his last games.` : 'Nobody has really stood out this week.',
    cold.length > 0 ? `${store.shortName(cold[0])} is struggling; a rest or a word might help.` : '',
    tired.length > 0 && next !== undefined && next.day - world.day <= 3
      ? `With ${opp?.name ?? 'the next match'} in ${next.day - world.day} day${next.day - world.day === 1 ? '' : 's'}, I'd think about resting ${tired.slice(0, 2).map((p) => store.shortName(p)).join(' and ')}.`
      : next !== undefined && opp !== undefined ? `Next up: ${opp.name}, in ${next.day - world.day} day${next.day - world.day === 1 ? '' : 's'}.` : '',
  ].filter((l) => l !== '');
  const formRow = (p: number, tone: 'good' | 'bad'): ReportTable['rows'][number] => ({
    p, tone, cells: [store.fullName(p), pos(world, p), recent(world, p, 3).map((r) => r.toFixed(1)).join('  '), fixed1(avg(recent(world, p, 3)))],
  });
  const tables: ReportTable[] = [];
  if (hot.length > 0) tables.push({ label: 'In form', columns: ['Player', 'Pos', 'Last games', 'Avg'], rows: hot.map((p) => formRow(p, 'good')) });
  if (cold.length > 0) tables.push({ label: 'Out of form', columns: ['Player', 'Pos', 'Last games', 'Avg'], rows: cold.map((p) => formRow(p, 'bad')) });
  if (worries.length > 0) tables.push({ label: 'To keep an eye on', columns: ['Player', 'Pos', 'Why'], rows: worries.slice(0, 6) });
  postMessage(world, {
    category: 'staff', from: staffName(world, club.id, [StaffRole.AssistantCoach], 'Assistant Coach'),
    subject: 'Assistant\'s report: the squad this week',
    body: lines.join(' '),
    tables,
  });
}

const OFFENCE_WORDS: Readonly<Record<OffensiveSystem, string>> = {
  [OffensiveSystem.Fast]: 'a fast offence, built on the quick',
  [OffensiveSystem.Balanced]: 'a balanced offence',
  [OffensiveSystem.OutsideFocused]: 'an offence built around their outside hitters',
  [OffensiveSystem.OppositeFocused]: 'an offence built around their opposite',
  [OffensiveSystem.MiddleFocused]: 'a middle-heavy offence',
  [OffensiveSystem.PipeHeavy]: 'plenty of pipe attacks',
  [OffensiveSystem.BackRowHeavy]: 'plenty of back-row attacks',
};
const TEMPO_WORDS: Readonly<Record<Tempo, string>> = {
  [Tempo.VeryFast]: 'at a very fast tempo', [Tempo.Fast]: 'at a fast tempo', [Tempo.Balanced]: 'at a normal tempo', [Tempo.Slow]: 'with slow, high sets',
};
const SERVE_WORDS: Readonly<Record<ServeStrategy, string>> = {
  [ServeStrategy.Risky]: 'They serve aggressively — expect aces, and errors.',
  [ServeStrategy.Balanced]: 'They mix their serves.',
  [ServeStrategy.Conservative]: 'They play it safe from the line: few errors, few aces.',
};

/** A club's last results, the latest last: W or L. */
function formOf(world: World, clubId: number, n: number): string {
  return world.fixtures
    .filter((f) => f.played && (f.home === clubId || f.away === clubId) && world.competitions[f.competitionId]?.kind !== 'friendly')
    .sort((a, b) => a.day - b.day).slice(-n)
    .map((f) => ((f.home === clubId) === (f.homeSets > f.awaySets) ? 'W' : 'L')).join('-');
}

/** Two days before every competitive match: the scouts on the opposition. */
export function scoutingReport(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || !inboxPrefsOf(world).scouting) return;
  const f = world.fixtures.find((x) => !x.played && x.day === world.day + 2 && (x.home === club.id || x.away === club.id));
  const comp = f !== undefined ? world.competitions[f.competitionId] : undefined;
  if (f === undefined || comp === undefined || comp.kind === 'friendly') return;
  const done = (world.scoutedFixtures ??= []);
  if (done.includes(f.id)) return;
  done.push(f.id);
  if (done.length > 40) done.splice(0, done.length - 40);
  const opp: Club | undefined = world.clubs[f.home === club.id ? f.away : f.home];
  if (opp === undefined) return;
  const store = world.players;
  // Their table position, in their league.
  const league = world.competitions[opp.leagueId];
  const table = league !== undefined ? [...league.table].sort(compareTableRows) : [];
  const place = table.findIndex((r) => r.clubId === opp.id) + 1;
  const players = opp.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
  const lines = players.map((p) => ({ p, ...clubSeason(world, p) })).filter((x) => x.apps >= 2);
  const key = [...lines].sort((a, b) => b.avg - a.avg).slice(0, 5);
  const danger = [...lines].sort((a, b) => b.points / b.apps - a.points / a.apps)[0];
  const form = formOf(world, opp.id, 5);
  const t = opp.tactics;
  const body = [
    `${opp.name}${place > 0 && league !== undefined ? `, ${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} in the ${league.name}` : ''}` +
      `${form !== '' ? ` — ${form} in their last ${form.split('-').length}` : ''}.`,
    `They play ${OFFENCE_WORDS[t.offense] ?? 'a balanced offence'}, ${TEMPO_WORDS[t.tempo] ?? 'at a normal tempo'}. ${SERVE_WORDS[t.serve] ?? ''}`,
    danger !== undefined ? `The danger man is ${store.fullName(danger.p)} (${pos(world, danger.p)}): ${(danger.points / danger.apps).toFixed(1)} points a match.` : '',
    `The match is ${f.home === club.id ? 'at home' : 'away'}, in two days.` + (
      tripTo(world, f, club.id) === 'abroad' ? ' We fly out the day before — expect some heavy legs.'
        : tripTo(world, f, club.id) === 'long' ? ' It is a long trip, the day before.' : ''),
    rivalryName(world, f) !== null
      ? `And it is ${rivalryName(world, f)}: expect a full house, and a board and a city that will remember the result.`
      : '',
  ].filter((l) => l !== '').join(' ');
  postMessage(world, {
    category: 'task', from: staffName(world, club.id, [StaffRole.HeadScout, StaffRole.Scout, StaffRole.PerformanceAnalyst], 'Chief Scout'),
    subject: `Scouting report: ${opp.name}${fixtureRivalry(world, f) === 'derby' ? ' — derby' : fixtureRivalry(world, f) === 'classic' ? ' — the classic' : ''}`,
    body, clubId: opp.id, fixtureId: f.id, gamePlanFor: opp.id,
    tables: key.length > 0 ? [{
      label: 'Their key players', columns: ['Player', 'Pos', 'Apps', 'Avg', 'Pts/match'],
      rows: key.map((x) => ({ p: x.p, cells: [store.fullName(x.p), pos(world, x.p), x.apps, fixed1(x.avg), (x.points / x.apps).toFixed(1)] })),
    }] : undefined,
  });
}

/** Every day: whichever reports fall due. */
export function reportsDay(world: World): void {
  nationalFormReport(world);
  nationalInjuryNews(world);
  rankingReport(world);
  assistantReport(world);
  scoutingReport(world);
}
