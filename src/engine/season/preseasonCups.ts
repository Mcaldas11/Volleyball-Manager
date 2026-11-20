/**
 * Pre-season tournaments.
 *
 * Besides the odd friendly, a pre-season has its little tournaments: four or
 * eight clubs at one venue for a week, a host who invites the rest. The
 * manager can host one — choosing the size, the dates and whom to ask — or be
 * asked to another club's. Four play a round robin, then first meets fourth
 * and second third in the semi-finals, the winners the final and the losers
 * for third place; eight play two groups of four, then quarter-finals
 * crosswise (A1 v B4, B2 v A3, B1 v A4, A2 v B3), the semi-finals, the final
 * and the match for third.
 *
 * Every match is a friendly — no table but the tournament's own, no
 * statistics, no records — played live or not like any other. The winners
 * lift a trophy and bank a little prize money, and the trophy goes in a
 * cabinet of its own: friendly silverware, never a title, an honour, an
 * achievement or a line in the Hall of Fame.
 *
 * National teams have theirs too, before a summer's major: the same format,
 * drawn and played by the internationals' own machinery (see
 * `createFriendlyCup` in internationals.ts).
 */

import { Rng } from '../core/rng.ts';
import { MatchFormat } from '../match/engine.ts';
import { compareTableRows, newTableRow, type LeagueTableRow } from '../model/club.ts';
import { formatDay, postMessage } from '../world/inbox.ts';
import { createFriendlyCup, internationals, nationName, rankingFor, userNation } from '../world/internationals.ts';
import { sideAge } from '../world/sides.ts';
import { friendlyCupDays } from '../world/nationalExtras.ts';
import { postNews } from '../world/news.ts';
import { addFixture, DAYS_PER_SEASON, type Fixture, type World } from '../world/world.ts';
import { friendlyCompetition, friendlyInterest, friendlyWindow, FRIENDLY_NOTICE_DAYS, friendlyRequests } from './friendlies.ts';

export type CupSize = 4 | 8;

/** Rounds in the fixtures' `round`: the group days are 0-2; the knockout's from here. */
export const QUARTER_FINAL = 10;
export const SEMI_FINAL = 11;
export const FINAL = 12;
export const THIRD_PLACE = 13;

export interface PreseasonCup {
  id: number;
  season: number;
  name: string;
  /** The club that stages it — every match at its arena. */
  host: number;
  size: CupSize;
  /** The clubs in it, host first; the full field once every place is taken. */
  teams: number[];
  /** Invitations out: who, and the day they answer. */
  pending: Array<{ clubId: number; answerOn: number }>;
  /** Clubs that said no — not asked again. */
  declined: number[];
  /** The groups, seeded, once drawn. */
  groups: number[][];
  /** Absolute day of the first match. */
  startDay: number;
  fixtureIds: number[];
  stage: 'forming' | 'groups' | 'knockout' | 'done' | 'cancelled';
  /** The winners' prize money. */
  prize: number;
  /** Final placings, winner first — once it is over. */
  placings: number[];
}

/** An invitation to the user's club — or national team — to another's tournament, waiting on his answer. */
export interface CupInvite {
  id: number;
  /** A club's tournament: its id in `cups`. */
  cupId?: number;
  /** A national team's: the host nation, the others asked and the dates. */
  nation?: { host: number; teams: number[]; startDay: number; size: CupSize; name: string };
  sentOn: number;
  /** The last day to answer. */
  expiresOn: number;
  answered?: 'accepted' | 'declined' | 'expired';
}

/** A friendly trophy: kept for the cabinet, and nowhere else. */
export interface FriendlyTrophy {
  name: string;
  year: number;
  season: number;
  /** The winning club, or nation. */
  clubId?: number;
  nation?: number;
  prize: number;
}

export interface PreseasonCups {
  cups: PreseasonCup[];
  nextId: number;
  invites: CupInvite[];
  nextInviteId: number;
  trophies: FriendlyTrophy[];
  /** Fixture id → cup id, for every tournament match. */
  fixtureCup: Record<number, number>;
  /** The season invitations were last rolled for the user's club / national team. */
  invitedSeason?: number;
  nationInvitedSeason?: number;
}

/** Days from the first match to the last: three group days, then the knockout's rounds. */
export function cupLength(size: CupSize): number {
  return size === 4 ? 5 : 6;
}
/** Tournaments a club can play in a pre-season. */
export const MAX_CUPS = 2;
/** Days the user has to answer an invitation. */
const INVITE_DAYS = 5;

export function cupsState(world: World): PreseasonCups {
  return world.preseasonCups ??= { cups: [], nextId: 0, invites: [], nextInviteId: 0, trophies: [], fixtureCup: {} };
}

// ---- The format (pure) ------------------------------------------------------------------------

