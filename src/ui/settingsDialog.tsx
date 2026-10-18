/**
 * Settings: how the game looks, in this browser — the text size, colours a colour-blind eye can
 * tell apart, and less motion.
 */

import { useEffect, useState, type JSX } from 'react';
import { Icon } from './icons.tsx';
import type { Preferences, TextScale } from './preferences.ts';
import { useGame } from './state.ts';

const SCALES: ReadonlyArray<[TextScale, string]> = [[1, 'Normal'], [1.1, 'Large'], [1.25, 'Larger']];

export function SettingsDialog(): JSX.Element | null {
  const g = useGame();
  const [p, setP] = useState<Preferences>(g.prefs);
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') g.closeSettings(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const set = (next: Preferences): void => {
    setP(next);
    g.setPreferences(next);
  };
  return (
    <div className="settings-backdrop" onClick={() => g.closeSettings()}>
      <div className="settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <Icon name="gear" size={16} /> <b>Settings</b>
          <span className="flex-spacer" />
          <button className="icon-btn" onClick={() => g.closeSettings()} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>

        <section className="settings-group">
          <h4>Display</h4>
          <div className="settings-row">
            <span>Text size<small>The whole interface grows with it — as far as the window has room for it.</small></span>
            <span className="seg">
              {SCALES.map(([v, label]) => (
                <button key={v} className={p.textScale === v ? 'on' : ''} onClick={() => set({ ...p, textScale: v })}>{label}</button>
              ))}
            </span>
          </div>
          <label className="settings-row">
            <span>Colour-blind friendly colours<small>Good and bad, won and lost, up and down in blue and orange instead of green and red.</small></span>
            <input type="checkbox" checked={p.colourBlind} onChange={(e) => set({ ...p, colourBlind: e.target.checked })} />
          </label>
          <label className="settings-row">
            <span>Less motion<small>Stills the interface's animations.</small></span>
            <input type="checkbox" checked={p.reducedMotion} onChange={(e) => set({ ...p, reducedMotion: e.target.checked })} />
          </label>
        </section>

      </div>
    </div>
  );
}
