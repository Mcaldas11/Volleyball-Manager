/**
 * Preferences: how the game looks, sounds and draws, in this browser — tab by tab, down the side as
 * Football Manager has them. The interface: text size, colours a colour-blind eye can tell apart,
 * less motion, the language. The graphics: a quality preset and its details — sharpness, smoothing, shadows —
 * the most frames a second, and a counter of them. The match: the view and the camera it opens
 * with. The sound: on or off, and how loud.
 */

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { CAMERA_MODES, type CameraMode } from './courtCameras.ts';
import { Dropdown } from './dropdown.tsx';
import { Icon, type IconName } from './icons.tsx';
import { LANGUAGES, language, setLanguage, type Language } from './language.ts';
import {
  QUALITY, qualityOf, type FrameCap, type Graphics, type Preferences, type Quality, type Shadows, type TextScale,
} from './preferences.ts';
import { setSoundOn, setSoundVolume, soundOn, soundVolume } from './sound.ts';
import { useGame } from './state.ts';

const SCALES: ReadonlyArray<[TextScale, string]> = [[1, 'Normal'], [1.1, 'Large'], [1.25, 'Larger']];
const QUALITIES: ReadonlyArray<[Quality, string]> = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']];
const RATIOS: ReadonlyArray<[Graphics['pixelRatio'], string]> = [[0.75, '75%'], [1, '100%'], [1.5, '150%'], [2, '200%']];
const SHADOWS: ReadonlyArray<[Shadows, string]> = [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']];
const CAPS: ReadonlyArray<[FrameCap, string]> = [[30, '30'], [60, '60'], [120, '120'], [0, 'Unlimited']];

type Tab = 'interface' | 'graphics' | 'match' | 'sound';
const TABS: ReadonlyArray<{ id: Tab; label: string; icon: IconName; hint: string }> = [
  { id: 'interface', label: 'Interface', icon: 'menu', hint: 'Text, colours, motion and language' },
  { id: 'graphics', label: 'Graphics', icon: 'camera', hint: 'Quality and frame rate' },
  { id: 'match', label: 'Match', icon: 'whistle', hint: 'How matches are watched' },
  { id: 'sound', label: 'Sound', icon: 'sound', hint: 'Match sounds' },
];

/** A row of buttons, one of them on. */
function Seg<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <span className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </span>
  );
}

function Row({ label, hint, children, check }: { label: string; hint: string; children: ReactNode; check?: boolean }): JSX.Element {
  const text = <span>{label}<small>{hint}</small></span>;
  return check === true
    ? <label className="settings-row">{text}{children}</label>
    : <div className="settings-row">{text}{children}</div>;
}

