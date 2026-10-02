/**
 * International news of the manager's players, drawn rather than told: the
 * call-up as a row of player cards; each match day as the scoreboard — flags,
 * sets, every set's score — over a card for each of his players in it, with
 * his rating, his points and where they came from, and the rest of his
 * game; and the way home as each player's whole tournament, medal and all.
 */

import type { CSSProperties, JSX } from 'react';
import { POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import type {
  IntlMatchCard, IntlPlayerLine, IntlReport, IntlTournamentLine,
} from '../engine/world/internationals.ts';
import { NATIONS } from '../engine/world/nations.ts';
import { Flag, PlayerFace, POSITION_ACCENT, RatingBadge } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';
import { NationalTactics, PlayerTable, SquadPicker } from './screens/National.tsx';

function nationName(n: number): string {
  return NATIONS[n]?.name ?? '?';
}

function pct(n: number, of: number): string {
  return of > 0 ? `${Math.round((n / of) * 100)}%` : '—';
}

export function IntlReportSheet({ report }: { report: IntlReport }): JSX.Element | null {
  if (report.kind === 'callup' && report.callUps !== undefined) return <CallUps report={report} />;
  if (report.kind === 'matchday' && report.matches !== undefined) {
    return <div className="ir">{report.matches.map((m, i) => <MatchCard key={i} card={m} />)}</div>;
  }
  if (report.kind === 'homecoming' && report.lines !== undefined) return <Homecoming report={report} />;
  if (report.kind === 'squad') return <SquadCall report={report} />;
  return null;
}

/**
 * The federation's message: the players to choose from, for the manager to
 * name his fourteen and say how they will play — or, once the squad is in,
 * the fourteen who went.
 */
function SquadCall({ report }: { report: IntlReport }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const t = world.internationals?.tournaments.find((x) => x.id === report.tournamentId);
  const nation = world.career.nationalTeam;
  if (t === undefined || nation === undefined || !t.teams.includes(nation)) {
    return <div className="paper-report"><p className="paper-muted">This squad is no longer yours to name.</p></div>;
  }
  if (t.status === 'planned') {
    return (
      <div className="paper-embed nat-in-paper">
        <NationalTactics />
        <SquadPicker key={t.id} t={t} nation={nation} compact />
      </div>
    );
  }
  return (
    <div className="paper-embed nat-in-paper">
      <h3 className="nat-h">The fourteen at the {t.name}</h3>
      <PlayerTable players={[...(t.squads.find(([n]) => n === nation)?.[1] ?? [])]} t={t} />
    </div>
  );
}

/** A player's face, name and position, linked to his profile. */
function Who({ p, size = 44, sub }: { p: number; size?: number; sub?: JSX.Element | string }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const pos = store.position[p] as Position;
  return (
    <div className="ir-who">
      <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={size} />
      <div className="ir-who-text">
        <strong className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</strong>
        <span className="ir-who-sub">
          <span className="ir-pos" style={{ '--pos': POSITION_ACCENT[pos] } as CSSProperties}>{POSITION_SHORT[pos]}</span>
          {sub}
        </span>
      </div>
    </div>
  );
}

// ---- The call-up -----------------------------------------------------------------------------

function CallUps({ report }: { report: IntlReport }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  return (
    <div className="ir">
      <div className="paper-label">Called up · {report.tournament}</div>
      <div className="ir-callups">
        {report.callUps!.map((c) => (
          <div key={c.p} className="ir-callup">
            <span className="ir-callup-flag"><Flag nation={c.nation} /></span>
            <Who p={c.p} size={52} sub={nationName(c.nation)} />
            <div className="ir-callup-foot">
              {c.caps === 0
                ? <span className="ir-badge first"><Icon name="star" size={11} /> First call-up</span>
                : <span className="ir-badge">{c.caps} cap{c.caps === 1 ? '' : 's'}</span>}
              <span className="ir-callup-ability" title="Current ability"><small>Ability</small> {store.currentAbility[c.p]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- A match day -----------------------------------------------------------------------------

function MatchCard({ card }: { card: IntlMatchCard }): JSX.Element {
  const homeWon = card.homeSets > card.awaySets;
  const ourNations = new Set(card.players.map((l) => l.nation));
  return (
    <section className="ir-match">
      <header className="ir-scoreboard">
        <div className={`ir-side${homeWon ? ' won' : ''}${ourNations.has(card.home) ? ' ours' : ''}`}>
          <span className="ir-flag"><Flag nation={card.home} /></span>
          <span className="ir-side-name">{nationName(card.home)}</span>
        </div>
        <div className="ir-center">
          <span className="ir-stage">{card.stage}</span>
          <span className="ir-sets">
            <b className={homeWon ? 'won' : ''}>{card.homeSets}</b>
            <span className="ir-dash">–</span>
            <b className={!homeWon ? 'won' : ''}>{card.awaySets}</b>
          </span>
          <span className="ir-set-scores">
            {card.setScores.map(([h, a], i) => (
              <span key={i} className="ir-set-chip">
                <span className={h > a ? 'won' : ''}>{h}</span>
                <span className={a > h ? 'won' : ''}>{a}</span>
              </span>
            ))}
          </span>
        </div>
        <div className={`ir-side right${!homeWon ? ' won' : ''}${ourNations.has(card.away) ? ' ours' : ''}`}>
          <span className="ir-side-name">{nationName(card.away)}</span>
          <span className="ir-flag"><Flag nation={card.away} /></span>
        </div>
      </header>
      <div className="ir-lines">
        {card.players.map((l) => <PlayerLine key={l.p} l={l} card={card} />)}
      </div>
    </section>
  );
}

/** Points by where they came from, as one bar. */
function PointsBar({ l }: { l: IntlPlayerLine }): JSX.Element {
  const total = Math.max(1, l.points);
  const parts: Array<[string, number, string]> = [
    ['Kills', l.kills, 'kill'],
    ['Blocks', l.blocks, 'block'],
    ['Aces', l.aces, 'ace'],
  ];
  return (
    <div className="ir-points">
      <div className="ir-points-head">
        <b>{l.points}</b> <span>point{l.points === 1 ? '' : 's'}</span>
      </div>
      <div className="ir-points-bar">
        {parts.map(([label, n, cls]) => n > 0 && (
          <span key={label} className={`ir-seg ${cls}`} style={{ width: `${(n / total) * 100}%` }} title={`${n} ${label.toLowerCase()}`} />
        ))}
      </div>
      <div className="ir-points-legend">
        {parts.map(([label, n, cls]) => (
          <span key={label}><i className={`ir-dot ${cls}`} />{n} {label.toLowerCase()}</span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'good' | 'bad' }): JSX.Element {
  return (
    <div className="ir-stat">
      <b className={tone ?? ''}>{value}</b>
      <span>{label}</span>
      {sub !== undefined && <small>{sub}</small>}
    </div>
  );
}

function PlayerLine({ l, card }: { l: IntlPlayerLine; card: IntlMatchCard }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const opp = card.home === l.nation ? card.away : card.home;
  const won = (card.home === l.nation) === (card.homeSets > card.awaySets);
  const pos = store.position[l.p] as Position;
  const sub = <><Flag nation={l.nation} /> {nationName(l.nation)} {won ? 'beat' : 'lost to'} {nationName(opp)}</>;

  if (l.absent !== undefined) {
    return (
      <div className="ir-line absent">
        <Who p={l.p} sub={sub} />
        <span className={`ir-absent ${l.absent}`}>
          <Icon name={l.absent === 'injured' ? 'medical' : 'clock'} size={14} />
          {l.absent === 'injured' ? 'Missed the match injured' : 'Did not get on court'}
        </span>
      </div>
    );
  }

  const setter = POSITION_SHORT[pos] === 'S';
  const libero = POSITION_SHORT[pos] === 'L';
  const killRate = l.attacks > 0 ? l.kills / l.attacks : 0;
  const recRate = l.receptions > 0 ? l.goodReceptions / l.receptions : 0;
  return (
    <div className={`ir-line${l.mvp ? ' mvp' : ''}`}>
      <div className="ir-line-top">
        <Who p={l.p} sub={sub} />
        {l.mvp && <span className="ir-mvp"><Icon name="star" size={12} /> Man of the match</span>}
        <div className="ir-rating">
          <RatingBadge value={l.rating} size="lg" />
          <span>Rating</span>
        </div>
      </div>
      <div className="ir-line-body">
        {!libero && <PointsBar l={l} />}
        <div className="ir-stats">
          {!libero && !setter && (
            <Stat label="Attack" value={`${l.kills}/${l.attacks}`} sub={l.attacks > 0 ? `${pct(l.kills, l.attacks)} kill rate` : undefined}
              tone={l.attacks >= 5 ? (killRate >= 0.5 ? 'good' : killRate < 0.35 ? 'bad' : undefined) : undefined} />
          )}
          {setter && <Stat label="Assists" value={l.assists} />}
          {l.receptions > 0 && (
            <Stat label="Reception" value={pct(l.goodReceptions, l.receptions)} sub={`${l.receptions} pass${l.receptions === 1 ? '' : 'es'}`}
              tone={l.receptions >= 5 ? (recRate >= 0.6 ? 'good' : recRate < 0.4 ? 'bad' : undefined) : undefined} />
          )}
          <Stat label="Digs" value={l.digs} />
          {!libero && <Stat label="Blocks" value={l.blocks} />}
          {!libero && <Stat label="Aces" value={l.aces} />}
        </div>
      </div>
    </div>
  );
}

// ---- The way home ----------------------------------------------------------------------------

const PLACE_CLASS = ['gold', 'silver', 'bronze', 'fourth'];

function Homecoming({ report }: { report: IntlReport }): JSX.Element {
  // Out before the end has no final place yet (-1): those come last.
  const rank = (l: IntlTournamentLine): number => (l.place < 0 ? 99 : l.place);
  const lines = [...report.lines!].sort((a, b) => rank(a) - rank(b) || b.avg - a.avg);
  return (
    <div className="ir">
      <div className="paper-label">Their tournament · {report.tournament}</div>
      <div className="ir-home">
        {lines.map((l) => <HomeLine key={l.p} l={l} />)}
      </div>
    </div>
  );
}

function HomeLine({ l }: { l: IntlTournamentLine }): JSX.Element {
  const medal = PLACE_CLASS[l.place] ?? 'out';
  const finish = l.finish.charAt(0).toUpperCase() + l.finish.slice(1);
  return (
    <div className={`ir-home-line ${medal}`}>
      <span className={`ir-medal ${medal}`}>
        {l.place >= 0 && l.place <= 2 ? <Icon name="trophy" size={16} /> : l.place === 3 ? <span>4</span> : <Icon name="exit" size={15} />}
      </span>
      <Who p={l.p} size={46} sub={<><Flag nation={l.nation} /> {nationName(l.nation)}</>} />
      <div className="ir-home-finish">
        <b>{finish}</b>
        {l.tournamentMvp && <span className="ir-mvp"><Icon name="star" size={12} /> Tournament MVP</span>}
      </div>
      <div className="ir-stats compact">
        <Stat label="Matches" value={l.apps} />
        <Stat label="Points" value={l.points} sub={l.apps > 0 ? `${(l.points / l.apps).toFixed(1)} a match` : undefined} />
        <Stat label="MVP awards" value={l.mvps} />
        <div className="ir-stat">
          {l.apps > 0 ? <RatingBadge value={l.avg} /> : <b>—</b>}
          <span>Avg rating</span>
        </div>
      </div>
    </div>
  );
}
