/**
 * The backroom: who a club employs behind its head coach, and the market they
 * move in.
 *
 * Every role has its places at a club — two assistants, a doctor, two physios
 * and the rest — and the staff are paid out of a budget of their own. There
 * is a market of people out of work, topped up through the season as others
 * come into the game, and anyone in work elsewhere can be approached, for a
 * compensation fee to his club. Each asks a wage that goes with how good he is
 * and how highly he thinks of himself; a club below his standing has to pay
 * him to come, and one far below it he won't consider. An offer is met, met
 * halfway, or turned down — try him too often and he stops listening.
 *
 * Contracts run to 30 June, like the players'. The manager hears when one is
 * running out, can sit down and renew it — a man who has done well, or been
 * kept from a move he wanted, asks for more — and anyone he lets run out goes
 * at the season's end. Releasing someone early pays up the rest of his
 * contract. Other clubs come in for the good ones, with a fee to put to him.
 * The other clubs' coaches run their backrooms the same way: renewing most,
 * replacing whoever goes, filling the places they need.
 *
 * And what they do matters: the coaches develop the players, the scouts make
 * the reports, the doctor and the physios keep them fit and get them back, the
 * psychologist keeps their heads up and the analyst prepares the matches.
 */

import { Rng } from '../core/rng.ts';
import type { Club } from '../model/club.ts';
import { StaffRole, STAFF_ROLE_NAMES, staffName, staffRating, type Staff } from '../model/staff.ts';
import { MONTH_STARTS, postMessage } from './inbox.ts';
import { NATIONS } from './nations.ts';
import {
  contractEndSeason, dayOfSeason, DAYS_PER_SEASON, euros, seasonEndDay, seasonEndYear, type World,
} from './world.ts';
import { generateStaff } from './worldGen.ts';

/** How many of each a club may employ. */
export const STAFF_SLOTS: Readonly<Record<StaffRole, number>> = {
  [StaffRole.HeadCoach]: 1,
  [StaffRole.AssistantCoach]: 2,
  [StaffRole.StrengthCoach]: 2,
  [StaffRole.Doctor]: 1,
  [StaffRole.Physiotherapist]: 2,
  [StaffRole.SportsPsychologist]: 1,
  [StaffRole.PerformanceAnalyst]: 1,
  [StaffRole.HeadScout]: 1,
  [StaffRole.Scout]: 4,
  [StaffRole.RecruitmentAnalyst]: 1,
  [StaffRole.YouthCoach]: 2,
};

/** How far above his general level a specialist rates at his own job — measured on the game's backrooms. */
const ROLE_EDGE: Readonly<Record<StaffRole, number>> = {
  [StaffRole.HeadCoach]: 0.9,
  [StaffRole.AssistantCoach]: 0.85,
  [StaffRole.StrengthCoach]: 2.65,
  [StaffRole.Doctor]: 3.5,
  [StaffRole.Physiotherapist]: 2.35,
  [StaffRole.SportsPsychologist]: 2.5,
  [StaffRole.PerformanceAnalyst]: 1.9,
  [StaffRole.HeadScout]: 2.8,
  [StaffRole.Scout]: 2.75,
  [StaffRole.RecruitmentAnalyst]: 1.0,
  [StaffRole.YouthCoach]: 1.75,
};

/** What each role does for the club — as the staff screen tells it. */
export const STAFF_DUTIES: Readonly<Record<StaffRole, string>> = {
  [StaffRole.HeadCoach]: 'Runs the team.',
  [StaffRole.AssistantCoach]: 'Coaches in training — the best coach at the club sets how fast the players improve.',
  [StaffRole.StrengthCoach]: 'Coaches fitness and physique in training, and counts as a coach for development.',
  [StaffRole.Doctor]: 'Keeps injuries away — with the medical facilities, how often players break down.',
  [StaffRole.Physiotherapist]: 'Gets the injured back — with the facilities, how fast they recover.',
  [StaffRole.SportsPsychologist]: 'Lifts morale week by week, after defeats and injuries.',
  [StaffRole.PerformanceAnalyst]: 'Studies the opposition: every match is better prepared.',
  [StaffRole.HeadScout]: 'Runs scouting — the precision of every report on a player.',
  [StaffRole.Scout]: 'Scouts players — best where he knows the region.',
  [StaffRole.RecruitmentAnalyst]: 'Judges players for the scouting reports.',
  [StaffRole.YouthCoach]: 'Develops the academy, and counts as a coach for development.',
};

