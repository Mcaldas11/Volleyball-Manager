/**
 * Back and forward the way a browser does them, through the game's own history
 * (state.ts `back` / `forward`): the browser's Back button, a mouse's side
 * buttons, and Alt+← / Alt+→. In the web build the browser's Back no longer
 * leaves the game: the page keeps one entry of its own in the history and
 * puts it back each time Back is pressed. On the main menu, with no career
 * open, Back is left to the browser.
 */

import { useEffect } from 'react';
import type { useGame } from './state.ts';

type Game = ReturnType<typeof useGame>;

/** In a match, an interview or the aftermath of one, the screens stay put — as the bar's arrows do. */
function locked(g: Game): boolean {
  return g.world === null || g.matchday !== null || g.activeInterviewId !== null || g.postMatch !== null;
}

function goBack(g: Game): void {
  if (!locked(g) && g.canGoBack()) g.back();
}
function goForward(g: Game): void {
  if (!locked(g) && g.canGoForward()) g.forward();
}

const MARK = { vmNav: true };

export function useBackNavigation(g: Game): void {
  useEffect(() => {
    // One entry of the page's own, so Back lands here instead of leaving.
    const arm = (): void => {
      try { if ((history.state as { vmNav?: boolean } | null)?.vmNav !== true) history.pushState(MARK, ''); } catch { /* sandboxed */ }
    };
    arm();
    // A side button the browser acts on too must not take the game back twice.
    let handledAt = -Infinity;
    const onPop = (): void => {
      if (g.world === null) return; // the menu: let the browser have it next time
      if (performance.now() - handledAt > 400) goBack(g);
      arm();
    };
    const onMouse = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type !== 'mouseup') return;
      handledAt = performance.now();
      if (e.button === 3) goBack(g); else goForward(g);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(g); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goForward(g); }
    };
    window.addEventListener('popstate', onPop);
    // Down as well as up: a side button's default (the browser's own back) acts on the press.
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('mouseup', onMouse);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('mouseup', onMouse);
      window.removeEventListener('keydown', onKey);
    };
  }, [g]);
}