/** A group's matches, three rounds of two: everyone plays everyone once. */
export function roundRobinPairs(group: readonly number[]): Array<Array<[number, number]>> {
  const [a, b, c, d] = group;
  return [[[a, d], [b, c]], [[a, c], [d, b]], [[a, b], [c, d]]];
}

/**
 * A group's table from its played matches: 3 points for a 3-0 or 3-1, 2 for a 3-2, 1 for losing
 * 2-3; then wins, set ratio, point ratio — and, all square, the seeding.
 */
export function cupStandings(group: readonly number[], fixtures: readonly Fixture[]): LeagueTableRow[] {
  const rows = new Map(group.map((c) => [c, newTableRow(c)]));
  for (const f of fixtures) {
    if (!f.played || f.round >= QUARTER_FINAL) continue;
    const h = rows.get(f.home);
    const a = rows.get(f.away);
    if (h === undefined || a === undefined) continue;
    const homeWon = f.homeSets > f.awaySets;
    const loserSets = Math.min(f.homeSets, f.awaySets);
    const [win, lose] = loserSets <= 1 ? [3, 0] : [2, 1];
    for (const [row, won, sf, sa] of [[h, homeWon, f.homeSets, f.awaySets], [a, !homeWon, f.awaySets, f.homeSets]] as const) {
      row.played++;
      if (won) row.won++;
      else row.lost++;
      row.points += won ? win : lose;
      row.setsFor += sf;
      row.setsAgainst += sa;
    }
    for (const [hp, ap] of f.setScores) {
      h.pointsFor += hp;
      h.pointsAgainst += ap;
      a.pointsFor += ap;
      a.pointsAgainst += hp;
    }
  }
  return [...rows.values()].sort((x, y) => compareTableRows(x, y) || group.indexOf(x.clubId) - group.indexOf(y.clubId));
}

/** Four in one group: first against fourth, second against third. */
export function semiFinalPairs(table: readonly LeagueTableRow[]): Array<[number, number]> {
  return [[table[0].clubId, table[3].clubId], [table[1].clubId, table[2].clubId]];
}

/** Eight in two groups: crosswise, the winners against the other group's fourth. */
export function quarterFinalPairs(a: readonly LeagueTableRow[], b: readonly LeagueTableRow[]): Array<[number, number]> {
  return [
    [a[0].clubId, b[3].clubId], [b[1].clubId, a[2].clubId],
    [b[0].clubId, a[3].clubId], [a[1].clubId, b[2].clubId],
  ];
}

/** Snake seeding: four in one group, or 1-4-5-8 and 2-3-6-7. */
export function drawGroups(seeded: readonly number[]): number[][] {
  if (seeded.length === 4) return [[...seeded]];
  const s = seeded;
  return [[s[0], s[3], s[4], s[7]], [s[1], s[2], s[5], s[6]]];
}

/** The winners' prize: a little money, more for a bigger field at a bigger club. */
export function cupPrize(hostReputation: number, size: CupSize): number {
  return Math.round(((10_000 + hostReputation * 4) * (size === 8 ? 1.6 : 1)) / 1000) * 1000;
}

function winnerOf(f: Fixture): number {
  return f.homeSets > f.awaySets ? f.home : f.away;
}
function loserOf(f: Fixture): number {
  return f.homeSets > f.awaySets ? f.away : f.home;
}

/** The stage a tournament match is in: "Group A", "Semi-final"… */
export function cupStageName(cup: PreseasonCup, f: Fixture): string {
  if (f.round === QUARTER_FINAL) return 'Quarter-final';
  if (f.round === SEMI_FINAL) return 'Semi-final';
  if (f.round === FINAL) return 'Final';
  if (f.round === THIRD_PLACE) return '3rd place match';
  if (cup.groups.length <= 1) return `Round ${f.round + 1}`;
  const g = cup.groups.findIndex((gr) => gr.includes(f.home));
  return `Group ${String.fromCharCode(65 + Math.max(0, g))}`;
}

// ---- Reading the world ------------------------------------------------------------------------

export function cupOf(world: World, f: Fixture): PreseasonCup | undefined {
  const id = world.preseasonCups?.fixtureCup[f.id];
  return id === undefined ? undefined : world.preseasonCups!.cups.find((c) => c.id === id);
}

/** "Lisbon Summer Cup · Semi-final" — for the matchday's banner. */
export function cupMatchTitle(world: World, f: Fixture): string | null {
  const cup = cupOf(world, f);
  return cup === undefined ? null : `${cup.name} · ${cupStageName(cup, f)}`;
}

export function cupFixtures(world: World, cup: PreseasonCup): Fixture[] {
  return cup.fixtureIds.map((id) => world.fixtures[id]).filter((f) => f !== undefined);
}

/** A group's table as it stands. */
export function groupTable(world: World, cup: PreseasonCup, group: number): LeagueTableRow[] {
  return cupStandings(cup.groups[group] ?? [], cupFixtures(world, cup));
}

