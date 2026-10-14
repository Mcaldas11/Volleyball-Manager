/**
 * Press conferences, before a match and after it.
 *
 * The day before a fixture the press want time with the manager, and after
 * it his reaction. What they ask turns on the occasion. A final or a title
 * decider fills the room and runs long; a routine league night gets a few
 * regulars and three questions. And it turns on the story around the match:
 * a run of wins or defeats, a derby, the drop, the leaders, the opponent's
 * star, an injury, a board losing patience — and afterwards the result and
 * how it came: a comeback, a whitewash, an upset, a trophy, the player of
 * the match.
 *
 * Each journalist asks one question and has their own idea of what a good
 * answer sounds like. The tone chosen is a small, real lever rather than
 * flavour text: it nudges morale — before a match on both sides, after it in
 * the dressing room, and for a player singled out by name — and how well it
 * lands with that journalist changes their body language. The bigger the
 * occasion, the more an answer weighs. Morale feeds straight into match
 * ratings (see match/ratings.ts), so this sits in the same currency as a
 * training session or a team talk. Declining is always safe — no risk, but
 * no reward either.
 */

import type { Rng } from '../core/rng.ts';
import { compareTableRows, type Club } from '../model/club.ts';
import { NO_CLUB } from '../model/players.ts';
import { isCupCompetition, isCupFinal, stageLabel } from '../season/cups.ts';
import { playoffTieOf, tieHasFixture } from '../season/playoffs.ts';
import { PLAYOFF_ROUND_BASE } from '../season/schedule.ts';
import { cityBankFor } from './cities.ts';
import { nationName, squadOf, userNation, type IntlMatch, type Tournament } from './internationals.ts';
import { NATIONS } from './nations.ts';
import { dayOfSeason, type Competition, type Fixture, type World } from './world.ts';

export type AnswerCategory = 'positive' | 'neutral' | 'convince';
export type BodyLanguage = 'hostile' | 'skeptical' | 'neutral' | 'pleased' | 'encouraged' | 'delighted';
/** Before the match, or after it. */
export type InterviewKind = 'pre' | 'post';
/** How much the occasion matters — and so how many come, how long it runs, and how much an answer weighs. */
export type Stakes = 'routine' | 'big' | 'huge';

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
  /** A player the answer is about, and what it does for him on top. */
  playerIdx?: number;
  playerMorale?: number;
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
  id: number;
  kind: InterviewKind;
  fixtureId: number;
  questions: InterviewQuestion[];
  /** Index of the question currently on the floor. */
  currentIndex: number;
  /** True once every question has been answered — awaiting `closeInterview`. */
  finished: boolean;
  /** The occasion as the press see it: "Cup final", "Kraków derby", "League match". */
  occasion: string;
  stakes: Stakes;
  /** Journalists in the room. */
  crowd: number;
  /** After a match: the last day the press still want it. */
  expiresDay?: number;
  /** A national team's match: its tournament, the match, and the manager's nation.
   *  `fixtureId` is then -1 - the match's id, as the matchday screens have it. */
  national?: { tournamentId: number; matchId: number; nation: number };
}

export interface AnswerResult {
  option: InterviewOption;
  bodyLanguage: BodyLanguage;
  finished: boolean;
}

// ---- The press ----------------------------------------------------------------------

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
  { name: 'Sofia Lindqvist', outlet: 'Block & Dig', bias: 'positive', gender: 'women', photoId: 38 },
  { name: 'Jonas Weber', outlet: 'Volley Insider', bias: 'neutral', gender: 'men', photoId: 17 },
  { name: 'Elena Morozova', outlet: 'Sideout Magazine', bias: 'convince', gender: 'women', photoId: 71 },
  { name: 'Paulo Teixeira', outlet: 'Net Zone Radio', bias: 'positive', gender: 'men', photoId: 45 },
];

/** How many ask, and how many come, by the size of the occasion. */
const ROOM: Readonly<Record<Stakes, { questions: [number, number]; crowd: [number, number]; weight: number }>> = {
  routine: { questions: [3, 3], crowd: [4, 9], weight: 1 },
  big: { questions: [4, 5], crowd: [12, 24], weight: 1.25 },
  huge: { questions: [6, 6], crowd: [30, 55], weight: 1.5 },
};

/** Reputation gap that makes one side a clear favourite. */
const FAVOURITE_GAP = 1200;

// ---- The occasion -------------------------------------------------------------------

type Tag =
  // The match itself.
  | 'final' | 'titleDecider' | 'semi' | 'knockout' | 'relegation' | 'relegationPlayoff' | 'topClash' | 'leaders'
  | 'derby' | 'continental' | 'clubworld' | 'supercup' | 'cupEarly' | 'favourite' | 'underdog' | 'opener' | 'newBoss'
  | 'home' | 'away'
  // The story around it.
  | 'winningRun' | 'losingRun' | 'oppForm' | 'pressure' | 'injuredStar' | 'oppStar' | 'ownStar'
  // How it went.
  | 'won' | 'lost' | 'trophy' | 'finalLost' | 'eliminated' | 'whitewash' | 'comeback' | 'collapse' | 'tiebreak'
  | 'upset' | 'shock' | 'top' | 'ownMvp' | 'oppMvp'
  // A national team's match: the hosts, a tournament's first match, the bronze.
  | 'national' | 'hosts' | 'tournamentOpener' | 'bronze';

/** One side of a conference's match, as the questions name it: a club, or a nation. */
interface Side {
  id: number;
  name: string;
  arenaName: string;
}

/** What a press conference knows about a match. */
interface Ctx {
  world: World;
  club: Side;
  opp: Side;
  comp: Competition | undefined;
  compName: string;
  tags: Set<Tag>;
  /** Consecutive results, the latest last: positive a run of wins, negative of defeats. */
  run: number;
  oppRun: number;
  ownPos: number;
  oppPos: number;
  city: string;
  injured: number;
  oppStar: number;
  ownStar: number;
  mvp: number;
  /** From the manager's side: "3-1". */
  score: string;
}

function name(c: Ctx, p: number): string {
  return c.world.players.shortName(p);
}

/** Said one way of a club, another of a nation. */
function nat(c: Ctx, club: string, nation: string): string {
  return c.tags.has('national') ? nation : club;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/** A club's place in its league table, from 1 — 0 before it has played. */
function leaguePosition(comp: Competition | undefined, clubId: number): number {
  if (comp === undefined || comp.kind !== 'league') return 0;
  const table = [...comp.table].sort(compareTableRows);
  const i = table.findIndex((r) => r.clubId === clubId);
  return i < 0 || table[i].played === 0 ? 0 : i + 1;
}

/** The city in a club's name, if it has one. */
function cityOf(club: Club): string {
  const def = NATIONS[club.nation];
  if (def === undefined) return '';
  for (const city of cityBankFor(def.cityGroup ?? def.nameGroup).cities) if (club.name.includes(city)) return city;
  return '';
}

/** A club's results in competitive matches up to `day`, the latest first. */
function results(world: World, clubId: number, day: number): boolean[] {
  const out: Array<[number, boolean]> = [];
  for (const f of world.fixtures) {
    if (!f.played || f.day > day || (f.home !== clubId && f.away !== clubId)) continue;
    const kind = world.competitions[f.competitionId]?.kind;
    if (kind === 'friendly' || kind === 'international') continue;
    out.push([f.day, (f.home === clubId) === (f.homeSets > f.awaySets)]);
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, won]) => won);
}

/** The run a list of results ends on: +3 for three wins, -2 for two defeats. */
function runOf(list: readonly boolean[]): number {
  if (list.length === 0) return 0;
  let n = 0;
  while (n < list.length && list[n] === list[0]) n++;
  return list[0] ? n : -n;
}

/** The best player fit to play, and one of the best three who isn't. */
function stars(world: World, club: { players: readonly number[] }): { star: number; injured: number } {
  const store = world.players;
  const best = [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 3);
  return {
    star: best.find((p) => store.injuryDaysLeft[p] === 0) ?? -1,
    injured: best.find((p) => store.injuryDaysLeft[p] > 0) ?? -1,
  };
}

/** Unplayed league fixtures left for a club. */
function leagueLeft(world: World, comp: Competition, clubId: number): number {
  let n = 0;
  for (const id of comp.fixtureIds) {
    const f = world.fixtures[id];
    if (!f.played && f.round < PLAYOFF_ROUND_BASE && (f.home === clubId || f.away === clubId)) n++;
  }
  return n;
}

