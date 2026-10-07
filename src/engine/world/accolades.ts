/**
 * The season's individual awards, handed out as it ends: in every top-flight
 * league — and the manager's, wherever it is — its Player, Coach and Young
 * Player of the Year and its Team of the Season; across the world, the World
 * Player, Coach and Young Player of the Year and the World Team of the Year.
 * Each with a shortlist of three.
 *
 * A player is judged on his ratings — against the level he played them at,
 * for the world's — and on what his side won; a coach on where his side
 * finished against where its squad said it would, and on what it won. The
 * manager is a coach like any other, and can win them too.
 *
 * Every award goes on the record, on its winners' profiles; the manager hears
 * of his league's and of the world's in his inbox.
 */

import { Position } from '../model/positions.ts';
import { finalStandingsOrder } from '../season/playoffs.ts';
import { headCoachOf } from './career.ts';
import { linesOf, regularsOf, teamOf, type DreamPick } from './competitionReview.ts';
import { ordinal, postMessage } from './inbox.ts';
import { averageRating } from './records.ts';
import type { Competition, SeasonAwardLine, SeasonRecord, World } from './world.ts';

export type AccoladeKind = 'player' | 'coach' | 'young' | 'team';

/** One award, on the record. */
export interface Accolade {
  kind: AccoladeKind;
  /** The world's, or the competition it was given in. */
  scope: number | 'world';
  season: number;
  /** The player — for every kind but the coach's. */
  p?: number;
  /** The coach: a staff id, or -1 for the manager. */
  coach?: number;
  clubId: number;
  /** In a team of the season: the position he was picked at. */
  pos?: Position;
}

/** One of the three on a shortlist. */
export interface Nominee {
  p?: number;
  /** A staff id, or -1 for the manager. */
  coach?: number;
  clubId: number;
  /** What put him there: "7.62 average · 14 MVPs", "1st, expected 6th". */
  value: string;
}

/** A night of awards — a league's or the world's — as the inbox shows it. */
export interface AwardsNight {
  scope: number | 'world';
  season: number;
  /** Each award with its shortlist, the winner first. */
  awards: Array<{ kind: 'player' | 'coach' | 'young'; shortlist: Nominee[] }>;
  team: DreamPick[];
  /** The world's other honours: the top scorer, the most improved, the youngest regular. */
  extras?: SeasonAwardLine[];
}

const KIND_NAMES: Readonly<Record<AccoladeKind, string>> = {
  player: 'Player of the Year', coach: 'Coach of the Year', young: 'Young Player of the Year', team: 'Team of the Season',
};

/** An award's full name: "World Player of the Year", "Italy Superliga Coach of the Year". */
export function accoladeTitle(world: World, a: { kind: AccoladeKind; scope: number | 'world' }): string {
  if (a.scope === 'world') return a.kind === 'team' ? 'World Team of the Year' : `World ${KIND_NAMES[a.kind]}`;
  return `${world.competitions[a.scope]?.name ?? 'League'} ${KIND_NAMES[a.kind]}`;
}

/** The oldest a player can be for a young player's award, in the year the season ends. */
const YOUNG_AGE = 21;

// ---- Expectations ----------------------------------------------------------------------

/** How strong a squad is: its best seven, by current ability. */
function squadStrength(world: World, clubId: number): number {
  const club = world.clubs[clubId];
  if (club === undefined) return 0;
  const best = club.players.map((p) => world.players.currentAbility[p]).sort((a, b) => b - a).slice(0, 7);
  return best.length > 0 ? best.reduce((s, x) => s + x, 0) / best.length : 0;
}

/** As a season starts: where every club should finish its league, on the squad it has — what its coach is judged against. */
export function noteExpectations(world: World): void {
  const ranks: Record<number, number> = {};
  for (const comp of world.competitions) {
    if (comp.kind !== 'league' || comp.participants.length === 0) continue;
    [...comp.participants].sort((a, b) => squadStrength(world, b) - squadStrength(world, a)).forEach((c, i) => { ranks[c] = i + 1; });
  }
  world.expectedFinish = { season: world.season, ranks };
}

function expectedRank(world: World, comp: Competition, clubId: number): number {
  const noted = world.expectedFinish?.season === world.season ? world.expectedFinish.ranks[clubId] : undefined;
  if (noted !== undefined) return noted;
  // A save from before expectations were noted: the clubs' standing will do.
  const order = [...comp.participants].sort((a, b) => (world.clubs[b]?.reputation ?? 0) - (world.clubs[a]?.reputation ?? 0));
  return order.indexOf(clubId) + 1;
}