/** This season's tournaments the user's club is in, or asked to, or forming — the latest first. */
export function userCups(world: World): PreseasonCup[] {
  const club = world.userClubId;
  const s = world.preseasonCups;
  if (s === undefined || club < 0) return [];
  return s.cups.filter((c) => c.season === world.season && c.stage !== 'cancelled' &&
    (c.teams.includes(club) || c.pending.some((p) => p.clubId === club)));
}

/** Invitations still waiting on the manager. */
export function openInvites(world: World): CupInvite[] {
  return (world.preseasonCups?.invites ?? []).filter((i) => i.answered === undefined && i.expiresOn >= world.day);
}

/** A club's (or nation's) friendly trophies, the latest first. */
export function friendlyTrophies(world: World, who: { clubId?: number; nation?: number }): FriendlyTrophy[] {
  return (world.preseasonCups?.trophies ?? [])
    .filter((t) => (who.clubId !== undefined && t.clubId === who.clubId) || (who.nation !== undefined && t.nation === who.nation))
    .reverse();
}

function seasonStart(world: World): number {
  return world.season * DAYS_PER_SEASON;
}

/** Every day a club is taken in a span: a match within a day of it, or a tournament it is in or asked to. */
function clubBusy(world: World, clubId: number, first: number, last: number, ignoreCup = -1): boolean {
  for (let d = first - 1; d <= last + 1; d++) {
    for (const id of world.fixturesByDay.get(d) ?? []) {
      const f = world.fixtures[id];
      if (f.home === clubId || f.away === clubId) return true;
    }
  }
  for (const c of world.preseasonCups?.cups ?? []) {
    if (c.id === ignoreCup || c.stage === 'cancelled' || c.stage === 'done') continue;
    if (!c.teams.includes(clubId) && !c.pending.some((p) => p.clubId === clubId)) continue;
    const end = c.startDay + cupLength(c.size) - 1;
    if (first <= end + 1 && last >= c.startDay - 1) return true;
  }
  if (clubId === world.userClubId && friendlyRequests(world).some((r) => r.day >= first - 1 && r.day <= last + 1)) return true;
  return false;
}

export function clubFreeFor(world: World, clubId: number, startDay: number, size: CupSize, ignoreCup = -1): boolean {
  return !clubBusy(world, clubId, startDay, startDay + cupLength(size) - 1, ignoreCup);
}

/** The days the user's club could start a tournament of its own on: all of it in the pre-season's window, far enough ahead. */
export function hostDates(world: World, size: CupSize): number[] {
  const club = world.userClubId;
  if (club < 0) return [];
  const start = seasonStart(world);
  const w = friendlyWindow(world);
  const out: number[] = [];
  const len = cupLength(size);
  for (let d = Math.max(start + w.first, world.day + FRIENDLY_NOTICE_DAYS + 2); d + len - 1 <= start + w.last; d++) {
    if (clubFreeFor(world, club, d, size)) out.push(d);
  }
  return out;
}

/** The clubs worth asking: a squad to bring, of a size not far off, from the country first. */
export function cupCandidates(world: World, host: number, startDay: number, size: CupSize, exclude: readonly number[] = []): number[] {
  const h = world.clubs[host];
  if (h === undefined) return [];
  const skip = new Set(exclude);
  return world.clubs
    .filter((c) => c.id !== host && !skip.has(c.id) && c.exhibition !== true && c.players.length >= 12 &&
      c.reputation >= h.reputation * 0.4 && c.reputation <= h.reputation * 1.6 && clubFreeFor(world, c.id, startDay, size))
    .sort((a, b) => Number(b.nation === h.nation) - Number(a.nation === h.nation) ||
      Math.abs(a.reputation - h.reputation) - Math.abs(b.reputation - h.reputation))
    .map((c) => c.id);
}

function cupsThisSeason(world: World, clubId: number): number {
  return (world.preseasonCups?.cups ?? []).filter((c) => c.season === world.season && c.stage !== 'cancelled' &&
    (c.teams.includes(clubId) || c.pending.some((p) => p.clubId === clubId))).length;
}

/** Why the user's club can't host this tournament, or null if it can. */
export function hostBlock(world: World, size: CupSize, startDay: number, invitees: readonly number[]): string | null {
  const club = world.clubs[world.userClubId];
  if (club === undefined) return 'You have no club.';
  if (cupsThisSeason(world, club.id) >= MAX_CUPS) return `${MAX_CUPS} tournaments a pre-season is as many as there is room for.`;
  if (!hostDates(world, size).includes(startDay)) return 'Pick free dates inside the pre-season, at least a week ahead.';
  if (new Set(invitees).size !== size - 1 || invitees.includes(club.id)) return `Invite ${size - 1} clubs.`;
  for (const id of invitees) {
    const c = world.clubs[id];
    if (c === undefined || c.players.length < 12) return 'One of the clubs has no squad to bring.';
    if (!clubFreeFor(world, id, startDay, size)) return `${c.name} have a match around those dates.`;
  }
  return null;
}

