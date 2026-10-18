/**
 * The match preview: the day before each of the manager's matches, the analysts' numbers and the
 * fans' arguments, in his inbox.
 *
 * The numbers are the match played four hundred times over in the background engine — the two
 * sides as they would line up, at home or away — so each side's chance of winning, and of every
 * result from 3-0 to 0-3, is what the game itself makes of it. Under them the fans have their say:
 * both sides' supporters and a neutral or two each call a score — partisan, as fans are, the
 * favourites' cocky, the underdogs' hoping or fearing the worst — with a poll of who they back.
 * When the match has been played, the thread carries on: whoever called it lets everyone know.
 */

import { Rng } from '../core/rng.ts';
import type { Club } from '../model/club.ts';
import { MatchFormat } from '../match/engine.ts';
import { pickLineup } from '../season/seasonEngine.ts';
import { quickScore } from '../season/quickSim.ts';
import { fanName, handle, type FanComment, type FanMood } from './fans.ts';
import { postMessage } from './inbox.ts';
import { NATIONS } from './nations.ts';
import type { Fixture, World } from './world.ts';

/** A fan's say before the match, and the score they called — the home side's sets first. */
export interface PreviewComment extends FanComment {
  call: [number, number];
}

export interface MatchPreview {
  fixtureId: number;
  home: number;
  away: number;
  /** The home side's chance of winning, %. */
  homeWin: number;
  /** Each result's chance, %, the home side's sets first: "3-1" → 27. */
  results: Array<{ score: [number, number]; pct: number }>;
  /** The fans' poll: the share backing the home side, %. */
  poll: number;
  /** Each side's last five competitive results, the latest first: true a win. */
  form: [boolean[], boolean[]];
  comments: PreviewComment[];
}

/** How many times the match is played over. */
const RUNS = 400;

/** A club's last competitive results before a day, the latest first. */
function formOf(world: World, clubId: number, day: number, n = 5): boolean[] {
  const out: Array<[number, boolean]> = [];
  for (const f of world.fixtures) {
    if (!f.played || f.day >= day || (f.home !== clubId && f.away !== clubId)) continue;
    const kind = world.competitions[f.competitionId]?.kind;
    if (kind === 'friendly' || kind === 'international') continue;
    out.push([f.day, (f.home === clubId) === (f.homeSets > f.awaySets)]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, n).map(([, w]) => w);
}

/** The best fit player of a squad, for the fans to talk about. */
function starOf(world: World, club: Club): number {
  const store = world.players;
  return [...club.players].filter((p) => store.injuryDaysLeft[p] === 0)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0] ?? -1;
}

