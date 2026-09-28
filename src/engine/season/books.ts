/**
 * A club's books for the season: every income stream and every cost, as the
 * rollover settles them. The one place the sums are defined, so the rollover
 * and the season review can never disagree about what a season made or lost.
 */

import type { Club } from '../model/club.ts';
import { wageBill } from '../world/loans.ts';
import type { World } from '../world/world.ts';

export interface ClubBooks {
  /** One line per stream, in display order. */
  income: Array<[string, number]>;
  costs: Array<[string, number]>;
  totalIncome: number;
  totalCosts: number;
}

export function clubBooks(world: World, club: Club): ClubBooks {
  const store = world.players;
  const f = club.finances;

  // Players on loan count for the share of their wage each club pays.
  const playerWages = wageBill(world, club);
  let youthWages = 0;
  for (const p of club.youthPlayers) youthWages += store.wage[p];
  let staffWages = 0;
  for (const sid of club.staff) staffWages += world.staff[sid]?.wage ?? 0;

  const income: Array<[string, number]> = [
    ['Sponsorship', f.sponsorshipIncome],
    ['TV rights', f.tvRightsIncome],
    ['Merchandise', f.merchandiseIncome],
    // The running season takings are gate receipts plus, at the very end,
    // the prize money for where the club finished.
    ['Gate receipts', f.seasonIncome - f.prizeMoney],
    ['Prize money', f.prizeMoney],
  ];
  const costs: Array<[string, number]> = [
    ['Player wages', playerWages],
    ['Youth wages', youthWages],
    ['Staff wages', staffWages],
    ['Arena maintenance', f.arenaMaintenance],
    ['Medical', f.medicalCosts],
    ['Youth academy', f.youthAcademyCosts],
    ['Travel', f.seasonExpenditure],
  ];
  const sum = (lines: Array<[string, number]>): number => lines.reduce((s, [, v]) => s + v, 0);
  return { income, costs, totalIncome: sum(income), totalCosts: sum(costs) };
}
