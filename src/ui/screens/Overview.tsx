import { useState, type JSX } from 'react';
import { compareTableRows } from '../../engine/model/club.ts';
import { messageCategory } from '../../engine/world/world.ts';
import { ClubLink, Empty } from '../components.tsx';
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
  ['interview', 'Interviews'],
];

/**
 * The club's news hub — the landing page once you take charge. Messages,
 * what's coming up, where the club stands, and what happened elsewhere in
 * the league while time passed.
 */
export function OverviewScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const [tab, setTab] = useState<MessageTab>('all');

  const allMessages = [...world.messages].reverse();
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

  const upcoming = g.ownFixtures().filter((f) => !f.played).slice(0, 5);

  const comp = world.competitions[club.leagueId];
  const sortedTable = comp !== undefined ? [...comp.table].sort(compareTableRows) : [];
  const position = sortedTable.findIndex((r) => r.clubId === club.id);
  const standingRows = position < 0 || position < 5
    ? sortedTable.slice(0, 5)
    : [...sortedTable.slice(0, 5), sortedTable[position]];

  const recentResults = comp !== undefined
    ? comp.fixtureIds
      .map((id) => world.fixtures[id])
      .filter((f) => f.played && f.day > world.day - 7 && f.day <= world.day)
      .sort((a, b) => b.day - a.day)
      .slice(0, 8)
    : [];

  return (
    <>
      <h1>Overview</h1>
      <p className="subtitle">{g.dateLabel()}</p>

      {/* Messages run the full height of the page on the left, exactly as
          wide a single column as it needs — everything else (news, the
          table, the fixture list) stacks in reading order to its right. */}
      <div className="overview-layout">
        <div className="panel overview-messages">
          <h3>Messages</h3>
          <div className="chip-group" style={{ marginBottom: 10 }}>
            {MESSAGE_TABS.map(([key, label]) => (
              <span
                key={key}
                className={`chip${tab === key ? ' active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
              </span>
            ))}
          </div>
          {messages.length === 0 ? (
            <Empty>{tab === 'all' ? 'No messages yet.' : 'Nothing here right now.'}</Empty>
          ) : (
            <div className="club-list">
              {messages.map((m) => {
                const openOffer = m.offerId !== undefined
                  && world.incomingOffers.some((o) => o.id === m.offerId);
                const session = m.fixtureId !== undefined
                  ? world.pendingInterviews.find((s) => s.fixtureId === m.fixtureId)
                  : undefined;
                const clickable = openOffer || m.playerIdx !== undefined;
                const unread = m.read !== true;
                return (
                  <div
                    key={m.id}
                    className={clickable ? 'clickable' : ''}
                    onClick={() => {
                      g.markMessageRead(m.id);
                      if (openOffer && m.offerId !== undefined) g.openOffer(m.offerId);
                      else if (m.playerIdx !== undefined) g.focusScouting(m.playerIdx);
                    }}
                    style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}
                  >
                    <div className="kv">
                      <strong>
                        {unread && <span className="msg-unread-dot" />}
                        {m.subject}
                      </strong>
                      <span className="faint">{g.dateLabelForDay(m.day)}</span>
                    </div>
                    <div className="dim">{m.body}</div>
                    {m.seasonAwards !== undefined && (
                      <table style={{ marginTop: 6 }}>
                        <tbody>
                          {m.seasonAwards.map((a, i) => (
                            <tr
                              key={i}
                              className="clickable"
                              onClick={(e) => { e.stopPropagation(); g.select(a.playerIdx); }}
                            >
                              <td className="dim">{a.label}</td>
                              <td>{a.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {session !== undefined && (
                      <div className="toolbar" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                        {session.currentIndex === 0 && !session.finished ? (
                          <>
                            <button className="primary" onClick={() => g.openInterview(session.fixtureId)}>
                              Attend
                            </button>
                            <button onClick={() => g.declineInterview(session.fixtureId)}>Decline</button>
                          </>
                        ) : (
                          <button onClick={() => g.openInterview(session.fixtureId)}>
                            {session.finished ? 'View summary' : 'Resume conference'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="overview-main">
          <div className="panel">
            <h3>Results this week</h3>
            {recentResults.length === 0 ? <Empty>No results in the last week.</Empty> : recentResults.map((f) => (
              <div className="kv" key={f.id}>
                <span><ClubLink id={f.home} short /> vs <ClubLink id={f.away} short /></span>
                <span className="mono">{f.homeSets}-{f.awaySets}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>League standing</h3>
            {comp === undefined ? <Empty>No league assigned.</Empty> : (
              <table>
                <thead>
                  <tr>
                    <th className="num">#</th><th>Club</th><th className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standingRows.map((r) => (
                    <tr key={r.clubId} className={r.clubId === club.id ? 'selected' : ''}>
                      <td className="num faint">
                        {sortedTable.findIndex((x) => x.clubId === r.clubId) + 1}
                      </td>
                      <td><ClubLink id={r.clubId} short /></td>
                      <td className="num"><strong>{r.points}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button onClick={() => g.go('table')}>View full table</button>
            </div>
          </div>

          <div className="panel">
            <h3>Upcoming fixtures</h3>
            {upcoming.length === 0 ? <Empty>No fixtures scheduled.</Empty> : upcoming.map((f) => {
              const isHome = f.home === club.id;
              const opponent = world.clubs[isHome ? f.away : f.home];
              return (
                <div className="kv" key={f.id}>
                  <span className="k">{g.dateLabelForDay(f.day)}</span>
                  <span>
                    {isHome ? 'vs' : 'at'}{' '}
                    {opponent !== undefined ? <ClubLink id={opponent.id} short /> : '—'}
                  </span>
                </div>
              );
            })}
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button onClick={() => g.go('fixtures')}>View fixtures</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
