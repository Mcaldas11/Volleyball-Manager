/**
 * Watching another club's match: the manager in the stands — out of work,
 * between his own matches, or as a national coach keeping an eye on his
 * players — at a match of two other clubs on today.
 *
 * The match he watches is the one the season would have played: the same two
 * sides as the engine would send out, prepared the same way, with nobody but
 * the engine on either bench (see `detailedMatchSetup`). It is played live
 * and only committed to the world at full time, through the same
 * `applyMatchResult` as any match played in full — so when the day moves on
 * the fixture is already played and is never played again. A match left
 * before the end is simply not committed: the day plays it as it would have.
 *
 * And he is seen there. The papers make a story of who he is and why he
 * might have come: his former club, his own national team's players, the
 * players on his shortlist — or, out of work, a club that might have a job
 * for him.
 */

import type { MatchResult, MatchSetup } from '../match/engine.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { headCoachOf } from '../world/career.ts';
import {
  commitWatchedIntl, findIntlMatch, intlMatchSetup, matchImportance, nationName, nationalTeamOf, squadOf, userNation,
  type IntlMatch, type Tournament,
} from '../world/internationals.ts';
import { MatchFormat } from '../match/engine.ts';
import { baseNation } from '../world/sides.ts';
import { postNews, type NewsItem } from '../world/news.ts';
import type { Fixture, World } from '../world/world.ts';
import { isFriendly } from './friendlies.ts';
import { applyMatchResult, detailedMatchSetup, type SeasonContext } from './seasonEngine.ts';

/** Why the manager might be at a match — the story's angle, strongest first. */
export type WatchAngle =
  | { kind: 'former'; clubId: number }
  | { kind: 'national'; nation: number; players: number[] }
  | { kind: 'shortlist'; players: number[] }
  /** Out of work: `open` when the club has no head coach. */
  | { kind: 'job'; clubId: number; open: boolean }
  /** A national team's match: his club's players in it, playing for their country. */
  | { kind: 'clubPlayers'; clubId: number; players: number[] }
  /** A national team's match: a side his own national team meets at the tournament, or could. */
  | { kind: 'rival'; nation: number; mine: number }
  | { kind: 'neutral' };

/** Whether a match can be watched from the stands: today's, still to play, two clubs — neither of them the manager's. */
export function canWatch(world: World, f: Fixture): boolean {
  if (f.id < 0) {
    const found = findIntlMatch(world, -1 - f.id);
    return found !== null && found.m.day === world.day && watchableIntl(world, found.t, found.m);
  }
  return f.day === world.day && watchableFixture(world, f);
}

// ---- National teams' matches ------------------------------------------------------------------

/**
 * A national team's match he could go and see: squads named, still to play,
 * and neither side his own — his own national team's match is his to coach.
 */
function watchableIntl(world: World, t: Tournament, m: IntlMatch): boolean {
  if (m.played || m.day < world.day || t.status === 'planned' || t.status === 'done') return false;
  const mine = userNation(world);
  if (m.home === mine || m.away === mine) return false;
  return squadOf(t, m.home).length > 0 && squadOf(t, m.away).length > 0;
}

/** A national team's match as a fixture, for the watch list and the matchday screens: its id is -1 - the match's. */
export function intlFixture(t: Tournament, m: IntlMatch): Fixture {
  return {
    id: -1 - m.id, competitionId: t.competitionId, day: m.day, home: m.home, away: m.away, round: m.round,
    format: MatchFormat.BestOf5, importance: matchImportance(m), neutralVenue: m.home !== t.host,
    played: m.played, homeSets: m.homeSets, awaySets: m.awaySets, setScores: m.setScores, mvp: m.mvp,
  };
}

/** Today's national teams' matches he could watch. */
function intlToday(world: World): Array<{ t: Tournament; m: IntlMatch }> {
  const out: Array<{ t: Tournament; m: IntlMatch }> = [];
  for (const t of world.internationals?.tournaments ?? []) {
    if (t.status === 'planned' || t.status === 'done') continue;
    for (const m of t.matches) if (m.day === world.day && watchableIntl(world, t, m)) out.push({ t, m });
  }
  return out;
}

/** The tournament a national team's match on the watch list belongs to — null for a club match. */
export function intlTournamentOf(world: World, f: Fixture): Tournament | null {
  return f.id < 0 ? findIntlMatch(world, -1 - f.id)?.t ?? null : null;
}

