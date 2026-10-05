/**
 * The manager's inbox.
 *
 * Every department writes to the same place: the medical room when a player
 * goes down and when he is back, the league office after every matchday, the
 * finance office at each month's end, the board on the day you take charge.
 * This module owns that post — who each message is from, which ones are
 * still waiting on a decision, and the recurring letters the club sends on
 * its own schedule.
 */

import { compareTableRows, type Club } from '../model/club.ts';
import { bestKnown, readLevel, READ_WARN_STARTING, READ_WARN_WORKED_OUT } from '../model/tacticRead.ts';
import { INJURY_NAMES } from '../model/players.ts';
import { compileLoanReport, diffLoanStats, newLoanStats, wageBill } from './loans.ts';
import { PLAYOFF_ROUND_BASE } from '../season/schedule.ts';
import {
  contractEndSeason, DAYS_PER_SEASON, euros, messageCategory,
  type FinanceStatement, type GameMessage, type MessageCategory, type RoundupTableRow, type World,
} from './world.ts';

/** The office each kind of message comes from when it doesn't name a sender. */
export const CATEGORY_SENDER: Readonly<Record<MessageCategory, string>> = {
  news: 'League Office',
  task: 'Chief Scout',
  offer: 'Director of Football',
  interview: 'Press Office',
  contract: 'Director of Football',
  medical: 'Medical Department',
  matchday: 'League Office',
  finance: 'Finance Office',
  board: 'Board of Directors',
  career: 'Your Agent',
  international: 'International Desk',
  awards: 'League Office',
};

/** Who a message is from. */
export function messageSender(m: GameMessage): string {
  return m.from ?? CATEGORY_SENDER[messageCategory(m)];
}

/** Post a message to the inbox, dated today. */
export function postMessage(world: World, msg: Omit<GameMessage, 'id' | 'day' | 'year'>): GameMessage {
  const m: GameMessage = { id: world.messages.length, day: world.day, year: world.year, ...msg };
  world.messages.push(m);
  return m;
}

/**
 * Whether a message is still waiting on the manager: a bid to answer, a press
 * conference to attend, talks where the next move is his, an expiring
 * contract nobody has opened talks on, a job offer. Read against the live
 * world, so a message stops asking for action the moment the matter is settled.
 */
export function messageNeedsAction(world: World, m: GameMessage): boolean {
  if (m.jobOfferId !== undefined && world.career.offers.some((o) => o.id === m.jobOfferId)) return true;
  if (m.contractOfferId !== undefined && world.career.contractOffer?.id === m.contractOfferId) return true;
  const I = world.internationals;
  if (m.nationalOffer !== undefined && (I?.offers ?? []).some((o) => o.id === m.nationalOffer!.id)) return true;
  // The squad to name for the manager's nation, until it is named.
  if (m.intl?.kind === 'squad' && I !== undefined) {
    const t = I.tournaments.find((x) => x.id === m.intl!.tournamentId);
    const nation = world.career.nationalTeam;
    if (t !== undefined && t.status === 'planned' && nation !== undefined && t.teams.includes(nation)
      && I.chosen?.tournamentId !== t.id) return true;
  }
  if (m.offerId !== undefined) {
    const offer = world.incomingOffers.find((o) => o.id === m.offerId);
    if (offer !== undefined && (offer.status ?? 'open') === 'open') return true;
  }
  if (m.interviewId !== undefined && messageCategory(m) === 'interview') {
    const session = world.pendingInterviews.find((s) => s.id === m.interviewId);
    if (session !== undefined && !session.finished) return true;
  }
  if (m.talksId !== undefined) {
    const talks = world.talks.find((t) => t.id === m.talksId);
    if (talks !== undefined && talks.pending === null) return true;
  }
  if (messageCategory(m) === 'contract' && m.playerIdx !== undefined) {
    const p = m.playerIdx;
    const store = world.players;
    const stillOurs = store.isActive(p) && store.clubId[p] === world.userClubId;
    const expiring = contractEndSeason(store.contractUntil[p]) <= world.season;
    const inTalks = world.talks.some((t) => t.playerIdx === p && t.kind === 'renewal');
    if (stillOurs && expiring && !inTalks) return true;
  }
  return false;
}

