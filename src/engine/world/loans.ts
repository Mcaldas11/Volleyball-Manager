/**
 * Loans.
 *
 * A loan sends a player to another club until the end of the season while
 * his contract — and his way back — stays with the club that owns him. The
 * borrowing club picks him, plays him and trains him as one of its own; his
 * wage is split between the two clubs as agreed; on 30 June he goes home.
 *
 * Loans always involve the user's club, one way or the other: the user
 * borrows players from other clubs, and other clubs borrow the user's.
 *
 * A loan is for games. The deal names the playing time the borrowing club
 * promises — a regular starter, a rotation player, a back-up — and a club
 * that has promised games gives them: a loanee short of his share starts the
 * next match. Everything he does there is kept on the loan, so his own club
 * can have his matches compiled into a report whenever it likes.
 */

import type { Club } from '../model/club.ts';
import { matchRating, playedInMatch } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, POSITION_NAMES } from '../model/positions.ts';
import { arrivalsFor, moveDay, pendingMoveOf, pendingWages, seasonOfDay } from './moves.ts';
import type { IncomingOffer } from './negotiation.ts';
import { euros, seasonEndDay, type Fixture, type GameMessage, type World } from './world.ts';

/** The playing time a borrowing club promises. */
export type LoanPlayingTime = 'starter' | 'rotation' | 'backup';

/** Best first. */
export const LOAN_PLAYING_TIMES: readonly LoanPlayingTime[] = ['starter', 'rotation', 'backup'];

export const PLAYING_TIME_NAMES: Readonly<Record<LoanPlayingTime, string>> = {
  starter: 'Regular starter',
  rotation: 'Rotation player',
  backup: 'Back-up',
};

/** The share of the borrowing club's play each promise stands for. */
export const PLAYING_TIME_SHARE: Readonly<Record<LoanPlayingTime, number>> = {
  starter: 0.85,
  rotation: 0.45,
  backup: 0.15,
};

/** Higher is more playing time. */
function playingTimeRank(t: LoanPlayingTime): number {
  return t === 'starter' ? 2 : t === 'rotation' ? 1 : 0;
}

/** What a loanee has done at the club that borrowed him, match by match. */
export interface LoanStats {
  /** The borrowing club's matches since he joined. */
  clubMatches: number;
  /** Rallies he could have played in them — a middle or a libero only ever plays two in three. */
  clubRallies: number;
  apps: number;
  /** Rallies he was on court for. */
  rallies: number;
  ratingSum: number;
  best: number;
  points: number;
  kills: number;
  attacks: number;
  /** Attack errors, blocked attacks included. */
  attackFaults: number;
  aces: number;
  blocks: number;
  digs: number;
  receptions: number;
  /** Perfect and positive passes. */
  goodReceptions: number;
  assists: number;
  mvps: number;
  /** Of the club's matches, the ones he was fit for, and the rallies he could
   *  have played in them — what a promise of games is measured against.
   *  Absent on records begun before injuries were set apart. */
  fitMatches?: number;
  fitRallies?: number;
}

export function newLoanStats(): LoanStats {
  return {
    clubMatches: 0, clubRallies: 0, apps: 0, rallies: 0, ratingSum: 0, best: 0, points: 0, kills: 0,
    attacks: 0, attackFaults: 0, aces: 0, blocks: 0, digs: 0, receptions: 0, goodReceptions: 0, assists: 0, mvps: 0,
    fitMatches: 0, fitRallies: 0,
  };
}

/** What a loan's record gained between two snapshots of it — a month's worth, say. */
export function diffLoanStats(now: LoanStats, then: LoanStats): LoanStats {
  return {
    clubMatches: now.clubMatches - then.clubMatches,
    clubRallies: now.clubRallies - then.clubRallies,
    apps: now.apps - then.apps,
    rallies: now.rallies - then.rallies,
    ratingSum: now.ratingSum - then.ratingSum,
    // A best can't be taken apart; the month's is not kept.
    best: 0,
    points: now.points - then.points,
    kills: now.kills - then.kills,
    attacks: now.attacks - then.attacks,
    attackFaults: now.attackFaults - then.attackFaults,
    aces: now.aces - then.aces,
    blocks: now.blocks - then.blocks,
    digs: now.digs - then.digs,
    receptions: now.receptions - then.receptions,
    goodReceptions: now.goodReceptions - then.goodReceptions,
    assists: now.assists - then.assists,
    mvps: now.mvps - then.mvps,
    fitMatches: (now.fitMatches ?? now.clubMatches) - (then.fitMatches ?? then.clubMatches),
    fitRallies: (now.fitRallies ?? now.clubRallies) - (then.fitRallies ?? then.clubRallies),
  };
}

