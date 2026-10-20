/**
 * The monthly staff meeting: on the third of each month the assistant, the scouts, the doctor and
 * the rest bring the manager what they think wants doing — a player who deserves a new contract, a
 * position short for next season, someone heading for an injury, an academy player ready to step
 * up, a youngster who needs games, a player the club could do without, one who is down. Each
 * suggestion is his to take or leave; whatever is still open when the next meeting comes lapses.
 *
 * Taken, most of them are done on the spot here. Two open something for him to finish himself —
 * the contract talks, and a word with the player — which the interface does (see the state).
 */

import { PlayerFlag } from '../model/players.ts';
import { MAX_SQUAD, POSITION_NAMES, POSITION_SHORT, Position, POSITIONS } from '../model/positions.ts';
import { StaffRole, STAFF_ROLE_NAMES } from '../model/staff.ts';
import { loadOf as matchLoadOf } from './fatigue.ts';
import { MONTH_STARTS, postMessage } from './inbox.ts';
import { loanOf } from './loans.ts';
import { willRetire } from './retirement.ts';
import { addPlanTarget, PLAN_DEPTH, planCandidates, squadPlan, tidyPlanTargets } from './squadPlanner.ts';
import { contractEndSeason, DAYS_PER_SEASON, seasonEndDay, seasonEndYear, type World } from './world.ts';

export type MeetingKind = 'renew' | 'position' | 'injury' | 'youth' | 'loan' | 'sell' | 'morale';

export interface MeetingItem {
  id: number;
  kind: MeetingKind;
  /** Who brings it, and his name — or the role's, with nobody in the job. */
  role: StaffRole;
  from: string;
  p?: number;
  position?: Position;
  season?: number;
  title: string;
  text: string;
  /** What taking it does, on its button: "Open contract talks". */
  accept: string;
  status: 'open' | 'accepted' | 'declined' | 'lapsed';
  /** What came of it, once decided. */
  outcome?: string;
}

export interface StaffMeeting {
  id: number;
  day: number;
  items: MeetingItem[];
}

/** The meeting's day of each month: the third, out of the way of the first's statement. */
const MEETING_OFFSET = 2;
/** At most this many suggestions a meeting. */
const MAX_ITEMS = 6;
/** A suggestion settled either way isn't brought up again for this long. */
const MEMORY_DAYS = 56;
/** A doctor's lighter fortnight. */
export const MEDICAL_REST_DAYS = 14;

/** Whether today is a meeting day. */
export function isMeetingDay(world: World): boolean {
  const d = world.day % DAYS_PER_SEASON;
  return world.day > 0 && MONTH_STARTS.some((m) => m + MEETING_OFFSET === d);
}

export function meetingsOf(world: World): StaffMeeting[] {
  return world.staffMeetings ?? [];
}

export function meetingById(world: World, id: number): StaffMeeting | undefined {
  return meetingsOf(world).find((m) => m.id === id);
}

/** The suggestion still to answer in a meeting, if any. */
export function openItems(m: StaffMeeting): MeetingItem[] {
  return m.items.filter((i) => i.status === 'open');
}

/** A player on lighter work on the doctor's word, until when — or undefined. */
export function medicalRestUntil(world: World, p: number): number | undefined {
  const until = world.medicalRest?.[p];
  return until !== undefined && until >= world.day ? until : undefined;
}

function staffName(world: World, clubId: number, roles: readonly StaffRole[]): { role: StaffRole; from: string } {
  for (const role of roles) {
    const s = world.staff.find((x) => x.clubId === clubId && x.role === role);
    if (s !== undefined) return { role, from: `${s.firstName} ${s.lastName}` };
  }
  return { role: roles[0], from: STAFF_ROLE_NAMES[roles[0]] };
}

const keyOf = (kind: MeetingKind, ref: number): string => `${kind}:${ref}`;

/** Settled lately — not to be brought up again yet. */
function remembered(world: World, kind: MeetingKind, ref: number): boolean {
  const day = world.meetingMemory?.[keyOf(kind, ref)];
  return day !== undefined && world.day - day < MEMORY_DAYS;
}

function remember(world: World, item: MeetingItem): void {
  const ref = item.p ?? item.position ?? -1;
  (world.meetingMemory ??= {})[keyOf(item.kind, ref)] = world.day;
}

