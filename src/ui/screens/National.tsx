/**
 * The national team. Coaching one: its standing and honours down the side,
 * how it plays, and — the main of it — the fourteen for its next tournament,
 * picked from everyone who can play for it, or, once the tournament is on,
 * the squad at it and the matches to come. Not coaching one: the national
 * jobs going, how keen each federation would be, and a way to apply.
 */

import { useMemo, useState, type JSX } from 'react';
import { Position, POSITION_SHORT } from '../../engine/model/positions.ts';
import {
  championsTitle, eligibleFor, nationalHiringChance, nextTournamentFor, recentForm, selectionScore, squadOf,
  squadProblem, SQUAD_SHAPE, SQUAD_SIZE, userNation, worldRanking, type IntlMatch, type Tournament,
} from '../../engine/world/internationals.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import {
  abilityClass, Bar, ChoiceField, ClubLink, Empty, Flag, PlayerLink, Pos, RatingBadge, Segmented, SortTh, sortBy,
  useSort,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { DEFENSE_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS, TEMPO_OPTIONS } from './Manage.tsx';

function nationName(n: number): string {
  return NATIONS[n]?.name ?? '?';
}

/** How a federation feels about the manager, in words. */
function interest(chance: number): { label: string; cls: string } {
  if (chance >= 0.6) return { label: 'Keen', cls: 'good' };
  if (chance >= 0.35) return { label: 'Interested', cls: '' };
  if (chance >= 0.15) return { label: 'Doubtful', cls: 'warn' };
  return { label: 'Unlikely', cls: 'bad' };
}

export function NationalScreen(): JSX.Element {
  const g = useGame();
  const nation = userNation(g.world!);
  return nation < 0 ? <NationalJobs /> : <NationalTeamView nation={nation} />;
}

