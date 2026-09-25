/**
 * Pre-match press conferences.
 *
 * The day before a fixture, the press want time with the manager. Attending
 * opens a short conference: a handful of journalists, each asking one
 * question, each with their own idea of what a good answer sounds like. The
 * tone chosen per question is a small, real lever rather than flavour text —
 * it nudges morale on both sides, and how well it lands with that particular
 * journalist changes their body language for the rest of the conversation.
 * Morale feeds straight into match ratings (see match/ratings.ts), so this
 * sits in the same currency as a training session or a team talk. Declining
 * is always safe — no risk, but no reward either.
 */

import type { Rng } from '../core/rng.ts';
import { NO_CLUB } from '../model/players.ts';
import type { World } from './world.ts';

export type AnswerCategory = 'positive' | 'neutral' | 'convince';
export type BodyLanguage = 'hostile' | 'skeptical' | 'neutral' | 'pleased' | 'encouraged' | 'delighted';

export interface JournalistProfile {
  name: string;
  outlet: string;
  /** The tone of answer this journalist responds best to. */
  bias: AnswerCategory;
  gender: 'men' | 'women';
  /** Portrait pool index — see ui/faces.ts's `portraitUrl()`. */
  photoId: number;
}

export interface InterviewOption {
  category: AnswerCategory;
  text: string;
  /** Morale change (0-100 scale, clamped) applied to the manager's own squad. */
  ownMorale: number;
  /** Morale change applied to the opponent's squad — the risk side of the wager. */
  opponentMorale: number;
}

export interface InterviewQuestion {
  journalist: JournalistProfile;
  prompt: string;
  options: InterviewOption[];
  /** Index into `options` once answered, else null. */
  answeredIndex: number | null;
  /** How this journalist is reading the manager — 'neutral' until answered. */
  bodyLanguage: BodyLanguage;
}

export interface InterviewSession {
  fixtureId: number;
  questions: InterviewQuestion[];
  /** Index of the question currently on the floor. */
  currentIndex: number;
  /** True once every question has been answered — awaiting `closeInterview`. */
  finished: boolean;
}

export interface AnswerResult {
  option: InterviewOption;
  bodyLanguage: BodyLanguage;
  finished: boolean;
}

// ---- Static content ---------------------------------------------------

const QUESTIONS_PER_CONFERENCE = 4;

const JOURNALIST_POOL: readonly JournalistProfile[] = [
  { name: 'Priya Nandan', outlet: 'VolleyWorld', bias: 'positive', gender: 'women', photoId: 12 },
  { name: 'Marcus Feld', outlet: 'Court Side Report', bias: 'convince', gender: 'men', photoId: 31 },
  { name: 'Ana Bristow', outlet: 'The Net Post', bias: 'neutral', gender: 'women', photoId: 47 },
  { name: 'Hugo Salerno', outlet: 'SpikeTV', bias: 'convince', gender: 'men', photoId: 8 },
  { name: 'Ingrid Solvang', outlet: 'Intl. Volleyball Review', bias: 'positive', gender: 'women', photoId: 63 },
  { name: 'Dean Okafor', outlet: 'Match Point Daily', bias: 'neutral', gender: 'men', photoId: 54 },
  { name: 'Camille Duarte', outlet: 'Rally Sports Network', bias: 'convince', gender: 'women', photoId: 22 },
  { name: 'Tobias Renn', outlet: 'The Serve', bias: 'positive', gender: 'men', photoId: 76 },
  { name: 'Naomi Ilic', outlet: 'Baseline Weekly', bias: 'neutral', gender: 'women', photoId: 5 },
  { name: 'Ricardo Mendes', outlet: 'First Whistle', bias: 'convince', gender: 'men', photoId: 90 },
];

interface QuestionArchetype {
  prompt: (opponent: string, isHome: boolean) => string;
  positive: readonly [string, string];
  neutral: readonly [string, string];
  convince: readonly [string, string];
}