// ---- The calendar -------------------------------------------------------------

/** The first day of each calendar month, in days of the season (0 = 1 July). */
export const MONTH_STARTS: readonly number[] = [0, 31, 62, 92, 123, 153, 184, 215, 243, 274, 304, 335];
export const MONTH_NAMES: readonly string[] = [
  'July', 'August', 'September', 'October', 'November', 'December',
  'January', 'February', 'March', 'April', 'May', 'June',
];

/** "December 2026" for the month a day of the season falls in. */
export function monthLabel(world: Pick<World, 'startYear'>, season: number, dayOfSeason: number): string {
  let m = 0;
  while (m + 1 < MONTH_STARTS.length && MONTH_STARTS[m + 1] <= dayOfSeason) m++;
  const year = world.startYear + season + (m >= 6 ? 1 : 0);
  return `${MONTH_NAMES[m]} ${year}`;
}

const WEEKDAY_NAMES: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sat 3 Oct" for an absolute day — the same calendar the interface shows. */
export function formatDay(world: Pick<World, 'startYear'>, day: number): string {
  const season = Math.floor(day / DAYS_PER_SEASON);
  const d = ((day % DAYS_PER_SEASON) + DAYS_PER_SEASON) % DAYS_PER_SEASON;
  let m = 0;
  while (m + 1 < MONTH_STARTS.length && MONTH_STARTS[m + 1] <= d) m++;
  const year = world.startYear + season + (m >= 6 ? 1 : 0);
  const date = d - MONTH_STARTS[m] + 1;
  // Season month 0 is July — month 6 of the calendar year.
  const weekday = new Date(Date.UTC(year, (m + 6) % 12, date)).getUTCDay();
  return `${WEEKDAY_NAMES[weekday]} ${date} ${MONTH_NAMES[m].slice(0, 3)}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function userClub(world: World): Club | undefined {
  return world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
}

// ---- Recurring post -------------------------------------------------------------

/**
 * On the first of every month, the finance office sends the month just
 * closed: where the balance stands against the last statement, the budgets,
 * and the season's takings so far. Called at the start of each day.
 */
export function monthlyStatement(world: World): void {
  const club = userClub(world);
  if (club === undefined) return;
  const d = world.day % DAYS_PER_SEASON;
  if (!MONTH_STARTS.includes(d) || world.day === 0) return;

  // The month just closed ended yesterday — the previous season's June on 1 July.
  const prevDay = world.day - 1;
  const month = monthLabel(world, Math.floor(prevDay / DAYS_PER_SEASON), prevDay % DAYS_PER_SEASON);
  const f = club.finances;
  const last = [...world.messages].reverse().find((m) => m.statement !== undefined);

  const statement: FinanceStatement = {
    month,
    balance: f.balance,
    opening: last?.statement?.balance ?? null,
    transferBudget: f.transferBudget,
    wageBudget: f.wageBudget,
    wageBill: wageBill(world, club),
    gateReceipts: Math.max(0, f.seasonIncome - f.prizeMoney),
    travel: f.seasonExpenditure,
  };
  const change = statement.opening === null ? null : statement.balance - statement.opening;
  postMessage(world, {
    subject: `The books: ${month}`,
    body: `Your monthly statement for ${month}. The club closes the month with a balance of ${euros(f.balance)}` +
      (change === null ? '.' : `, ${change >= 0 ? 'up' : 'down'} ${euros(Math.abs(change))} on the last statement.`),
    statement,
    category: 'finance',
  });
}

/**
 * Once every match of a league round has been played, the league office
 * sends the round-up: every result, and where it leaves the table. Only the
 * user's own league — the one whose table they care about. Called after the
 * day's fixtures, with the ids of the ones just played.
 */
export function roundupNotices(world: World, playedToday: readonly number[]): void {
  const club = userClub(world);
  if (club === undefined) return;
  const comp = world.competitions[club.leagueId];
  if (comp === undefined) return;

  const rounds = new Set<number>();
  for (const id of playedToday) {
    const f = world.fixtures[id];
    if (f === undefined || !f.played || f.competitionId !== comp.id || f.round >= PLAYOFF_ROUND_BASE) continue;
    rounds.add(f.round);
  }
  for (const round of rounds) {
    const complete = comp.fixtureIds.every((id) => {
      const f = world.fixtures[id];
      return f.round !== round || f.played;
    });
    if (!complete) continue;
    const table: RoundupTableRow[] = [...comp.table]
      .sort(compareTableRows)
      .map((r) => [r.clubId, r.played, r.won, r.lost, r.points]);
    const pos = table.findIndex((r) => r[0] === club.id);
    postMessage(world, {
      subject: `Matchday ${round + 1} round-up`,
      body: `Every result from matchday ${round + 1}, and where it leaves the table` +
        (pos >= 0 ? ` — ${club.shortName} sit ${ordinal(pos + 1)} on ${table[pos][4]} points.` : '.'),
      roundup: { competitionId: comp.id, round, table },
      category: 'matchday',
    });
  }
}

/** The board's welcome on the day a manager takes charge: what they expect,
 *  and the money there is to do it with. */
export function welcomeMessages(world: World): void {
  const club = userClub(world);
  if (club === undefined) return;
  const league = world.competitions[club.leagueId];
  const f = club.finances;
  postMessage(world, {
    subject: `Welcome to ${club.name}`,
    body: `The board welcomes you as head coach of ${club.name}. We expect a finish of ${ordinal(club.boardExpectation)} ` +
      `or better${league !== undefined ? ` in the ${league.name}` : ''}. You have ${euros(f.transferBudget)} to spend ` +
      `on transfers and a wage budget of ${euros(f.wageBudget)} a season. Good luck.`,
    clubId: club.id,
    category: 'board',
  });
}

/** "a, b and c" */
function listed(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The assistant's word when the opposition are getting to know the tactic:
 * once when they start to read it, again when they have it worked out —
 * each time naming what they know best. A change that throws them off resets
 * it, so he can warn again later.
 */
export function tacticReadNotice(world: World, club: Club): void {
  const read = club.tacticRead;
  if (read === undefined) return;
  const level = readLevel(read, club.tactics);
  const stage = level >= READ_WARN_WORKED_OUT ? 2 : level >= READ_WARN_STARTING ? 1 : 0;
  const warned = read.warned ?? 0;
  read.warned = stage;
  if (stage <= warned) return;
  const known = listed(bestKnown(read, club.tactics));
  postMessage(world, stage === 2
    ? {
      subject: 'The opposition have us worked out',
      body: `Teams know exactly how we play now — our ${known} above all — and they are setting up to stop it. ` +
        'It is costing us points. We need to change things: even a few adjustments to the instructions will ' +
        'throw them, and the more we change, the longer they will need to catch up.',
      from: 'Assistant Manager',
      clubId: club.id,
      category: 'matchday',
    }
    : {
      subject: 'The opposition are starting to read us',
      body: `Our opponents have been studying the video, and they are picking up our patterns — our ${known} most ` +
        'of all. Nothing to panic about yet, but a few small adjustments to the tactic would keep them guessing.',
      from: 'Assistant Manager',
      clubId: club.id,
      category: 'matchday',
    });
}

/** How long an injury keeps a player out, in words. */
export function injuryDuration(days: number): string {
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 35) {
    const weeks = Math.round(days / 7);
    return `about ${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  const months = Math.round(days / 30);
  return `about ${months} month${months === 1 ? '' : 's'}`;
}

/** The medical room's note that one of the user's players has been injured —
 *  here, or out on loan at `onLoanAt`. */
export function injuryNotice(world: World, playerIdx: number, type: number, days: number, onLoanAt?: Club): void {
  const name = world.players.fullName(playerIdx);
  const injury = (INJURY_NAMES[type] ?? 'injury').toLowerCase();
  postMessage(world, {
    subject: onLoanAt !== undefined ? `${name} injured on loan at ${onLoanAt.name}` : `${name} ruled out through injury`,
    body: `${name} has suffered ${/^[aeiou]/.test(injury) ? 'an' : 'a'} ${injury}` +
      `${onLoanAt !== undefined ? ` while on loan at ${onLoanAt.name}` : ''} and is expected to be out for ` +
      `${injuryDuration(days)}.`,
    playerIdx,
    injury: { type, days },
    clubId: onLoanAt?.id,
    loanOut: onLoanAt !== undefined ? true : undefined,
    category: 'medical',
  });
}

/** …and that he is fit again. */
export function recoveryNotice(world: World, playerIdx: number, onLoanAt?: Club): void {
  const name = world.players.fullName(playerIdx);
  postMessage(world, {
    subject: onLoanAt !== undefined ? `${name} fit again at ${onLoanAt.name}` : `${name} available for selection`,
    body: onLoanAt !== undefined
      ? `${name} has completed his recovery and is available to ${onLoanAt.name} again.`
      : `${name} has completed his recovery and is available for training and match selection.`,
    playerIdx,
    clubId: onLoanAt?.id,
    loanOut: onLoanAt !== undefined ? true : undefined,
    category: 'medical',
  });
}

/**
 * On the first of every month, the loan manager reports on each of the
 * user's players out on loan whose club played in the month just gone: that
 * month on its own — games, form, progress — and the loan so far. Called at
 * the start of each day.
 */
export function monthlyLoanReports(world: World): void {
  if (world.userClubId < 0 || world.loans.length === 0) return;
  const d = world.day % DAYS_PER_SEASON;
  if (!MONTH_STARTS.includes(d) || world.day === 0) return;
  const prevDay = world.day - 1;
  const month = monthLabel(world, Math.floor(prevDay / DAYS_PER_SEASON), prevDay % DAYS_PER_SEASON);
  const store = world.players;

  for (const loan of world.loans) {
    if (loan.parentClubId !== world.userClubId) continue;
    const report = compileLoanReport(world, loan);
    const stats = diffLoanStats(report.stats, loan.monthStats ?? newLoanStats());
    const abilityChange = report.abilityNow - (loan.monthAbility ?? report.abilityStart);
    loan.monthStats = { ...report.stats };
    loan.monthAbility = report.abilityNow;
    if (stats.clubMatches === 0) continue;

    report.month = { label: month, stats, abilityChange };
    const name = store.fullName(loan.playerIdx);
    const club = world.clubs[loan.loanClubId]?.name ?? 'his loan club';
    const games = `${stats.apps} appearance${stats.apps === 1 ? '' : 's'} in ${stats.clubMatches} match${stats.clubMatches === 1 ? '' : 'es'}`;
    const injured = stats.clubMatches - (stats.fitMatches ?? stats.clubMatches);
    postMessage(world, {
      subject: `Loan update: ${name} — ${month}`,
      body: `${name}'s ${month} at ${club}: ${games}` +
        (injured > 0 ? `, ${injured === stats.clubMatches ? 'all of them' : `${injured} of them`} missed through injury` : '') +
        (stats.apps > 0 ? `, averaging a rating of ${(stats.ratingSum / stats.apps).toFixed(1)}` : '') +
        `. His ability has ${abilityChange > 0 ? `risen by ${abilityChange}` : abilityChange < 0 ? `fallen by ${-abilityChange}` : 'held steady'} over the month.`,
      from: 'Loan Manager',
      playerIdx: loan.playerIdx,
      clubId: loan.loanClubId,
      loanReport: report,
      loanOut: true,
      category: 'offer',
    });
  }
}