const plural = (position: Position): string => `${POSITION_NAMES[position].toLowerCase()}s`;

/** What the staff would bring up today, the most pressing first. */
export function meetingSuggestions(world: World): Array<Omit<MeetingItem, 'id' | 'status'>> {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return [];
  const store = world.players;
  const seniors = club.players.filter((p) =>
    store.isActive(p) && !store.hasFlag(p, PlayerFlag.Youth) && loanOf(world, p) === undefined);
  const byAbility = [...seniors].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const name = (p: number): string => store.fullName(p);
  const out: Array<Omit<MeetingItem, 'id' | 'status'>> = [];
  const inTalks = new Set(world.talks.map((t) => t.playerIdx));
  const seasonDay = world.day % DAYS_PER_SEASON;

  // ---- The assistant: contracts worth renewing.
  const assistant = staffName(world, club.id, [StaffRole.AssistantCoach]);
  const core = new Set(byAbility.slice(0, 7));
  const renew = seniors.filter((p) => {
    const ends = contractEndSeason(store.contractUntil[p]);
    // This season's last months, or — from January — next season's too.
    const soon = ends === world.season || (ends === world.season + 1 && seasonDay >= 184);
    const age = store.ageOn(p, world.year, 181);
    const promising = age <= 24 && store.potentialAbility[p] >= store.currentAbility[p] + 150;
    return soon && (core.has(p) || promising) && age <= 32 && !inTalks.has(p) && !willRetire(world, p)
      && !store.hasFlag(p, PlayerFlag.Transferable) && !remembered(world, 'renew', p);
  }).sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 2);
  for (const p of renew) {
    const ends = `30 June ${seasonEndYear(world, contractEndSeason(store.contractUntil[p]))}`;
    const age = store.ageOn(p, world.year, 181);
    out.push({
      ...assistant, kind: 'renew', p,
      title: `${name(p)} deserves a new contract`,
      text: core.has(p)
        ? `He is one of our best (${POSITION_SHORT[store.position[p] as Position]}, ${age}) and his deal runs out on ${ends}. I'd tie him down before someone else comes for him.`
        : `At ${age} he is getting better every month, and his deal runs out on ${ends}. Keep him now, while he is cheap.`,
      accept: 'Open contract talks',
    });
  }

  // ---- The scouts: a position short of what the squad needs.
  const scout = staffName(world, club.id, [StaffRole.HeadScout, StaffRole.RecruitmentAnalyst, StaffRole.Scout]);
  const plan = squadPlan(world, club);
  const shortages: Array<{ position: Position; season: number; gaps: number; have: number }> = [];
  for (const [i, position] of POSITIONS.entries()) {
    for (const cell of plan.cells[i].slice(0, 2)) {
      if (cell.gaps === 0 || cell.targets.length >= cell.gaps) continue;
      shortages.push({ position, season: cell.season, gaps: cell.gaps, have: PLAN_DEPTH[position] - cell.gaps });
      break;
    }
  }
  shortages.sort((a, b) => a.season - b.season || b.gaps - a.gaps);
  for (const s of shortages.filter((x) => !remembered(world, 'position', x.position)).slice(0, 1)) {
    const when = s.season === world.season ? 'this season' : 'next season';
    out.push({
      ...scout, kind: 'position', position: s.position, season: s.season,
      title: `We are short of ${plural(s.position)}`,
      text: `${s.have === 0 ? 'Nobody is' : `Only ${s.have}`} under contract ${when}, and a squad wants ${PLAN_DEPTH[s.position]}. ` +
        'Say the word and I will put some names on the squad plan and go and watch them.',
      accept: 'Find candidates',
    });
  }

  // ---- The doctor: someone heading for an injury.
  const doctor = staffName(world, club.id, [StaffRole.Doctor, StaffRole.Physiotherapist]);
  const risks = seniors.flatMap((p) => {
    if (store.injuryDaysLeft[p] > 0 || medicalRestUntil(world, p) !== undefined || remembered(world, 'injury', p)) return [];
    const why: string[] = [];
    if (store.condition[p] < 70) why.push(`he is worn down (${store.condition[p]}% condition)`);
    if (matchLoadOf(world, p) >= 2) why.push('he has played a lot of matches lately');
    if (store.getAttr(p, 'injuryProneness') >= 14) why.push('his body has a history of breaking down');
    if (store.ageOn(p, world.year, 181) >= 31) why.push(`at ${store.ageOn(p, world.year, 181)} he takes longer to recover`);
    return why.length >= 2 ? [{ p, why }] : [];
  }).sort((a, b) => b.why.length - a.why.length || store.condition[a.p] - store.condition[b.p]).slice(0, 2);
  for (const { p, why } of risks) {
    out.push({
      ...doctor, kind: 'injury', p,
      title: `${name(p)} is at risk of an injury`,
      text: `${why.slice(0, 2).join(', and ').replace(/^./, (c) => c.toUpperCase())}. I'd lighten his training for two weeks.`,
      accept: 'Lighten his training',
    });
  }

  // ---- The youth coach: an academy player ready for the first team.
  const youthCoach = staffName(world, club.id, [StaffRole.YouthCoach, StaffRole.AssistantCoach]);
  if (club.players.length < MAX_SQUAD) {
    const ready = club.youthPlayers.filter((p) => {
      if (!store.isActive(p) || store.ageOn(p, world.year, 181) < 17 || remembered(world, 'youth', p)) return false;
      const rivals = seniors.filter((q) => store.position[q] === store.position[p]);
      const weakest = rivals.length > 0 ? Math.min(...rivals.map((q) => store.currentAbility[q])) : 0;
      return store.currentAbility[p] >= weakest * 0.95 || rivals.length < PLAN_DEPTH[store.position[p] as Position];
    }).sort((a, b) => store.potentialAbility[b] - store.potentialAbility[a]).slice(0, 1);
    for (const p of ready) {
      out.push({
        ...youthCoach, kind: 'youth', p,
        title: `${name(p)} is ready for the first team`,
        text: `${store.ageOn(p, world.year, 181)}, a ${POSITION_NAMES[store.position[p] as Position].toLowerCase()}, and already as good as some of the senior squad. Promote him and he will learn faster with the first team.`,
        accept: 'Promote him',
      });
    }
  }

  // ---- The assistant again: a youngster who needs games, and a player we could do without.
  const benched = seniors.filter((p) => store.ageOn(p, world.year, 181) <= 22 && store.playingTime[p] < 20
    && !store.hasFlag(p, PlayerFlag.LoanListed) && !remembered(world, 'loan', p))
    .sort((a, b) => store.potentialAbility[b] - store.potentialAbility[a]).slice(0, 1);
  for (const p of benched) {
    out.push({
      ...assistant, kind: 'loan', p,
      title: `${name(p)} needs games`,
      text: 'He is barely getting on court here, and at his age he needs to play. A season on loan would do him more good than the bench.',
      accept: 'Offer him out on loan',
    });
  }
  if (seniors.length > 12) {
    const wages = [...seniors].map((p) => store.wage[p]).sort((a, b) => a - b);
    const median = wages[Math.floor(wages.length / 2)];
    const spare = byAbility.slice(-3).filter((p) => store.ageOn(p, world.year, 181) >= 28 && store.wage[p] >= median
      && !store.hasFlag(p, PlayerFlag.Transferable) && !remembered(world, 'sell', p)).slice(0, 1);
    for (const p of spare) {
      out.push({
        ...assistant, kind: 'sell', p,
        title: `${name(p)} isn't part of our plans`,
        text: 'He is among the weakest in the squad and on more than most. Selling him would free the wages for someone who will play.',
        accept: 'Put him on the transfer list',
      });
    }
  }

  // ---- The psychologist: someone who is down.
  const mind = staffName(world, club.id, [StaffRole.SportsPsychologist, StaffRole.AssistantCoach]);
  const low = seniors.filter((p) => store.morale[p] < 35 && !remembered(world, 'morale', p))
    .sort((a, b) => store.morale[a] - store.morale[b]).slice(0, 1);
  for (const p of low) {
    out.push({
      ...mind, kind: 'morale', p,
      title: `${name(p)} is down`,
      text: 'His head has gone a bit — it shows in training. A word from you would mean more than anything from us.',
      accept: 'Call him in',
    });
  }

  // The most pressing first: an injury or a contract before the rest.
  const order: Record<MeetingKind, number> = { injury: 0, renew: 1, position: 2, youth: 3, morale: 4, loan: 5, sell: 6 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, MAX_ITEMS);
}