export interface Loan {
  playerIdx: number;
  /** The club he is contracted to, and goes back to. */
  parentClubId: number;
  /** The club he plays for until then. */
  loanClubId: number;
  /** Share of his wage the borrowing club pays, 0-1; his own club pays the rest. */
  wageShare: number;
  /** Absolute day the loan runs to: 30 June, the end of the season. */
  endsOn: number;
  /** The playing time promised. Absent on loans agreed before it was part of the deal. */
  playingTime?: LoanPlayingTime;
  /** The day he joined, and his ability then — to measure how he has come on. */
  startDay?: number;
  startAbility?: number;
  stats?: LoanStats;
  /** Playing time has been raised — by his club, or with the user about a
   *  club of his — when he had been fit for this many matches. */
  complainedAt?: number;
  /** How reliably the borrowing club keeps its promise of games, 0-1: the
   *  chance that it starts him when he is owed. Absent means always. */
  honour?: number;
  /** Day of the last standout performance the user was told about. */
  lastHighlight?: number;
  /** The record and his ability as the last monthly update left them. */
  monthStats?: LoanStats;
  monthAbility?: number;
}

/** A snapshot of a loan, compiled into a report for the inbox. */
export interface LoanReport {
  playerIdx: number;
  loanClubId: number;
  parentClubId: number;
  fromDay: number;
  toDay: number;
  /** The loan is over — this is the final account of it. */
  final: boolean;
  playingTime?: LoanPlayingTime;
  stats: LoanStats;
  abilityStart: number;
  abilityNow: number;
  /** His last few match ratings, oldest first. */
  form: number[];
  /** The scouts' verdict, in a sentence or two. */
  verdict: string;
  /** A monthly update: the month just gone, on its own. */
  month?: { label: string; stats: LoanStats; abilityChange: number };
}

/** Most players a club can have on its books — its own out on loan included. */
export const MAX_SQUAD = 16;

/** The wage shares a loan can be agreed at. */
export const LOAN_WAGE_SHARES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** Players each position needs to field the six and a libero. */
const STARTERS_AT: Readonly<Record<Position, number>> = {
  [Position.Setter]: 1,
  [Position.Opposite]: 1,
  [Position.OutsideHitter]: 2,
  [Position.MiddleBlocker]: 2,
  [Position.Libero]: 1,
};

/** Chance each week, while a window is open, that a listed player draws an offer. */
const LOAN_OFFER_CHANCE = 0.4;
/** Most loan offers one player can have on the table at once. */
const MAX_LOAN_OFFERS = 2;

function say(world: World, msg: Omit<GameMessage, 'id' | 'day' | 'year'>): void {
  world.messages.push({ id: world.messages.length, day: world.day, year: world.year, ...msg });
}

export function loanOf(world: World, playerIdx: number): Loan | undefined {
  return world.loans.find((l) => l.playerIdx === playerIdx);
}

/** A club's own players currently out on loan elsewhere. */
export function loansOutOf(world: World, clubId: number): Loan[] {
  return world.loans.filter((l) => l.parentClubId === clubId);
}

/**
 * What a club pays its players this season: the whole wage of its own, the
 * agreed share for anyone it has borrowed, and the rest of the wage of anyone
 * it has lent out.
 */
export function wageBill(world: World, club: Club): number {
  const wage = world.players.wage;
  let bill = 0;
  for (const p of club.players) {
    const loan = world.loans.length > 0 ? loanOf(world, p) : undefined;
    bill += loan !== undefined && loan.loanClubId === club.id ? wage[p] * loan.wageShare : wage[p];
  }
  for (const loan of world.loans) {
    if (loan.parentClubId === club.id) bill += wage[loan.playerIdx] * (1 - loan.wageShare);
  }
  return Math.round(bill);
}

/** Room left in a club's wage budget, once players who have agreed to join are paid for. */
export function wageRoom(world: World, club: Club): number {
  return club.finances.wageBudget - wageBill(world, club) - pendingWages(world, club.id);
}

