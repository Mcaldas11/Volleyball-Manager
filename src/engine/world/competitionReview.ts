/**
 * The review of a competition, once it is over — every competition the
 * manager's club took part in: the league, the cup, the super cup, the
 * continental competition, the Club World Championship.
 *
 * Who won it and who they beat, and where the manager's side finished; the
 * individual awards — the most valuable player, the top scorer, the best
 * attacker, server, blocker, passer, digger and setter, and the best young
 * player; the team of the competition; the favourites going in and how they
 * did, the surprise and the disappointment, measured against how strong each
 * squad was before a ball was played; the best attack, the best defence, the
 * longest winning run; the competition in numbers; and the best point and the
 * best play of it, to watch again, where they were seen.
 */

import { compareTableRows } from '../model/club.ts';
import { Position } from '../model/positions.ts';
import type { Highlight } from '../match/highlights.ts';
import { cupGroupTable, cupProgress, isCupCompetition } from '../season/cups.ts';
import { finalStandingsOrder } from '../season/playoffs.ts';
import { ordinal, postMessage } from './inbox.ts';
import { averageRating, type CompetitionRecord } from './records.ts';
import type { Competition, World } from './world.ts';

export type ReviewAwardKey = 'mvp' | 'scorer' | 'attacker' | 'server' | 'blocker' | 'receiver' | 'digger' | 'setter' | 'rising';

export const REVIEW_AWARD_NAMES: Readonly<Record<ReviewAwardKey, string>> = {
  mvp: 'Most valuable player', scorer: 'Top scorer', attacker: 'Best attacker', server: 'Best server',
  blocker: 'Best blocker', receiver: 'Best receiver', digger: 'Best digger', setter: 'Best setter', rising: 'Best young player',
};

export interface ReviewAward {
  key: ReviewAwardKey;
  p: number;
  clubId: number;
  /** What won it: "212 points", "54% positive passes". */
  value: string;
}

/** A side measured against the strength it started with: ranks from 1. */
export interface ReviewTeamNote {
  clubId: number;
  expected: number;
  actual: number;
}

export interface CompetitionReview {
  competitionId: number;
  season: number;
  champion: number;
  runnerUp: number;
  /** The final order, as far as it goes. */
  standings: number[];
  /** Where the manager's side finished, and where it was expected to. */
  you: { finish: string; expected: number | null } | null;
  awards: ReviewAward[];
  /** The team of the competition: a setter, two outsides, two middles, an opposite, a libero. */
  dreamTeam: Array<{ pos: Position; p: number; clubId: number; rating: number }>;
  /** The three strongest squads going in, and where they finished. */
  favourites: ReviewTeamNote[];
  surprise: ReviewTeamNote | null;
  disappointment: ReviewTeamNote | null;
  bestAttack: { clubId: number; perSet: number } | null;
  bestDefence: { clubId: number; perSet: number } | null;
  longestRun: { clubId: number; wins: number } | null;
  numbers: { matches: number; sets: number; tieBreaks: number; sweeps: number };
  bestPoint?: Highlight;
  bestPlay?: Highlight;
}

// ---- Keeping track through the season ----------------------------------------------------

/** A competition's key for the season: one review, and one look at the field, each. */
function key(world: World, comp: Competition): string {
  return `${world.season}:${comp.id}`;
}

/** The clubs in a competition this season. */
function entrants(comp: Competition): number[] {
  if (isCupCompetition(comp)) return comp.cup?.entrants ?? [];
  return comp.table.length > 0 ? comp.table.map((r) => r.clubId) : comp.participants;
}

/** A competition the manager's club is in, worth a review. */
function followed(world: World, comp: Competition): boolean {
  if (comp.kind === 'friendly' || comp.kind === 'international' || world.userClubId < 0) return false;
  return entrants(comp).includes(world.userClubId);
}

/** How strong a squad is: its best seven, by current ability. */
function squadStrength(world: World, clubId: number): number {
  const club = world.clubs[clubId];
  if (club === undefined) return 0;
  const store = world.players;
  const best = club.players.map((p) => store.currentAbility[p]).sort((a, b) => b - a).slice(0, 7);
  return best.length > 0 ? best.reduce((s, x) => s + x, 0) / best.length : 0;
}

