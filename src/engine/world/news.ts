/**
 * The world's news: what is happening at other clubs and in other countries,
 * the way a manager keeps half an eye on the game beyond his own club —
 * coaches sacked and appointed, clubs circling players, stars injured, shock
 * results and new leaders at the top of the table, players and coaches of
 * the month, champions crowned and the summer's moves.
 *
 * Everything reported happened in the simulation: a rumour is a club that
 * could really afford the player, about a player whose contract is running
 * out at a club beneath him — the kind who does move in the summer; the
 * player of the month is the best average rating over the month's league
 * matches. The paper follows the leagues that matter: the world's strongest
 * top flights, the user's country's, and his own league whatever its level —
 * and the manager's own club closest of all: every match it plays, every
 * player it buys or sells, the day he takes over. Under every story the fans
 * have their say (see fans.ts). The feed keeps its most recent stories only.
 */

import { Rng } from '../core/rng.ts';
import { compareTableRows, type Club } from '../model/club.ts';
import { INJURY_NAMES, PlayerFlag } from '../model/players.ts';
import { POSITION_NAMES, type Position } from '../model/positions.ts';
import { StaffRole, type Staff } from '../model/staff.ts';
import { MONTH_NAMES, MONTH_STARTS } from './inbox.ts';
import type { FanBrief } from './fans.ts';
import { highlightAwards, managersLeague, playerOfMonthMessage, type MonthPlayerLine } from './monthAwards.ts';
import { stageLabel } from '../season/cups.ts';
import {
  contractEndSeason, dayOfSeason, seasonEndDay, seasonEndYear, type Competition, type Fixture, type World,
} from './world.ts';

export type NewsKind = 'rumour' | 'transfer' | 'coach' | 'award' | 'result' | 'injury' | 'contract' | 'title';

export interface NewsItem {
  id: number;
  day: number;
  kind: NewsKind;
  headline: string;
  body: string;
  /** The country the story is from — the club's — for filtering. */
  nation: number;
  /** The club the story is about, and a second one in it: the club
   *  interested, the other side of a result, the new club. */
  clubId?: number;
  otherClubId?: number;
  playerIdx?: number;
  /** A coach the story is about. */
  staffId?: number;
  competitionId?: number;
  /** What the fans' comments under it turn on — absent on stories from before they had their say. */
  fans?: FanBrief;
}

/** How many stories the feed keeps. */
const MAX_NEWS = 400;
/** A player rumoured once isn't rumoured again for this long. */
const RUMOUR_GAP_DAYS = 45;
/** Reputation gap for a result to count as a shock. */
const SHOCK_GAP = 1800;

export function postNews(world: World, item: Omit<NewsItem, 'id' | 'day'>): void {
  world.news.push({ ...item, id: world.nextNewsId++, day: world.day });
  if (world.news.length > MAX_NEWS) world.news.splice(0, world.news.length - MAX_NEWS);
}

// ---- Who the paper follows ------------------------------------------------------------

/** How many of the world's strongest top flights the paper covers. */
const MAJOR_LEAGUES = 6;

let followCache: { world: World; day: number; leagues: Set<number> } | null = null;

/** The leagues the paper covers: the user's own, his country's top flight,
 *  and the world's strongest top flights. Worked out once a day. */
function followedLeagues(world: World): Set<number> {
  if (followCache !== null && followCache.world === world && followCache.day === world.day) return followCache.leagues;
  const leagues = new Set(world.competitions
    .filter((c) => c.kind === 'league' && c.tier === 1)
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, MAJOR_LEAGUES)
    .map((c) => c.id));
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (own !== undefined) {
    leagues.add(own.leagueId);
    for (const c of world.competitions) if (c.kind === 'league' && c.tier === 1 && c.nation === own.nation) leagues.add(c.id);
  }
  followCache = { world, day: world.day, leagues };
  return leagues;
}

/** A club in one of the leagues the paper covers. */
export function followed(world: World, club: Club | undefined): club is Club {
  return club !== undefined && followedLeagues(world).has(club.leagueId);
}

