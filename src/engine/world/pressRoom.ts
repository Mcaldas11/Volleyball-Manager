/**
 * What the press know, and how each of them asks — the part of a press
 * conference that makes it a different one every time.
 *
 * The occasion (interviews.ts) says what a match is about. This says what the
 * room has in its notebooks: the box score of the match just played — who
 * scored, the aces, the blocks, the errors, how the passing held up, the runs
 * of points, the set that would not end — and before a match the last time
 * the two met, the gap in the table, the fixtures piling up, who is hurt, who
 * has just arrived, a milestone on the horizon, a contract running down. And
 * it remembers: what the manager said last time, the bold promise made the
 * day before, which questions he has already been asked this month.
 *
 * Each journalist has a voice of their own — the statistician, the blunt one,
 * the local reporter, the tactician, the storyteller, the tabloid — that
 * shapes how a question opens and how they take an answer. A bold answer
 * draws a follow-up; a dodge, in a big room, gets called out. And every
 * answer leaves a quote behind for the next conference to pick up.
 *
 * None of it touches the stakes of an answer: what the tones do for morale is
 * still interviews.ts's to decide. This only writes.
 */

import { Rng } from '../core/rng.ts';
import { POSITION_NAMES, type Position } from '../model/positions.ts';
import { compareTableRows } from '../model/club.ts';
import type { AnswerCategory, Archetype, BodyLanguage, Ctx, InterviewKind, InterviewQuestion } from './interviews.ts';
import { seasonEndDay, type Fixture, type World } from './world.ts';

// ---- Voices ------------------------------------------------------------------------------

/** How a journalist asks. */
export type Voice = 'stats' | 'blunt' | 'local' | 'tactical' | 'story' | 'tabloid';

export const VOICE_LABEL: Readonly<Record<Voice, string>> = {
  stats: 'Numbers',
  blunt: 'Straight talker',
  local: 'Local beat',
  tactical: 'Tactics',
  story: 'Feature writer',
  tabloid: 'Headline hunter',
};

/** How a question opens, voice by voice — often not at all. `{city}` is the club's city. */
const OPENERS: Readonly<Record<Voice, readonly string[]>> = {
  stats: ['', '', 'Looking at the numbers — ', 'One for the stat sheet: ', 'The data says one thing — '],
  blunt: ['', '', 'Straight question: ', 'Coach, ', "I'll be direct. ", 'Simple one: '],
  local: ['', '', 'For the fans back home — ', 'People in {city} are asking: ', 'Our listeners want to know: '],
  tactical: ['', '', 'On the tactical side — ', 'Tactically, ', 'Looking at the matchup, '],
  story: ['', '', "It's been quite a week. ", 'Take us inside the dressing room. ', 'A broader one, if I may. '],
  tabloid: ['', '', 'Our readers want to know: ', "Everyone's talking about it — ", 'Let me put it to you: '],
};

/** Words a question can start with that read as well in lower case after an opener. */
const LOWERABLE = new Set([
  'How', 'What', 'Is', 'Are', 'Do', 'Does', 'Can', 'Any', 'Where', 'Why', 'Who', 'Will', 'Was', 'Were', 'Did', 'Your',
  'You', 'Nobody', 'Everyone', 'There', "There's", "It's", 'It', 'The', 'That', "That's", 'Should', 'Would', 'Could',
  'Has', 'Have', 'Which', 'When', 'After', 'Before', 'If', 'Some', 'Many', 'Only', 'Just', 'With', 'Last',
  'Not', 'No', 'Nothing', 'One', 'Two', 'Three', 'A', 'An', 'Talk', 'Take', 'Bold', 'Strong', 'Even', 'Level', 'Every',
  'Everything', 'Next', "Isn't", "Aren't", 'Let', 'Looking', 'Straight', 'Simple', 'Since', 'Against',
  'Our', 'Their', 'This', 'These', 'Those', 'At', 'In', 'On', 'For', 'From', 'To', "Don't",
  "Can't", "Won't", "Didn't", 'Tonight', 'Tomorrow', 'Yesterday', "Everyone's",
]);

/** A question as a journalist with this voice would put it. */
export function voiced(rng: Rng, voice: Voice | undefined, prompt: string, city: string): string {
  if (voice === undefined) return prompt;
  let opener = rng.pick(OPENERS[voice]);
  if (opener.includes('{city}')) {
    if (city === '') return prompt;
    opener = opener.replace('{city}', city);
  }
  if (opener === '') return prompt;
  const first = prompt.split(/[\s,.?!:;—]/, 1)[0];
  const body = opener.endsWith(': ') || opener.endsWith('. ') || !LOWERABLE.has(first)
    ? prompt
    : prompt[0].toLowerCase() + prompt.slice(1);
  return opener + body;
}

// ---- What the room knows -----------------------------------------------------------------

/** A player's night at the office. */
export interface Scorer {
  p: number;
  pts: number;
  kills: number;
  aces: number;
  blocks: number;
}

/** One side's numbers from a match. */
export interface SideNumbers {
  top: Scorer | null;
  /** The best blocker, if he blocked anything. */
  blocker: Scorer | null;
  aces: number;
  blocks: number;
  kills: number;
  attacks: number;
  /** Points given away: missed serves, attacks out or into the net or blocked, receptions shanked, faults. */
  errors: number;
  serveErrors: number;
  /** Kills less errors and blocked attacks, per attack, %. */
  attackEff: number;
  /** Receptions that left the setter something, %; -1 with none. */
  passPct: number;
  longestRun: number;
  /** The youngest who did something: 20 or under, 6 points or more. */
  kid: { p: number; age: number; pts: number } | null;
}

/** Something the manager said that the press have kept. */
export interface PressQuote {
  day: number;
  fixtureId: number;
  kind: InterviewKind;
  tone: AnswerCategory;
  text: string;
  /** What the question was about, if it was a promise worth holding him to. */
  topic: string;
}

/** What the press remember from one conference to the next. */
export interface PressMemory {
  /** Topics asked lately, the latest last. */
  asked: string[];
  /** What the manager has said lately, the latest last. */
  quotes: PressQuote[];
  /** How each journalist gets on with the manager, -100 (hostile) to 100 (an ally), by name — absent, 0. */
  relations?: Record<string, number>;
}

/** The press's notebooks for one conference. */
export interface PressFacts {
  /** After the match: each side's numbers, if the match was kept. */
  own: SideNumbers | null;
  opp: SideNumbers | null;
  /** The sets, from our side. */
  sets: Array<[number, number]>;
  /** The longest set, if one ran past 27 points (17 in a fifth). */
  longSet: { n: number; score: [number, number] } | null;
  /** The most one-sided set, if one was won or lost by 9 or more. */
  heavySet: { n: number; score: [number, number] } | null;
  /** Before it: the last time the two met. */
  h2h: { won: boolean; score: string; daysAgo: number } | null;
  /** League points between us and them (ours less theirs), and to the top, when in the same league. */
  gap: number | null;
  leaderGap: number | null;
  leaderName: string;
  /** Competitive matches in the ten days before this one. */
  busy: number;
  /** Our players out injured. */
  injured: number[];
  /** Arrived in the last six weeks. */
  signing: { p: number; from: string; days: number } | null;
  /** A round number of career matches he reaches with this one. */
  milestone: { p: number; n: number } | null;
  /** One of the best whose contract runs out this summer. */
  expiring: number;
  /** The last match before this one. */
  last: { won: boolean; score: string; opp: string; top: Scorer | null } | null;
  /** In the form of his life. */
  hot: number;
  /** The next match after this one: whom, and in how many days. */
  next: { opp: string; days: number } | null;
  /** What he said before this match (afterwards) or after the last one (before this). */
  callback: PressQuote | null;
}