/** Whether a competition's season is over. */
function finished(world: World, comp: Competition): boolean {
  if (isCupCompetition(comp)) return comp.cup?.season === world.season && comp.cup.bracket?.resolved === true;
  if (comp.kind !== 'league' || comp.table.length === 0 || comp.table.every((r) => r.played === 0)) return false;
  if (!comp.fixtureIds.every((id) => world.fixtures[id]?.played === true)) return false;
  if (!comp.hasPlayoffs) return true;
  return comp.playoffGroups.length > 0 && comp.playoffGroups.every((g) => g.resolved);
}

/**
 * Each day: the field of every followed competition noted before it starts —
 * its squads, strongest first — and a review of any that has just finished.
 * `seasonOver` reviews any league still unreviewed as the season closes.
 */
export function competitionReviewsDay(world: World, seasonOver = false): void {
  world.competitionFields ??= {};
  world.reviewedCompetitions ??= [];
  for (const comp of world.competitions) {
    const k = key(world, comp);
    // One the manager started in is still his to hear about — sacked or moved on since.
    if (!followed(world, comp) && world.competitionFields[k] === undefined) continue;
    if (world.competitionFields[k] === undefined && entrants(comp).length > 0) {
      world.competitionFields[k] = [...entrants(comp)].sort((a, b) => squadStrength(world, b) - squadStrength(world, a));
    }
    if (world.reviewedCompetitions.includes(k)) continue;
    const over = finished(world, comp) || (seasonOver && comp.kind === 'league' && comp.table.some((r) => r.played > 0));
    if (!over) continue;
    world.reviewedCompetitions.push(k);
    postReview(world, comp, reviewCompetition(world, comp));
  }
  // Only this season's and last season's are worth remembering.
  world.reviewedCompetitions = world.reviewedCompetitions.filter((k) => Number(k.split(':')[0]) >= world.season - 1);
  for (const k of Object.keys(world.competitionFields)) {
    if (Number(k.split(':')[0]) < world.season - 1) delete world.competitionFields[k];
  }
}

/** The best point and play seen in a competition this season — kept as matches are played. */
export function keepCompetitionHighlight(world: World, h: Highlight): void {
  if (h.competitionId === undefined) return;
  world.competitionHighlights ??= {};
  const k = `${world.season}:${h.competitionId}`;
  const best = (world.competitionHighlights[k] ??= {});
  const slot = h.kind === 'point' ? 'point' : 'play';
  if (best[slot] === undefined || best[slot]!.score < h.score) best[slot] = h;
  for (const old of Object.keys(world.competitionHighlights)) {
    if (Number(old.split(':')[0]) < world.season) delete world.competitionHighlights[old];
  }
}

// ---- The review ------------------------------------------------------------------------

/** The final order of a competition: the league as it ended, or the cup by how far each got. */
function standingsOf(world: World, comp: Competition): number[] {
  if (!isCupCompetition(comp)) return finalStandingsOrder(comp);
  const cup = comp.cup;
  const order = [...(cup?.bracket?.finalOrder ?? [])];
  // Those out in the groups follow, by where they finished in them.
  const groupRows = (cup?.groups ?? []).flatMap((g) => cupGroupTable(world, g).map((r, i) => ({ r, i })));
  groupRows.sort((a, b) => a.i - b.i || compareTableRows(a.r, b.r));
  for (const { r } of groupRows) if (!order.includes(r.clubId)) order.push(r.clubId);
  for (const c of entrants(comp)) if (!order.includes(c)) order.push(c);
  return order;
}

/** Every player's line in this competition this season. */
function linesOf(world: World, comp: Competition): Array<[number, CompetitionRecord]> {
  const out: Array<[number, CompetitionRecord]> = [];
  for (const [p, recs] of world.competitionRecords) {
    const line = recs.find((r) => r.season === world.season && r.competitionId === comp.id);
    if (line !== undefined && line.apps > 0) out.push([p, line]);
  }
  return out;
}

