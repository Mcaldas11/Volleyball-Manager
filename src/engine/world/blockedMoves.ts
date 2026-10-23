/**
 * A move the club blocked, and the player who wanted it.
 *
 * Turn down a bid a player was keen on — or let it lapse — and he comes to see the manager: he wants
 * a word. What he is told decides how it ends. Too important to sell: a key man may accept it, one on
 * the bench won't. The right offer, and he can go: he settles, and holds the club to it — turn down
 * the next fair bid and he asks to leave. A better contract: if it is the money, it can keep him, and
 * the new deal has to follow within six weeks. Or he is staying, full stop: the professionals swallow
 * it, the rest hand in a transfer request. Keep him waiting a week and he takes the silence as an answer.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { postMessage } from './inbox.ts';
import type { IncomingOffer } from './negotiation.ts';
import { hash01 } from './offerStance.ts';
import { euros, type World } from './world.ts';

export type MoveReply = 'important' | 'nextOffer' | 'contract' | 'firm';

export const MOVE_REPLIES: readonly MoveReply[] = ['important', 'nextOffer', 'contract', 'firm'];

export const MOVE_REPLY_NAMES: Readonly<Record<MoveReply, string>> = {
  important: 'He is too important to sell',
  nextOffer: 'The right offer, and he can go',
  contract: 'A better contract to stay',
  firm: 'He is staying — end of story',
};

/** What the manager says, for each answer. */
export const MOVE_REPLY_LINES: Readonly<Record<MoveReply, string>> = {
  important: 'You’re too important to this team. I couldn’t let you go.',
  nextOffer: 'That bid wasn’t good enough. If the right offer comes in, I won’t stand in your way.',
  contract: 'Stay, and I’ll make it worth your while — a better contract.',
  firm: 'You’re under contract here, and you’re staying. End of discussion.',
};

export const MOVE_REPLY_HINTS: Readonly<Record<MoveReply, string>> = {
  important: 'Rings true for a key player — not for one on the bench',
  nextOffer: 'Settles him — but turn down the next fair bid and he asks to leave',
  contract: 'If it is the money — and the new deal must follow within six weeks',
  firm: 'The professionals accept it; the rest ask to leave',
};

/** A player waiting to have it out with the manager over a move the club blocked. */
export interface MoveGrievance {
  /** The club he wanted to join, and what they bid. */
  clubId: number;
  fee: number;
  /** The day he asked for the word. */
  day: number;
  /** How hard he pulled towards the move, 0-1. */
  pull: number;
}

/** What the manager told him, to be held to. */
export interface MovePromise {
  kind: 'sale' | 'contract';
  madeOn: number;
  /** The day it lapses (a sale) or falls due (a contract). */
  due: number;
  /** A sale: the bid turned down — the next to come near it is the right offer. */
  fee: number;
  /** A contract: the one he had when it was promised, so a new one shows. */
  contractWas: number;
}

/** Days he waits for the word before taking the silence as an answer. */
export const GRIEVANCE_DAYS = 7;
/** How long a promise to let him go for the right offer holds. */
const SALE_PROMISE_DAYS = 365;
/** How long the manager has to give him the better contract he promised. */
export const CONTRACT_PROMISE_DAYS = 42;
/** A bid this close to the one turned down counts as the right offer. */
export const RIGHT_OFFER = 0.9;

export function grievanceOf(world: World, p: number): MoveGrievance | undefined {
  return world.moveGrievances?.[p];
}

export function movePromiseOf(world: World, p: number): MovePromise | undefined {
  return world.movePromises?.[p];
}

/** He wants a word: a bid he was keen on has gone without a sale. */
export function askForWord(world: World, offer: IncomingOffer, what: string, pull: number): void {
  const p = offer.playerIdx;
  const name = world.players.fullName(p);
  const was = world.moveGrievances?.[p];
  // A second bid gone before he has had his word: it is the same grievance, and the bigger bid he remembers.
  (world.moveGrievances ??= {})[p] = was !== undefined && was.fee >= offer.fee
    ? { ...was, pull: Math.max(was.pull, pull) }
    : { clubId: offer.buyingClubId, fee: offer.fee, day: was?.day ?? world.day, pull: Math.max(was?.pull ?? 0, pull) };
  if (was !== undefined) return;
  postMessage(world, {
    category: 'contract', from: name, playerIdx: p, moveTalkOf: p,
    subject: `${name} wants a word`,
    body: `${name} has heard that ${what}, and he is not happy. He wanted that move, and he has asked to see you ` +
      `about it. Don't keep him waiting — give him a week without an answer and he will take the silence as one.`,
  });
}

