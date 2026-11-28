/**
 * The shape of a local real-data file: real clubs and their rosters, gathered
 * from public federation and league pages by `scripts/real-db/fetch.ts`.
 *
 * No such file ships with the game. It is written to `data/local/` (git-ignored)
 * on the machine that ran the import, and the dev server alone hands it to the
 * game; the itch.io and desktop builds never see it.
 */

export type RealPosition = 'S' | 'OH' | 'OP' | 'MB' | 'L';

export interface RealPlayer {
  first: string;
  last: string;
  position: RealPosition | null;
  /** FIVB nation code, when the source gives one. */
  nation: string | null;
  birthYear: number | null;
  /** Day of the year, 0-364, when the source gives a full date. */
  birthDay: number | null;
  heightCm: number | null;
  weightKg: number | null;
  spikeReachCm: number | null;
  blockReachCm: number | null;
  shirt: number | null;
  /** His photo, a file in `data/local/real-photos/`, when the source has one. */
  photo?: string | null;
  /** Ability and potential set by hand (0-2000), in place of the estimate. */
  ability?: number;
  /** Attributes set by hand (1-20), by name: the rest are fitted to the ability set. */
  attributes?: Record<string, number>;
  potential?: number;
  /** A second position he plays in full, when known (from a hand correction). */
  secondary?: RealPosition | null;
  /** Where he has played, a season at a time: the year the season began, and the club. */
  career?: { year: number; club: string; apps?: number; points?: number }[];
  /** Other names he goes by on other sites ("José Neto" for "José N. Pinto"). */
  aka?: string[];
}

export interface RealCoach {
  first: string;
  last: string;
  role: 'head' | 'assistant';
  /** His photo, a file in `data/local/real-photos/`, when the source has one. */
  photo?: string | null;
}

export interface RealClub {
  name: string;
  shortName: string;
  city: string | null;
  arena: string | null;
  /** Place in the source's current table, 1 = top; null when unknown. */
  standing: number | null;
  /** The club's logo, a file in `data/local/real-logos/`, when the source has one. */
  logo?: string | null;
  /** Head coach and assistant, for top-flight clubs. */
  coaches?: RealCoach[];
  /** The club's under-21 (or under-20) squad, for top-flight clubs where the federation lists one. */
  youth?: RealPlayer[];
  /** The under-21 division its under-21 side plays in this season (1 or 2), where the federation has them. */
  under21Division?: 1 | 2;
  players: RealPlayer[];
}

export interface RealLeague {
  /** FIVB code of the league's country. */
  nation: string;
  /** 1 for the top flight, 2 for the division below. */
  tier: number;
  name: string;
  season: string;
  source: string;
  url: string;
  /** The league's logo, a file in `data/local/real-logos/`. */
  logo?: string | null;
  clubs: RealClub[];
}

export interface RealInternational {
  nation: string;
  first: string;
  last: string;
  position: RealPosition | null;
  /** Birth and height where a source has them: without a birth date he is not written over a generated player. */
  birthYear?: number;
  birthDay?: number;
  heightCm?: number;
  /** His Wikipedia page, when there is one. */
  wiki?: string;
}

/** A national team's head coach, as at the 2025 World Championship. */
export interface RealNationalCoach {
  nation: string;
  first: string;
  last: string;
}

export interface RealDb {
  version: 1;
  /** ISO time the file was written. */
  builtAt: string;
  gender: 'men' | 'women';
  sources: { name: string; url: string; note: string }[];
  leagues: RealLeague[];
  /** National-team rosters: who has caps, and the nation of players whose club page leaves it out. */
  internationals: RealInternational[];
  internationalsSource: string;
  nationalCoaches?: RealNationalCoach[];
}

/** Where the dev server serves the file from, when there is one. */
export const REAL_DB_URL = '/__local/real-db.json';
/** The women's file. */
export const REAL_DB_WOMEN_URL = '/__local/real-db-women.json';
/** Where the dev server serves the logos from. */
export const REAL_LOGO_URL = '/__local/real-logos/';
/** Where the dev server serves the players' photos from. */
export const REAL_PHOTO_URL = '/__local/real-photos/';
