/**
 * The frame-rate counter in the corner, when asked for in the preferences: the 3D view's frames a
 * second while one is drawing — the page's own otherwise — green at a smooth rate, amber at a
 * playable one, red below it.
 */

import { useEffect, useState, type JSX } from 'react';
import { viewFrameRate } from './frames.ts';

export function FpsCounter(): JSX.Element {
  const [shown, setShown] = useState<{ fps: number; view: boolean } | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const ticks: number[] = [];
    const tick = (now: number): void => {
      ticks.push(now);
      while (ticks.length > 0 && ticks[0] < now - 1000) ticks.shift();
      // A few times a second is enough to read.
      if (now - last > 300) {
        last = now;
        const view = viewFrameRate(now);
        setShown({ fps: view ?? ticks.length, view: view !== null });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const fps = shown?.fps ?? 0;
  const band = fps >= 50 ? 'good' : fps >= 28 ? 'ok' : 'low';
  return (
    <div className={`fps-counter ${band}`} aria-hidden title={shown?.view === true ? 'Frames a second drawn by the 3D view' : 'Frames a second drawn by the page'}>
      <b>{shown === null ? '–' : fps}</b> FPS{shown?.view === true && <small>3D</small>}
    </div>
  );
}