/** The roles the manager hires for — everyone but the head coach, which is him. */
export const HIRABLE_ROLES: readonly StaffRole[] = [
  StaffRole.AssistantCoach, StaffRole.StrengthCoach, StaffRole.Doctor, StaffRole.Physiotherapist,
  StaffRole.SportsPsychologist, StaffRole.PerformanceAnalyst, StaffRole.HeadScout, StaffRole.Scout,
  StaffRole.RecruitmentAnalyst, StaffRole.YouthCoach,
];

/** The places every club wants filled, the rest as its standing allows. */
const CORE_ROLES: readonly StaffRole[] = [
  StaffRole.AssistantCoach, StaffRole.StrengthCoach, StaffRole.Physiotherapist, StaffRole.Doctor,
  StaffRole.HeadScout, StaffRole.YouthCoach,
];

/** The staff's budget as a share of the players' wage budget. */
const STAFF_BUDGET_SHARE = 0.62;
/** People out of work in each role, on the market at any time. */
const POOL_PER_ROLE = 18;
/** Offers turned down before a man stops listening — and for how long. */
const PATIENCE = 3;
const PATIENCE_DAYS = 30;
/** How long a club's approach for one of the manager's staff stays open. */
const APPROACH_DAYS = 14;
/** The age staff retire at, give or take. */
const RETIRE_AGE = 67;

// ---- Who is where ----------------------------------------------------------------------

/** A club's backroom — everyone but its head coach. */
export function backroomOf(world: World, club: Club): Staff[] {
  return club.staff.map((id) => world.staff[id]).filter((s): s is Staff => s !== undefined && s.role !== StaffRole.HeadCoach);
}

/** What a club pays its backroom a season. */
export function staffWageBill(world: World, club: Club): number {
  return backroomOf(world, club).reduce((sum, s) => sum + s.wage, 0);
}

/** What a club can pay its backroom a season. */
export function staffBudget(club: Club): number {
  return Math.round(club.finances.wageBudget * STAFF_BUDGET_SHARE / 1000) * 1000;
}

/** What is left in the staff budget — leaving out someone whose wage is being replaced. */
export function staffBudgetRoom(world: World, club: Club, leaving?: Staff): number {
  return staffBudget(club) - staffWageBill(world, club) + (leaving !== undefined && leaving.clubId === club.id ? leaving.wage : 0);
}

/** How many a club has in a role, and how many it may have. */
export function roleCount(world: World, club: Club, role: StaffRole): { have: number; max: number } {
  return { have: backroomOf(world, club).filter((s) => s.role === role).length, max: STAFF_SLOTS[role] };
}

/** His age this year. */
export function staffAge(world: World, s: Staff): number {
  return world.year - s.birthYear;
}

// ---- What he wants -----------------------------------------------------------------------

/**
 * What a man of this quality and name is paid a season — on the same scale
 * the game's backrooms were paid on from the start: a modest coach at a small
 * club a few thousand, the best at the biggest a quarter of a million.
 */
function marketWage(s: Staff): number {
  // A specialist rates above his general level at his own job; pay goes by the level.
  const level = staffRating(s) - ROLE_EDGE[s.role];
  const quality = 4_000 + Math.pow(Math.max(0, (level - 4) / 11), 1.5) * 240_000;
  const name = 0.85 + s.reputation / 40_000;
  return Math.round(quality * name / 1000) * 1000;
}

/**
 * The wage he asks of a club a season: what he is worth — and, joining, a
 * rise on what he is paid now; a premium from a club below his standing. To
 * stay, a loyal man asks little more, an unsettled one a good deal more.
 */
export function staffWageAsk(_world: World, s: Staff, club: Club): number {
  const renewing = s.clubId === club.id;
  const worth = marketWage(s);
  let ask: number;
  if (renewing) {
    const loyalty = s.attributes.loyalty;
    ask = Math.max(s.wage * (1.02 + Math.max(0, (s.attributes.ambition - loyalty) * 0.006)), worth * (1.05 - loyalty * 0.008));
    if (s.unsettled === true) ask *= 1.2;
  } else {
    ask = s.clubId >= 0 ? Math.max(worth, s.wage * 1.15) : Math.max(worth * 0.92, 2_000);
    const below = (s.reputation - club.reputation) / 10_000;
    if (below > 0) ask *= 1 + below * 1.5;
  }
  return Math.max(2_000, Math.round(ask / 1000) * 1000);
}