/** Players a club answers for against the squad limit: everyone at the club,
 *  its own players out on loan, who will be back at the end of the season,
 *  and anyone who has agreed to join and is waiting on the window. */
export function squadSize(world: World, club: Club): number {
  return club.players.length + loansOutOf(world, club.id).length + arrivalsFor(world, club.id).length;
}

/** Send a player out on loan — until the end of the season, unless told otherwise. */
export function startLoan(
  world: World,
  parent: Club,
  borrower: Club,
  playerIdx: number,
  wageShare: number,
  endsOn = seasonEndDay(world.season),
  playingTime?: LoanPlayingTime,
): Loan {
  const store = world.players;
  parent.players = parent.players.filter((p) => p !== playerIdx);
  borrower.players.push(playerIdx);
  store.clubId[playerIdx] = borrower.id;
  store.setFlag(playerIdx, PlayerFlag.LoanListed, false);
  store.setFlag(playerIdx, PlayerFlag.Transferable, false);
  const loan: Loan = {
    playerIdx,
    parentClubId: parent.id,
    loanClubId: borrower.id,
    wageShare,
    endsOn,
    playingTime,
    startDay: world.day,
    startAbility: store.currentAbility[playerIdx],
    stats: newLoanStats(),
  };
  // Not every club is as good as its word. The user keeps his own promises — or doesn't.
  if (playingTime !== undefined && borrower.id !== world.userClubId) loan.honour = world.rng.range(0.55, 1);
  world.loans.push(loan);
  return loan;
}

/** Bring a player on loan back to the club that owns him. */
export function endLoan(world: World, loan: Loan): void {
  const store = world.players;
  const p = loan.playerIdx;
  world.loans = world.loans.filter((l) => l !== loan);
  const borrower = world.clubs[loan.loanClubId];
  if (borrower !== undefined) borrower.players = borrower.players.filter((q) => q !== p);
  const parent = world.clubs[loan.parentClubId];
  if (parent === undefined || !store.isActive(p)) {
    store.clubId[p] = -1;
    return;
  }
  if (!parent.players.includes(p)) parent.players.push(p);
  store.clubId[p] = parent.id;
}

/** The season is over: every player on loan goes home, and the user hears who. */
export function returnLoans(world: World): void {
  const store = world.players;
  for (const loan of [...world.loans]) {
    const name = store.fullName(loan.playerIdx);
    const borrower = world.clubs[loan.loanClubId];
    const parent = world.clubs[loan.parentClubId];
    // The last word on his loan, before it is gone.
    const report = compileLoanReport(world, loan, true);
    endLoan(world, loan);
    if (loan.parentClubId === world.userClubId && borrower !== undefined) {
      say(world, {
        subject: `${name} returns from loan`,
        body: `${name}'s loan at ${borrower.name} is over, and he is back with the squad. ` +
          'The staff have compiled his matches there.',
        playerIdx: loan.playerIdx,
        clubId: borrower.id,
        loanReport: report,
        category: 'offer',
      });
    } else if (loan.loanClubId === world.userClubId && parent !== undefined) {
      say(world, {
        subject: `${name} goes back to ${parent.name}`,
        body: `${name}'s loan has ended, and he returns to ${parent.name}.`,
        playerIdx: loan.playerIdx,
        clubId: parent.id,
        category: 'offer',
      });
    }
  }
}

/** The owning club's answer to a request to borrow one of its players. */
export interface LoanVerdict {
  accepted: boolean;
  /** A refusal that no better offer will change: talks end. */
  final: boolean;
  reason: string;
}

/**
 * Will a club lend one of its players out? Never a first-choice player, never
 * if it would leave the club short of a team; beyond that it is about money —
 * the more of his wage the borrower covers, the likelier — and about games: a
 * club lends a player to see him play, a young one above all.
 */