export function reviewCompetition(world: World, comp: Competition): CompetitionReview {
  const store = world.players;
  const standings = standingsOf(world, comp);
  const champion = standings[0] ?? comp.champion;
  const runnerUp = standings[1] ?? -1;

  // ---- The players ----
  const lines = linesOf(world, comp);
  const maxApps = Math.max(1, ...lines.map(([, l]) => l.apps));
  // A one-off — a super cup final — has its MVP from the one match.
  const minApps = Math.min(maxApps, Math.max(2, Math.ceil(maxApps * 0.4)));
  const regulars = lines.filter(([, l]) => l.apps >= minApps);
  const awards: ReviewAward[] = [];
  const give = (k: ReviewAwardKey, pool: Array<[number, CompetitionRecord]>, score: (l: CompetitionRecord) => number,
    value: (l: CompetitionRecord) => string): void => {
    let best: [number, CompetitionRecord] | null = null;
    for (const e of pool) if (best === null || score(e[1]) > score(best[1])) best = e;
    if (best !== null && score(best[1]) > 0) awards.push({ key: k, p: best[0], clubId: store.clubId[best[0]], value: value(best[1]) });
  };
  give('mvp', regulars, (l) => averageRating(l) + l.mvps * 0.02, (l) => `${averageRating(l).toFixed(2)} average · ${l.mvps} MVP${l.mvps === 1 ? '' : 's'}`);
  give('scorer', lines, (l) => l.points, (l) => `${l.points} points`);
  const maxAttacks = Math.max(1, ...lines.map(([, l]) => l.attacks ?? 0));
  const efficiency = (l: CompetitionRecord): number => ((l.kills ?? 0) - (l.attackErrors ?? 0)) / Math.max(1, l.attacks ?? 0);
  give('attacker', lines.filter(([, l]) => (l.attacks ?? 0) >= Math.max(20, maxAttacks * 0.3)), (l) => efficiency(l) + 1,
    (l) => `${(efficiency(l) * 100).toFixed(0)}% efficiency · ${l.kills ?? 0} kills`);
  give('server', lines, (l) => l.aces, (l) => `${l.aces} aces`);
  give('blocker', lines, (l) => l.blocks, (l) => `${l.blocks} blocks`);
  const maxRec = Math.max(1, ...lines.map(([, l]) => l.receptions ?? 0));
  const passing = (l: CompetitionRecord): number => (l.goodPasses ?? 0) / Math.max(1, l.receptions ?? 0);
  give('receiver', lines.filter(([, l]) => (l.receptions ?? 0) >= Math.max(15, maxRec * 0.35)), (l) => passing(l),
    (l) => `${Math.round(passing(l) * 100)}% positive passes`);
  give('digger', lines, (l) => l.digs ?? 0, (l) => `${l.digs ?? 0} digs`);
  give('setter', lines, (l) => l.assists ?? 0, (l) => `${l.assists ?? 0} assists`);
  give('rising', regulars.filter(([p]) => world.year - store.birthYear[p] <= 21), (l) => averageRating(l),
    (l) => `${averageRating(l).toFixed(2)} average in ${l.apps} matches`);

  // The team of the competition: the best by average rating in each position.
  const dreamTeam: CompetitionReview['dreamTeam'] = [];
  const shape: Array<[Position, number]> = [
    [Position.Setter, 1], [Position.OutsideHitter, 2], [Position.MiddleBlocker, 2], [Position.Opposite, 1], [Position.Libero, 1],
  ];
  for (const [pos, n] of shape) {
    regulars.filter(([p]) => store.position[p] === pos)
      .sort((a, b) => averageRating(b[1]) - averageRating(a[1]))
      .slice(0, n)
      .forEach(([p, l]) => dreamTeam.push({ pos, p, clubId: store.clubId[p], rating: averageRating(l) }));
  }

  // ---- The teams, against the strength they started with ----
  const field = world.competitionFields?.[key(world, comp)] ??
    [...standings].sort((a, b) => squadStrength(world, b) - squadStrength(world, a));
  const expectedOf = (c: number): number | null => {
    const i = field.indexOf(c);
    return i >= 0 ? i + 1 : null;
  };
  const notes: ReviewTeamNote[] = standings
    .map((c, i) => ({ clubId: c, expected: expectedOf(c) ?? i + 1, actual: i + 1 }));
  const favourites = field.slice(0, 3).map((c) => ({ clubId: c, expected: (expectedOf(c) ?? 0), actual: standings.indexOf(c) + 1 }));
  const swing = Math.max(2, Math.round(standings.length / 6));
  const surprise = [...notes].sort((a, b) => (b.expected - b.actual) - (a.expected - a.actual))[0];
  const flop = [...notes].sort((a, b) => (b.actual - b.expected) - (a.actual - a.expected))[0];

  // ---- The matches ----
  const fixtures = comp.fixtureIds.map((id) => world.fixtures[id]).filter((f) => f !== undefined && f.played)
    .sort((a, b) => a.day - b.day);
  const per = new Map<number, { scored: number; conceded: number; sets: number; matches: number }>();
  const run = new Map<number, number>();
  let longestRun: CompetitionReview['longestRun'] = null;
  let sets = 0;
  let tieBreaks = 0;
  let sweeps = 0;
  for (const f of fixtures) {
    const scores = f.setScores ?? [];
    sets += scores.length;
    if (scores.length >= 5) tieBreaks++;
    if (Math.min(f.homeSets, f.awaySets) === 0 && Math.max(f.homeSets, f.awaySets) >= 3) sweeps++;
    for (const [club, mine] of [[f.home, 0], [f.away, 1]] as const) {
      const t = per.get(club) ?? { scored: 0, conceded: 0, sets: 0, matches: 0 };
      for (const s of scores) {
        t.scored += s[mine];
        t.conceded += s[1 - mine];
      }
      t.sets += scores.length;
      t.matches++;
      per.set(club, t);
      const won = mine === 0 ? f.homeSets > f.awaySets : f.awaySets > f.homeSets;
      const streak = won ? (run.get(club) ?? 0) + 1 : 0;
      run.set(club, streak);
      if (streak > (longestRun?.wins ?? 1)) longestRun = { clubId: club, wins: streak };
    }
  }
  let bestAttack: CompetitionReview['bestAttack'] = null;
  let bestDefence: CompetitionReview['bestDefence'] = null;
  const minMatches = Math.max(2, Math.ceil(Math.max(0, ...[...per.values()].map((t) => t.matches)) * 0.5));
  for (const [club, t] of per) {
    if (t.matches < minMatches || t.sets === 0) continue;
    const scored = t.scored / t.sets;
    const conceded = t.conceded / t.sets;
    if (bestAttack === null || scored > bestAttack.perSet) bestAttack = { clubId: club, perSet: scored };
    if (bestDefence === null || conceded < bestDefence.perSet) bestDefence = { clubId: club, perSet: conceded };
  }

  // ---- Where the manager's side finished ----
  const mine = world.userClubId;
  const at = standings.indexOf(mine);
  let finish = at >= 0 ? `${ordinal(at + 1)}` : '—';
  if (isCupCompetition(comp)) finish = cupProgress(comp, mine)?.stage ?? finish;
  else if (at === 0) finish = 'Champions';

  const seen = world.competitionHighlights?.[`${world.season}:${comp.id}`];
  return {
    competitionId: comp.id,
    season: world.season,
    champion,
    runnerUp,
    standings: standings.slice(0, 16),
    you: at >= 0 ? { finish, expected: expectedOf(mine) } : null,
    awards,
    dreamTeam,
    favourites,
    surprise: surprise !== undefined && surprise.expected - surprise.actual >= swing ? surprise : null,
    disappointment: flop !== undefined && flop.actual - flop.expected >= swing ? flop : null,
    bestAttack,
    bestDefence,
    longestRun,
    numbers: { matches: fixtures.length, sets, tieBreaks, sweeps },
    bestPoint: seen?.point,
    bestPlay: seen?.play,
  };
}

