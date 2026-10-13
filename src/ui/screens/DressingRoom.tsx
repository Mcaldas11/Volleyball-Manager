/**
 * The dressing room: who the squad listens to, how well it holds together,
 * and who wears the armband.
 */

import type { JSX } from 'react';
import type { Position } from '../../engine/model/positions.ts';
import { NEUTRAL_COHESION, ROOM_TIER_NAMES, type RoomMember, type RoomTier } from '../../engine/world/dressingRoom.ts';
import { Bar, Card, Empty, Morale, PlayerFace, Pos, StatTile } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

function cohesionWord(c: number): { label: string; tone?: 'good' | 'bad' | 'warn' } {
  if (c >= 80) return { label: 'Very tight', tone: 'good' };
  if (c >= 65) return { label: 'Tight', tone: 'good' };
  if (c >= 50) return { label: 'Settled' };
  if (c >= 35) return { label: 'Unsettled', tone: 'warn' };
  return { label: 'Fractured', tone: 'bad' };
}

export function DressingRoomScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const room = g.dressingRoom();
  if (room === null || room.members.length === 0) return <Empty>No squad.</Empty>;
  const word = cohesionWord(room.cohesion);
  const edge = Math.round(Math.max(-1, Math.min(1, (room.cohesion - NEUTRAL_COHESION) / 40)) * 25) / 10;
  const top = Math.max(...room.members.map((m) => m.influence));
  const tier = (t: RoomTier): RoomMember[] => room.members.filter((m) => m.tier === t);

  return (
    <>
      <div className="tiles">
        <StatTile label="Cohesion" value={`${room.cohesion}`} tone={word.tone} sub={<>{word.label} <Bar value={room.cohesion} wide /></>} />
        <StatTile label="On court" value={`${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`} tone={edge > 0 ? 'good' : edge < 0 ? 'bad' : undefined}
          sub="what the room is worth to the side's play" />
        <StatTile label="Captain" value={room.captain >= 0 ? store.shortName(room.captain) : '—'}
          sub={room.viceCaptain >= 0 ? `vice-captain: ${store.shortName(room.viceCaptain)}` : 'no vice-captain named'} />
        <StatTile label="Leaders' mood" value={<Morale value={Math.round(room.leaderMorale)} />} sub="the room follows them" />
        <StatTile label="New faces" value={room.newcomers} tone={room.newcomers >= 5 ? 'warn' : undefined} sub="in their first season here" />
      </div>
      <div className="room-grid">
        {(['leader', 'influential', 'other'] as const).map((t) => (
          <Card key={t} title={ROOM_TIER_NAMES[t]} icon={t === 'leader' ? 'star' : t === 'influential' ? 'press' : 'squad'} flush className="room-card">
            <div className="room-list">
              {tier(t).map((m) => (
                <div key={m.p} className="room-row">
                  <PlayerFace playerId={store.id[m.p]} name={store.fullName(m.p)} size={30} />
                  <div className="room-who">
                    <span className="player-link" onClick={() => g.select(m.p)}>{store.fullName(m.p)}</span>
                    <span className="faint">
                      {room.captain === m.p && <span className="room-captain" title="Captain">C</span>}
                      {room.viceCaptain === m.p && <span className="room-captain vice" title="Vice-captain">VC</span>}
                      <Pos pos={store.position[m.p] as Position} /> <span title="Seasons at the club">{m.seasons} season{m.seasons === 1 ? '' : 's'}</span>
                    </span>
                  </div>
                  <span className="room-influence" title="How much the room listens to him"><Bar value={(m.influence / top) * 100} /></span>
                  <span className="room-morale"><Morale value={store.morale[m.p]} /></span>
                  {room.captain !== m.p && t !== 'other'
                    ? (
                      <span className="room-armband">
                        <button className="sm icon-btn" title="Make him captain" onClick={() => g.makeCaptain(m.p)}><Icon name="star" size={13} /></button>
                        {room.viceCaptain !== m.p && (
                          <button className="sm icon-btn room-vc" title="Make him vice-captain" onClick={() => g.makeViceCaptain(m.p)}>VC</button>
                        )}
                      </span>
                    )
                    : <span />}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="room-groups card">
        <span className="room-groups-title"><Icon name="squad" size={13} /> Groups</span>
        <div className="room-groups-body">
          <div className="room-group-list">
            {room.groups.map((grp) => (
              <span key={grp.key} className={`room-group ${grp.kind}`} title={grp.members.map((p) => store.fullName(p)).join(', ')}>
                <b>{grp.label}</b>
                <span className="faint">{grp.members.length}</span>
                <Morale value={Math.round(grp.mood)} />
              </span>
            ))}
            {room.isolated.map((p) => (
              <span key={p} className="room-group isolated" title="A foreigner in his first season here, with nobody from his country">
                <b className="player-link" onClick={() => g.select(p)}>{store.shortName(p)}</b>
                <span className="faint">on his own</span>
              </span>
            ))}
          </div>
          <div className="room-effects" title="What the groups do to the room's cohesion">
            {room.effects.length === 0
              ? <span className="faint">The groups get along: nothing to add or take away.</span>
              : room.effects.map((e) => (
                <span key={e.why} className={`room-effect ${e.points > 0 ? 'good' : 'bad'}`}>
                  <b>{e.points > 0 ? '+' : ''}{e.points}</b> {e.why}
                </span>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}