function leagueOf(world: World, club: Club): Competition | undefined {
  const comp = world.competitions[club.leagueId];
  return comp !== undefined && comp.kind === 'league' ? comp : undefined;
}

/** Where a club stands in its league: "3rd in the Superliga", or '' before a ball is played. */
function standing(world: World, club: Club): string {
  const comp = leagueOf(world, club);
  if (comp === undefined) return '';
  const table = [...comp.table].sort(compareTableRows);
  const i = table.findIndex((r) => r.clubId === club.id);
  if (i < 0 || table[i].played === 0) return '';
  return `${ordinal(i + 1)} in the ${comp.name}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

function coachName(s: Staff): string {
  return `${s.firstName} ${s.lastName}`;
}

function headCoach(world: World, club: Club): Staff | undefined {
  return world.staff.find((s) => s.role === StaffRole.HeadCoach && s.clubId === club.id);
}

/** A player as the paper describes him: "the 24-year-old outside hitter". */
function describe(world: World, p: number): string {
  const store = world.players;
  const age = store.ageOn(p, world.year, (dayOfSeason(world) + 181) % 365);
  return `the ${age}-year-old ${POSITION_NAMES[store.position[p] as Position].toLowerCase()}`;
}

/** His season so far in the league, if he has played in it. */
function seasonLine(world: World, p: number): string {
  const store = world.players;
  const club = world.clubs[store.clubId[p]];
  const line = club !== undefined
    ? world.competitionRecords.get(p)?.find((l) => l.season === world.season && l.competitionId === club.leagueId)
    : undefined;
  if (line === undefined || line.apps === 0) return '';
  const matches = `${line.apps} league match${line.apps === 1 ? '' : 'es'}`;
  const rating = (line.ratingSum / line.apps).toFixed(2);
  // A libero scores nothing, a setter little: their rating tells the story.
  return line.points >= line.apps * 3
    ? ` He has ${line.points} points in ${matches} this season, averaging a rating of ${rating}.`
    : ` He has played ${matches} this season, averaging a rating of ${rating}.`;
}

/** "Wolfdogs'" or "Skra's". */
function poss(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/** One of the best handful at his club — the kind of player stories are written about. */
function starAt(world: World, club: Club, p: number, top = 3): boolean {
  const store = world.players;
  const better = club.players.filter((q) => store.currentAbility[q] > store.currentAbility[p]).length;
  return better < top;
}

// ---- Coaches -----------------------------------------------------------------------------

export function newsCoachSacked(world: World, club: Club, coach: Staff | undefined): void {
  if (!followed(world, club) || club.id === world.userClubId) return;
  const where = standing(world, club);
  postNews(world, {
    kind: 'coach',
    headline: coach !== undefined
      ? `${club.name} part company with ${coachName(coach)}`
      : `${club.name} looking for a new head coach`,
    body: `${club.name} have dismissed ${coach !== undefined ? `head coach ${coachName(coach)}` : 'their head coach'} ` +
      `after a run of results the board could no longer accept${where !== '' ? ` — the club sit ${where}` : ''}. ` +
      'The search for a successor begins at once.',
    nation: club.nation,
    clubId: club.id,
    staffId: coach?.id,
    fans: { story: 'sacked', club: club.id, coach: coach !== undefined ? coachName(coach) : undefined },
  });
}

export function newsCoachAppointed(world: World, club: Club, coach: Staff): void {
  if (!followed(world, club) || club.id === world.userClubId) return;
  postNews(world, {
    kind: 'coach',
    headline: `${club.name} appoint ${coachName(coach)}`,
    body: `${coachName(coach)} is the new head coach of ${club.name}. ` +
      `The board hope the appointment will settle the club${standing(world, club) !== '' ? `, ${standing(world, club)}` : ''}.`,
    nation: club.nation,
    clubId: club.id,
    staffId: coach.id,
    fans: { story: 'appointed', club: club.id, coach: coachName(coach) },
  });
}

/** The manager takes over a club: the paper, and its fans, take notice. */
export function newsManagerAppointed(world: World, club: Club): void {
  const name = `${world.manager.firstName} ${world.manager.lastName}`;
  postNews(world, {
    kind: 'coach',
    headline: `${club.name} appoint ${name}`,
    body: `${name} is the new head coach of ${club.name}. ` +
      `The board will be looking for a strong start${standing(world, club) !== '' ? ` from a side ${standing(world, club)}` : ''}.`,
    nation: club.nation,
    clubId: club.id,
    fans: { story: 'appointed', club: club.id, coach: name },
  });
}

// ---- The market ------------------------------------------------------------------------

/**
 * A rumour or two a week, in season: a player at a followed club, one of its
 * best, whose contract runs out in the summer and who is better than his
 * club — and a bigger club that could pay him.
 */
function rumours(world: World): void {
  const store = world.players;
  const lastDay = seasonEndDay(world.season);
  const recent = new Set(world.news
    .filter((n) => n.kind === 'rumour' && n.day > world.day - RUMOUR_GAP_DAYS && n.playerIdx !== undefined)
    .map((n) => n.playerIdx));
  const pool: number[] = [];
  for (const club of world.clubs) {
    if (!followed(world, club) || club.id === world.userClubId) continue;
    for (const p of club.players) {
      if (recent.has(p) || store.hasFlag(p, PlayerFlag.Youth) || store.contractUntil[p] > lastDay) continue;
      if (store.currentAbility[p] / 2000 < club.reputation / 10000 + 0.04 || !starAt(world, club, p)) continue;
      pool.push(p);
    }
  }
  const count = Math.min(pool.length, world.rng.chance(0.5) ? 2 : 1);
  for (let k = 0; k < count; k++) {
    const p = pool.splice(world.rng.int(0, pool.length - 1), 1)[0];
    const club = world.clubs[store.clubId[p]];
    const suitors = world.clubs.filter((c) =>
      c.id !== club.id && c.tier === 1 && c.reputation > club.reputation + 600 &&
      c.finances.wageBudget > store.wage[p] * 6 && c.id !== world.userClubId);
    if (suitors.length === 0) continue;
    // Usually a club at home; now and then one from abroad.
    const home = suitors.filter((c) => c.nation === club.nation);
    const suitor = world.rng.pick(home.length > 0 && world.rng.chance(0.6) ? home : suitors);
    const name = store.fullName(p);
    const headlines = [
      `${suitor.name} keeping tabs on ${name}`,
      `${suitor.name} weigh up a move for ${poss(club.name)} ${name}`,
      `${name} on ${poss(suitor.name)} radar`,
      `${suitor.name} eye ${club.name} star ${name}`,
    ];
    postNews(world, {
      kind: 'rumour',
      headline: world.rng.pick(headlines),
      body: `${suitor.name} are understood to be interested in ${poss(club.name)} ${name}, ${describe(world, p)}. ` +
        `His contract runs out in the summer, and he is said to be weighing up his future.${seasonLine(world, p)}`,
      nation: club.nation,
      clubId: suitor.id,
      otherClubId: club.id,
      playerIdx: p,
      fans: { story: 'rumour', club: suitor.id, other: club.id, player: p },
    });
  }
}

/** The summer's free-transfer signings at followed clubs, the biggest names first. */
export function newsSignings(world: World, signings: ReadonlyArray<{ playerIdx: number; from: number; to: number }>): void {
  const store = world.players;
  const notable = signings
    .filter((s) => followed(world, world.clubs[s.to]) && s.to !== world.userClubId)
    .sort((a, b) => store.currentAbility[b.playerIdx] - store.currentAbility[a.playerIdx])
    .slice(0, 12);
  for (const s of notable) {
    const to = world.clubs[s.to];
    const from = world.clubs[s.from];
    const name = store.fullName(s.playerIdx);
    postNews(world, {
      kind: 'transfer',
      headline: `${name} joins ${to.name}${from !== undefined ? ` from ${from.name}` : ''}`,
      body: `${to.name} have signed ${name}, ${describe(world, s.playerIdx)}, on a free transfer` +
        `${from !== undefined ? ` after his contract at ${from.name} ran out` : ''}. ` +
        `He has signed a deal until ${seasonEndYear(world, contractEndSeason(store.contractUntil[s.playerIdx]))}.`,
      nation: to.nation,
      clubId: to.id,
      otherClubId: from?.id,
      playerIdx: s.playerIdx,
      fans: { story: 'signing', club: to.id, other: from?.id, player: s.playerIdx },
    });
  }
}

/** A transfer with a fee — the manager's own business, or a followed club's. */
export function newsTransfer(world: World, p: number, fromId: number, toId: number, fee: number): void {
  const to = world.clubs[toId];
  const from = world.clubs[fromId];
  const own = toId === world.userClubId || fromId === world.userClubId;
  if (to === undefined || (!own && !followed(world, to))) return;
  const name = world.players.fullName(p);
  const price = fee >= 1_000_000 ? `€${(fee / 1_000_000).toFixed(1)}M` : fee > 0 ? `€${Math.round(fee / 1000)}k` : '';
  postNews(world, {
    kind: 'transfer',
    headline: `${name} joins ${to.name}${from !== undefined ? ` from ${from.name}` : ''}`,
    body: `${to.name} have signed ${name}, ${describe(world, p)}` +
      `${from !== undefined ? ` from ${from.name}` : ''}${price !== '' ? ` for a fee of ${price}` : ' on a free transfer'}.` +
      `${seasonLine(world, p)}`,
    nation: to.nation,
    clubId: to.id,
    otherClubId: from?.id,
    playerIdx: p,
    fans: { story: 'signing', club: to.id, other: from?.id, player: p, fee },
  });
}

/** A star who stays: his contract extended at a followed club. */
export function newsExtension(world: World, club: Club, p: number): void {
  if (!followed(world, club) || club.id === world.userClubId || !starAt(world, club, p, 2)) return;
  const name = world.players.fullName(p);
  postNews(world, {
    kind: 'contract',
    headline: `${name} commits his future to ${club.name}`,
    body: `${name}, ${describe(world, p)}, has signed a new contract with ${club.name}, ending talk of a move.`,
    nation: club.nation,
    clubId: club.id,
    playerIdx: p,
    fans: { story: 'extension', club: club.id, player: p },
  });
}

// ---- Injuries -----------------------------------------------------------------------------

/** A star out for weeks at a followed club. */
export function newsInjury(world: World, p: number, type: number, days: number): void {
  const store = world.players;
  const club = world.clubs[store.clubId[p]];
  if (days < 28 || !followed(world, club) || club.id === world.userClubId || !starAt(world, club, p, 2)) return;
  const weeks = Math.round(days / 7);
  const injury = (INJURY_NAMES[type] ?? 'injury').toLowerCase();
  postNews(world, {
    kind: 'injury',
    headline: `Blow for ${club.name} as ${store.fullName(p)} faces ${weeks} weeks out`,
    body: `${club.name} will be without ${store.fullName(p)}, ${describe(world, p)}, for around ${weeks} weeks (${injury}).`,
    nation: club.nation,
    clubId: club.id,
    playerIdx: p,
    fans: { story: 'injury', club: club.id, player: p, weeks },
  });
}

// ---- Results -------------------------------------------------------------------------------

/** The manager's own club's match: the result, how it came, who starred. */
function matchReport(world: World, f: Fixture): void {
  const comp = world.competitions[f.competitionId];
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  if (comp === undefined || home === undefined || away === undefined) return;
  const homeWon = f.homeSets > f.awaySets;
  const [winner, loser] = homeWon ? [home, away] : [away, home];
  const score = `${Math.max(f.homeSets, f.awaySets)}-${Math.min(f.homeSets, f.awaySets)}`;
  const store = world.players;
  const mvp = f.mvp >= 0 && store.isActive(f.mvp) ? f.mvp : -1;
  const stage = stageLabel(world, f);
  const shock = loser.reputation - winner.reputation > SHOCK_GAP * 0.7;
  // Its own dice for the wording, so the paper never moves the world's.
  const rng = new Rng(f.id * 7919 + 3);
  const headline = shock
    ? `Shock: ${winner.name} beat ${loser.name} ${score}`
    : Math.min(f.homeSets, f.awaySets) === 0
      ? rng.pick([`${winner.name} sweep aside ${loser.name}`, `${winner.name} cruise past ${loser.name} ${score}`])
      : Math.min(f.homeSets, f.awaySets) === 2
        ? rng.pick([`${winner.name} edge ${loser.name} in a five-set thriller`, `${winner.name} survive tie-break against ${loser.name}`])
        : rng.pick([`${winner.name} beat ${loser.name} ${score}`, `${winner.name} see off ${loser.name}`, `Defeat for ${loser.name} against ${winner.name}`]);
  const sets = f.setScores.map(([h, a]) => (homeWon ? `${h}-${a}` : `${a}-${h}`)).join(', ');
  postNews(world, {
    kind: 'result',
    headline,
    body: `${winner.name} beat ${loser.name} ${score} (${sets}) ${homeWon ? 'at home' : 'on the road'} ` +
      `in the ${comp.name}${stage !== '' ? `, ${stage.toLowerCase()}` : ''}.` +
      `${mvp >= 0 ? ` ${store.fullName(mvp)} was named player of the match.` : ''}`,
    nation: winner.nation,
    clubId: winner.id,
    otherClubId: loser.id,
    playerIdx: mvp >= 0 ? mvp : undefined,
    competitionId: comp.id,
    fans: {
      story: shock ? 'shock' : 'match', club: winner.id, other: loser.id, score,
      player: mvp >= 0 && store.clubId[mvp] === winner.id ? mvp : undefined,
    },
  });
}

/** Shock results, and a new side on top of a followed league. */
function results(world: World, fixtures: readonly Fixture[]): void {
  for (const f of fixtures) {
    const comp = world.competitions[f.competitionId];
    if (!f.played || comp === undefined) continue;
    // The manager's own matches, whatever the competition.
    if (f.home === world.userClubId || f.away === world.userClubId) {
      if (comp.kind !== 'friendly' && comp.kind !== 'international') matchReport(world, f);
      continue;
    }
    if (comp.kind !== 'league') continue;
    const home = world.clubs[f.home];
    const away = world.clubs[f.away];
    if (!followed(world, home) || !followed(world, away)) continue;
    const homeWon = f.homeSets > f.awaySets;
    const [winner, loser] = homeWon ? [home, away] : [away, home];
    // A narrow win needs a bigger gap to be a shock.
    const narrow = Math.min(f.homeSets, f.awaySets) === 2;
    if (loser.reputation - winner.reputation < SHOCK_GAP * (narrow ? 1.5 : 1)) continue;
    const score = homeWon ? `${f.homeSets}-${f.awaySets}` : `${f.awaySets}-${f.homeSets}`;
    postNews(world, {
      kind: 'result',
      headline: `Shock in the ${comp.name}: ${winner.name} beat ${loser.name}`,
      body: `${winner.name} pulled off one of the results of the season, beating ${loser.name} ${score}` +
        `${homeWon ? ' at home' : ' on the road'}.`,
      nation: winner.nation,
      clubId: winner.id,
      otherClubId: loser.id,
      competitionId: comp.id,
      fans: { story: 'shock', club: winner.id, other: loser.id, score },
    });
  }

  const leaders = world.newsLeaders ?? (world.newsLeaders = new Map());
  const touched = new Set(fixtures.map((f) => f.competitionId));
  for (const id of touched) {
    const comp = world.competitions[id];
    if (comp === undefined || comp.kind !== 'league' || comp.table.length === 0) continue;
    const table = [...comp.table].sort(compareTableRows);
    const top = table[0];
    if (top.played < 3) {
      leaders.set(comp.id, top.clubId);
      continue;
    }
    const was = leaders.get(comp.id);
    leaders.set(comp.id, top.clubId);
    const club = world.clubs[top.clubId];
    if (was === undefined || was === top.clubId || !followed(world, club)) continue;
    const old = world.clubs[was];
    postNews(world, {
      kind: 'result',
      headline: `${club.name} go top of the ${comp.name}`,
      body: `${club.name} lead the ${comp.name} on ${top.points} points after ${top.played} matches` +
        `${old !== undefined ? `, taking over at the top from ${old.name}` : ''}.`,
      nation: club.nation,
      clubId: club.id,
      otherClubId: old?.id,
      competitionId: comp.id,
      fans: { story: 'top', club: club.id, other: old?.id },
    });
  }
}

// ---- Awards ---------------------------------------------------------------------------------

/** The leagues the monthly awards go to: the user's own, and the top flights of the strongest nations. */
function awardLeagues(world: World): Competition[] {
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const tops = world.competitions
    .filter((c) => c.kind === 'league' && c.tier === 1 && c.table.length > 0)
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, 4);
  const ownLeague = own !== undefined ? world.competitions[own.leagueId] : undefined;
  if (ownLeague !== undefined && !tops.includes(ownLeague)) tops.unshift(ownLeague);
  return tops;
}

/** Each player's league numbers and each club's record, as they stood on the 1st. */
function snapshot(world: World, leagues: Competition[]): NonNullable<World['newsMonth']> {
  const ids = new Set(leagues.map((c) => c.id));
  const lines = new Map<number, [number, number, number, number]>();
  for (const [p, recs] of world.competitionRecords) {
    for (const l of recs) {
      if (l.season === world.season && ids.has(l.competitionId)) lines.set(p, [l.competitionId, l.apps, l.ratingSum, l.points]);
    }
  }
  const records = new Map<number, [number, number]>();
  for (const comp of leagues) for (const r of comp.table) records.set(r.clubId, [r.played, r.won]);
  return { season: world.season, lines, records };
}

/** On the 1st: the month just gone's player and coach of the month in each award league. */
function monthlyAwards(world: World): void {
  const leagues = awardLeagues(world);
  const before = world.newsMonth;
  world.newsMonth = snapshot(world, leagues);
  if (before === undefined || before.season !== world.season) return;
  const now = world.newsMonth;
  const d = dayOfSeason(world);
  const month = MONTH_NAMES[Math.max(0, MONTH_STARTS.findIndex((m) => m === d) - 1)];
  const store = world.players;

  const own = managersLeague(world);
  for (const comp of leagues) {
    // Player of the month: the best average rating over three or more matches.
    const lines: Array<MonthPlayerLine & { score: number }> = [];
    for (const [p, l] of now.lines) {
      if (l[0] !== comp.id) continue;
      const was = before.lines.get(p) ?? [comp.id, 0, 0, 0];
      const apps = l[1] - was[1];
      if (apps < 3) continue;
      const avg = (l[2] - was[2]) / apps;
      const pts = l[3] - was[3];
      lines.push({ p, clubId: store.clubId[p], apps, avg, points: pts, score: avg + pts * 0.004 });
    }
    lines.sort((a, b) => b.score - a.score);
    const best = lines[0]?.p ?? -1;
    const bestLine: [number, number, number] = lines[0] !== undefined ? [lines[0].apps, lines[0].avg, lines[0].points] : [0, 0, 0];
    // The manager's own league's honours go to his inbox too — the point and play of the month with them.
    if (comp.id === own) {
      playerOfMonthMessage(world, comp.id, month, lines.slice(0, 3));
      highlightAwards(world, comp.id, month);
    }
    const club = best >= 0 ? world.clubs[store.clubId[best]] : undefined;
    if (club !== undefined) {
      postNews(world, {
        kind: 'award',
        headline: `${store.fullName(best)} named ${comp.name} Player of the Month`,
        body: `${store.fullName(best)} of ${club.name} is the ${poss(comp.name)} Player of the Month for ${month}: ` +
          `${bestLine[2]} points in ${bestLine[0]} matches at an average rating of ${bestLine[1].toFixed(2)}.`,
        nation: comp.nation,
        clubId: club.id,
        playerIdx: best,
        competitionId: comp.id,
        fans: { story: 'playerAward', club: club.id, player: best },
      });
    }

    // Coach of the month: the most wins over the month, three matches or more.
    let top: Club | undefined;
    let topWins = 0;
    let topPlayed = 0;
    for (const r of comp.table) {
      const was = before.records.get(r.clubId) ?? [0, 0];
      const played = r.played - was[0];
      const won = r.won - was[1];
      if (played < 3 || won < topWins || (won === topWins && played >= topPlayed)) continue;
      top = world.clubs[r.clubId];
      topWins = won;
      topPlayed = played;
    }
    const coach = top !== undefined ? headCoach(world, top) : undefined;
    if (top !== undefined && coach !== undefined && topWins >= 3) {
      postNews(world, {
        kind: 'award',
        headline: `${coachName(coach)} is ${comp.name} Coach of the Month`,
        body: `${coachName(coach)} of ${top.name} is the ${poss(comp.name)} Coach of the Month for ${month}, ` +
          `after ${topWins} wins from ${topPlayed} matches.`,
        nation: comp.nation,
        clubId: top.id,
        staffId: coach.id,
        competitionId: comp.id,
        fans: { story: 'coachAward', club: top.id, coach: coachName(coach) },
      });
    } else if (top !== undefined && top.id === world.userClubId && topWins >= 3) {
      postNews(world, {
        kind: 'award',
        headline: `${world.manager.firstName} ${world.manager.lastName} is ${comp.name} Coach of the Month`,
        body: `${world.manager.firstName} ${world.manager.lastName} of ${top.name} is the ${poss(comp.name)} Coach of the Month ` +
          `for ${month}, after ${topWins} wins from ${topPlayed} matches.`,
        nation: comp.nation,
        clubId: top.id,
        competitionId: comp.id,
        fans: { story: 'coachAward', club: top.id, coach: `${world.manager.firstName} ${world.manager.lastName}` },
      });
    }
  }
}

// ---- The end of a season ----------------------------------------------------------------

/** Champions crowned in the followed leagues, and the continental and world titles. */
export function newsChampions(world: World, champions: ReadonlyArray<{ competitionId: number; winner: number }>): void {
  for (const c of champions) {
    const comp = world.competitions[c.competitionId];
    const club = world.clubs[c.winner];
    if (comp === undefined || club === undefined) continue;
    const big = comp.kind === 'continental' || comp.kind === 'clubworld';
    if (!big && !(comp.kind === 'league' && followed(world, club))) continue;
    postNews(world, {
      kind: 'title',
      headline: `${club.name} are ${comp.name} champions`,
      body: `${club.name} have won the ${comp.name}${club.titlesWon > 1 ? ` — the club's ${ordinal(club.titlesWon)} major title` : ''}.`,
      nation: big ? -1 : club.nation,
      clubId: club.id,
      competitionId: comp.id,
      fans: { story: 'title', club: club.id, comp: comp.name },
    });
  }
}

// ---- Each day -------------------------------------------------------------------------------

/** The day's news, once the day's matches are played: results, and on their days the rumours and awards. */
export function newsDay(world: World, todays: readonly Fixture[]): void {
  if (todays.length > 0) results(world, todays);
  const d = dayOfSeason(world);
  // Rumours through the season, once a week.
  if (d >= 40 && d < 330 && world.day % 7 === 5) rumours(world);
  if (MONTH_STARTS.includes(d)) monthlyAwards(world);
}

