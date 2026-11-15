/**
 * Full screen: a button for the main menu, the top bar and the preferences, and F11 anywhere.
 * The page's own full-screen request fills the desktop window as well as a browser's, so the
 * button and the key always agree on which state the game is in.
 */

import { useEffect, useState, type JSX } from 'react';
import { Icon } from './icons.tsx';

function isFull(): boolean {
  return document.fullscreenElement !== null;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFull()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* refused (no user gesture, or not allowed here): nothing to do */ }
}

/** F11 toggles full screen; installed once, by the app. */
export function useFullscreenKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F11') return;
      e.preventDefault();
      void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useIsFull(): boolean {
  const [full, setFull] = useState(isFull);
  useEffect(() => {
    const sync = (): void => setFull(isFull());
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return full;
}

/** The toggle: an icon alone in the top bar (`compact`), with its words elsewhere. */
export function FullscreenButton({ compact = false, className }: { compact?: boolean; className?: string }): JSX.Element | null {
  const full = useIsFull();
  if (!document.fullscreenEnabled) return null;
  const label = full ? 'Exit full screen' : 'Full screen';
  return (
    <button type="button" className={className ?? (compact ? 'vm-tool' : 'sm')} title={`${label} (F11)`} aria-label={label}
      aria-pressed={full} onClick={() => void toggleFullscreen()}>
      <Icon name="fullscreen" size={compact ? 18 : 14} />
      {!compact && <span>{label}</span>}
    </button>
  );
}