/** The meeting, on its day: what is left open from the last lapses, and the new one goes to the inbox. */
export function staffMeetingDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || !isMeetingDay(world)) return;
  tidyPlanTargets(world, club);
  for (const m of meetingsOf(world)) for (const i of openItems(m)) i.status = 'lapsed';
  const suggestions = meetingSuggestions(world);
  if (suggestions.length === 0) return;
  const meetings = (world.staffMeetings ??= []);
  const id = (meetings.at(-1)?.id ?? 0) + 1;
  const meeting: StaffMeeting = { id, day: world.day, items: suggestions.map((s, i) => ({ ...s, id: i, status: 'open' })) };
  meetings.push(meeting);
  // A year of meetings is plenty to look back on.
  if (meetings.length > 12) meetings.splice(0, meetings.length - 12);
  const n = meeting.items.length;
  postMessage(world, {
    category: 'staff', from: 'Staff meeting',
    subject: `Staff meeting: ${n} suggestion${n === 1 ? '' : 's'}`,
    body: 'The staff have met for the month. Each of them has brought you something: take it or leave it — whatever is still open at next month\'s meeting lapses.',
    meetingId: id,
  });
}

/**
 * Take a suggestion: what can be done here is done. The renewal and the word with the player are
 * left for the interface to open; this marks them taken.
 */