/** The match as the press see it: what it is, what turns on it, and how big it is. */
function contextFor(world: World, f: Fixture, kind: InterviewKind): { ctx: Ctx; stakes: Stakes; occasion: string } | null {
  const clubId = world.userClubId;
  const club = world.clubs[clubId];
  const isHome = f.home === clubId;
  const opp = world.clubs[isHome ? f.away : f.home];
  if (club === undefined || opp === undefined) return null;
  const comp = world.competitions[f.competitionId];
  const tags = new Set<Tag>([isHome && !f.neutralVenue ? 'home' : 'away']);
  const stage = stageLabel(world, f);
  const compName = comp?.name ?? 'the match';
  const occasions: string[] = [];

  // What kind of match.
  if (comp !== undefined && comp.kind === 'league' && f.round >= PLAYOFF_ROUND_BASE) {
    const at = playoffTieOf(comp, f.id);
    const group = at?.group;
    const round = group?.rounds.find((r) => r.some((t) => tieHasFixture(t, f.id)));
    if (at?.stage === 'thirdPlace') {
      tags.add('knockout');
      occasions.push('Third-place match');
    } else if (group?.id === 'championship') {
      if (round?.length === 1) {
        tags.add('final').add('titleDecider');
        occasions.push('Championship final');
      } else if (round?.length === 2) {
        tags.add('semi');
        occasions.push('Playoff semi-final');
      } else {
        tags.add('knockout');
        occasions.push('Playoff quarter-final');
      }
    } else if (group?.id === 'relegation') {
      tags.add('relegation').add('relegationPlayoff');
      occasions.push('Relegation playoff');
    } else occasions.push('Placement playoff');
    // The third game of a series settles it.
    if (at?.game === 3) occasions[occasions.length - 1] += ' — game three, the decider';
  } else if (comp !== undefined && isCupCompetition(comp)) {
    if (comp.kind === 'continental') tags.add('continental');
    if (comp.kind === 'clubworld') tags.add('clubworld');
    if (comp.kind === 'supercup') tags.add('supercup');
    if (isCupFinal(world, f) || comp.kind === 'supercup') {
      tags.add('final');
      occasions.push(`${compName} final`);
    } else if (stage === 'Semi-final') {
      tags.add('semi');
      occasions.push(`${compName} semi-final`);
    } else if (f.round >= PLAYOFF_ROUND_BASE) {
      tags.add('knockout');
      occasions.push(`${compName} ${stage.toLowerCase()}`);
    } else if (comp.kind === 'cup') tags.add('cupEarly');
  }

  // Where the two stand.
  const league = world.competitions[club.leagueId];
  const ownPos = leaguePosition(league, club.id);
  const oppPos = opp.leagueId === club.leagueId ? leaguePosition(league, opp.id) : 0;
  const regular = comp !== undefined && comp.kind === 'league' && f.round < PLAYOFF_ROUND_BASE;
  if (regular && league !== undefined && ownPos > 0) {
    const table = [...league.table].sort(compareTableRows);
    const half = (league.participants.length - 1);
    const played = table.find((r) => r.clubId === club.id)?.played ?? 0;
    // A win settles it: no one can catch them any more.
    if (kind === 'pre' && ownPos === 1 && !league.hasPlayoffs && table[1] !== undefined) {
      const own = table[0].points + 3;
      const chaser = table[1].points + 3 * leagueLeft(world, league, table[1].clubId);
      if (own > chaser && played >= half) {
        tags.add('titleDecider');
        occasions.push('Title decider');
      }
    }
    if (ownPos <= 3 && oppPos > 0 && oppPos <= 3 && played >= 3) {
      tags.add('topClash');
      occasions.push('Top-of-the-table clash');
    } else if (oppPos === 1 && played >= 3) {
      tags.add('leaders');
      occasions.push('Against the leaders');
    }
    const drop = Math.max(1, league.relegationSlots);
    if (league.relegationSlots > 0 && ownPos > league.participants.length - drop - 1 && played >= half / 2) {
      tags.add('relegation');
      occasions.push('Relegation battle');
    }
  }
  const city = cityOf(club);
  if (city !== '' && opp.nation === club.nation && cityOf(opp) === city) {
    tags.add('derby');
    occasions.push(`${city} derby`);
  }
  if (tags.has('clubworld') && occasions.length === 0) occasions.push('Club World Championship');
  if (tags.has('continental') && occasions.length === 0) occasions.push(compName);

  // Who is expected to win.
  if (club.reputation - opp.reputation > FAVOURITE_GAP) tags.add('favourite');
  if (opp.reputation - club.reputation > FAVOURITE_GAP) tags.add('underdog');

  // The story so far.
  const before = kind === 'pre' ? f.day : f.day - 1;
  const past = results(world, club.id, before);
  const seasonStart = world.day - dayOfSeason(world);
  if (kind === 'pre') {
    const thisSeason = world.fixtures.some((x) => x.played && x.day >= seasonStart &&
      (x.home === club.id || x.away === club.id) && world.competitions[x.competitionId]?.kind !== 'friendly');
    if (!thisSeason && occasions.length === 0) {
      tags.add('opener');
      occasions.push('Season opener');
    }
    const sinceAppointed = world.fixtures.some((x) => x.played && x.day >= club.coachSince &&
      (x.home === club.id || x.away === club.id) && world.competitions[x.competitionId]?.kind !== 'friendly');
    if (!sinceAppointed) tags.add('newBoss');
  }
  const after = kind === 'post' ? [(f.home === club.id) === (f.homeSets > f.awaySets), ...past] : past;
  const run = runOf(after);
  const oppRun = runOf(results(world, opp.id, before));
  if (run >= 3) tags.add('winningRun');
  if (run <= -3) tags.add('losingRun');
  if (oppRun >= 3) tags.add('oppForm');
  if (club.boardConfidence < 35) tags.add('pressure');
  const own = stars(world, club);
  const theirs = stars(world, opp);
  if (own.injured >= 0) tags.add('injuredStar');
  if (theirs.star >= 0) tags.add('oppStar');
  if (own.star >= 0) tags.add('ownStar');

  // How it went.
  let score = '';
  if (kind === 'post') {
    const ownSets = isHome ? f.homeSets : f.awaySets;
    const oppSets = isHome ? f.awaySets : f.homeSets;
    const won = ownSets > oppSets;
    score = `${ownSets}-${oppSets}`;
    tags.add(won ? 'won' : 'lost');
    if (Math.min(ownSets, oppSets) === 0) tags.add('whitewash');
    if (ownSets + oppSets === 5) tags.add('tiebreak');
    const firstTwo = f.setScores.slice(0, 2).map(([h, a]) => (isHome ? h > a : a > h));
    if (firstTwo.length === 2 && firstTwo[0] === firstTwo[1] && firstTwo[0] !== won) tags.add(won ? 'comeback' : 'collapse');
    if (tags.has('final')) tags.add(won ? 'trophy' : 'finalLost');
    else if ((tags.has('semi') || tags.has('knockout')) && !won) tags.add('eliminated');
    if (won && tags.has('underdog')) tags.add('upset');
    if (!won && tags.has('favourite')) tags.add('shock');
    const games = league?.table.find((r) => r.clubId === club.id)?.played ?? 0;
    if (won && regular && games >= 3 && leaguePosition(league, club.id) === 1) tags.add('top');
    if (f.mvp >= 0) tags.add(world.players.clubId[f.mvp] === club.id ? 'ownMvp' : 'oppMvp');
  }

  const stakes: Stakes = tags.has('final') || tags.has('titleDecider')
    ? 'huge'
    : tags.has('semi') || tags.has('knockout') || tags.has('relegationPlayoff') || tags.has('topClash') ||
      tags.has('derby') || tags.has('relegation') || tags.has('leaders') || tags.has('clubworld') || tags.has('continental')
      ? 'big'
      : 'routine';
  const occasion = occasions[0] ??
    (comp === undefined ? 'Match' : comp.kind === 'league' ? 'League match' : `${compName} · ${stage}`);
  return {
    ctx: {
      world, club, opp, comp, compName, tags, run, oppRun, ownPos, oppPos, city,
      injured: own.injured, oppStar: theirs.star, ownStar: own.star, mvp: f.mvp, score,
    },
    stakes,
    occasion,
  };
}

// ---- The questions ------------------------------------------------------------------

type Six = readonly [string, string, string, string, string, string];

interface Archetype {
  kind: InterviewKind;
  /** The tags it needs, all of them. */
  needs: readonly Tag[];
  /** How likely it comes up when it can: the occasion's own questions first. */
  weight: number;
  prompt: (c: Ctx) => string;
  /** Two answers of each tone: positive, neutral, convince. */
  answers: (c: Ctx) => Six;
  /** The player the question is about, whose morale the answer touches too. */
  about?: (c: Ctx) => number;
}

const facing = (c: Ctx): string => (c.tags.has('home') || c.tags.has('hosts') ? `hosting ${c.opp.name}`
  : c.tags.has('national') ? `the match against ${c.opp.name}` : `the trip to ${c.opp.name}`);