/** How he feels about working for a club. */
export type StaffInterest = 'keen' | 'open' | 'reluctant' | 'refuses';

/**
 * Whether he would work for a club at all: an ambitious man won't drop far
 * below his standing, nor leave a bigger club for a smaller one; a man long
 * out of work is less particular.
 */
export function staffInterest(world: World, s: Staff, club: Club): StaffInterest {
  if (s.clubId === club.id) return s.unsettled === true ? 'reluctant' : 'open';
  const ambition = s.attributes.ambition / 20;
  let gap = (s.reputation - club.reputation) / 10_000;
  const current = s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
  if (current !== undefined) gap = Math.max(gap, (current.reputation - club.reputation) / 10_000 + 0.05);
  const idle = s.clubId < 0 && s.freeSince !== undefined ? Math.min(0.15, (world.day - s.freeSince) / 365 * 0.15) : 0;
  const tolerance = 0.32 - ambition * 0.2 + idle;
  if (gap > tolerance) return 'refuses';
  if (gap > tolerance - 0.12) return 'reluctant';
  if (gap < -0.12) return 'keen';
  return 'open';
}

/** The fee his club wants to let him go: half of what is left on his contract, and never next to nothing. */
export function compensationFor(world: World, s: Staff): number {
  if (s.clubId < 0) return 0;
  const left = Math.max(0, s.contractUntil - world.day) / DAYS_PER_SEASON;
  return Math.round(Math.max(0.25, left * 0.5) * s.wage / 1000) * 1000;
}

/** What it costs to let him go before his contract is up: the rest of it, paid out. */
export function severanceFor(world: World, s: Staff): number {
  const left = Math.max(0, s.contractUntil - world.day) / DAYS_PER_SEASON;
  return Math.round(left * s.wage / 1000) * 1000;
}

/** The longest contract he'll sign: a man near the end of his career, or one with his eye on a bigger club, not long. */
export function longestContract(world: World, s: Staff, club: Club): number {
  const age = staffAge(world, s);
  if (age >= 63) return 1;
  if (age >= 58) return 2;
  if (s.attributes.ambition >= 15 && s.reputation > club.reputation) return 2;
  return 4;
}

// ---- Talks -------------------------------------------------------------------------------

export interface StaffOffer {
  wage: number;
  /** Seasons, this one counting as the first. */
  years: number;
}

export interface StaffReply {
  outcome: 'accepted' | 'counter' | 'rejected' | 'refused';
  text: string;
  /** What he'd sign for, when he names it. */
  ask?: number;
  years?: number;
}

/** Why the club can't make him an offer at all, or null if it can. */
export function staffOfferBlock(world: World, club: Club, s: Staff): string | null {
  if (s.retired === true) return `${staffName(s)} has retired.`;
  if (s.role === StaffRole.HeadCoach) return 'Head coaches are not hired here.';
  const blocked = world.staffTalks?.[s.id];
  if (blocked !== undefined && blocked.until > world.day) return `${staffName(s)} has had enough of talking for now — try again after ${blocked.until - world.day} days.`;
  if (s.clubId !== club.id) {
    const { have, max } = roleCount(world, club, s.role);
    if (have >= max) return `You already have ${max} ${STAFF_ROLE_NAMES[s.role].toLowerCase()}${max > 1 ? 's' : ''} — release one first.`;
    if (staffInterest(world, s, club) === 'refuses') return `${staffName(s)} won't consider a club of your standing.`;
  }
  return null;
}

function noteRebuff(world: World, s: Staff): boolean {
  world.staffTalks ??= {};
  const t = world.staffTalks[s.id] ?? { tries: 0, until: 0 };
  t.tries++;
  if (t.tries >= PATIENCE) {
    t.until = world.day + PATIENCE_DAYS;
    t.tries = 0;
  }
  world.staffTalks[s.id] = t;
  return t.until > world.day;
}