export function emptyFacts(): PressFacts {
  return {
    own: null, opp: null, sets: [], longSet: null, heavySet: null, h2h: null, gap: null, leaderGap: null, leaderName: '',
    busy: 0, injured: [], signing: null, milestone: null, expiring: -1, last: null, hot: -1, next: null, callback: null,
  };
}

/** Each field of a kept player line, by name — see matchReports.ts's PLAYER_FIELDS. */
const F = {
  servesTotal: 0, serveAces: 1, serveErrors: 2, receptionsTotal: 3, receptionPerfect: 4, receptionPositive: 5,
  receptionPoor: 6, receptionErrors: 7, attacksTotal: 8, attackKills: 9, attackErrors: 10, attackBlocked: 11,
  blockPoints: 12, blockTouches: 13, blockErrors: 14, digsTotal: 15, digErrors: 16, setsMade: 17, setAssists: 18,
  setErrors: 19, ralliesPlayed: 20, plusMinus: 21,
} as const;

function sideNumbers(world: World, lines: number[][], side: 0 | 1, longestRun: number): SideNumbers {
  const store = world.players;
  let aces = 0, blocks = 0, kills = 0, attacks = 0, errors = 0, serveErrors = 0, attackErrors = 0, blocked = 0, passes = 0, good = 0;
  let top: Scorer | null = null;
  let blocker: Scorer | null = null;
  let kid: SideNumbers['kid'] = null;
  for (const line of lines) {
    if (line[1] !== side) continue;
    const v = (k: keyof typeof F): number => line[2 + F[k]] ?? 0;
    const s: Scorer = { p: line[0], kills: v('attackKills'), aces: v('serveAces'), blocks: v('blockPoints'), pts: 0 };
    s.pts = s.kills + s.aces + s.blocks;
    aces += s.aces;
    blocks += s.blocks;
    kills += s.kills;
    attacks += v('attacksTotal');
    blocked += v('attackBlocked');
    attackErrors += v('attackErrors');
    serveErrors += v('serveErrors');
    errors += v('serveErrors') + v('attackErrors') + v('attackBlocked') + v('receptionErrors') + v('blockErrors') + v('setErrors');
    passes += v('receptionsTotal');
    good += v('receptionPerfect') + v('receptionPositive');
    if (top === null || s.pts > top.pts) top = s;
    if (s.blocks > 0 && (blocker === null || s.blocks > blocker.blocks)) blocker = s;
    const age = store.ageOn(s.p, world.year, 181);
    if (age <= 20 && s.pts >= 6 && (kid === null || s.pts > kid.pts)) kid = { p: s.p, age, pts: s.pts };
  }
  return {
    top, blocker, aces, blocks, kills, attacks, errors, serveErrors,
    attackEff: attacks > 0 ? Math.round(((kills - attackErrors - blocked) / attacks) * 100) : 0,
    passPct: passes > 0 ? Math.round((good / passes) * 100) : -1,
    longestRun, kid,
  };
}

/** A competitive match of the manager's club: not a friendly, not a nation's. */
function competitive(world: World, f: Fixture): boolean {
  const kind = world.competitions[f.competitionId]?.kind;
  return kind !== 'friendly' && kind !== 'international';
}

/** League points, from the table. */
function points(world: World, leagueId: number, clubId: number): number | null {
  const row = world.competitions[leagueId]?.table.find((r) => r.clubId === clubId);
  return row === undefined ? null : row.points;
}

