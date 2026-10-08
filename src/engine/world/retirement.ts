/**
 * Retirement, the way it happens: a player makes it known in the new year
 * that this season is his last, and goes when it ends.
 *
 * Who decides to stop is driven by age, how far he has fallen from his best
 * and how long he always meant to go on. The ones people know about make the
 * paper, twice — when they announce it, and when they go, with what their
 * career came to — and every player's profile carries it. When it is one of
 * the manager's own, he hears first, and has two things he can try: talk him
 * into one more season — a player still near his best, who loves the game and
 * trusts his coach, may listen — or ask him to stay on another way, on the
 * coaching staff, where what he knew as a player becomes what he teaches.
 */

import { Rng } from '../core/rng.ts';
import { PlayerFlag } from '../model/players.ts';
import { POSITION_NAMES, type Position } from '../model/positions.ts';
import { StaffRole, STAFF_ROLE_NAMES, staffName, type Staff, type StaffAttributes } from '../model/staff.ts';
import { postMessage } from './inbox.ts';
import { NATIONS, type Confederation } from './nations.ts';
import { followed, postNews } from './news.ts';
import { roleCount } from './staffMarket.ts';
import { dayOfSeason, seasonEndDay, seasonEndYear, type World } from './world.ts';

/** The day of the season players make their plans known — the middle of January. */
export const ANNOUNCE_DAY = 200;

/**
 * Nobody plays on at this age. Plenty get into their forties and 43 is about
 * as far as it usually goes — but Miguel Maia was still playing at 52.
 */
const LAST_AGE = 53;

export interface RetirementPlan {
  /** The club he was at when he said so. */
  clubId: number;
  announced: number;
  /** Talked round: he plays on another season. */
  persuaded?: boolean;
  /** The manager has had his word: how it went. */
  talked?: 'stayed' | 'refused';
  /** A place on the club's staff he has agreed to take as he stops. */
  staffRole?: StaffRole;
  /** Offered one, he turned it down. */
  declinedRole?: boolean;
}

/** The roles a player can move into as he stops. */
export const SECOND_CAREERS: readonly StaffRole[] = [
  StaffRole.AssistantCoach, StaffRole.YouthCoach, StaffRole.StrengthCoach, StaffRole.Scout, StaffRole.PerformanceAnalyst,
];

// ---- Who means to stop -------------------------------------------------------------------

/** How old he will be when this season ends — the age he would stop at. */
export function ageAtSeasonEnd(world: World, i: number): number {
  return world.players.ageOn(i, seasonEndYear(world, world.season), 181);
}

/**
 * How likely a player is to stop at the end of this season: age, how far he
 * has fallen from his peak, and how long he always meant to go on.
 */
export function retirementHazard(world: World, i: number): number {
  const store = world.players;
  const age = ageAtSeasonEnd(world, i);
  if (age < 29) return 0;
  if (age >= LAST_AGE) return 1;
  const preference = store.getAttr(i, 'retirementPreference') / 20;
  const ca = store.currentAbility[i];
  const peak = store.potentialAbility[i];
  const decline = peak > 0 ? 1 - ca / peak : 0;
  // The one in a generation who will not stop: he never meant to, and he has
  // looked after himself all his career.
  const devotion = Math.max(0, (preference - 0.8) / 0.2) * (store.getAttr(i, 'professionalism') + store.getAttr(i, 'durability')) / 40;
  // Most stop in their mid-thirties. The ones still going past that are the
  // ones built to last — the hazard barely climbs to 42, and only then closes
  // in: dozens play on past 40, and the oldest is usually 43 or so. For the
  // devoted few it closes in slowly enough that one may play on near 50.
  const byAge = age <= 36 ? Math.max(0, (age - 30) * 0.055)
    : 0.33 + (age - 36) * 0.01 + Math.max(0, age - 42) * (0.15 - devotion * 0.12);
  let p = byAge + Math.max(0, decline - 0.15) * 0.75;
  p *= 1.45 - preference * 0.9;
  if (store.clubId[i] < 0) p += 0.3;
  return Math.min(1, p);
}

/** This season's plans, once announced — null before then, or on a save from before they were. */
export function plansThisSeason(world: World): Record<number, RetirementPlan> | null {
  const r = world.retirementPlans;
  return r !== undefined && r.season === world.season ? r.plans : null;
}

/** A player's plan to stop at the end of this season, if he has one. */
export function retirementPlan(world: World, p: number): RetirementPlan | undefined {
  return plansThisSeason(world)?.[p];
}

