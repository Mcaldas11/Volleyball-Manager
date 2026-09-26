import { useEffect, useState, type JSX } from 'react';
import { compareTableRows } from '../../engine/model/club.ts';
import type { Position } from '../../engine/model/positions.ts';
import { messageCategory, type GameMessage, type MessageCategory } from '../../engine/world/world.ts';
import {
  Card, ClubCrest, ClubLink, Empty, FormGuide, PlayerFace, Pos,
} from '../components.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { useGame } from '../state.ts';

type MessageTab = 'all' | 'new' | 'task' | 'offer' | 'interview';

/** Inbox tabs, in display order, each with the filter it applies. 'new' means
 *  unread rather than a message category — every other tab maps straight onto
 *  the category returned by {@link messageCategory}. */
const MESSAGE_TABS: ReadonlyArray<[MessageTab, string]> = [
  ['all', 'All'],
  ['new', 'New'],
  ['task', 'Tasks'],
  ['offer', 'Offers'],
  ['interview', 'Media'],
];

const CATEGORY_ICON: Readonly<Record<MessageCategory, IconName>> = {
  news: 'news',
  task: 'scouting',
  offer: 'offer',
  interview: 'press',
};

const CATEGORY_LABEL: Readonly<Record<MessageCategory, string>> = {
  news: 'Club news',
  task: 'Scouting',
  offer: 'Transfer offer',
  interview: 'Media',
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * The club's news hub — the landing page once you take charge. The inbox
 * and whichever message is open fill the left; what's coming up, where the
 * club stands and what happened elsewhere this week stack down the right.
 */
export function OverviewScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const [tab, setTab] = useState<MessageTab>('all');

  const allMessages = [...world.messages].reverse();
  // The newest message opens by default, the way a fresh inbox greets you.
  const [selectedId, setSelectedId] = useState<number | null>(() => allMessages[0]?.id ?? null);
  useEffect(() => {
    if (selectedId !== null) g.markMessageRead(selectedId);
  }, []);

  const counts: Record<MessageTab, number> = {
    all: allMessages.length,
    new: allMessages.filter((m) => m.read !== true).length,
    task: allMessages.filter((m) => messageCategory(m) === 'task').length,
    offer: allMessages.filter((m) => messageCategory(m) === 'offer').length,
    interview: allMessages.filter((m) => messageCategory(m) === 'interview').length,
  };
  const messages = allMessages.filter((m) => {
    if (tab === 'all') return true;
    if (tab === 'new') return m.read !== true;
    return messageCategory(m) === tab;
  });
  const selected = selectedId !== null ? world.messages.find((m) => m.id === selectedId) : undefined;

  const open = (id: number): void => {
    setSelectedId(id);
    g.markMessageRead(id);
  };

  return (
    <div className="home-grid">
      <Card
        className="inbox"
        title="Inbox"
        icon="news"
        flush
        actions={counts.new > 0 ? <span className="pill-count">{counts.new} unread</span> : undefined}
      >
        <div className="inbox-tabs">
          {MESSAGE_TABS.map(([key, label]) => (
            <button
              key={key}
              className={`inbox-tab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
              {counts[key] > 0 && <span className="inbox-tab-count">{counts[key]}</span>}
            </button>
          ))}
        </div>
        <div className="inbox-list">
          {messages.length === 0 && (
            <Empty>{tab === 'all' ? 'No messages yet.' : 'Nothing here right now.'}</Empty>
          )}
          {messages.map((m) => {
            const cat = messageCategory(m);
            const unread = m.read !== true;
            return (
              <button
                key={m.id}
                className={`inbox-row${selectedId === m.id ? ' active' : ''}${unread ? ' unread' : ''}`}
                onClick={() => open(m.id)}
              >
                <span className={`inbox-icon cat-${cat}`}><Icon name={CATEGORY_ICON[cat]} size={16} /></span>
                <span className="inbox-row-main">
                  <span className="inbox-row-top">
                    <span className="inbox-subject">{m.subject}</span>
                    <span className="inbox-date">{g.dateLabelForDay(m.day)}</span>
                  </span>
                  <span className="inbox-snippet">{m.body}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="reader" flush>
        {selected === undefined
          ? <div className="reader-empty"><Icon name="news" size={40} /><span>Select a message to read it.</span></div>
          : <MessageReader message={selected} />}
      </Card>

      <div className="home-side">
        <NextMatchWidget />
        <StandingWidget />
        <FormWidget />
        <ResultsWidget />
        <UpcomingWidget />
      </div>
    </div>
  );
}

/** The open message in full, with whatever it lets the manager act on. */
function MessageReader({ message: m }: { message: GameMessage }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const cat = messageCategory(m);
  const openOffer = m.offerId !== undefined && world.incomingOffers.some((o) => o.id === m.offerId);
  const session = m.fixtureId !== undefined
    ? world.pendingInterviews.find((s) => s.fixtureId === m.fixtureId)
    : undefined;
  const player = m.playerIdx;

  return (
    <div className="reader-inner">
      <div className="reader-head">
        <span className={`inbox-icon inbox-icon-lg cat-${cat}`}><Icon name={CATEGORY_ICON[cat]} size={22} /></span>
        <div className="reader-head-text">
          <span className="reader-cat">{CATEGORY_LABEL[cat]}</span>
          <h2 className="reader-subject">{m.subject}</h2>
          <span className="faint">{g.weekdayLabelForDay(m.day)} {g.dateLabelForDay(m.day)}</span>
        </div>
      </div>

      <div className="reader-body">
        <p className="reader-text">{m.body}</p>

        {player !== undefined && store.isActive(player) && (
          <div className="reader-player">
            <PlayerFace playerId={store.id[player]} name={store.fullName(player)} size={44} />
            <div className="reader-player-text">
              <strong>{store.fullName(player)}</strong>
              <span className="faint">
                {store.clubId[player] >= 0 ? world.clubs[store.clubId[player]]?.name : 'Free agent'}
                {' · '}Age {store.ageOn(player, world.year, 181)}
              </span>
            </div>
            <Pos pos={store.position[player] as Position} />
          </div>
        )}

        {m.seasonAwards !== undefined && (
          <table className="awards-table">
            <tbody>
              {m.seasonAwards.map((a, i) => (
                <tr key={i} className="clickable" onClick={() => g.select(a.playerIdx)}>
                  <td className="dim">{a.label}</td>
                  <td>{a.detail}</td>
                  <td className="num"><Icon name="chevronRight" size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(session !== undefined || openOffer || player !== undefined) && (
        <div className="reader-actions">
          {session !== undefined && (
            session.currentIndex === 0 && !session.finished ? (
              <>
                <button className="primary" onClick={() => g.openInterview(session.fixtureId)}>
                  <Icon name="press" size={15} /> Attend press conference
                </button>
                <button onClick={() => g.declineInterview(session.fixtureId)}>Decline</button>
              </>
            ) : (
              <button className="primary" onClick={() => g.openInterview(session.fixtureId)}>
                {session.finished ? 'View summary' : 'Resume conference'}
              </button>
            )
          )}
          {openOffer && m.offerId !== undefined && (
            <button className="primary" onClick={() => g.openOffer(m.offerId!)}>
              <Icon name="offer" size={15} /> Review offer
            </button>
          )}
          {!openOffer && player !== undefined && (
            <button className="primary" onClick={() => g.focusScouting(player)}>
              <Icon name="scouting" size={15} /> Open scouting report
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NextMatchWidget(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const next = g.nextFixture();
  if (next === null) {
    return <Card title="Next Match" icon="ball"><Empty>No fixtures scheduled.</Empty></Card>;
  }
  const home = world.clubs[next.home];
  const away = world.clubs[next.away];
  const comp = world.competitions[next.competitionId];
  const isHome = next.home === world.userClubId;
  const matchToday = next.day === world.day;
  const days = next.day - world.day;

  return (
    <Card title="Next Match" icon="ball" className="next-match">
      <div className="nm">
        <div className="nm-team">
          {home !== undefined && <ClubCrest club={home} size={48} />}
          <ClubLink id={next.home} crest={false} />
        </div>
        <div className="nm-mid">
          <span className="nm-vs">VS</span>
          <span className="nm-when">{matchToday ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>
        </div>
        <div className="nm-team">
          {away !== undefined && <ClubCrest club={away} size={48} />}
          <ClubLink id={next.away} crest={false} />
        </div>
      </div>
      <div className="nm-meta">
        <span>{g.weekdayLabelForDay(next.day)} {g.dateLabelForDay(next.day)}</span>
        <span>{comp?.name ?? ''}</span>
        <span className={`venue-tag ${isHome ? 'home' : 'away'}`}>{isHome ? 'Home' : 'Away'}</span>
      </div>
      <button className="primary block" onClick={() => g.openMatchday()}>
        <Icon name={matchToday ? 'ball' : 'fastForward'} size={15} />
        {matchToday ? 'Play match' : 'Skip to match day'}
      </button>
    </Card>
  );
}

function StandingWidget(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  const sortedTable = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const position = sortedTable.findIndex((r) => r.clubId === club.id);
  const standingRows = position < 0 || position < 5
    ? sortedTable.slice(0, 5)
    : [...sortedTable.slice(0, 5), sortedTable[position]];

  return (
    <Card
      title="League Standing"
      icon="trophy"
      flush
      actions={<button className="sm ghost" onClick={() => g.go('table')}>Full table</button>}
    >
      {comp === undefined ? <Empty>No league assigned.</Empty> : (
        <>
          <table className="mini-table">
            <thead>
              <tr>
                <th className="num">#</th><th>Club</th><th className="num">P</th><th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {standingRows.map((r) => (
                <tr key={r.clubId} className={r.clubId === club.id ? 'me' : ''}>
                  <td className="num faint">{sortedTable.findIndex((x) => x.clubId === r.clubId) + 1}</td>
                  <td><ClubLink id={r.clubId} /></td>
                  <td className="num dim">{r.played}</td>
                  <td className="num"><strong>{r.points}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="widget-foot">
            <span className="faint">Board expectation</span>
            <span>
              Finish {ordinal(club.boardExpectation)} or better
              {position >= 0 && (
                <span className={position + 1 <= club.boardExpectation ? 'good' : 'warn'}>
                  {' '}· now {ordinal(position + 1)}
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function FormWidget(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const played = g.ownFixtures().filter((f) => f.played).slice(-5);
  const results = played.map((f): 'W' | 'L' => {
    const isHome = f.home === world.userClubId;
    const won = isHome ? f.homeSets > f.awaySets : f.awaySets > f.homeSets;
    return won ? 'W' : 'L';
  });

  return (
    <Card title="Recent Form" icon="stats">
      {played.length === 0 ? <Empty>No matches played yet this season.</Empty> : (
        <>
          <div className="form-row-big"><FormGuide results={results} /></div>
          {[...played].reverse().map((f) => {
            const isHome = f.home === world.userClubId;
            const opp = isHome ? f.away : f.home;
            const us = isHome ? f.homeSets : f.awaySets;
            const them = isHome ? f.awaySets : f.homeSets;
            return (
              <div className="kv" key={f.id}>
                <span className="k">{isHome ? 'vs' : 'at'} <ClubLink id={opp} short /></span>
                <span className={`result-badge ${us > them ? 'win' : 'loss'}`}>{us}-{them}</span>
              </div>
            );
          })}
        </>
      )}
    </Card>
  );
}

function ResultsWidget(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const comp = world.competitions[club.leagueId];
  const recentResults = comp !== undefined
    ? comp.fixtureIds
      .map((id) => world.fixtures[id])
      .filter((f) => f.played && f.day > world.day - 7 && f.day <= world.day)
      .sort((a, b) => b.day - a.day)
      .slice(0, 8)
    : [];

  return (
    <Card title="Results This Week" icon="schedule">
      {recentResults.length === 0 ? <Empty>No results in the last week.</Empty> : recentResults.map((f) => (
        <div className="result-line" key={f.id}>
          <span className={`result-team${f.homeSets > f.awaySets ? ' won' : ''}`}><ClubLink id={f.home} short /></span>
          <span className="result-score">{f.homeSets}-{f.awaySets}</span>
          <span className={`result-team right${f.awaySets > f.homeSets ? ' won' : ''}`}><ClubLink id={f.away} short /></span>
        </div>
      ))}
    </Card>
  );
}

function UpcomingWidget(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const upcoming = g.ownFixtures().filter((f) => !f.played).slice(0, 5);

  return (
    <Card
      title="Upcoming Fixtures"
      icon="calendar"
      actions={<button className="sm ghost" onClick={() => g.go('fixtures')}>Schedule</button>}
    >
      {upcoming.length === 0 ? <Empty>No fixtures scheduled.</Empty> : upcoming.map((f) => {
        const isHome = f.home === club.id;
        const opponent = world.clubs[isHome ? f.away : f.home];
        return (
          <div className="kv" key={f.id}>
            <span className="k">{g.dateLabelForDay(f.day)}</span>
            <span className="upcoming-opp">
              <span className={`venue-tag ${isHome ? 'home' : 'away'}`}>{isHome ? 'H' : 'A'}</span>
              {opponent !== undefined ? <ClubLink id={opponent.id} short /> : '—'}
            </span>
          </div>
        );
      })}
    </Card>
  );
}
