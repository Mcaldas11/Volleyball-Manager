/**
 * The editor's hand on a player: moving him to another club (or out of work)
 * at a stroke, and wiping the record of where he has been. Nothing is paid,
 * nobody is told — the world is simply changed, as an editor does.
 */

import { PlayerFlag } from '../model/players.ts';
import { startSpell } from './clubHistory.ts';
import { noteDeparture } from './dressingRoom.ts';
import { endLoan, loanOf } from './loans.ts';
import { seasonEndDay, type World } from './world.ts';

/** Take him out of every squad list of a club: the senior one, the youth one, the lineups' benches. */
function leaveClub(world: World, p: number, clubId: number): void {
  const club = world.clubs[clubId];
  if (club === undefined) return;
  noteDeparture(world, club, p);
  club.players = club.players.filter((x) => x !== p);
  club.youthPlayers = club.youthPlayers.filter((x) => x !== p);
}

/**
 * Put a player at `clubId` now, or out of work with -1. A loan ends first; his
 * wage and contract stay as they were, two seasons if he had none. He joins
 * the senior squad.
 */
export function editorMovePlayer(world: World, p: number, clubId: number): void {
  const store = world.players;
  if (!store.isActive(p)) return;
  const loan = loanOf(world, p);
  if (loan !== undefined) endLoan(world, loan);
  const from = store.clubId[p];
  if (from === clubId) return;
  if (from >= 0) leaveClub(world, p, from);
  store.setFlag(p, PlayerFlag.Transferable, false);
  store.setFlag(p, PlayerFlag.LoanListed, false);
  store.setFlag(p, PlayerFlag.Youth, false);
  store.clubId[p] = clubId;
  const club = world.clubs[clubId];
  if (club === undefined) return;
  club.players.push(p);
  if (store.contractUntil[p] < world.day) store.contractUntil[p] = seasonEndDay(world.season + 1);
  startSpell(world, p, clubId);
}

/**
 * Wipe where he has been: his clubs before this one, the transfers that took
 * him there, his season-by-season numbers and the moments of his timeline.
 * His spell at his club now starts again this season.
 */
export function editorClearHistory(world: World, p: number): void {
  world.clubSpells?.delete(p);
  world.competitionRecords.delete(p);
  world.transferLog = world.transferLog.filter((t) => t.playerIdx !== p);
  if (world.playerEvents !== undefined) delete world.playerEvents[p];
  world.ratingForm.delete(p);
  const club = world.players.clubId[p];
  if (club >= 0 && !world.players.hasFlag(p, PlayerFlag.Youth)) startSpell(world, p, club);
}