function cupName(world: World, host: number, seed: number): string {
  const c = world.clubs[host];
  const kinds = ['Summer Cup', 'Invitational', 'Trophy', 'Pre-season Cup'];
  return `${c?.name ?? 'Club'} ${kinds[seed % kinds.length]}`;
}

/** How likely a club is to say yes to a tournament — a week's volleyball is a better offer than one match. */
function cupInterest(world: World, clubId: number): number {
  return Math.min(0.95, friendlyInterest(world, clubId, false) + 0.1);
}

/**
 * The user's club hosts a tournament: the invitations go out, each answered within a few days.
 * A club that says no is replaced by another asked in its place, until every place is taken.
 */
export function hostCup(world: World, size: CupSize, startDay: number, invitees: readonly number[]): PreseasonCup | null {
  if (hostBlock(world, size, startDay, invitees) !== null) return null;
  const s = cupsState(world);
  const host = world.userClubId;
  const id = s.nextId++;
  const cup: PreseasonCup = {
    id, season: world.season, name: cupName(world, host, id + world.season), host, size,
    teams: [host], pending: [], declined: [], groups: [], startDay, fixtureIds: [], stage: 'forming',
    prize: cupPrize(world.clubs[host].reputation, size), placings: [],
  };
  for (const c of invitees) cup.pending.push({ clubId: c, answerOn: Math.min(startDay - 3, world.day + world.rng.int(1, 3)) });
  s.cups.push(cup);
  return cup;
}

/** Call the tournament off — the user's own, before it starts. */
export function cancelCup(world: World, cupId: number): boolean {
  const cup = world.preseasonCups?.cups.find((c) => c.id === cupId);
  if (cup === undefined || cup.host !== world.userClubId || cup.stage !== 'forming') return false;
  cup.stage = 'cancelled';
  cup.pending = [];
  return true;
}

// ---- Invitations to the user ------------------------------------------------------------------

/**
 * Another club's tournament, with a place for the user's: the rest of the field
 * found, and the invitation in his inbox to accept or turn down.
 */
export function inviteUserToCup(world: World, host: number, size: CupSize, startDay: number, rng: Rng = world.rng): CupInvite | null {
  const user = world.userClubId;
  if (user < 0 || !clubFreeFor(world, user, startDay, size) || !clubFreeFor(world, host, startDay, size)) return null;
  const others = cupCandidates(world, host, startDay, size, [user]).slice(0, size + 4);
  if (others.length < size - 2) return null;
  const s = cupsState(world);
  const id = s.nextId++;
  const picked: number[] = [];
  while (picked.length < size - 2 && others.length > 0) picked.push(others.splice(rng.int(0, Math.min(3, others.length - 1)), 1)[0]);
  const cup: PreseasonCup = {
    id, season: world.season, name: cupName(world, host, id + world.season), host, size,
    teams: [host, ...picked], pending: [{ clubId: user, answerOn: world.day + INVITE_DAYS }], declined: [], groups: [],
    startDay, fixtureIds: [], stage: 'forming', prize: cupPrize(world.clubs[host].reputation, size), placings: [],
  };
  s.cups.push(cup);
  const invite: CupInvite = { id: s.nextInviteId++, cupId: cup.id, sentOn: world.day, expiresOn: world.day + INVITE_DAYS };
  s.invites.push(invite);
  const h = world.clubs[host];
  postMessage(world, {
    subject: `Invitation: the ${cup.name}`,
    body: `${h.name} invite ${world.clubs[user].name} to the ${cup.name}, a pre-season tournament of ${size} clubs at ${h.arenaName}, ` +
      `from ${formatDay(world, startDay)}. ` +
      (size === 4
        ? 'Everyone plays everyone, then first plays fourth and second third in the semi-finals, before the final and the match for third place. '
        : 'Two groups of four, then the quarter-finals, the semi-finals, the final and the match for third place. ') +
      `The winners take a friendly trophy and ${(cup.prize / 1000).toFixed(0)}k in prize money. Every match is a friendly. ` +
      `Answer by ${formatDay(world, invite.expiresOn)}.`,
    from: h.name,
    clubId: h.id,
    category: 'matchday',
    cupInviteId: invite.id,
  });
  return invite;
}

