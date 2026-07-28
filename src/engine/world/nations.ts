/**
 * The volleyball world.
 *
 * `strength` is a nation's volleyball development on a 0-100 scale: the depth
 * of its player pool and the quality of its coaching pipeline, not its current
 * FIVB ranking. It drives how many players a nation produces, how good they
 * are, and how strong its domestic league is. Values are set from the
 * long-run state of the men's game rather than any single season, so that a
 * new career starts from a plausible world and then diverges on its own.
 *
 * `heightBias` shifts generated anthropometrics in centimetres relative to the
 * global mean, reflecting real population differences that show up clearly in
 * volleyball rosters.
 *
 * `leagueTiers` is how deep the domestic pyramid runs — Italy and Poland
 * support several professional divisions, most nations support one.
 */

export interface NationDef {
  code: string;
  name: string;
  /** Volleyball development, 0-100. */
  strength: number;
  /** Relative size of the talent pool. */
  poolSize: number;
  heightBias: number;
  leagueTiers: number;
  nameGroup: string;
  /**
   * City bank for club names, when it differs from the personal-name group.
   * Canada and Australia share English naming with the USA but obviously not
   * its cities.
   */
  cityGroup?: string;
  confederation: Confederation;
}

export type Confederation = 'CEV' | 'CSV' | 'NORCECA' | 'AVC' | 'CAVB';