/** Why he might go to a national team's match: his club's players in it, a rival of his own national team, his shortlist. */
function intlWatchAngle(world: World, t: Tournament, m: IntlMatch, took?: ReadonlySet<number>): WatchAngle {
  const store = world.players;
  const squad = [...squadOf(t, m.home), ...squadOf(t, m.away)].filter((p) => took === undefined || took.has(p));
  const club = world.userClubId;
  if (club >= 0) {
    const players = squad.filter((p) => store.clubId[p] === club).sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
    if (players.length > 0) return { kind: 'clubPlayers', clubId: club, players };
  }
  const mine = userNation(world);
  if (mine >= 0 && t.teams.includes(mine)) {
    // The side his own team meets next, or the stronger of the two.
    const next = t.matches.find((x) => !x.played && x.day >= world.day && (x.home === mine || x.away === mine));
    const foe = next !== undefined ? (next.home === mine ? next.away : next.home) : -1;
    const points = (n: number): number => nationalTeamOf(world, n)?.rankingPoints ?? 0;
    const nation = m.home === foe || m.away === foe ? foe : points(m.home) >= points(m.away) ? m.home : m.away;
    return { kind: 'rival', nation, mine };
  }
  const shortlist = new Set(world.shortlist ?? []);
  const followed = squad.filter((p) => shortlist.has(p)).sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  if (followed.length > 0) return { kind: 'shortlist', players: followed };
  return { kind: 'neutral' };
}

/** A match he could go and see on its day: not played, not his club's, a club match with a table to it. */
function watchableFixture(world: World, f: Fixture): boolean {
  if (f.played || f.day < world.day) return false;
  if (f.home === world.userClubId || f.away === world.userClubId) return false;
  if (world.clubs[f.home] === undefined || world.clubs[f.away] === undefined) return false;
  const comp = world.competitions[f.competitionId];
  return comp !== undefined && comp.kind !== 'international' && !isFriendly(world, f);
}

/** The next day, from today on, with a match he could go and see — or null if the season has none left. */
export function nextWatchDay(world: World): number | null {
  const days = [...world.fixturesByDay.keys()].filter((d) => d >= world.day).sort((a, b) => a - b);
  for (const d of days) {
    for (const id of world.fixturesByDay.get(d) ?? []) {
      const f = world.fixtures[id];
      if (f !== undefined && watchableFixture(world, f)) return d;
    }
  }
  return null;
}

/** The same, the national teams' matches too: out of work, a tournament is worth the trip. */
export function nextWatchDayAll(world: World): number | null {
  let best = nextWatchDay(world);
  const mine = userNation(world);
  for (const t of world.internationals?.tournaments ?? []) {
    if (t.status === 'done') continue;
    for (const m of t.matches) {
      // Squads not named yet: by the day itself they will be.
      if (m.played || m.day < world.day || (best !== null && m.day >= best)) continue;
      if (m.home !== mine && m.away !== mine) best = m.day;
    }
  }
  return best;
}

/** Today's matches he could watch, the ones with a reason to be there first, then the biggest. */
export function watchableToday(world: World): Fixture[] {
  return watchListToday(world).map((x) => x.fixture);
}

/** The same, each with why he might go — worked out once for the lot. */
export function watchListToday(world: World): Array<{ fixture: Fixture; angle: WatchAngle }> {
  const out: Array<{ fixture: Fixture; angle: WatchAngle; rank: number }> = [];
  for (const id of world.fixturesByDay.get(world.day) ?? []) {
    const f = world.fixtures[id];
    if (f === undefined || !canWatch(world, f)) continue;
    const angle = watchAngle(world, f);
    const reason = (ANGLE_RANK[angle.kind] + (angle.kind === 'job' && angle.open ? 0.5 : 0)) * 100000;
    const size = (world.clubs[f.home].reputation + world.clubs[f.away].reputation) / 2;
    out.push({ fixture: f, angle, rank: reason + size + f.importance * 1000 });
  }
  for (const { t, m } of intlToday(world)) {
    const angle = intlWatchAngle(world, t, m);
    const reason = ANGLE_RANK[angle.kind] * 100000;
    // A national team's match ranks with a big club match: the bigger the sides, the higher.
    const points = ((nationalTeamOf(world, m.home)?.rankingPoints ?? 0) + (nationalTeamOf(world, m.away)?.rankingPoints ?? 0)) / 2;
    out.push({ fixture: intlFixture(t, m), angle, rank: reason + Math.min(9000, points * 4) + matchImportance(m) * 1000 });
  }
  return out.sort((a, b) => b.rank - a.rank || a.fixture.id - b.fixture.id).map(({ fixture, angle }) => ({ fixture, angle }));
}