/** A federation's invitation to its friendly tournament before the summer. */
export function inviteNationToCup(world: World, host: number, size: CupSize, startDay: number): CupInvite | null {
  const mine = userNation(world);
  if (mine < 0 || host === mine) return null;
  const free = friendlyCupDays(world, size, [mine, host]);
  if (!free.includes(startDay)) return null;
  const ranked = rankingFor(world, sideAge(mine)).filter((n) => n !== mine && n !== host && friendlyCupDays(world, size, [n]).includes(startDay));
  const at = Math.max(0, ranked.indexOf(host));
  const others = ranked.slice(Math.max(0, at - 6), at + 10).slice(0, size - 2);
  if (others.length < size - 2) return null;
  const s = cupsState(world);
  const name = `${nationName(host)} Volleyball Cup`;
  const invite: CupInvite = {
    id: s.nextInviteId++, sentOn: world.day, expiresOn: Math.min(startDay - 8, world.day + INVITE_DAYS),
    nation: { host, teams: [host, ...others], startDay, size, name },
  };
  s.invites.push(invite);
  postMessage(world, {
    subject: `Invitation: the ${name}`,
    body: `The ${nationName(host)} federation invite ${nationName(mine)} to the ${name}, a friendly tournament of ${size} national teams ` +
      `from ${formatDay(world, startDay)} — with ${others.map(nationName).join(', ')}. ` +
      `${size === 4 ? 'A round robin, then the semi-finals (first against fourth, second against third)' : 'Two groups of four, then the quarter-finals and semi-finals'}, ` +
      `the final and a match for third place. It counts for caps, not for the ranking. Answer by ${formatDay(world, invite.expiresOn)}.`,
    from: `${nationName(host)} federation`,
    category: 'international',
    aboutNation: host,
    cupInviteId: invite.id,
  });
  return invite;
}

/** The manager's answer to an invitation. Returns what happened. */
export function answerCupInvite(world: World, inviteId: number, accept: boolean): { ok: boolean; text: string } {
  const s = world.preseasonCups;
  const inv = s?.invites.find((i) => i.id === inviteId);
  if (s === undefined || inv === undefined || inv.answered !== undefined) return { ok: false, text: 'That invitation has been answered.' };
  if (inv.expiresOn < world.day) {
    inv.answered = 'expired';
    return { ok: false, text: 'That invitation has lapsed.' };
  }
  if (inv.nation !== undefined) {
    const n = inv.nation;
    if (accept) {
      if (!friendlyCupDays(world, n.size, [userNation(world)]).includes(n.startDay)) {
        return { ok: false, text: 'Your national team has something else on those dates.' };
      }
      createFriendlyCup(world, n.name, n.host, [...n.teams, userNation(world)], n.startDay, n.size);
    }
    inv.answered = accept ? 'accepted' : 'declined';
    return { ok: true, text: accept ? `You are in the ${n.name}. The squad is called three days before.` : `You have turned down the ${n.name}.` };
  }
  const cup = s.cups.find((c) => c.id === inv.cupId);
  const user = world.userClubId;
  if (cup === undefined || cup.stage !== 'forming' || user < 0) {
    inv.answered = 'expired';
    return { ok: false, text: 'That tournament is no longer on.' };
  }
  if (accept && !clubFreeFor(world, user, cup.startDay, cup.size, cup.id)) {
    return { ok: false, text: 'You have a match around those dates.' };
  }
  if (accept && cupsThisSeason(world, user) > MAX_CUPS) return { ok: false, text: `${MAX_CUPS} tournaments a pre-season is as many as there is room for.` };
  inv.answered = accept ? 'accepted' : 'declined';
  cup.pending = cup.pending.filter((p) => p.clubId !== user);
  if (accept) cup.teams.push(user);
  else {
    cup.declined.push(user);
    const next = cupCandidates(world, cup.host, cup.startDay, cup.size, [...cup.teams, ...cup.declined])[0];
    if (next !== undefined) cup.teams.push(next);
  }
  if (cup.teams.length >= cup.size) scheduleCup(world, cup);
  return { ok: true, text: accept ? `You are in the ${cup.name}, from ${formatDay(world, cup.startDay)}.` : `You have turned down the ${cup.name}.` };
}

// ---- Playing it -------------------------------------------------------------------------------

function book(world: World, cup: PreseasonCup, day: number, a: number, b: number, round: number): Fixture {
  const comp = friendlyCompetition(world);
  // The host at home; everyone else at a neutral venue — the host's arena.
  const [home, away] = b === cup.host ? [b, a] : [a, b];
  const f: Fixture = {
    id: world.fixtures.length, competitionId: comp.id, day, home, away, round,
    format: MatchFormat.BestOf5, importance: round >= FINAL ? 0.12 : 0.06,
    neutralVenue: home !== cup.host, played: false, homeSets: 0, awaySets: 0, setScores: [], mvp: -1,
  };
  addFixture(world, f);
  comp.fixtureIds.push(f.id);
  cup.fixtureIds.push(f.id);
  cupsState(world).fixtureCup[f.id] = cup.id;
  return f;
}