export function evaluateLoanRequest(
  world: World,
  parent: Club,
  playerIdx: number,
  wageShare: number,
  playingTime: LoanPlayingTime = 'rotation',
): LoanVerdict {
  const store = world.players;
  const pos = store.position[playerIdx] as Position;
  const samePos = parent.players
    .filter((p) => store.position[p] === pos)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const needed = STARTERS_AT[pos];
  if (samePos.indexOf(playerIdx) < needed) {
    return {
      accepted: false,
      final: true,
      reason: `He is one of their first-choice ${POSITION_NAMES[pos].toLowerCase()}s and is not available for loan.`,
    };
  }
  const left = samePos.length - 1;
  if (left < needed) {
    return { accepted: false, final: true, reason: 'They cannot spare him — without him they could not field a team.' };
  }
  const age = store.ageOn(playerIdx, world.year, 181);
  const young = age <= 23;
  // Games are the point of a loan: more of them sway a club, a place on the
  // bench puts it off — all the more for a young player.
  const games = (playingTimeRank(playingTime) - 1) * (young ? 0.25 : 0.12);
  let chance = 0.15 + wageShare * 0.75 + (young ? 0.15 : 0) + games;
  // Lending their only cover in the position is a risk they rarely take.
  if (left === needed) chance *= 0.4;
  if (world.rng.chance(Math.max(0.02, Math.min(0.95, chance)))) {
    return { accepted: true, final: false, reason: 'They agree to the loan.' };
  }
  return {
    accepted: false,
    final: false,
    reason: playingTime === 'backup' && young
      ? 'They want him playing regularly, not sitting on a bench.'
      : wageShare < 0.75 ? 'They want you to cover more of his wages.' : 'They would rather keep him for now.',
  };
}

/**
 * Does the player want the loan? Most want games, and a starting place wins
 * almost anyone round; a place on the bench puts plenty off, and an ambitious
 * player won't drop far down even to play.
 */
export function playerAgreesToLoan(
  world: World,
  borrower: Club,
  playerIdx: number,
  playingTime: LoanPlayingTime = 'rotation',
): boolean {
  const store = world.players;
  if (playingTime === 'backup' && world.rng.chance(0.35)) return false;
  const level = store.currentAbility[playerIdx] / 2000;
  const clubLevel = borrower.reputation / 10000;
  if (level <= clubLevel + 0.2) return true;
  const ambition = store.getAttr(playerIdx, 'ambition') / 20;
  return !world.rng.chance(ambition * (playingTime === 'starter' ? 0.4 : 0.8));
}

/**
 * The most playing time a club can honestly promise a loanee: a starting
 * place if nobody in its squad is better in his position than its starters
 * there, a share of the games behind one, the bench behind more.
 */
export function playingTimeOnOffer(world: World, borrower: Club, playerIdx: number): LoanPlayingTime {
  const store = world.players;
  const pos = store.position[playerIdx] as Position;
  const ability = store.currentAbility[playerIdx];
  const better = borrower.players.filter((q) =>
    q !== playerIdx && store.position[q] === pos && store.currentAbility[q] > ability).length;
  const starters = STARTERS_AT[pos];
  if (better < starters) return 'starter';
  if (better === starters) return 'rotation';
  return 'backup';
}

/** The borrowing club's answer to the user's counter-proposal on a loan offer. */
export function evaluateLoanCounter(
  world: World,
  borrower: Club,
  playerIdx: number,
  offered: { wageShare: number; playingTime: LoanPlayingTime },
  asked: { wageShare: number; playingTime: LoanPlayingTime },
): { accepted: boolean; reason: string } {
  const most = playingTimeOnOffer(world, borrower, playerIdx);
  if (playingTimeRank(asked.playingTime) > playingTimeRank(most)) {
    return {
      accepted: false,
      reason: `They can't promise him more than ${PLAYING_TIME_NAMES[most].toLowerCase()} minutes — ` +
        'there are better players in his position in their squad.',
    };
  }
  const wage = world.players.wage[playerIdx];
  const more = Math.max(0, asked.wageShare - offered.wageShare);
  if (more > 0 && wageRoom(world, borrower) < wage * asked.wageShare) {
    return { accepted: false, reason: 'They have no room in their wage budget to pay more of his wage.' };
  }
  const steps = Math.max(0, playingTimeRank(asked.playingTime) - playingTimeRank(offered.playingTime));
  const chance = 0.9 - steps * 0.2 - more * 1.4;
  return world.rng.chance(Math.max(0.05, chance))
    ? { accepted: true, reason: 'They accept your terms.' }
    : { accepted: false, reason: 'They are not prepared to go that far.' };
}

/**
 * Clubs that could use the user's loan-listed players make offers to borrow
 * them — clubs at or below his level, where he would play, with room in the
 * squad and the wage budget. Called weekly, all year: a loan agreed while the
 * window is shut starts when it opens.
 */
