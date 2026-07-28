/**
 * Engine calibration.
 *
 * Runs a large sample of matches between generated squads and checks that the
 * emergent statistics match elite men's indoor volleyball. If the rally engine
 * drifts, this is what catches it — every target below is a real number from
 * top-flight competition, not a number chosen to make the engine look good.
 */

import { Rng } from '../engine/core/rng.ts';
import { PlayerStore } from '../engine/model/players.ts';
import { Position } from '../engine/model/positions.ts';
import { MatchFormat, simulateMatch, type TeamSetup } from '../engine/match/engine.ts';
import { defaultTactics } from '../engine/match/tactics.ts';
import { aggregateTeam, sideOutPct, type TeamMatchStats } from '../engine/match/stats.ts';
import { generatePlayer, rollPotential } from '../engine/world/playerGen.ts';
import { nationIndex } from '../engine/world/nations.ts';

export interface CalibrationTarget {
  name: string;
  actual: number;
  min: number;
  max: number;
  format: (v: number) => string;
}

/** Build a squad in the standard 5-1 rotational order. */
export function buildSquad(
  store: PlayerStore,
  rng: Rng,
  nation: number,
  strength: number,
  year: number,
  /**
   * When set, players are drawn close to this Potential Ability instead of
   * from the nation's full talent distribution. Calibration uses it so that
   * metrics like the five-set rate measure the rally engine rather than how
   * lopsided a pair of randomly drawn rosters happened to be.
   */
  paTarget?: number,
): TeamSetup {
  const make = (pos: Position, count: number, bias: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const age = rng.int(20, 33);
      const potential = paTarget !== undefined
        ? Math.round(paTarget * rng.range(0.93, 1.07))
        : rollPotential(rng, strength, bias);
      out.push(
        generatePlayer(store, rng, {
          nation,
          age,
          potential,
          position: pos,
          currentYear: year,
        }),
      );
    }
    // Best first.
    return out.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  };

  const setters = make(Position.Setter, 2, 1);
  const opposites = make(Position.Opposite, 2, 1);
  const outsides = make(Position.OutsideHitter, 4, 1);
  const middles = make(Position.MiddleBlocker, 4, 1);
  const liberos = make(Position.Libero, 2, 1);

  // Rotational order: setter and opposite diagonal, the two outsides diagonal,
  // the two middles diagonal.
  const lineup = [
    setters[0], middles[0], outsides[0],
    opposites[0], middles[1], outsides[1],
  ];
  const bench = [
    setters[1], opposites[1], outsides[2], outsides[3],
    middles[2], middles[3], liberos[1],
  ];

  return {
    clubId: 0,
    name: 'Test',
    lineup,
    libero: liberos[0],
    bench,
    tactics: defaultTactics(),
  };
}

export interface CalibrationReport {
  matches: number;
  targets: CalibrationTarget[];
  fiveSetRate: number;
  avgRalliesPerMatch: number;
  setScoreHistogram: Map<string, number>;
  ralliesPerSecond: number;
}

