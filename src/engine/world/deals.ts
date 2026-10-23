/**
 * Deals that take time.
 *
 * Nothing in the transfer market is settled on the spot. A bid to a club,
 * terms for a player, a new contract for one of your own — each goes off and
 * the answer comes back days later, in the inbox. While it is out, other
 * clubs can be chasing the same player and he weighs their offers against
 * yours; leave talks idle and a rival may get there first.
 *
 * It runs the other way too. A club's bid for one of your players can draw
 * rival bids; a counter-offer waits for their board; and once a fee is agreed
 * the player takes a few days to decide whether he wants the move at all.
 *
 * Talks run all year. A deal for a player under contract agreed while the
 * transfer window is shut is done on paper — fee paid, terms fixed — and he
 * moves when the next window opens (see moves.ts).
 */

import type { Club } from '../model/club.ts';
import { bidTurnedDown, stanceLine, stanceOf, stanceOnAgreedSale } from './offerStance.ts';
import { PlayerFlag } from '../model/players.ts';
import {
  completeTransfer, contractDemands, evaluateCounterFee, evaluateFeeOffer, payFee, resolveIncomingMove,
  respondToOffer, ROLE_VALUE, SQUAD_ROLE_NAMES, TALKS_COOLDOWN_DAYS, TALKS_PATIENCE,
  type ContractDemands, type IncomingOffer, type SquadRole,
} from './negotiation.ts';
import {
  evaluateLoanCounter, evaluateLoanRequest, loanOf, MAX_SQUAD, PLAYING_TIME_NAMES, playerAgreesToLoan, squadSize,
  startLoan, wageRoom, type LoanPlayingTime,
} from './loans.ts';
import { moveDay, pendingMoveOf, seasonOfDay, windowOpeningLabel } from './moves.ts';
import { euros, seasonEndDay, seasonEndYear, windowCloseDay, type GameMessage, type World } from './world.ts';
import { AFFILIATE_DISCOUNT, affiliateLoanBlock, isAffiliate } from './affiliates.ts';
import { agentOf, agentPatience, extrasOf, pruneExtras, releaseClauseOf, setExtras } from './contractTerms.ts';

export interface TalksOffer {
  /** Transfer fee — only while talking to the selling club. */
  fee: number;
  wage: number;
  role: SquadRole;
  /** Seasons the contract runs, counting this one. */
  years: number;
  /** Loan talks only: the share of his wage you would pay, 0-1. */
  wageShare?: number;
  /** Loan talks only: the playing time you promise him. */
  playingTime?: LoanPlayingTime;
  /** The small print — see contractTerms.ts. */
  appearanceBonus?: number;
  titleBonus?: number;
  releaseClause?: number;
  option?: boolean;
  agentFee?: number;
}

/** Another club after the same player, and the wage it is offering him. */
export interface RivalSuitor {
  clubId: number;
  wage: number;
}

/** A negotiation in progress: to sign a player, borrow one, or keep one of your own. */
export interface Talks {
  id: number;
  kind: 'transfer' | 'renewal' | 'loan';
  playerIdx: number;
  /** The player's club when talks opened: -1 for a free agent; the user's
   *  own club for a renewal. */
  sellingClubId: number;
  /** A contracted player's fee is agreed with his club before his terms. A
   *  loan is only ever at 'fee': his club decides, and he joins if it agrees. */
  stage: 'fee' | 'terms';
  agreedFee: number;
  /** What the selling club values him at, once they have said. */
  valuation: number | null;
  demands: ContractDemands;
  patience: number;
  /** The last offer made — the next one starts from it. */
  lastOffer: TalksOffer;
  /** The offer out for an answer, and the day the answer comes back. */
  pending: { offer: TalksOffer; resolvesOn: number } | null;
  /** How the last answer went. */
  reply: 'feeRejected' | 'close' | 'far' | null;
  rivals: RivalSuitor[];
  /** A rival's formal bid with the selling club — to beat by `until`, or he goes to them. */
  rivalBid?: { clubId: number; fee: number; until: number };
  /** Left idle past this day, the talks lapse. */
  expiresOn: number;
  /** Run by the Director of Football, not the manager — see director.ts. */
  byDirector?: boolean;
}

/** How long each kind of answer takes, in days (both ends inclusive). */
export const REPLY_DAYS: Readonly<Record<'fee' | 'terms' | 'renewal' | 'counter' | 'decision', readonly [number, number]>> = {
  /** A club's board considering a bid. */
  fee: [1, 3],
  /** A player and his agent weighing terms — and any rival offers. */
  terms: [2, 5],
  /** A new contract has to be squared with the club's finances: two days at least. */
  renewal: [2, 4],
  /** A buying club answering your asking price. */
  counter: [1, 2],
  /** One of your players deciding on a move once the fee is agreed. */
  decision: [2, 4],
};

/** Days talks can sit untouched before they lapse. */
const IDLE_DAYS = 21;
/** Chance per idle day that a rival closes the deal while you wait. */
const RIVAL_SIGNS_CHANCE = 0.03;
/** Chance per day, while the fee is still being talked over, that a rival puts in a formal bid of its own. */
const RIVAL_TABLES_BID_CHANCE = 0.05;
/** Days the selling club gives the manager to beat it. */
const BEAT_IT_DAYS = 5;
/** Chance per day that another club tops a bid for one of yours. */
const RIVAL_BID_CHANCE = 0.05;
/** Most bids one of your players can have on the table at once. */
const MAX_BIDS_PER_PLAYER = 3;

function say(world: World, msg: Omit<GameMessage, 'id' | 'day' | 'year'>): void {
  world.messages.push({ id: world.messages.length, day: world.day, year: world.year, ...msg });
}

function listNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}

// ---- Talks: signing players and keeping your own ------------------------------------

/** Talks lapse when left idle. The window has no say: they run all year. */
function idleDeadline(world: World): number {
  return world.day + IDLE_DAYS;
}

/** The season a player signing today would join in: this one, unless the deal
 *  has to wait for the summer window. Free agents join on the spot. */
export function joinSeason(world: World, playerIdx: number): number {
  return world.players.clubId[playerIdx] < 0 ? world.season : seasonOfDay(moveDay(world));
}