const ANGLE_RANK: Readonly<Record<WatchAngle['kind'], number>> = { former: 4, clubPlayers: 4, national: 3, rival: 3, shortlist: 2, job: 1, neutral: 0 };

/** The match as the season would play it — to be played live, rally by rally, and kept whole. */
export function spectatorSetup(world: World, f: Fixture): MatchSetup {
  if (f.id < 0) {
    const found = findIntlMatch(world, -1 - f.id);
    if (found !== null) return intlMatchSetup(world, found.t, found.m, true);
  }
  return { ...detailedMatchSetup(world, f, true, () => world.rng.next()), collectLog: true };
}

/**
 * Who on court ties the manager to the match. `took` narrows the players to
 * those who got on, once the match is over; before it, everyone in either squad.
 */
export function watchAngle(world: World, f: Fixture, took?: ReadonlySet<number>): WatchAngle {
  if (f.id < 0) {
    const found = findIntlMatch(world, -1 - f.id);
    return found !== null ? intlWatchAngle(world, found.t, found.m, took) : { kind: 'neutral' };
  }
  const sides = [f.home, f.away];
  // A club he has coached and left.
  const former = [...world.career.jobs].reverse().find((j) => j.endDay >= 0 && sides.includes(j.clubId) && j.clubId !== world.userClubId);
  if (former !== undefined) return { kind: 'former', clubId: former.clubId };

  const store = world.players;
  const squad = [...world.clubs[f.home].players, ...world.clubs[f.away].players].filter((p) => took === undefined || took.has(p));
  const nation = userNation(world);
  if (nation >= 0) {
    // His players: the ones he last called up, and those good enough to be — not every passport in a home league.
    const called = new Set(world.internationals?.chosen?.players ?? []);
    const contenders = nationalContenders(world, nation);
    const players = squad
      .filter((p) => called.has(p) || contenders.has(p))
      .sort((a, b) => Number(called.has(b)) - Number(called.has(a)) || store.currentAbility[b] - store.currentAbility[a]);
    if (players.length > 0) return { kind: 'national', nation, players };
  }
  const shortlist = new Set(world.shortlist ?? []);
  const followed = squad.filter((p) => shortlist.has(p)).sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  if (followed.length > 0) return { kind: 'shortlist', players: followed };

  if (world.userClubId < 0) {
    // Out of work: a club without a head coach is the obvious one; failing that, the hosts.
    const open = sides.find((id) => headCoachOf(world, world.clubs[id]) === undefined);
    return { kind: 'job', clubId: open ?? f.home, open: open !== undefined };
  }
  return { kind: 'neutral' };
}

/** How many of a nation's best count as in contention for its squad. */
const CONTENDERS = 28;

let contenderCache: { world: World; day: number; nation: number; set: Set<number> } | null = null;

/** A nation's best players at clubs — the ones a national coach would go and see. Worked out once a day. */
function nationalContenders(world: World, nation: number): Set<number> {
  const c = contenderCache;
  if (c !== null && c.world === world && c.day === world.day && c.nation === nation) return c.set;
  const store = world.players;
  const pool: number[] = [];
  for (const club of world.clubs) {
    for (const p of club.players) if (store.nation[p] === nation || store.nation2[p] === nation) pool.push(p);
  }
  pool.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const set = new Set(pool.slice(0, CONTENDERS));
  contenderCache = { world, day: world.day, nation, set };
  return set;
}

/**
 * Full time on a match watched from the stands: the result goes into the
 * world as any match played in full would, and the papers report who was
 * there. Played already — by the day, or watched once before — and nothing
 * happens: a match is never played twice.
 */
export function commitWatched(world: World, ctx: SeasonContext, f: Fixture, result: MatchResult): NewsItem | null {
  if (f.id < 0) {
    // A national team's match: into its tournament, as the day would have played it.
    const found = findIntlMatch(world, -1 - f.id);
    if (found === null || !commitWatchedIntl(world, found.t, found.m, result)) return null;
    Object.assign(f, { played: true, homeSets: result.homeSets, awaySets: result.awaySets, setScores: result.setScores, mvp: result.mvp });
    ctx.detailedResults.set(f.id, result);
    return intlSpectatorStory(world, found.t, found.m, result);
  }
  if (f.played) return null;
  applyMatchResult(world, ctx, f, result);
  ctx.detailedResults.set(f.id, result);
  return spectatorStory(world, f, result);
}

