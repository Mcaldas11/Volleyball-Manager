/**
 * The tactic switcher over the Lineup screens, the way FM has it: the loaded
 * tactic by number and name, a menu of the others saved — load one, rename
 * it, throw it away — and a way to start a new one from the defaults.
 */

import { useState, type JSX } from 'react';
import { MAX_TACTICS, tacticFormationLabel } from '../engine/model/tacticSlots.ts';
import { useDismiss } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

export function TacticPicker(): JSX.Element | null {
  const g = useGame();
  const club = g.club;
  const saved = g.savedTactics();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const ref = useDismiss(open, () => { setOpen(false); setEditing(null); });
  if (club === null || saved === null) return null;
  const { slots, active } = saved;
  const loaded = slots[active];

  const startRename = (i: number): void => {
    setEditing(i);
    setDraft(slots[i].name);
  };
  const commitRename = (): void => {
    if (editing !== null) g.renameTactic(editing, draft);
    setEditing(null);
  };

  return (
    <div className="tactic-picker" ref={ref}>
      <button className={`tactic-current${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)} title="Saved tactics">
        <span className="tactic-num">{active + 1}</span>
        <span className="tactic-name">{loaded.name}</span>
        <span className="tactic-form">{tacticFormationLabel(club, active)}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      <button
        className="tactic-add"
        disabled={slots.length >= MAX_TACTICS}
        title={slots.length >= MAX_TACTICS ? `You can keep ${MAX_TACTICS} tactics` : 'New tactic, from the defaults'}
        onClick={() => g.newTactic()}
      >
        +
      </button>

      {open && (
        <div className="menu-pop tactic-menu">
          <div className="tactic-menu-head">
            <span>Saved tactics</span>
            <span className="faint">{slots.length}/{MAX_TACTICS}</span>
          </div>
          {slots.map((t, i) => (
            <div key={i} className={`tactic-row${i === active ? ' on' : ''}`}>
              <span className="tactic-num">{i + 1}</span>
              {editing === i ? (
                <input
                  className="tactic-rename"
                  value={draft}
                  autoFocus
                  maxLength={32}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <button className="tactic-load" onClick={() => { g.loadTactic(i); setOpen(false); }}>
                  <span className="tactic-name">{t.name}</span>
                  <span className="tactic-form">{tacticFormationLabel(club, i)}</span>
                  {i === active && <span className="tactic-loaded">Loaded</span>}
                </button>
              )}
              <button className="tactic-icon" title="Rename" onClick={() => startRename(i)}>Aa</button>
              <button
                className="tactic-icon"
                title={slots.length <= 1 ? 'Your only tactic' : 'Delete'}
                disabled={slots.length <= 1}
                onClick={() => g.deleteTactic(i)}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          <button
            className="tactic-new"
            disabled={slots.length >= MAX_TACTICS}
            onClick={() => { g.newTactic(); setOpen(false); }}
          >
            + New tactic <span className="faint">— from the defaults</span>
          </button>
          <p className="tactic-note">
            Each tactic keeps its own formation, instructions, rotations and team sheet. Changes to the loaded one
            are kept when you load another.
          </p>
        </div>
      )}
    </div>
  );
}
