/**
 * Saved tactics, the way FM keeps them: up to three per club, one of them
 * loaded. A tactic is the whole plan — the system (5-1 or 4-2), the team and
 * rotation instructions, and the team sheet that goes with it — so loading
 * another changes how the team plays and who starts.
 *
 * The loaded tactic lives in the club's own fields, which the match engine
 * reads; the others wait in `club.tacticSlots`. Whatever was changed on the
 * loaded one is kept when another is loaded, so every tactic remembers itself.
 */

import { defaultTactics, FORMATION_NAMES, formationOf, type TeamTactics } from '../match/tactics.ts';
import type { Club } from './club.ts';

export const MAX_TACTICS = 3;

export interface SavedTactic {
  name: string;
  tactics: TeamTactics;
  preferredLineup: number[];
  preferredLibero: number;
  preferredDefensiveLibero: number;
}

type TacticFields = Pick<Club, 'tactics' | 'preferredLineup' | 'preferredLibero' | 'preferredDefensiveLibero'
  | 'tacticSlots' | 'activeTactic'>;

function snapshot(club: TacticFields, name: string): SavedTactic {
  return {
    name,
    tactics: structuredClone(club.tactics),
    preferredLineup: [...club.preferredLineup],
    preferredLibero: club.preferredLibero,
    preferredDefensiveLibero: club.preferredDefensiveLibero,
  };
}

function apply(club: TacticFields, t: SavedTactic): void {
  club.tactics = structuredClone(t.tactics);
  club.preferredLineup = [...t.preferredLineup];
  club.preferredLibero = t.preferredLibero;
  club.preferredDefensiveLibero = t.preferredDefensiveLibero;
}

/** The club's saved tactics — the loaded one first saved as "Tactic 1" if it has none yet. */
export function tacticSlots(club: TacticFields): SavedTactic[] {
  if (club.tacticSlots === undefined || club.tacticSlots.length === 0) {
    club.tacticSlots = [snapshot(club, 'Tactic 1')];
    club.activeTactic = 0;
  }
  club.activeTactic = Math.min(Math.max(0, club.activeTactic ?? 0), club.tacticSlots.length - 1);
  return club.tacticSlots;
}

/** Which of them is loaded. */
export function activeTactic(club: TacticFields): number {
  tacticSlots(club);
  return club.activeTactic ?? 0;
}

/** Keep the loaded tactic as it now stands. */
export function saveLoadedTactic(club: TacticFields): void {
  const slots = tacticSlots(club);
  const i = activeTactic(club);
  slots[i] = snapshot(club, slots[i].name);
}

/** Load another tactic — the one loaded until now kept as it stands. */
export function loadTactic(club: TacticFields, index: number): boolean {
  const slots = tacticSlots(club);
  if (index < 0 || index >= slots.length) return false;
  if (index === club.activeTactic) return true;
  saveLoadedTactic(club);
  club.activeTactic = index;
  apply(club, slots[index]);
  return true;
}

/**
 * A new tactic, and loaded: a blank one, from the defaults — 5-1, balanced
 * instructions, nothing set for any rotation, and the six picked afresh.
 * Null when all three are taken.
 */
export function newTactic(club: TacticFields, name?: string): number | null {
  const slots = tacticSlots(club);
  if (slots.length >= MAX_TACTICS) return null;
  saveLoadedTactic(club);
  const blank: SavedTactic = {
    name: name ?? `Tactic ${slots.length + 1}`,
    tactics: defaultTactics(),
    preferredLineup: [],
    preferredLibero: -1,
    preferredDefensiveLibero: -1,
  };
  slots.push(blank);
  club.activeTactic = slots.length - 1;
  apply(club, blank);
  return club.activeTactic;
}

export function renameTactic(club: TacticFields, index: number, name: string): void {
  const slots = tacticSlots(club);
  const clean = name.trim().slice(0, 32);
  if (slots[index] !== undefined && clean !== '') slots[index].name = clean;
}

/** Throw a tactic away — never the last one. The loaded one's place goes to the first left. */
export function deleteTactic(club: TacticFields, index: number): boolean {
  const slots = tacticSlots(club);
  if (slots.length <= 1 || slots[index] === undefined) return false;
  const loaded = activeTactic(club);
  if (index !== loaded) saveLoadedTactic(club);
  slots.splice(index, 1);
  if (index === loaded) {
    club.activeTactic = 0;
    apply(club, slots[0]);
  } else if (index < loaded) {
    club.activeTactic = loaded - 1;
  }
  return true;
}

/** "5-1" — a saved tactic's system, read off the live club for the loaded one. */
export function tacticFormationLabel(club: TacticFields, index: number): string {
  const t = index === activeTactic(club) ? club.tactics : tacticSlots(club)[index]?.tactics;
  return FORMATION_NAMES[formationOf(t)];
}