/**
 * Settle an agreed transfer. A free agent, or anyone while a window is open,
 * moves at once; otherwise the fee is paid now and he moves the day the next
 * window opens. `years` counts from the season he joins in. Returns the day he moves.
 */
function agreeTransfer(world: World, buyer: Club, playerIdx: number, wage: number, fee: number, years: number): number {
  const store = world.players;
  const from = store.clubId[playerIdx];
  const day = from < 0 ? world.day : moveDay(world);
  const contractEnd = seasonEndDay(seasonOfDay(day) + years - 1);
  if (day === world.day) {
    completeTransfer(world, buyer, playerIdx, wage, fee, contractEnd);
    return day;
  }
  payFee(world, buyer, from, fee);
  store.setFlag(playerIdx, PlayerFlag.Transferable, false);
  store.setFlag(playerIdx, PlayerFlag.LoanListed, false);
  world.pendingMoves.push({
    kind: 'transfer', playerIdx, fromClubId: from, toClubId: buyer.id, movesOn: day, fee, wage, contractEnd, wageShare: 0,
  });
  return day;
}

/** Settle an agreed loan: at once while a window is open, otherwise from the
 *  day the next one opens — to the end of the season it starts in. */
function agreeLoan(
  world: World, parent: Club, borrower: Club, playerIdx: number, wageShare: number, playingTime?: LoanPlayingTime,
): number {
  const day = moveDay(world);
  if (day === world.day) {
    startLoan(world, parent, borrower, playerIdx, wageShare, undefined, playingTime);
    return day;
  }
  world.players.setFlag(playerIdx, PlayerFlag.LoanListed, false);
  world.pendingMoves.push({
    kind: 'loan', playerIdx, fromClubId: parent.id, toClubId: borrower.id, movesOn: day,
    fee: 0, wage: world.players.wage[playerIdx], contractEnd: 0, wageShare, playingTime,
  });
  return day;
}

/**
 * Send one of the club's players to an affiliate on loan: they take him and
 * play him — regular games promised, half his wage paid — if he will go.
 * Returns what happened.
 */
export function loanToAffiliate(world: World, club: Club, playerIdx: number, affiliateId: number): string {
  const store = world.players;
  const name = store.fullName(playerIdx);
  const affiliate = world.clubs[affiliateId];
  if (affiliate === undefined || !isAffiliate(club, affiliateId)) return 'They are not your affiliate.';
  if (!club.players.includes(playerIdx) || loanOf(world, playerIdx) !== undefined || pendingMoveOf(world, playerIdx) !== undefined) {
    return `${name} can't go out on loan just now.`;
  }
  const block = affiliateLoanBlock(affiliate);
  if (block !== null) return block;
  if (store.contractUntil[playerIdx] < seasonEndDay(seasonOfDay(moveDay(world)))) return `${name}'s contract runs out before the loan would end.`;
  if (!playerAgreesToLoan(world, affiliate, playerIdx, 'starter')) return `${name} doesn't want to go to ${affiliate.name}.`;
  const day = agreeLoan(world, club, affiliate, playerIdx, 0.5, 'starter');
  return day > world.day
    ? `${name} joins ${affiliate.name} on loan when the window opens on ${windowOpeningLabel(world, day)}, promised regular games.`
    : `${name} has gone to ${affiliate.name} on loan to the end of the season, promised regular games. They pay half his wage.`;
}

/** "as a regular starter" — the playing time in a loan's small print. */
function minutesText(playingTime: LoanPlayingTime | undefined): string {
  return playingTime === undefined ? '' : `, with playing time as a ${PLAYING_TIME_NAMES[playingTime].toLowerCase()}`;
}

/**
 * The window has opened: every deal waiting on it goes through. Called daily,
 * and by the season rollover for deals waiting on the summer window, which
 * opens as the new season starts.
 */
export function completeDueMoves(world: World, byDay = world.day): void {
  const store = world.players;
  for (const m of [...world.pendingMoves]) {
    if (m.movesOn > byDay) continue;
    world.pendingMoves = world.pendingMoves.filter((x) => x !== m);
    const p = m.playerIdx;
    const name = store.fullName(p);
    const to = world.clubs[m.toClubId];
    const from = world.clubs[m.fromClubId];
    const userIn = m.toClubId === world.userClubId;
    const userOut = m.fromClubId === world.userClubId;
    if (to === undefined) continue;

    if (!store.isActive(p)) {
      // He has retired in the meantime: the deal is off, and any fee goes back.
      if (m.kind === 'transfer' && from !== undefined) payFee(world, from, to.id, m.fee);
      if (userIn || userOut) {
        say(world, {
          subject: `Deal off: ${name}`,
          body: `${name} has retired before his move could go through.` +
            (m.kind === 'transfer' && m.fee > 0 ? ` The ${euros(m.fee)} fee has been returned.` : ''),
          category: 'offer',
        });
      }
      continue;
    }

    if (m.kind === 'loan') {
      if (from === undefined || store.clubId[p] !== from.id) continue;
      const until = `30 June ${seasonEndYear(world, seasonOfDay(m.movesOn))}`;
      startLoan(world, from, to, p, m.wageShare, seasonEndDay(seasonOfDay(m.movesOn)), m.playingTime);
      if (userIn || userOut) {
        say(world, {
          subject: userIn ? `${name} arrives on loan` : `${name} leaves on loan`,
          body: userIn
            ? `The window is open and ${name} has joined on loan from ${from.name}, until ${until}${minutesText(m.playingTime)}.`
            : `The window is open and ${name} has gone to ${to.name} on loan, until ${until}${minutesText(m.playingTime)}.`,
          playerIdx: p,
          clubId: userIn ? from.id : to.id,
          loanOut: userOut ? true : undefined,
          category: 'offer',
        });
      }
      continue;
    }

    completeTransfer(world, to, p, m.wage, m.fee, m.contractEnd, { paid: true, logSeason: seasonOfDay(m.movesOn) });
    // Anything else still pending for him is moot now.
    world.talks = world.talks.filter((t) => t.playerIdx !== p);
    world.incomingOffers = world.incomingOffers.filter((o) => o.playerIdx !== p);
    if (userIn) {
      say(world, {
        subject: `${name} arrives`,
        body: `The window is open and ${name} has joined${from !== undefined ? ` from ${from.name}` : ''}, ` +
          `on the contract agreed: ${euros(m.wage)} a season until 30 June ${seasonEndYear(world, seasonOfDay(m.contractEnd))}.`,
        playerIdx: p,
        clubId: from?.id,
        category: 'offer',
      });
    } else if (userOut) {
      say(world, {
        subject: `${name} leaves for ${to.name}`,
        body: `The window is open and ${name} has left for ${to.name}, as agreed.`,
        clubId: to.id,
        category: 'offer',
      });
    }
  }
}

