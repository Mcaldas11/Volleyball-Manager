import { useEffect, useRef, type JSX } from 'react';
import type { Position } from '../../engine/model/positions.ts';
import { TRAIT_HINTS, TRAIT_NAMES, traitsOf } from '../../engine/model/traits.ts';
import { CHAT_HINTS, CHAT_LINES, CHAT_NAMES, CHAT_TOPICS, recentForm } from '../../engine/world/playerTalks.ts';
import { MOVE_REPLIES, MOVE_REPLY_HINTS, MOVE_REPLY_LINES, MOVE_REPLY_NAMES, RIGHT_OFFER } from '../../engine/world/blockedMoves.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import { Bar, Card, managerPhotoUrl, money, Morale, PersonFace, PlayerFace, Pos, RatingBadge } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

/**
 * A one-to-one in the manager's office: the player on one side — his mood,
 * his form, his games, what he has been promised — and the conversation on
 * the other, said line by line. He answers there and then, in his own words.
 */
export function PlayerTalkScreen(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const t = g.playerTalk;
  const logRef = useRef<HTMLDivElement>(null);
  const said = t?.lines.length ?? 0;
  // The newest line in view, as in any conversation.
  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [said]);
  if (t === null) return null;
  const store = world.players;
  const p = t.p;
  const name = store.fullName(p);
  const manager = world.manager;
  const managerName = `${manager.firstName} ${manager.lastName}`;
  const form = recentForm(world, p);
  const promise = (world.promises ?? []).find((x) => x.p === p);
  const movePromise = g.movePromise(p);
  // He came about the move the club blocked: that is what this talk is, until he has had his answer.
  const grievance = g.moveGrievance(p);
  const request = world.transferRequests?.[p];
  const lastChat = world.playerChats?.[p];
  const traits = traitsOf(store, p);
  const contractYear = world.startYear + contractEndSeason(store.contractUntil[p]) + 1;

  return (
    <div className="ptalk">
      <Card className="ptalk-side" title="In your office" icon="user">
        <div className="ptalk-who">
          <PlayerFace playerId={store.id[p]} name={name} size={96} />
          <h2 className="ptalk-name">{name}</h2>
          <span className="faint">
            <Pos pos={store.position[p] as Position} /> · {store.ageOn(p, world.year, 181)} years old
          </span>
          {traits.length > 0 && (
            <span className="ptalk-traits">
              {traits.map((x) => <span key={x} className="trait-tag" title={TRAIT_HINTS[x]}>{TRAIT_NAMES[x]}</span>)}
            </span>
          )}
        </div>
        <div className="ptalk-facts">
          <div className="ptalk-fact">
            <span>Morale</span>
            <span className="ptalk-fact-val"><Morale value={store.morale[p]} /> <Bar value={store.morale[p]} /></span>
          </div>
          <div className="ptalk-fact">
            <span>Recent form</span>
            <span className="ptalk-fact-val">{form !== null ? <RatingBadge value={form} size="sm" /> : <span className="faint">Too few games</span>}</span>
          </div>
          <div className="ptalk-fact">
            <span>Playing time</span>
            <span className="ptalk-fact-val">{Math.round(store.playingTime[p])}% <Bar value={store.playingTime[p]} /></span>
          </div>
          <div className="ptalk-fact">
            <span>Contract</span>
            <span className="ptalk-fact-val">Until {contractYear}</span>
          </div>
          <div className="ptalk-fact">
            <span>Promise</span>
            <span className="ptalk-fact-val">
              {promise !== undefined
                ? <span className="warn">Games due in {Math.max(0, promise.due - world.day)} days</span>
                : movePromise?.kind === 'contract'
                  ? <span className="warn">New contract due in {Math.max(0, movePromise.due - world.day)} days</span>
                  : movePromise?.kind === 'sale'
                    ? <span className="warn" title="Turn down a bid this size and he asks to leave">Can go for {money(Math.round(movePromise.fee * RIGHT_OFFER))}+</span>
                    : <span className="faint">None</span>}
            </span>
          </div>
          <div className="ptalk-fact">
            <span>Wants to leave</span>
            <span className="ptalk-fact-val">
              {request === undefined ? <span className="faint">No</span>
                : request.status === 'listed' ? <span className="warn">Listed at his request</span>
                  : request.status === 'promised' ? <span className="warn">Stays, for games</span>
                    : <span className="bad">{request.status === 'refused' ? 'Yes — refused' : 'Yes — asked'}</span>}
            </span>
          </div>
          <div className="ptalk-fact">
            <span>Last talk</span>
            <span className="ptalk-fact-val faint">
              {lastChat === undefined ? 'Never' : world.day - lastChat === 0 ? 'Today' : `${world.day - lastChat} days ago`}
            </span>
          </div>
        </div>
      </Card>

      <Card className="ptalk-chat" title={grievance !== undefined ? `${store.shortName(p)} wants a word: the blocked move` : `A word with ${store.shortName(p)}`} icon="press" flush>
        <div className="ptalk-log" ref={logRef}>
          {t.lines.map((line, i) => (line.who === 'note' ? (
            <div key={i} className="ptalk-note">
              <span>{line.text}</span>
              {line.morale !== undefined && line.morale !== 0 && (
                <span className={`ptalk-delta ${line.morale > 0 ? 'good' : 'bad'}`}>
                  Morale {line.morale > 0 ? '+' : ''}{line.morale}
                </span>
              )}
            </div>
          ) : (
            <div key={i} className={`ptalk-line ${line.who}`}>
              {line.who === 'him'
                ? <PlayerFace playerId={store.id[p]} name={name} size={34} />
                : <PersonFace photoUrl={managerPhotoUrl(manager)} name={managerName} size={34} />}
              <div className="ptalk-bubble">
                <span className="ptalk-speaker">{line.who === 'him' ? store.shortName(p) : 'You'}</span>
                {line.text}
              </div>
            </div>
          )))}
        </div>
        <div className="ptalk-options">
          {grievance !== undefined && MOVE_REPLIES.map((reply) => (
            <button key={reply} className="ptalk-option" title={MOVE_REPLY_HINTS[reply]} onClick={() => g.answerMoveTalk(reply)}>
              <span className="ptalk-option-name">{MOVE_REPLY_NAMES[reply]}</span>
              <span className="ptalk-option-line">“{MOVE_REPLY_LINES[reply]}”</span>
              <span className="ptalk-option-hint">{MOVE_REPLY_HINTS[reply]}</span>
            </button>
          ))}
          {grievance === undefined && CHAT_TOPICS.map((topic) => {
            const block = topic === 'mood' && t.asked.includes('mood') ? 'You have just asked him.' : g.chatBlock(p, topic);
            return (
              <button key={topic} className="ptalk-option" disabled={block !== null} title={block ?? CHAT_HINTS[topic]}
                onClick={() => g.sayToPlayer(topic)}>
                <span className="ptalk-option-name">{CHAT_NAMES[topic]}</span>
                <span className="ptalk-option-line">“{CHAT_LINES[topic]}”</span>
                <span className="ptalk-option-hint">{block ?? CHAT_HINTS[topic]}</span>
              </button>
            );
          })}
          <button className="ptalk-option ptalk-leave" onClick={() => g.closePlayerTalk()}>
            <span className="ptalk-option-name"><Icon name="back" size={13} /> End conversation</span>
            <span className="ptalk-option-hint">{grievance !== undefined ? 'He is still waiting for an answer' : 'Back to his profile'}</span>
          </button>
        </div>
      </Card>
    </div>
  );
}