const PRE: readonly Archetype[] = [
  // Every match.
  {
    kind: 'pre', needs: [], weight: 1,
    prompt: (c) => `How confident are you heading into ${facing(c)}?`,
    answers: (c) => [
      "We respect the opponent and we're focused on our own performance.",
      "It's not about confidence, it's about preparation, and we've prepared well.",
      'We like our chances, but nothing is decided on paper.',
      nat(c, 'Every match in this league is difficult, and this one will be no different.', 'Every match at this level is difficult, and this one will be no different.'),
      'Frankly, I expect us to win this one comfortably.',
      "We're the better team, and I want the players to believe that too.",
    ],
  },
  {
    kind: 'pre', needs: [], weight: 1,
    prompt: (c) => `What's your message to the squad before facing ${c.opp.name}?`,
    answers: () => [
      'Simple: play our game, trust the process.',
      'Stay calm, stick to the plan, and the result will follow.',
      'Focus on the process, not the opponent.',
      'One point at a time, like always.',
      'Go out and take it — nobody hands you these matches.',
      "I've told them to be ruthless from the first serve.",
    ],
  },
  {
    kind: 'pre', needs: [], weight: 1,
    prompt: (c) => `Any concerns going into the match against ${c.opp.name}?`,
    answers: (c) => [
      'A few fitness niggles, nothing that worries me.',
      'Just the usual — travel, recovery, small things.',
      'No more than any other week.',
      nat(c, "It's a long season, there's always something to manage.", "A tournament is short — there's always something to manage."),
      'None at all — we are ready.',
      'The only concern is whether they can handle us.',
    ],
  },
  {
    kind: 'pre', needs: [], weight: 1,
    prompt: (c) => `How do you rate ${c.opp.name}'s chances against you?`,
    answers: () => [
      'Any team can beat any team on the day. We respect that.',
      "They'll fancy their chances, as they should.",
      "That's for them to answer, not me.",
      "We'll find out on the court.",
      "Slim, if I'm honest.",
      "I don't think they'll like what we bring.",
    ],
  },
  {
    kind: 'pre', needs: ['home'], weight: 1,
    prompt: (c) => `What will the crowd at the ${c.club.arenaName} bring tomorrow?`,
    answers: () => [
      'Our fans have been incredible all season — they lift us every time.',
      'Playing at home is special. We want to give them something back.',
      'It helps, but the crowd does not win you sets.',
      'Home or away, the court is the same size.',
      'With that crowd behind us, nobody leaves our arena with points.',
      'They will make it a very long night for the visitors.',
    ],
  },
  {
    kind: 'pre', needs: ['away'], weight: 1,
    prompt: (c) => `${c.opp.name} are hard to beat at home. How do you approach the trip?`,
    answers: () => [
      "It's a tough place to go, and we know it. We'll be ready.",
      'Their fans make it difficult — that is part of the challenge.',
      'We treat it like any other match.',
      'An away match is just a match with a longer bus ride.',
      'We go there to win, not to survive.',
      'Hard to beat at home? We will see about that.',
    ],
  },
  {
    kind: 'pre', needs: ['oppStar'], weight: 2,
    prompt: (c) => `${c.opp.name} will be relying on ${name(c, c.oppStar)}. How do you stop him?`,
    answers: () => [
      "He's a top player — we've studied him closely.",
      "We have a plan for him, but they're more than one player.",
      "We'll focus on our own side of the net.",
      'Every player can be stopped on the day.',
      "He hasn't faced a block like ours.",
      "Let him try. We'll be ready for him.",
    ],
  },
  {
    kind: 'pre', needs: ['ownStar'], weight: 1,
    prompt: (c) => `How important is ${name(c, c.ownStar)} to your chances?`,
    about: (c) => c.ownStar,
    answers: (c) => [
      `${name(c, c.ownStar)} has been brilliant, but this is a team.`,
      "He's a big part of what we do, and he knows how much we trust him.",
      "He's doing his job, like everyone else.",
      "One player doesn't win a match — six do.",
      nat(c, `He's the best in the league in his position, simple as that.`, `He's among the best in the world in his position, simple as that.`),
      'If they want to stop us, they have to stop him first. Good luck.',
    ],
  },
  // The story around it.
  {
    kind: 'pre', needs: ['winningRun'], weight: 3,
    prompt: (c) => `That's ${c.run} wins in a row. Can anyone stop you?`,
    answers: () => [
      "The players deserve every bit of it. We'll keep our feet on the ground.",
      "It's a good run, but the next match is all that counts.",
      'Runs come to an end. Our job is to make this one last.',
      "We don't look at the streak. We look at the next opponent.",
      "On this form? I don't see who.",
      'We are only getting started.',
    ],
  },
  {
    kind: 'pre', needs: ['losingRun'], weight: 3,
    prompt: (c) => `${-c.run} defeats in a row. Is this a crisis?`,
    answers: () => [
      'The players are working hard. The results will come.',
      'I believe in this group. One win changes everything.',
      "It's a difficult moment. We have to face it honestly.",
      'Crisis is a big word. We need a result, that is all.',
      "Tomorrow it ends. I've told the players exactly that.",
      'Anyone who writes us off is going to look foolish.',
    ],
  },
  {
    kind: 'pre', needs: ['oppForm'], weight: 2,
    prompt: (c) => `${c.opp.name} have won ${c.oppRun} in a row. Are they the team to beat right now?`,
    answers: () => [
      "They've earned that form — credit to them.",
      "We're watching the same tape everyone else is. They're a good side.",
      "Form is temporary. It's the head-to-head that decides these things.",
      "We'll worry about our own game, not theirs.",
      "Good form or not, we're not afraid of anyone.",
      "Let's see how their form holds up against us.",
    ],
  },
  {
    kind: 'pre', needs: ['pressure'], weight: 3,
    prompt: () => "There's talk the board are losing patience. Is your job under threat?",
    answers: () => [
      'I have a good relationship with the board. We all want the same thing.',
      "I understand the expectations — that's the job.",
      "That's a question for the board, not me.",
      'I only think about the next match.',
      'Results will answer that question, starting tomorrow.',
      "I'm not going anywhere. Write that down.",
    ],
  },
  {
    kind: 'pre', needs: ['injuredStar'], weight: 2,
    prompt: (c) => `How big a loss is ${name(c, c.injured)} for this one?`,
    answers: (c) => [
      `We miss ${name(c, c.injured)}, of course, and we wish him a quick recovery.`,
      "It's a chance for someone else to show what they can do.",
      "Injuries happen. We plan for them.",
      'The squad is bigger than one player.',
      "We'll win it without him. The squad is strong enough.",
      "Whoever comes in will be ready. I'm not worried at all.",
    ],
  },
  {
    kind: 'pre', needs: ['newBoss'], weight: 4,
    prompt: () => 'Your first competitive match in charge. What changes will we see?',
    answers: () => [
      'The players have been fantastic with me. I just want them to enjoy it.',
      "It's an honour. We'll build this step by step.",
      "You'll see it on the court — I'd rather not give much away.",
      "It takes time to put your stamp on a team. We're working on it.",
      'A team that plays to win, from the first serve.',
      'Expect a side that is hard to beat from tomorrow.',
    ],
  },
  {
    kind: 'pre', needs: ['opener'], weight: 4,
    prompt: () => 'The season starts tomorrow. What are your targets?',
    answers: () => [
      'To improve every week and give the fans something to cheer.',
      'The pre-season went well. We feel ready.',
      'One match at a time. Targets are for the end of the season.',
      'We know what the board expects. We will judge ourselves in May.',
      'To win the league. Nothing less.',
      'This squad can win trophies. That is the target.',
    ],
  },
  {
    kind: 'pre', needs: ['favourite'], weight: 2,
    prompt: (c) => `Everyone expects you to beat ${c.opp.name} comfortably. Is there a danger of complacency?`,
    answers: () => [
      "Not with this group. They respect every opponent.",
      "We've prepared for this one like it's a final.",
      'Expectations are for the outside. Inside we just work.',
      'Every match has its own story.',
      "There's no danger at all. We're simply better.",
      'Complacent? Watch us tomorrow.',
    ],
  },
  {
    kind: 'pre', needs: ['underdog'], weight: 2,
    prompt: (c) => `Nobody gives you a chance against ${c.opp.name}. Do you believe you can win?`,
    answers: (c) => [
      `${c.opp.name} are a great ${nat(c, 'club', 'side')}. It's a privilege to test ourselves against them.`,
      'We have nothing to lose. We will enjoy it.',
      'On paper they are stronger. Matches are not played on paper.',
      "We'll give it everything and see where that takes us.",
      "Of course we can win. Otherwise why would we turn up?",
      'They should be worried about us. I mean it.',
    ],
  },
  // The occasion.
  {
    kind: 'pre', needs: ['final'], weight: 8,
    prompt: (c) => `It's the ${c.compName} final. What would it mean to lift the trophy?`,
    answers: (c) => [
      "Everything. For the players, for the fans, for the city.",
      nat(c, 'It would be a reward for a whole season of work.', 'It would be a reward for everything this group has put in.'),
      "We'll talk about meaning afterwards. First we have to play it.",
      'A final is a match like any other — just with a trophy at the end.',
      "We didn't come this far to finish second.",
      'The trophy is coming home with us.',
    ],
  },
  {
    kind: 'pre', needs: ['final'], weight: 6,
    prompt: (c) => `${c.opp.name} stand between you and the trophy. What makes them dangerous?`,
    answers: (c) => [
      `${c.opp.name} deserve to be in this final. It will be a great match.`,
      'They have quality everywhere. We have to be at our best.',
      'Finals are about nerves more than tactics.',
      "We know them well. There'll be no surprises.",
      "We're more dangerous. They know it too.",
      "They've had a good run. It ends tomorrow.",
    ],
  },
  {
    kind: 'pre', needs: ['final'], weight: 5,
    prompt: () => 'How do you prepare a group for a match this big?',
    answers: () => [
      "By keeping things normal. Same routine, same people, same belief.",
      'The players have earned the right to enjoy this.',
      'We prepare it like every other match.',
      "You don't. The occasion prepares them.",
      "By reminding them who they are. Champions don't get nervous.",
      'By telling them the truth: we are going to win.',
    ],
  },
  {
    kind: 'pre', needs: ['titleDecider'], weight: 9,
    prompt: () => 'Win tomorrow and the title is yours. How do you handle that pressure?',
    answers: () => [
      'Pressure is a privilege. We have worked all season for this moment.',
      "The players have handled everything this year. They'll handle this.",
      "We'll stay calm. It's one match.",
      "Nothing is won yet. We don't talk about titles before they are won.",
      "We're going to finish the job. Tomorrow.",
      'Get the champagne ready.',
    ],
  },
  {
    kind: 'pre', needs: ['semi'], weight: 7,
    prompt: (c) => `One step from the ${c.compName} final. How much does this one matter?`,
    answers: (c) => [
      nat(c, 'It matters to everyone at the club. We want to give the fans a final.', 'It matters to everyone back home. We want to give the country a final.'),
      "We've earned this place. Now we want to enjoy it.",
      'It matters exactly as much as the next point.',
      "We'll think about the final if we get there.",
      "We're not here to make up the numbers. We're going to the final.",
      'One more step. We take it tomorrow.',
    ],
  },
  {
    kind: 'pre', needs: ['knockout'], weight: 6,
    prompt: () => "It's win or go home. Does that change how you play?",
    answers: () => [
      "No. We trust the way we play, and we'll play it with courage.",
      'Knockout volleyball is the best kind. The players love it.',
      'It changes nothing. A set is still twenty-five points.',
      'We have to manage the moments. That is all.',
      "We won't be the ones going home.",
      'Win or go home? Then we win.',
    ],
  },
  {
    kind: 'pre', needs: ['topClash'], weight: 6,
    prompt: (c) => `${c.opp.name} are ${ordinal(c.oppPos)}, you're ${ordinal(c.ownPos)}. How big is this one?`,
    answers: () => [
      "It's a great match for the league. Both teams deserve to be up there.",
      "It's big, but the season doesn't end tomorrow.",
      'Three points, like every other match.',
      "There's a long way to go. Nothing is decided tomorrow.",
      "It's the match where we show who the best team really is.",
      "After tomorrow there'll be clear water at the top.",
    ],
  },
  {
    kind: 'pre', needs: ['leaders'], weight: 5,
    prompt: (c) => `${c.opp.name} lead the league. Is this the moment to show you can live with them?`,
    answers: (c) => [
      `${c.opp.name} have been the best team so far. We want to learn from tomorrow.`,
      'It is a great test for us.',
      'The table will look after itself.',
      "Every team is beatable. Let's see.",
      "We can more than live with them. We're going to beat them.",
      "They're top today. Ask me again tomorrow night.",
    ],
  },
  {
    kind: 'pre', needs: ['derby'], weight: 7,
    prompt: (c) => `It's the ${c.city} derby. What does this match mean to the fans?`,
    answers: () => [
      'It means everything to them, and we feel that responsibility.',
      "It's the match everyone circles in the calendar. We know what it means.",
      'Derbies are emotional. We have to keep our heads.',
      "It's special, but the points count the same.",
      'This city has one team that matters, and tomorrow we prove it.',
      'Bragging rights stay with us. I promise the fans that.',
    ],
  },
  {
    kind: 'pre', needs: ['relegation'], weight: 6,
    prompt: (c) => (c.tags.has('relegationPlayoff')
      ? "It's a relegation playoff. How do you prepare for a match with so much at stake?"
      : `You're ${ordinal(c.ownPos)} and the drop is looming. Is this a must-win?`),
    answers: () => [
      'The players care enormously. They will give everything.',
      'We have to stay calm and believe in the work.',
      "Every match is a must-win now. That's the reality.",
      "We'll take it one match at a time. Panic helps nobody.",
      'This club is not going down. Not while I am here.',
      "We'll be safe. Mark my words.",
    ],
  },
  {
    kind: 'pre', needs: ['continental'], weight: 4,
    prompt: (c) => `A night in the ${c.compName}. How do your players handle the step up?`,
    answers: () => [
      'These are the nights they work for. They are excited.',
      'It is a privilege to represent the club on this stage.',
      'The level is higher, so we have to be sharper.',
      "We'll learn a lot about ourselves tomorrow.",
      "We belong at this level. Tomorrow we'll show it.",
      "We're not here for the experience. We're here to win it.",
    ],
  },
  {
    kind: 'pre', needs: ['clubworld'], weight: 5,
    prompt: () => 'The Club World Championship — the whole world is watching. Can you go all the way?',
    answers: () => [
      "It's an honour to be here. We want to make the club proud.",
      'Only the best clubs in the world are here. We respect them all.',
      "Let's take it match by match.",
      "We'll see how far we can go.",
      'We came here to win it.',
      'The best club in the world? Watch us.',
    ],
  },
  {
    kind: 'pre', needs: ['cupEarly'], weight: 3,
    prompt: (c) => `How seriously will you take the ${c.compName}? Will you rotate?`,
    answers: () => [
      'The cup matters to our fans, so it matters to us.',
      'Some players need minutes. They have earned their chance.',
      'We will pick the team that is right for this match.',
      'Rotation is part of a long season.',
      'We want every trophy. We play to win it.',
      'Whoever plays, we go through.',
    ],
  },
  // A national team's.
  {
    kind: 'pre', needs: ['national'], weight: 2,
    prompt: () => 'How have the players settled in since they reported for duty?',
    answers: () => [
      'Brilliantly. There is a real hunger in this group.',
      'They know each other well — that helps us from the first day.',
      'There is always a little time needed. We are getting there.',
      'Club form and country form are different things. We are working on it.',
      'We have no time to settle. We play to win from the first ball.',
      'Anyone not ready will not play. Simple as that.',
    ],
  },
  {
    kind: 'pre', needs: ['hosts'], weight: 4,
    prompt: (c) => `A home ${c.compName}: the whole country is watching. Can the crowd carry you?`,
    answers: () => [
      'Our fans will be our seventh player. We feel them already.',
      'Playing in front of our own people is a privilege.',
      'The crowd helps, but the match is won on the court.',
      'We cannot let the occasion become pressure. We stay calm.',
      'At home, in front of our people, we do not lose.',
      'The pressure is on everyone else in this tournament, not us.',
    ],
  },
  {
    kind: 'pre', needs: ['tournamentOpener'], weight: 4,
    prompt: (c) => `The ${c.compName} starts for you tomorrow. What are your targets?`,
    answers: () => [
      'To make the country proud, match by match.',
      'The preparation went well. We feel ready.',
      'First the pool. Targets are for later.',
      'We know what is expected. We will judge ourselves at the end.',
      'A medal. Nothing less.',
      'We are here to win it.',
    ],
  },
  {
    kind: 'pre', needs: ['bronze'], weight: 7,
    prompt: () => 'A medal on the line, but not the one you came for. How do you lift the players?',
    answers: () => [
      'A medal for your country is never a consolation. They know that.',
      'The disappointment is gone. Tomorrow is a final for us.',
      'It is hard, but we will be ready. It is still a medal.',
      'We have one more match in us. That is all I ask.',
      'Anyone not up for this one can watch from the stand.',
      'We go home with a medal. There is no other option.',
    ],
  },
];