/** Clubs that will also be chasing a player: the better he is, the more of them. */
export function findRivals(world: World, club: Club, playerIdx: number, demands: ContractDemands): RivalSuitor[] {
  const store = world.players;
  const level = store.currentAbility[playerIdx] / 2000;
  const current = store.clubId[playerIdx];
  const candidates = world.clubs.filter((c) =>
    c.id !== club.id && c.id !== current && c.players.length > 0 && c.players.length < MAX_SQUAD &&
    c.reputation / 10000 >= level - 0.15 && c.reputation / 10000 <= level + 0.35 &&
    wageRoom(world, c) >= demands.wage * 0.85);
  const interest = Math.min(0.85, 0.2 + Math.max(0, level - 0.45) * 1.5);
  const rivals: RivalSuitor[] = [];
  for (let i = 0; i < 2 && candidates.length > 0; i++) {
    if (!world.rng.chance(interest)) break;
    const [c] = candidates.splice(world.rng.int(0, candidates.length - 1), 1);
    rivals.push({ clubId: c.id, wage: Math.round((demands.wage * world.rng.range(0.88, 1.12)) / 1000) * 1000 });
  }
  return rivals;
}

/** Open talks with a player — to sign him, borrow him, or keep him. */
export function openTalks(world: World, club: Club, playerIdx: number, kind: Talks['kind']): Talks {
  const store = world.players;
  const sellingClubId = kind === 'renewal' ? club.id : store.clubId[playerIdx];
  const demands = contractDemands(world, club, playerIdx, kind === 'renewal');
  const stage = kind !== 'renewal' && sellingClubId >= 0 ? 'fee' : 'terms';
  const talks: Talks = {
    id: world.nextTalksId++,
    kind,
    playerIdx,
    sellingClubId,
    stage,
    agreedFee: 0,
    valuation: null,
    demands,
    // Some agents sit through more than others.
    patience: kind === 'loan' ? TALKS_PATIENCE : agentPatience(agentOf(world, playerIdx).style),
    lastOffer: {
      fee: kind === 'transfer' && stage === 'fee' ? store.value[playerIdx] : 0,
      wage: store.wage[playerIdx],
      role: demands.role,
      years: kind === 'renewal' ? demands.minYears : Math.min(demands.maxYears, Math.max(demands.minYears, 3)),
      ...(kind === 'loan' ? { wageShare: 0.5, playingTime: 'rotation' as const } : {}),
    },
    pending: null,
    reply: null,
    rivals: kind === 'transfer' ? findRivals(world, club, playerIdx, demands) : [],
    expiresOn: idleDeadline(world),
  };
  world.talks.push(talks);
  return talks;
}

/** Send an offer off. Returns the day the answer comes back. */
export function submitOffer(world: World, talks: Talks, offer: TalksOffer): number {
  // A loan is the lending club's decision alone, like a bid.
  const [lo, hi] = talks.kind === 'renewal' ? REPLY_DAYS.renewal : talks.stage === 'fee' ? REPLY_DAYS.fee : REPLY_DAYS.terms;
  const resolvesOn = world.day + world.rng.int(lo, hi);
  talks.pending = { offer, resolvesOn };
  talks.lastOffer = offer;
  return resolvesOn;
}

export function closeTalks(world: World, talks: Talks): void {
  world.talks = world.talks.filter((t) => t.id !== talks.id);
}

/** Whether the player is still where the talks found him. */
function stillAvailable(world: World, t: Talks): boolean {
  const club = world.players.clubId[t.playerIdx];
  // One of ours out on loan is still ours to renew.
  const ours = club === world.userClubId || loanOf(world, t.playerIdx)?.parentClubId === world.userClubId;
  // A player who has agreed a move and is waiting on the window is spoken for.
  return world.players.isActive(t.playerIdx) && pendingMoveOf(world, t.playerIdx) === undefined &&
    (t.kind === 'renewal' ? ours : club === t.sellingClubId && club !== world.userClubId && !ours);
}

/** How good an offer looks to the player: money against his demands, the size
 *  of the club against his own level, and the role he is promised. */
function appeal(world: World, t: Talks, clubId: number, wage: number, role: SquadRole): number {
  const club = world.clubs[clubId];
  const level = world.players.currentAbility[t.playerIdx] / 2000;
  const roleGap = ROLE_VALUE[role] - ROLE_VALUE[t.demands.role];
  return wage / t.demands.wage + ((club?.reputation ?? 0) / 10000 - level) * 0.5 + roleGap * 0.2;
}

/** A rival completes the signing instead of you. */
function signForRival(world: World, t: Talks, rival: RivalSuitor): void {
  const store = world.players;
  const club = world.clubs[rival.clubId];
  if (club === undefined) return;
  const fee = t.sellingClubId >= 0 ? Math.max(t.agreedFee, store.value[t.playerIdx]) : 0;
  const day = agreeTransfer(world, club, t.playerIdx, rival.wage, fee, world.rng.int(1, 3) + 1);
  say(world, {
    subject: `${store.fullName(t.playerIdx)} joins ${club.name}`,
    body: `${store.fullName(t.playerIdx)} has ${day > world.day ? 'agreed to join' : 'signed for'} ${club.name} instead — ` +
      `they moved faster, offering ${euros(rival.wage)} a season. Your talks with him are over.`,
    playerIdx: t.playerIdx,
    clubId: club.id,
    category: 'offer',
  });
  closeTalks(world, t);
}