/**
 * Put an offer to him — to join, or, for one of the club's own, to stay. He
 * signs if it meets his ask; a little short of it, he names his price; well
 * short, he turns it down. Turned down too often, he stops listening.
 */
export function offerToStaff(world: World, club: Club, s: Staff, offer: StaffOffer): StaffReply {
  const block = staffOfferBlock(world, club, s);
  if (block !== null) return { outcome: 'refused', text: block };
  const renewing = s.clubId === club.id;
  const name = staffName(s);
  const ask = staffWageAsk(world, s, club);
  const longest = longestContract(world, s, club);
  const years = Math.max(1, Math.min(4, Math.round(offer.years)));
  const fee = renewing ? 0 : compensationFor(world, s);
  const room = staffBudgetRoom(world, club, renewing ? s : undefined);
  if (offer.wage > room) return { outcome: 'refused', text: `That is beyond the staff budget — ${euros(Math.max(0, room))} a season is left in it.` };
  if (fee > Math.min(club.finances.balance, club.finances.transferBudget + fee * 0.5)) {
    return { outcome: 'refused', text: `${world.clubs[s.clubId]?.name ?? 'His club'} want ${euros(fee)} in compensation — more than you can find.` };
  }
  // An unsettled man may simply want out.
  if (renewing && s.unsettled === true && s.attributes.ambition >= 15 && s.attributes.loyalty <= 8) {
    return { outcome: 'refused', text: `${name} has made up his mind to move on when his contract is up.` };
  }

  if (years > longest) {
    return { outcome: 'counter', ask: Math.max(ask, offer.wage), years: longest, text: `${name} will sign for ${longest} season${longest > 1 ? 's' : ''} at most.` };
  }
  if (offer.wage >= ask) {
    sign(world, club, s, offer.wage, years, fee);
    return {
      outcome: 'accepted',
      text: renewing
        ? `${name} has signed a new contract: ${euros(offer.wage)} a season until 30 June ${seasonEndYear(world, world.season + years - 1)}.`
        : `${name} joins as ${STAFF_ROLE_NAMES[s.role]} — ${euros(offer.wage)} a season until 30 June ${seasonEndYear(world, world.season + years - 1)}` +
          `${fee > 0 ? `, with ${euros(fee)} in compensation` : ''}.`,
    };
  }
  const stops = noteRebuff(world, s);
  if (offer.wage >= ask * 0.85) {
    return {
      outcome: 'counter', ask, years,
      text: `${name} would sign for ${euros(ask)} a season.${stops ? ' He wants to think it over before he talks again.' : ''}`,
    };
  }
  return {
    outcome: 'rejected', ask,
    text: `${name} turns it down — that is well short of what he is worth to you.${stops ? ' He won’t talk again for a while.' : ''}`,
  };
}

/** He signs: off his old club, if he had one, and onto the club's books. */
function sign(world: World, club: Club, s: Staff, wage: number, years: number, fee: number): void {
  const from = s.clubId >= 0 && s.clubId !== club.id ? world.clubs[s.clubId] : undefined;
  if (from !== undefined) {
    from.staff = from.staff.filter((id) => id !== s.id);
    from.finances.balance += fee;
    club.finances.balance -= fee;
    club.finances.transferBudget = Math.max(0, club.finances.transferBudget - fee);
  }
  if (s.clubId !== club.id) club.staff.push(s.id);
  s.clubId = club.id;
  s.wage = wage;
  s.contractUntil = seasonEndDay(world.season + years - 1);
  s.unsettled = false;
  s.freeSince = undefined;
  delete world.staffTalks?.[s.id];
  // Any approach for him is over.
  for (const a of world.staffApproaches ?? []) if (a.staffId === s.id && a.status === 'open') a.status = 'expired';
}

/** Let him go before his contract is up, paying it out. Returns what it cost. */
export function releaseStaff(world: World, club: Club, s: Staff): number {
  if (s.clubId !== club.id) return 0;
  const cost = severanceFor(world, s);
  club.finances.balance -= cost;
  club.staff = club.staff.filter((id) => id !== s.id);
  s.clubId = -1;
  s.freeSince = world.day;
  s.unsettled = false;
  return cost;
}

// ---- The market -------------------------------------------------------------------------

