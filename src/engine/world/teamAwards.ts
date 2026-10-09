/**
 * The team awards of a competition: the best attack and the meanest defence,
 * the best block, serve and passing, the most clinical hitting, and the side
 * that came back from a set down most often — and, for each, the players who
 * made it, with their numbers.
 *
 * Kept match by match for the competitions the manager's club is in: each
 * side's points for and against, and every player's share of what it did,
 * under the club he did it for — a man who moves in the winter counts for
 * both, each for what he did there.
 */

import { playedInMatch } from '../match/playerRating.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { isCupCompetition } from '../season/cups.ts';
import type { Competition, Fixture, World } from './world.ts';

/** One player's share of what his side did in a competition. */
export interface PlayerShare {
  apps: number;
  points: number;
  kills: number;
  attacks: number;
  /** Attacks hit out or blocked. */
  attackErrors: number;
  aces: number;
  serves: number;
  serveErrors: number;
  blocks: number;
  digs: number;
  receptions: number;
  /** Perfect and positive passes. */
  goodPasses: number;
  assists: number;
}

/** A side's competition, match by match. */
export interface TeamLine {
  matches: number;
  won: number;
  sets: number;
  pointsFor: number;
  pointsAgainst: number;
  /** The fixtures it won from a set down. */
  comebacks: number[];
  players: Record<number, PlayerShare>;
}

export type TeamAwardKey = 'attack' | 'defence' | 'block' | 'serve' | 'reception' | 'clinical' | 'comeback';

export const TEAM_AWARD_NAMES: Readonly<Record<TeamAwardKey, string>> = {
  attack: 'Best attack', defence: 'Best defence', block: 'Best block', serve: 'Best serve',
  reception: 'Best passing', clinical: 'Most clinical attack', comeback: 'Comeback kings',
};

/** What each is judged on. */
export const TEAM_AWARD_HOW: Readonly<Record<TeamAwardKey, string>> = {
  attack: 'Most points scored a set', defence: 'Fewest points conceded a set', block: 'Most block points a set',
  serve: 'Most aces a set', reception: 'Best share of good passes', clinical: 'Best attack efficiency',
  comeback: 'Most wins from a set down',
};

/** A player's part in a team award: his numbers, and his share of the side's on what it was won. */
export interface TeamAwardPlayer {
  p: number;
  /** The number it was won on: "888 pts". */
  value: string;
  /** The rest of his line: "709 kills · 47 blocks · 132 aces". */
  line: string;
  /** 0-1. */
  share: number;
}

export interface TeamAward {
  key: TeamAwardKey;
  clubId: number;
  /** What won it: "26.1 points a set". */
  value: string;
  /** The next two sides, and theirs, in short: "21.8 a set". */
  chasers: Array<{ clubId: number; value: string }>;
  /** The players who made it, the biggest part first. */
  players: TeamAwardPlayer[];
  /** For the comeback kings: the matches, as "3-1 v Club". */
  matches?: Array<{ opponent: number; score: string }>;
}

// ---- Keeping track ---------------------------------------------------------------------

/** The clubs in a competition this season. */
export function entrants(comp: Competition): number[] {
  if (isCupCompetition(comp)) return comp.cup?.entrants ?? [];
  return comp.table.length > 0 ? comp.table.map((r) => r.clubId) : comp.participants;
}

/** A competition the manager's club is in — or was in when it began. */
function tracked(world: World, comp: Competition): boolean {
  if (comp.kind === 'friendly' || comp.kind === 'international') return false;
  return world.competitionFields?.[`${world.season}:${comp.id}`] !== undefined ||
    (world.userClubId >= 0 && entrants(comp).includes(world.userClubId));
}

function emptyShare(): PlayerShare {
  return {
    apps: 0, points: 0, kills: 0, attacks: 0, attackErrors: 0, aces: 0, serves: 0, serveErrors: 0,
    blocks: 0, digs: 0, receptions: 0, goodPasses: 0, assists: 0,
  };
}