/** Whether he stops at the end of this season. */
export function willRetire(world: World, p: number): boolean {
  const plan = retirementPlan(world, p);
  return plan !== undefined && plan.persuaded !== true;
}

/** Someone the paper would write about: a name in a league it follows, an international, a winner, a star. */
function notable(world: World, p: number, clubId: number): boolean {
  const store = world.players;
  const club = clubId >= 0 ? world.clubs[clubId] : undefined;
  return clubId === world.userClubId || store.currentAbility[p] >= 1350 || store.nationalCaps[p] >= 25 ||
    store.careerTitles[p] >= 2 || (followed(world, club) && store.currentAbility[p] >= 1050);
}

/** Each day: in the middle of January, who will stop at the end of the season says so. */
export function retirementDay(world: World): void {
  if (dayOfSeason(world) !== ANNOUNCE_DAY) return;
  const store = world.players;
  const plans: Record<number, RetirementPlan> = {};
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.hasFlag(i, PlayerFlag.Youth) || store.clubId[i] < 0) continue;
    if (ageAtSeasonEnd(world, i) < 29) continue;
    if (!world.rng.chance(retirementHazard(world, i))) continue;
    plans[i] = { clubId: store.clubId[i], announced: world.day };
  }
  world.retirementPlans = { season: world.season, plans };

  // The paper: the best-known names, a handful a day's worth.
  const names = Object.keys(plans).map(Number).filter((p) => notable(world, p, plans[p].clubId))
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  for (const p of names.slice(0, 8)) {
    const club = world.clubs[plans[p].clubId];
    postNews(world, {
      kind: 'retirement',
      headline: `${store.fullName(p)} to retire at the end of the season`,
      body: `${store.fullName(p)}, ${describe(world, p)} at ${club?.name ?? 'his club'}, has announced that this will be his last season.` +
        careerLine(world, p),
      nation: club?.nation ?? store.nation[p],
      clubId: club?.id,
      playerIdx: p,
      fans: { story: 'retiring', club: club?.id, player: p },
    });
  }

  // The manager hears about his own first.
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  for (const p of own?.players ?? []) {
    if (plans[p] === undefined) continue;
    postMessage(world, {
      category: 'contract',
      subject: `${store.fullName(p)} wants to retire`,
      body: `${store.fullName(p)} has come to see you: at the end of the season, at ${store.ageOn(p, world.year, 181)}, he means to stop. ` +
        'You can try to talk him into one more season — or ask him to stay on another way, on your coaching staff.',
      playerIdx: p,
      retirementOf: p,
    });
  }
}

// ---- The manager's word -----------------------------------------------------------------

/**
 * Try to talk one of the manager's players into another season. A player
 * still near his best, who never meant to stop early, who loves the club and
 * trusts his coach, may listen; a man of forty is going. One try.
 */
export function persuadeToPlayOn(world: World, p: number): string {
  const plan = retirementPlan(world, p);
  const store = world.players;
  if (plan === undefined || store.clubId[p] !== world.userClubId) return 'He has no plans to stop.';
  if (plan.talked !== undefined) return 'You have already had that conversation.';
  if (plan.staffRole !== undefined) return 'He has agreed to join your staff — he is stopping.';
  const age = store.ageOn(p, world.year, 181);
  const ca = store.currentAbility[p];
  const peak = Math.max(1, store.potentialAbility[p]);
  const attr = (k: Parameters<typeof store.getAttr>[1]): number => store.getAttr(p, k) - 10;
  const manager = world.career.attributes?.manManagement ?? 10;
  let chance = 0.42 - Math.max(0, age - 32) * 0.06 + (ca / peak - 0.82) * 1.6
    + attr('retirementPreference') * 0.025 + attr('loyalty') * 0.015 + attr('determination') * 0.01
    + (manager - 10) * 0.02 + (store.morale[p] - 55) / 250;
  if (age >= 44) chance = Math.min(chance, 0.04);
  chance = Math.max(0.03, Math.min(0.85, chance));
  const name = store.fullName(p);
  if (!world.rng.chance(chance)) {
    plan.talked = 'refused';
    return `${name} has listened, but his mind is made up: this season is his last.`;
  }
  plan.talked = 'stayed';
  plan.persuaded = true;
  // One more season: a contract that ends now runs a year longer, on the same terms.
  if (store.contractUntil[p] <= seasonEndDay(world.season)) store.contractUntil[p] = seasonEndDay(world.season + 1);
  store.morale[p] = Math.min(100, store.morale[p] + 8);
  return `${name} will play on for another season — his contract now runs to 30 June ${seasonEndYear(world, world.season + 1)}.`;
}

