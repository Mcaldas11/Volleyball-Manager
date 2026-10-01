/**
 * The manager's career.
 *
 * Every club's board keeps a running view of its head coach in
 * `boardConfidence`: each result moves it against what the club's standing
 * says it should manage, the league table weighs on it at the start of every
 * month, and the season's final placing against the summer's target settles
 * it. Let it fall far enough and the coach is out — the user as surely as
 * anyone else, though a board that appointed him always warns him first.
 *
 * Sacked coaches leave vacancies, and the vacancies are the job market. Clubs
 * approach the user when his name fits theirs, he can apply for any of them,
 * and he can walk out on his own club whenever he likes. Out of work, the
 * calendar keeps running until somebody takes him on.
 */

import { newsCoachAppointed, newsCoachSacked } from './news.ts';
import { compareTableRows, type Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { StaffRole, type Staff } from '../model/staff.ts';
import { entryNotices, isCupCompetition } from '../season/cups.ts';
import { finalStandingsOrder } from '../season/playoffs.ts';
import { formatDay, MONTH_STARTS, ordinal, postMessage, welcomeMessages } from './inbox.ts';
import { generateStaff } from './worldGen.ts';
import {
  DAYS_PER_SEASON, dayOfSeason, euros, newCareer, type Competition, type SeasonRecord, type World,
} from './world.ts';

/** How a job came to an end. */
export type JobExit = 'resigned' | 'sacked' | 'moved';

/** One spell in charge of a club. */
export interface ManagerJob {
  clubId: number;
  startDay: number;
  /** Last day in charge; -1 while the job is current. */
  endDay: number;
  exit: JobExit | null;
  won: number;
  lost: number;
  /** Titles won in charge. */
  trophies: Array<{ competitionId: number; season: number }>;
}

/** A club's offer of its head coach's job. */
export interface JobOffer {
  id: number;
  clubId: number;
  madeOn: number;
  /** The last day it can be accepted. */
  expiresOn: number;
  /** The answer to an application of the user's, rather than an approach. */
  applied: boolean;
}

/** An application for a vacancy, waiting on the club's answer. */
export interface JobApplication {
  clubId: number;
  sentOn: number;
  answerOn: number;
}

/** A club without a head coach. */
export interface Vacancy {
  clubId: number;
  since: number;
  /** When the club means to have someone in — it waits on any offer or
   *  application of the user's before it looks elsewhere. */
  fillsOn: number;
}

export interface ManagerCareer {
  /** 0-10000, on the same scale as club reputation: what the name is worth to a board. */
  reputation: number;
  /** Every job held, oldest first; the last is current while employed. */
  jobs: ManagerJob[];
  offers: JobOffer[];
  applications: JobApplication[];
  nextOfferId: number;
  /** How far the current board has gone in warning him: 0 none, 1 concerned, 2 final warning. */
  warning: number;
  /** Day the final warning was given, -1 if none this spell. */
  warnedOn: number;
  /** Clubs he left on bad terms or turned down, and the day each will consider him again. */
  blockedUntil: Map<number, number>;
  /** Day a club last approached him unprompted, -1 if never. */
  lastApproach: number;
  /** Days on holiday this season (see holiday.ts). Absent until he first takes one. */
  holiday?: { season: number; days: number };
}

/** Where a new coach's board starts: the benefit of the doubt. */
export const CONFIDENCE_START = 60;
/** Below this in the season, the board acts. */
const SACK_IN_SEASON = 12;
/** Below this after the season's reckoning, the board makes a change for the next. */
const SACK_AT_SEASON_END = 20;
/** The board first voices concern… */
const CONCERNED = 35;
/** …then gives its final warning. */
const FINAL_WARNING = 22;
/** Back above this and the warnings are forgotten. */
const RECOVERED = 45;
/** Nobody is sacked in his first weeks in the job. */
const GRACE_DAYS = 45;
/** Boards judge results from the start of the league season to the end of the playoffs. */
const SEASON_OPENS = 55;
const SEASON_CLOSES = 310;
/** The user is sacked in the season only once a final warning has had this long to work. */
const WARNING_NOTICE_DAYS = 10;
/** How long a job offer stands. */
const OFFER_DAYS = 10;
/** Out of work this long without a call, and some club will make one. */
const SILENCE_LIMIT_DAYS = 35;
/** Reputation gap at which the stronger club is a 10-to-1 favourite. */
const RESULT_SCALE = 2500;

function clampConfidence(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function clampReputation(v: number): number {
  return Math.round(Math.max(0, Math.min(10000, v)));
}

function userClubOf(world: World): Club | undefined {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
}

/**
 * The job the user holds now. A club assigned by hand — the CLI, a test — has
 * no job on record, and its board leaves him alone: only a board that
 * appointed him judges him.
 */
export function currentJob(world: World): ManagerJob | undefined {
  const job = world.career.jobs[world.career.jobs.length - 1];
  return job !== undefined && job.endDay < 0 && job.clubId === world.userClubId ? job : undefined;
}

/** Out of work, between jobs — as opposed to not having picked a first club yet. */
export function isUnemployed(world: World): boolean {
  return world.userClubId < 0 && world.career.jobs.length > 0;
}

/** The day the user's last job ended, -1 if he has never left one. */
export function lastJobEnded(world: World): number {
  const last = world.career.jobs[world.career.jobs.length - 1];
  return last === undefined ? -1 : last.endDay;
}

export function vacancyAt(world: World, clubId: number): Vacancy | undefined {
  return world.vacancies.find((v) => v.clubId === clubId);
}

/** The board's mood, in the words it would use. */
export function boardMood(confidence: number): string {
  if (confidence >= 75) return 'Delighted';
  if (confidence >= 60) return 'Satisfied';
  if (confidence >= RECOVERED) return 'Stable';
  if (confidence >= CONCERNED) return 'Under pressure';
  if (confidence >= FINAL_WARNING) return 'Concerned';
  return 'Final warning';
}

/** "2027/28" for a season index. */
function seasonName(world: World, season: number): string {
  const y = world.startYear + season;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

function recordLine(job: ManagerJob | undefined): string {
  if (job === undefined || job.won + job.lost === 0) return '';
  return ` — ${job.won + job.lost} matches, ${job.won} won and ${job.lost} lost`;
}

// ---- Head coaches -------------------------------------------------------------

/** The club's own head coach, if it has one (never the user). */
export function headCoachOf(world: World, club: Club): Staff | undefined {
  for (const id of club.staff) {
    const s = world.staff[id];
    if (s !== undefined && s.role === StaffRole.HeadCoach) return s;
  }
  return undefined;
}

function detachHeadCoaches(world: World, club: Club): void {
  club.staff = club.staff.filter((id) => {
    const s = world.staff[id];
    if (s === undefined || s.role !== StaffRole.HeadCoach) return true;
    s.clubId = -1;
    return false;
  });
}

function openVacancy(world: World, club: Club): void {
  detachHeadCoaches(world, club);
  if (vacancyAt(world, club.id) !== undefined) return;
  world.vacancies.push({ clubId: club.id, since: world.day, fillsOn: world.day + world.rng.int(10, 35) });
}

/** An AI club parts company with its coach, whose name takes the knock. */
function sackCoach(world: World, club: Club): void {
  const coach = headCoachOf(world, club);
  if (coach !== undefined) coach.reputation = Math.round(coach.reputation * 0.9);
  newsCoachSacked(world, club, coach);
  openVacancy(world, club);
}

/**
 * The club appoints someone: a coach out of work whose name fits it, or,
 * failing one, somebody new to the game — so the pool of coaches only grows
 * when it has to.
 */
function fillVacancy(world: World, v: Vacancy): void {
  world.vacancies = world.vacancies.filter((x) => x !== v);
  const club = world.clubs[v.clubId];
  if (club === undefined || club.id === world.userClubId) return;
  let best: Staff | undefined;
  let bestGap = Infinity;
  for (const s of world.staff) {
    if (s.role !== StaffRole.HeadCoach || s.clubId >= 0) continue;
    const gap = Math.abs(s.reputation - club.reputation);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  const coach = best !== undefined && bestGap <= Math.max(400, club.reputation * 0.3)
    ? best
    : generateStaff(world, world.rng, club.nation, StaffRole.HeadCoach, club.reputation);
  coach.clubId = club.id;
  club.staff.push(coach.id);
  club.coachSince = world.day;
  club.boardConfidence = CONFIDENCE_START;
  newsCoachAppointed(world, club, coach);
}

// ---- Taking a job, and leaving one ----------------------------------------------

/** Where a first-time head coach's name starts: a little below the club that gave him the job. */
function startingReputation(club: Club): number {
  return clampReputation(Math.max(600, club.reputation * 0.7));
}

/**
 * The summer's comings and goings on the benches, as the career begins: a
 * few clubs are already looking for a coach, and in no great hurry.
 */
function openingMarket(world: World, except: number): void {
  for (const club of world.clubs) {
    if (club.id === except || vacancyAt(world, club.id) !== undefined || !world.rng.chance(0.03)) continue;
    detachHeadCoaches(world, club);
    world.vacancies.push({ clubId: club.id, since: world.day, fillsOn: world.day + world.rng.int(20, 60) });
  }
}

/**
 * Put the user in charge of a club — the career's first job, or a move from
 * wherever he is now. The club's own coach makes way, any other job search
 * ends, and the board sets out what it expects.
 */
export function appointManager(world: World, clubId: number): void {
  const club = world.clubs[clubId];
  if (club === undefined) return;
  const career = world.career;
  if (world.userClubId >= 0 && world.userClubId !== clubId) leaveClub(world, 'moved');
  if (career.jobs.length === 0) {
    career.reputation = startingReputation(club);
    openingMarket(world, clubId);
  }

  detachHeadCoaches(world, club);
  world.vacancies = world.vacancies.filter((v) => v.clubId !== clubId);
  world.userClubId = clubId;
  club.coachSince = world.day;
  club.boardConfidence = CONFIDENCE_START;
  career.jobs.push({ clubId, startDay: world.day, endDay: -1, exit: null, won: 0, lost: 0, trophies: [] });
  career.offers = [];
  career.applications = [];
  career.warning = 0;
  career.warnedOn = -1;

  welcomeMessages(world);
  // The cup draws only mean something before the season is under way.
  if (dayOfSeason(world) < SEASON_OPENS) entryNotices(world);
}

/**
 * The user's time at his club is over, whichever way it ended. Business he
 * had in hand ends with the job — talks, bids for his players, scouting
 * missions, press conferences; deals already agreed stand, as the club's.
 * The club starts looking for his successor.
 */
function leaveClub(world: World, exit: JobExit): Club | undefined {
  const club = userClubOf(world);
  if (club === undefined) return undefined;
  const career = world.career;
  const job = currentJob(world);
  if (job !== undefined) {
    job.endDay = world.day;
    job.exit = exit;
  }

  world.talks = [];
  world.incomingOffers = [];
  world.pendingInterviews = [];
  world.scoutingQueue = [];
  for (const p of club.players) {
    world.players.setFlag(p, PlayerFlag.Transferable, false);
    world.players.setFlag(p, PlayerFlag.LoanListed, false);
  }
  world.userClubId = -1;
  career.warning = 0;
  career.warnedOn = -1;
  openVacancy(world, club);

  if (exit === 'sacked') {
    career.reputation = clampReputation(career.reputation * 0.92);
    career.blockedUntil.set(club.id, world.day + 2 * DAYS_PER_SEASON);
  } else if (exit === 'resigned') {
    career.reputation = clampReputation(career.reputation * 0.97);
    career.blockedUntil.set(club.id, world.day + DAYS_PER_SEASON);
  }
  return club;
}

/** The user walks out on his club. The board accepts; his name takes a small knock. */
export function resign(world: World): boolean {
  const job = currentJob(world);
  const club = leaveClub(world, 'resigned');
  if (club === undefined) return false;
  postMessage(world, {
    subject: `You have resigned from ${club.name}`,
    body: `The board of ${club.name} has accepted your resignation as head coach with immediate effect` +
      `${recordLine(job)}. The club will now look for your successor. Every club looking for a head coach ` +
      'is listed in the Job Centre.',
    from: `${club.name} Board`,
    clubId: club.id,
    category: 'career',
  });
  return true;
}

function sackUser(world: World, reason: string): void {
  const job = currentJob(world);
  const club = leaveClub(world, 'sacked');
  if (club === undefined) return;
  postMessage(world, {
    subject: `Sacked by ${club.name}`,
    body: `The board of ${club.name} has decided to relieve you of your duties as head coach with immediate ` +
      `effect. ${reason} We thank you for your work${recordLine(job)} and wish you well for the future.`,
    from: `${club.name} Board`,
    clubId: club.id,
    category: 'career',
  });
}

// ---- Offers and applications ------------------------------------------------------

/** How likely a club is to want the user, 0-1: his name against theirs. */
export function hiringChance(world: World, club: Club): number {
  const gap = world.career.reputation - club.reputation * 0.85;
  return Math.max(0.03, Math.min(0.95, 0.5 + gap / 2200));
}

function blocked(world: World, clubId: number): boolean {
  const until = world.career.blockedUntil.get(clubId);
  return until !== undefined && until > world.day;
}

/** Why the user can't apply for a club's job right now, or null if he can. */
export function applicationBlock(world: World, clubId: number): string | null {
  const club = world.clubs[clubId];
  const career = world.career;
  if (club === undefined) return 'There is no such club.';
  if (clubId === world.userClubId) return 'You already manage this club.';
  if (career.offers.some((o) => o.clubId === clubId)) return `${club.name} have already offered you the job.`;
  if (career.applications.some((a) => a.clubId === clubId)) return `You have applied — ${club.name} will answer soon.`;
  if (vacancyAt(world, clubId) === undefined) return `${club.name} are not looking for a head coach.`;
  if (blocked(world, clubId)) return `${club.name} will not consider you again so soon.`;
  return null;
}

/** Apply for a vacancy; the club answers within a week. */
export function applyForJob(world: World, clubId: number): JobApplication | null {
  if (applicationBlock(world, clubId) !== null) return null;
  const app: JobApplication = { clubId, sentOn: world.day, answerOn: world.day + world.rng.int(3, 7) };
  world.career.applications.push(app);
  return app;
}

/**
 * Take a job on offer. From another club, the user leaves that one first,
 * with its board's thanks.
 */
export function acceptJobOffer(world: World, offerId: number): boolean {
  const offer = world.career.offers.find((o) => o.id === offerId);
  const to = offer !== undefined ? world.clubs[offer.clubId] : undefined;
  if (offer === undefined || to === undefined || offer.expiresOn < world.day) return false;
  const job = currentJob(world);
  const from = leaveClub(world, 'moved');
  if (from !== undefined) {
    postMessage(world, {
      subject: `Farewell to ${from.name}`,
      body: `You leave ${from.name} for ${to.name}${recordLine(job)}. The board wishes you well in your new job.`,
      from: `${from.name} Board`,
      clubId: from.id,
      category: 'career',
    });
  }
  appointManager(world, to.id);
  return true;
}

/** Turn a job down. The club moves on, and won't come back for a while. */
export function declineJobOffer(world: World, offerId: number): void {
  const career = world.career;
  const offer = career.offers.find((o) => o.id === offerId);
  if (offer === undefined) return;
  career.offers = career.offers.filter((o) => o !== offer);
  career.blockedUntil.set(offer.clubId, world.day + 90);
}

function makeOffer(world: World, club: Club, applied: boolean): JobOffer {
  const career = world.career;
  const offer: JobOffer = {
    id: career.nextOfferId++,
    clubId: club.id,
    madeOn: world.day,
    expiresOn: world.day + OFFER_DAYS,
    applied,
  };
  career.offers.push(offer);
  const league = world.competitions[club.leagueId];
  postMessage(world, {
    subject: applied ? `${club.name} offer you the job` : `${club.name} want you as their head coach`,
    body: (applied
      ? `The board of ${club.name} has considered your application and would like you to become the club's new head coach.`
      : `${club.name} are looking for a new head coach, and the board would like it to be you.`) +
      `${league !== undefined ? ` They play in the ${league.name}, and` : ' The board'} would expect a finish of ` +
      `${ordinal(club.boardExpectation)} or better. The offer stands until ${formatDay(world, offer.expiresOn)}.`,
    from: `${club.name} Board`,
    clubId: club.id,
    jobOfferId: offer.id,
    category: 'career',
  });
  return offer;
}

function answerApplications(world: World): void {
  const career = world.career;
  for (const app of [...career.applications]) {
    if (app.answerOn > world.day) continue;
    career.applications = career.applications.filter((a) => a !== app);
    const club = world.clubs[app.clubId];
    if (club === undefined) continue;
    if (vacancyAt(world, club.id) !== undefined && world.rng.chance(hiringChance(world, club))) {
      makeOffer(world, club, true);
      continue;
    }
    postMessage(world, {
      subject: `Application to ${club.name} unsuccessful`,
      body: `Thank you for your interest in the head coach's job at ${club.name}. After careful consideration, ` +
        'the board has decided not to take your application any further. We wish you well in your search.',
      from: `${club.name} Board`,
      clubId: club.id,
      category: 'career',
    });
  }
}

/** A club the user could be approached by: not his own, not one he fell out with, not one already talking to him. */
function approachable(world: World, clubId: number): boolean {
  const career = world.career;
  return clubId !== world.userClubId && !blocked(world, clubId) &&
    !career.offers.some((o) => o.clubId === clubId) && !career.applications.some((a) => a.clubId === clubId);
}

/**
 * Clubs looking for a coach call the user when his name fits theirs. In work,
 * only a bigger club calls, and only while his own board is happy; out of
 * work, more of them do, and a long enough silence always ends — if nobody is
 * hiring at his level, some struggling club decides it is time for a change.
 */
function approaches(world: World): void {
  const career = world.career;
  if (career.jobs.length === 0) return;
  const own = userClubOf(world);
  if (own !== undefined && currentJob(world) === undefined) return;
  const employed = own !== undefined;
  if (career.offers.length >= (employed ? 1 : 3)) return;
  if (employed && own.boardConfidence < 50) return;
  if (career.lastApproach >= 0 && world.day - career.lastApproach < (employed ? 42 : 7)) return;

  const rep = career.reputation;
  const outFor = employed ? 0 : world.day - lastJobEnded(world);
  const lower = employed ? own.reputation * 1.1 : outFor > 90 ? 0 : rep * 0.35;
  const upper = rep * (employed ? 1.35 : 1.2);
  const candidates = world.vacancies
    .map((v) => world.clubs[v.clubId])
    .filter((c): c is Club => c !== undefined && c.reputation >= lower && c.reputation <= upper && approachable(world, c.id));

  for (const club of candidates) {
    if (!world.rng.chance(employed ? 0.08 : 0.15)) continue;
    makeOffer(world, club, false);
    career.lastApproach = world.day;
    return;
  }

  const quiet = world.day - Math.max(career.lastApproach, lastJobEnded(world));
  if (employed || career.offers.length > 0 || quiet < SILENCE_LIMIT_DAYS) return;
  const club = [...candidates].sort((a, b) => b.reputation - a.reputation)[0] ?? struggler(world, rep);
  if (club === undefined) return;
  if (vacancyAt(world, club.id) === undefined) sackCoach(world, club);
  makeOffer(world, club, false);
  career.lastApproach = world.day;
}

/** The club a little below the user's level whose board is least happy with
 *  its coach — looking further down only if nobody near his level will do. */
function struggler(world: World, rep: number): Club | undefined {
  const within = (lower: number, upper: number): Club | undefined => {
    let best: Club | undefined;
    for (const c of world.clubs) {
      if (c.reputation > upper || c.reputation < lower || !approachable(world, c.id)) continue;
      if (best === undefined || c.boardConfidence < best.boardConfidence) best = c;
    }
    return best;
  };
  return within(rep * 0.6, rep) ?? within(rep * 0.3, Math.max(rep, 800));
}

// ---- The boards --------------------------------------------------------------------

/**
 * Each result moves both clubs' boards: a win they were expected to get is
 * worth little, an upset a lot, and a cup final more than a September league
 * match. The user's record in the job is kept here too.
 */
export function boardResults(world: World, fixtureIds: readonly number[]): void {
  const job = currentJob(world);
  for (const id of fixtureIds) {
    const f = world.fixtures[id];
    if (f === undefined || !f.played) continue;
    const comp = world.competitions[f.competitionId];
    if (comp === undefined || comp.kind === 'international') continue;
    const home = world.clubs[f.home];
    const away = world.clubs[f.away];
    if (home === undefined || away === undefined) continue;
    const homeWon = f.homeSets > f.awaySets;
    const weight = 2 + 3 * f.importance;
    judgeResult(home, away, homeWon, weight);
    judgeResult(away, home, !homeWon, weight);
    if (job !== undefined && (f.home === job.clubId || f.away === job.clubId)) {
      if ((f.home === job.clubId) === homeWon) job.won++;
      else job.lost++;
    }
  }
  judgeUser(world);
}

function judgeResult(club: Club, opponent: Club, won: boolean, weight: number): void {
  const expected = 1 / (1 + Math.pow(10, (opponent.reputation - club.reputation) / RESULT_SCALE));
  club.boardConfidence = clampConfidence(club.boardConfidence + ((won ? 1 : 0) - expected) * weight);
}

/** On the first of every month in the season, every board looks at the league table against its target. */
function monthlyReview(world: World): void {
  const d = dayOfSeason(world);
  if (d <= 62 || d > SEASON_CLOSES) return;
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.table.length === 0) continue;
    [...comp.table].sort(compareTableRows).forEach((row, i) => {
      const club = world.clubs[row.clubId];
      if (club === undefined || row.played < 3) return;
      const gap = i + 1 - club.boardExpectation;
      const delta = gap <= 0 ? Math.min(5, 2 - gap) : -Math.min(10, gap * 2);
      club.boardConfidence = clampConfidence(club.boardConfidence + delta * Math.min(1, row.played / 8));
    });
  }
  judgeUser(world);
}

/**
 * The user's board, whenever its confidence has moved in the season: concern
 * first, then a final warning — and only once that has had time to work, the
 * sack.
 */
function judgeUser(world: World): void {
  const club = userClubOf(world);
  const job = currentJob(world);
  if (club === undefined || job === undefined) return;
  const career = world.career;
  const c = club.boardConfidence;
  if (c >= RECOVERED) {
    career.warning = 0;
    career.warnedOn = -1;
  }
  const d = dayOfSeason(world);
  if (d < SEASON_OPENS || d >= SEASON_CLOSES || world.day - job.startDay < GRACE_DAYS) return;

  if (c < SACK_IN_SEASON && career.warning >= 2 && world.day - career.warnedOn >= WARNING_NOTICE_DAYS) {
    sackUser(world, 'Results have fallen far short of what the club expects, and the board no longer believes they will improve.');
    return;
  }
  if (c < FINAL_WARNING && career.warning < 2) {
    career.warning = 2;
    career.warnedOn = world.day;
    postMessage(world, {
      subject: 'Final warning from the board',
      body: `The board's patience is running out. Results at ${club.name} must improve immediately — ` +
        'another poor run and the board will have no choice but to act.',
      clubId: club.id,
      category: 'board',
    });
  } else if (c < CONCERNED && career.warning < 1) {
    career.warning = 1;
    postMessage(world, {
      subject: 'The board is concerned',
      body: `The board has noted ${club.name}'s recent results with concern. We expect a finish of ` +
        `${ordinal(club.boardExpectation)} or better, and we expect to see an improvement soon.`,
      clubId: club.id,
      category: 'board',
    });
  }
}

/** Every AI board sits down once a week in the season; those at the end of their tether may act. */
function boardsAct(world: World): void {
  const d = dayOfSeason(world);
  if (d < SEASON_OPENS || d >= SEASON_CLOSES) return;
  for (const club of world.clubs) {
    if (club.id === world.userClubId || club.boardConfidence >= SACK_IN_SEASON) continue;
    if (world.day - club.coachSince < GRACE_DAYS || vacancyAt(world, club.id) !== undefined) continue;
    if (world.rng.chance(0.3)) sackCoach(world, club);
  }
}

/**
 * The job market's day, each morning: offers left unanswered lapse,
 * applications are answered, clubs that have waited long enough appoint a
 * coach — and on the first of the month and once a week, the boards meet.
 */
export function careerDay(world: World): void {
  const career = world.career;
  career.offers = career.offers.filter((o) => o.expiresOn >= world.day);
  answerApplications(world);
  for (const v of [...world.vacancies]) {
    if (v.fillsOn > world.day) continue;
    if (career.offers.some((o) => o.clubId === v.clubId) || career.applications.some((a) => a.clubId === v.clubId)) continue;
    fillVacancy(world, v);
  }
  if (MONTH_STARTS.includes(dayOfSeason(world))) monthlyReview(world);
  if (world.day % 7 === 3) {
    boardsAct(world);
    approaches(world);
  }
}

// ---- The end of a season -------------------------------------------------------------

/** Where a club finished its league, captured before promotion and relegation reshuffle the divisions. */
export interface SeasonFinish {
  pos: number;
  teams: number;
  tier: number;
}

export function captureFinishes(world: World): Map<number, SeasonFinish> {
  const out = new Map<number, SeasonFinish>();
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || !comp.table.some((r) => r.played > 0)) continue;
    finalStandingsOrder(comp).forEach((clubId, i) => {
      out.set(clubId, { pos: i + 1, teams: comp.table.length, tier: comp.tier });
    });
  }
  return out;
}

