import type { JSX } from 'react';
import { rivalryName } from '../../engine/world/rivals.ts';
import { ATTR_LABELS, type AttributeName } from '../../engine/model/attributes.ts';
import { compareTableRows } from '../../engine/model/club.ts';
import { Position, POSITION_NAMES } from '../../engine/model/positions.ts';
import { stageLabel } from '../../engine/season/cups.ts';
import { seasonTotals } from '../../engine/world/records.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import {
  attrClass, ClubCrest, money, PlayerFace, StarMeter,
} from '../components.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { formatDate, useGame, type ScreenId } from '../state.ts';
import { messageNeedsAction } from '../../engine/world/inbox.ts';
import { contractEndSeason, dayOfSeason } from '../../engine/world/world.ts';
import { UnemployedHome } from './Career.tsx';
import { NewsVisual, openNewsStory } from './News.tsx';
import arena from '../menu-arena.jpg';
import { NationalHome } from './National.tsx';

/** The six attributes that say most about a player in each role. */
const KEY_ATTRS: Readonly<Record<Position, readonly AttributeName[]>> = {
  [Position.Setter]: ['setting', 'ballControl', 'servingAccuracy', 'agility', 'composure', 'concentration'],
  [Position.Opposite]: ['spikeTechnique', 'backRowAttack', 'servingPower', 'verticalJump', 'blocking', 'composure'],
  [Position.OutsideHitter]: ['spikeTechnique', 'reception', 'pipeAttack', 'verticalJump', 'servingAccuracy', 'determination'],
  [Position.MiddleBlocker]: ['blocking', 'quickAttack', 'verticalJump', 'acceleration', 'servingAccuracy', 'concentration'],
  [Position.Libero]: ['reception', 'digging', 'ballControl', 'agility', 'acceleration', 'concentration'],
};

/**
 * The club at a glance — the landing page. The next fixture across the top,
 * then where the club stands, who to keep an eye on and how the season is
 * going, then the top scorer, the board's mood and the money.
 */