export const NATIONS: readonly NationDef[] = [
  // ---- Europe (CEV) ----
  { code: 'POL', name: 'Poland', strength: 96, poolSize: 9.0, heightBias: 3.0, leagueTiers: 3, nameGroup: 'polish', confederation: 'CEV' },
  { code: 'ITA', name: 'Italy', strength: 96, poolSize: 9.5, heightBias: 1.0, leagueTiers: 4, nameGroup: 'italian', confederation: 'CEV' },
  { code: 'FRA', name: 'France', strength: 91, poolSize: 8.0, heightBias: 1.0, leagueTiers: 3, nameGroup: 'french', confederation: 'CEV' },
  { code: 'SLO', name: 'Slovenia', strength: 84, poolSize: 2.0, heightBias: 2.5, leagueTiers: 2, nameGroup: 'slovene', confederation: 'CEV' },
  { code: 'SRB', name: 'Serbia', strength: 84, poolSize: 3.5, heightBias: 4.0, leagueTiers: 2, nameGroup: 'serbian', confederation: 'CEV' },
  { code: 'NED', name: 'Netherlands', strength: 78, poolSize: 4.0, heightBias: 4.5, leagueTiers: 2, nameGroup: 'dutch', confederation: 'CEV' },
  { code: 'GER', name: 'Germany', strength: 80, poolSize: 8.5, heightBias: 2.5, leagueTiers: 3, nameGroup: 'german', confederation: 'CEV' },
  { code: 'BUL', name: 'Bulgaria', strength: 79, poolSize: 3.0, heightBias: 2.0, leagueTiers: 2, nameGroup: 'bulgarian', confederation: 'CEV' },
  { code: 'UKR', name: 'Ukraine', strength: 74, poolSize: 5.0, heightBias: 2.5, leagueTiers: 2, nameGroup: 'ukrainian', confederation: 'CEV' },
  { code: 'TUR', name: 'Türkiye', strength: 78, poolSize: 7.5, heightBias: 0.5, leagueTiers: 3, nameGroup: 'turkish', confederation: 'CEV' },
  { code: 'RUS', name: 'Russia', strength: 88, poolSize: 9.0, heightBias: 3.5, leagueTiers: 3, nameGroup: 'russian', confederation: 'CEV' },
  { code: 'CZE', name: 'Czechia', strength: 68, poolSize: 3.0, heightBias: 2.5, leagueTiers: 2, nameGroup: 'czech', confederation: 'CEV' },
  { code: 'GRE', name: 'Greece', strength: 70, poolSize: 3.5, heightBias: 0.5, leagueTiers: 2, nameGroup: 'greek', confederation: 'CEV' },
  { code: 'BEL', name: 'Belgium', strength: 69, poolSize: 3.0, heightBias: 3.0, leagueTiers: 2, nameGroup: 'dutch', confederation: 'CEV' },
  { code: 'FIN', name: 'Finland', strength: 66, poolSize: 2.0, heightBias: 3.0, leagueTiers: 2, nameGroup: 'finnish', confederation: 'CEV' },
  { code: 'POR', name: 'Portugal', strength: 63, poolSize: 3.0, heightBias: -1.0, leagueTiers: 2, nameGroup: 'portuguese', confederation: 'CEV' },
  { code: 'ESP', name: 'Spain', strength: 64, poolSize: 6.0, heightBias: -0.5, leagueTiers: 2, nameGroup: 'spanish', confederation: 'CEV' },
  { code: 'CRO', name: 'Croatia', strength: 66, poolSize: 2.0, heightBias: 4.0, leagueTiers: 1, nameGroup: 'croatian', confederation: 'CEV' },
  { code: 'ROU', name: 'Romania', strength: 62, poolSize: 4.0, heightBias: 1.5, leagueTiers: 2, nameGroup: 'romanian', confederation: 'CEV' },
  { code: 'SVK', name: 'Slovakia', strength: 62, poolSize: 2.0, heightBias: 2.0, leagueTiers: 1, nameGroup: 'czech', confederation: 'CEV' },
  { code: 'EST', name: 'Estonia', strength: 64, poolSize: 1.0, heightBias: 3.0, leagueTiers: 1, nameGroup: 'estonian', confederation: 'CEV' },
  { code: 'LAT', name: 'Latvia', strength: 55, poolSize: 1.0, heightBias: 3.5, leagueTiers: 1, nameGroup: 'latvian', confederation: 'CEV' },
  { code: 'AUT', name: 'Austria', strength: 57, poolSize: 2.5, heightBias: 2.0, leagueTiers: 1, nameGroup: 'german', confederation: 'CEV' },
  { code: 'SUI', name: 'Switzerland', strength: 55, poolSize: 2.5, heightBias: 2.0, leagueTiers: 1, nameGroup: 'german', confederation: 'CEV' },
  { code: 'DEN', name: 'Denmark', strength: 52, poolSize: 1.5, heightBias: 3.5, leagueTiers: 1, nameGroup: 'nordic', confederation: 'CEV' },
  { code: 'SWE', name: 'Sweden', strength: 54, poolSize: 2.5, heightBias: 3.5, leagueTiers: 1, nameGroup: 'nordic', confederation: 'CEV' },
  { code: 'NOR', name: 'Norway', strength: 48, poolSize: 1.5, heightBias: 3.5, leagueTiers: 1, nameGroup: 'nordic', confederation: 'CEV' },
  { code: 'HUN', name: 'Hungary', strength: 56, poolSize: 2.5, heightBias: 1.5, leagueTiers: 1, nameGroup: 'hungarian', confederation: 'CEV' },
  { code: 'ISR', name: 'Israel', strength: 52, poolSize: 2.0, heightBias: 0.0, leagueTiers: 1, nameGroup: 'hebrew', confederation: 'CEV' },
  { code: 'MKD', name: 'North Macedonia', strength: 50, poolSize: 1.0, heightBias: 3.0, leagueTiers: 1, nameGroup: 'serbian', confederation: 'CEV' },
  { code: 'BIH', name: 'Bosnia & Herzegovina', strength: 52, poolSize: 1.5, heightBias: 4.0, leagueTiers: 1, nameGroup: 'serbian', confederation: 'CEV' },
  { code: 'MNE', name: 'Montenegro', strength: 50, poolSize: 0.7, heightBias: 5.0, leagueTiers: 1, nameGroup: 'serbian', confederation: 'CEV' },

  // ---- South America (CSV) ----
  { code: 'BRA', name: 'Brazil', strength: 98, poolSize: 10.0, heightBias: 0.5, leagueTiers: 3, nameGroup: 'brazilian', confederation: 'CSV' },
  { code: 'ARG', name: 'Argentina', strength: 85, poolSize: 6.0, heightBias: 0.0, leagueTiers: 2, nameGroup: 'argentine', confederation: 'CSV' },
  { code: 'CHI', name: 'Chile', strength: 55, poolSize: 2.5, heightBias: -1.5, leagueTiers: 1, nameGroup: 'spanish', confederation: 'CSV' },
  { code: 'COL', name: 'Colombia', strength: 53, poolSize: 3.0, heightBias: -2.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'CSV' },
  { code: 'VEN', name: 'Venezuela', strength: 56, poolSize: 2.5, heightBias: -1.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'CSV' },
  { code: 'PER', name: 'Peru', strength: 50, poolSize: 2.0, heightBias: -3.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'CSV' },
  { code: 'URU', name: 'Uruguay', strength: 46, poolSize: 1.0, heightBias: 0.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'CSV' },

  // ---- North & Central America (NORCECA) ----
  { code: 'USA', name: 'United States', strength: 92, poolSize: 9.5, heightBias: 2.0, leagueTiers: 2, nameGroup: 'american', confederation: 'NORCECA' },
  { code: 'CUB', name: 'Cuba', strength: 80, poolSize: 3.0, heightBias: 1.5, leagueTiers: 1, nameGroup: 'cuban', confederation: 'NORCECA' },
  { code: 'CAN', name: 'Canada', strength: 79, poolSize: 5.0, heightBias: 2.5, leagueTiers: 1, nameGroup: 'american', cityGroup: 'canadian', confederation: 'NORCECA' },
  { code: 'MEX', name: 'Mexico', strength: 55, poolSize: 5.0, heightBias: -2.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'NORCECA' },
  { code: 'PUR', name: 'Puerto Rico', strength: 58, poolSize: 1.5, heightBias: -1.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'NORCECA' },
  { code: 'DOM', name: 'Dominican Republic', strength: 54, poolSize: 2.0, heightBias: -1.0, leagueTiers: 1, nameGroup: 'spanish', confederation: 'NORCECA' },

  // ---- Asia & Oceania (AVC) ----
  { code: 'JPN', name: 'Japan', strength: 90, poolSize: 8.5, heightBias: -3.0, leagueTiers: 3, nameGroup: 'japanese', confederation: 'AVC' },
  { code: 'IRI', name: 'Iran', strength: 84, poolSize: 6.5, heightBias: 1.0, leagueTiers: 2, nameGroup: 'iranian', confederation: 'AVC' },
  { code: 'CHN', name: 'China', strength: 74, poolSize: 9.0, heightBias: 0.5, leagueTiers: 2, nameGroup: 'chinese', confederation: 'AVC' },
  { code: 'KOR', name: 'Korea', strength: 66, poolSize: 4.5, heightBias: -2.0, leagueTiers: 2, nameGroup: 'korean', confederation: 'AVC' },
  { code: 'QAT', name: 'Qatar', strength: 58, poolSize: 1.0, heightBias: 0.5, leagueTiers: 1, nameGroup: 'arabic', confederation: 'AVC' },
  { code: 'AUS', name: 'Australia', strength: 65, poolSize: 3.5, heightBias: 2.0, leagueTiers: 1, nameGroup: 'american', cityGroup: 'australian', confederation: 'AVC' },
  { code: 'IND', name: 'India', strength: 48, poolSize: 6.0, heightBias: -2.5, leagueTiers: 1, nameGroup: 'indian', confederation: 'AVC' },
  { code: 'THA', name: 'Thailand', strength: 52, poolSize: 3.0, heightBias: -4.0, leagueTiers: 1, nameGroup: 'thai', confederation: 'AVC' },
  { code: 'KAZ', name: 'Kazakhstan', strength: 54, poolSize: 2.0, heightBias: 2.0, leagueTiers: 1, nameGroup: 'russian', confederation: 'AVC' },

  // ---- Africa (CAVB) ----
  { code: 'EGY', name: 'Egypt', strength: 62, poolSize: 4.0, heightBias: 0.5, leagueTiers: 1, nameGroup: 'arabic', confederation: 'CAVB' },
  { code: 'TUN', name: 'Tunisia', strength: 60, poolSize: 2.0, heightBias: 0.0, leagueTiers: 1, nameGroup: 'arabic', confederation: 'CAVB' },
  { code: 'MAR', name: 'Morocco', strength: 50, poolSize: 2.5, heightBias: 0.0, leagueTiers: 1, nameGroup: 'arabic', confederation: 'CAVB' },
  { code: 'ALG', name: 'Algeria', strength: 52, poolSize: 2.5, heightBias: 0.5, leagueTiers: 1, nameGroup: 'arabic', confederation: 'CAVB' },
  { code: 'CMR', name: 'Cameroon', strength: 48, poolSize: 2.0, heightBias: 1.0, leagueTiers: 1, nameGroup: 'african', confederation: 'CAVB' },
  { code: 'RSA', name: 'South Africa', strength: 44, poolSize: 2.5, heightBias: 1.0, leagueTiers: 1, nameGroup: 'african', confederation: 'CAVB' },
];

export const NATION_BY_CODE: ReadonlyMap<string, number> = new Map(
  NATIONS.map((n, i) => [n.code, i]),
);

export function nationIndex(code: string): number {
  return NATION_BY_CODE.get(code) ?? 0;
}

/** Continental championships and their member nations. */
export const CONFEDERATIONS: readonly Confederation[] = ['CEV', 'CSV', 'NORCECA', 'AVC', 'CAVB'];

export const CONFEDERATION_NAMES: Readonly<Record<Confederation, string>> = {
  CEV: 'European Championship',
  CSV: 'South American Championship',
  NORCECA: 'NORCECA Championship',
  AVC: 'Asian Championship',
  CAVB: 'African Championship',
};

export function nationsIn(conf: Confederation): number[] {
  const out: number[] = [];
  NATIONS.forEach((n, i) => {
    if (n.confederation === conf) out.push(i);
  });
  return out;
}