/** A rival puts a formal bid in for the player the manager is after: the selling club tells him to beat it. */
function tableRivalBid(world: World, t: Talks): void {
  const store = world.players;
  const seller = world.clubs[t.sellingClubId];
  const rival = world.rng.pick(t.rivals);
  const club = world.clubs[rival.clubId];
  if (seller === undefined || club === undefined) return;
  const base = Math.max(t.valuation ?? 0, store.value[t.playerIdx], t.lastOffer.fee);
  const fee = Math.round((base * world.rng.range(1.05, 1.2)) / 1000) * 1000;
  if (fee > club.finances.balance) return;
  t.rivalBid = { clubId: club.id, fee, until: world.day + BEAT_IT_DAYS };
  t.valuation = Math.max(t.valuation ?? 0, fee);
  t.expiresOn = Math.max(t.expiresOn, t.rivalBid.until + 1);
  const name = store.fullName(t.playerIdx);
  say(world, {
    subject: `Rival bid for ${name}`,
    body: `${seller.name} have a bid of ${euros(fee)} from ${club.name} for ${name}. They will sell to whoever pays most: ` +
      `beat it within ${BEAT_IT_DAYS} days, or he goes to ${club.name}.`,
    talksId: t.id,
    playerIdx: t.playerIdx,
    from: seller.name,
    clubId: club.id,
    category: 'offer',
  });
}

/** Why an agreed deal can no longer go through, if it can't. */
function dealProblem(world: World, club: Club, t: Talks, offer: TalksOffer): string | null {
  const store = world.players;
  if (t.kind === 'transfer' && squadSize(world, club) >= MAX_SQUAD) return 'the squad is full';
  const room = wageRoom(world, club) + (t.kind === 'renewal' ? store.wage[t.playerIdx] : 0);
  if (offer.wage > room) return 'there is no longer room in the wage budget';
  if (t.kind === 'transfer' && t.agreedFee > Math.min(club.finances.transferBudget, club.finances.balance)) {
    return 'the club can no longer afford the fee';
  }
  if ((offer.agentFee ?? 0) > club.finances.balance - (t.kind === 'transfer' ? t.agreedFee : 0)) {
    return 'the club can no longer afford the agent\'s fee';
  }
  return null;
}

/** The small print of an agreed contract goes in; the agent is paid. Returns a line for the message. */
function signSmallPrint(world: World, club: Club, p: number, offer: TalksOffer, until: number): string {
  setExtras(world, p, {
    clubId: club.id, until,
    releaseClause: offer.releaseClause || undefined,
    appearanceBonus: offer.appearanceBonus || undefined,
    titleBonus: offer.titleBonus || undefined,
    option: offer.option || undefined,
  });
  const lines: string[] = [];
  const fee = offer.agentFee ?? 0;
  if (fee > 0) {
    club.finances.balance -= fee;
    club.finances.transferBudget = Math.max(0, club.finances.transferBudget - fee);
    lines.push(`${agentOf(world, p).name}, his agent, has been paid ${euros(fee)}.`);
  }
  const print = smallPrintLine(offer);
  if (print !== '') lines.push(print);
  return lines.length > 0 ? ` ${lines.join(' ')}` : '';
}

/** "A release clause of €2M; €500 an appearance; ..." — the small print, said. */
export function smallPrintLine(o: { releaseClause?: number; appearanceBonus?: number; titleBonus?: number; option?: boolean }): string {
  const parts: string[] = [];
  if ((o.appearanceBonus ?? 0) > 0) parts.push(`${euros(o.appearanceBonus!)} an appearance`);
  if ((o.titleBonus ?? 0) > 0) parts.push(`${euros(o.titleBonus!)} a trophy`);
  if ((o.releaseClause ?? 0) > 0) parts.push(`a release clause of ${euros(o.releaseClause!)}`);
  if (o.option === true) parts.push('an option on one more season');
  if (parts.length === 0) return '';
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `The contract carries ${said}.`;
}

function resolveFee(world: World, t: Talks, offer: TalksOffer): void {
  const store = world.players;
  const name = store.fullName(t.playerIdx);
  const seller = world.clubs[t.sellingClubId];
  if (seller === undefined) { closeTalks(world, t); return; }
  const buyer = world.clubs[world.userClubId];
  // With a rival's bid on the table, the club sells to whoever pays most.
  const rivalBid = t.rivalBid;
  const result = rivalBid !== undefined
    ? offer.fee > rivalBid.fee
      ? { accepted: true, reason: `It beats ${world.clubs[rivalBid.clubId]?.name ?? 'the rival'}'s bid.`, valuation: rivalBid.fee }
      : { accepted: false, reason: `${world.clubs[rivalBid.clubId]?.name ?? 'Another club'} have bid ${euros(rivalBid.fee)} — you will have to beat it.`, valuation: rivalBid.fee }
    : evaluateFeeOffer(world, seller, t.playerIdx, offer.fee, buyer !== undefined && isAffiliate(buyer, seller.id) ? AFFILIATE_DISCOUNT : 1);
  if (result.accepted) t.rivalBid = undefined;
  t.valuation = result.valuation;
  t.expiresOn = idleDeadline(world);
  const rivals = t.rivals.map((r) => world.clubs[r.clubId]?.name).filter((n): n is string => n !== undefined);
  const hurry = rivals.length > 0 ? ` Be quick: ${listNames(rivals)} ${rivals.length > 1 ? 'are' : 'is'} also after him.` : '';
  if (result.accepted) {
    t.stage = 'terms';
    t.agreedFee = offer.fee;
    t.reply = null;
    const clause = releaseClauseOf(world, t.playerIdx);
    say(world, {
      subject: `Bid accepted: ${name}`,
      body: (clause !== null && offer.fee >= clause
        ? `Your ${euros(offer.fee)} meets the release clause in ${name}'s contract: ${seller.name} could not refuse it. `
        : `${seller.name} have accepted your offer of ${euros(offer.fee)} for ${name}. `) +
        `You can now talk personal terms with the player.${hurry}`,
      talksId: t.id,
      playerIdx: t.playerIdx,
      from: seller.name,
      clubId: seller.id,
      category: 'offer',
    });
  } else {
    t.reply = 'feeRejected';
    say(world, {
      subject: `Bid rejected: ${name}`,
      body: `${seller.name} have turned down your offer of ${euros(offer.fee)} for ${name}. ${result.reason} ` +
        `They value him at around ${euros(result.valuation)}.${hurry}`,
      talksId: t.id,
      playerIdx: t.playerIdx,
      from: seller.name,
      clubId: seller.id,
      category: 'offer',
    });
  }
}

