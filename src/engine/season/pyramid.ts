/**
 * The league pyramid: who goes up and down between a nation's divisions each
 * summer, and how a division's regional groups are kept the same size.
 *
 * Two tiers trade clubs as wholes — as many come up as go down, so no
 * division grows or shrinks — the places shared out across every group, and
 * each club arriving joins the group of its new division with fewest clubs.
 * A pyramid that has drifted out of shape anyway (a save from before this
 * was so, where every club relegated from a tier piled into Group A of the
 * one below, and eight groups sent sixteen down for eight up) is put back
 * over a summer or two.
 */

import { compareTableRows, type LeagueTableRow } from '../model/club.ts';
import type { Competition, World } from '../world/world.ts';
import { finalStandingsOrder } from './playoffs.ts';

/** Clubs per group a division is built with, and kept within, by tier. */
export function divisionSize(tier: number): readonly [number, number] {
  return tier === 1 ? [12, 14] : tier === 2 ? [12, 16] : [10, 14];
}

/** Groups of one division further apart in size than this are evened out. */
const GROUP_SPREAD = 2;

/** Each nation's leagues, tier by tier from the top flight, each tier's groups in order. */
export function leaguePyramids(world: World): Map<number, Competition[][]> {
  const out = new Map<number, Competition[][]>();
  for (const comp of world.competitions) {
    if (comp.kind !== 'league') continue;
    const tiers = out.get(comp.nation) ?? [];
    (tiers[comp.tier - 1] ??= []).push(comp);
    out.set(comp.nation, tiers);
  }
  for (const tiers of out.values()) {
    for (let t = 0; t < tiers.length; t++) (tiers[t] ??= []).sort((a, b) => a.id - b.id);
  }
  return out;
}

/**
 * As many places down from each division as there are up from the one
 * below: the groups of a tier share out the promotions beneath them.
 */
export function balanceRelegationSlots(world: World): void {
  for (const tiers of leaguePyramids(world).values()) {
    for (let t = 0; t + 1 < tiers.length; t++) {
      const upper = tiers[t];
      const lower = tiers[t + 1];
      if (upper.length === 0 || lower.length === 0) continue;
      const up = lower.reduce((s, c) => s + c.promotionSlots, 0);
      const each = Math.max(1, Math.round(up / upper.length));
      for (const c of upper) c.relegationSlots = each;
    }
  }
}

/**
 * `n` clubs from across a tier's groups — its winners first, then its
 * runners-up, and so on (`best`), or from the bottom up — the best or worst
 * record deciding between groups at the same place.
 */
function pickAcross(
  groups: Competition[], n: number, best: boolean, order: Map<number, number[]>, moving: Set<number>,
): number[] {
  const lists = groups.map((c) => (order.get(c.id) ?? []).filter((id) => !moving.has(id)));
  const row = new Map<number, LeagueTableRow>();
  for (const c of groups) for (const r of c.table) row.set(r.clubId, r);
  const out: number[] = [];
  for (let d = 0; out.length < n && lists.some((l) => d < l.length); d++) {
    const atPlace = lists.filter((l) => d < l.length).map((l) => (best ? l[d] : l[l.length - 1 - d]));
    atPlace.sort((a, b) => {
      const ra = row.get(a);
      const rb = row.get(b);
      const cmp = ra !== undefined && rb !== undefined ? compareTableRows(ra, rb) : 0;
      return best ? cmp : -cmp;
    });
    out.push(...atPlace.slice(0, n - out.length));
  }
  return out;
}

/** The group of a division with fewest clubs — the first of them, on a tie. */
function smallest(groups: Competition[]): Competition {
  return groups.reduce((m, c) => (c.participants.length < m.participants.length ? c : m), groups[0]);
}

/** A club joins a league; moving division changes what it is worth to sponsors, and so what it can pay. */
function join(world: World, clubId: number, from: Competition, to: Competition): void {
  const club = world.clubs[clubId];
  if (club === undefined) return;
  to.participants.push(clubId);
  club.leagueId = to.id;
  club.tier = to.tier;
  if (to.tier === from.tier) return;
  // Promotion is a windfall; relegation hurts for years.
  const factor = to.tier < from.tier ? 1.18 : 0.86;
  club.reputation = Math.round(Math.min(10000, club.reputation * factor));
}

