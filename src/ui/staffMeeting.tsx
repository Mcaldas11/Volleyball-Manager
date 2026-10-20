/**
 * The monthly staff meeting: each member of the staff with what they bring, to take or leave —
 * on its own screen under Staff, and in the inbox message that announces it.
 */

import { useState, type JSX } from 'react';
import { POSITION_NAMES, type Position } from '../engine/model/positions.ts';
import { STAFF_ROLE_NAMES } from '../engine/model/staff.ts';
import { openItems, type MeetingItem, type MeetingKind, type StaffMeeting } from '../engine/world/staffMeeting.ts';
import { Card, Empty, initials, PlayerFace, Pos } from './components.tsx';
import { Icon, type IconName } from './icons.tsx';
import { useGame } from './state.ts';

const KIND_META: Readonly<Record<MeetingKind, { label: string; icon: IconName; tone: string }>> = {
  renew: { label: 'Contract', icon: 'contract', tone: 'gold' },
  position: { label: 'Recruitment', icon: 'scouting', tone: 'blue' },
  injury: { label: 'Medical', icon: 'medical', tone: 'red' },
  youth: { label: 'Academy', icon: 'youth', tone: 'green' },
  loan: { label: 'Development', icon: 'swap', tone: 'teal' },
  sell: { label: 'Squad', icon: 'transfers', tone: 'orange' },
  morale: { label: 'Morale', icon: 'press', tone: 'purple' },
};

const STATUS_LABEL: Readonly<Record<MeetingItem['status'], string>> = {
  open: '', accepted: 'Taken', declined: 'Left', lapsed: 'Lapsed',
};

/** One meeting's suggestions, each to take or leave. */
export function MeetingSheet({ meeting }: { meeting: StaffMeeting }): JSX.Element {
  const g = useGame();
  const open = openItems(meeting).length;
  return (
    <div className="meet">
      <div className="meet-head">
        <span><Icon name="staff" size={14} /> Staff meeting · {g.longDateLabel(meeting.day)}</span>
        <span className={open > 0 ? 'meet-open' : 'meet-done'}>
          {open > 0 ? `${open} to answer` : 'All answered'}
        </span>
      </div>
      {meeting.items.map((it) => <MeetingItemCard key={it.id} meetingId={meeting.id} item={it} />)}
    </div>
  );
}

function MeetingItemCard({ meetingId, item: it }: { meetingId: number; item: MeetingItem }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const meta = KIND_META[it.kind];
  const p = it.p;
  const live = p !== undefined && store.isActive(p);
  return (
    <article className={`meet-item tone-${meta.tone}${it.status !== 'open' ? ` ${it.status}` : ''}`}>
      <header className="meet-item-top">
        <span className="meet-who">
          <span className="meet-badge">{initials(it.from)}</span>
          <span><b>{it.from}</b><small>{STAFF_ROLE_NAMES[it.role]}</small></span>
        </span>
        <span className={`meet-kind tone-${meta.tone}`}><Icon name={meta.icon} size={12} /> {meta.label}</span>
      </header>
      <h4>{it.title}</h4>
      <p>{it.text}</p>
      {live && (
        <button className="meet-player" onClick={() => g.select(p)} title="Open his profile">
          <PlayerFace playerId={p} name={store.fullName(p)} size={28} />
          <span>{store.fullName(p)}</span>
          <Pos pos={store.position[p] as Position} />
          <small>{store.ageOn(p, world.year, 181)} · {store.currentAbility[p]}</small>
        </button>
      )}
      {it.kind === 'position' && it.position !== undefined && it.status === 'open' && (
        <button className="meet-player" onClick={() => g.go('planner')} title="See the squad plan">
          <Pos pos={it.position} /> <span>{POSITION_NAMES[it.position]}s on the squad plan</span>
        </button>
      )}
      <footer className="meet-actions">
        {it.status === 'open' ? (
          <>
            <button className="primary" onClick={() => g.acceptSuggestion(meetingId, it.id)}><Icon name="check" size={13} /> {it.accept}</button>
            <button onClick={() => g.declineSuggestion(meetingId, it.id)}>Leave it</button>
          </>
        ) : (
          <>
            <span className={`meet-status ${it.status}`}>{it.status === 'accepted' && <Icon name="check" size={12} />} {STATUS_LABEL[it.status]}</span>
            {it.outcome !== undefined && <span className="meet-outcome">{it.outcome}</span>}
            {it.status === 'lapsed' && <span className="meet-outcome">Not answered before the next meeting.</span>}
          </>
        )}
      </footer>
    </article>
  );
}

/** The Staff Meeting screen: this month's meeting, and the ones before it. */
export function StaffMeetingScreen(): JSX.Element {
  const g = useGame();
  const meetings = [...g.staffMeetings()].reverse();
  const [picked, setPicked] = useState<number | null>(null);
  if (meetings.length === 0) {
    return <Empty>The staff meet on the 3rd of every month. Their first meeting is still to come.</Empty>;
  }
  const meeting = meetings.find((m) => m.id === picked) ?? meetings[0];
  return (
    <div className="meet-screen">
      <Card title="Meetings" icon="calendar" flush className="meet-list-card">
        <div className="meet-list">
          {meetings.map((m) => {
            const open = openItems(m).length;
            return (
              <button key={m.id} className={`meet-list-row${m.id === meeting.id ? ' on' : ''}`} onClick={() => setPicked(m.id)}>
                <span>{g.longDateLabel(m.day)}</span>
                <small>{m.items.length} suggestion{m.items.length === 1 ? '' : 's'}</small>
                {open > 0 && <i className="meet-dot">{open}</i>}
              </button>
            );
          })}
        </div>
      </Card>
      <Card title="What the staff brought" icon="staff" flush className="meet-main-card">
        <div className="meet-scroll"><MeetingSheet meeting={meeting} /></div>
      </Card>
    </div>
  );
}