/** A match played: both sides' lines, and every player's share, in a followed competition. */
export function noteTeamMatch(
  world: World,
  fixture: Fixture,
  homeStats: ReadonlyMap<number, PlayerMatchStats>,
  awayStats: ReadonlyMap<number, PlayerMatchStats>,
): void {
  const comp = world.competitions[fixture.competitionId];
  if (comp === undefined || !tracked(world, comp)) return;
  const lines = ((world.teamLines ??= {})[`${world.season}:${comp.id}`] ??= {});
  const sides = [[fixture.home, homeStats, 0], [fixture.away, awayStats, 1]] as const;
  for (const [club, stats, mine] of sides) {
    const t = (lines[club] ??= { matches: 0, won: 0, sets: 0, pointsFor: 0, pointsAgainst: 0, comebacks: [], players: {} });
    const setsFor = mine === 0 ? fixture.homeSets : fixture.awaySets;
    const setsAgainst = mine === 0 ? fixture.awaySets : fixture.homeSets;
    t.matches++;
    t.sets += fixture.setScores.length;
    for (const s of fixture.setScores) {
      t.pointsFor += s[mine];
      t.pointsAgainst += s[1 - mine];
    }
    const first = fixture.setScores[0];
    if (setsFor > setsAgainst) {
      t.won++;
      if (first !== undefined && first[mine] < first[1 - mine]) t.comebacks.push(fixture.id);
    }
    for (const [p, s] of stats) {
      if (!playedInMatch(s)) continue;
      const sh = (t.players[p] ??= emptyShare());
      sh.apps++;
      sh.points += s.attackKills + s.serveAces + s.blockPoints;
      sh.kills += s.attackKills;
      sh.attacks += s.attacksTotal;
      sh.attackErrors += s.attackErrors + s.attackBlocked;
      sh.aces += s.serveAces;
      sh.serves += s.servesTotal;
      sh.serveErrors += s.serveErrors;
      sh.blocks += s.blockPoints;
      sh.digs += s.digsTotal;
      sh.receptions += s.receptionsTotal;
      sh.goodPasses += s.receptionPerfect + s.receptionPositive;
      sh.assists += s.setAssists;
    }
  }
}

/** Only this season's and last season's are worth keeping. */
export function pruneTeamLines(world: World): void {
  for (const k of Object.keys(world.teamLines ?? {})) {
    if (Number(k.split(':')[0]) < world.season - 1) delete world.teamLines![k];
  }
}

// ---- The awards ------------------------------------------------------------------------

type Totals = PlayerShare;