/** How strong a league is, 0-1: its clubs' standing. */
function leagueLevel(world: World, comp: Competition): number {
  const reps = comp.participants.map((c) => world.clubs[c]?.reputation ?? 0);
  return reps.length > 0 ? reps.reduce((s, x) => s + x, 0) / reps.length / 10000 : 0;
}

// ---- Who coached it ------------------------------------------------------------------------

/** A club's coach as the season ends: a staff id, -1 for the manager, or null with nobody in charge. */
function coachOf(world: World, clubId: number): number | null {
  if (clubId === world.userClubId) return -1;
  const club = world.clubs[clubId];
  const coach = club !== undefined ? headCoachOf(world, club) : undefined;
  return coach !== undefined ? coach.id : null;
}

// ---- The judging ---------------------------------------------------------------------------

interface Candidate extends Nominee {
  score: number;
}

/** The three best, best first. */
function top3(candidates: Candidate[]): Nominee[] {
  return [...candidates].sort((a, b) => b.score - a.score).slice(0, 3)
    .map(({ p, coach, clubId, value }) => ({ ...(p !== undefined ? { p } : {}), ...(coach !== undefined ? { coach } : {}), clubId, value }));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** What each club won this season, by club. */
function titlesBy(world: World, record: SeasonRecord): Map<number, Competition[]> {
  const out = new Map<number, Competition[]>();
  for (const { competitionId, winner } of record.champions) {
    const comp = world.competitions[competitionId];
    if (comp === undefined || comp.kind === 'international') continue;
    out.set(winner, [...(out.get(winner) ?? []), comp]);
  }
  return out;
}

/** What a title is worth to a coach's or a player's year. */
function titleWorth(comp: Competition): number {
  switch (comp.kind) {
    case 'clubworld': return 0.45;
    case 'continental': return 0.6;
    case 'league': return comp.tier <= 1 ? 0.45 : 0.25;
    case 'cup': return 0.2;
    case 'supercup': return 0.05;
    default: return 0;
  }
}

/** The players of a league, judged on their season in it. */
function leaguePlayers(world: World, comp: Competition, standings: number[], young: boolean): Candidate[] {
  const store = world.players;
  return regularsOf(linesOf(world, comp))
    .filter(([p]) => !young || world.year - store.birthYear[p] <= YOUNG_AGE)
    .map(([p, l]) => {
      const finish = standings.indexOf(store.clubId[p]);
      const avg = averageRating(l);
      return {
        p, clubId: store.clubId[p],
        score: avg + 0.015 * l.mvps + (finish === 0 ? 0.2 : finish === 1 ? 0.1 : finish === 2 ? 0.05 : 0),
        value: [`${avg.toFixed(2)} average`, l.mvps > 0 ? plural(l.mvps, 'MVP') : '', finish === 0 ? 'champions' : '']
          .filter((x) => x !== '').join(' · '),
      };
    });
}

/** The coaches of a league, judged on where their sides finished against where they should have, and on what they won. */
function leagueCoaches(world: World, comp: Competition, standings: number[], titles: Map<number, Competition[]>): Candidate[] {
  const out: Candidate[] = [];
  const n = Math.max(2, standings.length);
  standings.forEach((clubId, i) => {
    const coach = coachOf(world, clubId);
    if (coach === null) return;
    const expected = expectedRank(world, comp, clubId);
    const won = (titles.get(clubId) ?? []).filter((c) => c.id !== comp.id);
    const score = (expected - (i + 1)) / (n - 1) + (i === 0 ? 0.45 : i === 1 ? 0.15 : 0) +
      won.reduce((s, c) => s + titleWorth(c), 0);
    out.push({
      coach, clubId, score,
      value: [`${i === 0 ? 'Champions' : ordinal(i + 1)}, expected ${ordinal(expected)}`, ...won.map((c) => `${c.name} winners`)].join(' · '),
    });
  });
  return out;
}

/** A league's awards, from its season. */
function leagueNight(world: World, comp: Competition, titles: Map<number, Competition[]>): AwardsNight | null {
  const standings = finalStandingsOrder(comp);
  if (standings.length === 0 || !comp.table.some((r) => r.played > 0)) return null;
  const awards: AwardsNight['awards'] = [];
  const players = top3(leaguePlayers(world, comp, standings, false));
  const coaches = top3(leagueCoaches(world, comp, standings, titles));
  const young = top3(leaguePlayers(world, comp, standings, true));
  if (players.length > 0) awards.push({ kind: 'player', shortlist: players });
  if (coaches.length > 0) awards.push({ kind: 'coach', shortlist: coaches });
  if (young.length > 0) awards.push({ kind: 'young', shortlist: young });
  if (awards.length === 0) return null;
  return { scope: comp.id, season: world.season, awards, team: teamOf(world, regularsOf(linesOf(world, comp))) };
}

/**
 * The world's awards: the top flights' players and coaches, each judged at the
 * level he did it. A player is measured against his own league — how far above
 * its regulars he stood, since a league whose every rally is played out rates
 * its players more widely than one whose results are only summed up — then
 * lifted by how strong that league is, and by what his side won.
 */
function worldNight(world: World, leagues: Competition[], titles: Map<number, Competition[]>): AwardsNight | null {
  const store = world.players;
  const level = new Map(leagues.map((c) => [c.id, leagueLevel(world, c)]));
  const best = Math.max(0.01, ...level.values());

  interface Judged extends Candidate { pos: Position; rating: number; young: boolean }
  const players: Judged[] = [];
  for (const comp of leagues) {
    const regulars = regularsOf(linesOf(world, comp));
    if (regulars.length < 7) continue;
    const ratings = regulars.map(([, l]) => averageRating(l));
    const mean = ratings.reduce((s, x) => s + x, 0) / ratings.length;
    const sd = Math.max(0.1, Math.sqrt(ratings.reduce((s, x) => s + (x - mean) ** 2, 0) / ratings.length));
    const q = (level.get(comp.id) ?? 0) / best;
    for (const [p, l] of regulars) {
      const clubId = store.clubId[p];
      const avg = averageRating(l);
      const won = titles.get(clubId) ?? [];
      players.push({
        p, clubId, pos: store.position[p] as Position, rating: avg, young: world.year - store.birthYear[p] <= YOUNG_AGE,
        score: (avg - mean) / sd + 1.5 * q + 0.02 * l.mvps + won.reduce((t, c) => t + titleWorth(c), 0),
        value: [`${avg.toFixed(2)} average in ${l.apps} ${comp.name} matches`,
          ...won.filter((c) => c.kind !== 'supercup').map((c) => `${c.name} winners`)].join(' · '),
      });
    }
  }

  // A coach is judged on where his side finished against where it should have, as much as the league is worth; and on what it won.
  const coaches: Candidate[] = [];
  for (const comp of leagues) {
    const q = (level.get(comp.id) ?? 0) / best;
    const standings = finalStandingsOrder(comp);
    const n = Math.max(2, standings.length);
    standings.forEach((clubId, i) => {
      const coach = coachOf(world, clubId);
      if (coach === null) return;
      const expected = expectedRank(world, comp, clubId);
      const won = (titles.get(clubId) ?? []).filter((c) => c.id !== comp.id);
      const score = ((expected - (i + 1)) / (n - 1)) * (0.3 + 0.5 * q) + (i === 0 ? 0.3 + 0.6 * q : 0) +
        won.reduce((s, c) => s + (c.kind === 'continental' ? 0.8 : c.kind === 'clubworld' ? 0.5 : c.kind === 'cup' ? 0.15 : 0.03), 0);
      coaches.push({
        coach, clubId, score,
        value: [`${i === 0 ? `${comp.name} champions` : `${ordinal(i + 1)} in the ${comp.name}`}, expected ${ordinal(expected)}`,
          ...won.filter((c) => c.kind !== 'supercup').map((c) => `${c.name} winners`)].join(' · '),
      });
    });
  }

  const awards: AwardsNight['awards'] = [];
  const shortlist = top3(players);
  if (shortlist.length > 0) awards.push({ kind: 'player', shortlist });
  const coachList = top3(coaches);
  if (coachList.length > 0) awards.push({ kind: 'coach', shortlist: coachList });
  const youngList = top3(players.filter((c) => c.young));
  if (youngList.length > 0) awards.push({ kind: 'young', shortlist: youngList });
  if (awards.length === 0) return null;

  // The World Team of the Year: the best judged at each position.
  const team: DreamPick[] = [];
  const shape: Array<[Position, number]> = [
    [Position.Setter, 1], [Position.OutsideHitter, 2], [Position.MiddleBlocker, 2], [Position.Opposite, 1], [Position.Libero, 1],
  ];
  for (const [pos, n] of shape) {
    players.filter((c) => c.pos === pos).sort((a, b) => b.score - a.score).slice(0, n)
      .forEach((c) => team.push({ pos, p: c.p!, clubId: c.clubId, rating: c.rating }));
  }
  return { scope: 'world', season: world.season, awards, team };
}

// ---- The night ----------------------------------------------------------------------------

/** Put a night's winners on the record. */
function record(world: World, night: AwardsNight): void {
  const book = (world.accolades ??= []);
  for (const a of night.awards) {
    const w = a.shortlist[0];
    book.push({ kind: a.kind, scope: night.scope, season: night.season, clubId: w.clubId, ...(w.p !== undefined ? { p: w.p } : {}), ...(w.coach !== undefined ? { coach: w.coach } : {}) });
  }
  for (const d of night.team) book.push({ kind: 'team', scope: night.scope, season: night.season, p: d.p, clubId: d.clubId, pos: d.pos });
}

/** A nominee's name — "you" for the manager. */
function nomineeName(world: World, n: Nominee): string {
  if (n.p !== undefined) return world.players.fullName(n.p);
  if (n.coach === -1) return `${world.manager.firstName} ${world.manager.lastName}`;
  const s = n.coach !== undefined ? world.staff[n.coach] : undefined;
  return s !== undefined ? `${s.firstName} ${s.lastName}` : '—';
}

/** The night, to the manager's inbox. */
function announce(world: World, night: AwardsNight, from: string, name: string): void {
  const winner = (kind: AwardsNight['awards'][number]['kind']): Nominee | undefined => night.awards.find((a) => a.kind === kind)?.shortlist[0];
  const player = winner('player');
  const coach = winner('coach');
  const you = night.awards.some((a) => a.kind === 'coach' && a.shortlist[0].coach === -1);
  const shortlisted = night.awards.some((a) => a.kind === 'coach' && a.shortlist.some((n) => n.coach === -1));
  const ours = night.team.filter((d) => d.clubId === world.userClubId).map((d) => world.players.fullName(d.p));
  const kind = night.scope === 'world' ? 'World ' : '';
  const body = [
    player !== undefined ? `${nomineeName(world, player)} is the ${kind}Player of the Year.` : '',
    you ? `And the ${kind}Coach of the Year is you.`
      : coach !== undefined ? `${nomineeName(world, coach)} is the ${kind}Coach of the Year${shortlisted ? ' — you were on the shortlist' : ''}.` : '',
    ours.length > 0 ? `From your squad, ${ours.join(', ')} ${ours.length === 1 ? 'makes' : 'make'} the ${night.scope === 'world' ? 'World Team of the Year' : 'Team of the Season'}.` : '',
  ].filter((x) => x !== '').join(' ');
  postMessage(world, {
    category: 'awards',
    from,
    clubId: player?.clubId,
    subject: you ? `${name}: you are the ${kind}Coach of the Year!` : `${name}: ${player !== undefined ? `${nomineeName(world, player)} is ${kind}Player of the Year` : 'the winners'}`,
    body,
    awardsNight: night,
  });
}

/**
 * The season's awards, as it ends — after the titles are settled, before
 * anyone moves club: every top-flight league's and the manager's own, on the
 * record, and his league's and the world's to his inbox.
 */
export function seasonAwards(world: World, seasonRecord: SeasonRecord, extras: SeasonAwardLine[]): void {
  const titles = titlesBy(world, seasonRecord);
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId]?.leagueId : undefined;
  const leagues = world.competitions.filter((c) => c.kind === 'league' && c.participants.length > 0 && (c.tier <= 1 || c.id === own));
  for (const comp of leagues) {
    const night = leagueNight(world, comp, titles);
    if (night === null) continue;
    record(world, night);
    if (comp.id === own) announce(world, night, comp.organizer ?? comp.name, `${comp.name} awards`);
  }
  const top = leagues.filter((c) => c.tier <= 1);
  const night = worldNight(world, top, titles);
  if (night === null) return;
  night.extras = extras;
  record(world, night);
  // The World Player of the Year is the season's, for the record books.
  const best = night.awards.find((a) => a.kind === 'player')?.shortlist[0];
  if (best?.p !== undefined) seasonRecord.playerOfTheYear = best.p;
  const young = night.awards.find((a) => a.kind === 'young')?.shortlist[0];
  if (young?.p !== undefined) seasonRecord.youngPlayerOfTheYear = young.p;
  const y = world.startYear + world.season;
  announce(world, night, 'FIVB', `World awards ${y}/${String(y + 1).slice(2)}`);
}

/** A player's awards, newest first. */
export function playerAccolades(world: World, p: number): Accolade[] {
  return (world.accolades ?? []).filter((a) => a.p === p).sort((a, b) => b.season - a.season);
}

/** A coach's awards — a staff id, or -1 for the manager — newest first. */
export function coachAccolades(world: World, coach: number): Accolade[] {
  return (world.accolades ?? []).filter((a) => a.kind === 'coach' && a.coach === coach).sort((a, b) => b.season - a.season);
}

