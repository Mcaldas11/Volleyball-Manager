/**
 * The social feed: everything the volleyball world says in one timeline. The journalists post the
 * stories, the fans reply under them; the manager's club posts its results; its players post after a
 * big night or a hard one, and a new signing says hello. Built from what the save already keeps —
 * the news, the fixtures — and seeded by it, so it reads the same every time and costs nothing.
 */

import { fanComments, type FanComment } from './fans.ts';
import type { NewsItem } from './news.ts';
import { hash01 } from './offerStance.ts';
import type { World } from './world.ts';

export interface SocialPost {
  key: string;
  day: number;
  kind: 'press' | 'club' | 'player';
  author: string;
  handle: string;
  /** The club, or the player, it is from or about. */
  clubId?: number;
  p?: number;
  text: string;
  likes: number;
  reposts: number;
  replies: FanComment[];
}

/** How far back the feed goes, days. */
const FEED_DAYS = 45;

const OUTLETS = [
  ['Volley Wire', '@volleywire'], ['Net Insider', '@netinsider'], ['Spike Report', '@spikereport'], ['Block & Dig', '@blockanddig'],
] as const;

const tag = (s: string): string => s.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

function count(seed: number, k: number, base: number): number {
  return Math.round(base * (0.3 + hash01(seed, k) * 1.7));
}

function fromStory(world: World, n: NewsItem): SocialPost {
  const [author, handle] = OUTLETS[Math.floor(hash01(n.id, 3) * OUTLETS.length)];
  const big = n.kind === 'title' || n.kind === 'transfer' || n.kind === 'coach' ? 3 : 1;
  return {
    key: `n${n.id}`, day: n.day, kind: 'press', author, handle, clubId: n.clubId, p: n.playerIdx,
    text: n.headline, likes: count(n.id, 1, 260 * big), reposts: count(n.id, 2, 45 * big),
    replies: fanComments(world, n).slice(0, 2),
  };
}

const WIN_POSTS = [
  'What a night. Proud of this group. 💪', 'Three points. On to the next one.', 'That’s what we work for. Thank you for the noise tonight!',
  'Big team performance. Recover, reset, go again.',
];
const LOSS_POSTS = [
  'Not our night. We learn and we come back stronger.', 'Hurts. Back to the gym tomorrow.', 'Sorry to our fans. We owe you one.',
];

/** The feed, newest first: the stories, the manager's club's results, its players. */
export function socialFeed(world: World, filter: 'all' | 'club' = 'all'): SocialPost[] {
  const from = world.day - FEED_DAYS;
  const store = world.players;
  const clubId = world.userClubId;
  const club = world.clubs[clubId];
  const posts: SocialPost[] = [];
  for (const n of world.news) {
    if (n.day < from) continue;
    if (filter === 'club' && n.clubId !== clubId && n.otherClubId !== clubId) continue;
    posts.push(fromStory(world, n));
  }
  if (club !== undefined) {
    const clubHandle = `@${tag(club.shortName)}official`;
    for (const f of world.fixtures) {
      if (!f.played || f.day < from || f.day > world.day || (f.home !== clubId && f.away !== clubId)) continue;
      const home = f.home === clubId;
      const won = home ? f.homeSets > f.awaySets : f.awaySets > f.homeSets;
      const opp = world.clubs[home ? f.away : f.home];
      const score = home ? `${f.homeSets}-${f.awaySets}` : `${f.awaySets}-${f.homeSets}`;
      posts.push({
        key: `r${f.id}`, day: f.day, kind: 'club', author: club.name, handle: clubHandle, clubId,
        text: `FULL TIME | ${club.shortName} ${score} ${opp?.shortName ?? ''} ${won ? '✅' : ''}\n${f.setScores.map(([a, b]) => (home ? `${a}-${b}` : `${b}-${a}`)).join(' · ')}`,
        likes: count(f.id, 5, won ? 900 : 400), reposts: count(f.id, 6, won ? 120 : 40), replies: [],
      });
      // The man of the match, if he is ours — or the captain's word after a defeat.
      const mvp = f.mvp >= 0 && store.clubId[f.mvp] === clubId ? f.mvp : -1;
      const speaker = won ? mvp : club.captain ?? club.players[0] ?? -1;
      if (speaker < 0 || hash01(f.id, 9) < 0.35) continue;
      const lines = won ? WIN_POSTS : LOSS_POSTS;
      posts.push({
        key: `p${f.id}`, day: f.day, kind: 'player', author: store.fullName(speaker), handle: `@${tag(store.fullName(speaker))}`,
        clubId, p: speaker, text: lines[Math.floor(hash01(f.id, 10) * lines.length)],
        likes: count(f.id, 11, 1500), reposts: count(f.id, 12, 90), replies: [],
      });
    }
    // A new signing says hello.
    for (const n of world.news) {
      if (n.day < from || n.kind !== 'transfer' || n.playerIdx === undefined || store.clubId[n.playerIdx] !== clubId) continue;
      posts.push({
        key: `s${n.id}`, day: n.day, kind: 'player', author: store.fullName(n.playerIdx), handle: `@${tag(store.fullName(n.playerIdx))}`,
        clubId, p: n.playerIdx, text: `Proud to join ${club.name}. Let’s make it a season to remember! 🏐`,
        likes: count(n.id, 13, 2200), reposts: count(n.id, 14, 150), replies: [],
      });
    }
  }
  return posts.sort((a, b) => b.day - a.day || (a.key < b.key ? 1 : -1));
}