/** The manager, as the papers name him: by the job he holds, or the lack of one. */
function whoIs(world: World): { who: string; name: string } {
  const m = world.manager;
  const name = `${m.firstName} ${m.lastName}`;
  const nation = userNation(world);
  if (nation >= 0) return { who: `The ${nationName(nation)} national coach, ${name},`, name };
  const club = world.clubs[world.userClubId];
  if (club !== undefined) return { who: `${club.name} coach ${name}`, name };
  return { who: `Out-of-work coach ${name}`, name };
}

/** A list of names: "A", "A and B", "A, B and 2 others". */
function names(world: World, players: readonly number[]): string {
  const store = world.players;
  const shown = players.slice(0, 2).map((p) => store.fullName(p));
  const more = players.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} other${more === 1 ? '' : 's'}`;
  return shown.join(' and ');
}

/** The best performer among `players` in the match, by points scored. */
function standout(players: readonly number[], stats: ReadonlyMap<number, PlayerMatchStats>): { p: number; points: number } | null {
  let best: { p: number; points: number } | null = null;
  for (const p of players) {
    const s = stats.get(p);
    if (s === undefined || s.ralliesPlayed === 0) continue;
    const points = s.attackKills + s.serveAces + s.blockPoints;
    if (best === null || points > best.points) best = { p, points };
  }
  return best;
}

/** The story of the manager in the stands — filed, and returned. */
export function spectatorStory(world: World, f: Fixture, result: MatchResult): NewsItem | null {
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  const comp = world.competitions[f.competitionId];
  if (home === undefined || away === undefined || comp === undefined) return null;
  const store = world.players;
  const stats = new Map([...result.stats.home.players, ...result.stats.away.players]);
  const took = new Set([...stats].filter(([, s]) => s.ralliesPlayed > 0).map(([p]) => p));
  const angle = watchAngle(world, f, took);
  const { who, name } = whoIs(world);
  const his = world.manager.gender === 'female' ? 'her' : 'his';
  const homeWon = f.homeSets > f.awaySets;
  const [winner, loser] = homeWon ? [home, away] : [away, home];
  const score = `${Math.max(f.homeSets, f.awaySets)}-${Math.min(f.homeSets, f.awaySets)}`;
  const sets = f.setScores.map(([h, a]) => `${h}-${a}`).join(', ');
  const outcome = `${winner.name} beat ${loser.name} ${score} (${sets}).`;
  const fixture = `${home.name} v ${away.name}`;

  let headline: string;
  let body: string;
  let clubId = home.id;
  let otherClubId = away.id;
  let playerIdx: number | undefined;
  let story: 'spotted' | 'homecoming' = 'spotted';
  switch (angle.kind) {
    case 'former': {
      const club = world.clubs[angle.clubId];
      const other = club.id === home.id ? away : home;
      clubId = club.id;
      otherClubId = other.id;
      story = 'homecoming';
      headline = `${name} back in the stands at ${club.name}`;
      body = `${who} was in the stands for ${club.name}'s match against ${other.name}, ${his} former club. ${outcome}` +
        (world.userClubId < 0 ? ' With the job market quiet, talk of a return is already doing the rounds.' : '');
      break;
    }
    case 'national': {
      const best = standout(angle.players, stats);
      playerIdx = best?.p ?? angle.players[0];
      const count = angle.players.length;
      headline = `${nationName(angle.nation)} coach runs the rule over ${count === 1 ? store.fullName(angle.players[0]) : `${count} internationals`}`;
      body = `${who} was at ${fixture} to watch ${names(world, angle.players)}, ${count === 1 ? 'one' : 'some'} of ${his} players. ${outcome}` +
        (best !== null && best.points > 0 ? ` ${store.fullName(best.p)} made the most of the audience with ${best.points} point${best.points === 1 ? '' : 's'}.` : '');
      break;
    }
    case 'shortlist': {
      const best = standout(angle.players, stats);
      playerIdx = best?.p ?? angle.players[0];
      const target = world.clubs[store.clubId[playerIdx]];
      if (target !== undefined) {
        clubId = target.id;
        otherClubId = target.id === home.id ? away.id : home.id;
      }
      headline = `${name} spotted watching ${store.fullName(playerIdx)}`;
      body = `${who} was spotted in the stands at ${fixture}, where ${names(world, angle.players)} ${angle.players.length === 1 ? 'was' : 'were'} on court, ` +
        `players said to be on ${his} shortlist. ${outcome}`;
      break;
    }
    case 'job': {
      const club = world.clubs[angle.clubId];
      const other = club.id === home.id ? away : home;
      clubId = club.id;
      otherClubId = other.id;
      const coach = headCoachOf(world, club);
      headline = `Job rumours as ${name} turns up at ${club.name}`;
      body = `${who} was seen at ${club.name}'s match against ${other.name}, and the rumours were not long in starting. ` +
        (coach === undefined
          ? `${club.name} are still looking for a head coach. `
          : `It will not have gone unnoticed by ${coach.firstName} ${coach.lastName}, on the bench below. `) + outcome;
      break;
    }
    default:
      headline = `${name} takes in ${fixture}`;
      body = `${who} was among the crowd at ${fixture} in the ${comp.name}. ${outcome}`;
  }
  postNews(world, {
    kind: 'coach',
    headline,
    body,
    nation: world.clubs[clubId].nation,
    clubId,
    otherClubId,
    playerIdx,
    competitionId: comp.id,
    fans: { story, club: clubId, other: otherClubId, coach: name, player: playerIdx, score },
  });
  return world.news[world.news.length - 1] ?? null;
}