export function HomeScreen(): JSX.Element {
  const g = useGame();
  if (g.club === null) return g.world!.career.nationalTeam !== undefined ? <NationalHome /> : <UnemployedHome />;
  return (
    <div className="portal-page">
      <header className="portal-heading">
        <div>
          <span className="portal-eyebrow">The coach's desk</span>
          <h1>Your club. Your next move.</h1>
        </div>
        <HealthStrip />
      </header>
      <div className="portal-command">
        <NowManaging />
        <ForToday />
      </div>
      <div className="portal-editorial">
        <div className="portal-editorial-main">
          <SeasonStories />
          <div className="portal-people">
            <OneToWatch />
            <TopScorer />
          </div>
        </div>
        <aside className="portal-club-rail">
          <LeagueTableCard />
          <div className="portal-rail-shortcuts">
            <button onClick={() => g.go('dressing')}><Icon name="squad" size={18} /><span>Dressing Room</span><Icon name="chevronRight" size={14} /></button>
            <button onClick={() => g.go('youth')}><Icon name="youth" size={18} /><span>Youth Academy</span><Icon name="chevronRight" size={14} /></button>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** The squad's health in five numbers across the top: who can play, their legs, their mood, the board, the money. */
function HealthStrip(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const store = g.world!.players;
  const n = club.players.length;
  const fit = club.players.filter((p) => store.injuryDaysLeft[p] === 0).length;
  const condition = n === 0 ? 0 : club.players.reduce((s, p) => s + store.condition[p], 0) / n;
  const morale = n === 0 ? 0 : club.players.reduce((s, p) => s + store.morale[p], 0) / n;
  return (
    <div className="portal-health-strip">
      <button onClick={() => g.go('squad')}><span>Players available</span><b>{fit}<small>/{n}</small></b></button>
      <button onClick={() => g.go('training')}><span>Condition</span><b>{Math.round(condition)}%</b></button>
      <button onClick={() => g.go('dressing')}><span>Morale</span><b>{Math.round(morale)}%</b></button>
      <button onClick={() => g.go('owner')}><span>Board confidence</span><b>{Math.round(club.boardConfidence)}%</b></button>
      <button onClick={() => g.go('finances')}><span>Balance</span><b className={club.finances.balance < 0 ? 'bad' : ''}>{money(club.finances.balance)}</b></button>
    </div>
  );
}

/** The club's latest stories: the lead, and two briefs under it. */
function SeasonStories(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const ours = [...world.news].reverse().filter((n) => n.clubId === club.id || n.otherClubId === club.id);
  const items = (ours.length > 0 ? ours : [...world.news].reverse()).slice(0, 3);
  const lead = items[0];
  const open = (id: number): void => { openNewsStory(id); g.go('news'); };
  return (
    <section className="portal-stories">
      <header className="portal-section-head">
        <div>
          <span className="portal-eyebrow">Inside the club</span>
          <h2>The story of your season</h2>
        </div>
        <button className="hm-link" onClick={() => g.go('news')}>World News <Icon name="arrowRight" size={15} /></button>
      </header>
      {lead === undefined ? (
        <div className="portal-story-empty">
          <Icon name="news" size={30} />
          <div><strong>A new chapter begins</strong><p>Your club's stories will appear as the season unfolds.</p></div>
          <button onClick={() => g.go('squad')}>Meet the squad <Icon name="arrowRight" size={14} /></button>
        </div>
      ) : (
        <div className="portal-story-grid">
          <button className="portal-lead" onClick={() => open(lead.id)}>
            <div className="portal-lead-art"><NewsVisual item={lead} size={112} /></div>
            <span className="portal-lead-copy">
              <small>{g.dateLabelForDay(lead.day)}</small>
              <strong>{lead.headline}</strong>
              <span>{lead.body}</span>
              <b>Read the story <Icon name="arrowRight" size={14} /></b>
            </span>
          </button>
          {items.length > 1 && (
            <div className="portal-story-briefs">
              {items.slice(1).map((n) => (
                <button key={n.id} onClick={() => open(n.id)}>
                  <NewsVisual item={n} size={48} />
                  <span className="portal-brief-copy"><small>{g.dateLabelForDay(n.day)}</small><b>{n.headline}</b></span>
                  <Icon name="chevronRight" size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function NowManaging(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const next = g.nextFixture();
  const manager = `${world.manager.firstName} ${world.manager.lastName}`;
  const league = world.competitions[club.leagueId];
  const backdrop = { backgroundImage: `linear-gradient(90deg, rgba(5,17,31,.96), rgba(5,17,31,.6)), url(${arena})` };

  if (next === null) {
    return (
      <section className="hm-banner portal-match" style={backdrop}>
        <div className="hm-banner-main">
          <span className="portal-match-label">Next match</span>
          <div className="hm-kicker">Now managing · {league?.name ?? club.name} · <span>{manager}</span></div>
          <div className="hm-teams">
            <ClubCrest club={club} size={54} />
            <span className="hm-team-name">{club.name}</span>
          </div>
          <div className="hm-sub">No fixture scheduled — the new season's calendar is drawn up over the summer.</div>
        </div>
        <div className="hm-banner-side">
          <button className="hm-link" onClick={() => g.go('calendar')}>Calendar <Icon name="arrowRight" size={14} /></button>
          <span className="hm-chip">Transfer budget <b>{money(club.finances.transferBudget)}</b></span>
        </div>
      </section>
    );
  }

  const isHome = next.home === club.id;
  const opponent = world.clubs[isHome ? next.away : next.home];
  const comp = world.competitions[next.competitionId];
  const today = next.day === world.day;
  const days = next.day - world.day;
  const date = g.calendarDate(next.day);
  const shortDate = date === null ? '' : formatDate(date, 'weekdayDayMonth');

  return (
    <section className="hm-banner portal-match" style={backdrop}>
      <div className="hm-banner-main">
        <span className="portal-match-label">Next match</span>
        <div className="hm-kicker">
          Now managing · {stageLabel(world, next)} · {shortDate} · {comp?.name ?? ''} · <span>{manager}</span>
        </div>
        <div className="hm-teams">
          <ClubCrest club={club} size={68} />
          <span className="hm-team-name">{club.name}</span>
          <span className="hm-vs">VS</span>
          {opponent !== undefined && <ClubCrest club={opponent} size={68} />}
          <span className="hm-team-name link" onClick={() => opponent !== undefined && g.selectClub(opponent.id)}>
            {opponent?.name ?? '—'}
          </span>
        </div>
        <div className="hm-sub">
          {comp?.name ?? ''} · {today ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
          {rivalryName(world, next) !== null && <span className="hm-derby">{rivalryName(world, next)!.replace(/^the/, 'The')}</span>}
          {g.transferWindowStatus().open && g.transferWindowStatus().untilDay === world.day && <span className="hm-derby hm-deadline">Deadline day</span>}
        </div>
      </div>
      <div className="hm-banner-side">
        <div className="portal-countdown">
          <strong>{Math.max(0, days).toString().padStart(2, '0')}</strong>
          <span>Days to prepare</span>
        </div>
        <div className="hm-side-line">
          <span className={`hm-venue${isHome && !next.neutralVenue ? ' is-home' : ''}`}>
            {next.neutralVenue ? 'Neutral' : isHome ? 'Home' : 'Away'}
          </span>
          <button className="hm-link" onClick={() => g.go('calendar')}>Calendar <Icon name="arrowRight" size={14} /></button>
        </div>
        <span className="hm-chip">Transfer budget <b>{money(club.finances.transferBudget)}</b></span>
        {!today && (
          <button className="primary portal-prepare" onClick={() => g.go('lineup')}>Prepare match <Icon name="arrowRight" size={16} /></button>
        )}
        {today && (
          <div className="hm-side-line">
            <button className="hm-ghost" disabled={g.processing} onClick={() => g.instantResult()}>Instant result</button>
            <button className="primary" disabled={g.processing} onClick={() => g.openMatchday()}>
              <Icon name="playOutline" size={14} /> Play match
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function LeagueTableCard(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  const table = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const pos = table.findIndex((r) => r.clubId === club.id);
  const rows = pos < 5 ? table.slice(0, 5) : [...table.slice(0, 4), table[pos]];

  return (
    <section className="hm-card">
      <header className="hm-card-head">
        <h3>League table</h3>
        <button className="hm-link" onClick={() => g.go('table')}>Full <Icon name="arrowRight" size={13} /></button>
      </header>
      <table className="hm-table">
        <thead>
          <tr><th className="num">#</th><th>Team</th><th className="num">W</th><th className="num">L</th><th className="num">Pts</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = world.clubs[r.clubId];
            const i = table.indexOf(r);
            return (
              <tr key={r.clubId} className={r.clubId === club.id ? 'me' : 'clickable'} onClick={() => r.clubId !== club.id && g.selectClub(r.clubId)}>
                <td className="num dim">{i + 1}</td>
                <td><span className="hm-club">{c !== undefined && <ClubCrest club={c} size={20} />}{c?.shortName === undefined ? '—' : c.name}</span></td>
                <td className="num dim">{r.won}</td>
                <td className="num dim">{r.lost}</td>
                <td className="num"><b>{r.points}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The club's most promising young player — the one the staff want you watching. */
function OneToWatch(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const age = (p: number): number => store.ageOn(p, world.year, 181);
  const pool = club.players.filter((p) => age(p) <= 23);
  const pick = (pool.length > 0 ? pool : club.players)
    .slice()
    .sort((a, b) =>
      (store.potentialAbility[b] - store.currentAbility[b] * 0.35) - (store.potentialAbility[a] - store.currentAbility[a] * 0.35))[0];

  if (pick === undefined) {
    return <section className="hm-card"><header className="hm-card-head"><h3 className="gold">One to watch</h3></header><p className="hm-empty">No players.</p></section>;
  }
  const pos = store.position[pick] as Position;
  const nation = NATIONS[store.nation[pick]];
  const attrs = KEY_ATTRS[pos];

  return (
    <section className="hm-card hm-watch">
      <header className="hm-card-head"><h3 className="gold">One to watch</h3></header>
      <div className="hm-watch-top">
        <span className="hm-watch-photo"><PlayerFace playerId={store.id[pick]} name={store.fullName(pick)} size={92} /></span>
        <div className="hm-watch-id">
          <strong className="hm-watch-name player-link" onClick={() => g.select(pick)}>{store.surname(pick)}</strong>
          <span className="hm-watch-meta">
            <b>{POSITION_NAMES[pos]}</b> {age(pick)}y, {nation?.code ?? ''} <b>{money(store.value[pick])}</b>
          </span>
          <span className="hm-watch-stars"><span>Current</span><StarMeter value={store.currentAbility[pick]} size={14} /></span>
          <span className="hm-watch-stars"><span>Potential</span><StarMeter value={store.potentialAbility[pick]} size={14} /></span>
        </div>
      </div>
      <div className="hm-attrs">
        {attrs.map((a) => {
          const v = store.getAttr(pick, a);
          return (
            <div key={a} className="hm-attr">
              <span>{ATTR_LABELS[a]}</span>
              <b className={attrClass(v)}>{v}</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The club's leading points scorer this season, with his full line. */
/** One thing on the manager's desk today: what it is, how pressing, and where to deal with it. */
interface TodayItem {
  key: string;
  icon: IconName;
  /** 3 needs a decision now, 2 soon, 1 worth knowing. */
  urgency: 1 | 2 | 3;
  text: string;
  go: ScreenId;
}

/**
 * The manager's desk: what needs him today, most pressing first — the offers
 * and messages waiting on an answer, the injured, the contracts running out,
 * tired legs before a match, the academy and the building work — each a click
 * from where it is dealt with.
 */
function ForToday(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const items: TodayItem[] = [];

  const waiting = world.messages.filter((m) => m.archived !== true && messageNeedsAction(world, m)).length;
  if (waiting > 0) items.push({ key: 'inbox', icon: 'inbox', urgency: 3, go: 'inbox', text: `${waiting} message${waiting === 1 ? '' : 's'} waiting on your answer` });

  const offers = world.incomingOffers.filter((o) => (o.status ?? 'open') === 'open' && club.players.includes(o.playerIdx)).length;
  if (offers > 0) items.push({ key: 'offers', icon: 'offer', urgency: 3, go: 'transfers', text: `${offers} offer${offers === 1 ? '' : 's'} for your players to answer` });

  const next = g.nextFixture();
  if (next !== null) {
    const days = next.day - world.day;
    const tired = club.players.filter((p) => store.injuryDaysLeft[p] === 0 && store.condition[p] < 70).length;
    if (days <= 2 && tired > 0) items.push({ key: 'tired', icon: 'training', urgency: 2, go: 'training', text: `${tired} player${tired === 1 ? '' : 's'} short of condition, ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days`} before the match` });
  }

  const injured = club.players.filter((p) => store.injuryDaysLeft[p] > 0);
  if (injured.length > 0) {
    const names = injured.slice(0, 3).map((p) => store.shortName(p)).join(', ');
    items.push({ key: 'injured', icon: 'medical', urgency: 2, go: 'squad', text: `${injured.length} injured: ${names}${injured.length > 3 ? '…' : ''}` });
  }

  const expiring = club.players.filter((p) => contractEndSeason(store.contractUntil[p]) <= world.season).length;
  if (expiring > 0) items.push({ key: 'contracts', icon: 'contract', urgency: dayOfSeason(world) > 240 ? 3 : 1, go: 'squad', text: `${expiring} contract${expiring === 1 ? '' : 's'} running out this summer` });

  const academy = world.academy;
  if (academy !== undefined) {
    const ending = academy.programmes.filter((x) => x.endDay - world.day <= 7).length;
    if (ending > 0) items.push({ key: 'programmes', icon: 'youth', urgency: 1, go: 'youth', text: `${ending} academy programme${ending === 1 ? '' : 's'} ending this week` });
    if (academy.candidates.length > 0) items.push({ key: 'candidates', icon: 'scouting', urgency: 2, go: 'youth', text: `${academy.candidates.length} youngster${academy.candidates.length === 1 ? '' : 's'} found by the scouts, waiting on you` });
    if (academy.search !== undefined) items.push({ key: 'search', icon: 'scouting', urgency: 1, go: 'youth', text: `Youth search: report in ${Math.max(0, academy.search.endDay - world.day)} days` });
  }

  const project = club.facilityProject;
  if (project !== undefined) items.push({ key: 'facility', icon: 'club', urgency: 1, go: 'facilities', text: project.stage === 'asked' ? `The board is weighing up your facilities request — answer by ${g.dateLabelForDay(project.until)}` : `Building work under way — done ${g.dateLabelForDay(project.until)}` });

  if (club.boardConfidence < 35) items.push({ key: 'board', icon: 'board', urgency: 3, go: 'home', text: `The board's confidence is low (${Math.round(club.boardConfidence)}%)` });

  items.sort((a, b) => b.urgency - a.urgency);
  return (
    <section className="hm-card hm-today">
      <header className="hm-card-head"><h3 className="gold">For today</h3><span className="faint">{items.length === 0 ? 'nothing waiting' : `${items.length} thing${items.length === 1 ? '' : 's'}`}</span></header>
      {items.length === 0 ? <p className="hm-empty">Nothing needs you today. A good day to look at the tactics — or the academy.</p> : (
        <ul className="hm-today-list">
          {items.map((i) => (
            <li key={i.key}>
              <button className={`hm-today-item u${i.urgency}`} onClick={() => g.go(i.go)}>
                <span className="hm-today-icon"><Icon name={i.icon} size={15} /></span>
                <span className="hm-today-text">{i.text}</span>
                <Icon name="chevronRight" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopScorer(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const lines = club.players.map((p) => g.ctx.stats.get(p)).filter((s) => s !== undefined);
  const points = (s: (typeof lines)[number]): number => s.attackKills + s.serveAces + s.blockPoints;
  const top = lines.sort((a, b) => points(b) - points(a))[0];

  // A save written before season lines were kept loads without them; fall
  // back to the permanent records, which keep points, aces and blocks.
  let p: number | undefined = top?.playerIdx;
  let fallback: { apps: number } | null = null;
  if (top === undefined) {
    let best = -1;
    for (const q of club.players) {
      const recs = (world.competitionRecords.get(q) ?? []).filter((r) => r.season === world.season);
      const pts = recs.reduce((s, r) => s + r.points, 0);
      if (pts > best && pts > 0) { best = pts; p = q; }
    }
    if (p !== undefined) fallback = { apps: seasonTotals(world, p).apps };
  }

  if (p === undefined) {
    return (
      <section className="hm-card">
        <header className="hm-card-head"><h3>Top scorer (my team)</h3></header>
        <p className="hm-empty">Nobody has scored yet — the season is still to start.</p>
      </section>
    );
  }
  const pos = store.position[p] as Position;
  const recs = (world.competitionRecords.get(p) ?? []).filter((r) => r.season === world.season);
  const stats: Array<[string, string, boolean?]> = top !== undefined
    ? [
      ['Points', String(points(top)), true],
      ['Kills', String(top.attackKills)],
      ['Kill %', top.attacksTotal > 0 ? `${Math.round((top.attackKills / top.attacksTotal) * 100)}%` : '—'],
      ['Aces', String(top.serveAces)],
      ['Blocks', String(top.blockPoints)],
      ['Assists', String(top.setAssists)],
      ['Digs', String(top.digsTotal)],
      ['Errors', String(top.attackErrors + top.serveErrors + top.receptionErrors)],
    ]
    : [
      ['Points', String(recs.reduce((s, r) => s + r.points, 0)), true],
      ['Aces', String(recs.reduce((s, r) => s + r.aces, 0))],
      ['Blocks', String(recs.reduce((s, r) => s + r.blocks, 0))],
      ['Matches', String(fallback?.apps ?? 0)],
    ];

  return (
    <section className="hm-card hm-scorer">
      <div className="hm-scorer-top">
        <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={84} />
        <div className="hm-scorer-id">
          <span className="hm-label">Top scorer (my team)</span>
          <strong className="hm-scorer-name player-link" onClick={() => g.select(p!)}>{store.fullName(p)}</strong>
          <span className="hm-scorer-meta">
            <span className="hm-pos">{POSITION_NAMES[pos]}</span>
            {top !== undefined && <span className="dim">{top.matches} matches</span>}
            {top !== undefined && <span className="dim">{top.sets} sets</span>}
          </span>
        </div>
        <button className="hm-link hm-scorer-link" onClick={() => g.go('stats')}>All leaderboards <Icon name="arrowRight" size={13} /></button>
      </div>
      <div className="hm-stats">
        {stats.map(([label, value, gold]) => (
          <div key={label} className="hm-stat">
            <span>{label}</span>
            <b className={gold === true ? 'gold' : ''}>{value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
