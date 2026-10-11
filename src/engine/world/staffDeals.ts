/**
 * Staff transfers, the way the players' go (see deals.ts): nothing is settled
 * on the spot.
 *
 * Someone in work at another club is two conversations — his compensation
 * with his club, then his terms with him; someone out of work, or one of the
 * club's own to keep, is terms alone. Every offer goes off and the answer
 * comes back days later, in the inbox. He comes to the table with demands,
 * gives a little ground on a near miss and has only so much patience; other
 * clubs may be after him too, and talks left idle lapse. Staff aren't bound by
 * the transfer windows: an agreed move is done the day it is agreed.
 *
 * It runs the other way as well. Another club's approach for one of the
 * manager's staff can be accepted, met with a higher asking price, or turned
 * down — and once the compensation is agreed, he takes a few days to decide
 * whether he wants to go. A rival may top the first approach, and staff the
 * manager lists as available draw approaches of their own.
 */

import type { Club } from '../model/club.ts';
import { STAFF_ROLE_NAMES, staffName, staffRating, type Staff } from '../model/staff.ts';
import { REPLY_DAYS } from './deals.ts';
import { postMessage } from './inbox.ts';
import { TALKS_COOLDOWN_DAYS, TALKS_PATIENCE } from './negotiation.ts';
import {
  backroomOf, compensationFor, longestContract, roleCount, signStaff, STAFF_SLOTS, staffBudgetRoom, staffOfferBlock,
  staffWageAsk, type StaffApproach,
} from './staffMarket.ts';
import { contractEndSeason, euros, seasonEndDay, seasonEndYear, type World } from './world.ts';

/** What a man asks to sign, or to stay: his pay, and how long he will commit. */
export interface StaffDemands {
  wage: number;
  /** Shortest and longest deal he will sign, in seasons counted from this one. */
  minYears: number;
  maxYears: number;
  /** The least he will come down to, however long the talks go on. */
  floorWage: number;
}

export interface StaffTalksOffer {
  /** Compensation to his club — only while talking to it. */
  fee: number;
  wage: number;
  /** Seasons, this one counting as the first. */
  years: number;
}

/** Talks to hire someone, or to keep one of the club's own. */
export interface StaffTalks {
  id: number;
  kind: 'hire' | 'renewal';
  staffId: number;
  /** His club when talks opened: -1 out of work; the manager's own for a renewal. */
  fromClubId: number;
  /** One in work elsewhere: his compensation is agreed with his club before his terms. */
  stage: 'fee' | 'terms';
  agreedFee: number;
  /** What his club wants for him, once it has said. */
  valuation: number | null;
  demands: StaffDemands;
  patience: number;
  /** The last offer made — the next one starts from it. */
  lastOffer: StaffTalksOffer;
  /** The offer out for an answer, and the day the answer comes back. */
  pending: { offer: StaffTalksOffer; resolvesOn: number } | null;
  /** How the last answer went. */
  reply: 'feeRejected' | 'close' | 'far' | null;
  /** Other clubs after him, and what each would pay him. */
  rivals: Array<{ clubId: number; wage: number }>;
  /** Left idle past this day, the talks lapse. */
  expiresOn: number;
}

/** Days talks can sit untouched before they lapse. */
const IDLE_DAYS = 21;
/** Chance per idle day that a rival hires him while you wait. */
const RIVAL_SIGNS_CHANCE = 0.03;
/** Chance per day that another club tops an approach for one of the manager's staff. */
const RIVAL_APPROACH_CHANCE = 0.05;
/** Most approaches one of the manager's staff can have open at once. */
const MAX_APPROACHES = 3;
/** Chance each week that one of the staff the manager has listed draws an approach. */
const LISTED_APPROACH_CHANCE = 0.4;
/** How long an approach stays open, unanswered. */
const APPROACH_DAYS = 14;

const roleName = (s: Staff): string => STAFF_ROLE_NAMES[s.role].toLowerCase();

// ---- Talks: hiring staff and keeping your own --------------------------------------------

export function staffTalksOf(world: World): StaffTalks[] {
  return world.staffNegotiations ?? [];
}

/** Talks under way with one man, if any. */
export function staffTalksWith(world: World, staffId: number): StaffTalks | undefined {
  return staffTalksOf(world).find((t) => t.staffId === staffId);
}