export function generateLoanOffers(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const store = world.players;

  for (const p of club.players) {
    if (!store.hasFlag(p, PlayerFlag.LoanListed) || loanOf(world, p) !== undefined) continue;
    if (pendingMoveOf(world, p) !== undefined) continue;
    // A loan runs to the end of the season it starts in; his contract must outlast it.
    if (store.contractUntil[p] < seasonEndDay(seasonOfDay(moveDay(world)))) continue;
    const open = world.incomingOffers.filter((o) => o.playerIdx === p && o.loan !== undefined);
    if (open.length >= MAX_LOAN_OFFERS || !world.rng.chance(LOAN_OFFER_CHANCE)) continue;

    const level = store.currentAbility[p] / 2000;
    const wage = Math.max(1, store.wage[p]);
    const suitors = world.clubs.filter((c) =>
      c.id !== club.id && c.players.length > 0 && squadSize(world, c) < MAX_SQUAD &&
      c.reputation / 10000 >= level - 0.3 && c.reputation / 10000 <= level + 0.05 &&
      wageRoom(world, c) >= wage * 0.25 && !open.some((o) => o.buyingClubId === c.id));
    if (suitors.length === 0) continue;
    const borrower = world.rng.pick(suitors);
    // The most they can put in, in quarters, and something up to that.
    const most = Math.min(1, Math.floor((wageRoom(world, borrower) / wage) * 4) / 4);
    const wageShare = Math.max(0.25, Math.round(world.rng.range(0.25, most) * 4) / 4);
    // They open a step below what they could give, often enough — there is
    // room to push them.
    const couldGive = playingTimeOnOffer(world, borrower, p);
    const playingTime = couldGive !== 'backup' && world.rng.chance(0.4)
      ? LOAN_PLAYING_TIMES[LOAN_PLAYING_TIMES.indexOf(couldGive) + 1]
      : couldGive;

    const offer: IncomingOffer = {
      id: world.nextOfferId++,
      playerIdx: p,
      buyingClubId: borrower.id,
      fee: 0,
      loan: { wageShare, playingTime },
      expiresOnDay: world.day + 14,
      status: 'open',
    };
    world.incomingOffers.push(offer);
    say(world, {
      subject: `Loan offer for ${store.fullName(p)}`,
      body: `${borrower.name} would like to take ${store.fullName(p)} on loan to the end of the season, ` +
        `paying ${Math.round(wageShare * 100)}% of his ${euros(store.wage[p])} wage, with playing time as a ` +
        `${PLAYING_TIME_NAMES[playingTime].toLowerCase()}. Accept it, turn it down, or ask for better terms.`,
      offerId: offer.id,
      playerIdx: p,
      from: borrower.name,
      clubId: borrower.id,
      category: 'offer',
    });
  }
}

// ---- A loan's matches ----------------------------------------------------------------

/** Of a match's rallies, the share a player in his position is on court for:
 *  a middle and a libero split the back row, everyone else plays them all. */
export function courtShare(position: number): number {
  return position === Position.MiddleBlocker || position === Position.Libero ? 0.67 : 1;
}

/** How much of the play he has had at the club that borrowed him, 0-1. */
export function loanShare(stats: LoanStats | undefined): number {
  return stats === undefined || stats.clubRallies === 0 ? 0 : Math.min(1, stats.rallies / stats.clubRallies);
}

/**
 * His share of the play in the matches he was fit for, 0-1 — what a promise
 * of games is measured against: no club owes games to a player in the
 * treatment room.
 */
export function promiseShare(stats: LoanStats | undefined): number {
  if (stats === undefined) return 0;
  const of = stats.fitRallies ?? stats.clubRallies;
  return of === 0 ? 0 : Math.min(1, stats.rallies / of);
}

/** The club's matches he has been fit for — every one, on older records. */
export function fitMatches(stats: LoanStats | undefined): number {
  return stats === undefined ? 0 : stats.fitMatches ?? stats.clubMatches;
}

/** Matches before a promise of games is judged. */
const PROMISE_REVIEW_MATCHES = 6;
/** How far short of a promise counts as breaking it. */
const PROMISE_SLACK = 0.2;
/** The fewest days between two notes on the same loanee's standout matches. */
const HIGHLIGHT_GAP_DAYS = 21;

/** Whether the club playing him has fallen well short of the games it promised. */
export function promiseBroken(loan: Loan): boolean {
  return loan.playingTime !== undefined && fitMatches(loan.stats) >= PROMISE_REVIEW_MATCHES &&
    promiseShare(loan.stats) < PLAYING_TIME_SHARE[loan.playingTime] - PROMISE_SLACK;
}

