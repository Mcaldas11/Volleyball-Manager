/**
 * The photos of the real players written into the game (see the engine's uniquePlayers.ts), handed
 * to the faces for whichever world is in play. Kept out of faces.ts, which the tests load, so that
 * only the interface ever loads an image.
 */

import type { World } from '../engine/world/world.ts';
import diogoCouto from './players/diogo-couto.jpg';
import { setOwnPhotos } from './faces.ts';

const PHOTOS: Readonly<Record<string, string>> = {
  'diogo-couto': diogoCouto,
};

/** Show the real players' photos for this world's players. */
export function showUniqueFaces(world: World): void {
  const photos = new Map<number, string>();
  for (const [key, p] of Object.entries(world.uniquePlayers ?? {})) {
    const url = PHOTOS[key];
    if (url !== undefined && p < world.players.count) photos.set(world.players.id[p], url);
  }
  setOwnPhotos(photos);
}

