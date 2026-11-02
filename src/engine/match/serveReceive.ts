/**
 * The serve and the serve receive, as the coach orders them.
 *
 * Every server can be told how to serve — the jump serve, driven off a full
 * run-up with topspin; the jump float, off a short run-up and a jump but with
 * no spin, the ball wobbling in the air; the standing float — and where along
 * the end line to serve from: behind zone 1, 6 or 5, always behind the line.
 * Left to himself he serves with the weapon he is best at, from where he
 * likes to.
 *
 * The receive line is set against each kind of serve: where the passers stand
 * — up close to take a float before it dips and darts, deep to give a jump
 * serve the time it needs — and whether a float is taken overhead, with the
 * fingers, or on the forearms. Positions are in the receiving side's own
 * frame, as in defence.ts: `u` across the court from its own left (0) to its
 * right (1), `v` depth from the net (0) to the end line (1).
 */

import type { PlayerStore } from '../model/players.ts';
import type { Position } from '../model/positions.ts';
import type { Spot } from './defence.ts';
import { computeRatings } from './ratings.ts';

/** How a player serves. */
export type ServeStyle = 'jump' | 'jumpFloat' | 'float';

export const SERVE_STYLES: readonly ServeStyle[] = ['jump', 'jumpFloat', 'float'];

export const SERVE_STYLE_NAMES: Readonly<Record<ServeStyle, string>> = {
  jump: 'Jump serve',
  jumpFloat: 'Jump float',
  float: 'Standing float',
};

/** Behind which back-row zone he serves from: 1 on the right, 6 in the middle, 5 on the left. */
export type ServeZone = 1 | 6 | 5;

export const SERVE_ZONES: readonly ServeZone[] = [1, 6, 5];

/** Across the end line, in the serving side's own frame, where each zone's server stands. */
export const SERVE_ZONE_U: Readonly<Record<ServeZone, number>> = { 1: 0.84, 6: 0.5, 5: 0.16 };

/** What the coach has told one server. Either left out: as he likes. */
export interface ServerOrders {
  style?: ServeStyle;
  zone?: ServeZone;
}

/** The orders for each server, by player index. */
export type ServerOrdersMap = Record<number, ServerOrders>;

export function serverOrdersOf(t: { servers?: ServerOrdersMap } | undefined, p: number): ServerOrders {
  return t?.servers?.[p] ?? {};
}

/** The serve a player is best at — the jump serve or the float, as the engine has always had him pick. */
export function bestServe(r: { serveJump: number; serveFloat: number }): ServeStyle {
  return r.serveJump > r.serveFloat ? 'jump' : 'float';
}

/** How a player serves: as he was told to, or with the serve he is best at. */
export function serveStyleFor(
  t: { servers?: ServerOrdersMap } | undefined, p: number, r: { serveJump: number; serveFloat: number },
): ServeStyle {
  return serverOrdersOf(t, p).style ?? bestServe(r);
}

/** How a player will serve, before the match plays it: as he was told to, or
 *  with the serve he is better at on his attributes. */
export function plannedServe(store: PlayerStore, t: { servers?: ServerOrdersMap } | undefined, p: number): ServeStyle {
  return serverOrdersOf(t, p).style ?? bestServe(computeRatings(store, p, store.position[p] as Position));
}

/** A float, standing or off a jump: struck without spin, the ball moving about in the air. */
export function isFloat(style: string | undefined): boolean {
  return style === 'float' || style === 'jumpFloat';
}

/** How good a serve he has in a style: the jump float is the float's touch with some of the jump serve's legs. */
export function serveRating(r: { serveJump: number; serveFloat: number }, style: ServeStyle): number {
  if (style === 'jump') return r.serveJump;
  if (style === 'float') return r.serveFloat;
  return 0.75 * r.serveFloat + 0.25 * r.serveJump;
}

/** Where along the end line a server likes to stand when nobody tells him: most
 *  behind zone 1, some in the middle, a few on the left — the same man always the same. */
export function usualZone(p: number): ServeZone {
  const h = (Math.imul(p + 29, 0x45d9f3b) >>> 0) % 20;
  return h < 12 ? 1 : h < 17 ? 6 : 5;
}

export function serveZoneFor(t: { servers?: ServerOrdersMap } | undefined, p: number): ServeZone {
  return serverOrdersOf(t, p).zone ?? usualZone(p);
}

/** What the passers line up against: a float — standing or off a jump — or a jump serve. */
export type ServeKind = 'float' | 'jump';

export const SERVE_KINDS: readonly ServeKind[] = ['float', 'jump'];

export const SERVE_KIND_NAMES: Readonly<Record<ServeKind, string>> = { float: 'Float serve', jump: 'Jump serve' };

export function serveKindOf(style: string | undefined): ServeKind {
  return isFloat(style) ? 'float' : 'jump';
}