/** The day a title was settled: a cup's final, a league's season end. */
function decidedOn(world: World, comp: Competition): number {
  const rounds = comp.cup?.bracket?.rounds;
  const final = rounds !== undefined ? rounds[rounds.length - 1]?.[0] : undefined;
  if (isCupCompetition(comp) && final !== undefined && final.fixtureId >= 0) {
    return world.fixtures[final.fixtureId]?.day ?? world.day;
  }
  return world.day;
}

/** Titles go on the record of whichever of the user's jobs was current when they were won. */
function creditTrophies(world: World, record: SeasonRecord): void {
  for (const c of record.champions) {
    const comp = world.competitions[c.competitionId];
    if (comp === undefined) continue;
    const day = decidedOn(world, comp);
    const job = world.career.jobs.find((j) =>
      j.clubId === c.winner && j.startDay <= day && (j.endDay < 0 || j.endDay >= day));
    job?.trophies.push({ competitionId: comp.id, season: record.season });
  }
}

/**
 * The season's reckoning, once promotion and relegation are settled: every
 * board weighs where its club finished against the target it set, the title,
 * the cups and the division it will play in next — and decides whether its
 * coach starts the next season. The user hears the verdict either way.
 */
export function seasonReckoning(world: World, record: SeasonRecord, finishes: Map<number, SeasonFinish>): void {
  const cupsWon = new Map<number, number>();
  for (const c of record.champions) {
    const comp = world.competitions[c.competitionId];
    if (comp !== undefined && isCupCompetition(comp)) cupsWon.set(c.winner, (cupsWon.get(c.winner) ?? 0) + 1);
  }
  creditTrophies(world, record);
  const userId = currentJob(world) !== undefined ? world.userClubId : -1;

  for (const club of world.clubs) {
    const finish = finishes.get(club.id);
    const cups = cupsWon.get(club.id) ?? 0;
    let delta = cups * 8;
    if (finish !== undefined) {
      const gap = finish.pos - club.boardExpectation;
      delta += gap <= 0 ? Math.min(20, 6 - 4 * gap) : -Math.min(30, 7 * gap);
      if (finish.pos === 1) delta += 15;
      if (club.tier < finish.tier) delta += 20;
      if (club.tier > finish.tier) delta -= 35;
    }
    club.boardConfidence = clampConfidence(club.boardConfidence + delta);

    if (club.id === userId) {
      userVerdict(world, club, finish, cups);
    } else if (club.id !== world.userClubId && club.boardConfidence < SACK_AT_SEASON_END &&
      vacancyAt(world, club.id) === undefined && world.rng.chance(0.5)) {
      sackCoach(world, club);
    }
    // A new season is a fresh start — mostly.
    club.boardConfidence = Math.round(club.boardConfidence * 0.5 + CONFIDENCE_START * 0.5);
  }
}