export function PreferencesDialog(): JSX.Element | null {
  const g = useGame();
  const [p, setP] = useState<Preferences>(g.prefs);
  const [tab, setTab] = useState<Tab>('interface');
  const [sound, setSound] = useState(soundOn);
  const [volume, setVolume] = useState(soundVolume);
  const [lang, setLang] = useState<Language>(language);
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') g.closeSettings(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const set = (next: Preferences): void => {
    setP(next);
    g.setPreferences(next);
  };
  const setGraphics = (next: Partial<Graphics>): void => set({ ...p, graphics: { ...p.graphics, ...next } });
  const quality = qualityOf(p.graphics);
  const screenRatio = window.devicePixelRatio || 1;
  return (
    <div className="settings-backdrop" onClick={() => g.closeSettings()}>
      <div className="settings prefs" role="dialog" aria-label="Preferences" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <Icon name="gear" size={16} /> <b>Preferences</b>
          <span className="flex-spacer" />
          <button className="icon-btn" onClick={() => g.closeSettings()} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>

        <div className="prefs-body">
          <nav className="prefs-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`prefs-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={16} />
                <span><b>{t.label}</b><small>{t.hint}</small></span>
              </button>
            ))}
          </nav>

          <section className="prefs-panel">
            {tab === 'interface' && (
              <div className="settings-group">
                <h4>Display</h4>
                <Row label="Text size" hint="The whole interface grows with it — as far as the window has room for it.">
                  <Seg value={p.textScale} options={SCALES} onChange={(v) => set({ ...p, textScale: v })} />
                </Row>
                <Row check label="Colour-blind friendly colours" hint="Good and bad, won and lost, up and down in blue and orange instead of green and red.">
                  <input type="checkbox" checked={p.colourBlind} onChange={(e) => set({ ...p, colourBlind: e.target.checked })} />
                </Row>
                <Row check label="Less motion" hint="Stills the interface's animations.">
                  <input type="checkbox" checked={p.reducedMotion} onChange={(e) => set({ ...p, reducedMotion: e.target.checked })} />
                </Row>
                <Row label="Language" hint="The menus, the navigation, the buttons and the match controls. Messages, news and reports are still written in English.">
                  <span translate="no">
                    <Seg value={lang} options={LANGUAGES.map((l) => [l.id, l.name] as const)} onChange={(v) => { setLanguage(v); setLang(v); }} />
                  </span>
                </Row>
              </div>
            )}

            {tab === 'graphics' && (
              <>
                <div className="settings-group">
                  <h4>Quality</h4>
                  <Row label="Graphics quality" hint={quality === 'custom' ? 'Custom — the details below set by hand.' : 'A preset for the details below: lower runs smoother on a slower computer.'}>
                    <Seg<Quality | 'custom'> value={quality} options={QUALITIES} onChange={(v) => { if (v !== 'custom') set({ ...p, graphics: QUALITY[v] }); }} />
                  </Row>
                  <Row label="3D resolution" hint={`Pixels drawn for each pixel of the page — never more than the screen has (this one: ${Math.round(screenRatio * 100)}%).`}>
                    <Seg value={p.graphics.pixelRatio} options={RATIOS} onChange={(v) => setGraphics({ pixelRatio: v })} />
                  </Row>
                  <Row label="Shadows" hint="The players' shadows on the court: off, or softer to sharper.">
                    <Seg value={p.graphics.shadows} options={SHADOWS} onChange={(v) => setGraphics({ shadows: v })} />
                  </Row>
                  <Row check label="Anti-aliasing" hint="Smooths jagged edges — taken up the next time a 3D view opens.">
                    <input type="checkbox" checked={p.graphics.antialias} onChange={(e) => setGraphics({ antialias: e.target.checked })} />
                  </Row>
                </div>
                <div className="settings-group">
                  <h4>Frame rate</h4>
                  <Row label="Frame rate limit" hint="The most frames a second the 3D views draw — fewer is easier on a laptop's battery and fans.">
                    <Seg value={p.frameCap} options={CAPS} onChange={(v) => set({ ...p, frameCap: v })} />
                  </Row>
                  <Row check label="Show frame rate" hint="A counter of frames a second in the corner of the screen.">
                    <input type="checkbox" checked={p.showFps} onChange={(e) => set({ ...p, showFps: e.target.checked })} />
                  </Row>
                </div>
              </>
            )}

            {tab === 'match' && (
              <div className="settings-group">
                <h4>Watching matches</h4>
                <Row label="Match view" hint="How a live match opens: from the stand in 3D, or from above in 2D. It can be changed during the match.">
                  <Seg value={g.courtView} options={[['3d', '3D'], ['2d', '2D']] as const} onChange={(v) => g.setCourtView(v)} />
                </Row>
                <Row label="Camera" hint="Which camera the 3D view is watched through.">
                  <span className="prefs-dd">
                    <Dropdown<CameraMode>
                      value={g.courtCamera}
                      onChange={(v) => g.setCourtCamera(v)}
                      options={CAMERA_MODES.map((c) => ({ value: c.mode, label: `${c.name} — ${c.hint}` }))}
                    />
                  </span>
                </Row>
              </div>
            )}

            {tab === 'sound' && (
              <div className="settings-group">
                <h4>Sound</h4>
                <Row check label="Match sounds" hint="The referee's whistle, the ball off the hand, the crowd at a point, the hooter at a time-out.">
                  <input type="checkbox" checked={sound} onChange={(e) => { setSoundOn(e.target.checked); setSound(e.target.checked); }} />
                </Row>
                <Row label="Volume" hint={`${Math.round(volume * 100)}%`}>
                  <input className="prefs-range" type="range" min={0} max={100} step={5} value={Math.round(volume * 100)} disabled={!sound}
                    onChange={(e) => { const v = Number(e.target.value) / 100; setSoundVolume(v); setVolume(v); }} />
                </Row>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
