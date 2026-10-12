/**
 * One-to-one talks: the manager and one of his players.
 *
 * Praise a man in form and he grows; praise one who knows he is playing badly
 * and it rings hollow. Criticism lands with a professional who has had a bad
 * spell and enrages one who has been playing well — or who doesn't take it
 * well from anyone. A word of encouragement lifts one who is down. And a
 * promise of more games buys goodwill now and is called in later: kept, he
 * is happier for it; broken, he wants out.
 *
 * A player kept unhappy long enough asks to leave. The manager can list him,
 * promise him the games he wants, or refuse — and refusing has its cost.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { postMessage } from './inbox.ts';
import { contractEndSeason, type World } from './world.ts';

export type ChatTopic = 'praise' | 'criticise' | 'encourage' | 'promise' | 'mood';

export const CHAT_TOPICS: readonly ChatTopic[] = ['praise', 'criticise', 'encourage', 'promise', 'mood'];

export const CHAT_NAMES: Readonly<Record<ChatTopic, string>> = {
  praise: 'Praise his form',
  criticise: 'Criticise his form',
  encourage: 'Lift him after a bad spell',
  promise: 'Promise him more games',
  mood: 'Ask how he is',
};

export const CHAT_HINTS: Readonly<Record<ChatTopic, string>> = {
  praise: 'Best when he has been playing well',
  criticise: 'Best when he has been poor — and takes it well',
  encourage: 'Best when he is down, or out of form',
  promise: 'Regular games within eight weeks — keep your word',
  mood: 'What is on his mind',
};

/** Days between one talk and the next with the same player. */
export const CHAT_COOLDOWN = 14;
/** How long the manager has to keep a promise of games, in days. */
const PROMISE_DAYS = 56;
/** Playing time that counts as keeping it, 0-100 — a regular's share. */
const PROMISE_KEPT = 45;
/** Weeks a player stays unhappy before he asks to leave. */
const UNHAPPY_WEEKS = 4;
/** Days before he asks again after asking once. */
const ASK_AGAIN_DAYS = 120;

/** A promise the manager has made a player. */
export interface PlayerPromise {
  p: number;
  clubId: number;
  madeOn: number;
  due: number;
}

/** A player's request to leave, and where it stands. */
export interface TransferRequest {
  day: number;
  status: 'open' | 'listed' | 'promised' | 'refused';
}

export interface ChatResult {
  ok: boolean;
  /** How it went, told: for a notice or the record. */
  text: string;
  /** What he says back, in his own words. */
  reply: string;
  morale: number;
}

/** What the manager says, for each topic — the line in the conversation. */
export const CHAT_LINES: Readonly<Record<ChatTopic, string>> = {
  praise: 'You\u2019ve been excellent lately. Keep it up.',
  criticise: 'Your form isn\u2019t good enough. I expect more from you.',
  encourage: 'Forget the last few games \u2014 I still believe in you.',
  promise: 'You\u2019ll get more games. You have my word.',
  mood: 'How are things? Anything on your mind?',
};

/** How he opens when the manager calls him in: his mood says it. */
export function chatOpening(world: World, p: number): string {
  const store = world.players;
  const morale = store.morale[p];
  if (world.transferRequests?.[p]?.status === 'refused') return 'If this is about me staying — I haven\u2019t changed my mind.';
  if (morale >= 75) return 'Boss! You wanted to see me?';
  if (morale >= 50) return 'You wanted a word?';
  if (morale >= 30) return 'What is it?';
  return '...Yes?';
}

/** His recent form, as his last few match ratings say it: null with none to go on. */
export function recentForm(world: World, p: number): number | null {
  const form = world.ratingForm.get(p) ?? [];
  return form.length < 2 ? null : form.reduce((s, r) => s + r, 0) / form.length;
}

/** Why the manager can't have this talk with him now, or null if he can. */
export function chatBlock(world: World, club: Club, p: number, topic: ChatTopic): string | null {
  const store = world.players;
  if (!club.players.includes(p)) return 'He is not one of your players.';
  const last = world.playerChats?.[p];
  if (topic !== 'mood' && last !== undefined && world.day - last < CHAT_COOLDOWN) {
    return `You spoke to him ${world.day - last === 0 ? 'today' : `${world.day - last} days ago`} — give it a while.`;
  }
  if (topic === 'promise') {
    if ((world.promises ?? []).some((x) => x.p === p)) return 'You have already promised him games.';
    if (store.playingTime[p] >= PROMISE_KEPT) return 'He is playing regularly already.';
  }
  return null;
}

