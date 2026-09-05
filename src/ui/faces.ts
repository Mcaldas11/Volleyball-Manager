/**
 * Player face photos.
 *
 * Sourced from randomuser.me's static portrait set — real photos, licensed
 * for exactly this kind of placeholder use, and split into separate
 * men/women pools so gender is guaranteed rather than left to an AI
 * generator's coin flip (this game has no women's players to photograph
 * anyway). The men's pool only has 100 photos, so the index is picked
 * deterministically from the player's permanent store id — never reused,
 * unlike a store index after a hypothetical future compaction — so the same
 * player always gets the same face and nothing needs to be fetched or
 * cached ourselves; the browser's normal HTTP cache handles that.
 */

const PORTRAIT_COUNT = 100;

export function playerFaceUrl(playerId: number): string {
  const index = ((playerId % PORTRAIT_COUNT) + PORTRAIT_COUNT) % PORTRAIT_COUNT;
  return `https://randomuser.me/api/portraits/men/${index}.jpg`;
}