function resolveTerms(world: World, club: Club, t: Talks, offer: TalksOffer): void {
  const store = world.players;
  const p = t.playerIdx;
  const name = store.fullName(p);
  const renewal = t.kind === 'renewal';
  const category = renewal ? 'contract' : 'offer';

  const problem = dealProblem(world, club, t, offer);
  if (problem !== null) {
    say(world, {
      subject: `Deal off: ${name}`,
      body: `The deal for ${name} has fallen through: ${problem}.`,
      playerIdx: p,
      category,
    });
    closeTalks(world, t);
    return;
  }

  const response = respondToOffer(t.demands, offer, t.patience);
  // A contract runs from the season he joins in — next season's, for a deal
  // that has to wait for the summer window.
  const endSeason = (renewal ? world.season : joinSeason(world, p)) + offer.years - 1;
  const ends = `30 June ${seasonEndYear(world, endSeason)}`;

  if (response.outcome === 'accepted') {
    if (renewal) {
      store.wage[p] = offer.wage;
      store.contractUntil[p] = seasonEndDay(endSeason);
      store.morale[p] = Math.min(100, store.morale[p] + 6);
      const print = signSmallPrint(world, club, p, offer, seasonEndDay(endSeason));
      say(world, {
        subject: `New contract: ${name}`,
        body: `${name} has agreed a new deal worth ${euros(offer.wage)} a season, running until ${ends}.${print}`,
        playerIdx: p,
        category,
      });
      closeTalks(world, t);
      return;
    }
    // He has what he asked for from you — but is anyone offering more?
    const ours = appeal(world, t, club.id, offer.wage, offer.role);
    const best = t.rivals
      .map((r) => ({ r, a: appeal(world, t, r.clubId, r.wage, t.demands.role) }))
      .sort((a, b) => b.a - a.a)[0];
    if (best !== undefined && best.a > ours + 0.04 && best.a >= 0.95) {
      signForRival(world, t, best.r);
      return;
    }
    const seller = t.sellingClubId >= 0 ? world.clubs[t.sellingClubId] : undefined;
    const day = agreeTransfer(world, club, p, offer.wage, t.agreedFee, offer.years);
    const print = signSmallPrint(world, club, p, offer, seasonEndDay(seasonOfDay(day) + offer.years - 1));
    const paid = (seller !== undefined && t.agreedFee > 0 ? ` ${euros(t.agreedFee)} has been paid to ${seller.name}.` : '') + print;
    say(world, {
      subject: `${name} signs`,
      body: day > world.day
        ? `${name} has agreed terms: ${euros(offer.wage)} a season until ${ends}. The transfer window is shut, ` +
          `so he stays at ${seller?.name ?? 'his club'} until it opens on ${windowOpeningLabel(world, day)}, and joins then.${paid}`
        : `${name} has agreed terms and joins on a contract worth ${euros(offer.wage)} a season until ${ends}.${paid}`,
      playerIdx: p,
      category,
    });
    closeTalks(world, t);
    return;
  }

  if (response.outcome === 'walkout') {
    world.talksBlockedUntil.set(p, world.day + TALKS_COOLDOWN_DAYS);
    say(world, {
      subject: `Talks collapse: ${name}`,
      body: `${name} has broken off talks after one offer too many, and won't negotiate again for two weeks.`,
      playerIdx: p,
      category,
    });
    closeTalks(world, t);
    return;
  }

  // Still haggling — and a rival may take the chance to close the deal.
  if (!renewal) {
    const eager = t.rivals.find((r) => r.wage >= response.demands.floorWage);
    if (eager !== undefined && world.rng.chance(0.3)) {
      signForRival(world, t, eager);
      return;
    }
  }
  t.demands = response.demands;
  t.patience = response.patience;
  t.reply = response.gap;
  t.expiresOn = idleDeadline(world);
  const d = response.demands;
  const years = d.minYears === d.maxYears ? `${d.minYears}` : `${d.minYears}–${d.maxYears}`;
  say(world, {
    subject: renewal ? `Contract talks: ${name}` : `Reply from ${name}'s agent`,
    from: renewal ? name : `${name}'s agent`,
    playerIdx: p,
    body: (response.gap === 'far'
      ? `That offer is nowhere near what ${name} wants. He is asking for ${euros(d.wage)} a season.`
      : `${name} is close to agreeing. He would sign for ${euros(d.wage)} a season as a ` +
        `${SQUAD_ROLE_NAMES[d.role].toLowerCase()}, on a ${years}-season contract.`) + smallPrintAsks(world, t, offer),
    talksId: t.id,
    category,
  });
}

/** The lending club answers a loan request — and if it says yes, the player has his say. */
function resolveLoan(world: World, club: Club, t: Talks, offer: TalksOffer): void {
  const store = world.players;
  const p = t.playerIdx;
  const name = store.fullName(p);
  const parent = world.clubs[t.sellingClubId];
  if (parent === undefined) { closeTalks(world, t); return; }
  const share = offer.wageShare ?? 0.5;
  const minutes = offer.playingTime ?? 'rotation';
  const shareText = `${Math.round(share * 100)}% of his wages`;

  const problem = squadSize(world, club) >= MAX_SQUAD ? 'the squad is full'
    : wageRoom(world, club) < store.wage[p] * share ? 'there is no longer room in the wage budget'
      : null;
  if (problem !== null) {
    say(world, { subject: `Loan off: ${name}`, body: `The loan for ${name} has fallen through: ${problem}.`, playerIdx: p, category: 'offer' });
    closeTalks(world, t);
    return;
  }

  // A loan agreed with the window shut starts when it opens, and runs to the end
  // of that season — which his contract has to outlast.
  const starts = moveDay(world);
  const verdict = store.contractUntil[p] < seasonEndDay(seasonOfDay(starts))
    ? { accepted: false, final: true, reason: 'His contract runs out before the loan would end.' }
    : evaluateLoanRequest(world, parent, p, share, minutes);
  if (!verdict.accepted) {
    t.reply = 'feeRejected';
    t.expiresOn = idleDeadline(world);
    say(world, {
      subject: `Loan request turned down: ${name}`,
      body: `${parent.name} have said no to loaning you ${name} with you paying ${shareText}${minutesText(minutes)}. ${verdict.reason}` +
        (verdict.final ? '' : ' You can try again with a better offer.'),
      talksId: verdict.final ? undefined : t.id,
      playerIdx: p,
      from: parent.name,
      clubId: parent.id,
      category: 'offer',
    });
    if (verdict.final) closeTalks(world, t);
    return;
  }

  if (!playerAgreesToLoan(world, club, p, minutes)) {
    say(world, {
      subject: `${name} turns down the loan`,
      body: `${parent.name} were willing to let him go, but ${name} doesn't want to join ${club.name} on loan — ` +
        (minutes === 'backup' ? 'he wants to play, not sit on the bench.' : 'he is holding out for a bigger club.'),
      playerIdx: p,
      from: `${name}'s agent`,
      category: 'offer',
    });
    closeTalks(world, t);
    return;
  }

  const day = agreeLoan(world, parent, club, p, share, minutes);
  const until = `30 June ${seasonEndYear(world, seasonOfDay(day))}`;
  say(world, {
    subject: day > world.day ? `Loan agreed: ${name}` : `${name} joins on loan`,
    body: (day > world.day
      ? `${parent.name} will loan you ${name} from ${windowOpeningLabel(world, day)}, when the window opens, until ${until}. `
      : `${name} has joined on loan from ${parent.name} until ${until}. `) +
      `You pay ${shareText} (${euros(Math.round(store.wage[p] * share))} a season); ${parent.name} cover the rest. ` +
      `You have promised him playing time as a ${PLAYING_TIME_NAMES[minutes].toLowerCase()} — ` +
      `${parent.name} will be watching.`,
    playerIdx: p,
    clubId: parent.id,
    category: 'offer',
  });
  closeTalks(world, t);
}

