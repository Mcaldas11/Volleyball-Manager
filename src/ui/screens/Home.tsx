import type { JSX } from 'react';
import { ATTR_LABELS, type AttributeName } from '../../engine/model/attributes.ts';
import { compareTableRows } from '../../engine/model/club.ts';
import { Position, POSITION_NAMES } from '../../engine/model/positions.ts';
import { matchRating } from '../../engine/match/playerRating.ts';
import { stageLabel } from '../../engine/season/cups.ts';
import { seasonTotals } from '../../engine/world/records.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { boardMood } from '../../engine/world/career.ts';
import {
  attrClass, Bar, ClubCrest, money, PlayerFace, RatingBadge, StarMeter,
} from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';
import { UnemployedHome } from './Career.tsx';
import { NationalHome } from './National.tsx';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

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
    <div className="home">
      <NowManaging />
      <div className="home-row">
        <LeagueTableCard />
        <OneToWatch />
        <TeamForm />
      </div>
      <div className="home-row home-row-2">
        <TopScorer />
        <BoardCard />
        <FinancesCard />
      </div>
    </div>
  );
}

function NowManaging(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const next = g.nextFixture();
  const manager = `${world.manager.firstName} ${world.manager.lastName}`;
  const league = world.competitions[club.leagueId];

  if (next === null) {
    return (
      <section className="hm-banner">
        <div className="hm-banner-main">
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
  const shortDate = date === null ? '' : date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });

  return (
    <section className="hm-banner">
      <div className="hm-banner-main">
        <div className="hm-kicker">
          Now managing · {stageLabel(world, next)} · {shortDate} · {comp?.name ?? ''} · <span>{manager}</span>
        </div>
        <div className="hm-teams">
          <ClubCrest club={club} size={54} />
          <span className="hm-team-name">{club.name}</span>
          <span className="hm-vs">VS</span>
          {opponent !== undefined && <ClubCrest club={opponent} size={54} />}
          <span className="hm-team-name link" onClick={() => opponent !== undefined && g.selectClub(opponent.id)}>
            {opponent?.name ?? '—'}
          </span>
        </div>
        <div className="hm-sub">
          {comp?.name ?? ''} · {today ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
        </div>
      </div>
      <div className="hm-banner-side">
        <div className="hm-side-line">
          <span className={`hm-venue${isHome && !next.neutralVenue ? ' is-home' : ''}`}>
            {next.neutralVenue ? 'Neutral' : isHome ? 'Home' : 'Away'}
          </span>
          <button className="hm-link" onClick={() => g.go('calendar')}>Calendar <Icon name="arrowRight" size={14} /></button>
        </div>
        <span className="hm-chip">Transfer budget <b>{money(club.finances.transferBudget)}</b></span>
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

function TeamForm(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const played = g.ownFixtures().filter((f) => f.played);
  const last5 = played.slice(-5);
  const won = (f: (typeof played)[number]): boolean =>
    f.home === club.id ? f.homeSets > f.awaySets : f.awaySets > f.homeSets;
  const wins = last5.filter(won).length;
  const setsFor = last5.reduce((s, f) => s + (f.home === club.id ? f.homeSets : f.awaySets), 0);
  const last = played[played.length - 1];

  return (
    <section className="hm-card">
      <header className="hm-card-head"><h3>Recent team form</h3></header>
      {last5.length === 0 ? <p className="hm-empty">No matches played yet this season.</p> : (
        <>
          <div className="hm-pips">
            {last5.map((f) => <span key={f.id} className={`hm-pip ${won(f) ? 'win' : 'loss'}`}>{won(f) ? 'W' : 'L'}</span>)}
          </div>
          <div className="hm-figures">
            <div><b className="gold">{Math.round((wins / last5.length) * 100)}%</b><span>Win rate</span></div>
            <div><b>{(setsFor / last5.length).toFixed(1)}</b><span>Sets / match</span></div>
          </div>
        </>
      )}
      {last !== undefined && <LastMatch fixtureId={last.id} />}
    </section>
  );
}

function LastMatch({ fixtureId }: { fixtureId: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const f = world.fixtures[fixtureId];
  const home = world.clubs[f.home];
  const away = world.clubs[f.away];
  const watched = g.reviewLast();
  let rating: number | null = null;
  if (watched !== null && watched.fixture.id === f.id && f.mvp >= 0) {
    const r = watched.result;
    const homeLine = r.stats.home.players.get(f.mvp);
    const line = homeLine ?? r.stats.away.players.get(f.mvp);
    if (line !== undefined) {
      rating = matchRating(line, store.position[f.mvp] as Position,
        homeLine !== undefined ? r.homeSets : r.awaySets, homeLine !== undefined ? r.awaySets : r.homeSets);
    }
  }
  return (
    <div className="hm-last">
      <div className="hm-label">Last match</div>
      <div className="hm-last-round">{world.competitions[f.competitionId]?.name} · {stageLabel(world, f)}</div>
      <div className="hm-last-score">
        {([[home, f.homeSets, f.homeSets > f.awaySets], [away, f.awaySets, f.awaySets > f.homeSets]] as const).map(([c, sets, won], i) => (
          <div key={i} className={`hm-last-team${won ? ' won' : ''}${c?.id === world.userClubId ? ' mine' : ''}`}>
            {c !== undefined && <ClubCrest club={c} size={24} />}
            <span>{c?.name ?? '—'}</span>
            <b>{sets}</b>
          </div>
        ))}
      </div>
      <div className="hm-last-sets">{f.setScores.map(([h, a]) => `${h}-${a}`).join(' · ')}</div>
      {f.mvp >= 0 && (
        <div className="hm-last-mvp">
          Top performer <b className="player-link" onClick={() => g.select(f.mvp)}>{store.surname(f.mvp)}</b>
          {rating !== null && <RatingBadge value={rating} size="sm" />}
        </div>
      )}
      <button className="hm-link" onClick={() => g.go('fixtures')}><Icon name="play" size={11} /> Match report</button>
    </div>
  );
}

/** The club's leading points scorer this season, with his full line. */
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

function BoardCard(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  const table = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const pos = table.findIndex((r) => r.clubId === club.id) + 1;
  const started = (table.find((r) => r.clubId === club.id)?.played ?? 0) > 0;
  const target = club.boardExpectation;

  // The board's mood is its confidence in the coach; the league line is
  // where the table has the club against the target.
  const confidence = club.boardConfidence;
  const moodCls = confidence >= 60 ? 'good' : confidence >= 45 ? 'dim' : confidence >= 35 ? 'warn' : 'bad';
  let league: [string, string] = ['Season not started', 'neutral'];
  if (started) {
    if (pos <= target) league = ['On course', 'good'];
    else if (pos === target + 1) league = ['At risk', 'warn'];
    else league = ['Off course', 'bad'];
  }
  const wages = g.wageBill();
  const withinWages = wages <= club.finances.wageBudget;

  return (
    <section className="hm-card hm-board">
      <header className="hm-card-head">
        <h3>Board confidence</h3>
        <button className="hm-link" onClick={() => g.go('career')}>Details</button>
      </header>
      <div className={`hm-mood ${moodCls}`}>{boardMood(confidence)}</div>
      <div className="hm-conf"><Bar value={confidence} wide /></div>
      <div className="hm-target">Finish {ordinal(target)} or better{started ? ` · now ${ordinal(pos)}` : ''}</div>
      <div className="hm-board-rows">
        <div className="hm-board-row"><span>Domestic league</span><span className={`hm-pill ${league[1]}`}>{league[0]}</span></div>
        <div className="hm-board-row">
          <span>Season squad wages</span>
          <span className={`hm-pill ${withinWages ? 'good' : 'bad'}`}>{withinWages ? 'Within forecast' : 'Over budget'}</span>
        </div>
      </div>
    </section>
  );
}

function FinancesCard(): JSX.Element {
  const g = useGame();
  const club = g.club!;
  const wages = g.wageBill();
  const f = club.finances;
  return (
    <section className="hm-card hm-fin">
      <header className="hm-card-head">
        <h3>Finances</h3>
        <button className="hm-link" onClick={() => g.go('finances')}>Details</button>
      </header>
      <div className="hm-fin-rows">
        <div className="hm-fin-row"><span>Balance</span><b className={f.balance < 0 ? 'bad' : ''}>{money(f.balance)}</b></div>
        <div className="hm-fin-row"><span>Transfer budget</span><b className="gold">{money(f.transferBudget)}</b></div>
        <div className="hm-fin-row">
          <span>Squad wages <small>{money(wages / 12)} a month</small></span>
          <b>{money(wages)}</b>
        </div>
        <div className="hm-fin-row"><span>Wage budget</span><b>{money(f.wageBudget)}</b></div>
      </div>
    </section>
  );
}