/** The match played over in the background engine: the home side's chance, and each result's. */
export function oddsFor(world: World, f: Fixture): { homeWin: number; results: MatchPreview['results'] } | null {
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  if (home === undefined || away === undefined) return null;
  const store = world.players;
  const h = pickLineup(store, home);
  const a = pickLineup(store, away);
  const rng = new Rng(`odds:${f.id}`);
  const counts = new Map<string, number>();
  let wins = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = quickScore(store, h, a, f.format, rng, !f.neutralVenue);
    if (r.homeSets > r.awaySets) wins++;
    const key = `${r.homeSets}-${r.awaySets}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = f.format === MatchFormat.BestOf5 ? 3 : f.format === MatchFormat.BestOf3 ? 2 : 1;
  const results: MatchPreview['results'] = [];
  for (let lost = 0; lost < best; lost++) results.push({ score: [best, lost], pct: 0 });
  for (let won = best - 1; won >= 0; won--) results.push({ score: [won, best], pct: 0 });
  for (const r of results) r.pct = Math.round(((counts.get(`${r.score[0]}-${r.score[1]}`) ?? 0) / RUNS) * 100);
  return { homeWin: Math.round((wins / RUNS) * 100), results };
}

// ---- The fans ----------------------------------------------------------------------------

type Say = { mood: FanMood; text: string };

/** What a fan says calling a score — "us" their side — given how they rate their side's chances. */
function callLine(rng: Rng, won: boolean, close: boolean, favourites: boolean): Say {
  if (won && close) {
    return rng.pick<Say>([
      { mood: 'happy', text: 'Five sets, nails bitten, but we nick it {score}.' },
      { mood: 'happy', text: 'It goes the distance. {score} to us, {star} wins the tiebreak on his own.' },
    ]);
  }
  if (won && favourites) {
    return rng.pick<Say>([
      { mood: 'delighted', text: '{score} to us. {them} will not live with {star}.' },
      { mood: 'happy', text: 'Three points, no drama. I am calling {score}.' },
      { mood: 'delighted', text: '{score}. Book it.' },
      { mood: 'happy', text: 'If we serve like we can, it is {score}, easy.' },
    ]);
  }
  if (won) {
    return rng.pick<Say>([
      { mood: 'happy', text: 'Everyone is writing us off. {score} to us, you heard it here first.' },
      { mood: 'happy', text: 'Upset on the cards. {score}, and {star} is man of the match.' },
      { mood: 'happy', text: 'Gut feeling: {score}. Our block will drive {danger} mad.' },
    ]);
  }
  if (close) {
    return rng.pick<Say>([
      { mood: 'worried', text: '{score}. We will push them all the way and fall short, as usual.' },
      { mood: 'neutral', text: 'A point at least: {score}. I would take that.' },
    ]);
  }
  return rng.pick<Say>([
    { mood: 'worried', text: 'Hate to say it: {score} to them. {danger} is just too good.' },
    { mood: 'worried', text: 'Being realistic, {score}. Their serve is going to hurt us.' },
    { mood: 'neutral', text: '{score}. We take a set off them, nothing more.' },
  ]);
}

/** What the fans call a club in a match: its nickname, or its full name when both sides would go by the same one. */
export function fanNameIn(club: Club, other: Club): string {
  return fanName(club) === fanName(other) ? club.name : fanName(club);
}

/** A score from a fan's side's point of view: "3-1". */
const said = (mine: number, theirs: number): string => `${mine}-${theirs}`;

/**
 * The fans' thread: three of each side and a neutral, each calling a score — drawn from the
 * analysts' odds, leant towards their own side.
 */
function fansThread(world: World, f: Fixture, results: MatchPreview['results'], homeWin: number): PreviewComment[] {
  const home = world.clubs[f.home]!;
  const away = world.clubs[f.away]!;
  const store = world.players;
  const rng = new Rng(`fans:${f.id}`);
  const stars = [starOf(world, home), starOf(world, away)];
  const name = (p: number): string => (p >= 0 ? store.surname(p) : 'their best man');
  const out: PreviewComment[] = [];
  const sides: Array<0 | 1 | 2> = [0, 1, 0, 1, 0, 1, 2];
  for (const side of sides) {
    // A fan's call: the odds, with a thumb on the scale for their own side.
    const weights = results.map((r) => {
      const homeWon = r.score[0] > r.score[1];
      const lean = side === 2 ? 1 : (side === 0) === homeWon ? 2.2 : 1;
      return Math.max(0.5, r.pct) * lean;
    });
    const call = results[rng.weightedIndex(weights)].score;
    let text: string;
    let mood: FanMood;
    let clubId: number | undefined;
    let nation: number | undefined;
    if (side === 2) {
      const fav = homeWin >= 50 ? home : away;
      const dog = homeWin >= 50 ? away : home;
      const s = rng.pick<Say>([
        { mood: 'neutral', text: 'Tough one to call. I will say {score} to {home}.' },
        { mood: 'neutral', text: '{fav} should do it, but never write off {dog}. {score}.' },
        { mood: 'happy', text: 'Neutral here, just want a five-setter. {score}.' },
      ]);
      text = s.text
        .replaceAll('{score}', said(call[0], call[1]))
        .replaceAll('{home}', fanNameIn(home, away)).replaceAll('{fav}', fanNameIn(fav, dog)).replaceAll('{dog}', fanNameIn(dog, fav));
      mood = s.mood;
      nation = home.nation;
    } else {
      const mine = side === 0 ? call[0] : call[1];
      const theirs = side === 0 ? call[1] : call[0];
      const us = side === 0 ? home : away;
      const them = side === 0 ? away : home;
      const favourites = side === 0 ? homeWin >= 55 : homeWin <= 45;
      const s = callLine(rng, mine > theirs, Math.min(mine, theirs) === Math.max(mine, theirs) - 1 && Math.max(mine, theirs) >= 3, favourites);
      text = s.text
        .replaceAll('{score}', said(mine, theirs))
        .replaceAll('{them}', fanNameIn(them, us)).replaceAll('{us}', fanNameIn(us, them))
        .replaceAll('{star}', name(stars[side])).replaceAll('{danger}', name(stars[side === 0 ? 1 : 0]));
      mood = s.mood;
      clubId = us.id;
    }
    out.push({
      handle: handle(rng, side === 2 ? (NATIONS[home.nation] !== undefined ? home.nation : 0) : (side === 0 ? home : away).nation, side === 2 ? undefined : side === 0 ? home : away),
      ...(clubId !== undefined ? { clubId } : {}),
      ...(nation !== undefined ? { nation } : {}),
      text, mood, likes: rng.int(1, 140), call,
    });
  }
  return out.sort((a, b) => b.likes - a.likes);
}

/** After the match: whoever called it says so, and both sides have their word on the result. */
export function previewReplies(world: World, pv: MatchPreview): FanComment[] {
  const f = world.fixtures[pv.fixtureId];
  const home = world.clubs[pv.home];
  const away = world.clubs[pv.away];
  if (f === undefined || !f.played || home === undefined || away === undefined) return [];
  const rng = new Rng(`after:${f.id}`);
  const store = world.players;
  const homeWon = f.homeSets > f.awaySets;
  const winner = homeWon ? home : away;
  const loser = homeWon ? away : home;
  const out: FanComment[] = [];
  const right = pv.comments.filter((c) => c.call[0] === f.homeSets && c.call[1] === f.awaySets);
  for (const c of right.slice(0, 2)) {
    const mine = c.clubId === away.id ? `${f.awaySets}-${f.homeSets}` : `${f.homeSets}-${f.awaySets}`;
    out.push({
      handle: c.handle, ...(c.clubId !== undefined ? { clubId: c.clubId } : {}), ...(c.nation !== undefined ? { nation: c.nation } : {}),
      text: rng.pick([`Called it. ${mine}. You are welcome.`, `${mine}, exactly as I said. Somebody give me a job.`, `Told you all: ${mine}.`]),
      mood: 'delighted', likes: rng.int(20, 180),
    });
  }
  const mvp = f.mvp >= 0 ? store.surname(f.mvp) : 'the whole team';
  out.push({
    handle: handle(rng, winner.nation, winner), clubId: winner.id, mood: 'delighted', likes: rng.int(10, 150),
    text: rng.pick([`What a night. ${mvp} was unreal.`, `Get in! ${fanNameIn(loser, winner)} never had an answer.`, `Three points and a performance. Proud of this team.`])
      .replace('Three points', f.homeSets + f.awaySets === 5 ? 'Two points' : 'Three points'),
  });
  out.push({
    handle: handle(rng, loser.nation, loser), clubId: loser.id, mood: f.homeSets + f.awaySets === 5 ? 'worried' : 'angry', likes: rng.int(5, 120),
    text: rng.pick([`Not good enough. ${mvp} did exactly what we feared.`, 'Our passing let us down again. Something has to change.', 'Heads up. Long season, we go again.']),
  });
  if (right.length === 0) {
    out.push({
      handle: handle(rng, home.nation, undefined), nation: home.nation, mood: 'neutral', likes: rng.int(1, 60),
      text: `Not one of you called ${f.homeSets}-${f.awaySets}. Volleyball, eh.`,
    });
  }
  return out;
}

// ---- The preview -------------------------------------------------------------------------

/** The day before each of the manager's competitive matches: the preview, to his inbox. */
export function matchPreviews(world: World, day: number): void {
  if (world.userClubId < 0) return;
  for (const id of world.fixturesByDay.get(day) ?? []) {
    const f = world.fixtures[id];
    if (f === undefined || f.played || (f.home !== world.userClubId && f.away !== world.userClubId)) continue;
    const kind = world.competitions[f.competitionId]?.kind;
    if (kind === undefined || kind === 'friendly' || kind === 'international') continue;
    if (world.messages.slice(-60).some((m) => m.preview?.fixtureId === f.id)) continue;
    const odds = oddsFor(world, f);
    const home = world.clubs[f.home];
    const away = world.clubs[f.away];
    if (odds === null || home === undefined || away === undefined) continue;
    const rng = new Rng(`poll:${f.id}`);
    // The poll leans to the home crowd, who vote louder.
    const poll = Math.max(6, Math.min(94, Math.round(odds.homeWin + 6 + rng.gaussian(0, 6))));
    const preview: MatchPreview = {
      fixtureId: f.id, home: f.home, away: f.away, homeWin: odds.homeWin, results: odds.results, poll,
      form: [formOf(world, f.home, f.day), formOf(world, f.away, f.day)],
      comments: fansThread(world, f, odds.results, odds.homeWin),
    };
    const fav = odds.homeWin >= 50 ? home : away;
    const pct = odds.homeWin >= 50 ? odds.homeWin : 100 - odds.homeWin;
    const likeliest = [...odds.results].sort((a, b) => b.pct - a.pct)[0];
    postMessage(world, {
      category: 'matchday',
      from: 'Match analysts',
      subject: `Preview: ${home.name} v ${away.name}`,
      body: pct <= 55
        ? `Too close to call: the analysts give ${fav.name} ${pct}%. The likeliest result: ${likeliest.score[0]}-${likeliest.score[1]}. The fans have had their say below.`
        : `The analysts make ${fav.name} favourites, ${pct}% to win. The likeliest result: ${likeliest.score[0]}-${likeliest.score[1]}. The fans have had their say below.`,
      clubId: world.userClubId,
      fixtureId: f.id,
      preview,
    });
  }
}