function totalsOf(t: TeamLine): Totals {
  const sum = emptyShare();
  for (const sh of Object.values(t.players)) {
    for (const k of Object.keys(sum) as Array<keyof Totals>) sum[k] += sh[k];
  }
  return sum;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** How an award is judged, and how a side's and a player's numbers read on it. */
interface Measure {
  key: TeamAwardKey;
  /** Higher is better. */
  score: (t: TeamLine, sum: Totals) => number;
  value: (t: TeamLine, sum: Totals) => string;
  /** The same, in short, for the sides behind. */
  short: (t: TeamLine, sum: Totals) => string;
  /** A player's part; the number it is, and the rest of his line. */
  part: (sh: PlayerShare) => number;
  main: (sh: PlayerShare) => string;
  line: (sh: PlayerShare) => string;
}

const matches = (n: number): string => `${n} match${n === 1 ? '' : 'es'}`;

const MEASURES: readonly Measure[] = [
  {
    key: 'attack',
    score: (t) => t.pointsFor / t.sets,
    value: (t) => `${(t.pointsFor / t.sets).toFixed(1)} points a set`,
    short: (t) => `${(t.pointsFor / t.sets).toFixed(1)} a set`,
    part: (sh) => sh.points,
    main: (sh) => `${sh.points} pts`,
    line: (sh) => `${sh.kills} kills · ${sh.blocks} blocks · ${sh.aces} aces`,
  },
  {
    key: 'defence',
    score: (t) => -t.pointsAgainst / t.sets,
    value: (t) => `${(t.pointsAgainst / t.sets).toFixed(1)} conceded a set`,
    short: (t) => `${(t.pointsAgainst / t.sets).toFixed(1)} a set`,
    part: (sh) => sh.digs + sh.blocks,
    main: (sh) => `${sh.digs} digs`,
    line: (sh) => `${sh.blocks} blocks · ${matches(sh.apps)}`,
  },
  {
    key: 'block',
    score: (t, sum) => sum.blocks / t.sets,
    value: (t, sum) => `${(sum.blocks / t.sets).toFixed(2)} blocks a set · ${sum.blocks} in all`,
    short: (t, sum) => `${(sum.blocks / t.sets).toFixed(2)} a set`,
    part: (sh) => sh.blocks,
    main: (sh) => `${sh.blocks} blocks`,
    line: (sh) => `${(sh.blocks / Math.max(1, sh.apps)).toFixed(1)} a match · ${matches(sh.apps)}`,
  },
  {
    key: 'serve',
    score: (t, sum) => sum.aces / t.sets - (sum.serveErrors / Math.max(1, sum.serves)) * 0.01,
    value: (t, sum) => `${(sum.aces / t.sets).toFixed(2)} aces a set · ${pct(sum.serveErrors / Math.max(1, sum.serves))} errors`,
    short: (t, sum) => `${(sum.aces / t.sets).toFixed(2)} a set`,
    part: (sh) => sh.aces,
    main: (sh) => `${sh.aces} aces`,
    line: (sh) => `${sh.serveErrors} errors · ${sh.serves} serves`,
  },
  {
    key: 'reception',
    score: (_t, sum) => sum.goodPasses / Math.max(1, sum.receptions),
    value: (_t, sum) => `${pct(sum.goodPasses / Math.max(1, sum.receptions))} good passes · ${sum.receptions} received`,
    short: (_t, sum) => `${pct(sum.goodPasses / Math.max(1, sum.receptions))} good`,
    part: (sh) => sh.receptions,
    main: (sh) => `${pct(sh.goodPasses / Math.max(1, sh.receptions))} good`,
    line: (sh) => `${sh.receptions} received · ${matches(sh.apps)}`,
  },
  {
    key: 'clinical',
    score: (_t, sum) => (sum.kills - sum.attackErrors) / Math.max(1, sum.attacks),
    value: (_t, sum) => `${pct((sum.kills - sum.attackErrors) / Math.max(1, sum.attacks))} efficiency · ${pct(sum.kills / Math.max(1, sum.attacks))} kills`,
    short: (_t, sum) => `${pct((sum.kills - sum.attackErrors) / Math.max(1, sum.attacks))}`,
    part: (sh) => sh.kills,
    main: (sh) => `${pct((sh.kills - sh.attackErrors) / Math.max(1, sh.attacks))}`,
    line: (sh) => `${sh.kills} kills from ${sh.attacks} · ${sh.attackErrors} errors`,
  },
];

/** How many players an award names, at most. */
const PLAYERS_NAMED = 7;

/**
 * The team awards of a competition this season — none when its matches were
 * not all followed (a save from before they were kept, say), rather than
 * awards on half a competition.
 */
export function teamAwardsOf(world: World, comp: Competition): TeamAward[] {
  const lines = world.teamLines?.[`${world.season}:${comp.id}`];
  if (lines === undefined) return [];
  const played = comp.fixtureIds.filter((id) => world.fixtures[id]?.played === true).length;
  const sides = Object.entries(lines).map(([c, t]) => ({ clubId: Number(c), t, sum: totalsOf(t) }));
  const kept = sides.reduce((n, s) => n + s.t.matches, 0);
  if (played === 0 || kept < played * 2 * 0.9) return [];

  // Judged on a fair run of matches: half as many as the side that played most.
  const minMatches = Math.max(2, Math.ceil(Math.max(...sides.map((s) => s.t.matches)) * 0.5));
  const field = sides.filter((s) => s.t.matches >= minMatches && s.t.sets > 0);
  if (field.length < 2) return [];

  const out: TeamAward[] = [];
  for (const m of MEASURES) {
    const ranked = [...field].sort((a, b) => m.score(b.t, b.sum) - m.score(a.t, a.sum) || a.clubId - b.clubId);
    const best = ranked[0];
    const whole = Object.values(best.t.players).reduce((n, sh) => n + m.part(sh), 0);
    const players = Object.entries(best.t.players)
      .map(([p, sh]) => ({ p: Number(p), sh }))
      .filter(({ sh }) => m.part(sh) > 0)
      .sort((a, b) => m.part(b.sh) - m.part(a.sh) || a.p - b.p)
      .slice(0, PLAYERS_NAMED)
      .map(({ p, sh }) => ({ p, value: m.main(sh), line: m.line(sh), share: whole > 0 ? m.part(sh) / whole : 0 }));
    out.push({
      key: m.key,
      clubId: best.clubId,
      value: m.value(best.t, best.sum),
      chasers: ranked.slice(1, 3).map((s) => ({ clubId: s.clubId, value: m.short(s.t, s.sum) })),
      players,
    });
  }

  // The comeback kings: the most wins from a set down — two at least.
  const comeback = [...sides].sort((a, b) => b.t.comebacks.length - a.t.comebacks.length || b.t.won - a.t.won || a.clubId - b.clubId);
  const king = comeback[0];
  if (king !== undefined && king.t.comebacks.length >= 2) {
    const wins = king.t.comebacks.map((id) => {
      const f = world.fixtures[id];
      const home = f.home === king.clubId;
      return { opponent: home ? f.away : f.home, score: home ? `${f.homeSets}-${f.awaySets}` : `${f.awaySets}-${f.homeSets}` };
    });
    out.push({
      key: 'comeback',
      clubId: king.clubId,
      value: `${king.t.comebacks.length} wins from a set down`,
      chasers: comeback.slice(1, 3).filter((s) => s.t.comebacks.length > 0)
        .map((s) => ({ clubId: s.clubId, value: `${s.t.comebacks.length} win${s.t.comebacks.length === 1 ? '' : 's'}` })),
      // Who carried them: the points, over the whole competition.
      players: Object.entries(king.t.players)
        .map(([p, sh]) => ({ p: Number(p), sh }))
        .filter(({ sh }) => sh.points > 0)
        .sort((a, b) => b.sh.points - a.sh.points || a.p - b.p)
        .slice(0, 3)
        .map(({ p, sh }) => ({ p, value: `${sh.points} pts`, line: matches(sh.apps), share: 0 })),
      matches: wins,
    });
  }
  return out;
}