/** The groups of one division evened out: a club or two moving across — a newcomer before anyone settled, never the user's if it can be helped. */
function evenGroups(world: World, groups: Competition[], arrived: Set<number>): void {
  if (groups.length < 2) return;
  for (;;) {
    const small = smallest(groups);
    const big = groups.reduce((m, c) => (c.participants.length > m.participants.length ? c : m), groups[0]);
    if (big.participants.length - small.participants.length <= GROUP_SPREAD) return;
    const from = [...big.participants].reverse();
    const clubId = from.find((c) => arrived.has(c) && c !== world.userClubId) ??
      from.find((c) => c !== world.userClubId) ?? from[0];
    big.participants = big.participants.filter((c) => c !== clubId);
    join(world, clubId, big, small);
  }
}

/** The summer's promotions and relegations, nation by nation, and the groups evened out after. */
export function applyPromotionRelegation(world: World, report: { promoted: number; relegated: number }): void {
  balanceRelegationSlots(world);
  for (const tiers of leaguePyramids(world).values()) {
    // Where every group finished, before anyone moves — a relegation playoff,
    // where one was contested, decides who goes down. Only a season played
    // counts, and only clubs still in the league.
    const order = new Map<number, number[]>();
    for (const groups of tiers) {
      for (const comp of groups) {
        if (!comp.table.some((r) => r.played > 0)) continue;
        const members = new Set(comp.participants);
        order.set(comp.id, finalStandingsOrder(comp).filter((c) => members.has(c)));
      }
    }

    const size = tiers.map((groups) => groups.reduce((s, c) => s + c.participants.length, 0));
    const moving = new Set<number>();
    const moves: Array<{ clubId: number; from: Competition; tier: number }> = [];
    for (let t = 0; t + 1 < tiers.length; t++) {
      const upper = tiers[t];
      const lower = tiers[t + 1];
      if (upper.length === 0 || lower.length === 0) continue;
      const n = Math.min(
        lower.reduce((s, c) => s + c.promotionSlots, 0),
        upper.reduce((s, c) => s + c.relegationSlots, 0),
      );
      // A division out of shape is put back: short of clubs, more come up
      // than go down — as many as the one below can spare; overfull, more go down.
      const [lo, hi] = divisionSize(t + 1);
      const [lowerLo] = divisionSize(t + 2);
      const extraUp = Math.max(0, Math.min(lo * upper.length - size[t], size[t + 1] - lowerLo * lower.length));
      const extraDown = Math.max(0, size[t] - hi * upper.length);
      let ups = pickAcross(lower, n + extraUp, true, order, moving);
      let downs = pickAcross(upper, n + extraDown, false, order, moving);
      // Short of candidates on one side, the other gives way, so the trade stays even.
      const upShort = n + extraUp - ups.length;
      const downShort = n + extraDown - downs.length;
      if (upShort > 0) downs = downs.slice(0, Math.max(0, downs.length - upShort));
      if (downShort > 0) ups = ups.slice(0, Math.max(0, ups.length - downShort));

      const byClub = (groups: Competition[], clubId: number): Competition =>
        groups.find((c) => c.participants.includes(clubId)) ?? groups[0];
      for (const clubId of ups) {
        moving.add(clubId);
        moves.push({ clubId, from: byClub(lower, clubId), tier: t + 1 });
      }
      for (const clubId of downs) {
        moving.add(clubId);
        moves.push({ clubId, from: byClub(upper, clubId), tier: t + 2 });
      }
      size[t] += ups.length - downs.length;
      size[t + 1] += downs.length - ups.length;
      report.promoted += ups.length;
      report.relegated += downs.length;
    }

    // Everyone leaves first; then each takes the smallest group of his new division.
    for (const m of moves) m.from.participants = m.from.participants.filter((c) => c !== m.clubId);
    for (const m of moves) join(world, m.clubId, m.from, smallest(tiers[m.tier - 1]));
    const arrived = new Set(moves.map((m) => m.clubId));
    for (const groups of tiers) evenGroups(world, groups, arrived);
  }
}