/** Not coaching a nation: the national jobs going. */
function NationalJobs(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const I = world.internationals;
  const ranking = worldRanking(world);
  const vacancies = [...(I?.vacancies ?? [])].sort((a, b) => ranking.indexOf(a.nation) - ranking.indexOf(b.nation));
  const home = world.manager.nation;

  return (
    <div className="nat nat-solo">
      <section className="nat-card nat-jobs">
        <header className="nat-head">
          <span className="nat-kicker"><Icon name="world" size={14} /> National teams</span>
          <h1 className="nat-title">Coach a national team</h1>
          <p className="faint nat-intro">
            A national job goes alongside your club: you name the squad for every tournament and play its matches
            yourself. A federation weighs your reputation against its place in the world — the stronger the nation,
            the bigger the name it wants — and your own country, {nationName(home)}, looks on you more kindly.
          </p>
        </header>
        {vacancies.length === 0 ? <Empty>No national team is looking for a coach right now.</Empty> : (
          <div className="nat-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nation</th><th className="num">World rank</th><th className="num">Points</th>
                  <th>Next tournament</th><th>Looking since</th><th>Their interest</th><th />
                </tr>
              </thead>
              <tbody>
                {vacancies.map((v) => {
                  const team = world.nationalTeams.find((t) => t.nation === v.nation);
                  const next = nextTournamentFor(world, v.nation);
                  const it = interest(nationalHiringChance(world, v.nation));
                  const applied = I?.applications.find((a) => a.nation === v.nation);
                  return (
                    <tr key={v.nation} className={v.nation === home ? 'me' : ''}>
                      <td><span className="intl-nation"><Flag nation={v.nation} /> <b>{nationName(v.nation)}</b></span></td>
                      <td className="num">{ranking.indexOf(v.nation) + 1}</td>
                      <td className="num">{team?.rankingPoints ?? '—'}</td>
                      <td>{next !== undefined ? <>{next.name} <span className="faint">· {g.dateLabelForDay(next.startDay)}</span></> : <span className="faint">None planned</span>}</td>
                      <td className="dim">{g.dateLabelForDay(v.since)}</td>
                      <td><span className={`nat-interest ${it.cls}`}>{it.label}</span></td>
                      <td className="num">
                        {applied !== undefined
                          ? <span className="faint">Applied · answer by {g.dateLabelForDay(applied.answerOn)}</span>
                          : <button className="sm primary" onClick={() => g.applyForNationalJob(v.nation)}>Apply</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function NationalTeamView({ nation }: { nation: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const team = world.nationalTeams.find((t) => t.nation === nation);
  const rank = worldRanking(world).indexOf(nation) + 1;
  const t = nextTournamentFor(world, nation);
  const today = g.nationalMatchToday();
  const tactics = g.nationalTactics();
  const honours: Array<[string, number]> = [
    ['Olympic gold', team?.olympicGolds ?? 0],
    ['World titles', team?.worldTitles ?? 0],
    ['Continental', team?.continentalTitles ?? 0],
    ['Nations League', team?.nationsLeagueTitles ?? 0],
  ];
  const last = [...(world.internationals?.history ?? [])].reverse()
    .filter((h) => h.podium.includes(nation) || h.medallists.some(([n]) => n === nation)).slice(0, 4);

  return (
    <div className="nat">
      <aside className="nat-card nat-side">
        <div className="nat-flag"><Flag nation={nation} /></div>
        <h1 className="nat-title">{nationName(nation)}</h1>
        <span className="faint">Head coach · {world.manager.firstName} {world.manager.lastName}</span>
        <div className="nat-rank">
          <span><b>#{rank}</b> world ranking</span>
          <span className="faint">{team?.rankingPoints ?? 0} points</span>
        </div>
        <div className="nat-honours">
          {honours.map(([label, n]) => (
            <span key={label} className={n > 0 ? 'won' : ''}><b>{n}</b> {label}</span>
          ))}
        </div>
        {last.length > 0 && (
          <div className="nat-medals">
            {last.map((h) => {
              const place = h.podium.indexOf(nation);
              return (
                <span key={h.name} className={`intl-medal ${['gold', 'silver', 'bronze'][place] ?? ''}`}>
                  <Icon name="trophy" size={12} /> {h.name}
                </span>
              );
            })}
          </div>
        )}

        {today !== null && (
          <button className="primary nat-play" onClick={() => g.openNationalMatchday()}>
            <Icon name="ball" size={15} /> Play {nationName(today.m.home === nation ? today.m.away : today.m.home)} · {today.m.stage}
          </button>
        )}

        {tactics !== null && (
          <div className="nat-tactics">
            <h3 className="nat-h">How we play</h3>
            <ChoiceField label="Offensive system" value={tactics.offense} options={OFFENSE_OPTIONS}
              onChange={(v) => { tactics.offense = v; g.touch(); }} />
            <ChoiceField label="Tempo" value={tactics.tempo} options={TEMPO_OPTIONS}
              onChange={(v) => { tactics.tempo = v; g.touch(); }} />
            <ChoiceField label="Defensive system" value={tactics.defense} options={DEFENSE_OPTIONS}
              onChange={(v) => { tactics.defense = v; g.touch(); }} />
            <ChoiceField label="Serve strategy" value={tactics.serve} options={SERVE_OPTIONS}
              onChange={(v) => { tactics.serve = v; g.touch(); }} />
          </div>
        )}

        <span className="flex-spacer" />
        <button className="sm danger" onClick={() => g.resignNationalJob()}>Step down as head coach</button>
      </aside>

      <section className="nat-main">
        {t === undefined
          ? <NoTournament nation={nation} />
          : t.status === 'planned'
            ? <SquadPicker key={t.id} t={t} nation={nation} />
            : <AtTournament t={t} nation={nation} />}
      </section>
    </div>
  );
}

function NoTournament({ nation }: { nation: number }): JSX.Element {
  const g = useGame();
  const best = g.suggestedNationalSquad();
  return (
    <section className="nat-card nat-fill">
      <header className="nat-picker-head">
        <div>
          <h3 className="nat-h">No tournament coming up</h3>
          <span className="faint">
            {nationName(nation)} have not qualified for anything this season. Your assistant's fourteen, as things stand:
          </span>
        </div>
      </header>
      <div className="nat-scroll">
        <PlayerTable players={best} />
      </div>
    </section>
  );
}

type PickSort = 'score' | 'name' | 'pos' | 'age' | 'ca' | 'form' | 'caps' | 'club';

/** Name the fourteen for the next tournament. */
function SquadPicker({ t, nation }: { t: Tournament; nation: number }): JSX.Element {
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
              <SortTh k="age" sort={sort} onSort={onSort} num>Age</SortTh>
              <SortTh k="club" sort={sort} onSort={onSort}>Club</SortTh>
              <SortTh k="ca" sort={sort} onSort={onSort} num>Ability</SortTh>
              <SortTh k="form" sort={sort} onSort={onSort} num title="Average rating over his last matches">Form</SortTh>
              <SortTh k="caps" sort={sort} onSort={onSort} num>Caps</SortTh>
              <th>Fitness</th>
              <SortTh k="score" sort={sort} onSort={onSort} num title="How the assistant rates him for a place">Rating</SortTh>
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
                  <td className="num">{age(p)}</td>
                  <td>{store.clubId[p] >= 0 ? <ClubLink id={store.clubId[p]} /> : <span className="faint">Free agent</span>}</td>
                  <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                  <td className="num"><RatingBadge value={recentForm(world, p)} size="sm" /></td>
                  <td className="num">{store.nationalCaps[p]}</td>
                  <td>{store.injuryDaysLeft[p] > 0
                    ? <span className="bad">Injured · {store.injuryDaysLeft[p]}d</span>
                    : <Bar value={store.condition[p]} />}</td>
                  <td className="num dim">{Math.round(selectionScore(world, p))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The tournament under way: the squad at it, and the matches. */
function AtTournament({ t, nation }: { t: Tournament; nation: number }): JSX.Element {
  const g = useGame();
  const squad = squadOf(t, nation);
  const matches = t.matches.filter((m) => m.home === nation || m.away === nation).sort((a, b) => a.day - b.day);
  const out = t.out.includes(nation);
  return (
    <div className="nat-tour">
      <section className="nat-card nat-fixtures">
        <header className="nat-picker-head">
          <div>
            <h3 className="nat-h">{t.name}</h3>
            <span className="faint">
              {t.status === 'called' && g.world!.day < t.startDay ? `Starts ${g.dateLabelForDay(t.startDay)}`
                : out ? 'Out of the tournament' : t.status === 'knockout' ? 'Knockout rounds' : 'Pool stage'}
              {t.host >= 0 && <> · hosted by {nationName(t.host)}</>}
              {t.status === 'done' && <> · {nationName(t.placings[0])} {championsTitle(t)}</>}
            </span>
          </div>
          <button className="sm ghost" onClick={() => g.openTournament(t.id)}>
            <Icon name="trophy" size={13} /> Tournament
          </button>
        </header>
        <div className="nat-scroll nat-match-list">
          {matches.map((m) => <NationMatch key={m.id} m={m} nation={nation} host={t.host} />)}
          {matches.length === 0 && <p className="faint">The draw is made — the matches come soon.</p>}
        </div>
      </section>
      <section className="nat-card nat-fill">
        <header className="nat-picker-head">
          <h3 className="nat-h">The squad</h3>
        </header>
        <div className="nat-scroll">
          <PlayerTable players={squad} t={t} />
        </div>
      </section>
    </div>
  );
}

function NationMatch({ m, nation, host }: { m: IntlMatch; nation: number; host: number }): JSX.Element {
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
function PlayerTable({ players, t }: { players: number[]; t?: Tournament }): JSX.Element {
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
          ) : (
            <button className="primary" onClick={() => g.go('national')}><Icon name="world" size={14} /> National Team</button>
          )}
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
            <button className="hm-link" onClick={() => g.go('national')}>National Team <Icon name="arrowRight" size={13} /></button>
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
          <header className="hm-card-head"><h3>A club as well?</h3></header>
          <div className="hm-scroll">
            <p className="hm-empty nat-home-note">
              The national team plays in the summer and the spring. You can take a club job alongside it — apply for any
              vacancy in the Job Centre, and clubs will hear of you as your name grows.
            </p>
            <button className="primary block" onClick={() => g.go('jobs')}><Icon name="search" size={14} /> Job Centre</button>
          </div>
        </section>
      </div>
    </div>
  );
}