/** How likely he is to take a role on the staff: a leader, a professional, a club man — and the job has to suit him. */
function staffWillingness(world: World, p: number, role: StaffRole): number {
  const store = world.players;
  const attr = (k: Parameters<typeof store.getAttr>[1]): number => store.getAttr(p, k) - 10;
  let fit = 0;
  if (role === StaffRole.AssistantCoach) fit = attr('leadership') * 0.02 + attr('teamwork') * 0.01;
  if (role === StaffRole.YouthCoach) fit = attr('teamwork') * 0.02 + attr('professionalism') * 0.01;
  if (role === StaffRole.StrengthCoach) fit = attr('workEthic') * 0.02 + attr('stamina') * 0.01;
  if (role === StaffRole.Scout) fit = attr('concentration') * 0.015 + attr('adaptability') * 0.015;
  if (role === StaffRole.PerformanceAnalyst) fit = attr('concentration') * 0.02 + attr('composure') * 0.01;
  const chance = 0.5 + fit + attr('professionalism') * 0.015 + attr('loyalty') * 0.02 + attr('leadership') * 0.01;
  return Math.max(0.08, Math.min(0.92, chance));
}

/** Ask one of the manager's retiring players to join the staff as he stops. */
export function offerStaffRole(world: World, p: number, role: StaffRole): string {
  const plan = retirementPlan(world, p);
  const store = world.players;
  const club = world.clubs[world.userClubId];
  const name = store.fullName(p);
  if (plan === undefined || club === undefined || store.clubId[p] !== club.id) return 'He has no plans to stop.';
  if (plan.persuaded === true) return `${name} is playing on — the staff can wait.`;
  if (plan.staffRole !== undefined) return `${name} has already agreed to join as ${STAFF_ROLE_NAMES[plan.staffRole].toLowerCase()}.`;
  if (plan.declinedRole === true) return `${name} has already said no to a place on the staff.`;
  const { have, max } = roleCount(world, club, role);
  if (have >= max) return `There is no place for another ${STAFF_ROLE_NAMES[role].toLowerCase()} — release one first.`;
  if (!world.rng.chance(staffWillingness(world, p, role))) {
    plan.declinedRole = true;
    return `${name} thanks you, but he wants a break from the game when he stops.`;
  }
  plan.staffRole = role;
  return `${name} will join your staff as ${STAFF_ROLE_NAMES[role].toLowerCase()} when he retires at the end of the season.`;
}

// ---- Going ------------------------------------------------------------------------------

/**
 * As he stops: the paper's farewell, if he is someone it writes about — what
 * his career came to — and, if he agreed to it, his place on the staff.
 * Called just before he leaves the books.
 */
export function farewell(world: World, p: number): void {
  const store = world.players;
  const clubId = store.clubId[p];
  const plan = retirementPlan(world, p);
  if (notable(world, p, clubId)) {
    const club = clubId >= 0 ? world.clubs[clubId] : undefined;
    postNews(world, {
      kind: 'retirement',
      headline: `${store.fullName(p)} retires`,
      body: `${store.fullName(p)} has played his last match${club !== undefined ? ` for ${club.name}` : ''}, at ${store.ageOn(p, world.year, 181)}.` +
        `${careerLine(world, p)}${plan?.staffRole !== undefined ? ` He stays on at the club as ${STAFF_ROLE_NAMES[plan.staffRole].toLowerCase()}.` : ''}`,
      nation: club?.nation ?? store.nation[p],
      clubId: club?.id,
      playerIdx: p,
      fans: { story: 'retired', club: club?.id, player: p },
    });
  }
  if (plan?.staffRole !== undefined && clubId >= 0) {
    const club = world.clubs[clubId];
    if (club !== undefined && roleCount(world, club, plan.staffRole).have < roleCount(world, club, plan.staffRole).max) {
      const s = staffFromPlayer(world, p, plan.staffRole, clubId);
      if (clubId === world.userClubId) {
        postMessage(world, {
          category: 'staff',
          subject: `${staffName(s)} joins the staff`,
          body: `${staffName(s)} has hung up his shoes and starts as your ${STAFF_ROLE_NAMES[s.role].toLowerCase()}, on a two-season contract.`,
          staffId: s.id,
        });
      }
    }
  }
}