const POST: readonly Archetype[] = [
  // The result.
  {
    kind: 'post', needs: ['won'], weight: 3,
    prompt: (c) => `How pleased are you with the ${c.score} win over ${c.opp.name}?`,
    answers: () => [
      'Very. The players were outstanding from first serve to last.',
      'It was a real team performance. I am proud of them.',
      'A good win. We take the points and move on.',
      'There were good things and things to improve.',
      "Pleased, but we can play much better than that.",
      "We should have won it more comfortably. We'll work on it.",
    ],
  },
  {
    kind: 'post', needs: ['lost'], weight: 3,
    prompt: (c) => `What went wrong against ${c.opp.name} tonight?`,
    answers: (c) => [
      'The effort was there. Sometimes the ball just does not bounce for you.',
      `${c.opp.name} played well. Credit to them.`,
      "We'll look at the video and learn from it.",
      'Small margins. We lost the key moments.',
      'Too many errors. That is not acceptable at this level.',
      'Some players were not at the level they need to be.',
    ],
  },
  {
    kind: 'post', needs: ['won'], weight: 1,
    prompt: () => 'Was there anything you were unhappy with, even in victory?',
    answers: () => [
      'Not tonight. Tonight is for enjoying it.',
      'The players gave me everything. I have no complaints.',
      'A few details on the serve, nothing more.',
      'There always is. We will look at it tomorrow.',
      "Plenty. We were sloppy in spells and I'll tell them so.",
      'We switched off at times. That cannot happen against better teams.',
    ],
  },
  {
    kind: 'post', needs: [], weight: 1,
    prompt: () => 'Where does this result leave you?',
    answers: (c) => [
      'In a good place. The group is strong.',
      "We're building something here. Results like this are part of it.",
      nat(c, "It's one match. The table will tell the story in May.", "It's one match. The tournament will tell the story."),
      'Exactly where we were this morning: working.',
      'Where we expect to be. Nothing has changed.',
      'With a lot to prove — and we will prove it.',
    ],
  },
  // The player of the match.
  {
    kind: 'post', needs: ['ownMvp'], weight: 4,
    prompt: (c) => `${name(c, c.mvp)} was the best player on the court. How good was he tonight?`,
    about: (c) => c.mvp,
    answers: (c) => [
      `Exceptional. ${name(c, c.mvp)} deserves every bit of credit he gets.`,
      'He was world class tonight. That is the standard he sets.',
      'He played well, like a lot of his teammates.',
      'He did his job. That is what we expect.',
      'Good, but he knows he can do even more.',
      "I'd rather not single anyone out — he still made mistakes.",
    ],
  },
  {
    kind: 'post', needs: ['oppMvp', 'lost'], weight: 3,
    prompt: (c) => `${name(c, c.mvp)} ran the show for ${c.opp.name}. Why couldn't you contain him?`,
    answers: () => [
      "Great players do great things. We'll learn from it.",
      'He had one of those nights. Credit to him.',
      'We had a plan. We did not execute it well enough.',
      'One player does not lose you a match.',
      'We made him look better than he is.',
      'Our block was not good enough. That is on us.',
    ],
  },
  // How it came.
  {
    kind: 'post', needs: ['won', 'whitewash'], weight: 3,
    prompt: () => 'Three sets to nil — the perfect night?',
    answers: () => [
      'Close to it. The focus was there from the first point.',
      'The players were superb. They deserve the evening off.',
      'A clean win, but there is no such thing as perfect.',
      'Good, efficient, done. On to the next one.',
      'Perfect would have been fewer errors.',
      'We should win matches like this. That is the standard.',
    ],
  },
  {
    kind: 'post', needs: ['lost', 'whitewash'], weight: 4,
    prompt: (c) => `Not a single set. Is that embarrassing for ${nat(c, 'a club', 'a country')} like ${c.club.name}?`,
    answers: () => [
      'It hurts, but I will stand by these players.',
      'Nights like this happen. We will respond.',
      'It is a bad result. There is no point hiding from it.',
      "We'll analyse it calmly. Overreacting helps no one.",
      'Yes. It was not good enough and the players know it.',
      'Embarrassing is the right word. It will not happen again.',
    ],
  },
  {
    kind: 'post', needs: ['comeback'], weight: 5,
    prompt: () => 'Two sets down and you came back. What did you tell them?',
    answers: () => [
      'To believe. And they did — huge credit to the players.',
      'That character wins matches. This group has plenty of it.',
      'To keep playing our game, one point at a time.',
      'Nothing special. The players found the answers themselves.',
      'Things I cannot repeat here.',
      'That I expected far more. They listened.',
    ],
  },
  {
    kind: 'post', needs: ['collapse'], weight: 5,
    prompt: () => 'Two sets up and you lost. What happened?',
    answers: () => [
      'We lost a little belief. We will get it back together.',
      'They raised their level. Sometimes you have to accept that.',
      'We stopped doing the simple things.',
      'It is hard to explain tonight. We will look at it.',
      'We relaxed. That is unforgivable at this level.',
      'Some players thought it was over. I will be talking to them.',
    ],
  },
  {
    kind: 'post', needs: ['tiebreak'], weight: 2,
    prompt: (c) => (c.tags.has('won') ? 'Won in the tie-break. How are the nerves?' : 'Beaten in the tie-break. How hard is that to take?'),
    answers: (c) => (c.tags.has('won')
      ? [
        'Fine now! The players kept their heads when it mattered.',
        "Those are the matches you remember. I'm proud of them.",
        'It could have gone either way.',
        'A tie-break is a lottery. We had the winning ticket.',
        'We made it far too hard for ourselves.',
        'We should never need five sets in a match like that.',
      ]
      : [
        'Very hard. But I could not ask for more effort.',
        'We were one or two points away. Heads up.',
        'A tie-break can go either way.',
        "That's volleyball. You move on.",
        "We had chances and we didn't take them.",
        'Losing tight matches is a habit we have to break.',
      ]),
  },
  {
    kind: 'post', needs: ['upset'], weight: 4,
    prompt: (c) => `Few expected you to beat ${c.opp.name}. Is this the result of the ${nat(c, 'season', 'tournament')}?`,
    answers: (c) => [
      'For these players, maybe. They earned every point.',
      "It's a night the fans will remember.",
      nat(c, "It's three points. A big three points.", "It's a big win. Nothing is decided yet."),
      'We believed. That is all.',
      "We aren't surprised. We knew we could do it.",
      'People should stop underestimating us.',
    ],
  },
  {
    kind: 'post', needs: ['shock'], weight: 4,
    prompt: (c) => `Losing to ${c.opp.name}, a side you were expected to beat — how do you explain it?`,
    answers: (c) => [
      `${c.opp.name} were better tonight. We have to accept it.`,
      nat(c, 'It is one bad night in a long season.', 'It is one bad night. We have to answer straight away.'),
      "There's no excuse. We'll find out why.",
      'Every team is dangerous on its day.',
      'We were arrogant, and we paid for it.',
      'Some of my players thought it would be easy. It never is.',
    ],
  },
  // What it means.
  {
    kind: 'post', needs: ['trophy'], weight: 9,
    prompt: (c) => `You've won the ${c.compName}! What does this mean to you?`,
    answers: () => [
      'Everything. This is for the players, the staff and every one of our fans.',
      "I'm so proud of this group. They deserve every bit of it.",
      "It's the reward for a lot of hard work.",
      'Tonight we celebrate. Tomorrow we start again.',
      'This is only the beginning for this team.',
      'We said we would win it, and we did.',
    ],
  },
  {
    kind: 'post', needs: ['trophy'], weight: 6,
    prompt: () => 'Who do you dedicate this trophy to?',
    answers: (c) => [
      'To the fans. They never stopped believing.',
      'To my players and my staff — and to my family.',
      nat(c, 'To everyone at the club, from the office to the kit room.', 'To everyone at the federation, from the staff to the kit room.'),
      "To the people who made this possible. They know who they are.",
      'To everyone who doubted us.',
      nat(c, 'To the club. And there will be more.', 'To the whole country. And there will be more.'),
    ],
  },
  {
    kind: 'post', needs: ['finalLost'], weight: 8,
    prompt: () => 'So close in the final. How do you pick the players up?',
    answers: () => [
      'They should be proud. They gave everything to get here.',
      'It hurts now, but we will use this.',
      'Finals are about small moments. We lost them.',
      'We take a few days, then we go again.',
      "We didn't turn up when it mattered. That will hurt for a long time.",
      'Second place is not what we came for.',
    ],
  },
  {
    kind: 'post', needs: ['eliminated'], weight: 6,
    prompt: (c) => `You're out of the ${c.compName}. How big a blow is that?`,
    answers: () => [
      'It hurts. But the players gave everything.',
      'We wanted to go further. We will come back stronger.',
      'Disappointing, but there are other competitions.',
      "It's done. We look forward now.",
      "It's a failure. I won't pretend otherwise.",
      'We had the quality to go through. We did not show it.',
    ],
  },
  {
    kind: 'post', needs: ['top'], weight: 4,
    prompt: () => "You're top of the table. Can you stay there?",
    answers: () => [
      'The players have earned it. We will enjoy it for a night.',
      'It is nice to see, but the season is long.',
      'The table only matters at the end.',
      'We do not look at the table.',
      'We plan to stay there until the end.',
      'Top is where this club belongs.',
    ],
  },
  {
    kind: 'post', needs: ['winningRun', 'won'], weight: 3,
    prompt: (c) => `That's ${c.run} wins in a row now. How far can this run go?`,
    answers: () => [
      'The players are in a great place. I hope it lasts.',
      "We're enjoying it, but we stay humble.",
      'The run will end one day. Our job is to keep it going.',
      'We take every match as it comes.',
      'As far as we want it to.',
      "I don't see anyone stopping us.",
    ],
  },
  {
    kind: 'post', needs: ['losingRun', 'lost'], weight: 4,
    prompt: (c) => `That's ${-c.run} defeats in a row. Can you turn this around?`,
    answers: () => [
      'Yes. I believe in these players completely.',
      'We stick together. That is how you get out of this.',
      "We have to. There's no other option.",
      'One win will change the mood.',
      'Things will change. Some players will have to take a hard look at themselves.',
      'I will make the changes needed. Nobody is safe.',
    ],
  },
  {
    kind: 'post', needs: ['pressure', 'lost'], weight: 4,
    prompt: () => 'Do you still have the board\'s backing after tonight?',
    answers: () => [
      'I have spoken to the board. We are on the same page.',
      'My focus is the players, not the boardroom.',
      "You'd have to ask them.",
      'I will keep working, as I always do.',
      'I will turn this around, whatever anyone says.',
      'I am the right person for this job. Results will show it.',
    ],
  },
  {
    kind: 'post', needs: ['derby'], weight: 5,
    prompt: (c) => (c.tags.has('won') ? `The ${c.city} derby is yours. What does that mean?` : `Beaten in the ${c.city} derby. How do you face the fans?`),
    answers: (c) => (c.tags.has('won')
      ? [
        'It means the world to our fans. This one is for them.',
        "The players knew how much this match mattered. They delivered.",
        'It is a big win, but it is three points.',
        'We will enjoy it tonight and move on tomorrow.',
        'This city is ours.',
        'Let them have the next one — if they can.',
      ]
      : [
        'With our heads up. The players gave everything.',
        'We owe the fans a reaction, and we will give it.',
        'It hurts. There is no point pretending otherwise.',
        'We have to take it on the chin.',
        "It's unacceptable. The fans deserved much more.",
        'Some players did not understand what this match meant.',
      ]),
  },
  // A national team's.
  {
    kind: 'post', needs: ['national', 'won'], weight: 2,
    prompt: () => 'What does a result like this mean back home?',
    answers: () => [
      'I hope the whole country enjoyed it. This is for them.',
      'Playing for the shirt means everything to these players.',
      'It is a good result. The tournament goes on.',
      'We will enjoy tonight and get ready for the next one.',
      'This team can beat anyone. Tonight proved it.',
      'People back home should get used to it.',
    ],
  },
  {
    kind: 'post', needs: ['national', 'lost'], weight: 2,
    prompt: () => 'The country expected more tonight. What do you say to the fans back home?',
    answers: () => [
      'That these players gave everything for the shirt.',
      'That we will learn from it and come back stronger.',
      'That we are disappointed too. Nobody hides from it.',
      'That we will analyse it calmly. One match does not make a team.',
      'That it was not good enough, and the players know it.',
      'That some of them will have to show me more.',
    ],
  },
  {
    kind: 'post', needs: ['bronze', 'won'], weight: 8,
    prompt: () => 'A medal to take home. How proud are you of this group?',
    answers: () => [
      'Very proud. They came back from a hard night and won a medal.',
      'A medal for your country is never small. They earned it.',
      'Proud, yes. But we came for more.',
      'It is a good way to finish. We will build on it.',
      'Bronze this time. Next time, gold.',
      'We showed the character we have. Remember it.',
    ],
  },
  {
    kind: 'post', needs: ['bronze', 'lost'], weight: 8,
    prompt: () => 'Fourth place — so close to a medal. How does that feel?',
    answers: () => [
      'Painful. But I am proud of what these players gave.',
      'We will look back on a good tournament, in time.',
      'It hurts. Fourth is the hardest place to finish.',
      'We have to accept it. The others were better on the day.',
      'It is not good enough. We came here for a medal.',
      'Some players did not show up when it mattered.',
    ],
  },
];

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

