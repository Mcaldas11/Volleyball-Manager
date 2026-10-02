/**
 * The national team, wherever it turns up outside a section of its own: the
 * fourteen to name for a tournament — drawn in the federation's message —
 * how the team plays, its matches, a list of its players, and the landing
 * page of a career spent at a national team alone.
 */

import { useMemo, useState, type JSX } from 'react';
import { Position, POSITION_SHORT } from '../../engine/model/positions.ts';
import { Formation, FORMATION_NAMES } from '../../engine/match/tactics.ts';
import {
  eligibleFor, nextTournamentFor, recentForm, selectionScore, squadOf, squadProblem, SQUAD_SHAPE, SQUAD_SIZE,
  userNation, worldRanking, type IntlMatch, type Tournament,
} from '../../engine/world/internationals.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import {
  abilityClass, Bar, ChoiceField, ClubLink, Flag, PlayerLink, Pos, RatingBadge, Segmented, SortTh, sortBy,
  useSort,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { DEFENSE_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS, TEMPO_OPTIONS } from './Manage.tsx';

function nationName(n: number): string {
  return NATIONS[n]?.name ?? '?';
}

/** How the national team plays: its system and its instructions. */
export function NationalTactics(): JSX.Element | null {
  const g = useGame();
  const tactics = g.nationalTactics();
  if (tactics === null) return null;
  return (
    <div className="nat-tactics">
      <div className="nat-tactics-head">
        <h3 className="nat-h">How we play</h3>
        <Segmented<Formation>
          size="sm"
          options={[[Formation.FiveOne, FORMATION_NAMES[Formation.FiveOne]], [Formation.FourTwo, FORMATION_NAMES[Formation.FourTwo]]]}
          value={tactics.formation ?? Formation.FiveOne}
          onChange={(f) => { tactics.formation = f; g.touch(); }}
        />
      </div>
      <div className="nat-tactics-grid">
        <ChoiceField label="Offensive system" value={tactics.offense} options={OFFENSE_OPTIONS}
          onChange={(v) => { tactics.offense = v; g.touch(); }} />
        <ChoiceField label="Tempo" value={tactics.tempo} options={TEMPO_OPTIONS}
          onChange={(v) => { tactics.tempo = v; g.touch(); }} />
        <ChoiceField label="Defensive system" value={tactics.defense} options={DEFENSE_OPTIONS}
          onChange={(v) => { tactics.defense = v; g.touch(); }} />
        <ChoiceField label="Serve strategy" value={tactics.serve} options={SERVE_OPTIONS}
          onChange={(v) => { tactics.serve = v; g.touch(); }} />
      </div>
    </div>
  );
}

type PickSort = 'score' | 'name' | 'pos' | 'age' | 'ca' | 'form' | 'caps' | 'club';