/** Answer every offer that is due, let rivals move on idle talks, and let stale talks lapse. */
function processTalks(world: World, club: Club): void {
  const store = world.players;
  for (const t of [...world.talks]) {
    if (!stillAvailable(world, t)) {
      closeTalks(world, t);
      continue;
    }
    if (t.pending !== null) {
      if (t.pending.resolvesOn > world.day) continue;
      const offer = t.pending.offer;
      t.pending = null;
      if (t.kind === 'loan') resolveLoan(world, club, t, offer);
      else if (t.stage === 'fee') resolveFee(world, t, offer);
      else resolveTerms(world, club, t, offer);
      continue;
    }
    // A rival's bid on the table: beaten in time, or he goes to them.
    if (t.rivalBid !== undefined && world.day > t.rivalBid.until) {
      const rival = t.rivals.find((r) => r.clubId === t.rivalBid!.clubId) ?? t.rivals[0];
      if (rival !== undefined) { signForRival(world, t, rival); continue; }
      t.rivalBid = undefined;
    }
    if (t.kind === 'transfer' && t.stage === 'fee' && t.rivalBid === undefined && t.rivals.length > 0 &&
      world.rng.chance(RIVAL_TABLES_BID_CHANCE)) {
      tableRivalBid(world, t);
      continue;
    }
    if (t.kind === 'transfer' && t.rivalBid === undefined && t.rivals.length > 0 && world.rng.chance(RIVAL_SIGNS_CHANCE)) {
      signForRival(world, t, world.rng.pick(t.rivals));
      continue;
    }
    if (world.day > t.expiresOn) {
      say(world, {
        subject: `Talks lapse: ${store.fullName(t.playerIdx)}`,
        body: `Talks with ${store.fullName(t.playerIdx)} went nowhere and have lapsed.`,
        playerIdx: t.playerIdx,
        category: t.kind === 'renewal' ? 'contract' : 'offer',
      });
      closeTalks(world, t);
    }
  }
}

/** What the offer left out that he asked for: his agent's fee, a release clause. */
function smallPrintAsks(world: World, t: Talks, offer: TalksOffer): string {
  const d = t.demands;
  const asks: string[] = [];
  if ((offer.agentFee ?? 0) < (d.agentFee ?? 0)) asks.push(`his agent, ${agentOf(world, t.playerIdx).name}, wants ${euros(d.agentFee ?? 0)} for the deal`);
  const max = d.clauseMax ?? null;
  if (max !== null && ((offer.releaseClause ?? 0) <= 0 || (offer.releaseClause ?? 0) > max)) {
    asks.push(`he wants a release clause of no more than ${euros(max)}`);
  }
  if (offer.option === true) asks.push('he does not like the club option');
  if (asks.length === 0) return '';
  const said = listNames(asks);
  return ` And ${said}.`;
}

// ---- Sales: other clubs' bids for your players --------------------------------------

/** Accept a bid: the player now takes a few days to decide. Returns the day he answers. */
export function acceptIncomingOffer(world: World, offer: IncomingOffer): number {
  offer.status = 'accepted';
  offer.resolvesOn = world.day + world.rng.int(REPLY_DAYS.decision[0], REPLY_DAYS.decision[1]);
  return offer.resolvesOn;
}

/** Ask for more: the buying club answers in a day or two. Returns the day it answers. */
export function counterIncomingOffer(world: World, offer: IncomingOffer, fee: number): number {
  offer.status = 'countered';
  offer.counterFee = fee;
  offer.resolvesOn = world.day + world.rng.int(REPLY_DAYS.counter[0], REPLY_DAYS.counter[1]);
  return offer.resolvesOn;
}

/** Ask a club that wants one of yours on loan for better terms — more of his
 *  wage, more playing time. They answer in a day or two. Returns the day. */
export function counterLoanOffer(
  world: World, offer: IncomingOffer, terms: { wageShare: number; playingTime: LoanPlayingTime },
): number {
  offer.status = 'countered';
  offer.counterLoan = { ...terms };
  offer.resolvesOn = world.day + world.rng.int(REPLY_DAYS.counter[0], REPLY_DAYS.counter[1]);
  return offer.resolvesOn;
}

function removeOffers(world: World, keep: (o: IncomingOffer) => boolean): void {
  world.incomingOffers = world.incomingOffers.filter(keep);
}