/** Everything the room knows about a club's match. */
export function gatherFacts(world: World, f: Fixture, kind: InterviewKind, clubId: number, oppId: number): PressFacts {
  const facts = emptyFacts();
  const store = world.players;
  const club = world.clubs[clubId];
  const opp = world.clubs[oppId];
  if (club === undefined || opp === undefined) return facts;
  const isHome = f.home === clubId;
  const ours = (fx: Fixture): boolean => fx.home === clubId || fx.away === clubId;

  // How it went.
  if (kind === 'post') {
    facts.sets = f.setScores.map(([h, a]) => (isHome ? [h, a] : [a, h]));
    facts.sets.forEach(([a, b], i) => {
      const long = a + b - (i === 4 ? 30 : 50);
      if (long >= 5 && (facts.longSet === null || a + b > facts.longSet.score[0] + facts.longSet.score[1])) {
        facts.longSet = { n: i + 1, score: [a, b] };
      }
      if (Math.abs(a - b) >= 9 && (facts.heavySet === null || Math.abs(a - b) > Math.abs(facts.heavySet.score[0] - facts.heavySet.score[1]))) {
        facts.heavySet = { n: i + 1, score: [a, b] };
      }
    });
    const report = world.matchReports?.get(f.id);
    if (report !== undefined) {
      const us = isHome ? 0 : 1;
      facts.own = sideNumbers(world, report.lines, us, report.longestRun[us]);
      facts.opp = sideNumbers(world, report.lines, us === 0 ? 1 : 0, report.longestRun[us === 0 ? 1 : 0]);
    }
  }

  // The story before it.
  const before = kind === 'pre' ? f.day : f.day - 1;
  let h2h: Fixture | null = null;
  let last: Fixture | null = null;
  let busy = 0;
  for (const x of world.fixtures) {
    if (!x.played || x.id === f.id || x.day > before || !ours(x) || !competitive(world, x)) continue;
    if ((x.home === oppId || x.away === oppId) && (h2h === null || x.day > h2h.day)) h2h = x;
    if (last === null || x.day > last.day) last = x;
    if (x.day > f.day - 10) busy++;
  }
  const said = (x: Fixture): { won: boolean; score: string } => {
    const own = x.home === clubId ? x.homeSets : x.awaySets;
    const their = x.home === clubId ? x.awaySets : x.homeSets;
    return { won: own > their, score: `${own}-${their}` };
  };
  if (h2h !== null) facts.h2h = { ...said(h2h), daysAgo: f.day - h2h.day };
  if (kind === 'pre' && last !== null) {
    const lastOpp = world.clubs[last.home === clubId ? last.away : last.home];
    const report = world.matchReports?.get(last.id);
    const us = last.home === clubId ? 0 : 1;
    facts.last = {
      ...said(last), opp: lastOpp?.name ?? 'them',
      top: report === undefined ? null : sideNumbers(world, report.lines, us, report.longestRun[us]).top,
    };
  }
  facts.busy = busy;

  // The table.
  const league = world.competitions[club.leagueId];
  if (league !== undefined && league.kind === 'league' && opp.leagueId === club.leagueId) {
    const own = points(world, club.leagueId, clubId);
    const their = points(world, club.leagueId, oppId);
    if (own !== null && their !== null) facts.gap = own - their;
  }
  if (league !== undefined && league.kind === 'league') {
    const table = [...league.table].sort(compareTableRows);
    const own = table.find((r) => r.clubId === clubId);
    if (table[0] !== undefined && own !== undefined && own.played >= 4 && table[0].clubId !== clubId) {
      facts.leaderGap = table[0].points - own.points;
      facts.leaderName = world.clubs[table[0].clubId]?.name ?? '';
    }
  }

  // The squad.
  const players = club.players;
  const best = [...players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  facts.injured = players.filter((p) => store.injuryDaysLeft[p] > 0).sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const arrival = [...world.transferLog].reverse().find((t) => t.toClub === clubId && world.day - t.day <= 42 && store.clubId[t.playerIdx] === clubId);
  if (arrival !== undefined) {
    facts.signing = { p: arrival.playerIdx, from: world.clubs[arrival.fromClub]?.name ?? 'free agency', days: Math.max(1, world.day - arrival.day) };
  }
  if (kind === 'pre') {
    for (const p of best.slice(0, 8)) {
      const n = store.careerMatches[p] + 1;
      if (n >= 50 && n % 50 === 0) { facts.milestone = { p, n }; break; }
    }
  }
  facts.expiring = best.slice(0, 4).find((p) => store.contractUntil[p] <= seasonEndDay(world.season)) ?? -1;
  facts.hot = best.slice(0, 7).find((p) => store.form[p] >= 80 && store.injuryDaysLeft[p] === 0) ?? -1;

  // What comes next.
  let next: Fixture | null = null;
  for (const id of world.fixturesByDay.keys()) {
    if (id <= f.day || (next !== null && id >= next.day)) continue;
    for (const fid of world.fixturesByDay.get(id) ?? []) {
      const x = world.fixtures[fid];
      if (!x.played && ours(x) && competitive(world, x)) { next = x; break; }
    }
  }
  if (next !== null && kind === 'post') {
    const nextOpp = world.clubs[next.home === clubId ? next.away : next.home];
    if (nextOpp !== undefined) facts.next = { opp: nextOpp.name, days: next.day - f.day };
  }

  // What he said.
  const quotes = world.press?.quotes ?? [];
  if (kind === 'post') {
    facts.callback = [...quotes].reverse().find((q) => q.fixtureId === f.id && q.kind === 'pre' && q.tone === 'convince') ?? null;
  } else {
    facts.callback = [...quotes].reverse().find((q) => q.kind === 'post' && q.tone === 'convince' && f.day - q.day <= 14) ?? null;
  }
  return facts;
}

/** The lines the press have in front of them — what a writer (or a language model) is told. */
export function briefOf(c: Ctx, kind: InterviewKind, occasion: string): string[] {
  const out: string[] = [];
  const f = c.facts;
  const n = (p: number): string => c.world.players.fullName(p);
  out.push(`${kind === 'pre' ? 'Before' : 'After'} ${c.club.name} v ${c.opp.name} — ${occasion}${c.compName !== '' ? `, ${c.compName}` : ''}.`);
  if (kind === 'post') out.push(`Result for ${c.club.name}: ${c.tags.has('won') ? 'won' : 'lost'} ${c.score}; sets ${f.sets.map(([a, b]) => `${a}-${b}`).join(', ')}.`);
  if (c.ownPos > 0) out.push(`${c.club.name} are ${ordinalOf(c.ownPos)} in the league${c.oppPos > 0 ? `, ${c.opp.name} ${ordinalOf(c.oppPos)}` : ''}.`);
  if (c.run >= 2) out.push(`${c.club.name} have won ${c.run} in a row.`);
  if (c.run <= -2) out.push(`${c.club.name} have lost ${-c.run} in a row.`);
  if (f.own?.top) out.push(`Top scorer for ${c.club.name}: ${n(f.own.top.p)}, ${plural(f.own.top.pts, 'point')} (${plural(f.own.top.kills, 'kill')}, ${plural(f.own.top.aces, 'ace')}, ${plural(f.own.top.blocks, 'block')}).`);
  if (f.opp?.top) out.push(`Top scorer for ${c.opp.name}: ${n(f.opp.top.p)}, ${plural(f.opp.top.pts, 'point')}.`);
  if (f.own !== null && f.opp !== null) {
    out.push(`Aces ${f.own.aces}-${f.opp.aces}, blocks ${f.own.blocks}-${f.opp.blocks}, errors ${f.own.errors}-${f.opp.errors}, attack efficiency ${f.own.attackEff}%-${f.opp.attackEff}%${f.own.passPct >= 0 ? `, ${c.club.name} passed ${f.own.passPct}% positive` : ''}.`);
  }
  if (f.longSet) out.push(`The ${SET_NAMES[f.longSet.n - 1]} set went ${f.longSet.score[0]}-${f.longSet.score[1]}.`);
  if (f.h2h) out.push(`Last meeting, ${f.h2h.daysAgo} days ago: ${c.club.name} ${f.h2h.won ? 'won' : 'lost'} ${f.h2h.score}.`);
  if (f.gap !== null && kind === 'pre' && c.ownPos > 0) {
    out.push(`League points: ${c.club.name} ${f.gap === 0 ? 'level with' : f.gap > 0 ? `${f.gap} ahead of` : `${-f.gap} behind`} ${c.opp.name}.`);
  }
  if (f.injured.length > 0) out.push(`Injured: ${f.injured.slice(0, 3).map(n).join(', ')}.`);
  if (c.oppStar >= 0) out.push(`${c.opp.name}'s danger man: ${n(c.oppStar)}.`);
  if (c.ownStar >= 0) out.push(`${c.club.name}'s best player: ${n(c.ownStar)}.`);
  if (f.signing) out.push(`New signing: ${n(f.signing.p)}, from ${f.signing.from} ${f.signing.days} days ago.`);
  if (f.milestone) out.push(`${n(f.milestone.p)} is due his ${f.milestone.n}th career match.`);
  if (f.next) out.push(`Next: ${f.next.opp} in ${f.next.days} days.`);
  if (f.callback) out.push(`Earlier the manager said: "${f.callback.text}"`);
  return out;
}

function ordinalOf(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

const SET_NAMES = ['first', 'second', 'third', 'fourth', 'fifth'] as const;

// ---- The questions the notebooks make ----------------------------------------------------

/** Two answers of each tone: positive, neutral, convince. */
type Six = readonly [string, string, string, string, string, string];

const nm = (c: Ctx, p: number): string => c.world.players.shortName(p);
const pos = (c: Ctx, p: number): string => POSITION_NAMES[c.world.players.position[p] as Position].toLowerCase();
const won = (c: Ctx): boolean => c.tags.has('won');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Questions from the notebooks: after the match. Each `r` picks a phrasing. */
export const POST_TOPICS: readonly Archetype[] = [
  {
    id: 'post-own-scorer', kind: 'post', needs: [], weight: 4,
    when: (c) => (c.facts.own?.top?.pts ?? 0) >= 14 && c.facts.own?.top?.p !== c.mvp,
    about: (c) => c.facts.own!.top!.p,
    prompt: (c, r) => {
      const t = c.facts.own!.top!;
      return r.pick([
        `${nm(c, t.p)} finished with ${t.pts} points tonight. How much did you lean on him?`,
        `${t.pts} points for ${nm(c, t.p)} — ${t.kills} of them in attack. Is he playing the best volleyball of his career?`,
        `Talk us through ${nm(c, t.p)}'s night: ${t.kills} kills${t.aces > 0 ? `, ${plural(t.aces, 'ace')}` : ''}${t.blocks > 0 ? `, ${plural(t.blocks, 'block')}` : ''}.`,
      ]);
    },
    answers: (c, r) => {
      const t = c.facts.own!.top!;
      return [
        r.pick([`${nm(c, t.p)} was outstanding. He carried the attack when we needed it.`, `He was immense. ${t.pts} points doesn't even tell the whole story.`]),
        r.pick(['He deserves every bit of the credit tonight.', 'When he plays like that, we are a different team.']),
        r.pick(['The points come from the passes before them. It was a team effort.', 'He finished the rallies — but somebody built them first.']),
        r.pick(['He did his job. So did others.', "A good night for him. Tomorrow it's someone else's turn."]),
        r.pick(["Good, but he left points out there too. I'll show him the tape.", 'He can be even better, and he knows it.']),
        r.pick(["I expect that from him every match. It's his level.", "That's his standard. Anything less and we'll talk."]),
      ];
    },
  },
  {
    id: 'post-opp-scorer', kind: 'post', needs: [], weight: 4,
    when: (c) => (c.facts.opp?.top?.pts ?? 0) >= 18,
    prompt: (c, r) => {
      const t = c.facts.opp!.top!;
      return r.pick([
        `${nm(c, t.p)} put ${t.pts} points past you. Why couldn't you contain him?`,
        `${c.opp.name}'s ${pos(c, t.p)} ${nm(c, t.p)} scored ${t.pts}. ${won(c) ? 'You won anyway — but should that worry you?' : 'Did he beat you on his own?'}`,
        `Was there a plan for ${nm(c, t.p)}? He finished with ${t.pts} points.`,
      ]);
    },
    answers: (c, r) => {
      const t = c.facts.opp!.top!;
      return [
        r.pick([`Credit to ${nm(c, t.p)}. On a night like that he is very hard to stop.`, 'Great players find a way. Hats off to him.']),
        r.pick(['He made some unbelievable shots. Sometimes you just accept it.', 'We knew he was dangerous. He showed why.']),
        r.pick(['We had a plan. We executed it in some rotations, not in others.', 'We kept him quiet in spells. Not for long enough.']),
        r.pick([`${t.pts} points is a lot, but we'll look at the whole picture.`, "One player's numbers don't decide matches. The rest of it does."]),
        r.pick(["Our block was not good enough against him. That's on us.", 'We gave him too many easy balls. That has to stop.']),
        r.pick(["We made him look better than he is.", 'If we serve properly, he does not get those swings.']),
      ];
    },
  },
  {
    id: 'post-errors', kind: 'post', needs: [], weight: 4,
    when: (c) => c.facts.own !== null && (c.facts.own.errors >= 26 || c.facts.own.errors >= (c.facts.opp?.errors ?? 99) + 7),
    prompt: (c, r) => {
      const o = c.facts.own!;
      return r.pick([
        `You gave away ${o.errors} points in errors${o.serveErrors >= 8 ? ` — ${o.serveErrors} of them on the serve` : ''}. Where does that come from?`,
        `${o.errors} errors tonight${c.facts.opp ? ` against ${c.facts.opp.errors} from ${c.opp.name}` : ''}. ${won(c) ? 'Can you keep winning like that?' : 'Did you beat yourselves?'}`,
        `The error count — ${o.errors} — jumps off the sheet. Is it nerves, fatigue or something else?`,
      ]);
    },
    answers: (c, r) => [
      r.pick(['We play an aggressive game. Errors are the price, and the players are brave enough to pay it.', 'I would rather they go for it than play scared.']),
      r.pick(['The players know. Nobody wants to miss.', "They'll be the first to say it. I don't need to."]),
      r.pick(['Some were forced, some were not. We will separate the two.', "We'll look at it calmly. Not every error is the same."]),
      r.pick(['It is a number we track every week. This week it was too high.', 'Too many, yes. We work on it from tomorrow.']),
      r.pick([`${won(c) ? 'We won in spite of ourselves.' : 'We gifted them the match.'} That is not acceptable.`, 'Basic mistakes at this level are unacceptable.']),
      r.pick(['Some of those errors were lazy. Lazy is not allowed here.', "If we can't control the controllables, others will play."]),
    ],
  },
  {
    id: 'post-serve', kind: 'post', needs: [], weight: 3,
    when: (c) => (c.facts.own?.aces ?? 0) >= 6 || (c.facts.own?.serveErrors ?? 0) >= 12,
    prompt: (c, r) => {
      const o = c.facts.own!;
      return o.aces >= 6
        ? r.pick([
          `${o.aces} aces tonight. Was the serve the plan from the start?`,
          `Your servers hit ${o.aces} aces. How much of the match was won from the service line?`,
        ])
        : r.pick([
          `${o.serveErrors} missed serves. Is the risk you take from the line too high?`,
          `You missed ${o.serveErrors} serves tonight. Will you ask the servers to take something off?`,
        ]);
    },
    answers: (c, r) => {
      const aces = (c.facts.own?.aces ?? 0) >= 6;
      return aces ? [
        r.pick(['The servers were brave and precise. A great night from the line.', 'They worked so hard on it in training. Lovely to see it pay off.']),
        'When the serve goes in like that, everything else gets easier.',
        r.pick(['We targeted their weaker passers. It worked.', 'The serve is a plan, not luck. Tonight the plan worked.']),
        'Some nights the serve is on, some nights it is not.',
        r.pick(['Good. Now do it again on Saturday.', "Aces are nice. I'm more interested in the serves that don't win the point."]),
        "We'll serve like that against anyone. Nobody likes receiving it.",
      ] as Six : [
        r.pick(['I want them to keep attacking from the line. The misses are part of it.', 'I take responsibility for that risk. I ask for it.']),
        "They'll find the range. I trust them.",
        r.pick(['We look at the balance between risk and errors every week.', 'There is a line between aggressive and reckless. We crossed it tonight.']),
        'We will review the numbers before deciding anything.',
        'That many misses is simply not good enough.',
        'Anyone who misses like that again will be watching from the bench.',
      ] as Six;
    },
  },
  {
    id: 'post-block', kind: 'post', needs: [], weight: 3,
    when: (c) => (c.facts.own?.blocks ?? 0) >= 10 || ((c.facts.opp?.blocks ?? 0) >= 12 && !won(c)),
    about: (c) => ((c.facts.own?.blocks ?? 0) >= 10 && c.facts.own?.blocker ? c.facts.own.blocker.p : -1),
    prompt: (c, r) => {
      const o = c.facts.own!;
      if (o.blocks >= 10) {
        const b = o.blocker!;
        return r.pick([
          `${o.blocks} blocks tonight — ${b.blocks} of them from ${nm(c, b.p)}. Is that wall your biggest weapon?`,
          `A wall at the net: ${plural(o.blocks, 'block')}. What's the secret?`,
        ]);
      }
      return r.pick([
        `${c.opp.name} blocked you ${c.facts.opp!.blocks} times. Why couldn't your hitters find a way around it?`,
        `${c.facts.opp!.blocks} stuff blocks against you. Was your attack too predictable?`,
      ]);
    },
    answers: (c, r) => {
      if ((c.facts.own?.blocks ?? 0) >= 10) {
        return [
          r.pick(['The middles were fantastic. Reading, timing, everything.', 'Our block was magnificent. The whole front row deserves credit.']),
          'Blocking is teamwork — the serve makes it possible.',
          'We studied where they like to hit. The players did the rest.',
          'Some nights the timing is just right.',
          'Now I want the same discipline when the score is close.',
          'Nobody in this league blocks like us. They found that out.',
        ] as Six;
      }
      return [
        'Their block was excellent. Credit to their middles.',
        'They read us well tonight. That happens.',
        r.pick(['We needed to use the block more — tool it, tip, reset. We forced it.', 'Our setter had few options from a poor pass.']),
        "We'll look at our distribution. It became too obvious.",
        'Hitting into a block that many times is a choice. A bad one.',
        'The hitters have to be smarter. That is not a technical problem.',
      ] as Six;
    },
  },
  {
    id: 'post-pass', kind: 'post', needs: [], weight: 3,
    when: (c) => { const p = c.facts.own?.passPct ?? -1; return p >= 0 && (p <= 38 || p >= 62); },
    prompt: (c, r) => {
      const p = c.facts.own!.passPct;
      return p <= 38
        ? r.pick([
          `Only ${p}% of your receptions were positive. How do you play from that?`,
          `${c.opp.name}'s serve put your passers under pressure all night — ${p}% positive. What went wrong?`,
        ])
        : r.pick([
          `${p}% positive reception. Is that the foundation of this result?`,
          `Your passers were nearly perfect tonight — ${p}% positive. How much does that free the setter?`,
        ]);
    },
    answers: (c, r) => (c.facts.own!.passPct <= 38 ? [
      'Their serve was excellent. Sometimes you have to accept that.',
      'The passers fought. It was a hard night for them.',
      r.pick(['Out-of-system play was our weak point tonight.', 'From a poor pass, everything gets harder. We know it.']),
      'We will work on our reception patterns.',
      'Reception at that level is not good enough. Simple.',
      'Some players were hiding in reception. I saw it.',
    ] : [
      r.pick(['The passers were superb. That is where it starts.', 'Our libero was everywhere. A great night for him.']),
      'When the pass is there, the setter can do anything.',
      'Good reception is quiet work. It rarely gets the headlines.',
      'It was a solid night in reception, yes.',
      "That's the standard now. No going back from it.",
      'We pass like that, nobody can stop our attack.',
    ]) as Six,
  },
  {
    id: 'post-run', kind: 'post', needs: [], weight: 3,
    when: (c) => (c.facts.own?.longestRun ?? 0) >= 6 || (c.facts.opp?.longestRun ?? 0) >= 6,
    prompt: (c, r) => {
      const ours = c.facts.own!.longestRun;
      const theirs = c.facts.opp?.longestRun ?? 0;
      return ours >= theirs
        ? r.pick([`At one point you won ${ours} points in a row. What changed in that moment?`, `A run of ${ours} straight points. Who flicked the switch?`])
        : r.pick([`You conceded ${theirs} points in a row at one stage. What happens to a team in a spell like that?`, `${theirs} straight points for ${c.opp.name}. Why didn't you stop it sooner?`]);
    },
    answers: (c, r) => ((c.facts.own!.longestRun >= (c.facts.opp?.longestRun ?? 0)) ? [
      'The server got hot and the block came alive. Momentum is real.',
      'That run came from the bench too — everyone was on their feet.',
      'One good serve leads to a dig, a dig to a point. That is volleyball.',
      'Runs happen both ways. We had the better one.',
      'That is what we can do when we stay aggressive. I want it every set.',
      'When we play like that, nobody can live with us.',
    ] : [
      'It happens to every team. They showed character to come out of it.',
      'Their server was excellent in that spell.',
      r.pick(['We should have broken it sooner — a time-out, a change.', 'We lost our side-out for a moment. We will look at why.']),
      'Runs happen. The reaction is what matters.',
      'We stopped thinking. That cannot happen at this level.',
      'In a spell like that you see who wants the ball. Not enough did.',
    ]) as Six,
  },
  {
    id: 'post-long-set', kind: 'post', needs: [], weight: 4,
    when: (c) => c.facts.longSet !== null,
    prompt: (c, r) => {
      const s = c.facts.longSet!;
      const won = s.score[0] > s.score[1];
      return r.pick([
        `The ${SET_NAMES[s.n - 1]} set went ${s.score[0]}-${s.score[1]}. What goes through your mind in a set like that?`,
        `${s.score[0]}-${s.score[1]} in the ${SET_NAMES[s.n - 1]}. ${won ? 'How did you hold your nerve?' : 'How much did losing that one hurt?'}`,
      ]);
    },
    answers: (c, r) => {
      const won = c.facts.longSet!.score[0] > c.facts.longSet!.score[1];
      return [
        won ? 'The players showed huge character. Point after point.' : 'Both teams deserved that set. We were a whisker away.',
        r.pick(['That is the kind of set fans remember.', 'Sets like that make you proud of a group.']),
        "At that stage it's about one serve, one dig. Details.",
        'You stay calm and stick to what works.',
        won ? 'Good — but we should never have let it get that far.' : 'We had chances to close it. We did not take them.',
        won ? 'Pressure is where we live. We win those.' : "We won't lose a set like that again this season.",
      ] as Six;
    },
  },
  {
    id: 'post-heavy-set', kind: 'post', needs: [], weight: 3,
    when: (c) => c.facts.heavySet !== null,
    prompt: (c, r) => {
      const s = c.facts.heavySet!;
      return s.score[0] > s.score[1]
        ? r.pick([`${s.score[0]}-${s.score[1]} in the ${SET_NAMES[s.n - 1]} set — near perfect. What clicked?`, `You took the ${SET_NAMES[s.n - 1]} ${s.score[0]}-${s.score[1]}. Was that the best set you've played this season?`])
        : r.pick([`${s.score[0]}-${s.score[1]} in the ${SET_NAMES[s.n - 1]}. What happened there?`, `You only scored ${s.score[0]} in the ${SET_NAMES[s.n - 1]} set. Did the team switch off?`]);
    },
    answers: (c) => (c.facts.heavySet!.score[0] > c.facts.heavySet!.score[1] ? [
      'Everything flowed. Serve, block, transition — a joy to watch.',
      'The players were in a rhythm. Credit to them.',
      'Sometimes a set just runs away from the other team.',
      "One set. We'll take it and move on.",
      "Good. Now I want that level for five sets, not one.",
      'That is our real level. The others should get used to it.',
    ] : [
      'One bad set does not define a group.',
      'They switched off briefly — they switched back on.',
      'Everything went against us in that set. It happens.',
      "We'll analyse it like any other.",
      'That set was unacceptable. Embarrassing, frankly.',
      'Some players gave up in that set. I noticed who.',
    ]) as Six,
  },
  {
    id: 'post-claim', kind: 'post', needs: [], weight: 9,
    when: (c) => c.facts.callback !== null && c.facts.callback.kind === 'pre',
    prompt: (c, r) => {
      const q = c.facts.callback!.text;
      return won(c)
        ? r.pick([`Before the match you told us: "${q}" You delivered. Do you feel vindicated?`, `"${q}" — your words yesterday. Mission accomplished?`])
        : r.pick([`Yesterday you said: "${q}" Do you regret it now?`, `"${q}" — that was you, before the match. What do you say to that now?`]);
    },
    answers: (c) => (won(c) ? [
      'The players delivered, not my words. All credit to them.',
      'I said it because I believe in this group. They proved me right.',
      'I said what I thought. The court did the rest.',
      "Words don't win matches. Today we did.",
      'I meant every word. And I will say it again.',
      'Write it down for next time too.',
    ] : [
      'I believed it. The players gave everything; it was not our night.',
      'I take the responsibility for those words, not the players.',
      'I said what I thought. Sometimes sport proves you wrong.',
      'Regret? No. Disappointment, yes.',
      "No regrets. I'd say it again tomorrow.",
      'I said it to lift them. The players did not answer.',
    ]) as Six,
  },
  {
    id: 'post-kid', kind: 'post', needs: [], weight: 4,
    when: (c) => c.facts.own?.kid != null,
    about: (c) => c.facts.own!.kid!.p,
    prompt: (c, r) => {
      const k = c.facts.own!.kid!;
      return r.pick([
        `${nm(c, k.p)} is only ${k.age} and scored ${k.pts}. Is he ready for this level?`,
        `A big night for ${k.age}-year-old ${nm(c, k.p)} — ${k.pts} points. Where does he go from here?`,
      ]);
    },
    answers: (c) => {
      const k = c.facts.own!.kid!;
      return [
        `${nm(c, k.p)} has a huge future. Tonight he showed everyone why.`,
        'He trains like a senior. Nights like this are his reward.',
        "He did well. Let's not put pressure on a young man.",
        "One good match. He knows there's a long way to go.",
        "Good, but I want more consistency before we start talking.",
        "He'll get chances if he works. Nothing is given here.",
      ] as Six;
    },
  },
  {
    id: 'post-next', kind: 'post', needs: [], weight: 2,
    when: (c) => c.facts.next !== null && c.facts.next.days <= 4,
    prompt: (c, r) => {
      const n = c.facts.next!;
      return r.pick([
        `${n.opp} in ${plural(n.days, 'day')}. How quickly can you recover?`,
        `Next up is ${n.opp}, ${n.days <= 2 ? 'almost straight away' : `in ${n.days} days`}. Any changes in mind?`,
      ]);
    },
    answers: (c) => [
      "The players are fit. They'll be ready.",
      'Recovery starts tonight. The staff do a great job.',
      "We'll see who's fresh. Rotation is always an option.",
      'One match at a time. Tonight first.',
      `${c.facts.next!.opp} should be worried. We're coming.`,
      'Same intensity, same demands. No excuses about the schedule.',
    ],
  },
  {
    id: 'post-table', kind: 'post', needs: ['won'], weight: 2,
    when: (c) => c.facts.leaderGap !== null && c.facts.leaderGap <= 6 && c.facts.leaderGap > 0,
    prompt: (c, r) => r.pick([
      `That leaves you ${plural(c.facts.leaderGap!, 'point')} behind ${c.facts.leaderName}. Can you catch them?`,
      `The gap to ${c.facts.leaderName} at the top is ${c.facts.leaderGap}. Are you in the title race?`,
    ]),
    answers: () => [
      'The players are in a great moment. We just keep going.',
      'We focus on ourselves. The table will take care of itself.',
      "It's a long season. Too early to talk about a race.",
      "We don't look at the table until the end.",
      "Yes. And they know we're coming.",
      'Catch them? We will pass them.',
    ],
  },
];

/** Questions from the notebooks: before the match. */
export const PRE_TOPICS: readonly Archetype[] = [
  {
    id: 'pre-h2h', kind: 'pre', needs: [], weight: 4,
    when: (c) => c.facts.h2h !== null && c.facts.h2h.daysAgo <= 200,
    prompt: (c, r) => {
      const h = c.facts.h2h!;
      const when = h.daysAgo <= 10 ? 'only last week' : h.daysAgo <= 45 ? 'a few weeks ago' : 'earlier this season';
      return h.won
        ? r.pick([`You beat ${c.opp.name} ${h.score} ${when}. Does that give you an edge?`, `${h.score} to you the last time you met. Will they have learned from it?`])
        : r.pick([`${c.opp.name} beat you ${h.score} ${when}. What did you learn from that one?`, `Last time out against ${c.opp.name} it finished ${h.score} to them. Is this revenge?`]);
    },
    answers: (c) => (c.facts.h2h!.won ? [
      "That was a good night for us, but they're a different team now.",
      'It gives the players confidence, nothing more.',
      'Every match is new. The last one means very little.',
      "They'll have studied it as much as we have.",
      'We know how to beat them. We showed it.',
      'They know what is coming. That is their problem.',
    ] : [
      'They deserved it that night. We have grown since.',
      "We learned a lot about ourselves. That's useful.",
      'We have watched it again. There were details to fix.',
      "Revenge isn't a tactic. Preparation is.",
      'We owe them one. The players know it.',
      'That will not happen twice.',
    ]) as Six,
  },
  {
    id: 'pre-gap', kind: 'pre', needs: [], weight: 3,
    when: (c) => c.facts.gap !== null && c.ownPos > 0 && c.oppPos > 0 && Math.abs(c.facts.gap) <= 6,
    prompt: (c, r) => {
      const g = c.facts.gap!;
      return g === 0
        ? r.pick([`Level on points with ${c.opp.name}. Is this a six-pointer?`, `Nothing separates you from ${c.opp.name} in the table. How big is this one?`])
        : g > 0
          ? r.pick([`You're ${plural(g, 'point')} ahead of ${c.opp.name}. Can you afford to lose this?`, `A win puts real daylight between you and ${c.opp.name}. Is that the message?`])
          : r.pick([`${c.opp.name} are ${plural(-g, 'point')} ahead of you. Is this the night to close the gap?`, `You're chasing ${c.opp.name} — ${-g} points behind. Must-win?`]);
    },
    answers: () => [
      'Every match is important. This one is no different.',
      'The players love these nights. They are ready.',
      "It's three points, like any other match.",
      'The table at the end matters. Not tomorrow.',
      'It matters a lot, and we are going to take the points.',
      "We don't lose matches like this at home or away.",
    ],
  },
  {
    id: 'pre-title-gap', kind: 'pre', needs: [], weight: 2,
    when: (c) => c.facts.leaderGap !== null && c.facts.leaderGap > 0 && c.facts.leaderGap <= 9 && !c.tags.has('leaders'),
    prompt: (c, r) => r.pick([
      `You're ${plural(c.facts.leaderGap!, 'point')} off the top. Is the title realistic?`,
      `${c.facts.leaderName} lead you by ${c.facts.leaderGap}. Can you still win the league?`,
    ]),
    answers: () => [
      'Everything is possible with this group.',
      'We have to win our matches and see. That is all we control.',
      'It is too early to talk about titles.',
      "We'll know in April, not now.",
      'Yes. The title is the target.',
      'They are looking over their shoulder. They should be.',
    ],
  },
  {
    id: 'pre-busy', kind: 'pre', needs: [], weight: 3,
    when: (c) => c.facts.busy >= 3,
    prompt: (c, r) => r.pick([
      `This is your ${ordinalOf(c.facts.busy + 1)} match in ten days. Will you rotate?`,
      `${c.facts.busy} matches in the last ten days. How tired is the squad?`,
      'The fixtures are piling up. Is fatigue becoming a problem?',
    ]),
    answers: () => [
      'The players are professionals. They have managed it brilliantly.',
      'We have a deep squad. Everyone will play their part.',
      'We monitor every player. Decisions tomorrow, after training.',
      'Fatigue is part of the season. We plan for it.',
      'Tired? Nobody here is tired. We want every match.',
      'The schedule is the same for everyone. No excuses.',
    ],
  },
  {
    id: 'pre-injuries', kind: 'pre', needs: [], weight: 3,
    when: (c) => c.facts.injured.length >= 2,
    prompt: (c, r) => {
      const names = c.facts.injured.slice(0, 2).map((p) => nm(c, p)).join(' and ');
      return r.pick([
        `You're without ${plural(c.facts.injured.length, 'player')}, ${names} among them. How do you cope?`,
        `The treatment room is busy — ${names} both out. Is the squad deep enough?`,
      ]);
    },
    answers: () => [
      'We wish them a quick recovery. The others are ready.',
      "It's a chance for players who have waited for it.",
      'The medical staff are working hard. We adapt.',
      'Injuries are part of sport. We plan for them.',
      'The squad is strong enough. No excuses.',
      'Whoever plays will win. Simple as that.',
    ],
  },
  {
    id: 'pre-signing', kind: 'pre', needs: [], weight: 4,
    when: (c) => c.facts.signing !== null,
    about: (c) => c.facts.signing!.p,
    prompt: (c, r) => {
      const s = c.facts.signing!;
      return r.pick([
        `${nm(c, s.p)} only arrived from ${s.from} ${plural(s.days, 'day')} ago. Will he play?`,
        `How has ${nm(c, s.p)} settled in since joining from ${s.from}?`,
      ]);
    },
    answers: (c) => [
      `${nm(c, c.facts.signing!.p)} has been excellent in training. The group loves him.`,
      "He's settled in quickly. He's a great addition.",
      "We'll see. He needs time to learn our system.",
      "He's one of the squad now, like everyone else.",
      "He'll play if he's earned it. Reputation counts for nothing here.",
      'We signed him to make a difference. He will.',
    ],
  },
  {
    id: 'pre-milestone', kind: 'pre', needs: [], weight: 4,
    when: (c) => c.facts.milestone !== null,
    about: (c) => c.facts.milestone!.p,
    prompt: (c, r) => {
      const m = c.facts.milestone!;
      return r.pick([
        `${nm(c, m.p)} is set for his ${m.n}th career match. What does he bring to this group?`,
        `A milestone tomorrow — match number ${m.n} for ${nm(c, m.p)}. Any words for him?`,
      ]);
    },
    answers: (c) => [
      `${nm(c, c.facts.milestone!.p)} is a model professional. Congratulations to him.`,
      'He leads by example every single day.',
      "It's a great number. We'll celebrate it after the match.",
      'A nice milestone. Tomorrow he plays like it is his first.',
      'Milestones are for afterwards. I want three points.',
      'I want him hungry, not nostalgic.',
    ],
  },
  {
    id: 'pre-contract', kind: 'pre', needs: [], weight: 2,
    when: (c) => c.facts.expiring >= 0,
    about: (c) => c.facts.expiring,
    prompt: (c, r) => r.pick([
      `${nm(c, c.facts.expiring)}'s contract runs out this summer. Will he stay?`,
      `Is there any news on ${nm(c, c.facts.expiring)}'s contract?`,
    ]),
    answers: (c) => [
      `${nm(c, c.facts.expiring)} is very important to us. We want him here for a long time.`,
      "He's happy here. I'm confident we'll sort it out.",
      "That's between the club and his agent.",
      "He's focused on the volleyball. So am I.",
      'Nobody is bigger than the club. Not even him.',
      'If he wants to win trophies, this is the place. He knows it.',
    ],
  },
  {
    id: 'pre-hot', kind: 'pre', needs: [], weight: 3,
    when: (c) => c.facts.hot >= 0,
    about: (c) => c.facts.hot,
    prompt: (c, r) => r.pick([
      `${nm(c, c.facts.hot)} is in the form of his life. What's changed?`,
      `Everything ${nm(c, c.facts.hot)} touches turns to points right now. How do you keep him there?`,
    ]),
    answers: (c) => [
      `${nm(c, c.facts.hot)} has worked incredibly hard. He deserves this.`,
      "He's confident, and a confident player is dangerous.",
      'Form comes and goes. We help him keep his routines.',
      "He's doing what we ask. Nothing more, nothing less.",
      'Good form is the minimum at this club.',
      "He's only scratching the surface. There's more.",
    ],
  },
  {
    id: 'pre-last', kind: 'pre', needs: [], weight: 3,
    when: (c) => c.facts.last !== null,
    about: (c) => (c.facts.last!.top !== null && c.facts.last!.won ? c.facts.last!.top.p : -1),
    prompt: (c, r) => {
      const l = c.facts.last!;
      return l.won
        ? r.pick([
          `After the ${l.score} win over ${l.opp}, what's the mood in the camp?`,
          `${l.top !== null ? `${nm(c, l.top.p)} scored ${l.top.pts} against ${l.opp}. ` : ''}Can you carry that into this one?`,
        ])
        : r.pick([
          `How have the players responded to the ${l.score} defeat to ${l.opp}?`,
          `The ${l.score} loss to ${l.opp} — is it out of their heads?`,
        ]);
    },
    answers: (c) => (c.facts.last!.won ? [
      'The mood is great. The players earned it.',
      'Confidence is high, and rightly so.',
      'We enjoyed it for a night, then moved on.',
      'That match is finished. This one is all that counts.',
      "Good mood, but nobody's relaxing. Not on my watch.",
      'We want another one. And another.',
    ] : [
      'They responded brilliantly in training. I am proud of them.',
      'The group is together. That is what matters.',
      'We analysed it, learned from it, and moved on.',
      'Defeats happen. The reaction is what counts.',
      'They know that performance was not acceptable.',
      "I expect an answer tomorrow. They know it.",
    ]) as Six,
  },
  {
    id: 'pre-callback', kind: 'pre', needs: [], weight: 6,
    when: (c) => c.facts.callback !== null && c.facts.callback.kind === 'post',
    prompt: (c, r) => {
      const q = c.facts.callback!.text;
      return r.pick([
        `After your last match you said: "${q}" How did the players take it?`,
        `"${q}" — those were your words last time. Have you seen a reaction in training?`,
      ]);
    },
    answers: () => [
      'They took it well. They are a mature group.',
      'We spoke afterwards. Everyone is on the same page.',
      'I say things as I see them. They know that.',
      'That was then. This is a new match.',
      'They had to hear it. And they responded.',
      "I'd say it again. The standards don't change.",
    ],
  },
  {
    id: 'pre-tactics', kind: 'pre', needs: [], weight: 1,
    prompt: (c, r) => r.pick([
      `How do you plan to deal with ${c.opp.name}'s serve?`,
      `Will we see any changes to your six against ${c.opp.name}?`,
      `Where do you think this match will be won — at the net, or from the service line?`,
      `What's the key to breaking down ${c.opp.name}'s defence?`,
    ]),
    answers: () => [
      'We trust our system and our players. That is the key.',
      'The players know the plan inside out.',
      "I'd rather not give too much away before the match.",
      'Details. It always comes down to details.',
      "We'll impose our game. They'll have to adapt to us.",
      "Whatever they do, we have an answer.",
    ],
  },
];

// ---- Follow-ups --------------------------------------------------------------------------

/** A question to put straight after an answer — or null if the room lets it go. */
export function followUp(rng: Rng, c: { opp: string; won: boolean; score: string; kind: InterviewKind; big: boolean },
  asked: InterviewQuestion, tone: AnswerCategory, text: string): { prompt: string; answers: Six; topic: string } | null {
  if (asked.topic?.startsWith('follow') === true) return null;
  if (tone === 'convince' && rng.chance(c.big ? 0.55 : 0.35)) {
    if (c.kind === 'pre') {
      return {
        topic: 'follow-bold',
        prompt: rng.pick([
          `Bold words. And if it goes wrong tomorrow?`,
          `"${text}" Isn't that a little disrespectful to ${c.opp}?`,
          `Will you take responsibility if that doesn't happen?`,
          `${c.opp} will read that tomorrow morning. Are you giving them extra motivation?`,
        ]),
        answers: [
          `I respect ${c.opp} completely. I was talking about belief, not arrogance.`,
          'I said it to show faith in my players. Nothing more.',
          "I answer for what I say. That's part of the job.",
          "If it goes wrong, we analyse it. Like always.",
          "I don't say things I don't mean. I'll stand by it.",
          "Let them read it. It won't change a thing.",
        ],
      };
    }
    return {
      topic: 'follow-blame',
      prompt: c.won
        ? rng.pick(['Strong words after a win. Is something wrong in the dressing room?', 'Even after a victory you are demanding more. Are the players feeling the pressure?'])
        : rng.pick(['Are you saying the players let you down?', 'Do you think some of them should be worried about their places?', 'Is that criticism aimed at anyone in particular?']),
      answers: [
        'No. We win and lose together, always.',
        'I believe in every one of them. That is why I demand so much.',
        'I speak to the players first, not through the press.',
        "It's about standards, not individuals.",
        'Everyone has to look at themselves. Me included.',
        'Nobody has a guaranteed place. Nobody.',
      ],
    };
  }
  if (tone === 'neutral' && c.big && rng.chance(0.25)) {
    return {
      topic: 'follow-dodge',
      prompt: rng.pick([
        "With respect, coach, you didn't really answer the question.",
        "Can I push you on that? That sounded like a no-comment.",
        "Is that all you're going to give us?",
      ]),
      answers: [
        "Fair enough. Honestly — I believe in this group, and I'll leave it there.",
        "I understand. What I'll say is: we are ready.",
        'I answered it the way I wanted to.',
        "Some things stay inside the dressing room.",
        "You'll get your answer on the court.",
        "I'm not here to write your headline.",
      ],
    };
  }
  if (tone === 'positive' && c.kind === 'post' && !c.won && c.score.endsWith('3') && c.score.startsWith('0') && rng.chance(0.4)) {
    return {
      topic: 'follow-soft',
      prompt: rng.pick([`Isn't that a little generous after a ${c.score} defeat?`, `A ${c.score} defeat and you're this positive. Do the fans see it the same way?`]),
      answers: [
        'Criticism helps no one tonight. Support does.',
        "The fans saw a team that fought. I'm sure of it.",
        'I see the effort and the result. Both matter.',
        'There is plenty to work on. We know.',
        'You are right. It was not good enough, and I will tell them.',
        'The fans deserve better than that. They will get it.',
      ],
    };
  }
  return null;
}

// ---- How they take it --------------------------------------------------------------------

/** A line for the room's reaction to an answer: the journalist by name, never a pronoun. */
export function reactionLine(rng: Rng, name: string, voice: Voice | undefined, bl: BodyLanguage, tone: AnswerCategory, big: boolean): string {
  const first = name.split(' ')[0];
  if (tone === 'convince' && big && rng.chance(0.5)) {
    return rng.pick(['Cameras flash. That one will be on the back pages.', 'A ripple through the room — phones come out to tweet it.', 'You can hear the pens scratching. That is tomorrow’s headline.']);
  }
  const byMood: Readonly<Record<BodyLanguage, readonly string[]>> = {
    delighted: [`${first} is beaming. Exactly the quote they wanted.`, `${first} underlines something twice.`],
    encouraged: [`${first} nods and writes quickly.`, `${first} smiles — that line will lead the piece.`, `"Thank you, coach." ${first} looks pleased.`],
    pleased: [`${first} seems satisfied with that.`, `A small nod from ${first}.`, `${first} jots a note and moves on.`],
    neutral: [`${first} writes it down without a word.`, `${first} waits a moment, then nods.`],
    skeptical: [`${first} raises an eyebrow.`, `${first} isn't convinced: "We'll see."`, `${first} exchanges a look with a colleague.`, `${first} taps the pen against the notebook.`],
    hostile: [`${first} shakes their head.`, `"That's not an answer," mutters ${first}.`],
  };
  const voiceLine: Partial<Record<Voice, Partial<Record<BodyLanguage, string>>>> = {
    stats: { skeptical: `${first} glances at the numbers on the sheet and frowns.`, encouraged: `${first} ticks something off a page of figures.` },
    tabloid: { encouraged: `${first} grins. Headline secured.`, skeptical: `${first} looks disappointed — no drama there.` },
    tactical: { skeptical: `${first} clearly wanted more detail.`, encouraged: `${first} nods along — that's the detail they were after.` },
    local: { encouraged: `${first} looks pleased: the fans will like that.` },
  };
  const special = voice !== undefined ? voiceLine[voice]?.[bl] : undefined;
  if (special !== undefined && rng.chance(0.5)) return special;
  return rng.pick(byMood[bl]);
}

/** The headline the papers make of a conference: its boldest line, or its warmest. */
export function headlineOf(club: string, answers: ReadonlyArray<{ tone: AnswerCategory; text: string }>): string {
  const bold = answers.find((a) => a.tone === 'convince');
  const pick = bold ?? answers.find((a) => a.tone === 'positive') ?? answers[0];
  if (pick === undefined) return '';
  const clipped = pick.text.length > 70 ? `${pick.text.slice(0, 67).replace(/\s+\S*$/, '')}…` : pick.text;
  return `${club} coach: "${clipped}"`;
}

// ---- Memory ------------------------------------------------------------------------------

const ASKED_KEPT = 40;
const QUOTES_KEPT = 16;

export function pressMemory(world: World): PressMemory {
  world.press ??= { asked: [], quotes: [] };
  return world.press;
}

/** How fresh a topic is: asked in the last few conferences, it comes up rarely. */
export function freshness(memory: PressMemory | undefined, topic: string | undefined): number {
  if (memory === undefined || topic === undefined) return 1;
  const at = memory.asked.lastIndexOf(topic);
  if (at < 0) return 1;
  const ago = memory.asked.length - at;
  return ago <= 6 ? 0.08 : ago <= 15 ? 0.35 : 0.7;
}

export function noteAsked(world: World, topics: readonly string[]): void {
  const m = pressMemory(world);
  m.asked.push(...topics);
  if (m.asked.length > ASKED_KEPT) m.asked.splice(0, m.asked.length - ASKED_KEPT);
}

export function noteQuote(world: World, q: PressQuote): void {
  const m = pressMemory(world);
  m.quotes.push(q);
  if (m.quotes.length > QUOTES_KEPT) m.quotes.splice(0, m.quotes.length - QUOTES_KEPT);
}

/** The writer's own dice for a conference: the same conference reads the same, without touching the world's. */
export function pressRng(world: World, salt: number): Rng {
  return new Rng(`press:${world.season}:${world.day}:${salt}:${world.nextInterviewId}`);
}

// ---- Relationships -----------------------------------------------------------------------
//
// Every journalist keeps a relationship with the manager over a career. Answers that land with
// them warm it; answers that grate cool it; standing them up — declining a conference they came
// to — costs a little with all of them. An ally comes into the room already warm and takes an
// answer a shade better than it was; someone who has turned hostile comes in wary and takes it a
// shade worse. Summers soften both.

/** What an answer's reception does to the relationship. */
const WARMTH: Readonly<Record<BodyLanguage, number>> = {
  delighted: 8, encouraged: 6, pleased: 3, neutral: 0, skeptical: -5, hostile: -8,
};
const MOODS: readonly BodyLanguage[] = ['hostile', 'skeptical', 'neutral', 'pleased', 'encouraged', 'delighted'];
/** Where a relationship starts to colour how they take things, either way. */
const COLOURS = 40;

export function relationOf(world: World, name: string): number {
  return world.press?.relations?.[name] ?? 0;
}

export function relationLabel(r: number): string {
  return r >= 60 ? 'Ally' : r >= 25 ? 'Friendly' : r > -25 ? 'Neutral' : r > -60 ? 'Wary' : 'Hostile';
}

/** How they come into the room: warm if they like him, wary if they don't. */
export function moodOnArrival(r: number): BodyLanguage {
  return r >= COLOURS ? 'pleased' : r <= -COLOURS ? 'skeptical' : 'neutral';
}

/** How an answer lands with them, given how they feel about him: a step warmer or colder. */
export function colouredBy(r: number, bl: BodyLanguage): BodyLanguage {
  const shift = r >= COLOURS ? 1 : r <= -COLOURS ? -1 : 0;
  return MOODS[Math.max(0, Math.min(MOODS.length - 1, MOODS.indexOf(bl) + shift))];
}

/** The relationship after an answer landed as `bl`; returns the change. */
export function warmTo(world: World, name: string, bl: BodyLanguage): number {
  const m = pressMemory(world);
  const rel = (m.relations ??= {});
  const was = rel[name] ?? 0;
  rel[name] = Math.max(-100, Math.min(100, was + WARMTH[bl]));
  return rel[name] - was;
}

/** Stood up: a conference declined costs a little with everyone who came. */
export function stoodUp(world: World, names: readonly string[]): void {
  const m = pressMemory(world);
  const rel = (m.relations ??= {});
  for (const n of names) rel[n] = Math.max(-100, (rel[n] ?? 0) - 3);
}

/** The summer: every relationship drifts back towards nothing much. */
export function summerPress(world: World): void {
  const rel = world.press?.relations;
  if (rel === undefined) return;
  for (const n of Object.keys(rel)) rel[n] = Math.round(rel[n] * 0.7);
}