/**
 * File a finished match against every loan at either club: the match counts
 * towards the games he could have had — and, if he was fit, towards the ones
 * he was owed — and, if he played, everything he did in it towards his loan's
 * record. A standout match by one of the user's loanees makes the inbox.
 * Called for every club fixture.
 */
export function recordLoanMatch(
  world: World,
  fixture: Fixture,
  homeStats: Map<number, PlayerMatchStats>,
  awayStats: Map<number, PlayerMatchStats>,
): void {
  if (world.loans.length === 0 || world.competitions[fixture.competitionId]?.kind === 'international') return;
  const store = world.players;
  const rallies = fixture.setScores.reduce((sum, [h, a]) => sum + h + a, 0);
  for (const loan of world.loans) {
    const home = loan.loanClubId === fixture.home;
    if (!home && loan.loanClubId !== fixture.away) continue;
    const p = loan.playerIdx;
    const st = loan.stats ??= newLoanStats();
    const expected = Math.round(rallies * courtShare(store.position[p]));
    // Older records start telling fit matches apart from here, counting all before.
    st.fitMatches ??= st.clubMatches;
    st.fitRallies ??= st.clubRallies;
    st.clubMatches++;
    st.clubRallies += expected;
    if (store.injuryDaysLeft[p] === 0) {
      st.fitMatches++;
      st.fitRallies += expected;
    }

    const s = (home ? homeStats : awayStats).get(p);
    if (s === undefined || !playedInMatch(s)) continue;
    const setsFor = home ? fixture.homeSets : fixture.awaySets;
    const setsAgainst = home ? fixture.awaySets : fixture.homeSets;
    const rating = matchRating(s, store.position[p] as Position, setsFor, setsAgainst);
    st.apps++;
    st.rallies += s.ralliesPlayed;
    st.ratingSum += rating;
    st.best = Math.max(st.best, rating);
    st.points += s.attackKills + s.serveAces + s.blockPoints;
    st.kills += s.attackKills;
    st.attacks += s.attacksTotal;
    st.attackFaults += s.attackErrors + s.attackBlocked;
    st.aces += s.serveAces;
    st.blocks += s.blockPoints;
    st.digs += s.digsTotal;
    st.receptions += s.receptionsTotal;
    st.goodReceptions += s.receptionPerfect + s.receptionPositive;
    st.assists += s.setAssists;
    if (fixture.mvp === p) st.mvps++;
    if (loan.parentClubId === world.userClubId) standout(world, loan, fixture, s, rating, home);
  }
}

/** The user hears when one of his loanees has a standout match — though not every week. */
function standout(
  world: World, loan: Loan, fixture: Fixture, s: PlayerMatchStats, rating: number, home: boolean,
): void {
  const mvp = fixture.mvp === loan.playerIdx;
  if (rating < 8 && !(mvp && rating >= 7.2)) return;
  if (loan.lastHighlight !== undefined && world.day - loan.lastHighlight < HIGHLIGHT_GAP_DAYS) return;
  loan.lastHighlight = world.day;
  const name = world.players.fullName(loan.playerIdx);
  const club = world.clubs[loan.loanClubId]?.name ?? 'his loan club';
  const opponent = world.clubs[home ? fixture.away : fixture.home]?.name ?? 'their opponents';
  const setsFor = home ? fixture.homeSets : fixture.awaySets;
  const setsAgainst = home ? fixture.awaySets : fixture.homeSets;
  const points = s.attackKills + s.serveAces + s.blockPoints;
  say(world, {
    subject: mvp ? `${name} player of the match for ${club}` : `Standout display from ${name} at ${club}`,
    body: (setsFor > setsAgainst
      ? `${name} helped ${club} beat ${opponent} ${setsFor}-${setsAgainst}`
      : `${name} stood out as ${club} lost ${setsFor}-${setsAgainst} to ${opponent}`) +
      `, with ${points} point${points === 1 ? '' : 's'} and a match rating of ${rating.toFixed(1)}` +
      `${mvp ? ' — named player of the match' : ''}.`,
    from: 'Loan Manager',
    playerIdx: loan.playerIdx,
    clubId: loan.loanClubId,
    loanOut: true,
    category: 'offer',
  });
}