/** What a career came to, in a sentence (with its leading space) — nothing when none of it is on record yet. */
function careerLine(world: World, p: number): string {
  const store = world.players;
  const parts: string[] = [];
  if (store.careerMatches[p] > 0) parts.push(`${store.careerMatches[p].toLocaleString()} matches`, `${store.careerPoints[p].toLocaleString()} points`);
  if (store.careerTitles[p] > 0) parts.push(`${store.careerTitles[p]} title${store.careerTitles[p] > 1 ? 's' : ''}`);
  if (store.nationalCaps[p] > 0) parts.push(`${store.nationalCaps[p]} caps for ${NATIONS[store.nation[p]]?.name ?? 'his country'}`);
  return parts.length > 0 ? ` His career: ${parts.join(', ')}.` : '';
}

/** "the 36-year-old opposite". */
function describe(world: World, p: number): string {
  const store = world.players;
  return `the ${store.ageOn(p, world.year, 181)}-year-old ${POSITION_NAMES[store.position[p] as Position].toLowerCase()}`;
}

/**
 * A player become a member of staff: what he did on court is what he can
 * teach — a hitter coaches attacking, a setter setting, a libero passing — a
 * leader manages men, a professional keeps discipline; and he knows the game
 * where he played it.
 */
export function staffFromPlayer(world: World, p: number, role: StaffRole, clubId: number): Staff {
  const store = world.players;
  const rng = new Rng((world.seed ^ Math.imul(p + 1, 2654435761)) >>> 0);
  const g = (k: Parameters<typeof store.getAttr>[1]): number => store.getAttr(p, k);
  const mix = (...xs: number[]): number => Math.max(1, Math.min(20, Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 0.85 + 1.5 + rng.gaussian(0, 1))));
  const attributes: StaffAttributes = {
    coachAttacking: mix(g('spikeTechnique'), g('quickAttack'), g('ballControl')),
    coachBlocking: mix(g('blocking'), g('verticalJump')),
    coachServing: mix(g('jumpServe'), g('floatServe'), g('servingAccuracy')),
    coachReception: mix(g('reception'), g('digging'), g('ballControl')),
    coachSetting: mix(g('setting'), g('ballControl')),
    coachTactical: mix(g('concentration'), g('composure'), g('adaptability')),
    coachMental: mix(g('composure'), g('pressureHandling'), g('confidence')),
    coachFitness: mix(g('stamina'), g('workEthic'), g('recovery')),
    judgingAbility: mix(g('concentration'), g('adaptability'), 8),
    potentialAssessment: mix(g('concentration'), 8, 8),
    physiotherapy: mix(6, 6, g('professionalism')),
    sportsScience: mix(g('workEthic'), g('professionalism'), 6),
    manManagement: mix(g('leadership'), g('teamwork')),
    discipline: mix(g('discipline'), g('professionalism')),
    motivating: mix(g('leadership'), g('determination')),
    workingWithYouth: mix(g('teamwork'), g('leadership'), g('professionalism')),
    adaptability: g('adaptability'),
    loyalty: g('loyalty'),
    ambition: g('ambition'),
  };
  // He knows the game best where he played it.
  const conf: Confederation = NATIONS[store.nation[p]]?.confederation ?? 'CEV';
  const regionKnowledge = { CEV: 6, CSV: 6, NORCECA: 6, AVC: 6, CAVB: 6 } as Record<Confederation, number>;
  regionKnowledge[conf] = 14;
  const club = world.clubs[clubId];
  const [first, ...rest] = store.fullName(p).split(' ');
  const s: Staff = {
    id: world.staff.length,
    firstName: first,
    lastName: rest.join(' ') || first,
    nation: store.nation[p],
    birthYear: store.birthYear[p],
    role,
    clubId,
    attributes,
    regionKnowledge,
    nationKnowledge: new Map([[store.nation[p], 16]]),
    wage: Math.round((4_000 + Math.pow((club?.reputation ?? 3000) / 10_000, 1.5) * 160_000) / 1000) * 1000,
    contractUntil: seasonEndDay(world.season + 2),
    // A name from his playing days.
    reputation: Math.round(Math.min(10_000, store.currentAbility[p] * 4 + store.nationalCaps[p] * 20)),
  };
  world.staff.push(s);
  club?.staff.push(s.id);
  return s;
}