/** Name the fourteen for the next tournament. */
export function SquadPicker({ t, nation, compact = false }: {
  t: Tournament;
  nation: number;
  /** Fewer columns, for the narrow width of a message. */
  compact?: boolean;
}): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const I = world.internationals;
  const named = I?.chosen?.tournamentId === t.id;
  const pool = useMemo(() => eligibleFor(world, nation), [world, nation, world.day]);
  const [picked, setPicked] = useState<number[]>(() => (named ? [...I!.chosen!.players] : g.suggestedNationalSquad()));
  const [pos, setPos] = useState<number>(-1);
  const [sort, onSort] = useSort<PickSort>('score');
  const problem = squadProblem(world, picked);
  const daysToCall = t.callUpDay - world.day;
  const age = (p: number): number => store.ageOn(p, world.year, 181);
  const outTooLong = (p: number): boolean => store.injuryDaysLeft[p] > Math.max(0, daysToCall);

  const rows = sortBy(pool.filter((p) => pos < 0 || store.position[p] === pos), sort, (p, k) => {
    switch (k) {
      case 'name': return store.fullName(p);
      case 'pos': return store.position[p];
      case 'age': return age(p);
      case 'ca': return store.currentAbility[p];
      case 'form': return recentForm(world, p);
      case 'caps': return store.nationalCaps[p];
      case 'club': return store.clubId[p] >= 0 ? world.clubs[store.clubId[p]]?.name ?? '' : '';
      default: return selectionScore(world, p);
    }
  });

  const toggle = (p: number): void => {
    setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : cur.length < SQUAD_SIZE ? [...cur, p] : cur));
  };

  return (
    <section className="nat-card nat-fill">
      <header className="nat-picker-head">
        <div>
          <h3 className="nat-h">{named ? 'Your squad' : 'Name your squad'} · {t.name}</h3>
          <span className="faint">
            {daysToCall > 0 ? `Due ${g.dateLabelForDay(t.callUpDay)} (${daysToCall} day${daysToCall === 1 ? '' : 's'})` : 'Due today'}
            {' · '}first match {g.dateLabelForDay(t.startDay)}
            {t.host >= 0 && <> · hosted by {nationName(t.host)}</>}
          </span>
        </div>
        <div className="nat-shape" title="Picked, against the usual shape of a squad">
          {Object.entries(SQUAD_SHAPE).map(([p, want]) => {
            const have = picked.filter((x) => store.position[x] === Number(p)).length;
            return (
              <span key={p} className={`nat-shape-chip${have === 0 ? ' bad' : have >= want ? ' ok' : ''}`}>
                {POSITION_SHORT[Number(p) as Position]} <b>{have}</b>/{want}
              </span>
            );
          })}
        </div>
        <div className="nat-actions">
          <button className="sm ghost" onClick={() => setPicked(g.suggestedNationalSquad())} title="The assistant's fourteen: ability, form and caps">
            <Icon name="star" size={13} /> Assistant's pick
          </button>
          <button className="sm ghost" onClick={() => setPicked([])}>Clear</button>
          <button className="primary" disabled={problem !== null} title={problem ?? undefined} onClick={() => g.nameNationalSquad(picked)}>
            <Icon name="check" size={14} /> {named ? 'Update squad' : 'Confirm squad'} <span className="count-chip">{picked.length}/{SQUAD_SIZE}</span>
          </button>
        </div>
      </header>
      <div className="nat-toolbar">
        <Segmented<number>
          size="sm"
          options={[[-1, 'All'], [Position.Setter, 'S'], [Position.OutsideHitter, 'OH'], [Position.MiddleBlocker, 'MB'], [Position.Opposite, 'OPP'], [Position.Libero, 'L']]}
          value={pos}
          onChange={setPos}
        />
        <span className="faint">{pool.length} eligible · click a row to pick or drop a player</span>
        {named && <span className="nat-named"><Icon name="check" size={12} /> Named — you can still change it until {g.dateLabelForDay(t.callUpDay)}</span>}
      </div>
      <div className="nat-scroll">
        <table className="data-table nat-pick-table">
          <thead>
            <tr>
              <th />
              <SortTh k="name" sort={sort} onSort={onSort}>Player</SortTh>
              <SortTh k="pos" sort={sort} onSort={onSort}>Pos</SortTh>
              {!compact && <SortTh k="age" sort={sort} onSort={onSort} num>Age</SortTh>}
              <SortTh k="club" sort={sort} onSort={onSort}>Club</SortTh>
              <SortTh k="ca" sort={sort} onSort={onSort} num>Ability</SortTh>
              <SortTh k="form" sort={sort} onSort={onSort} num title="Average rating over his last matches">Form</SortTh>
              {!compact && <SortTh k="caps" sort={sort} onSort={onSort} num>Caps</SortTh>}
              <th title="Fitness">{compact ? 'Fit' : 'Fitness'}</th>
              {!compact && <SortTh k="score" sort={sort} onSort={onSort} num title="How the assistant rates him for a place">Rating</SortTh>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const on = picked.includes(p);
              const out = outTooLong(p);
              const dual = store.nation2[p] !== 0xffff && store.nation2[p] !== store.nation[p];
              return (
                <tr key={p} className={`clickable${on ? ' nat-on' : ''}${out ? ' nat-out' : ''}`}
                  onClick={() => { if (!out || on) toggle(p); }}>
                  <td><span className={`nat-check${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span></td>
                  <td>
                    <PlayerLink idx={p} />
                    {dual && (
                      <span className="nat-dual" title={`Also eligible for ${nationName(store.nation[p] === nation ? store.nation2[p] : store.nation[p])}`}>
                        <Flag nation={store.nation[p] === nation ? store.nation2[p] : store.nation[p]} />
                      </span>
                    )}
                  </td>
                  <td><Pos pos={store.position[p] as Position} /></td>
                  {!compact && <td className="num">{age(p)}</td>}
                  <td className="nat-club">{store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} /> : <span className="faint">Free agent</span>}</td>
                  <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                  <td className="num"><RatingBadge value={recentForm(world, p)} size="sm" /></td>
                  {!compact && <td className="num">{store.nationalCaps[p]}</td>}
                  <td>{store.injuryDaysLeft[p] > 0
                    ? <span className="bad">Injured · {store.injuryDaysLeft[p]}d</span>
                    : <Bar value={store.condition[p]} />}</td>
                  {!compact && <td className="num dim">{Math.round(selectionScore(world, p))}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function NationMatch({ m, nation, host }: { m: IntlMatch; nation: number; host: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const opp = m.home === nation ? m.away : m.home;
  const us = m.home === nation ? m.homeSets : m.awaySets;
  const them = m.home === nation ? m.awaySets : m.homeSets;
  const today = m.day === world.day && !m.played;
  return (
    <div className={`nat-match${m.played ? (us > them ? ' won' : ' lost') : ''}${today ? ' today' : ''}`}>
      <span className="nat-match-date">{g.dateLabelForDay(m.day)}</span>
      <span className="nat-match-stage">{m.stage}</span>
      <span className="intl-nation"><Flag nation={opp} /> {opp === host ? 'at' : 'v'} {nationName(opp)}</span>
      {m.played
        ? <b className="nat-match-score">{us}-{them} <span className="faint mono">{m.setScores.map(([h, a]) => (m.home === nation ? `${h}-${a}` : `${a}-${h}`)).join(' ')}</span></b>
        : today
          ? <button className="sm primary" onClick={() => g.openNationalMatchday()}><Icon name="ball" size={13} /> Play</button>
          : <span className="faint">—</span>}
    </div>
  );
}

/** A list of players with what matters for a national team. */
export function PlayerTable({ players, t }: { players: number[]; t?: Tournament }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const order = [...players].sort((a, b) => store.position[a] - store.position[b] || store.currentAbility[b] - store.currentAbility[a]);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Player</th><th>Pos</th><th>Club</th><th className="num">Ability</th><th className="num">Caps</th>
          {t !== undefined && <><th className="num">Apps</th><th className="num">Pts</th><th className="num">Avg</th></>}
          <th>Fitness</th>
        </tr>
      </thead>
      <tbody>
        {order.map((p) => {
          const s = t?.stats.get(p);
          return (
            <tr key={p} className={store.clubId[p] === world.userClubId ? 'me' : ''}>
              <td><PlayerLink idx={p} /></td>
              <td><Pos pos={store.position[p] as Position} /></td>
              <td>{store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} /> : <span className="faint">Free agent</span>}</td>
              <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
              <td className="num">{store.nationalCaps[p]}</td>
              {t !== undefined && (
                <>
                  <td className="num">{s?.[0] ?? 0}</td>
                  <td className="num">{s?.[1] ?? 0}</td>
                  <td className="num">{s !== undefined && s[0] > 0 ? <RatingBadge value={s[2] / s[0]} size="sm" /> : '—'}</td>
                </>
              )}
              <td>{store.injuryDaysLeft[p] > 0 ? <span className="bad">Injured · {store.injuryDaysLeft[p]}d</span> : <Bar value={store.condition[p]} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- Home, for a manager whose job is a national team alone ------------------------------------

/**
 * The landing page of a national-team career: the next match — or the
 * tournament ahead and when the squad is due — across the top; then the
 * tournament's matches, the world ranking and the news; then the players and
 * the club jobs, should he want one as well.
 */
export function NationalHome(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const nation = userNation(world);
  const m = world.manager;
  const t = nextTournamentFor(world, nation);
  const matches = t === undefined ? [] : t.matches.filter((x) => x.home === nation || x.away === nation).sort((a, b) => a.day - b.day);
  const next = t !== undefined && t.status !== 'planned' && !t.out.includes(nation) ? matches.find((x) => !x.played) : undefined;
  const opp = next === undefined ? -1 : next.home === nation ? next.away : next.home;
  const today = g.nationalMatchToday();
  const ranking = worldRanking(world);
  const rank = ranking.indexOf(nation) + 1;
  const players = t !== undefined && t.status !== 'planned' ? squadOf(t, nation) : g.suggestedNationalSquad();
  const store = world.players;
  const news = [...world.news].reverse().slice(0, 10);
  // The federation's squad message is out: the fourteen are his to name.
  const squadOpen = t !== undefined && t.status === 'planned' && world.day >= t.callUpDay - 7;
  const top = ranking.slice(0, 12);
  if (!top.includes(nation)) top.push(nation);

  const sub = next !== undefined && t !== undefined
    ? `${t.name} · ${next.stage} · ${next.day === world.day ? 'Today' : next.day === world.day + 1 ? 'Tomorrow' : `${g.dateLabelForDay(next.day)}`}`
    : t === undefined
      ? 'No tournament coming up — the national team is between majors.'
      : t.status === 'planned'
        ? `${t.name}${t.host >= 0 ? ` in ${nationName(t.host)}` : ''} · name your squad by ${g.dateLabelForDay(t.callUpDay)} · first match ${g.dateLabelForDay(t.startDay)}`
        : `${t.name} · out of the tournament`;

  return (
    <div className="home">
      <section className="hm-banner">
        <div className="hm-banner-main">
          <div className="hm-kicker">Now managing · {nationName(nation)} national team · <span>{m.firstName} {m.lastName}</span></div>
          <div className="hm-teams">
            <span className="side-flag nat-home-flag"><Flag nation={nation} /></span>
            <span className="hm-team-name">{nationName(nation)}</span>
            {opp >= 0 && (
              <>
                <span className="hm-vs">VS</span>
                <span className="side-flag nat-home-flag"><Flag nation={opp} /></span>
                <span className="hm-team-name">{nationName(opp)}</span>
              </>
            )}
          </div>
          <div className="hm-sub">{sub}</div>
        </div>
        <div className="hm-banner-side">
          <span className="hm-chip">World ranking <b>#{rank}</b></span>
          {today !== null ? (
            <div className="hm-side-line">
              <button className="hm-ghost" disabled={g.processing} onClick={() => g.instantResult()}>Instant result</button>
              <button className="primary" disabled={g.processing} onClick={() => g.openNationalMatchday()}>
                <Icon name="playOutline" size={14} /> Play match
              </button>
            </div>
          ) : squadOpen ? (
            <button className="primary" onClick={() => g.openSquadMessage()}><Icon name="world" size={14} /> Name your squad</button>
          ) : t !== undefined ? (
            <button className="primary" onClick={() => g.openTournament(t.id)}><Icon name="trophy" size={14} /> {t.name}</button>
          ) : null}
        </div>
      </section>

      <div className="home-row career-home-row">
        <section className="hm-card">
          <header className="hm-card-head">
            <h3 className="gold">{t?.name ?? 'Tournaments'}</h3>
            {t !== undefined && <button className="hm-link" onClick={() => g.openTournament(t.id)}>Tournament <Icon name="arrowRight" size={13} /></button>}
          </header>
          <div className="hm-scroll nat-home-matches">
            {t === undefined && <p className="hm-empty">Nothing on the calendar yet.</p>}
            {t !== undefined && matches.length === 0 && (
              <p className="hm-empty">The draw is made when the squads are named, on {g.dateLabelForDay(t.callUpDay)}.</p>
            )}
            {t !== undefined && matches.map((x) => <NationMatch key={x.id} m={x} nation={nation} host={t.host} />)}
          </div>
        </section>
        <section className="hm-card">
          <header className="hm-card-head">
            <h3>World ranking</h3>
            <button className="hm-link" onClick={() => g.go('rankings')}>All <Icon name="arrowRight" size={13} /></button>
          </header>
          <div className="hm-scroll">
            <table className="data-table">
              <tbody>
                {top.map((n) => (
                  <tr key={n} className={n === nation ? 'me' : ''}>
                    <td className="num faint">{ranking.indexOf(n) + 1}</td>
                    <td><span className="intl-nation"><Flag nation={n} /> {nationName(n)}</span></td>
                    <td className="num">{world.nationalTeams.find((x) => x.nation === n)?.rankingPoints ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="hm-card">
          <header className="hm-card-head">
            <h3>World news</h3>
            <button className="hm-link" onClick={() => g.go('news')}>All <Icon name="arrowRight" size={13} /></button>
          </header>
          <div className="hm-scroll nat-home-news">
            {news.length === 0 && <p className="hm-empty">No news yet.</p>}
            {news.map((n) => (
              <div key={n.id} className="nat-home-story">
                <span className="faint">{g.dateLabelForDay(n.day)}</span>
                <b>{n.headline}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="home-row career-home-row-2">
        <section className="hm-card">
          <header className="hm-card-head">
            <h3>{t !== undefined && t.status !== 'planned' ? 'The squad' : 'Your assistant’s fourteen'}</h3>
            {squadOpen && <button className="hm-link" onClick={() => g.openSquadMessage()}>Name the squad <Icon name="arrowRight" size={13} /></button>}
          </header>
          <div className="hm-scroll">
            <table className="data-table">
              <tbody>
                {[...players].sort((a, b) => store.position[a] - store.position[b] || store.currentAbility[b] - store.currentAbility[a]).map((p) => (
                  <tr key={p}>
                    <td><PlayerLink idx={p} /></td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td>{store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} /> : <span className="faint">Free agent</span>}</td>
                    <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                    <td className="num"><RatingBadge value={recentForm(world, p)} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="hm-card">
          <header className="hm-card-head">
            <h3>Tactics</h3>
            <button className="hm-link" onClick={() => g.go('jobs')}>A club as well? <Icon name="arrowRight" size={13} /></button>
          </header>
          <div className="hm-scroll"><NationalTactics /></div>
        </section>
      </div>
    </div>
  );
}
