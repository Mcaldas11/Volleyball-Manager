/**
 * Lays the game out to what can actually be seen of the window.
 *
 * A browser reports its whole viewport as 100vh — but a window bigger than
 * the screen it is on (carried over from a bigger monitor, or left behind by
 * a change of resolution or scaling), or one reaching down under the
 * taskbar, shows less than that, and the bottom of every screen — the end of
 * the sidebar, a message's buttons — would be out of sight. `--app-h` is the
 * height that can be seen, kept up to date as the window moves and resizes;
 * the stylesheet lays everything out to it.
 */

/** The window's visible height, CSS px. */
export function visibleHeight(): number {
  const de = document.documentElement;
  let h = Math.min(
    window.innerHeight,
    de.clientHeight > 0 ? de.clientHeight : Infinity,
    window.visualViewport?.height ?? Infinity,
  );
  // How much of the window hangs below the screen's usable bottom — the
  // taskbar, or the edge of the screen itself.
  const s = window.screen as Screen & { availTop?: number };
  const fullscreen = window.screenY <= 0 && Math.abs(window.outerHeight - s.height) <= 2;
  if (!fullscreen && s.availHeight > 0 && window.outerHeight >= window.innerHeight * 0.5 && window.innerWidth > 0) {
    // Screen coordinates are in device-independent pixels; the page's, zoomed.
    const zoom = Math.max(0.25, Math.min(5, window.outerWidth / window.innerWidth));
    const below = window.screenY + window.outerHeight - ((s.availTop ?? 0) + s.availHeight);
    // A maximised window's frame hangs a few pixels off every edge — that hides nothing.
    if (below > 12) h -= below / zoom;
  }
  return Math.max(360, Math.floor(h));
}

/** Keep `--app-h` on the document to the visible height, from now on. */
export function watchWindowFit(): void {
  let last = -1;
  const fit = (): void => {
    const h = visibleHeight();
    if (h === last) return;
    last = h;
    document.documentElement.style.setProperty('--app-h', `${h}px`);
    // A short window: the sidebar trades its group titles for rules (styles.css).
    document.documentElement.classList.toggle('short-window', h <= 820);
  };
  fit();
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  // Moving a window to another screen, or the taskbar coming and going, fires no resize.
  window.setInterval(fit, 1500);
}