/** One name on the market as a club sees it. */
export interface StaffListing {
  s: Staff;
  rating: number;
  ask: number;
  interest: StaffInterest;
  /** For one in work elsewhere: what his club wants for him. */
  fee: number;
}

/**
 * Who a club could hire for a role: the people out of work — and, if it
 * looks further, those in work at other clubs — best first.
 */
export function staffMarket(world: World, club: Club, role: StaffRole, employed: boolean): StaffListing[] {
  const out: StaffListing[] = [];
  for (const s of world.staff) {
    if (s.role !== role || s.retired === true || s.clubId === club.id) continue;
    if (employed ? s.clubId < 0 : s.clubId >= 0) continue;
    out.push({ s, rating: staffRating(s), ask: staffWageAsk(world, s, club), interest: staffInterest(world, s, club), fee: compensationFor(world, s) });
  }
  return out.sort((a, b) => b.rating - a.rating).slice(0, 40);
}

/** A generator of its own, so the market's comings and goings leave the world's dice alone. */
function marketRng(world: World, salt: number): Rng {
  return new Rng((world.seed ^ 0x5eed5 ^ Math.imul(world.day + 1, 2654435761) ^ salt) >>> 0);
}

/**
 * Keep people on the market in every role: newcomers to the game, of every
 * level — most of them modest, a few of them very good.
 */
export function topUpStaffPool(world: World): void {
  const rng = marketRng(world, 1);
  for (const role of HIRABLE_ROLES) {
    const free = world.staff.filter((s) => s.role === role && s.clubId < 0 && s.retired !== true).length;
    for (let i = free; i < POOL_PER_ROLE; i++) {
      const nation = rng.int(0, NATIONS.length - 1);
      // Most of them modest — there are many more small clubs than big ones — a few very good.
      const level = 600 + Math.pow(rng.float(), 2.2) * 9000;
      const s = generateStaff(world, rng, nation, role, level);
      s.contractUntil = -1;
      s.freeSince = world.day;
    }
  }
}

// ---- The season -------------------------------------------------------------------------

/** A club's approach for one of the manager's staff. */
export interface StaffApproach {
  id: number;
  staffId: number;
  /** The club that wants him. */
  clubId: number;
  /** The compensation it offers the manager's club. */
  fee: number;
  /** What it would pay him. */
  wage: number;
  expiresOn: number;
  status: 'open' | 'accepted' | 'rejected' | 'expired';
}

/** Each day: the market kept stocked, the manager's staff courted, contracts running out flagged, a psychologist's word with the squad. */
export function staffDay(world: World): void {
  const dos = dayOfSeason(world);
  if (MONTH_STARTS.includes(dos)) topUpStaffPool(world);
  for (const a of world.staffApproaches ?? []) if (a.status === 'open' && a.expiresOn < world.day) a.status = 'expired';
  if (world.day % 7 === 5) {
    courtManagersStaff(world);
    psychologistsWeek(world);
  }
  if (dos >= 180) warnExpiringStaff(world);
}

/** Other clubs come in for the manager's good staff — a club his size or bigger, with the place and the money. */
function courtManagersStaff(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const rng = marketRng(world, 2);
  world.staffApproaches ??= [];
  for (const s of backroomOf(world, club)) {
    const rating = staffRating(s);
    if (rating < 11.5 || world.staffApproaches.some((a) => a.staffId === s.id && a.status === 'open')) continue;
    if (!rng.chance(0.0025 * (rating - 11))) continue;
    const suitors = world.clubs.filter((c) => c.id !== club.id && c.players.length > 0 && c.reputation >= club.reputation * 0.95 &&
      backroomOf(world, c).filter((x) => x.role === s.role).every((x) => staffRating(x) < rating - 0.5) &&
      roleCount(world, c, s.role).have <= STAFF_SLOTS[s.role]);
    if (suitors.length === 0) continue;
    const suitor = suitors[rng.int(0, suitors.length - 1)];
    const fee = Math.round(compensationFor(world, s) * rng.range(1.0, 1.5) / 1000) * 1000;
    const wage = Math.round(Math.max(s.wage * rng.range(1.15, 1.4), marketWage(s)) / 1000) * 1000;
    const id = world.nextStaffApproachId = (world.nextStaffApproachId ?? 0) + 1;
    world.staffApproaches.push({ id, staffId: s.id, clubId: suitor.id, fee, wage, expiresOn: world.day + APPROACH_DAYS, status: 'open' });
    postMessage(world, {
      category: 'staff',
      from: suitor.name,
      clubId: suitor.id,
      subject: `${suitor.name} want ${staffName(s)}`,
      body: `${suitor.name} have asked for permission to speak to your ${STAFF_ROLE_NAMES[s.role].toLowerCase()} ${staffName(s)}, ` +
        `and offer ${euros(fee)} in compensation. They would pay him ${euros(wage)} a season — he is on ${euros(s.wage)} with you. ` +
        `Let him go, or keep him: turning down a move he wants won't please him, though a new contract might.`,
      staffApproachId: id,
      staffId: s.id,
    });
  }
}