/** Have the talk: how he takes it, and what it does to his morale. */
export function talkToPlayer(world: World, club: Club, p: number, topic: ChatTopic): ChatResult {
  const block = chatBlock(world, club, p, topic);
  const store = world.players;
  const name = store.fullName(p);
  if (block !== null) return { ok: false, text: block, reply: '', morale: 0 };
  const form = recentForm(world, p);
  const good = form !== null && form >= 6.6;
  const poor = form !== null && form <= 5.6;
  const takesIt = store.getAttr(p, 'professionalism') >= 12 || store.getAttr(p, 'temperament') >= 13;
  let morale = 0;
  let text = '';
  let reply = '';
  switch (topic) {
    case 'praise':
      morale = good ? 8 : poor ? -3 : 3;
      text = good ? `${name} is delighted — he knows he has been playing well, and that you have noticed.`
        : poor ? `${name} shrugs it off. He knows he hasn't been at his best, and the praise rings hollow.`
          : `${name} appreciates the word.`;
      reply = good ? 'Thanks, boss. I feel sharp — and it\u2019s good to know you\u2019ve noticed.'
        : poor ? '...Thanks. But I know I haven\u2019t been at my best.'
          : 'Thanks, boss. I appreciate it.';
      break;
    case 'criticise':
      morale = good ? -10 : poor ? (takesIt ? 4 : -8) : (takesIt ? 0 : -5);
      text = good ? `${name} is furious — he has been playing well, and doesn't see what more you want.`
        : poor && takesIt ? `${name} accepts it: he knows he has to do better, and means to.`
          : poor ? `${name} reacts badly. He doesn't take criticism well.`
            : takesIt ? `${name} takes it on board without a word.` : `${name} doesn't think he deserved that.`;
      reply = good ? 'Not good enough? I\u2019ve been one of the best out there. I don\u2019t get it.'
        : poor && takesIt ? 'You\u2019re right. I\u2019ll work on it \u2014 you\u2019ll see a difference.'
          : poor ? 'That\u2019s out of order. I don\u2019t need this.'
            : takesIt ? 'Understood.' : 'I don\u2019t think that\u2019s fair.';
      break;
    case 'encourage': {
      const down = poor || store.morale[p] < 40;
      morale = down ? 6 : 1;
      text = down ? `${name} is grateful — it was what he needed to hear.` : `${name} nods. He wasn't worried.`;
      reply = down ? 'Thanks. I needed that.' : 'I\u2019m fine, boss, honestly.';
      break;
    }
    case 'promise':
      morale = 8;
      (world.promises ??= []).push({ p, clubId: club.id, madeOn: world.day, due: world.day + PROMISE_DAYS });
      text = `${name} is pleased — he'll hold you to it. He expects to be playing regularly within eight weeks.`;
      reply = 'I\u2019ll hold you to that.';
      break;
    case 'mood':
      text = moodOf(world, club, p);
      reply = moodInHisWords(world, p);
      break;
  }
  store.morale[p] = Math.max(0, Math.min(100, store.morale[p] + morale));
  if (topic !== 'mood') (world.playerChats ??= {})[p] = world.day;
  return { ok: true, text, reply, morale };
}

/** What is weighing on a player: each worry, as told about him and as he would say it. */
function worriesOf(world: World, p: number): Array<[string, string]> {
  const store = world.players;
  const out: Array<[string, string]> = [];
  if (store.playingTime[p] < 30 && store.getAttr(p, 'ambition') >= 11) out.push(['he wants to be playing more', 'I want to be playing more']);
  if (contractEndSeason(store.contractUntil[p]) <= world.season) {
    out.push(['his contract is running out and nobody has talked to him about it', 'my contract is running out and nobody has talked to me about it']);
  }
  const promise = (world.promises ?? []).find((x) => x.p === p);
  if (promise !== undefined) {
    const left = Math.max(0, promise.due - world.day);
    out.push([`he is waiting on your promise of games — ${left} days left`, `I\u2019m still waiting on those games you promised me`]);
  }
  if (world.transferRequests?.[p]?.status === 'refused') out.push(['he still wants to leave', 'I still want to leave']);
  return out;
}

/** What is on a player's mind, told. */
export function moodOf(world: World, club: Club, p: number): string {
  const store = world.players;
  const name = store.fullName(p);
  const worries = worriesOf(world, p).map(([told]) => told);
  const mood = store.morale[p] >= 75 ? 'very happy' : store.morale[p] >= 55 ? 'content' : store.morale[p] >= 35 ? 'a little low' : 'unhappy';
  void club;
  return worries.length === 0
    ? `${name} is ${mood} at the club — nothing on his mind.`
    : `${name} is ${mood}: ${worries.join('; ')}.`;
}

