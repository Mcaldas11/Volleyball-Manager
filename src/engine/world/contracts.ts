/**
 * The contract and transfer calendar in the user's inbox: when each transfer
 * window opens and shuts, and which of the user's players are into the last
 * months of their contracts — first a warning each, six months out, then one
 * reminder listing whoever is still unsigned.
 */

import { loanOf, loansOutOf } from './loans.ts';
import {
  contractEndSeason, DAYS_PER_SEASON, nextTransferWindow, seasonEndYear, TRANSFER_WINDOWS,
  type GameMessage, type TransferWindow, type World,
} from './world.ts';

/** 1 January: six months left — each expiring contract gets its own warning. */
const FIRST_WARNING_DAY = 184;
/** 1 May: two months left — one reminder of whoever is still unsigned. */
const FINAL_REMINDER_DAY = 304;

const WINDOW_NAME: Readonly<Record<TransferWindow['name'], string>> = { summer: 'summer', winter: 'January' };
const OPENS_ON: Readonly<Record<TransferWindow['name'], string>> = { summer: '1 July', winter: '1 January' };
const CLOSES_ON: Readonly<Record<TransferWindow['name'], string>> = { summer: '1 September', winter: '31 January' };

/** Post today's contract and transfer-window messages, if any. Called once a day. */
export function contractNotices(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const store = world.players;
  const d = world.day % DAYS_PER_SEASON;
  const push = (msg: Omit<GameMessage, 'id' | 'day' | 'year'>): void => {
    world.messages.push({ id: world.messages.length, day: world.day, year: world.year, ...msg });
  };

  for (const w of TRANSFER_WINDOWS) {
    if (d === w.opens) {
      push({
        subject: 'Transfer window open',
        body: `The ${WINDOW_NAME[w.name]} transfer window is open until ${CLOSES_ON[w.name]}. Players can be bought ` +
          'and sold until it shuts — free agents can be signed at any time.',
        category: 'news',
      });
    }
    if (d === w.closes + 1) {
      const next = nextTransferWindow(world.day).window;
      push({
        subject: 'Transfer window closed',
        body: `The ${WINDOW_NAME[w.name]} transfer window has closed. No more players can move between clubs ` +
          `until the ${WINDOW_NAME[next.name]} window opens on ${OPENS_ON[next.name]}.`,
        category: 'news',
      });
    }
  }

  if (d !== FIRST_WARNING_DAY && d !== FINAL_REMINDER_DAY) return;
  // Our players wherever they are playing — out on loan too — but not anyone
  // here on loan, whose contract is his own club's business.
  const ours = [
    ...club.players.filter((p) => loanOf(world, p) === undefined),
    ...loansOutOf(world, club.id).map((l) => l.playerIdx),
  ];
  const expiring = ours.filter((p) => contractEndSeason(store.contractUntil[p]) <= world.season);
  const ends = `30 June ${seasonEndYear(world, world.season)}`;

  if (d === FIRST_WARNING_DAY) {
    for (const p of expiring) {
      push({
        subject: `Contract expiring: ${store.fullName(p)}`,
        body: `${store.fullName(p)}'s contract runs out on ${ends}. If it isn't renewed he will leave on a free ` +
          'transfer at the end of the season. Open contract talks to offer him a new deal.',
        playerIdx: p,
        category: 'contract',
      });
    }
  } else if (expiring.length > 0) {
    const names = expiring.map((p) => store.fullName(p));
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    push({
      subject: 'Contracts running out',
      body: `Two months to go: ${list} ${expiring.length > 1 ? 'are' : 'is'} still out of contract on ${ends}. ` +
        'Anyone not renewed by then leaves on a free transfer.',
      category: 'contract',
    });
  }
}
