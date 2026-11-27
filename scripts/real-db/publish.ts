/**
 * The real database as the public game carries it: `src/data/real/public/`.
 *
 *   npx tsx scripts/real-db/publish.ts
 *
 * Made from the local files (`data/local/real-db*.json`), with what must not go
 * out taken away:
 *   - no photos of anyone: the game draws every player and coach instead;
 *   - no club or league logos: they belong to the clubs and leagues;
 *   - no one under 18: their places are filled with generated players;
 *   - birth dates down to the year.
 * Names, clubs, positions, heights, nationalities, coaches and careers stay.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RealDb, RealPlayer } from '../../src/data/real/realDb.ts';

const OUT_DIR = join('src', 'data', 'real', 'public');
/** The season the database is for: anyone born after this year less 18 is a minor. */
const SEASON_START = 2026;
const ADULT_BORN_BY = SEASON_START - 18;

function adult(p: RealPlayer): boolean {
  return p.birthYear !== null && p.birthYear <= ADULT_BORN_BY;
}

function strip(p: RealPlayer): RealPlayer {
  const { photo: _photo, ...rest } = p;
  void _photo;
  return { ...rest, birthDay: null };
}

function publish(file: string, out: string): void {
  const src = join('data', 'local', file);
  if (!existsSync(src)) {
    process.stdout.write(`${src}: not there, skipped\n`);
    return;
  }
  const db = JSON.parse(readFileSync(src, 'utf8')) as RealDb;
  let kept = 0;
  let left = 0;
  const leagues = db.leagues.map((l) => ({
    ...l,
    logo: null,
    clubs: l.clubs.map((c) => {
      const players = c.players.filter((p) => (adult(p) ? (kept++, true) : (left++, false))).map(strip);
      const youth = (c.youth ?? []).filter((p) => (adult(p) ? (kept++, true) : (left++, false))).map(strip);
      return {
        ...c,
        logo: null,
        players,
        youth,
        coaches: (c.coaches ?? []).map(({ photo: _p, ...rest }) => { void _p; return rest; }),
      };
    }),
  }));
  const pub: RealDb = { ...db, leagues };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, out), JSON.stringify(pub));
  process.stdout.write(`${out}: ${kept} players kept, ${left} under 18 or of unknown age left out; no photos, no logos.\n`);
}

publish('real-db.json', 'real-db.json');
publish('real-db-women.json', 'real-db-women.json');