function closeStaffTalks(world: World, t: StaffTalks): void {
  world.staffNegotiations = staffTalksOf(world).filter((x) => x.id !== t.id);
}

/** Seasons left on his contract, this one counting. */
function seasonsLeft(world: World, s: Staff): number {
  return Math.max(1, contractEndSeason(s.contractUntil) - world.season + 1);
}

/** What he wants to join the club — or, one of its own, to stay. */
export function staffDemands(world: World, club: Club, s: Staff, renewal: boolean): StaffDemands {
  const wage = Math.max(2_000, Math.round(staffWageAsk(world, s, club) * world.rng.range(0.97, 1.05) / 1000) * 1000);
  // A new deal has to run past the one he has.
  const minYears = renewal ? seasonsLeft(world, s) + 1 : 1;
  const maxYears = Math.max(minYears, longestContract(world, s, club));
  return { wage, minYears, maxYears, floorWage: Math.round(wage * 0.9 / 1000) * 1000 };
}

/** Why talks with him can't be opened, or null if they can. */
export function staffTalksBlock(world: World, club: Club, s: Staff): string | null {
  const block = staffOfferBlock(world, club, s);
  if (block !== null) return block;
  if (s.clubId === club.id) {
    // An unsettled man with his eye on the door would rather see his contract out.
    if (s.unsettled === true && s.attributes.ambition >= 15 && s.attributes.loyalty <= 8) {
      return `${staffName(s)} has made up his mind to move on when his contract is up.`;
    }
  }
  return null;
}

/** Clubs that will also be after him: the better he is, the likelier — clubs his size, with a place and the money. */
function findStaffRivals(world: World, club: Club, s: Staff, demands: StaffDemands): StaffTalks['rivals'] {
  const rating = staffRating(s);
  const candidates = world.clubs.filter((c) =>
    c.id !== club.id && c.id !== s.clubId && c.players.length > 0 &&
    Math.abs(c.reputation - s.reputation) <= 2500 &&
    roleCount(world, c, s.role).have < STAFF_SLOTS[s.role] &&
    staffBudgetRoom(world, c) >= demands.wage * 0.85);
  const interest = Math.min(0.75, 0.12 + Math.max(0, rating - 11) * 0.08);
  const rivals: StaffTalks['rivals'] = [];
  for (let i = 0; i < 2 && candidates.length > 0; i++) {
    if (!world.rng.chance(interest)) break;
    const [c] = candidates.splice(world.rng.int(0, candidates.length - 1), 1);
    rivals.push({ clubId: c.id, wage: Math.round(demands.wage * world.rng.range(0.88, 1.12) / 1000) * 1000 });
  }
  return rivals;
}

/** Open talks with him — to hire him, or, one of the club's own, to keep him. Talks already under way carry on. */
export function openStaffTalks(world: World, club: Club, s: Staff): StaffTalks {
  const existing = staffTalksWith(world, s.id);
  if (existing !== undefined) return existing;
  const renewal = s.clubId === club.id;
  const demands = staffDemands(world, club, s, renewal);
  const stage = !renewal && s.clubId >= 0 ? 'fee' : 'terms';
  const id = world.nextStaffTalksId = (world.nextStaffTalksId ?? 0) + 1;
  const t: StaffTalks = {
    id,
    kind: renewal ? 'renewal' : 'hire',
    staffId: s.id,
    fromClubId: s.clubId,
    stage,
    agreedFee: 0,
    valuation: null,
    demands,
    patience: TALKS_PATIENCE,
    lastOffer: {
      fee: stage === 'fee' ? compensationFor(world, s) : 0,
      wage: renewal ? s.wage : demands.wage,
      years: Math.min(demands.maxYears, Math.max(demands.minYears, 2)),
    },
    pending: null,
    reply: null,
    rivals: renewal ? [] : findStaffRivals(world, club, s, demands),
    expiresOn: world.day + IDLE_DAYS,
  };
  (world.staffNegotiations ??= []).push(t);
  return t;
}

