/**
 * The end-of-season review, as the inbox shows it: where the club finished,
 * the season's numbers, the club's own awards, the transfer business and the
 * books — laid out to read top to bottom in the message pane.
 */

import type { JSX } from 'react';
import type { Position } from '../engine/model/positions.ts';
import type { SeasonReview, SeasonReviewAward, SeasonReviewMove } from '../engine/world/world.ts';
import {
  ClubCrest, ClubLink, clubThemeStyle, money, PlayerFace, PlayerLink, Pos, RatingBadge,
} from './components.tsx';
import { Icon, type IconName } from './icons.tsx';
import { useGame } from './state.ts';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const AWARD_TITLE: Readonly<Record<SeasonReviewAward['kind'], [string, IconName]>> = {
  player: ['Player of the Season', 'star'],
  scorer: ['Top Scorer', 'ball'],
  signing: ['Best Signing', 'transfers'],
  young: ['Breakthrough Player', 'youth'],
  improved: ['Most Improved', 'training'],
};

function awardDetail(a: SeasonReviewAward): string {
  const apps = `${a.apps} app${a.apps === 1 ? '' : 's'}`;
  switch (a.kind) {
    case 'player': return `${apps} · ${a.points} pts · ${a.mvps} PoM`;
    case 'scorer': return `${a.points} pts in ${apps}`;
    case 'signing': return `${a.fee > 0 ? `Signed for ${money(a.fee)}` : 'Free transfer'} · ${apps}`;
    case 'young': return `${apps} · ${a.points} pts`;
    case 'improved': return `Ability +${a.gain} · ${apps}`;
    default: return apps;
  }
}

