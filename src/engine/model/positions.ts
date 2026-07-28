/**
 * Positions and the cost of playing out of position.
 */

export enum Position {
  Setter = 0,
  Opposite = 1,
  OutsideHitter = 2,
  MiddleBlocker = 3,
  Libero = 4,
}

export const POSITIONS = [
  Position.Setter,
  Position.Opposite,
  Position.OutsideHitter,
  Position.MiddleBlocker,
  Position.Libero,
] as const;

export const POSITION_NAMES: Readonly<Record<Position, string>> = {
  [Position.Setter]: 'Setter',
  [Position.Opposite]: 'Opposite',
  [Position.OutsideHitter]: 'Outside Hitter',
  [Position.MiddleBlocker]: 'Middle Blocker',
  [Position.Libero]: 'Libero',
};

export const POSITION_SHORT: Readonly<Record<Position, string>> = {
  [Position.Setter]: 'S',
  [Position.Opposite]: 'OPP',
  [Position.OutsideHitter]: 'OH',
  [Position.MiddleBlocker]: 'MB',
  [Position.Libero]: 'L',
};

/**
 * Familiarity when a player fills a role that is not their natural one, as a
 * multiplier on their effective rating in that role.
 *
 * The asymmetries are the real ones. An outside can cover libero passably
 * (same skill set, minus the specialism). A libero cannot play opposite at
 * all — they are typically 15cm too short to attack over a block, which is why
 * that entry is punishing rather than merely bad. Middles converting to
 * outside is a common youth pathway; the reverse is rare because middles need
 * different footwork and blocking reads.
 */
const OUT_OF_POSITION: Readonly<Record<Position, Readonly<Record<Position, number>>>> = {
  [Position.Setter]: {
    [Position.Setter]: 1.0,
    [Position.Opposite]: 0.72,
    [Position.OutsideHitter]: 0.6,
    [Position.MiddleBlocker]: 0.45,
    [Position.Libero]: 0.66,
  },
  [Position.Opposite]: {
    [Position.Setter]: 0.6,
    [Position.Opposite]: 1.0,
    [Position.OutsideHitter]: 0.82,
    [Position.MiddleBlocker]: 0.62,
    [Position.Libero]: 0.4,
  },
  [Position.OutsideHitter]: {
    [Position.Setter]: 0.5,
    [Position.Opposite]: 0.84,
    [Position.OutsideHitter]: 1.0,
    [Position.MiddleBlocker]: 0.62,
    [Position.Libero]: 0.74,
  },
  [Position.MiddleBlocker]: {
    [Position.Setter]: 0.42,
    [Position.Opposite]: 0.66,
    [Position.OutsideHitter]: 0.64,
    [Position.MiddleBlocker]: 1.0,
    [Position.Libero]: 0.35,
  },
  [Position.Libero]: {
    [Position.Setter]: 0.6,
    [Position.Opposite]: 0.22,
    [Position.OutsideHitter]: 0.44,
    [Position.MiddleBlocker]: 0.2,
    [Position.Libero]: 1.0,
  },
};

/**
 * Effectiveness multiplier for `player` (natural position `natural`, with an
 * optional trained secondary) playing at `role`.
 *
 * A trained secondary position closes most but not all of the gap.
 */
export function positionalEffectiveness(
  natural: Position,
  secondary: Position | -1,
  role: Position,
): number {
  if (natural === role) return 1.0;
  const base = OUT_OF_POSITION[natural][role];
  if (secondary === role) {
    // Trained secondary recovers ~70% of the shortfall.
    return base + (1.0 - base) * 0.7;
  }
  return base;
}

/**
 * Which positions a player of a given natural position can plausibly be
 * trained into as a secondary.
 */
export const PLAUSIBLE_SECONDARY: Readonly<Record<Position, readonly Position[]>> = {
  [Position.Setter]: [Position.Opposite, Position.Libero],
  [Position.Opposite]: [Position.OutsideHitter, Position.Setter],
  [Position.OutsideHitter]: [Position.Opposite, Position.Libero, Position.MiddleBlocker],
  [Position.MiddleBlocker]: [Position.OutsideHitter, Position.Opposite],
  [Position.Libero]: [Position.OutsideHitter, Position.Setter],
};

/**
 * Squad shape for a professional roster: how many of each position a club
 * wants under contract. Used by squad building and the transfer AI.
 */
export const SQUAD_TARGET: Readonly<Record<Position, number>> = {
  [Position.Setter]: 2,
  [Position.Opposite]: 2,
  [Position.OutsideHitter]: 4,
  [Position.MiddleBlocker]: 4,
  [Position.Libero]: 2,
};

/** The six on-court roles in a standard rotation, excluding the libero. */
export const COURT_SIZE = 6;