/** Send an offer off. Returns the day the answer comes back. */
export function submitStaffOffer(world: World, t: StaffTalks, offer: StaffTalksOffer): number {
  const [lo, hi] = t.kind === 'renewal' ? REPLY_DAYS.renewal : t.stage === 'fee' ? REPLY_DAYS.fee : REPLY_DAYS.terms;
  const resolvesOn = world.day + world.rng.int(lo, hi);
  t.pending = { offer, resolvesOn };
  t.lastOffer = offer;
  return resolvesOn;
}

/** Walk away from the talks. */
export function withdrawStaffTalks(world: World, t: StaffTalks): void {
  closeStaffTalks(world, t);
}

/** What his club wants to let him go: his compensation, and more for a man who is hard to replace. */
export function staffValuation(world: World, s: Staff): number {
  return Math.round(compensationFor(world, s) * (1 + Math.max(0, staffRating(s) - 10) * 0.06) / 1000) * 1000;
}

/** Whether he is still where the talks found him. */
function stillAvailable(world: World, t: StaffTalks, club: Club): boolean {
  const s = world.staff[t.staffId];
  if (s === undefined || s.retired === true) return false;
  return t.kind === 'renewal' ? s.clubId === club.id : s.clubId === t.fromClubId && s.clubId !== club.id;
}

/** How good an offer looks to him: the money against his demands, and the club against his own name. */
function appeal(world: World, s: Staff, t: StaffTalks, clubId: number, wage: number): number {
  const club = world.clubs[clubId];
  return wage / t.demands.wage + ((club?.reputation ?? 0) - s.reputation) / 10_000 * 0.5;
}

/** A rival hires him instead. */
function signForRival(world: World, t: StaffTalks, rival: StaffTalks['rivals'][number]): void {
  const s = world.staff[t.staffId];
  const club = world.clubs[rival.clubId];
  if (s === undefined || club === undefined) return;
  const fee = s.clubId >= 0 ? Math.max(t.agreedFee, compensationFor(world, s)) : 0;
  signStaff(world, club, s, rival.wage, world.rng.int(2, 3), fee);
  postMessage(world, {
    category: 'staff',
    subject: `${staffName(s)} joins ${club.name}`,
    body: `${staffName(s)} has gone to ${club.name} instead — they moved faster, offering ${euros(rival.wage)} a season. ` +
      'Your talks with him are over.',
    clubId: club.id,
    staffId: s.id,
  });
  closeStaffTalks(world, t);
}

function resolveFee(world: World, t: StaffTalks, offer: StaffTalksOffer): void {
  const s = world.staff[t.staffId];
  const his = world.clubs[t.fromClubId];
  if (s === undefined || his === undefined) { closeStaffTalks(world, t); return; }
  const valuation = staffValuation(world, s);
  t.valuation = valuation;
  t.expiresOn = world.day + IDLE_DAYS;
  const ratio = offer.fee / Math.max(1, valuation);
  const accepted = ratio >= 1 || (ratio >= 0.7 && world.rng.chance(Math.min(0.92, (ratio - 0.7) / 0.3)));
  const rivals = t.rivals.map((r) => world.clubs[r.clubId]?.name).filter((n): n is string => n !== undefined);
  const hurry = rivals.length > 0 ? ` Be quick: ${rivals.join(' and ')} ${rivals.length > 1 ? 'are' : 'is'} also after him.` : '';
  if (accepted) {
    t.stage = 'terms';
    t.agreedFee = offer.fee;
    t.reply = null;
    postMessage(world, {
      category: 'staff',
      from: his.name,
      clubId: his.id,
      subject: `Compensation agreed: ${staffName(s)}`,
      body: `${his.name} will let ${staffName(s)} go for ${euros(offer.fee)} in compensation. ` +
        `You can now talk terms with him.${hurry}`,
      staffTalksId: t.id,
      staffId: s.id,
    });
    return;
  }
  t.reply = 'feeRejected';
  postMessage(world, {
    category: 'staff',
    from: his.name,
    clubId: his.id,
    subject: `Approach turned down: ${staffName(s)}`,
    body: `${his.name} won't let their ${roleName(s)} ${staffName(s)} go for ${euros(offer.fee)}` +
      `${ratio < 0.7 ? ' — that is well below what he is worth to them' : ''}. They want around ${euros(valuation)}.${hurry}`,
    staffTalksId: t.id,
    staffId: s.id,
  });
}