/** Answer a club's approach for one of the manager's staff. */
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
  a.status = 'accepted';
  club.staff = club.staff.filter((x) => x !== s.id);
  club.finances.balance += a.fee;
  suitor.staff.push(s.id);
  s.clubId = suitor.id;
  s.wage = a.wage;
  s.contractUntil = seasonEndDay(world.season + 2);
  s.unsettled = false;
  return `${staffName(s)} leaves for ${suitor.name}; ${euros(a.fee)} comes in in compensation.`;
}

/** A psychologist's week: whoever is down gets some of it back — the better he is, the more. */
function psychologistsWeek(world: World): void {
  const store = world.players;
  for (const club of world.clubs) {
    let best = 0;
    for (const s of backroomOf(world, club)) if (s.role === StaffRole.SportsPsychologist) best = Math.max(best, staffRating(s));
    if (best === 0) continue;
    const lift = best / 20 * 3;
    for (const p of club.players) if (store.morale[p] < 65) store.morale[p] = Math.min(65, store.morale[p] + lift);
  }
}

/** Once in the second half of the season: whose contract is running out. */
function warnExpiringStaff(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const ending = backroomOf(world, club).filter((s) => contractEndSeason(s.contractUntil) <= world.season && s.warnedSeason !== world.season);
  if (ending.length === 0) return;
  for (const s of ending) s.warnedSeason = world.season;
  const names = ending.map((s) => `${staffName(s)} (${STAFF_ROLE_NAMES[s.role].toLowerCase()})`);
  postMessage(world, {
    category: 'staff',
    subject: ending.length === 1 ? `Staff contract running out: ${staffName(ending[0])}` : `${ending.length} staff contracts running out`,
    body: `${names.join(', ')} ${ending.length === 1 ? 'is' : 'are'} out of contract on 30 June ${seasonEndYear(world, world.season)}. ` +
      'Offer a new deal on the Staff screen, or let them go at the end of the season.',
    staffId: ending[0].id,
  });
}

/**
 * As a season ends: the old retire; contracts that run out end — the
 * manager's staff go, the other clubs keep most of theirs on new terms — and
 * every other club fills the places it needs from the market.
 */
export function staffSeasonEnd(world: World): void {
  const rng = marketRng(world, 3);
  const user = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const left: Staff[] = [];
  const retired: Staff[] = [];
  const lastDay = seasonEndDay(world.season);
  for (const s of world.staff) {
    if (s.retired === true || s.role === StaffRole.HeadCoach) continue;
    const club = s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
    const age = staffAge(world, s);
    if (age >= RETIRE_AGE + 3 || (age >= RETIRE_AGE && rng.chance(0.4))) {
      if (club !== undefined) club.staff = club.staff.filter((id) => id !== s.id);
      if (club === user) retired.push(s);
      s.retired = true;
      s.clubId = -1;
      continue;
    }
    if (club === undefined || s.contractUntil > lastDay) continue;
    if (club === user) {
      club.staff = club.staff.filter((id) => id !== s.id);
      s.clubId = -1;
      s.freeSince = world.day;
      left.push(s);
    } else if (rng.chance(s.unsettled === true ? 0.4 : 0.8)) {
      // Kept on, on much the same terms — what the club can carry, not what he might get elsewhere.
      s.wage = Math.round(s.wage * rng.range(0.95, 1.03) / 1000) * 1000;
      s.contractUntil = seasonEndDay(world.season + rng.int(1, 3));
      s.unsettled = false;
    } else {
      club.staff = club.staff.filter((id) => id !== s.id);
      s.clubId = -1;
      s.freeSince = world.day;
    }
  }
  if (user !== undefined && (left.length > 0 || retired.length > 0)) {
    postMessage(world, {
      category: 'staff',
      subject: 'Staff departures',
      body: [
        left.length > 0 ? `Out of contract, ${left.map((s) => `${staffName(s)} (${STAFF_ROLE_NAMES[s.role].toLowerCase()})`).join(', ')} ${left.length === 1 ? 'has' : 'have'} left the club.` : '',
        retired.length > 0 ? `${retired.map((s) => staffName(s)).join(', ')} ${retired.length === 1 ? 'has' : 'have'} retired.` : '',
        'Their places are open on the Staff screen.',
      ].filter((x) => x !== '').join(' '),
    });
  }
  topUpStaffPool(world);
  fillVacancies(world, rng);
}