/** What is on his mind, in his own words. */
export function moodInHisWords(world: World, p: number): string {
  const morale = world.players.morale[p];
  const worries = worriesOf(world, p).map(([, said]) => said);
  const opening = morale >= 75 ? 'I\u2019m really happy here.' : morale >= 55 ? 'Things are fine.' : morale >= 35 ? 'Honestly? I\u2019m a bit down.' : 'I\u2019m not happy, boss.';
  if (worries.length === 0) return `${opening} Nothing on my mind.`;
  const list = worries.length === 1 ? worries[0] : `${worries.slice(0, -1).join(', ')} \u2014 and ${worries[worries.length - 1]}`;
  return `${opening} ${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}

/** The promises falling due — kept or broken — and anyone unhappy long enough asking to leave. Weekly. */
export function playerHappinessWeek(world: World): void {
  const store = world.players;
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  // Promises fall due — at the manager's club, or anywhere he has since left.
  for (const pr of [...(world.promises ?? [])]) {
    if (pr.due > world.day) continue;
    world.promises = (world.promises ?? []).filter((x) => x !== pr);
    if (club === undefined || pr.clubId !== club.id || !club.players.includes(pr.p)) continue;
    const name = store.fullName(pr.p);
    if (store.playingTime[pr.p] >= PROMISE_KEPT) {
      store.morale[pr.p] = Math.min(100, store.morale[pr.p] + 6);
      postMessage(world, {
        category: 'contract', from: name, playerIdx: pr.p,
        subject: `${name}: a promise kept`,
        body: `You told ${name} he would be playing regularly, and he has been. He is grateful — and it has not gone unnoticed in the dressing room.`,
      });
    } else {
      store.morale[pr.p] = Math.max(0, store.morale[pr.p] - 15);
      (world.unhappyWeeks ??= {})[pr.p] = UNHAPPY_WEEKS;
      postMessage(world, {
        category: 'contract', from: name, playerIdx: pr.p,
        subject: `${name}: a promise broken`,
        body: `You promised ${name} regular games, and he hasn't had them. He feels let down — and is wondering whether his future lies elsewhere.`,
      });
    }
  }
  if (club === undefined) return;
  // Anyone unhappy for long enough asks to leave.
  const weeks = (world.unhappyWeeks ??= {});
  for (const p of club.players) {
    if (store.morale[p] < 30) weeks[p] = (weeks[p] ?? 0) + 1;
    else if (store.morale[p] >= 45) delete weeks[p];
    if ((weeks[p] ?? 0) < UNHAPPY_WEEKS || store.hasFlag(p, PlayerFlag.Transferable)) continue;
    const asked = world.transferRequests?.[p];
    if (asked !== undefined && world.day - asked.day < ASK_AGAIN_DAYS) continue;
    (world.transferRequests ??= {})[p] = { day: world.day, status: 'open' };
    delete weeks[p];
    const name = store.fullName(p);
    postMessage(world, {
      category: 'contract', from: name, playerIdx: p, transferRequestOf: p,
      subject: `${name} asks to leave`,
      body: `${name} has come to see you. He isn't happy at the club and has asked to be put on the transfer list. ` +
        'You can let him go, promise him the games he wants, or tell him he is staying.',
    });
  }
}

/** The manager's answer to a request to leave. */
export function answerTransferRequest(world: World, p: number, answer: 'list' | 'promise' | 'refuse'): string {
  const req = world.transferRequests?.[p];
  const store = world.players;
  const name = store.fullName(p);
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (req === undefined || req.status !== 'open' || club === undefined || !club.players.includes(p)) return 'That request has been dealt with.';
  if (answer === 'list') {
    req.status = 'listed';
    store.setFlag(p, PlayerFlag.Transferable, true);
    store.morale[p] = Math.min(100, store.morale[p] + 8);
    return `${name} is on the transfer list. He thanks you for being straight with him.`;
  }
  if (answer === 'promise') {
    req.status = 'promised';
    (world.promises ??= []).push({ p, clubId: club.id, madeOn: world.day, due: world.day + PROMISE_DAYS });
    store.morale[p] = Math.min(100, store.morale[p] + 5);
    return `${name} will stay — for now. He expects regular games within eight weeks.`;
  }
  req.status = 'refused';
  store.morale[p] = Math.max(0, store.morale[p] - 10);
  return `${name} is staying. He is not happy about it.`;
}