/** Why an agreed deal can't go through after all, if it can't. */
function dealProblem(world: World, club: Club, t: StaffTalks, s: Staff, offer: StaffTalksOffer): string | null {
  const renewal = t.kind === 'renewal';
  if (!renewal && roleCount(world, club, s.role).have >= STAFF_SLOTS[s.role]) {
    return `every ${roleName(s)}'s place is taken now`;
  }
  if (offer.wage > staffBudgetRoom(world, club, renewal ? s : undefined)) return 'there is no longer room in the staff budget';
  if (t.agreedFee > club.finances.balance) return 'the club can no longer find the compensation';
  return null;
}

function resolveTerms(world: World, club: Club, t: StaffTalks, offer: StaffTalksOffer): void {
  const s = world.staff[t.staffId];
  if (s === undefined) { closeStaffTalks(world, t); return; }
  const name = staffName(s);
  const renewal = t.kind === 'renewal';
  const problem = dealProblem(world, club, t, s, offer);
  if (problem !== null) {
    postMessage(world, { category: 'staff', subject: `Deal off: ${name}`, body: `The deal for ${name} has fallen through: ${problem}.`, staffId: s.id });
    closeStaffTalks(world, t);
    return;
  }

  // His answer: the money against his demands, the length against what he will sign for.
  const d = t.demands;
  const yearsGap = offer.years < d.minYears ? d.minYears - offer.years : offer.years > d.maxYears ? offer.years - d.maxYears : 0;
  const score = offer.wage / d.wage - 1 - yearsGap * 0.12;
  const ends = `30 June ${seasonEndYear(world, world.season + offer.years - 1)}`;

  if (score >= -0.015) {
    if (!renewal) {
      // He has what he asked of you — but is anyone offering more?
      const ours = appeal(world, s, t, club.id, offer.wage);
      const best = t.rivals.map((r) => ({ r, a: appeal(world, s, t, r.clubId, r.wage) })).sort((a, b) => b.a - a.a)[0];
      if (best !== undefined && best.a > ours + 0.04 && best.a >= 0.95) {
        signForRival(world, t, best.r);
        return;
      }
    }
    const from = !renewal && s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
    signStaff(world, club, s, offer.wage, offer.years, t.agreedFee);
    postMessage(world, {
      category: 'staff',
      subject: renewal ? `New contract: ${name}` : `${name} joins`,
      body: renewal
        ? `${name} has signed a new contract: ${euros(offer.wage)} a season until ${ends}.`
        : `${name} joins as ${STAFF_ROLE_NAMES[s.role]} — ${euros(offer.wage)} a season until ${ends}.` +
          `${from !== undefined && t.agreedFee > 0 ? ` ${euros(t.agreedFee)} has gone to ${from.name} in compensation.` : ''}`,
      staffId: s.id,
    });
    closeStaffTalks(world, t);
    return;
  }

  const far = score < -0.2;
  const patience = t.patience - (far ? 2 : 1);
  if (patience <= 0) {
    (world.staffTalks ??= {})[s.id] = { tries: 0, until: world.day + TALKS_COOLDOWN_DAYS };
    postMessage(world, {
      category: 'staff',
      subject: `Talks collapse: ${name}`,
      body: `${name} has broken off talks after one offer too many, and won't talk again for two weeks.`,
      staffId: s.id,
    });
    closeStaffTalks(world, t);
    return;
  }
  // Still haggling — and a rival may take the chance to close the deal.
  if (!renewal) {
    const eager = t.rivals.find((r) => r.wage >= d.floorWage);
    if (eager !== undefined && world.rng.chance(0.3)) {
      signForRival(world, t, eager);
      return;
    }
  }
  // On a near miss he meets you part of the way.
  if (!far && offer.wage < d.wage) {
    t.demands = { ...d, wage: Math.max(d.floorWage, Math.round((d.wage - (d.wage - offer.wage) * 0.35) / 1000) * 1000) };
  }
  t.patience = patience;
  t.reply = far ? 'far' : 'close';
  t.expiresOn = world.day + IDLE_DAYS;
  const nd = t.demands;
  const years = nd.minYears === nd.maxYears ? `${nd.minYears}` : `${nd.minYears}–${nd.maxYears}`;
  postMessage(world, {
    category: 'staff',
    from: name,
    subject: renewal ? `Contract talks: ${name}` : `Reply from ${name}`,
    body: far
      ? `That offer is nowhere near what ${name} wants. He is asking for ${euros(nd.wage)} a season.`
      : `${name} is close to agreeing. He would sign for ${euros(nd.wage)} a season, on a ${years}-season contract.`,
    staffTalksId: t.id,
    staffId: s.id,
  });
}