export function SeasonReviewReport({ review }: { review: SeasonReview }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = world.clubs[review.clubId];
  const y = world.startYear + review.season;
  const label = `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
  const league = review.standings.find((s) => world.competitions[s.competitionId]?.kind === 'league');
  const played = review.won + review.lost;
  const totalIncome = review.income.reduce((s, [, v]) => s + v, 0);
  const totalCosts = review.costs.reduce((s, [, v]) => s + v, 0);
  const result = totalIncome - totalCosts;
  const maxLine = Math.max(1, ...review.income.map(([, v]) => v), ...review.costs.map(([, v]) => v));

  const outcome = league?.champion
    ? { text: 'Champions', cls: 'gold', icon: 'trophy' as IconName }
    : review.movement === 'promoted'
      ? { text: 'Promoted', cls: 'good', icon: 'forward' as IconName }
      : review.movement === 'relegated'
        ? { text: 'Relegated', cls: 'bad', icon: 'back' as IconName }
        : null;

  return (
    <div className="sr">
      <div className="sr-hero themed" style={club !== undefined ? clubThemeStyle(club) : undefined}>
        {club !== undefined && <ClubCrest club={club} size={54} />}
        <div className="sr-hero-text">
          <span className="sr-kicker">{label} · Season review</span>
          <strong className="sr-hero-title">
            {league === undefined ? club?.name : league.champion ? 'League champions' : `${ordinal(league.position)} place`}
          </strong>
          {league !== undefined && (
            <span className="sr-hero-sub">
              {world.competitions[league.competitionId]?.name} · {league.teams} teams
            </span>
          )}
        </div>
        {outcome !== null && (
          <span className={`sr-outcome ${outcome.cls}`}><Icon name={outcome.icon} size={14} /> {outcome.text}</span>
        )}
      </div>

      <div className="sr-figures">
        <Figure label="Played" value={played} />
        <Figure label="Won" value={review.won} tone="good" />
        <Figure label="Lost" value={review.lost} tone="bad" />
        <Figure label="Win rate" value={played > 0 ? `${Math.round((review.won / played) * 100)}%` : '—'} />
        <Figure label="Best run" value={review.longestWinStreak} sub="wins in a row" />
      </div>

      <section className="sr-section">
        <h4 className="section-label"><Icon name="trophy" size={13} /> Competitions</h4>
        <div className="sr-comps">
          {review.standings.map((s) => (
            <div className={`sr-comp${s.champion ? ' champion' : ''}`} key={s.competitionId}>
              <span className="sr-comp-pos">{s.champion ? <Icon name="trophy" size={18} /> : ordinal(s.position)}</span>
              <span className="sr-comp-main">
                <strong>{world.competitions[s.competitionId]?.name ?? 'Competition'}</strong>
                <span className="faint">
                  {s.champion ? 'Winners' : `${ordinal(s.position)} of ${s.teams}`}
                  {s.tablePosition !== s.position && ` · ${ordinal(s.tablePosition)} after the regular season`}
                </span>
              </span>
              <span className="sr-comp-stats">
                <span><b>{s.won}</b>–<b>{s.lost}</b></span>
                <span className="faint">{s.points} pts · sets {s.setsFor}–{s.setsAgainst}</span>
              </span>
            </div>
          ))}
          {review.standings.length === 0 && <p className="empty">No competitive matches played.</p>}
        </div>
      </section>

      {review.awards.length > 0 && (
        <section className="sr-section">
          <h4 className="section-label"><Icon name="star" size={13} /> Club awards</h4>
          <div className="sr-awards">
            {review.awards.map((a) => {
              const [title, icon] = AWARD_TITLE[a.kind];
              return (
                <div className={`sr-award sr-award-${a.kind}`} key={a.kind} onClick={() => g.select(a.playerIdx)}>
                  <span className="sr-award-title"><Icon name={icon} size={13} /> {title}</span>
                  <div className="sr-award-body">
                    <PlayerFace playerId={world.players.id[a.playerIdx]} name={world.players.fullName(a.playerIdx)} size={40} />
                    <span className="sr-award-who">
                      <PlayerLink idx={a.playerIdx} />
                      <span className="faint">{awardDetail(a)}</span>
                    </span>
                    <span className="sr-award-side">
                      <Pos pos={world.players.position[a.playerIdx] as Position} />
                      {a.rating > 0 && <RatingBadge value={a.rating} title="Average match rating" />}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="sr-section">
        <h4 className="section-label"><Icon name="stats" size={13} /> Highlights</h4>
        <div className="sr-highlights">
          {review.biggestWin !== null && (
            <div className="sr-highlight">
              <span className="sr-highlight-label">Biggest win</span>
              <span className="sr-highlight-main">
                <b>{review.biggestWin.setsFor}–{review.biggestWin.setsAgainst}</b> v <ClubLink id={review.biggestWin.opponent} />
              </span>
              <span className="faint mono">{review.biggestWin.setScores.map(([a, b]) => `${a}-${b}`).join('  ')}</span>
            </div>
          )}
          <div className="sr-highlight">
            <span className="sr-highlight-label">Home</span>
            <span className="sr-highlight-main"><b>{review.homeWon}</b> won · <b>{review.homeLost}</b> lost</span>
          </div>
          <div className="sr-highlight">
            <span className="sr-highlight-label">Away</span>
            <span className="sr-highlight-main"><b>{review.awayWon}</b> won · <b>{review.awayLost}</b> lost</span>
          </div>
        </div>
      </section>

      <section className="sr-section">
        <h4 className="section-label"><Icon name="transfers" size={13} /> Transfers</h4>
        <div className="sr-two">
          <MoveList title="In" moves={review.signings} direction="in" />
          <MoveList title="Out" moves={review.departures} direction="out" />
        </div>
        <div className="sr-totals">
          <span>Spent <b className="bad">{money(review.transferSpend)}</b></span>
          <span>Received <b className="good">{money(review.transferIncome)}</b></span>
          <span>
            Net <b className={review.transferIncome - review.transferSpend < 0 ? 'bad' : 'good'}>
              {money(review.transferIncome - review.transferSpend)}
            </b>
          </span>
        </div>
      </section>

      <section className="sr-section">
        <h4 className="section-label"><Icon name="finances" size={13} /> Finances</h4>
        <div className="sr-two">
          <div className="sr-books">
            <span className="sr-books-title">Income</span>
            {review.income.map(([k, v]) => <BookLine key={k} label={k} value={v} max={maxLine} tone="income" />)}
            <div className="sr-books-total"><span>Total</span><b className="good">{money(totalIncome)}</b></div>
          </div>
          <div className="sr-books">
            <span className="sr-books-title">Expenditure</span>
            {review.costs.map(([k, v]) => <BookLine key={k} label={k} value={v} max={maxLine} tone="cost" />)}
            <div className="sr-books-total"><span>Total</span><b className="bad">{money(-totalCosts)}</b></div>
          </div>
        </div>
        <div className="sr-totals">
          <span>Season result <b className={result < 0 ? 'bad' : 'good'}>{result > 0 ? '+' : ''}{money(result)}</b></span>
          <span>Balance now <b className={review.closingBalance < 0 ? 'bad' : ''}>{money(review.closingBalance)}</b></span>
        </div>
      </section>
    </div>
  );
}

function Figure({
  label, value, sub, tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'good' | 'bad';
}): JSX.Element {
  return (
    <div className="sr-figure">
      <span className="sr-figure-label">{label}</span>
      <span className={`sr-figure-value${tone !== undefined ? ` ${tone}` : ''}`}>{value}</span>
      {sub !== undefined && <span className="sr-figure-sub">{sub}</span>}
    </div>
  );
}

function MoveList({
  title, moves, direction,
}: {
  title: string;
  moves: readonly SeasonReviewMove[];
  direction: 'in' | 'out';
}): JSX.Element {
  return (
    <div className="sr-moves">
      <span className="sr-books-title">{title} <span className="faint">({moves.length})</span></span>
      {moves.length === 0 && <span className="faint sr-moves-none">No {direction === 'in' ? 'signings' : 'departures'}.</span>}
      {moves.map((m, i) => (
        <div className="sr-move" key={`${m.playerIdx}-${i}`}>
          <span className={`sr-move-arrow ${direction}`}>{direction === 'in' ? '▲' : '▼'}</span>
          <span className="sr-move-who">
            <PlayerLink idx={m.playerIdx} short />
            <span className="faint">
              {direction === 'in' ? 'from ' : 'to '}
              {m.clubId >= 0 ? <ClubLink id={m.clubId} short crest={false} /> : direction === 'in' ? 'free agency' : 'released'}
            </span>
          </span>
          <span className="sr-move-fee">{m.fee > 0 ? money(m.fee) : 'Free'}</span>
        </div>
      ))}
    </div>
  );
}

function BookLine({
  label, value, max, tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'income' | 'cost';
}): JSX.Element {
  return (
    <div className="sr-book-line">
      <span className="sr-book-label">{label}</span>
      <span className={`money-line-bar ${tone}`}><span style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></span>
      <span className={`sr-book-value ${tone === 'income' ? 'good' : 'bad'}`}>{money(tone === 'income' ? value : -value)}</span>
    </div>
  );
}