/** The user's season, as his board and the wider game see it. */
function userVerdict(world: World, club: Club, finish: SeasonFinish | undefined, cups: number): void {
  const career = world.career;
  const target = club.boardExpectation;

  let rep = career.reputation;
  if (finish !== undefined) {
    rep += (target - finish.pos) * 70;
    if (finish.pos === 1) rep += 350;
    if (club.tier < finish.tier) rep += 200;
    if (club.tier > finish.tier) rep -= 300;
  }
  rep += cups * 150;
  // Managing a big club makes a name; a small one keeps it modest.
  rep += (club.reputation - rep) * 0.08;
  career.reputation = clampReputation(rep);

  if (club.boardConfidence < SACK_AT_SEASON_END) {
    sackUser(world, finish !== undefined
      ? `Finishing ${ordinal(finish.pos)} against a target of ${ordinal(target)} is not good enough, and the board has decided to make a change before the new season.`
      : 'The board has decided to make a change before the new season.');
    return;
  }
  career.warning = 0;
  career.warnedOn = -1;

  const parts: string[] = [];
  if (finish !== undefined) {
    parts.push(finish.pos < target
      ? `Finishing ${ordinal(finish.pos)} beat the board's target of ${ordinal(target)}.`
      : finish.pos === target
        ? `Finishing ${ordinal(finish.pos)} met the board's target.`
        : `Finishing ${ordinal(finish.pos)} fell short of the board's target of ${ordinal(target)}.`);
    if (club.tier < finish.tier) parts.push('Promotion is a tremendous achievement.');
    if (club.tier > finish.tier) parts.push('Relegation is a heavy blow for the club.');
  }
  if (cups > 0) parts.push(`${cups === 1 ? 'A trophy' : `${cups} trophies`} in the cabinet adds to the season.`);
  parts.push(`The board is ${boardMood(club.boardConfidence).toLowerCase()} with your work.`);
  if (club.boardConfidence < CONCERNED) parts.push('Next season has to be better.');
  postMessage(world, {
    subject: 'The board\'s verdict on the season',
    body: parts.join(' '),
    clubId: club.id,
    category: 'board',
  });
}

