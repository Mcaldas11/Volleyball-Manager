import type { JSX } from 'react';
import { matchRating } from '../../engine/match/playerRating.ts';
import { aggregateTeam, type PlayerMatchStats } from '../../engine/match/stats.ts';
import type { Position } from '../../engine/model/positions.ts';
import { POSITION_SHORT } from '../../engine/model/positions.ts';
import { stageLabel } from '../../engine/season/cups.ts';
import { userNation } from '../../engine/world/internationals.ts';
import { ClubCrest, Flag, PlayerFace, RatingBadge } from '../components.tsx';
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
  const watched = g.resultShown();
  if (watched === null || g.postMatch === null || watched.fixture.id !== g.postMatch) return null;
  const fixture = watched.fixture;
  const national = watched.national !== undefined;

  const { result } = watched;
  const home = national ? undefined : world.clubs[fixture.home];
  const away = national ? undefined : world.clubs[fixture.away];
  const comp = world.competitions[fixture.competitionId];
  const homeWon = result.homeSets > result.awaySets;
  const me = national ? userNation(world) : world.userClubId;
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
  const heading = watched.national?.title ?? `${comp?.name ?? 'Match'} · ${stageLabel(world, fixture)}`;
  // The press want a word — the conference after the match, while it is open.
  const press = national ? null : g.postMatchInterview(fixture.id);

  const teamRow = (clubId: number, sets: number, won: boolean, side: 0 | 1): JSX.Element => {
    const c = national ? undefined : world.clubs[clubId];
    return (
      <div className={`mr-team${won ? ' won' : ''}${clubId === me ? ' mine' : ''}`}>
        {national ? <span className="side-flag mr-flag"><Flag nation={clubId} /></span> : c !== undefined && <ClubCrest club={c} size={40} />}
        <span className="mr-team-name">{side === 0 ? watched.homeName : watched.awayName}</span>
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
            <span>{heading}</span>
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
            <span>{national ? "The rest of the day's matches at the tournament come in with yours." : "The rest of the matchday's results come in with yours."}</span>
            {press !== null && !press.finished && (
              <button
                className="mr-press"
                onClick={() => g.openInterview(press.id)}
                title={`${press.crowd} journalists want your reaction`}
              >
                <Icon name="press" size={15} /> {press.currentIndex > 0 ? 'Back to the press' : 'Face the press'}
              </button>
            )}
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
            <span className={fixture.home === me ? 'gold' : ''}>{home?.name ?? watched.homeName}</span>
            <span className={fixture.away === me ? 'gold' : ''}>{away?.name ?? watched.awayName}</span>
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
        <div className="mr-box-body"><BoxScore watched={watched} /></div>
      </section>
    </div>
  );
}
