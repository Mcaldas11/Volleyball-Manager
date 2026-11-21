/**
 * Beside the live court: each player's match so far — points, attack, serve,
 * block, errors, reception and digs — for either side, every name a way to his
 * profile. It reads the same numbers the box score keeps at full time.
 */

import { useState, type CSSProperties, type JSX } from 'react';
import { Position } from '../engine/model/positions.ts';
import { useGame } from './state.ts';

/** The colour each position wears, so a name keeps it without a badge. */
const POS_VAR: Readonly<Record<Position, string>> = {
  [Position.Setter]: 's', [Position.OutsideHitter]: 'oh', [Position.Opposite]: 'opp', [Position.MiddleBlocker]: 'mb', [Position.Libero]: 'l',
};

export function LivePlayerStats({ names, ratings, onCourt }: {
  /** The two sides' short names, home first. */
  names: [string, string];
  ratings: Map<number, number>;
  /** Who is on court now, each side: they come first. */
  onCourt: [readonly number[], readonly number[]];
}): JSX.Element {
  const g = useGame();
  const md = g.matchday;
  const [team, setTeam] = useState<0 | 1>(md !== null && md.spectator === undefined && !md.userIsHome ? 1 : 0);
  const store = g.world!.players;
  const court = new Set(onCourt[team]);
  const rows = g.livePlayerStats(team).sort((a, b) =>
    Number(court.has(b.playerIdx)) - Number(court.has(a.playerIdx)) ||
    (b.attackKills + b.serveAces + b.blockPoints) - (a.attackKills + a.serveAces + a.blockPoints));
  return (
    <div className="lv-stats">
      <div className="lv-stats-pick" role="tablist">
        {names.map((n, i) => (
          <button key={i} role="tab" className={team === i ? 'on' : ''} onClick={() => setTeam(i as 0 | 1)}>{n}</button>
        ))}
      </div>
      <div className="lv-stats-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num" title="Points: kills, aces and blocks">Pts</th>
              <th className="num" title="Kills / attacks">K/Att</th>
              <th className="num" title="Aces">Ace</th>
              <th className="num" title="Block points">Blk</th>
              <th className="num" title="Errors: attack, serve, reception and block">Err</th>
              <th className="num" title="Reception: perfect or positive, of all received">Rec+</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="faint">No rally played yet.</td></tr>
            )}
            {rows.map((s) => {
              const p = s.playerIdx;
              const errors = s.attackErrors + s.serveErrors + s.receptionErrors + s.blockErrors;
              const rec = s.receptionsTotal > 0
                ? `${Math.round(((s.receptionPerfect + s.receptionPositive) / s.receptionsTotal) * 100)}%` : '—';
              const r = ratings.get(p);
              return (
                <tr key={p} className={court.has(p) ? '' : 'lv-stats-off'}>
                  <td className="strong">
                    <span className="lv-stats-who" style={{ '--pos-c': `var(--pos-${POS_VAR[store.position[p] as Position]})` } as CSSProperties}>
                      <span className="player-link" title={`${store.fullName(p)}${r !== undefined ? ` · rating ${r.toFixed(1)}` : ''} · ${s.digsTotal} digs, open his profile`} onClick={() => g.select(p)}>
                        {store.shortName(p)}
                      </span>
                    </span>
                  </td>
                  <td className="num"><b>{s.attackKills + s.serveAces + s.blockPoints}</b></td>
                  <td className="num dim">{s.attackKills}/{s.attacksTotal}</td>
                  <td className="num">{s.serveAces}</td>
                  <td className="num">{s.blockPoints}</td>
                  <td className={`num${errors > 0 ? ' bad' : ''}`}>{errors}</td>
                  <td className="num">{rec}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