/** The review, to the manager's inbox. */
function postReview(world: World, comp: Competition, r: CompetitionReview): void {
  const champ = world.clubs[r.champion];
  const second = world.clubs[r.runnerUp];
  const store = world.players;
  const award = (k: ReviewAwardKey): string | null => {
    const a = r.awards.find((x) => x.key === k);
    return a !== undefined ? `${store.fullName(a.p)} (${a.value})` : null;
  };
  const how = isCupCompetition(comp) ? `beating ${second?.name ?? 'their opponents'} in the final` : `ahead of ${second?.name ?? 'the rest'}`;
  const ours = r.champion === world.userClubId;
  const parts = [
    `${champ?.name ?? 'The champions'} are the ${comp.name} champions, ${how}.`,
    r.you !== null && !ours ? `You finished: ${r.you.finish}.` : '',
    award('mvp') !== null ? `Most valuable player: ${award('mvp')}.` : '',
    award('scorer') !== null ? `Top scorer: ${award('scorer')}.` : '',
    'The full review — the awards, the team of the competition, the surprises and the disappointments — is below.',
  ];
  postMessage(world, {
    category: 'awards',
    from: comp.organizer ?? comp.name,
    clubId: r.champion >= 0 ? r.champion : undefined,
    subject: `${comp.name} review: ${ours ? 'champions!' : `${champ?.name ?? '—'} win it`}`,
    body: parts.filter((x) => x !== '').join(' '),
    competitionReview: r,
  });
}
