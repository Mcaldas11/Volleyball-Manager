/**
 * The faces of the real players written into the game (see the engine's uniquePlayers.ts) — a photo,
 * or a drawing for one who would rather not have his — handed to the faces for whichever world is in play. Kept out of faces.ts, which the tests load, so that
 * only the interface ever loads an image.
 */

import type { World } from '../engine/world/world.ts';
import diogoCouto from './players/diogo-couto.jpg';
import matthewLienert from './players/matthew-lienert.svg';
import { setDrawnFaces, setOwnPhotos } from './faces.ts';
import { avatarUrl } from './avatar.ts';
import { clubHue } from './components.tsx';
import { shirtNumberOf } from '../engine/world/squadNumbers.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { REAL_PHOTO_URL } from '../data/real/realDb.ts';

const PHOTOS: Readonly<Record<string, string>> = {
  'diogo-couto': diogoCouto,
  'matthew-lienert': matthewLienert,
};

/** A real coach's photo, in a real-data world on the dev server: undefined for everyone else. */
export function staffPhotoUrl(world: World, staffId: number): string | undefined {
  if (!import.meta.env.DEV) return undefined;
  const file = world.realStaffPhotos?.[staffId];
  return file !== undefined ? REAL_PHOTO_URL + file : undefined;
}

/** Show the real players' photos for this world's players. */
export function showUniqueFaces(world: World): void {
  const photos = new Map<number, string>();
  for (const [key, p] of Object.entries(world.uniquePlayers ?? {})) {
    const url = PHOTOS[key];
    if (url !== undefined && p < world.players.count) photos.set(world.players.id[p], url);
  }
  // A real-data world: the players' own photos, served from this computer by the dev server.
  if (import.meta.env.DEV) {
    for (const [id, file] of Object.entries(world.realPhotos ?? {})) photos.set(Number(id), REAL_PHOTO_URL + file);
  }
  setOwnPhotos(photos);
  setDrawnFaces(world.realData === true ? drawnFaces(world) : null);
}

/** Skin tones drawn from, by confederation: a range, not a rule. */
const SKIN_BY_CONF: Readonly<Record<string, readonly [number, number]>> = {
  CEV: [0, 3], AVC: [0, 4], CSV: [1, 6], NORCECA: [1, 7], CAVB: [4, 7],
};

/**
 * A real-data world's players with no photo, drawn in their club's colours. The
 * drawing is kept until his club or number changes.
 */
function drawnFaces(world: World): (playerId: number) => string | undefined {
  const store = world.players;
  const byId = new Map<number, number>();
  const drawn = new Map<number, { key: string; url: string }>();
  const indexOf = (id: number): number | undefined => {
    let i = byId.get(id);
    if (i === undefined || store.id[i] !== id) {
      byId.clear();
      for (let k = 0; k < store.count; k++) byId.set(store.id[k], k);
      i = byId.get(id);
    }
    return i;
  };
  return (id) => {
    const i = indexOf(id);
    if (i === undefined) return undefined;
    const club = world.clubs[store.clubId[i]];
    const number = club !== undefined ? shirtNumberOf(world, i) : null;
    const key = `${club?.id ?? -1}|${number ?? ''}`;
    const had = drawn.get(id);
    if (had !== undefined && had.key === key) return had.url;
    const hue = club !== undefined ? clubHue(club) : 215;
    const conf = NATIONS[store.nation[i]]?.confederation ?? 'CEV';
    const url = avatarUrl({
      seed: id,
      women: world.gender === 'women',
      shirt: `hsl(${hue}, 64%, 48%)`,
      trim: `hsl(${hue}, 45%, 24%)`,
      number,
      badge: (club?.shortName ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase(),
      skinRange: SKIN_BY_CONF[conf] ?? [0, 4],
      age: store.ageOn(i, world.year, 181),
    });
    drawn.set(id, { key, url });
    return url;
  };
}