/**
 * Each board's target for the season: where its club ranks by standing in its
 * division, a place's leeway for all but the favourites, and survival for the
 * clubs at the foot of a division with somewhere to go down to.
 */
export function setBoardExpectations(world: World): void {
  const hasBelow = new Set<string>();
  for (const comp of world.competitions) {
    if (comp.kind === 'league') hasBelow.add(`${comp.nation}:${comp.tier - 1}`);
  }
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.participants.length === 0) continue;
    const n = comp.participants.length;
    const survival = hasBelow.has(`${comp.nation}:${comp.tier}`) && comp.relegationSlots > 0
      ? n - comp.relegationSlots
      : n;
    [...comp.participants]
      .sort((a, b) => world.clubs[b].reputation - world.clubs[a].reputation)
      .forEach((id, i) => {
        const rank = i + 1;
        world.clubs[id].boardExpectation = Math.max(1, Math.min(survival, rank <= 2 ? rank : rank + 1));
      });
  }
}

/** The board's target for the season ahead, sent to the user as it begins. */
export function seasonObjectives(world: World): void {
  const club = userClubOf(world);
  if (club === undefined || currentJob(world) === undefined) return;
  const league = world.competitions[club.leagueId];
  const f = club.finances;
  postMessage(world, {
    subject: `Objectives for ${seasonName(world, world.season)}`,
    body: `For the ${seasonName(world, world.season)} season the board expects a finish of ` +
      `${ordinal(club.boardExpectation)} or better${league !== undefined ? ` in the ${league.name}` : ''}. ` +
      `You have ${euros(f.transferBudget)} for transfers and a wage budget of ${euros(f.wageBudget)} a season.`,
    clubId: club.id,
    category: 'board',
  });
}

/**
 * Bring a save from before careers existed up to date: the club it was
 * managing becomes its first job, and the board that never had a say takes
 * over from the coach who was only ever there on paper.
 */
export function backfillCareer(world: World): void {
  world.career ??= newCareer();
  world.vacancies ??= [];
  for (const club of world.clubs) club.coachSince ??= 0;
  const club = userClubOf(world);
  if (club === undefined || world.career.jobs.length > 0) return;
  world.career.reputation = startingReputation(club);
  world.career.jobs.push({
    clubId: club.id, startDay: world.season * DAYS_PER_SEASON, endDay: -1, exit: null, won: 0, lost: 0, trophies: [],
  });
  detachHeadCoaches(world, club);
}