/** What a club of this standing pays a member of its backroom — the scale the game started on. */
function clubStaffWage(club: Club): number {
  return 4_000 + Math.pow(club.reputation / 10_000, 1.5) * 240_000;
}

/** Every club but the manager's fills the places it needs, the best it can get and pay. */
function fillVacancies(world: World, rng: Rng): void {
  const free = new Map<StaffRole, Staff[]>();
  for (const s of world.staff) {
    if (s.clubId >= 0 || s.retired === true || s.role === StaffRole.HeadCoach) continue;
    free.set(s.role, [...(free.get(s.role) ?? []), s]);
  }
  for (const list of free.values()) list.sort((a, b) => staffRating(b) - staffRating(a));
  const clubs = world.clubs.filter((c) => c.id !== world.userClubId && c.players.length > 0)
    .sort((a, b) => b.reputation - a.reputation);
  for (const club of clubs) {
    const wanted = [...CORE_ROLES];
    if (club.reputation > 4000) wanted.push(StaffRole.PerformanceAnalyst, StaffRole.SportsPsychologist, StaffRole.Scout);
    if (club.reputation > 6500) wanted.push(StaffRole.Scout, StaffRole.RecruitmentAnalyst);
    const counts = new Map<StaffRole, number>();
    for (const s of backroomOf(world, club)) counts.set(s.role, (counts.get(s.role) ?? 0) + 1);
    for (const role of wanted) {
      const have = counts.get(role) ?? 0;
      const need = wanted.filter((r) => r === role).length;
      if (have >= need) continue;
      counts.set(role, have + 1);
      const pool = free.get(role) ?? [];
      // What a club of its standing pays — the best it can get for that, within its budget.
      const cap = Math.min(Math.max(staffBudgetRoom(world, club), 2_000), clubStaffWage(club));
      const pick = pool.find((s) => staffInterest(world, s, club) !== 'refuses' && staffWageAsk(world, s, club) <= cap);
      if (pick === undefined) continue;
      pool.splice(pool.indexOf(pick), 1);
      club.staff.push(pick.id);
      pick.clubId = club.id;
      pick.wage = staffWageAsk(world, pick, club);
      pick.contractUntil = seasonEndDay(world.season + 1 + rng.int(0, 2));
      pick.freeSince = undefined;
    }
  }
}

// ---- What they do -------------------------------------------------------------------------

/** How good a club's medical team is, 0-1: its facilities and its best doctor and physio, together. */
export function medicalQuality(world: World, club: Club): number {
  let doctor = 5;
  let physio = 5;
  for (const s of backroomOf(world, club)) {
    if (s.role === StaffRole.Doctor) doctor = Math.max(doctor, staffRating(s));
    if (s.role === StaffRole.Physiotherapist) physio = Math.max(physio, staffRating(s));
  }
  return (club.medicalFacilities / 20) * 0.4 + (doctor / 20) * 0.3 + (physio / 20) * 0.3;
}

/** How much better a club's matches are prepared, 0-0.3: its analyst's work. */
export function analysisEdge(world: World, club: Club): number {
  let best = 0;
  for (const s of backroomOf(world, club)) if (s.role === StaffRole.PerformanceAnalyst) best = Math.max(best, staffRating(s));
  return (best / 20) * 0.3;
}