/** The questions a conference asks: the occasion's own first, by weight, without repeats. */
function pickQuestions(rng: Rng, bank: readonly Archetype[], c: Ctx, n: number): Archetype[] {
  const pool = bank.filter((a) => a.needs.every((t) => c.tags.has(t)));
  const out: Archetype[] = [];
  while (out.length < n && pool.length > 0) {
    const i = rng.weightedIndex(pool.map((a) => a.weight));
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

const CATEGORY_ORDER: Readonly<Record<AnswerCategory, number>> = { positive: 0, neutral: 1, convince: 2 };

/** What each tone does for morale before a match: ours, and theirs. */
const PRE_MORALE: Readonly<Record<AnswerCategory, { own: number; opp: number }>> = {
  positive: { own: 1, opp: 0 },
  neutral: { own: 2, opp: 1 },
  convince: { own: 4, opp: 3 },
};

/** And after it, in our dressing room — after a win, and after a defeat. */
const POST_MORALE: Readonly<Record<'won' | 'lost', Record<AnswerCategory, number>>> = {
  won: { positive: 2, neutral: 1, convince: 0 },
  lost: { positive: 1, neutral: 0, convince: -2 },
};

/** For a player singled out: praise lifts him, criticism stings. */
const PLAYER_MORALE: Readonly<Record<AnswerCategory, number>> = { positive: 5, neutral: 1, convince: -4 };

const CATEGORIES: readonly AnswerCategory[] = ['positive', 'positive', 'neutral', 'neutral', 'convince', 'convince'];

function buildQuestion(a: Archetype, journalist: JournalistProfile, c: Ctx, kind: InterviewKind, weight: number): InterviewQuestion {
  const texts = a.answers(c);
  const about = a.about?.(c);
  const result = c.tags.has('lost') ? 'lost' : 'won';
  const options = texts.map((text, i): InterviewOption => {
    const category = CATEGORIES[i];
    const own = kind === 'pre' ? PRE_MORALE[category].own : POST_MORALE[result][category];
    const opp = kind === 'pre' ? PRE_MORALE[category].opp : 0;
    return {
      category, text,
      ownMorale: Math.round(own * weight),
      opponentMorale: Math.round(opp * weight),
      ...(about !== undefined && about >= 0 ? { playerIdx: about, playerMorale: PLAYER_MORALE[category] } : {}),
    };
  });
  return { journalist, prompt: a.prompt(c), options, answeredIndex: null, bodyLanguage: 'neutral' };
}

/** How a journalist reads an answer relative to what they wanted to hear —
 *  a direct hit reads as warm, the opposite tone reads as skeptical. */
function reactionFor(bias: AnswerCategory, chosen: AnswerCategory): BodyLanguage {
  const distance = Math.abs(CATEGORY_ORDER[bias] - CATEGORY_ORDER[chosen]);
  if (distance === 0) return 'encouraged';
  if (distance === 1) return 'pleased';
  return 'skeptical';
}

/** A conference for a match, its questions drawn for the occasion. */
function buildSession(world: World, f: Fixture, kind: InterviewKind): { session: InterviewSession; ctx: Ctx } | null {
  const made = contextFor(world, f, kind);
  return made === null ? null : sessionFrom(world, made, f.id, kind);
}

/** The conference for an occasion as the press see it. */
function sessionFrom(
  world: World, made: { ctx: Ctx; stakes: Stakes; occasion: string }, fixtureId: number, kind: InterviewKind,
): { session: InterviewSession; ctx: Ctx } {
  const { ctx, stakes, occasion } = made;
  const room = ROOM[stakes];
  const rng = world.rng;
  const count = rng.int(room.questions[0], room.questions[1]);
  const archetypes = pickQuestions(rng, kind === 'pre' ? PRE : POST, ctx, count);
  const journalists = pickDistinct(rng, JOURNALIST_POOL, archetypes.length);
  const session: InterviewSession = {
    id: world.nextInterviewId++,
    kind,
    fixtureId,
    questions: archetypes.map((a, i) => buildQuestion(a, journalists[i], ctx, kind, room.weight)),
    currentIndex: 0,
    finished: false,
    occasion,
    stakes,
    crowd: rng.int(room.crowd[0], room.crowd[1]),
  };
  return { session, ctx };
}

/** The conference's notice in the inbox. */
export function interviewMessage(world: World, session: InterviewSession): World['messages'][number] | undefined {
  return world.messages.find((m) => m.category === 'interview' && m.interviewId === session.id);
}

// ---- Lifecycle ----------------------------------------------------------------------

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
    // Nobody calls a press conference for a friendly; a nation's matches name nations, not clubs.
    const compKind = world.competitions[f.competitionId]?.kind;
    if (compKind === 'friendly' || compKind === 'international') continue;

    const made = buildSession(world, f, 'pre');
    if (made === null) continue; // e.g. a bye or an unresolved bracket slot
    const { session, ctx } = made;
    world.interviewedFixtures.add(f.id);
    world.pendingInterviews.push(session);

    const where = ctx.tags.has('home') ? `hosting ${ctx.opp.name}` : `your trip to ${ctx.opp.name}`;
    world.messages.push({
      id: world.messages.length,
      day: world.day,
      year: world.year,
      subject: session.stakes === 'routine' ? 'Pre-match press conference' : `Press conference: ${session.occasion}`,
      body: session.stakes === 'huge'
        ? `The press room is packed: ${session.crowd} journalists want to hear from you ahead of the ${session.occasion.toLowerCase()}.`
        : session.stakes === 'big'
          ? `A big crowd of journalists want your thoughts ahead of ${where} — ${session.occasion.toLowerCase()}.`
          : `The press want time with you ahead of ${where}.`,
      category: 'interview',
      fixtureId: f.id,
      interviewId: session.id,
    });
  }
}