/** Answer every offer that is due, let rivals move on idle talks, and let stale talks lapse. */
function processStaffTalks(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) {
    // Talks are the club's: a manager who has left takes none with him.
    world.staffNegotiations = [];
    return;
  }
  for (const t of [...staffTalksOf(world)]) {
    if (!stillAvailable(world, t, club)) {
      closeStaffTalks(world, t);
      continue;
    }
    if (t.pending !== null) {
      if (t.pending.resolvesOn > world.day) continue;
      const offer = t.pending.offer;
      t.pending = null;
      if (t.stage === 'fee') resolveFee(world, t, offer);
      else resolveTerms(world, club, t, offer);
      continue;
    }
    if (t.kind === 'hire' && t.rivals.length > 0 && world.rng.chance(RIVAL_SIGNS_CHANCE)) {
      signForRival(world, t, world.rng.pick(t.rivals));
      continue;
    }
    if (world.day > t.expiresOn) {
      const s = world.staff[t.staffId];
      postMessage(world, {
        category: 'staff',
        subject: `Talks lapse: ${s !== undefined ? staffName(s) : 'staff'}`,
        body: `Talks with ${s !== undefined ? staffName(s) : 'him'} went nowhere and have lapsed.`,
        staffId: t.staffId,
      });
      closeStaffTalks(world, t);
    }
  }
}

// ---- Approaches: other clubs after the manager's staff --------------------------------------

/** One of the manager's staff goes, for the compensation agreed. */
function letGo(world: World, a: StaffApproach, s: Staff, club: Club, suitor: Club): void {
  a.status = 'accepted';
  club.staff = club.staff.filter((x) => x !== s.id);
  club.finances.balance += a.fee;
  suitor.staff.push(s.id);
  s.clubId = suitor.id;
  s.wage = a.wage;
  s.contractUntil = seasonEndDay(world.season + 2);
  s.unsettled = false;
  s.listed = false;
  // Any other approach for him, and any talks to keep him, are over.
  for (const x of world.staffApproaches ?? []) if (x !== a && x.staffId === s.id && x.status !== 'accepted') x.status = 'expired';
  const talks = staffTalksWith(world, s.id);
  if (talks !== undefined) closeStaffTalks(world, talks);
}

/** The manager's answer to an approach: let him talk to them — he then decides — or keep him. */
export function answerStaffApproach(world: World, id: number, accept: boolean): string {
  const a = world.staffApproaches?.find((x) => x.id === id);
  const s = a !== undefined ? world.staff[a.staffId] : undefined;
  const suitor = a !== undefined ? world.clubs[a.clubId] : undefined;
  const club = s !== undefined && s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
  if (a === undefined || s === undefined || suitor === undefined || club === undefined || a.status !== 'open') return 'That approach is no longer open.';
  if (!accept) {
    a.status = 'rejected';
    // A man kept from a bigger club, who wanted it, will want more to stay.
    if (suitor.reputation > club.reputation && s.attributes.ambition >= 11) s.unsettled = true;
    return s.unsettled === true
      ? `You have told ${suitor.name} he is not for sale. ${staffName(s)} is disappointed — he will want more to stay.`
      : `You have told ${suitor.name} that ${staffName(s)} is not for sale.`;
  }
  a.status = 'deciding';
  a.resolvesOn = world.day + world.rng.int(REPLY_DAYS.decision[0], REPLY_DAYS.decision[1]);
  return `${suitor.name} can talk to ${staffName(s)} — he will decide by the end of the week whether to go.`;
}