/**
 * The receive line against one kind of serve: where the passer on the left,
 * in the middle and on the right stand — a line of two stands between them, a
 * line of four spreads across them — and, against a float, whether it is
 * taken overhead.
 */
export interface ReceiveLayout {
  left: Spot;
  middle: Spot;
  right: Spot;
  /** A float taken with the fingers, overhead, rather than on the forearms. Only against a float. */
  overhead?: boolean;
}

export type ReceivePlans = Record<ServeKind, ReceiveLayout>;

/** The standard lines: up close, as most lines stand, or deep. */
export type ReceivePreset = 'close' | 'normal' | 'deep';

export const RECEIVE_PRESETS: readonly ReceivePreset[] = ['close', 'normal', 'deep'];

export const RECEIVE_PRESET_NAMES: Readonly<Record<ReceivePreset, string>> = { close: 'Up close', normal: 'Normal', deep: 'Deep' };

const PRESET_DEPTH: Readonly<Record<ReceivePreset, number>> = { close: 0.5, normal: 0.63, deep: 0.74 };

/** A standard line, the passers on the wings a step closer than the one in the middle. */
export function receivePreset(preset: ReceivePreset): ReceiveLayout {
  const v = PRESET_DEPTH[preset];
  return { left: { u: 0.18, v: v - 0.02 }, middle: { u: 0.5, v }, right: { u: 0.82, v: v - 0.02 } };
}

/** As most sides stand: the usual line against a float, back a step against a jump serve, everything on the forearms. */
export function defaultReceivePlans(): ReceivePlans {
  return { float: receivePreset('normal'), jump: receivePreset('deep') };
}

export function receivePlansOf(t: { receive?: ReceivePlans } | undefined): ReceivePlans {
  return t?.receive ?? defaultReceivePlans();
}

/** The standard line a layout is, if it is one. */
export function presetOfLine(l: ReceiveLayout): ReceivePreset | null {
  const same = (a: Spot, b: Spot): boolean => Math.abs(a.u - b.u) < 0.005 && Math.abs(a.v - b.v) < 0.005;
  for (const p of RECEIVE_PRESETS) {
    const q = receivePreset(p);
    if (same(l.left, q.left) && same(l.middle, q.middle) && same(l.right, q.right)) return p;
  }
  return null;
}

/** How deep a line stands on average, `v`. */
export function lineDepth(l: ReceiveLayout): number {
  return (l.left.v + l.middle.v + l.right.v) / 3;
}

/** Where a line takes each kind of serve best: a float up close, before it
 *  dips and darts; a jump serve deep, with the time to see it. */
const BEST_DEPTH: Readonly<Record<ServeKind, number>> = { float: 0.5, jump: 0.76 };
/** How wide it covers the court best, from the left passer to the right. */
const BEST_WIDTH = 0.64;
const MISPLACED = 1.4;
const BUNCHED = 0.8;

function fitOf(kind: ServeKind, l: ReceiveLayout): number {
  const deep = lineDepth(l) - BEST_DEPTH[kind];
  const wide = Math.abs(l.right.u - l.left.u) - BEST_WIDTH;
  return Math.max(0.5, 1 - MISPLACED * deep * deep - BUNCHED * wide * wide);
}

/**
 * How well a line is placed for the serve coming at it, as a multiplier on
 * its passing: exactly 1 for the usual line, a couple of per cent better up
 * close to a float or deep to a jump serve, and worse the other way round —
 * deep to a float, the ball dies in front of the passers; up close to a jump
 * serve, it is on them before they can move.
 */
export function receiveFit(plans: ReceivePlans, kind: ServeKind): number {
  return fitOf(kind, plans[kind]) / fitOf(kind, defaultReceivePlans()[kind]);
}

/** A float taken overhead is played with the fingers: a setter's touch counts as well as a passer's… */
export const OVERHEAD_HANDS = 0.3;
/** …and a ball taken high and early, before it moves, comes off a little cleaner. */
export const OVERHEAD_EDGE = 1.04;

/** A passer's touch on a float taken overhead, from his reception and his setting. */
export function overheadReception(reception: number, setting: number): number {
  return ((1 - OVERHEAD_HANDS) * reception + OVERHEAD_HANDS * setting) * OVERHEAD_EDGE;
}

/** Where the `n` passers of a line stand, left to right: two between the line's
 *  three spots, three on them, four spread from wing to wing. */
export function receiveSpots(l: ReceiveLayout, n: number): Spot[] {
  const mid = (a: Spot, b: Spot, k = 0.5): Spot => ({ u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k });
  if (n <= 1) return [{ ...l.middle }];
  if (n === 2) return [mid(l.left, l.middle, 0.4), mid(l.middle, l.right, 0.6)];
  if (n === 3) return [{ ...l.left }, { ...l.middle }, { ...l.right }];
  return [{ ...l.left }, mid(l.left, l.middle, 0.6), mid(l.middle, l.right, 0.4), { ...l.right }];
}