/** Days after a match the press still want the manager's reaction. */
const POST_MATCH_DAYS = 2;

/**
 * The press want the manager's reaction to a match his club has just played —
 * offered from the result screen, and kept in the inbox for a day or two.
 * Returns the conference, or null if there is none to give.
 */
export function generatePostMatchInterview(world: World, f: Fixture): InterviewSession | null {
  if (world.userClubId < 0 || !f.played || (f.home !== world.userClubId && f.away !== world.userClubId)) return null;
  const compKind = world.competitions[f.competitionId]?.kind;
  if (compKind === 'friendly' || compKind === 'international') return null;
  const open = world.pendingInterviews.find((s) => s.kind === 'post' && s.fixtureId === f.id);
  if (open !== undefined) return open;
  const made = buildSession(world, f, 'post');
  if (made === null) return null;
  const { session, ctx } = made;
  session.expiresDay = world.day + POST_MATCH_DAYS;
  world.pendingInterviews.push(session);
  const won = ctx.tags.has('won');
  world.messages.push({
    id: world.messages.length,
    day: world.day,
    year: world.year,
    subject: ctx.tags.has('trophy') ? `Press conference: ${ctx.compName} winners` : 'Post-match press conference',
    body: `The press want your reaction to the ${ctx.score} ${won ? 'win over' : 'defeat to'} ${ctx.opp.name}` +
      `${session.stakes === 'routine' ? '' : ` — ${session.crowd} journalists are waiting`}.`,
    category: 'interview',
    fixtureId: f.id,
    interviewId: session.id,
  });
  return session;
}