/** The field complete: the groups drawn on reputation, and every group match on its day. */
export function scheduleCup(world: World, cup: PreseasonCup): void {
  if (cup.stage !== 'forming') return;
  cup.teams = cup.teams.slice(0, cup.size);
  cup.pending = [];
  const seeded = [...cup.teams].sort((a, b) => (world.clubs[b]?.reputation ?? 0) - (world.clubs[a]?.reputation ?? 0));
  cup.groups = drawGroups(seeded);
  for (const group of cup.groups) {
    roundRobinPairs(group).forEach((round, r) => {
      for (const [a, b] of round) book(world, cup, cup.startDay + r, a, b, r);
    });
  }
  cup.stage = 'groups';
  if (cup.teams.includes(world.userClubId)) {
    const opp = cup.groups.find((g) => g.includes(world.userClubId))!.filter((c) => c !== world.userClubId);
    postMessage(world, {
      subject: `The ${cup.name} is on`,
      body: `Every place in the ${cup.name} is taken. ${world.clubs[world.userClubId].name} play ` +
        `${opp.map((c) => world.clubs[c]?.name ?? '?').join(', ')} from ${formatDay(world, cup.startDay)}` +
        `${cup.groups.length > 1 ? ' in the group' : ''}. The bracket is in the Calendar, under Tournaments.`,
      from: world.clubs[cup.host]?.name ?? 'Organisers',
      clubId: cup.host,
      category: 'matchday',
    });
  }
}

/** After each day's matches: the knockout drawn, the next round, or the trophy handed over. */
export function progressCup(world: World, cup: PreseasonCup): void {
  if (cup.stage !== 'groups' && cup.stage !== 'knockout') return;
  const fixtures = cupFixtures(world, cup);
  if (!fixtures.every((f) => f.played)) return;
  const nextDay = (offset: number): number => Math.max(world.day + 1, cup.startDay + offset);
  if (cup.stage === 'groups') {
    cup.stage = 'knockout';
    if (cup.size === 4) {
      for (const [a, b] of semiFinalPairs(groupTable(world, cup, 0))) book(world, cup, nextDay(3), a, b, SEMI_FINAL);
    } else {
      for (const [a, b] of quarterFinalPairs(groupTable(world, cup, 0), groupTable(world, cup, 1))) book(world, cup, nextDay(3), a, b, QUARTER_FINAL);
    }
    return;
  }
  const last = Math.max(...fixtures.map((f) => f.round));
  const round = fixtures.filter((f) => f.round === last).sort((a, b) => a.id - b.id);
  if (last === QUARTER_FINAL) {
    for (let i = 0; i < round.length; i += 2) book(world, cup, nextDay(4), winnerOf(round[i]), winnerOf(round[i + 1]), SEMI_FINAL);
    return;
  }
  if (last === SEMI_FINAL) {
    const day = nextDay(cup.size === 4 ? 4 : 5);
    book(world, cup, day, winnerOf(round[0]), winnerOf(round[1]), FINAL);
    book(world, cup, day, loserOf(round[0]), loserOf(round[1]), THIRD_PLACE);
    return;
  }
  const final = fixtures.find((f) => f.round === FINAL);
  const third = fixtures.find((f) => f.round === THIRD_PLACE);
  if (final === undefined) return;
  finishCup(world, cup, final, third);
}

/** The final placings: the four from the medal matches, then the rest on how far they got and their group record. */
export function cupPlacings(world: World, cup: PreseasonCup): number[] {
  const fixtures = cupFixtures(world, cup);
  const final = fixtures.find((f) => f.round === FINAL && f.played);
  const third = fixtures.find((f) => f.round === THIRD_PLACE && f.played);
  if (final === undefined) return [];
  const top = [winnerOf(final), loserOf(final)];
  if (third !== undefined) top.push(winnerOf(third), loserOf(third));
  const rows = cup.groups.flatMap((_, i) => groupTable(world, cup, i));
  const rest = cup.teams.filter((c) => !top.includes(c)).sort((a, b) =>
    compareTableRows(rows.find((r) => r.clubId === a)!, rows.find((r) => r.clubId === b)!));
  return [...top, ...rest];
}

/**
 * The trophy handed over: prize money to the winners, a friendly trophy in their cabinet — and
 * nothing more. No title, no honours, no reputation, no achievement: it is the pre-season.
 */