/** Ask the suitor for more. They answer in a day or two. */
export function counterStaffApproach(world: World, id: number, fee: number): string {
  const a = world.staffApproaches?.find((x) => x.id === id);
  const suitor = a !== undefined ? world.clubs[a.clubId] : undefined;
  if (a === undefined || suitor === undefined || a.status !== 'open') return 'That approach is no longer open.';
  a.status = 'countered';
  a.counterFee = Math.max(a.fee, Math.round(fee / 1000) * 1000);
  a.resolvesOn = world.day + world.rng.int(REPLY_DAYS.counter[0], REPLY_DAYS.counter[1]);
  return `You have asked ${suitor.name} for ${euros(a.counterFee)} — they will answer in a day or two.`;
}

/** Whether he wants the move: the rise and the club against what keeps him where he is. */
function wantsTheMove(world: World, s: Staff, club: Club, suitor: Club, wage: number): boolean {
  const a = s.attributes;
  const score = (wage / Math.max(1, s.wage) - 1) + (suitor.reputation - club.reputation) / 10_000 * 0.8 +
    (a.ambition - 10) / 20 * 0.2 - (a.loyalty - 10) / 20 * 0.3 + (s.unsettled === true ? 0.1 : 0);
  return score > 0.05 || world.rng.chance(Math.max(0.05, 0.35 + score));
}

/** The day's movement on the approaches: answers due, his decisions, rival clubs coming in. */
function processApproaches(world: World): void {
  const user = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  for (const a of world.staffApproaches ?? []) {
    if (a.status === 'open' && a.expiresOn < world.day) a.status = 'expired';
    if ((a.status !== 'countered' && a.status !== 'deciding') || (a.resolvesOn ?? 0) > world.day) continue;
    const s = world.staff[a.staffId];
    const suitor = world.clubs[a.clubId];
    const club = s !== undefined && s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
    if (s === undefined || suitor === undefined || club === undefined || club !== user || s.retired === true) {
      a.status = 'expired';
      continue;
    }
    const name = staffName(s);
    if (a.status === 'countered') {
      const asked = a.counterFee ?? a.fee;
      // A club stretches further for a man who would be a clear upgrade.
      const ceiling = Math.min(a.fee * (1.2 + Math.max(0, staffRating(s) - 12) * 0.05), suitor.finances.balance);
      const ratio = asked / Math.max(1, ceiling);
      if (ratio <= 1.15 && (ratio <= 1 || world.rng.chance(Math.max(0.05, 1.3 - ratio)))) {
        a.fee = asked;
        a.status = 'deciding';
        a.resolvesOn = world.day + world.rng.int(REPLY_DAYS.decision[0], REPLY_DAYS.decision[1]);
        postMessage(world, {
          category: 'staff', from: suitor.name, clubId: suitor.id, staffApproachId: a.id, staffId: s.id,
          subject: `Asking price met: ${name}`,
          body: `${suitor.name} will pay ${euros(asked)} in compensation for ${name}. He is talking to them now, and will decide in the next few days.`,
        });
      } else {
        a.status = 'open';
        a.expiresOn = Math.max(a.expiresOn, world.day + 5);
        postMessage(world, {
          category: 'staff', from: suitor.name, clubId: suitor.id, staffApproachId: a.id, staffId: s.id,
          subject: `Asking price refused: ${name}`,
          body: `${suitor.name} won't go to ${euros(asked)} for ${name}. Their offer of ${euros(a.fee)} still stands.`,
        });
      }
      continue;
    }
    // Agreed: he has made up his mind.
    if (wantsTheMove(world, s, club, suitor, a.wage)) {
      letGo(world, a, s, club, suitor);
      postMessage(world, {
        category: 'staff', clubId: suitor.id, staffId: s.id,
        subject: `${name} leaves for ${suitor.name}`,
        body: `${name} has agreed terms with ${suitor.name} and leaves the club. ${euros(a.fee)} comes in in compensation.`,
      });
    } else {
      a.status = 'declined';
      postMessage(world, {
        category: 'staff', from: name, staffId: s.id,
        subject: `${name} turns down ${suitor.name}`,
        body: `${name} has talked to ${suitor.name} and turned them down — he is staying.`,
      });
    }
  }

  // An approach for one of the manager's staff can draw a better one.
  if (user === undefined) return;
  const open = (world.staffApproaches ?? []).filter((a) => a.status === 'open');
  for (const staffId of new Set(open.map((a) => a.staffId))) {
    const s = world.staff[staffId];
    const bids = (world.staffApproaches ?? []).filter((a) => a.staffId === staffId && (a.status === 'open' || a.status === 'countered'));
    if (s === undefined || bids.length >= MAX_APPROACHES || !world.rng.chance(RIVAL_APPROACH_CHANCE)) continue;
    const top = bids.reduce((best, a) => (a.fee > best.fee ? a : best), bids[0]);
    const suitor = suitorFor(world, s, user, bids.map((a) => a.clubId), world.clubs[top.clubId]?.reputation ?? user.reputation);
    if (suitor === undefined) continue;
    const fee = Math.round(top.fee * world.rng.range(1.05, 1.2) / 1000) * 1000;
    if (fee > suitor.finances.balance) continue;
    const wage = Math.round(Math.max(top.wage, s.wage * world.rng.range(1.15, 1.4)) / 1000) * 1000;
    approach(world, s, suitor, fee, wage,
      `${suitor.name} have joined the race for ${staffName(s)}, offering ${euros(fee)} in compensation — topping the ${euros(top.fee)} already on the table. ` +
      `They would pay him ${euros(wage)} a season.`, `Rival approach for ${staffName(s)}`);
  }
}