/** He asks to leave, in writing — unless he is on the list already. */
function requestToLeave(world: World, p: number, body: string): void {
  const store = world.players;
  const name = store.fullName(p);
  if (store.hasFlag(p, PlayerFlag.Transferable)) {
    postMessage(world, { category: 'contract', from: name, playerIdx: p, subject: `${name} is unhappy`, body });
    return;
  }
  (world.transferRequests ??= {})[p] = { day: world.day, status: 'open', reason: 'blockedMove' };
  postMessage(world, {
    category: 'contract', from: name, playerIdx: p, transferRequestOf: p,
    subject: `${name} asks to leave`,
    body: `${body} You can let him go, promise him what he wants, or tell him he is staying.`,
  });
}

/** Unsettled: a few weeks of it will bring a request to leave. */
function unsettle(world: World, p: number): void {
  const weeks = (world.unhappyWeeks ??= {});
  weeks[p] = Math.max(weeks[p] ?? 0, 2);
}

/**
 * A bid gone that came near the one he was promised he could go for: the promise is broken, and he
 * asks to leave. True if it was — the rest of how he takes the bid then doesn't matter.
 */
export function salePromiseBroken(world: World, offer: IncomingOffer, what: string): boolean {
  const p = offer.playerIdx;
  const promise = world.movePromises?.[p];
  if (promise?.kind !== 'sale' || offer.loan !== undefined || offer.fee < promise.fee * RIGHT_OFFER) return false;
  delete world.movePromises![p];
  delete world.moveGrievances?.[p];
  const store = world.players;
  store.morale[p] = Math.max(0, store.morale[p] - 20);
  requestToLeave(world, p, `${store.fullName(p)} is livid that ${what}. You told him that if the right offer came in ` +
    `you would not stand in his way — he says this was it, and that your word means nothing.`);
  return true;
}

export interface MoveTalkResult {
  /** How it went, told: for the note under the conversation. */
  text: string;
  /** What he says back. */
  reply: string;
  morale: number;
  /** Whether he handed in a transfer request. */
  asked: boolean;
}

/** The manager's answer, face to face: how he takes it. Null if there is nothing to talk about. */
export function answerGrievance(world: World, club: Club, p: number, reply: MoveReply): MoveTalkResult | null {
  const g = world.moveGrievances?.[p];
  if (g === undefined || !club.players.includes(p)) return null;
  delete world.moveGrievances![p];
  (world.playerChats ??= {})[p] = world.day;
  const store = world.players;
  const name = store.fullName(p);
  const buyer = world.clubs[g.clubId]?.name ?? 'them';
  const roll = hash01(p, world.day * 5 + MOVE_REPLIES.indexOf(reply));
  const attr = (k: Parameters<typeof store.getAttr>[1]): number => (store.getAttr(p, k) - 10) / 10;
  let morale = 0;
  let asked = false;
  let text: string;
  let said: string;
  switch (reply) {
    case 'important': {
      const rank = [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).indexOf(p);
      const key = rank < 6 || store.playingTime[p] >= 55;
      if (key && roll < 0.85 - g.pull * 0.35) {
        morale = 6;
        text = `${name} is flattered — it matters to him that you see him as one of the team's key men. He'll put the move behind him.`;
        said = 'I didn’t know you rated me that highly. Alright — I’ll put it behind me.';
      } else if (key) {
        morale = -3;
        unsettle(world, p);
        text = `${name} has heard it all before. He accepts it for now, but he is not convinced — and he is unsettled.`;
        said = '...That’s what they all say, boss.';
      } else {
        morale = -8;
        asked = roll < 0.7;
        if (!asked) unsettle(world, p);
        text = asked
          ? `${name} doesn't believe a word of it — he barely plays. He has handed in a transfer request.`
          : `${name} doesn't believe a word of it — he barely plays. He is unsettled.`;
        said = 'Important? I hardly get on the court. Don’t insult me.';
      }
      break;
    }
    case 'nextOffer':
      morale = 7;
      (world.movePromises ??= {})[p] = {
        kind: 'sale', madeOn: world.day, due: world.day + SALE_PROMISE_DAYS, fee: g.fee, contractWas: store.contractUntil[p],
      };
      text = `${name} accepts it, and will hold you to it: turn down a bid of ${euros(Math.round(g.fee * RIGHT_OFFER))} ` +
        'or more in the next year and he will ask to leave.';
      said = 'Alright. I’ll take you at your word — don’t make me regret it.';
      break;
    case 'contract':
      if (roll < 0.75 - g.pull * 0.45) {
        morale = 5;
        (world.movePromises ??= {})[p] = {
          kind: 'contract', madeOn: world.day, due: world.day + CONTRACT_PROMISE_DAYS, fee: 0, contractWas: store.contractUntil[p],
        };
        text = `${name} will stay — for a better deal. He expects new terms within six weeks: open contract talks from his profile.`;
        said = 'If the club shows me I’m valued — properly — I’ll stay.';
      } else {
        morale = -4;
        unsettle(world, p);
        text = `${name} says it isn't about the money: he wanted to play for ${buyer}. He is unsettled.`;
        said = 'This isn’t about money, boss.';
      }
      break;
    case 'firm': {
      morale = -6;
      const chance = Math.min(0.85, Math.max(0.1,
        0.2 + g.pull * 0.7 + attr('ambition') * 0.3 - attr('temperament') * 0.15 - attr('professionalism') * 0.25));
      asked = roll < chance;
      text = asked
        ? `${name} won't accept it. He has handed in a transfer request.`
        : `${name} takes it — not happily, but he is a professional, and he'll get on with it.`;
      said = asked ? 'Then I want to go on the list. I’m putting it in writing.' : 'Fine. You’re the boss.';
      break;
    }
  }
  store.morale[p] = Math.max(0, Math.min(100, store.morale[p] + morale));
  if (asked) requestToLeave(world, p, `${name} came out of your meeting about ${buyer} and handed in a transfer request.`);
  return { text, reply: said, morale, asked };
}