export function acceptSuggestion(world: World, meetingId: number, itemId: number): MeetingItem | undefined {
  const item = meetingById(world, meetingId)?.items.find((i) => i.id === itemId);
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (item === undefined || item.status !== 'open' || club === undefined) return undefined;
  const store = world.players;
  const p = item.p ?? -1;
  switch (item.kind) {
    case 'renew':
      item.outcome = 'Contract talks opened.';
      break;
    case 'morale':
      item.outcome = 'You called him in for a word.';
      break;
    case 'position': {
      const position = item.position!;
      const season = item.season ?? world.season;
      const picks = planCandidates(world, club, position, 3, season);
      for (const c of picks) {
        addPlanTarget(world, c, position, season);
        if (!world.scoutingQueue.some((t) => t.playerIdx === c)) {
          world.scoutingQueue.push({ playerIdx: c, completesOnDay: world.day + 7, matches: 5 });
        }
      }
      item.outcome = picks.length === 0
        ? 'Nobody suitable within reach right now — the scouts will keep looking.'
        : `${picks.map((c) => store.fullName(c)).join(', ')} added to the squad plan. Full reports in a week.`;
      break;
    }
    case 'injury':
      (world.medicalRest ??= {})[p] = world.day + MEDICAL_REST_DAYS;
      item.outcome = 'On lighter training for the next two weeks.';
      break;
    case 'youth':
      if (club.players.length >= MAX_SQUAD) {
        item.outcome = 'No room in the squad: there are already twenty.';
        break;
      }
      club.youthPlayers = club.youthPlayers.filter((q) => q !== p);
      if (!club.players.includes(p)) club.players.push(p);
      store.setFlag(p, PlayerFlag.Youth, false);
      store.contractUntil[p] = Math.max(store.contractUntil[p], seasonEndDay(world.season + 2));
      item.outcome = 'Promoted to the first team.';
      break;
    case 'loan':
      store.setFlag(p, PlayerFlag.LoanListed, true);
      item.outcome = 'Offered out on loan: clubs can now ask for him.';
      break;
    case 'sell':
      store.setFlag(p, PlayerFlag.Transferable, true);
      item.outcome = 'On the transfer list.';
      break;
  }
  item.status = 'accepted';
  remember(world, item);
  return item;
}

/** Leave a suggestion: noted, and not brought up again for a while. */
export function declineSuggestion(world: World, meetingId: number, itemId: number): void {
  const item = meetingById(world, meetingId)?.items.find((i) => i.id === itemId);
  if (item === undefined || item.status !== 'open') return;
  item.status = 'declined';
  item.outcome = 'Noted — left as it is.';
  remember(world, item);
}