/** The story of the manager in the stands at a national team's match — filed, and returned. */
function intlSpectatorStory(world: World, t: Tournament, m: IntlMatch, result: MatchResult): NewsItem | null {
  const store = world.players;
  const stats = new Map([...result.stats.home.players, ...result.stats.away.players]);
  const took = new Set([...stats].filter(([, s]) => s.ralliesPlayed > 0).map(([p]) => p));
  const angle = intlWatchAngle(world, t, m, took);
  const { who, name } = whoIs(world);
  const his = world.manager.gender === 'female' ? 'her' : 'his';
  const [winner, loser] = m.homeSets > m.awaySets ? [m.home, m.away] : [m.away, m.home];
  const score = `${Math.max(m.homeSets, m.awaySets)}-${Math.min(m.homeSets, m.awaySets)}`;
  const sets = m.setScores.map(([h, a]) => `${h}-${a}`).join(', ');
  const outcome = `${nationName(winner)} beat ${nationName(loser)} ${score} (${sets}).`;
  const fixture = `${nationName(m.home)} v ${nationName(m.away)}`;
  const at = `the ${t.name} (${m.stage})`;
  let headline: string;
  let body: string;
  let playerIdx: number | undefined;
  switch (angle.kind) {
    case 'clubPlayers': {
      const club = world.clubs[angle.clubId];
      const best = standout(angle.players, stats);
      playerIdx = best?.p ?? angle.players[0];
      const count = angle.players.length;
      headline = count === 1
        ? `${name} in the stands to watch ${store.fullName(angle.players[0])} at the ${t.name}`
        : `${club?.name ?? 'Club'} coach follows ${count} of ${his} players at the ${t.name}`;
      // Here as their club coach, whatever else he is.
      const coach = club !== undefined ? `${club.name} coach ${name}` : who;
      body = `${coach} made the trip to ${fixture} at ${at}, to see ${names(world, angle.players)} play for their country. ${outcome}` +
        (best !== null && best.points > 0
          ? ` ${store.fullName(best.p)} gave ${his} club coach something to smile about with ${best.points} point${best.points === 1 ? '' : 's'}.`
          : '');
      break;
    }
    case 'rival':
      headline = `${nationName(angle.mine)} coach scouts ${nationName(angle.nation)} at the ${t.name}`;
      body = `${who} was in the stands for ${fixture} at ${at}, taking notes on ${nationName(angle.nation)}. ${outcome}`;
      break;
    case 'shortlist': {
      const best = standout(angle.players, stats);
      playerIdx = best?.p ?? angle.players[0];
      headline = `${name} spotted watching ${store.fullName(playerIdx)} at the ${t.name}`;
      body = `${who} was spotted at ${fixture} at ${at}, where ${names(world, angle.players)} ${angle.players.length === 1 ? 'was' : 'were'} on court, ` +
        `players said to be on ${his} shortlist. ${outcome}`;
      break;
    }
    default:
      headline = `${name} takes in ${fixture} at the ${t.name}`;
      body = `${who} was among the crowd at ${fixture} at ${at}. ${outcome}`;
  }
  const mvp = m.mvp >= 0 && store.isActive(m.mvp) ? m.mvp : -1;
  postNews(world, {
    kind: 'coach',
    headline,
    body,
    nation: baseNation(winner),
    playerIdx: playerIdx ?? (mvp >= 0 ? mvp : undefined),
    clubId: angle.kind === 'clubPlayers' ? angle.clubId : undefined,
    competitionId: t.competitionId,
    fans: { story: 'nationMatch', nation: winner, otherNation: loser, score, coach: name, player: mvp >= 0 ? mvp : undefined },
  });
  return world.news[world.news.length - 1] ?? null;
}