function processSales(world: World): void {
  const store = world.players;
  // Bids never acted on lapse — a player who wanted one takes it badly; ones already in motion are seen through.
  const lapsed = world.incomingOffers.filter((o) => (o.status ?? 'open') === 'open' && o.expiresOnDay <= world.day);
  removeOffers(world, (o) => (o.status ?? 'open') !== 'open' || o.expiresOnDay > world.day);
  for (const o of lapsed) bidTurnedDown(world, o, 'lapsed');
  removeOffers(world, (o) => store.clubId[o.playerIdx] === world.userClubId);

  for (const o of [...world.incomingOffers]) {
    const status = o.status ?? 'open';
    if (status === 'open' || (o.resolvesOn ?? 0) > world.day) continue;
    const buyer = world.clubs[o.buyingClubId];
    const name = store.fullName(o.playerIdx);
    if (buyer === undefined) {
      removeOffers(world, (x) => x.id !== o.id);
      continue;
    }

    if (status === 'countered' && o.loan !== undefined) {
      answerLoanCounter(world, o, buyer);
      continue;
    }
    if (status === 'countered') {
      const result = evaluateCounterFee(world, buyer, o.playerIdx, o.fee, o.counterFee ?? o.fee);
      if (result.accepted) {
        o.fee = o.counterFee ?? o.fee;
        acceptIncomingOffer(world, o);
        say(world, {
          subject: `Asking price met: ${name}`,
          body: `${buyer.name} have agreed to pay ${euros(o.fee)} for ${name}. He is now talking terms with them ` +
            'and will decide in the next few days.',
          offerId: o.id,
          playerIdx: o.playerIdx,
          from: buyer.name,
          clubId: buyer.id,
          category: 'offer',
        });
      } else {
        o.status = 'open';
        o.expiresOnDay = Math.max(o.expiresOnDay, world.day + 5);
        say(world, {
          subject: `Counter-offer refused: ${name}`,
          body: `${buyer.name} won't go to ${euros(o.counterFee ?? o.fee)} for ${name}. ${result.reason} ` +
            `Their offer of ${euros(o.fee)} still stands.`,
          offerId: o.id,
          playerIdx: o.playerIdx,
          from: buyer.name,
          clubId: buyer.id,
          category: 'offer',
        });
      }
      continue;
    }

    // Accepted: the player has made up his mind.
    if (o.loan !== undefined) {
      resolveLoanOut(world, o, buyer);
      continue;
    }
    const decision = resolveIncomingMove(world, buyer, o.playerIdx);
    // How he felt about the move all along: one who wanted it goes, one who wanted to stay most likely won't.
    const stance = stanceOf(world, o);
    decision.accepted = stanceOnAgreedSale(world, o, decision.accepted);
    if (decision.accepted) {
      const day = agreeTransfer(world, buyer, o.playerIdx, decision.wage, o.fee, 2);
      removeOffers(world, (x) => x.playerIdx !== o.playerIdx);
      world.talks = world.talks.filter((t) => t.playerIdx !== o.playerIdx);
      say(world, day > world.day
        ? {
          subject: `${name} agrees to join ${buyer.name}`,
          body: `${name} has agreed terms with ${buyer.name}, and ${euros(o.fee)} has been received. The transfer ` +
            `window is shut, so he stays with you until it opens on ${windowOpeningLabel(world, day)}, and leaves then.`,
          playerIdx: o.playerIdx,
          clubId: buyer.id,
          category: 'offer',
        }
        : {
          subject: `${name} leaves for ${buyer.name}`,
          body: `${name} has agreed terms with ${buyer.name} and leaves the club. ${euros(o.fee)} has been received.`,
          clubId: buyer.id,
          category: 'offer',
        });
    } else {
      removeOffers(world, (x) => x.id !== o.id);
      say(world, {
        subject: `${name} rejects ${buyer.name}`,
        body: stance === 'staying'
          ? `${name} has turned down the move to ${buyer.name}. He never wanted to leave — and he is hurt that the club was ready to let him go.`
          : `${name} has turned down the move to ${buyer.name} — he is staying.`,
        playerIdx: o.playerIdx,
        from: name,
        category: 'offer',
      });
    }
  }

  // A bid for one of yours can draw a better one.
  const isOpenBid = (o: IncomingOffer): boolean => (o.status ?? 'open') === 'open' && o.loan === undefined;
  const players = [...new Set(world.incomingOffers.filter(isOpenBid).map((o) => o.playerIdx))];
  for (const p of players) {
    const bids = world.incomingOffers.filter((o) => o.playerIdx === p && o.loan === undefined);
    if (bids.length >= MAX_BIDS_PER_PLAYER || !world.rng.chance(RIVAL_BID_CHANCE)) continue;
    const top = Math.max(...bids.map((o) => o.fee));
    const level = store.currentAbility[p] / 2000;
    const suitors = world.clubs.filter((c) =>
      c.id !== world.userClubId && !bids.some((o) => o.buyingClubId === c.id) &&
      c.reputation / 10000 >= level - 0.15 && c.players.length < MAX_SQUAD);
    if (suitors.length === 0) continue;
    const club = world.rng.pick(suitors);
    const fee = Math.round((top * world.rng.range(1.05, 1.2)) / 1000) * 1000;
    if (fee > club.finances.transferBudget || fee > club.finances.balance) continue;
    const id = world.nextOfferId++;
    const rival: IncomingOffer = {
      id, playerIdx: p, buyingClubId: club.id, fee, expiresOnDay: world.day + 14, status: 'open',
    };
    world.incomingOffers.push(rival);
    say(world, {
      subject: `Rival bid for ${store.fullName(p)}`,
      body: `${club.name} have joined the race for ${store.fullName(p)} with a bid of ${euros(fee)}, ` +
        `topping the ${euros(top)} already on the table. ${stanceLine(world, rival)}`,
      offerId: id,
      playerIdx: p,
      from: club.name,
      clubId: club.id,
      category: 'offer',
    });
  }
}

/** Weekly chance that a club able to pay it meets a release clause set at his value — less, the higher the clause. */
const CLAUSE_BID_CHANCE = 0.12;

/**
 * A club pays the release clause of one of your players: there is nothing to
 * answer — his club can't refuse — and he decides in a few days whether to
 * go. Only while a window is open; called weekly.
 */