const QUESTION_ARCHETYPES: readonly QuestionArchetype[] = [
  {
    prompt: (opp, home) => `How confident are you heading into ${home ? 'hosting' : 'the trip to'} ${opp}?`,
    positive: [
      "We respect the opponent and we're focused on our own performance.",
      "It's not about confidence, it's about preparation, and we've prepared well.",
    ],
    neutral: [
      'We like our chances, but nothing is decided on paper.',
      'Every match in this league is difficult, and this one will be no different.',
    ],
    convince: [
      'Frankly, I expect us to win this one comfortably.',
      "We're the better team, and I want the players to believe that too.",
    ],
  },
  {
    prompt: (opp) => `${opp} have been in good form lately. Are they the team to beat?`,
    positive: [
      "They've earned that form — credit to them.",
      "We're watching the same tape everyone else is. They're a good side.",
    ],
    neutral: [
      "Form is temporary. It's the head-to-head that decides these things.",
      "We'll worry about our own game, not theirs.",
    ],
    convince: [
      "Good form or not, we're not afraid of anyone.",
      "Let's see how their form holds up against us.",
    ],
  },
  {
    prompt: (opp, home) => `What's your message to the squad before ${home ? 'hosting' : 'facing'} ${opp}?`,
    positive: [
      'Simple: play our game, trust the process.',
      'Stay calm, stick to the plan, and the result will follow.',
    ],
    neutral: [
      'Focus on the process, not the opponent.',
      'One point at a time, like always.',
    ],
    convince: [
      'Go out and take it — nobody hands you these matches.',
      "I've told them to be ruthless from the first serve.",
    ],
  },
  {
    prompt: (opp) => `Any concerns going into the match against ${opp}?`,
    positive: [
      'A few fitness niggles, nothing that worries me.',
      'Just the usual — travel, recovery, small things.',
    ],
    neutral: [
      'No more than any other week.',
      "It's a long season, there's always something to manage.",
    ],
    convince: [
      'None at all — we are ready.',
      "The only concern is whether they can handle us.",
    ],
  },
  {
    prompt: (opp) => `How do you rate ${opp}'s chances against you?`,
    positive: [
      'Any team can beat any team on the day. We respect that.',
      "They'll fancy their chances, as they should.",
    ],
    neutral: [
      "That's for them to answer, not me.",
      "We'll find out on the court.",
    ],
    convince: [
      "Slim, if I'm honest.",
      "I don't think they'll like what we bring.",
    ],
  },
];

const CATEGORY_ORDER: Readonly<Record<AnswerCategory, number>> = { positive: 0, neutral: 1, convince: 2 };

const CATEGORY_MORALE: Readonly<Record<AnswerCategory, { ownMorale: number; opponentMorale: number }>> = {
  positive: { ownMorale: 1, opponentMorale: 0 },
  neutral: { ownMorale: 2, opponentMorale: 1 },
  convince: { ownMorale: 4, opponentMorale: 3 },
};

/** How a journalist reads an answer relative to what they wanted to hear —
 *  a direct hit reads as warm, the opposite tone reads as skeptical. */
function reactionFor(bias: AnswerCategory, chosen: AnswerCategory): BodyLanguage {
  const distance = Math.abs(CATEGORY_ORDER[bias] - CATEGORY_ORDER[chosen]);
  if (distance === 0) return 'encouraged';
  if (distance === 1) return 'pleased';
  return 'skeptical';
}