function adjustSquadMorale(world: World, clubId: number, delta: number): void {
  if (delta === 0 || clubId === NO_CLUB) return;
  const club = world.clubs[clubId];
  if (club === undefined) return;
  adjustPlayersMorale(world, club.players, delta);
}

function adjustPlayersMorale(world: World, players: readonly number[], delta: number): void {
  if (delta === 0) return;
  const store = world.players;
  for (const p of players) {
    store.morale[p] = Math.max(0, Math.min(100, store.morale[p] + delta));
  }
}

/** Answer the current question of a session with one of its options.
 *  Applies morale — both squads before a match, ours after it, and the
 *  player an answer is about — updates that journalist's body language, and
 *  advances to the next question. Returns null if there is no open session
 *  with this id, it's already finished, or the index is stale. */
export function answerInterviewQuestion(
  world: World,
  sessionId: number,
  optionIndex: number,
): AnswerResult | null {
  const session = world.pendingInterviews.find((s) => s.id === sessionId);
  if (session === undefined || session.finished) return null;
  const q = session.questions[session.currentIndex];
  if (q === undefined || q.answeredIndex !== null) return null;
  const option = q.options[optionIndex];
  if (option === undefined) return null;

  const bodyLanguage = reactionFor(q.journalist.bias, option.category);
  q.answeredIndex = optionIndex;
  q.bodyLanguage = bodyLanguage;

  // A question that clearly landed (or badly misjudged the room) nudges the
  // outcome a little further than the flat category effect alone.
  let ownDelta = option.ownMorale;
  if (bodyLanguage === 'encouraged') ownDelta += 1;
  else if (bodyLanguage === 'skeptical') ownDelta -= 1;
  const national = nationalMatchOf(world, session);
  if (national !== null) {
    // A nation's conference: its fourteen, and the other side's.
    const { t, m, nation } = national;
    adjustPlayersMorale(world, squadOf(t, nation), ownDelta);
    adjustPlayersMorale(world, squadOf(t, m.home === nation ? m.away : m.home), option.opponentMorale);
  } else if (session.national === undefined) {
    const f = world.fixtures[session.fixtureId];
    const isHome = f.home === world.userClubId;
    adjustSquadMorale(world, world.userClubId, ownDelta);
    adjustSquadMorale(world, isHome ? f.away : f.home, option.opponentMorale);
  }
  if (option.playerIdx !== undefined && option.playerMorale !== undefined && world.players.isActive(option.playerIdx)) {
    const store = world.players;
    store.morale[option.playerIdx] = Math.max(0, Math.min(100, store.morale[option.playerIdx] + option.playerMorale));
  }

  session.currentIndex++;
  if (session.currentIndex >= session.questions.length) {
    session.finished = true;
    const msg = interviewMessage(world, session);
    if (msg !== undefined) {
      msg.body = session.kind === 'pre'
        ? `You fielded ${session.questions.length} questions from the press before the match.`
        : `You gave the press your reaction after the match — ${session.questions.length} questions.`;
    }
  }

  return { option, bodyLanguage, finished: session.finished };
}

/** Skip the conference entirely — no risk, but no reward either. */
export function declineInterview(world: World, sessionId: number): boolean {
  const idx = world.pendingInterviews.findIndex((s) => s.id === sessionId);
  if (idx === -1) return false;
  const msg = interviewMessage(world, world.pendingInterviews[idx]);
  world.pendingInterviews.splice(idx, 1);
  if (msg !== undefined) msg.body = 'You declined to attend the press conference.';
  return true;
}

/** Dismiss a finished conference's summary — a no-op on one still in progress. */
export function closeInterview(world: World, sessionId: number): void {
  const idx = world.pendingInterviews.findIndex((s) => s.id === sessionId);
  if (idx !== -1 && world.pendingInterviews[idx].finished) world.pendingInterviews.splice(idx, 1);
}

/** Drop the conferences whose moment has passed: one before a match once it
 *  has been played, one after it once the press have moved on — in progress
 *  or merely finished-but-unclosed alike. */
export function expireStaleInterviews(world: World): void {
  if (world.pendingInterviews.length === 0) return;
  const live: InterviewSession[] = [];
  for (const s of world.pendingInterviews) {
    const stale = s.kind === 'post'
      ? world.day > (s.expiresDay ?? world.day)
      : s.national !== undefined
        ? nationalMatchOf(world, s)?.m.played ?? true
        : world.fixtures[s.fixtureId]?.played ?? true;
    if (!stale) { live.push(s); continue; }
    if (!s.finished) {
      const msg = interviewMessage(world, s);
      if (msg !== undefined) {
        msg.body = s.kind === 'pre'
          ? 'The moment passed — the press conference was never finished.'
          : 'The press have moved on — the post-match conference was never given.';
      }
    }
  }
  world.pendingInterviews = live;
}

// ---- The national team -------------------------------------------------------------------

/** Ranking points between two nations that make one a clear favourite. */
const FAVOURITE_POINTS = 100;

/** The tournament and match a national team's conference is about — and the manager's nation. */
function nationalMatchOf(world: World, s: InterviewSession): { t: Tournament; m: IntlMatch; nation: number } | null {
  const ref = s.national;
  if (ref === undefined) return null;
  const t = world.internationals?.tournaments.find((x) => x.id === ref.tournamentId);
  const m = t?.matches.find((x) => x.id === ref.matchId);
  return t !== undefined && m !== undefined ? { t, m, nation: ref.nation } : null;
}

/** A nation's results in competitive matches up to `day`, the latest first. */
function nationResults(world: World, nation: number, day: number): boolean[] {
  const out: Array<[number, boolean]> = [];
  for (const t of world.internationals?.tournaments ?? []) {
    if (t.kind === 'friendly') continue;
    for (const m of t.matches) {
      if (!m.played || m.day > day || (m.home !== nation && m.away !== nation)) continue;
      out.push([m.day, (m.home === nation) === (m.homeSets > m.awaySets)]);
    }
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, won]) => won);
}

