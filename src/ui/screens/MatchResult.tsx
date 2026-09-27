import type { JSX } from 'react';
import { matchRating } from '../../engine/match/playerRating.ts';
import { aggregateTeam, type PlayerMatchStats } from '../../engine/match/stats.ts';
import type { Position } from '../../engine/model/positions.ts';
import { POSITION_SHORT } from '../../engine/model/positions.ts';
import { PLAYOFF_ROUND_BASE } from '../../engine/season/schedule.ts';
import { ClubCrest, PlayerFace, RatingBadge } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { BoxScore } from './Match.tsx';

/** The stat that made a player of the match stand out, in words. */
function headlineStat(s: PlayerMatchStats, pos: Position): string {
  const pts = s.attackKills + s.serveAces + s.blockPoints;
  const options: Array<[number, string]> = [
    [pts, `${pts} points`],
    [s.digsTotal * 0.8, `${s.digsTotal} digs`],
    [s.setAssists * 0.45, `${s.setAssists} assists`],
    [s.blockPoints * 2.2, `${s.blockPoints} blocks`],
  ];
  if (POSITION_SHORT[pos] === 'L') return `${s.digsTotal} digs`;
  if (POSITION_SHORT[pos] === 'S') return `${s.setAssists} assists`;
  return options.sort((a, b) => b[0] - a[0])[0][1];
}

/**
 * Full time. The scoreline and every set, the player of the match, the team
 * stats side by side and each side's box score — and one button on: the rest
 * of the matchday's results come in with yours.
 */
export function MatchResultScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const watched = g.reviewLast();
  const fixture = g.postMatch !== null ? world.fixtures[g.postMatch] : undefined;
  if (fixture === undefined || watched === null || watched.fixture.id !== fixture.id) return null;

  const { result } = watched;
  const home = world.clubs[fixture.home];
  const away = world.clubs[fixture.away];
  const comp = world.competitions[fixture.competitionId];
  const homeWon = result.homeSets > result.awaySets;
  const me = world.userClubId;
  const userWon = (fixture.home === me) === homeWon;

  const mvpHome = result.stats.home.players.get(result.mvp);
  const mvpLine = mvpHome ?? result.stats.away.players.get(result.mvp);
  const mvpPos = store.position[result.mvp] as Position;
  const mvpRating = mvpLine === undefined ? null : matchRating(mvpLine, mvpPos,
    mvpHome !== undefined ? result.homeSets : result.awaySets,
    mvpHome !== undefined ? result.awaySets : result.homeSets);

  const h = aggregateTeam(result.stats.home);
  const a = aggregateTeam(result.stats.away);
  const pointsH = result.setScores.reduce((s, [x]) => s + x, 0);
  const pointsA = result.setScores.reduce((s, [, y]) => s + y, 0);
  const bars: Array<[string, number, number]> = [
    ['Kills', h.attackKills, a.attackKills],
    ['Blocks', h.blockPoints, a.blockPoints],
    ['Aces', h.serveAces, a.serveAces],
    ['Digs', h.digsTotal, a.digsTotal],
    ['Errors', h.attackErrors + h.serveErrors + h.receptionErrors, a.attackErrors + a.serveErrors + a.receptionErrors],
  ];

  const homeSide = fixture.home === me ? 'mine' : 'theirs';
  const awaySide = fixture.away === me ? 'mine' : 'theirs';
  const round = fixture.round >= PLAYOFF_ROUND_BASE ? 'Playoffs' : `Round ${fixture.round + 1}`;

  const teamRow = (clubId: number, sets: number, won: boolean, side: 0 | 1): JSX.Element => {
    const c = world.clubs[clubId];
    return (
      <div className={`mr-team${won ? ' won' : ''}${clubId === me ? ' mine' : ''}`}>
        {c !== undefined && <ClubCrest club={c} size={40} />}
        <span className="mr-team-name">{c?.name ?? '—'}</span>
        <span className="mr-sets-list">
          {result.setScores.map(([x, y], i) => {
            const mine = side === 0 ? x : y;
            const theirs = side === 0 ? y : x;
            return <span key={i} className={mine > theirs ? 'won' : ''}>{mine}</span>;
          })}
        </span>
        <span className="mr-sets">{sets}</span>
      </div>
    );
  };

  return (
    <div className="mr">
      <div className="mr-top">
        <section className="mr-card mr-score">
          <header className="mr-head">
            <span>{comp?.name ?? 'Match'} · {round}</span>
            <span className={`mr-final ${userWon ? 'good' : 'bad'}`}><span className="mr-dot" />Final</span>
          </header>
          {teamRow(fixture.home, result.homeSets, homeWon, 0)}
          {teamRow(fixture.away, result.awaySets, !homeWon, 1)}
          {result.mvp >= 0 && mvpLine !== undefined && (
            <div className="mr-mvp">
              <span className="mr-label">Player of the match</span>
              <div className="mr-mvp-row">
                <PlayerFace playerId={store.id[result.mvp]} name={store.fullName(result.mvp)} size={46} />
                <span className="mr-mvp-id">
                  <strong className="player-link" onClick={() => g.select(result.mvp)}>{store.fullName(result.mvp)}</strong>
                  <span className="dim">{headlineStat(mvpLine, mvpPos)}</span>
                </span>
                {mvpRating !== null && <RatingBadge value={mvpRating} size="lg" />}
              </div>
            </div>
          )}
          <footer className="mr-foot">
            <span>The rest of the matchday's results come in with yours.</span>
            <button className="primary" onClick={() => g.finishPostMatch()}>
              Continue <Icon name="arrowRight" size={15} />
            </button>
          </footer>
        </section>

        <section className="mr-card mr-stats">
          <header className="mr-head">
            <span>Match stats</span>
            <span>Points <b>{pointsH}–{pointsA}</b></span>
          </header>
          <div className="mr-stats-names">
            <span className={fixture.home === me ? 'gold' : ''}>{home?.name ?? '—'}</span>
            <span className={fixture.away === me ? 'gold' : ''}>{away?.name ?? '—'}</span>
          </div>
          {bars.map(([label, x, y]) => {
            const max = Math.max(1, x, y);
            const err = label === 'Errors';
            return (
              <div key={label} className="mr-bar">
                <b>{x}</b>
                <span className="mr-bar-track left"><span className={err ? 'err' : homeSide} style={{ width: `${(x / max) * 100}%` }} /></span>
                <span className="mr-bar-label">{label}</span>
                <span className="mr-bar-track"><span className={err ? 'err' : awaySide} style={{ width: `${(y / max) * 100}%` }} /></span>
                <b>{y}</b>
              </div>
            );
          })}
          <div className="mr-crowd">{result.totalRallies} rallies · {result.setScores.length} sets</div>
        </section>
      </div>

      <section className="mr-card mr-box">
        <header className="mr-head"><span>Box score</span></header>
        <div className="mr-box-body"><BoxScore /></div>
      </section>
    </div>
  );
}