function finishCup(world: World, cup: PreseasonCup, final: Fixture, third: Fixture | undefined): void {
  cup.placings = cupPlacings(world, cup);
  cup.stage = 'done';
  const winner = world.clubs[cup.placings[0]];
  const runnerUp = world.clubs[cup.placings[1]];
  if (winner === undefined || runnerUp === undefined) return;
  winner.finances.balance += cup.prize;
  winner.finances.seasonIncome += cup.prize;
  cupsState(world).trophies.push({ name: cup.name, year: world.year, season: cup.season, clubId: winner.id, prize: cup.prize });
  const score = `${Math.max(final.homeSets, final.awaySets)}-${Math.min(final.homeSets, final.awaySets)}`;
  const thirdName = third !== undefined ? world.clubs[winnerOf(third)]?.name : undefined;
  postNews(world, {
    kind: 'result',
    headline: `${winner.name} win the ${cup.name}`,
    body: `${winner.name} beat ${runnerUp.name} ${score} in the final of the ${cup.name}, a pre-season tournament.` +
      `${thirdName !== undefined ? ` ${thirdName} finished third.` : ''}`,
    nation: winner.nation,
    clubId: winner.id,
    otherClubId: runnerUp.id,
    fans: { story: 'match', club: winner.id, other: runnerUp.id, score },
  });
  const user = world.userClubId;
  const place = cup.placings.indexOf(user);
  if (place < 0) return;
  const places = ['won', 'finished second in', 'finished third in', 'finished fourth in'];
  postMessage(world, {
    subject: place === 0 ? `Winners of the ${cup.name}` : `The ${cup.name}: ${['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][place]}`,
    body: place === 0
      ? `${winner.name} beat ${runnerUp.name} ${score} in the final and lift the ${cup.name} — a friendly trophy for the cabinet, ` +
        `and ${(cup.prize / 1000).toFixed(0)}k in prize money. It is the pre-season: it counts for nothing else.`
      : `${world.clubs[user].name} ${places[place] ?? `finished ${place + 1}th in`} the ${cup.name}. ${winner.name} took the trophy, beating ${runnerUp.name} ${score} in the final.`,
    from: world.clubs[cup.host]?.name ?? 'Organisers',
    clubId: cup.host,
    category: 'matchday',
  });
}

/**
 * The tournaments' day: invitations answered — a no replaced by another club
 * asked — fields completed and drawn, the next round after the day's matches,
 * invitations lapsed; and, once a pre-season, an invitation or two for the
 * user's club and national team.
 */
export function preseasonCupsDay(world: World): void {
  const s = world.preseasonCups;
  if (s !== undefined) {
    for (const cup of s.cups) {
      if (cup.stage === 'forming') formCup(world, cup);
      else progressCup(world, cup);
    }
    for (const inv of s.invites) {
      if (inv.answered === undefined && inv.expiresOn < world.day) {
        inv.answered = 'expired';
        if (inv.cupId !== undefined) {
          const cup = s.cups.find((c) => c.id === inv.cupId);
          if (cup !== undefined && cup.stage === 'forming') {
            cup.pending = cup.pending.filter((p) => p.clubId !== world.userClubId);
            cup.declined.push(world.userClubId);
            formCup(world, cup);
          }
        }
      }
    }
    // Only this season's and last are kept in play; the trophies are kept for good.
    s.cups = s.cups.filter((c) => c.season >= world.season - 1);
    s.invites = s.invites.filter((i) => i.sentOn >= world.day - DAYS_PER_SEASON);
  }
  rollClubInvite(world);
  rollNationInvite(world);
}

/** Answers due today; a no replaced; the field filled at the last — and drawn once it is full. */
function formCup(world: World, cup: PreseasonCup): void {
  const user = world.userClubId;
  for (const p of [...cup.pending]) {
    if (p.clubId === user && cup.host !== user) continue; // His own answer, from the invitation.
    if (p.answerOn > world.day) continue;
    cup.pending = cup.pending.filter((x) => x !== p);
    const them = world.clubs[p.clubId];
    const yes = them !== undefined && clubFreeFor(world, p.clubId, cup.startDay, cup.size, cup.id) && world.rng.chance(cupInterest(world, p.clubId));
    if (yes) cup.teams.push(p.clubId);
    else {
      cup.declined.push(p.clubId);
      const next = cupCandidates(world, cup.host, cup.startDay, cup.size, [...cup.teams, ...cup.declined, ...cup.pending.map((x) => x.clubId)])[0];
      if (next !== undefined) cup.pending.push({ clubId: next, answerOn: Math.min(cup.startDay - 2, world.day + world.rng.int(1, 2)) });
    }
    if (cup.host === user && them !== undefined) {
      postMessage(world, {
        subject: `${them.name} ${yes ? 'accept' : 'decline'}: the ${cup.name}`,
        body: yes
          ? `${them.name} will be glad to play in the ${cup.name}. ${cup.teams.length} of ${cup.size} places are taken.`
          : `${them.name} cannot fit the ${cup.name} into their pre-season. Another club has been asked in their place.`,
        from: them.name,
        clubId: them.id,
        category: 'matchday',
      });
    }
  }
  // Two days out and still short: the clubs that will always come are asked, and come.
  if (cup.teams.length + cup.pending.filter((p) => p.clubId === user).length < cup.size && world.day >= cup.startDay - 2) {
    cup.pending = cup.pending.filter((p) => p.clubId === user && cup.host !== user);
    const fill = cupCandidates(world, cup.host, cup.startDay, cup.size, [...cup.teams, ...cup.declined, user]);
    while (cup.teams.length + cup.pending.length < cup.size && fill.length > 0) cup.teams.push(fill.shift()!);
  }
  if (cup.teams.length >= cup.size) scheduleCup(world, cup);
  else if (world.day >= cup.startDay - 1) {
    cup.stage = 'cancelled';
    if (cup.host === user) {
      postMessage(world, {
        subject: `The ${cup.name} is off`,
        body: `Not enough clubs could come to the ${cup.name}, and it has been called off.`,
        from: `${world.clubs[user]?.name ?? 'Club'} Secretary`,
        clubId: user,
        category: 'matchday',
      });
    }
  }
}

