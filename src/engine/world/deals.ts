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
import { PlayerFlag } from '../model/players.ts';
import {
  completeTransfer, contractDemands, evaluateCounterFee, evaluateFeeOffer, payFee, resolveIncomingMove,
  respondToOffer, ROLE_VALUE, SQUAD_ROLE_NAMES, TALKS_COOLDOWN_DAYS, TALKS_PATIENCE,
  type ContractDemands, type IncomingOffer, type SquadRole,
} from './negotiation.ts';
import {
  evaluateLoanRequest, loanOf, MAX_SQUAD, playerAgreesToLoan, squadSize, startLoan, wageRoom,
} from './loans.ts';
import { moveDay, pendingMoveOf, seasonOfDay, windowOpeningLabel } from './moves.ts';
import { euros, seasonEndDay, seasonEndYear, type GameMessage, type World } from './world.ts';

export interface TalksOffer {
  /** Transfer fee — only while talking to the selling club. */
  fee: number;
  wage: number;
  role: SquadRole;
  /** Seasons the contract runs, counting this one. */
  years: number;
  /** Loan talks only: the share of his wage you would pay, 0-1. */
  wageShare?: number;
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
  /** Left idle past this day, the talks lapse. */
  expiresOn: number;
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
function agreeLoan(world: World, parent: Club, borrower: Club, playerIdx: number, wageShare: number): number {
  const day = moveDay(world);
  if (day === world.day) {
    startLoan(world, parent, borrower, playerIdx, wageShare);
    return day;
  }
  world.players.setFlag(playerIdx, PlayerFlag.LoanListed, false);
  world.pendingMoves.push({
    kind: 'loan', playerIdx, fromClubId: parent.id, toClubId: borrower.id, movesOn: day,
    fee: 0, wage: world.players.wage[playerIdx], contractEnd: 0, wageShare,
  });
  return day;
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
      startLoan(world, from, to, p, m.wageShare, seasonEndDay(seasonOfDay(m.movesOn)));
      if (userIn || userOut) {
        say(world, {
          subject: userIn ? `${name} arrives on loan` : `${name} leaves on loan`,
          body: userIn
            ? `The window is open and ${name} has joined on loan from ${from.name}, until ${until}.`
            : `The window is open and ${name} has gone to ${to.name} on loan, until ${until}.`,
          playerIdx: p,
          clubId: userIn ? from.id : to.id,
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
    patience: TALKS_PATIENCE,
    lastOffer: {
      fee: kind === 'transfer' && stage === 'fee' ? store.value[playerIdx] : 0,
      wage: store.wage[playerIdx],
      role: demands.role,
      years: kind === 'renewal' ? demands.minYears : Math.min(demands.maxYears, Math.max(demands.minYears, 3)),
      ...(kind === 'loan' ? { wageShare: 0.5 } : {}),
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

/** Why an agreed deal can no longer go through, if it can't. */
function dealProblem(world: World, club: Club, t: Talks, offer: TalksOffer): string | null {
  const store = world.players;
  if (t.kind === 'transfer' && squadSize(world, club) >= MAX_SQUAD) return 'the squad is full';
  const room = wageRoom(world, club) + (t.kind === 'renewal' ? store.wage[t.playerIdx] : 0);
  if (offer.wage > room) return 'there is no longer room in the wage budget';
  if (t.kind === 'transfer' && t.agreedFee > Math.min(club.finances.transferBudget, club.finances.balance)) {
    return 'the club can no longer afford the fee';
  }
  return null;
}

function resolveFee(world: World, t: Talks, offer: TalksOffer): void {
  const store = world.players;
  const name = store.fullName(t.playerIdx);
  const seller = world.clubs[t.sellingClubId];
  if (seller === undefined) { closeTalks(world, t); return; }
  const result = evaluateFeeOffer(world, seller, t.playerIdx, offer.fee);
  t.valuation = result.valuation;
  t.expiresOn = idleDeadline(world);
  const rivals = t.rivals.map((r) => world.clubs[r.clubId]?.name).filter((n): n is string => n !== undefined);
  const hurry = rivals.length > 0 ? ` Be quick: ${listNames(rivals)} ${rivals.length > 1 ? 'are' : 'is'} also after him.` : '';
  if (result.accepted) {
    t.stage = 'terms';
    t.agreedFee = offer.fee;
    t.reply = null;
    say(world, {
      subject: `Bid accepted: ${name}`,
      body: `${seller.name} have accepted your offer of ${euros(offer.fee)} for ${name}. ` +
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
      say(world, {
        subject: `New contract: ${name}`,
        body: `${name} has agreed a new deal worth ${euros(offer.wage)} a season, running until ${ends}.`,
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
    const paid = seller !== undefined && t.agreedFee > 0 ? ` ${euros(t.agreedFee)} has been paid to ${seller.name}.` : '';
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
    body: response.gap === 'far'
      ? `That offer is nowhere near what ${name} wants. He is asking for ${euros(d.wage)} a season.`
      : `${name} is close to agreeing. He would sign for ${euros(d.wage)} a season as a ` +
        `${SQUAD_ROLE_NAMES[d.role].toLowerCase()}, on a ${years}-season contract.`,
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
    : evaluateLoanRequest(world, parent, p, share);
  if (!verdict.accepted) {
    t.reply = 'feeRejected';
    t.expiresOn = idleDeadline(world);
    say(world, {
      subject: `Loan request turned down: ${name}`,
      body: `${parent.name} have said no to loaning you ${name} with you paying ${shareText}. ${verdict.reason}` +
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

  if (!playerAgreesToLoan(world, club, p)) {
    say(world, {
      subject: `${name} turns down the loan`,
      body: `${parent.name} were willing to let him go, but ${name} doesn't want to join ${club.name} on loan — ` +
        'he is holding out for a bigger club.',
      playerIdx: p,
      from: `${name}'s agent`,
      category: 'offer',
    });
    closeTalks(world, t);
    return;
  }

  const day = agreeLoan(world, parent, club, p, share);
  const until = `30 June ${seasonEndYear(world, seasonOfDay(day))}`;
  say(world, {
    subject: day > world.day ? `Loan agreed: ${name}` : `${name} joins on loan`,
    body: (day > world.day
      ? `${parent.name} will loan you ${name} from ${windowOpeningLabel(world, day)}, when the window opens, until ${until}. `
      : `${name} has joined on loan from ${parent.name} until ${until}. `) +
      `You pay ${shareText} (${euros(Math.round(store.wage[p] * share))} a season); ${parent.name} cover the rest.`,
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
    if (t.kind === 'transfer' && t.rivals.length > 0 && world.rng.chance(RIVAL_SIGNS_CHANCE)) {
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

function removeOffers(world: World, keep: (o: IncomingOffer) => boolean): void {
  world.incomingOffers = world.incomingOffers.filter(keep);
}

function processSales(world: World): void {
  const store = world.players;
  // Bids never acted on lapse; ones already in motion are seen through.
  removeOffers(world, (o) => (o.status ?? 'open') !== 'open' || o.expiresOnDay > world.day);
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
        body: `${name} has turned down the move to ${buyer.name} — he is staying.`,
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
      c.reputation / 10000 >= level - 0.15 && c.players.length < 16);
    if (suitors.length === 0) continue;
    const club = world.rng.pick(suitors);
    const fee = Math.round((top * world.rng.range(1.05, 1.2)) / 1000) * 1000;
    if (fee > club.finances.transferBudget || fee > club.finances.balance) continue;
    const id = world.nextOfferId++;
    world.incomingOffers.push({
      id, playerIdx: p, buyingClubId: club.id, fee, expiresOnDay: world.day + 14, status: 'open',
    });
    say(world, {
      subject: `Rival bid for ${store.fullName(p)}`,
      body: `${club.name} have joined the race for ${store.fullName(p)} with a bid of ${euros(fee)}, ` +
        `topping the ${euros(top)} already on the table.`,
      offerId: id,
      playerIdx: p,
      from: club.name,
      clubId: club.id,
      category: 'offer',
    });
  }
}

/** A loan offer for one of yours was accepted: the player decides whether to go. */
function resolveLoanOut(world: World, o: IncomingOffer, borrower: Club): void {
  const store = world.players;
  const p = o.playerIdx;
  const name = store.fullName(p);
  const club = world.clubs[world.userClubId];
  const share = o.loan?.wageShare ?? 0;
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
  if (!playerAgreesToLoan(world, borrower, p)) {
    removeOffers(world, (x) => x.id !== o.id);
    say(world, {
      subject: `${name} rejects ${borrower.name}`,
      body: `${name} doesn't want to go to ${borrower.name} on loan — he is staying.`,
      playerIdx: p,
      from: name,
      category: 'offer',
    });
    return;
  }
  const day = agreeLoan(world, club, borrower, p, share);
  const until = `30 June ${seasonEndYear(world, seasonOfDay(day))}`;
  removeOffers(world, (x) => x.playerIdx !== p);
  world.talks = world.talks.filter((t) => t.playerIdx !== p);
  say(world, {
    subject: day > world.day ? `${name} agrees a loan to ${borrower.name}` : `${name} leaves on loan`,
    body: (day > world.day
      ? `${name} will join ${borrower.name} on loan when the window opens on ${windowOpeningLabel(world, day)}, until ${until}. `
      : `${name} has joined ${borrower.name} on loan until ${until}. `) +
      `They pay ${Math.round(share * 100)}% of his wage; the club covers the rest (${euros(Math.round(store.wage[p] * (1 - share)))} a season).`,
    playerIdx: p,
    clubId: borrower.id,
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