/** A club that wants him: a place for him, no one as good in it, the standing to tempt him. */
function suitorFor(world: World, s: Staff, user: Club, not: number[], minReputation: number): Club | undefined {
  const rating = staffRating(s);
  const suitors = world.clubs.filter((c) => c.id !== user.id && !not.includes(c.id) && c.players.length > 0 &&
    c.reputation >= minReputation * 0.9 &&
    backroomOf(world, c).filter((x) => x.role === s.role).every((x) => staffRating(x) < rating - 0.5));
  return suitors.length > 0 ? suitors[world.rng.int(0, suitors.length - 1)] : undefined;
}

/** Put an approach on the table, and tell the manager. */
function approach(world: World, s: Staff, suitor: Club, fee: number, wage: number, body: string, subject: string): void {
  const id = world.nextStaffApproachId = (world.nextStaffApproachId ?? 0) + 1;
  (world.staffApproaches ??= []).push({ id, staffId: s.id, clubId: suitor.id, fee, wage, expiresOn: world.day + APPROACH_DAYS, status: 'open' });
  postMessage(world, { category: 'staff', from: suitor.name, clubId: suitor.id, subject, body, staffApproachId: id, staffId: s.id });
}

/** List one of the staff as available to other clubs, or take him off the list. */
export function setStaffListed(club: Club, s: Staff, listed: boolean): void {
  if (s.clubId !== club.id) return;
  s.listed = listed;
}

/** The manager's listed staff draw approaches: clubs that could use him, pitching below what he is worth. */
function listedApproaches(world: World): void {
  const user = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (user === undefined) return;
  for (const s of backroomOf(world, user)) {
    if (s.listed !== true) continue;
    const bids = (world.staffApproaches ?? []).filter((a) => a.staffId === s.id && (a.status === 'open' || a.status === 'countered'));
    if (bids.length >= 2 || !world.rng.chance(LISTED_APPROACH_CHANCE)) continue;
    const suitor = suitorFor(world, s, user, bids.map((a) => a.clubId), s.reputation * 0.6);
    if (suitor === undefined) continue;
    const fee = Math.round(compensationFor(world, s) * world.rng.range(0.6, 1.0) / 1000) * 1000;
    if (fee > suitor.finances.balance) continue;
    const wage = Math.round(Math.max(2_000, s.wage * world.rng.range(1.0, 1.25)) / 1000) * 1000;
    approach(world, s, suitor, fee, wage,
      `${suitor.name} have seen that your ${roleName(s)} ${staffName(s)} is available, and offer ${euros(fee)} in compensation. ` +
      `They would pay him ${euros(wage)} a season — he is on ${euros(s.wage)} with you.`,
      `${suitor.name} interested in ${staffName(s)}`);
  }
}

/** The day's movement on every staff deal: called from the staff's day. */
export function processStaffDeals(world: World): void {
  processStaffTalks(world);
  processApproaches(world);
  if (world.day % 7 === 5) listedApproaches(world);
}