/** Once a pre-season, early on, a club of some standing may ask the user's to its tournament. */
function rollClubInvite(world: World): void {
  const user = world.clubs[world.userClubId];
  const s = cupsState(world);
  if (user === undefined || user.exhibition === true || s.invitedSeason === world.season) return;
  const d = world.day - seasonStart(world);
  const w = friendlyWindow(world);
  if (d < w.first - 28 || d > w.last - 14) return;
  // On dice of their own: the world's draws stay as they were.
  const rng = new Rng(`cup-invite:${world.seed}:${world.day}`);
  if (!rng.chance(d >= w.first - 10 ? 0.5 : 0.12)) return;
  s.invitedSeason = world.season;
  const size: CupSize = rng.chance(0.55) ? 4 : 8;
  const firstStart = Math.max(seasonStart(world) + w.first, world.day + INVITE_DAYS + 3);
  const dates: number[] = [];
  for (let day = firstStart; day + cupLength(size) - 1 <= seasonStart(world) + w.last; day++) dates.push(day);
  if (dates.length === 0) return;
  const startDay = dates[rng.int(0, Math.min(6, dates.length - 1))];
  const hosts = world.clubs.filter((c) => c.id !== user.id && c.exhibition !== true && c.players.length >= 12 &&
    c.reputation >= user.reputation * 0.9 && c.reputation <= user.reputation * 1.8 && clubFreeFor(world, c.id, startDay, size))
    .sort((a, b) => Number(b.nation === user.nation) - Number(a.nation === user.nation) || b.reputation - a.reputation)
    .slice(0, 8);
  if (hosts.length === 0) return;
  inviteUserToCup(world, hosts[rng.int(0, hosts.length - 1)].id, size, startDay, rng);
}

/** And once a season, before the summer's tournaments, a federation may ask the national team to its own. */
function rollNationInvite(world: World): void {
  const mine = userNation(world);
  const s = cupsState(world);
  if (mine < 0 || s.nationInvitedSeason === world.season) return;
  const dates = friendlyCupDays(world, 4, [mine]).filter((d) => d >= world.day + 14);
  const rng = new Rng(`cup-nation-invite:${world.seed}:${world.day}`);
  if (dates.length === 0 || !rng.chance(0.04)) return;
  s.nationInvitedSeason = world.season;
  const ranked = rankingFor(world, sideAge(mine));
  const at = ranked.indexOf(mine);
  const hosts = ranked.filter((n) => n !== mine).slice(Math.max(0, at - 8), at + 8);
  const startDay = dates[rng.int(0, Math.min(5, dates.length - 1))];
  for (const h of hosts.sort(() => rng.next() - 0.5)) {
    const size: CupSize = rng.chance(0.6) ? 4 : 8;
    if (inviteNationToCup(world, h, size, startDay) !== null) return;
  }
}

/** The user's national team hosts its own friendly tournament: the nations asked come, if they are free. */
export function hostNationCup(world: World, size: CupSize, startDay: number, invitees: readonly number[]): { ok: boolean; text: string } {
  const mine = userNation(world);
  if (mine < 0) return { ok: false, text: 'You don\'t coach a national team.' };
  if (new Set(invitees).size !== size - 1 || invitees.includes(mine)) return { ok: false, text: `Invite ${size - 1} nations.` };
  if (!friendlyCupDays(world, size, [mine, ...invitees]).includes(startDay)) return { ok: false, text: 'Those dates don\'t work for every team.' };
  const I = internationals(world);
  if (I.tournaments.some((t) => t.cup !== undefined && t.season === world.season && t.teams.includes(mine) && t.status !== 'done')) {
    return { ok: false, text: 'Your national team is already in a friendly tournament this season.' };
  }
  const t = createFriendlyCup(world, `${nationName(mine)} Volleyball Cup`, mine, [mine, ...invitees], startDay, size);
  return { ok: true, text: `The ${t.name} is arranged, from ${formatDay(world, startDay)}. The squad is called three days before.` };
}