export function generateClauseBids(world: World): void {
  pruneExtras(world);
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || world.contractExtras === undefined || world.contractExtras.size === 0) return;
  if (windowCloseDay(world.day) === null) return;
  const store = world.players;
  for (const p of club.players) {
    const clause = extrasOf(world, p)?.releaseClause ?? 0;
    if (clause <= 0 || loanOf(world, p) !== undefined || pendingMoveOf(world, p) !== undefined) continue;
    if (world.incomingOffers.some((o) => o.playerIdx === p && o.clause === true)) continue;
    const level = store.currentAbility[p] / 2000;
    const suitors = world.clubs.filter((c) =>
      c.id !== club.id && c.players.length > 0 && c.players.length < MAX_SQUAD &&
      c.reputation / 10000 >= level - 0.05 && c.finances.transferBudget >= clause && c.finances.balance >= clause);
    if (suitors.length === 0) continue;
    const cheap = (store.value[p] * 1.2) / clause;
    if (!world.rng.chance(Math.min(CLAUSE_BID_CHANCE, CLAUSE_BID_CHANCE * cheap * cheap * cheap))) continue;
    const buyer = world.rng.pick(suitors);
    const offer: IncomingOffer = {
      id: world.nextOfferId++, playerIdx: p, buyingClubId: buyer.id, fee: clause,
      expiresOnDay: world.day + 14, status: 'accepted', clause: true,
      resolvesOn: world.day + world.rng.int(REPLY_DAYS.decision[0], REPLY_DAYS.decision[1]),
    };
    world.incomingOffers.push(offer);
    say(world, {
      subject: `Release clause met: ${store.fullName(p)}`,
      body: `${buyer.name} have paid the ${euros(clause)} release clause in ${store.fullName(p)}'s contract. ` +
        `The club can't refuse it: it is up to him now, and he will decide in the next few days. ${stanceLine(world, offer)}`,
      offerId: offer.id,
      playerIdx: p,
      from: buyer.name,
      clubId: buyer.id,
      category: 'offer',
    });
  }
}

/** The borrowing club answers your terms for a loan: agreed, and the player
 *  decides; refused, and their own offer still stands. */
function answerLoanCounter(world: World, o: IncomingOffer, borrower: Club): void {
  const name = world.players.fullName(o.playerIdx);
  const offered = { wageShare: o.loan?.wageShare ?? 0, playingTime: o.loan?.playingTime ?? 'rotation' as LoanPlayingTime };
  const asked = o.counterLoan ?? offered;
  const result = evaluateLoanCounter(world, borrower, o.playerIdx, offered, asked);
  const terms = (t: typeof offered): string =>
    `${Math.round(t.wageShare * 100)}% of his wage and playing time as a ${PLAYING_TIME_NAMES[t.playingTime].toLowerCase()}`;
  if (result.accepted) {
    o.loan = { ...asked };
    acceptIncomingOffer(world, o);
    say(world, {
      subject: `Loan terms agreed: ${name}`,
      body: `${borrower.name} have agreed to your terms for ${name}: ${terms(asked)}. He will decide in the next ` +
        'few days whether to go.',
      offerId: o.id,
      playerIdx: o.playerIdx,
      from: borrower.name,
      clubId: borrower.id,
      category: 'offer',
    });
    return;
  }
  o.status = 'open';
  o.expiresOnDay = Math.max(o.expiresOnDay, world.day + 5);
  say(world, {
    subject: `Loan terms refused: ${name}`,
    body: `${borrower.name} won't take ${name} on ${terms(asked)}. ${result.reason} ` +
      `Their offer — ${terms(offered)} — still stands.`,
    offerId: o.id,
    playerIdx: o.playerIdx,
    from: borrower.name,
    clubId: borrower.id,
    category: 'offer',
  });
}

/** A loan offer for one of yours was accepted: the player decides whether to go. */
function resolveLoanOut(world: World, o: IncomingOffer, borrower: Club): void {
  const store = world.players;
  const p = o.playerIdx;
  const name = store.fullName(p);
  const club = world.clubs[world.userClubId];
  const share = o.loan?.wageShare ?? 0;
  const minutes = o.loan?.playingTime;
  if (club === undefined || !club.players.includes(p) || loanOf(world, p) !== undefined ||
    pendingMoveOf(world, p) !== undefined) {
    removeOffers(world, (x) => x.id !== o.id);
    return;
  }
  if (store.contractUntil[p] < seasonEndDay(seasonOfDay(moveDay(world)))) {
    removeOffers(world, (x) => x.id !== o.id);
    say(world, {
      subject: `Loan off: ${name}`,
      body: `The loan to ${borrower.name} can't go ahead: ${name}'s contract runs out before it would end.`,
      playerIdx: p,
      category: 'offer',
    });
    return;
  }
  if (!playerAgreesToLoan(world, borrower, p, minutes)) {
    removeOffers(world, (x) => x.id !== o.id);
    say(world, {
      subject: `${name} rejects ${borrower.name}`,
      body: minutes === 'backup'
        ? `${name} doesn't want to go to ${borrower.name} to sit on the bench — he is staying.`
        : `${name} doesn't want to go to ${borrower.name} on loan — he is staying.`,
      playerIdx: p,
      from: name,
      category: 'offer',
    });
    return;
  }
  const day = agreeLoan(world, club, borrower, p, share, minutes);
  const until = `30 June ${seasonEndYear(world, seasonOfDay(day))}`;
  removeOffers(world, (x) => x.playerIdx !== p);
  world.talks = world.talks.filter((t) => t.playerIdx !== p);
  say(world, {
    subject: day > world.day ? `${name} agrees a loan to ${borrower.name}` : `${name} leaves on loan`,
    body: (day > world.day
      ? `${name} will join ${borrower.name} on loan when the window opens on ${windowOpeningLabel(world, day)}, until ${until}${minutesText(minutes)}. `
      : `${name} has joined ${borrower.name} on loan until ${until}${minutesText(minutes)}. `) +
      `They pay ${Math.round(share * 100)}% of his wage; the club covers the rest (${euros(Math.round(store.wage[p] * (1 - share)))} a season).` +
      (day > world.day ? '' : ' Compile his matches whenever you want to see how he is getting on.'),
    playerIdx: p,
    clubId: borrower.id,
    loanOut: day > world.day ? undefined : true,
    category: 'offer',
  });
}

/** The day's movement on every deal. Called once a day. */
export function processDeals(world: World): void {
  // Deals already agreed go through even once the manager who made them has
  // left — they were the club's.
  completeDueMoves(world);
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  processTalks(world, club);
  processSales(world);
}