/**
 * The loanees a club has promised games to and is behind on: they start its
 * next match, if they are fit. A club never keeps a loanee out who wins his
 * place on merit — but not every club is as good as its word about the rest,
 * and one with little honour leaves him out when he is owed. The user picks
 * his own team.
 */
export function loanStarters(world: World, club: Club): Set<number> | undefined {
  if (club.id === world.userClubId || world.loans.length === 0) return undefined;
  let out: Set<number> | undefined;
  for (const loan of world.loans) {
    if (loan.loanClubId !== club.id || loan.playingTime === undefined) continue;
    if (promiseShare(loan.stats) >= PLAYING_TIME_SHARE[loan.playingTime]) continue;
    if (loan.honour !== undefined && !world.rng.chance(loan.honour)) continue;
    (out ??= new Set()).add(loan.playerIdx);
  }
  return out;
}

/** The staff's summing-up of a loan: the games, the level, the progress. */
function loanVerdict(world: World, r: LoanReport): string {
  const club = world.clubs[r.loanClubId]?.name ?? 'His club';
  const st = r.stats;
  if (st.clubMatches === 0) return `${club} have not played a match since he joined.`;
  const share = loanShare(st);
  const parts: string[] = [];
  const record = `${st.apps} appearance${st.apps === 1 ? '' : 's'} in ${st.clubMatches} match${st.clubMatches === 1 ? '' : 'es'}`;
  if (st.apps === 0) parts.push(`He has not played at all in ${st.clubMatches} match${st.clubMatches === 1 ? '' : 'es'}.`);
  else if (share >= 0.7) parts.push(`He is a regular in the side: ${record}.`);
  else if (share >= 0.35) parts.push(`He is getting a fair share of the games: ${record}.`);
  else parts.push(`He is mostly on the bench: ${record}.`);
  const missed = st.clubMatches - fitMatches(st);
  if (missed >= 2) parts.push(`He has missed ${missed} matches through injury.`);
  if (r.playingTime !== undefined && fitMatches(st) >= 4 &&
    promiseShare(st) < PLAYING_TIME_SHARE[r.playingTime] - 0.15) {
    parts.push(`That is well short of the playing time agreed — ${PLAYING_TIME_NAMES[r.playingTime].toLowerCase()}.`);
  }
  if (st.apps >= 3) {
    const avg = st.ratingSum / st.apps;
    parts.push(avg >= 7.2 ? 'His performances have been excellent.'
      : avg >= 6.7 ? 'He has played well.'
        : avg >= 6.2 ? 'His performances have been steady.'
          : 'He has struggled on court.');
  }
  const gain = r.abilityNow - r.abilityStart;
  parts.push(gain >= 25 ? `He has come on a great deal: his ability is up ${gain} since he joined.`
    : gain >= 8 ? `He is developing: his ability is up ${gain}.`
      : gain <= -8 ? `His ability has dropped by ${-gain}.`
        : 'His ability has held steady.');
  return parts.join(' ');
}

/** Everything a loan has amounted to so far, as the staff would put it in a report. */
export function compileLoanReport(world: World, loan: Loan, final = false): LoanReport {
  const store = world.players;
  const p = loan.playerIdx;
  const report: LoanReport = {
    playerIdx: p,
    loanClubId: loan.loanClubId,
    parentClubId: loan.parentClubId,
    fromDay: loan.startDay ?? world.day,
    toDay: world.day,
    final,
    playingTime: loan.playingTime,
    stats: { ...(loan.stats ?? newLoanStats()) },
    abilityStart: loan.startAbility ?? store.currentAbility[p],
    abilityNow: store.currentAbility[p],
    form: [...(world.ratingForm.get(p) ?? [])],
    verdict: '',
  };
  report.verdict = loanVerdict(world, report);
  return report;
}

/**
 * The user compiles the matches of one of his players out on loan: the report
 * arrives in the inbox at once. Returns the message, or null if the player
 * is not out on loan from the user's club.
 */
export function requestLoanReport(world: World, playerIdx: number): GameMessage | null {
  const loan = loanOf(world, playerIdx);
  if (loan === undefined || loan.parentClubId !== world.userClubId) return null;
  const borrower = world.clubs[loan.loanClubId];
  const name = world.players.fullName(playerIdx);
  say(world, {
    subject: `Loan report: ${name} at ${borrower?.name ?? 'his loan club'}`,
    body: `The staff have compiled ${name}'s matches at ${borrower?.name ?? 'his loan club'} since he joined.`,
    from: 'Loan Manager',
    playerIdx,
    clubId: borrower?.id,
    loanReport: compileLoanReport(world, loan),
    category: 'offer',
  });
  return world.messages[world.messages.length - 1];
}

