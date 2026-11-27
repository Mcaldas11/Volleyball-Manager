/**
 * Promoting a youth player: the position he will play in the first team, chosen
 * here, with what he would be worth at each one now.
 */

import { useEffect, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { abilityAt } from '../engine/model/ability.ts';
import { Position, POSITION_NAMES } from '../engine/model/positions.ts';
import { PlayerFace } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

const ORDER: readonly Position[] = [
  Position.Setter, Position.OutsideHitter, Position.Opposite, Position.MiddleBlocker, Position.Libero,
];

export function PromoteDialog(): JSX.Element | null {
  const g = useGame();
  const p = g.promoting;
  if (g.world === null || p === null) return null;
  return <PromoteForm p={p} />;
}

function PromoteForm({ p }: { p: number }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const natural = store.position[p] as Position;
  const [pick, setPick] = useState<Position>(natural);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') g.cancelPromote(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const name = store.fullName(p);
  return createPortal(
    <div className="hol-overlay" onClick={(e) => { e.stopPropagation(); g.cancelPromote(); }}>
      <div className="hol-card confirm-card promote-card" role="dialog" aria-modal="true" aria-label="Promote to the first team" onClick={(e) => e.stopPropagation()}>
        <header className="hol-top">
          <span className="hol-crumbs"><Icon name="arrowRight" size={12} /> <b>Promote to the first team</b></span>
          <button className="icon-btn" onClick={() => g.cancelPromote()} title="Close"><Icon name="close" size={16} /></button>
        </header>
        <div className="confirm-body">
          <div className="promote-who">
            <PlayerFace playerId={store.id[p]} name={name} size={44} />
            <div>
              <b translate="no">{name}</b>
              <span className="faint">Which position will he play in the first team?</span>
            </div>
          </div>
          <div className="promote-options" role="radiogroup">
            {ORDER.map((pos) => {
              const fam = store.familiarityWith(p, pos);
              return (
                <button
                  key={pos}
                  role="radio"
                  aria-checked={pick === pos}
                  className={`promote-option${pick === pos ? ' active' : ''}`}
                  onClick={() => setPick(pos)}
                >
                  <span className="promote-pos">{POSITION_NAMES[pos]}</span>
                  <span className="faint">{pos === natural ? 'His position now' : fam >= 100 ? 'Plays it in full' : fam >= 40 ? 'Knows it a little' : 'New to him'}</span>
                  <b className="num">{abilityAt(store, p, pos)}</b>
                </button>
              );
            })}
          </div>
          <p className="confirm-detail">
            {pick === natural
              ? 'He goes up in the position he has always played.'
              : `He goes up as a ${POSITION_NAMES[pick].toLowerCase()}, and keeps ${POSITION_NAMES[natural].toLowerCase()} as his second position.`}
          </p>
        </div>
        <footer className="confirm-foot">
          <button onClick={() => g.cancelPromote()}>Cancel</button>
          <button className="primary" onClick={() => g.promotePlayer(p, pick)}>Promote</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