/** `n` distinct items from `pool`, order randomised — a partial Fisher-Yates. */
function pickDistinct<T>(rng: Rng, pool: readonly T[], n: number): T[] {
  const arr = pool.slice();
  const count = Math.min(n, arr.length);
  for (let i = 0; i < count; i++) {
    const j = rng.int(i, arr.length - 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

function buildQuestion(archetype: QuestionArchetype, journalist: JournalistProfile, opponent: string, isHome: boolean): InterviewQuestion {
  const options: InterviewOption[] = [
    { category: 'positive', text: archetype.positive[0], ...CATEGORY_MORALE.positive },
    { category: 'positive', text: archetype.positive[1], ...CATEGORY_MORALE.positive },
    { category: 'neutral', text: archetype.neutral[0], ...CATEGORY_MORALE.neutral },
    { category: 'neutral', text: archetype.neutral[1], ...CATEGORY_MORALE.neutral },
    { category: 'convince', text: archetype.convince[0], ...CATEGORY_MORALE.convince },
    { category: 'convince', text: archetype.convince[1], ...CATEGORY_MORALE.convince },
  ];
  return {
    journalist,
    prompt: archetype.prompt(opponent, isHome),
    options,
    answeredIndex: null,
    bodyLanguage: 'neutral',
  };
}

// ---- Lifecycle ----------------------------------------------------------

/**
 * Line up tomorrow's press conference for the user's club, if they have a
 * fixture then and haven't already been offered one. Called once a day;
 * `day` is the day being checked (the caller passes `world.day + 1`, i.e.
 * "tomorrow," before advancing the clock).
 */
export function generateInterviewSessions(world: World, day: number): void {
  if (world.userClubId < 0) return;
  const fixtureIds = world.fixturesByDay.get(day);
  if (fixtureIds === undefined) return;

  for (const fid of fixtureIds) {
    const f = world.fixtures[fid];
    if (f.played) continue;
    if (f.home !== world.userClubId && f.away !== world.userClubId) continue;
    if (world.interviewedFixtures.has(f.id)) continue;

    const isHome = f.home === world.userClubId;
    const opponentId = isHome ? f.away : f.home;
    const opponent = world.clubs[opponentId];
    if (opponent === undefined) continue; // e.g. a bye or an unresolved bracket slot

    world.interviewedFixtures.add(f.id);

    const archetypes = pickDistinct(world.rng, QUESTION_ARCHETYPES, QUESTIONS_PER_CONFERENCE);
    const journalists = pickDistinct(world.rng, JOURNALIST_POOL, QUESTIONS_PER_CONFERENCE);
    const questions = archetypes.map((arch, i) => buildQuestion(arch, journalists[i], opponent.shortName, isHome));

    world.pendingInterviews.push({ fixtureId: f.id, questions, currentIndex: 0, finished: false });

    world.messages.push({
      id: world.messages.length,
      day: world.day,
      year: world.year,
      subject: 'Pre-match press conference',
      body: `The press want time with you ahead of ${isHome ? 'hosting' : 'your trip to'} ${opponent.name}.`,
      category: 'interview',
      fixtureId: f.id,
    });
  }
}

function adjustSquadMorale(world: World, clubId: number, delta: number): void {
  if (delta === 0 || clubId === NO_CLUB) return;
  const club = world.clubs[clubId];
  if (club === undefined) return;
  const store = world.players;
  for (const p of club.players) {
    store.morale[p] = Math.max(0, Math.min(100, store.morale[p] + delta));
  }
}

/** Answer the current question of a session with one of its options.
 *  Applies morale to both squads, updates that journalist's body language,
 *  and advances to the next question. Returns null if there is no open
 *  session for this fixture, it's already finished, or the index is stale. */
export function answerInterviewQuestion(
  world: World,
  fixtureId: number,
  optionIndex: number,
): AnswerResult | null {
  const session = world.pendingInterviews.find((s) => s.fixtureId === fixtureId);
  if (session === undefined || session.finished) return null;
  const q = session.questions[session.currentIndex];
  if (q === undefined || q.answeredIndex !== null) return null;
  const option = q.options[optionIndex];
  if (option === undefined) return null;

  const bodyLanguage = reactionFor(q.journalist.bias, option.category);
  q.answeredIndex = optionIndex;
  q.bodyLanguage = bodyLanguage;

  const f = world.fixtures[fixtureId];
  const isHome = f.home === world.userClubId;
  const opponentId = isHome ? f.away : f.home;
  // A question that clearly landed (or badly misjudged the room) nudges the
  // outcome a little further than the flat category effect alone.
  let ownDelta = option.ownMorale;
  if (bodyLanguage === 'encouraged') ownDelta += 1;
  else if (bodyLanguage === 'skeptical') ownDelta -= 1;
  adjustSquadMorale(world, world.userClubId, ownDelta);
  adjustSquadMorale(world, opponentId, option.opponentMorale);

  session.currentIndex++;
  if (session.currentIndex >= session.questions.length) {
    session.finished = true;
    const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === fixtureId);
    if (msg !== undefined) {
      msg.body = `You fielded ${session.questions.length} questions from the press before the match.`;
    }
  }

  return { option, bodyLanguage, finished: session.finished };
}

/** Skip the conference entirely — no risk, but no reward either. */
export function declineInterview(world: World, fixtureId: number): boolean {
  const idx = world.pendingInterviews.findIndex((s) => s.fixtureId === fixtureId);
  if (idx === -1) return false;
  world.pendingInterviews.splice(idx, 1);
  const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === fixtureId);
  if (msg !== undefined) msg.body = 'You declined to attend the press conference.';
  return true;
}

/** Dismiss a finished conference's summary — a no-op on one still in progress. */
export function closeInterview(world: World, fixtureId: number): void {
  const idx = world.pendingInterviews.findIndex((s) => s.fixtureId === fixtureId);
  if (idx !== -1 && world.pendingInterviews[idx].finished) world.pendingInterviews.splice(idx, 1);
}

/** Drop any session whose fixture has already been played — in progress or
 *  merely finished-but-unclosed alike, since there is nothing left to show
 *  once the match itself has happened. */
export function expireStaleInterviews(world: World): void {
  if (world.pendingInterviews.length === 0) return;
  const live: InterviewSession[] = [];
  for (const s of world.pendingInterviews) {
    const played = world.fixtures[s.fixtureId]?.played ?? true;
    if (!played) { live.push(s); continue; }
    if (!s.finished) {
      const msg = world.messages.find((m) => m.category === 'interview' && m.fixtureId === s.fixtureId);
      if (msg !== undefined) msg.body = 'The moment passed — the press conference was never finished.';
    }
  }
  world.pendingInterviews = live;
}