/**
 * Promises of games are watched both ways, once a week. A club that lent the
 * user a player complains when he is well short of the games he was promised,
 * and recalls him if nothing changes. And the user is told when a club that
 * borrowed one of his is short-changing him — and may recall him himself.
 */
export function reviewLoanPromises(world: World): void {
  const store = world.players;
  for (const loan of [...world.loans]) {
    if (loan.playingTime === undefined || !promiseBroken(loan)) continue;
    const fit = fitMatches(loan.stats);
    const name = store.fullName(loan.playerIdx);
    const promised = PLAYING_TIME_NAMES[loan.playingTime].toLowerCase();
    const had = Math.round(promiseShare(loan.stats) * 100);
    const owed = Math.round(PLAYING_TIME_SHARE[loan.playingTime] * 100);

    if (loan.loanClubId === world.userClubId) {
      const parent = world.clubs[loan.parentClubId];
      if (loan.complainedAt === undefined) {
        loan.complainedAt = fit;
        say(world, {
          subject: `${parent?.name ?? 'His club'} unhappy with ${name}'s playing time`,
          body: `${parent?.name ?? 'His club'} lent you ${name} on the promise of playing time as a ${promised}, ` +
            `and he has been on court for ${had}% of your play in the matches he was fit for, against the ${owed}% ` +
            'promised. Give him the games, or they will take him back.',
          playerIdx: loan.playerIdx,
          from: parent?.name,
          clubId: parent?.id,
          category: 'offer',
        });
      } else if (fit - loan.complainedAt >= PROMISE_REVIEW_MATCHES) {
        endLoan(world, loan);
        say(world, {
          subject: `${name} recalled by ${parent?.name ?? 'his club'}`,
          body: `${parent?.name ?? 'His club'} have recalled ${name} from his loan: he was promised playing time as a ` +
            `${promised} and has not had it.`,
          playerIdx: loan.playerIdx,
          from: parent?.name,
          clubId: parent?.id,
          category: 'offer',
        });
      }
    } else if (loan.parentClubId === world.userClubId) {
      // Word again only once things have had a few more matches to change — and never while he is injured.
      if (loan.complainedAt !== undefined && fit - loan.complainedAt < PROMISE_REVIEW_MATCHES) continue;
      if (store.injuryDaysLeft[loan.playerIdx] > 0) continue;
      loan.complainedAt = fit;
      const club = world.clubs[loan.loanClubId];
      say(world, {
        subject: `${name} short of his promised games at ${club?.name ?? 'his loan club'}`,
        body: `${club?.name ?? 'His loan club'} promised ${name} playing time as a ${promised} — about ${owed}% of ` +
          `their play — but he has been on court for ${had}% of it in the matches he was fit for. You can recall ` +
          'him if you are not happy with how he is being used.',
        from: 'Loan Manager',
        playerIdx: loan.playerIdx,
        clubId: club?.id,
        loanOut: true,
        loanRecall: true,
        category: 'offer',
      });
    }
  }
}

/** Whether the user may recall one of his players from loan: only when the
 *  club playing him has broken its promise of games. */
export function canRecall(world: World, playerIdx: number): boolean {
  const loan = loanOf(world, playerIdx);
  return loan !== undefined && loan.parentClubId === world.userClubId && promiseBroken(loan);
}

/** Bring a player back from a loan that isn't giving him the games agreed.
 *  The final account of it comes back with him. */
export function recallFromLoan(world: World, playerIdx: number): boolean {
  const loan = loanOf(world, playerIdx);
  if (loan === undefined || !canRecall(world, playerIdx)) return false;
  const report = compileLoanReport(world, loan, true);
  const club = world.clubs[loan.loanClubId];
  const name = world.players.fullName(playerIdx);
  endLoan(world, loan);
  say(world, {
    subject: `${name} recalled from ${club?.name ?? 'his loan'}`,
    body: `You have recalled ${name} from his loan at ${club?.name ?? 'his loan club'}: they did not give him the ` +
      'playing time they promised. He is back with the squad.',
    playerIdx,
    clubId: club?.id,
    loanReport: report,
    category: 'offer',
  });
  return true;
}