/** Every day: a word not had in time, and the promises falling due — kept or broken. */
export function blockedMovesDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const store = world.players;
  for (const key of Object.keys(world.moveGrievances ?? {})) {
    const p = Number(key);
    const g = world.moveGrievances![p];
    if (club === undefined || !club.players.includes(p)) {
      delete world.moveGrievances![p];
      continue;
    }
    if (world.day - g.day < GRIEVANCE_DAYS) continue;
    // Nobody spoke to him: he takes the silence as an answer.
    delete world.moveGrievances![p];
    store.morale[p] = Math.max(0, store.morale[p] - 4);
    const name = store.fullName(p);
    const buyer = world.clubs[g.clubId]?.name ?? 'the club';
    const chance = Math.min(0.85, Math.max(0.15,
      0.25 + g.pull * 0.8 + (store.getAttr(p, 'ambition') - 10) * 0.03 - ((store.getAttr(p, 'temperament') - 10) / 10) * 0.15));
    if (hash01(p, g.day * 7 + 3) < chance) {
      requestToLeave(world, p, `${name} waited a week for you to explain why the move to ${buyer} was blocked. Nobody did, ` +
        'and he has handed in a transfer request.');
    } else {
      unsettle(world, p);
      postMessage(world, {
        category: 'contract', from: name, playerIdx: p,
        subject: `${name} is unhappy`,
        body: `${name} waited a week for you to talk to him about ${buyer}, and nobody did. He has stopped asking — but he is unsettled.`,
      });
    }
  }
  for (const key of Object.keys(world.movePromises ?? {})) {
    const p = Number(key);
    const pr = world.movePromises![p];
    if (club === undefined || !club.players.includes(p)) {
      delete world.movePromises![p];
      continue;
    }
    const name = store.fullName(p);
    if (pr.kind === 'sale') {
      if (world.day >= pr.due) delete world.movePromises![p];
      continue;
    }
    if (store.contractUntil[p] > pr.contractWas) {
      delete world.movePromises![p];
      store.morale[p] = Math.min(100, store.morale[p] + 4);
      postMessage(world, {
        category: 'contract', from: name, playerIdx: p,
        subject: `${name}: a promise kept`,
        body: `You promised ${name} a better contract to stay, and he has it. He feels valued — the move is forgotten.`,
      });
    } else if (world.day >= pr.due) {
      delete world.movePromises![p];
      store.morale[p] = Math.max(0, store.morale[p] - 15);
      requestToLeave(world, p, `You promised ${name} a better contract if he stayed. Six weeks on, he has not had one — ` +
        'and he has handed in a transfer request.');
    }
  }
}