/** A national team's match as the press see it: the tournament, the stage, the story. */
function nationalContextFor(
  world: World, t: Tournament, m: IntlMatch, nation: number, kind: InterviewKind,
): { ctx: Ctx; stakes: Stakes; occasion: string } | null {
  if (m.home !== nation && m.away !== nation) return null;
  const oppNation = m.home === nation ? m.away : m.home;
  if (NATIONS[oppNation] === undefined) return null;
  const side = (n: number): Side => ({ id: n, name: nationName(n), arenaName: '' });
  const tags = new Set<Tag>(['national']);
  if (t.host === nation) tags.add('hosts');
  const occasions: string[] = [];

  // What kind of match.
  if (m.stage === 'Final') {
    tags.add('final');
    occasions.push(`${t.name} final`);
  } else if (m.bronze) {
    tags.add('knockout').add('bronze');
    occasions.push(`${t.name} bronze medal match`);
  } else if (m.stage === 'Semi-final') {
    tags.add('semi');
    occasions.push(`${t.name} semi-final`);
  } else if (m.round >= 0) {
    tags.add('knockout');
    occasions.push(`${t.name} ${m.stage.toLowerCase()}`);
  }

  // The story so far.
  const ownSquad = squadOf(t, nation);
  const oppSquad = squadOf(t, oppNation);
  const before = kind === 'pre' ? m.day : m.day - 1;
  if (kind === 'pre') {
    const started = t.matches.some((x) => x.played && (x.home === nation || x.away === nation));
    if (!started && occasions.length === 0) {
      tags.add('tournamentOpener');
      occasions.push(`${t.name} opener`);
    }
    const job = world.career.nationalJobs?.find((j) => j.nation === nation && j.endDay < 0);
    const sinceAppointed = job === undefined || (world.internationals?.tournaments ?? []).some((x) => x.kind !== 'friendly' &&
      x.matches.some((y) => y.played && y.day >= job.startDay && (y.home === nation || y.away === nation)));
    if (!sinceAppointed) tags.add('newBoss');
  }
  const past = nationResults(world, nation, before);
  const after = kind === 'post' ? [(m.home === nation) === (m.homeSets > m.awaySets), ...past] : past;
  const run = runOf(after);
  const oppRun = runOf(nationResults(world, oppNation, before));
  if (run >= 3) tags.add('winningRun');
  if (run <= -3) tags.add('losingRun');
  if (oppRun >= 3) tags.add('oppForm');
  const ranking = (n: number): number => world.nationalTeams.find((x) => x.nation === n)?.rankingPoints ?? 0;
  if (ranking(nation) - ranking(oppNation) > FAVOURITE_POINTS) tags.add('favourite');
  if (ranking(oppNation) - ranking(nation) > FAVOURITE_POINTS) tags.add('underdog');
  const own = stars(world, { players: ownSquad });
  const theirs = stars(world, { players: oppSquad });
  if (own.injured >= 0) tags.add('injuredStar');
  if (theirs.star >= 0) tags.add('oppStar');
  if (own.star >= 0) tags.add('ownStar');

  // How it went.
  let score = '';
  if (kind === 'post') {
    const home = m.home === nation;
    const ownSets = home ? m.homeSets : m.awaySets;
    const oppSets = home ? m.awaySets : m.homeSets;
    const won = ownSets > oppSets;
    score = `${ownSets}-${oppSets}`;
    tags.add(won ? 'won' : 'lost');
    if (Math.min(ownSets, oppSets) === 0) tags.add('whitewash');
    if (ownSets + oppSets === 5) tags.add('tiebreak');
    const firstTwo = m.setScores.slice(0, 2).map(([h, a]) => (home ? h > a : a > h));
    if (firstTwo.length === 2 && firstTwo[0] === firstTwo[1] && firstTwo[0] !== won) tags.add(won ? 'comeback' : 'collapse');
    if (tags.has('final')) tags.add(won ? 'trophy' : 'finalLost');
    else if ((tags.has('semi') || tags.has('knockout')) && !won && !tags.has('bronze')) tags.add('eliminated');
    if (won && tags.has('underdog')) tags.add('upset');
    if (!won && tags.has('favourite')) tags.add('shock');
    if (m.mvp >= 0) tags.add(ownSquad.includes(m.mvp) ? 'ownMvp' : 'oppMvp');
  }

  // The world's biggest stages are big from the first match.
  const grand = t.kind === 'olympics' || t.kind === 'worlds';
  const stakes: Stakes = tags.has('final')
    ? 'huge'
    : tags.has('semi') || tags.has('knockout') || grand || tags.has('hosts') ? 'big' : 'routine';
  const occasion = occasions[0] ?? `${t.name} · ${m.stage}`;
  return {
    ctx: {
      world, club: side(nation), opp: side(oppNation), comp: undefined, compName: t.name, tags, run, oppRun,
      ownPos: 0, oppPos: 0, city: '', injured: own.injured, oppStar: theirs.star, ownStar: own.star, mvp: m.mvp, score,
    },
    stakes,
    occasion,
  };
}

/** The key a nation's match is known by among fixtures: -1 - its id, as the matchday screens have it. */
export function nationalFixtureId(m: IntlMatch): number {
  return -1 - m.id;
}

/**
 * Line up the press conference before the manager's national team's match on
 * `day` — the day after the one being played out, as for a club. Friendlies
 * get none, as a club's do not.
 */
export function generateNationalInterviewSessions(world: World, day: number): void {
  const nation = userNation(world);
  if (nation < 0 || world.internationals === undefined) return;
  for (const t of world.internationals.tournaments) {
    if (t.kind === 'friendly' || t.status === 'planned' || t.status === 'done') continue;
    for (const m of t.matches) {
      if (m.played || m.day !== day || (m.home !== nation && m.away !== nation)) continue;
      const key = nationalFixtureId(m);
      if (world.interviewedFixtures.has(key)) continue;
      const made = nationalContextFor(world, t, m, nation, 'pre');
      if (made === null) continue;
      const { session, ctx } = sessionFrom(world, made, key, 'pre');
      session.national = { tournamentId: t.id, matchId: m.id, nation };
      world.interviewedFixtures.add(key);
      world.pendingInterviews.push(session);
      const ahead = `${ctx.club.name}'s match against ${ctx.opp.name}`;
      world.messages.push({
        id: world.messages.length,
        day: world.day,
        year: world.year,
        subject: session.stakes === 'routine' ? 'Pre-match press conference' : `Press conference: ${session.occasion}`,
        body: session.stakes === 'huge'
          ? `The press room is packed: ${session.crowd} journalists want to hear from you ahead of the ${session.occasion.toLowerCase()}.`
          : session.stakes === 'big'
            ? `A big crowd of journalists want your thoughts ahead of ${ahead} — ${session.occasion.toLowerCase()}.`
            : `The press want time with you ahead of ${ahead}.`,
        from: `${ctx.club.name} Volleyball Federation`,
        category: 'interview',
        fixtureId: key,
        interviewId: session.id,
      });
    }
  }
}

/**
 * The press want the manager's reaction to his national team's match, just
 * played — offered from the result screen, kept in the inbox for a day or
 * two. Returns the conference, or null if there is none to give.
 */
export function generateNationalPostMatchInterview(world: World, t: Tournament, m: IntlMatch): InterviewSession | null {
  const nation = userNation(world);
  if (nation < 0 || t.kind === 'friendly' || !m.played || (m.home !== nation && m.away !== nation)) return null;
  const key = nationalFixtureId(m);
  const open = world.pendingInterviews.find((s) => s.kind === 'post' && s.fixtureId === key);
  if (open !== undefined) return open;
  const made = nationalContextFor(world, t, m, nation, 'post');
  if (made === null) return null;
  const { session, ctx } = sessionFrom(world, made, key, 'post');
  session.national = { tournamentId: t.id, matchId: m.id, nation };
  session.expiresDay = world.day + POST_MATCH_DAYS;
  world.pendingInterviews.push(session);
  const won = ctx.tags.has('won');
  world.messages.push({
    id: world.messages.length,
    day: world.day,
    year: world.year,
    subject: ctx.tags.has('trophy') ? `Press conference: ${ctx.compName} winners` : 'Post-match press conference',
    body: `The press want your reaction to ${ctx.club.name}'s ${ctx.score} ${won ? 'win over' : 'defeat to'} ${ctx.opp.name}` +
      `${session.stakes === 'routine' ? '' : ` — ${session.crowd} journalists are waiting`}.`,
    from: `${ctx.club.name} Volleyball Federation`,
    category: 'interview',
    fixtureId: key,
    interviewId: session.id,
  });
  return session;
}

/** The match a conference is about, as the screens show it: from the manager's side, a club's or a nation's. */
export interface ConferenceMatch {
  day: number;
  played: boolean;
  /** The manager's side at home — never so on neutral ground. */
  home: boolean;
  /** Neither side at home. */
  neutral: boolean;
  ownSets: number;
  oppSets: number;
  /** The other side: a club (its id, else -1) or a nation (its index, else -1). */
  oppClub: number;
  oppNation: number;
  oppName: string;
}

export function conferenceMatch(world: World, s: InterviewSession): ConferenceMatch | null {
  return conferenceMatchFor(world, s.fixtureId, s.national?.nation);
}

/** The same, from the fixture id a conference's message keeps — after the conference itself has gone. */
export function conferenceMatchFor(world: World, fixtureId: number, nation = userNation(world)): ConferenceMatch | null {
  if (fixtureId < 0) {
    const id = -1 - fixtureId;
    for (const t of world.internationals?.tournaments ?? []) {
      const m = t.matches.find((x) => x.id === id);
      if (m === undefined) continue;
      if (m.home !== nation && m.away !== nation) return null;
      const home = m.home === nation;
      const opp = home ? m.away : m.home;
      return {
        day: m.day, played: m.played, home: t.host === nation, neutral: t.host !== nation && t.host !== opp,
        ownSets: home ? m.homeSets : m.awaySets, oppSets: home ? m.awaySets : m.homeSets,
        oppClub: -1, oppNation: opp, oppName: nationName(opp),
      };
    }
    return null;
  }
  const f = world.fixtures[fixtureId];
  if (f === undefined) return null;
  const home = f.home === world.userClubId;
  const opp = world.clubs[home ? f.away : f.home];
  return {
    day: f.day, played: f.played, home: home && !f.neutralVenue, neutral: f.neutralVenue,
    ownSets: home ? f.homeSets : f.awaySets, oppSets: home ? f.awaySets : f.homeSets,
    oppClub: opp?.id ?? -1, oppNation: -1, oppName: opp?.name ?? '?',
  };
}