export function runCalibration(matches = 400, seed = 20260728): CalibrationReport {
  const rng = new Rng(seed);
  const store = new PlayerStore(4096);
  const year = 2026;

  // Two evenly matched top-flight squads, rebuilt periodically so the sample
  // is not dominated by one particular pair of rosters.
  let totalRallies = 0;
  let fiveSetters = 0;
  const setScores = new Map<string, number>();

  const acc = {
    serves: 0, aces: 0, serveErrors: 0,
    recTotal: 0, recPerfect: 0, recPositive: 0, recErrors: 0,
    attacks: 0, kills: 0, attackErrors: 0, blocked: 0,
    blockPoints: 0, digs: 0,
    sideOutNum: 0, sideOutDen: 0,
    sets: 0,
  };

  const start = process.hrtime.bigint();

  for (let m = 0; m < matches; m++) {
    if (m % 20 === 0) {
      // Fresh rosters every 20 matches.
      store.count = 0;
    }
    // A realistic top-division spread rather than two clones. Per-contact
    // rates (kill %, ace %, reception grades) barely move with squad quality,
    // but the five-set rate is meaningless unless the sample contains the mix
    // of close matches and mismatches a real league season contains.
    // Team quality within a division clusters around the middle rather than
    // spreading evenly, so it is drawn normally.
    const paTarget = (): number => rng.gaussianClamped(1500, 70, 1320, 1670);
    const home = buildSquad(store, rng, nationIndex('ITA'), 90, year, paTarget());
    const away = buildSquad(store, rng, nationIndex('POL'), 90, year, paTarget());

    const result = simulateMatch(store, {
      home, away,
      format: MatchFormat.BestOf5,
      importance: 0.5,
      neutralVenue: false,
      collectLog: false,
      seed: rng.next(),
    });

    totalRallies += result.totalRallies;
    if (result.setScores.length === 5) fiveSetters++;
    acc.sets += result.setScores.length;

    for (const [h, a] of result.setScores) {
      const hi = Math.max(h, a);
      const lo = Math.min(h, a);
      const key = `${hi}-${lo}`;
      setScores.set(key, (setScores.get(key) ?? 0) + 1);
    }

    for (const t of [result.stats.home, result.stats.away] as TeamMatchStats[]) {
      const s = aggregateTeam(t);
      acc.serves += s.servesTotal;
      acc.aces += s.serveAces;
      acc.serveErrors += s.serveErrors;
      acc.recTotal += s.receptionsTotal;
      acc.recPerfect += s.receptionPerfect;
      acc.recPositive += s.receptionPositive;
      acc.recErrors += s.receptionErrors;
      acc.attacks += s.attacksTotal;
      acc.kills += s.attackKills;
      acc.attackErrors += s.attackErrors;
      acc.blocked += s.attackBlocked;
      acc.blockPoints += s.blockPoints;
      acc.digs += s.digsTotal;
      for (const r of t.rotations) {
        acc.sideOutDen += r.receiveRallies;
        acc.sideOutNum += r.sideOutsWon;
      }
      void sideOutPct;
    }
  }

  const elapsedSec = Number(process.hrtime.bigint() - start) / 1e9;

  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const eff = (v: number): string => v.toFixed(3);

  const targets: CalibrationTarget[] = [
    {
      name: 'Side-out rate',
      actual: acc.sideOutNum / acc.sideOutDen,
      min: 0.60, max: 0.70, format: pct,
    },
    {
      name: 'Attack efficiency',
      actual: (acc.kills - acc.attackErrors - acc.blocked) / acc.attacks,
      min: 0.220, max: 0.360, format: eff,
    },
    {
      name: 'Kill rate',
      actual: acc.kills / acc.attacks,
      min: 0.44, max: 0.55, format: pct,
    },
    {
      name: 'Attack error rate',
      actual: acc.attackErrors / acc.attacks,
      min: 0.06, max: 0.14, format: pct,
    },
    {
      name: 'Blocked rate',
      actual: acc.blocked / acc.attacks,
      min: 0.04, max: 0.10, format: pct,
    },
    {
      name: 'Ace rate (of serves)',
      actual: acc.aces / acc.serves,
      min: 0.04, max: 0.09, format: pct,
    },
    {
      name: 'Serve error rate',
      actual: acc.serveErrors / acc.serves,
      min: 0.09, max: 0.18, format: pct,
    },
    {
      name: 'Reception positivity',
      actual: (acc.recPerfect + acc.recPositive) / acc.recTotal,
      min: 0.55, max: 0.75, format: pct,
    },
    {
      name: 'Reception perfect %',
      actual: acc.recPerfect / acc.recTotal,
      min: 0.25, max: 0.45, format: pct,
    },
    {
      name: 'Five-set match rate',
      actual: fiveSetters / matches,
      min: 0.15, max: 0.30, format: pct,
    },
    {
      name: 'Points per set (winner)',
      actual: acc.attacks / acc.sets / 2,
      min: 20, max: 34, format: (v) => v.toFixed(1),
    },
  ];

  return {
    matches,
    targets,
    fiveSetRate: fiveSetters / matches,
    avgRalliesPerMatch: totalRallies / matches,
    setScoreHistogram: setScores,
    ralliesPerSecond: totalRallies / elapsedSec,
  };
}
