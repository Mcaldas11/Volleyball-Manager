/**
 * The page's own units under a bigger text size. The interface is drawn zoomed (preferences.ts sets
 * `zoom` on the page), and the browser then measures in screen pixels — getBoundingClientRect, the
 * window's size — while a menu's `left`/`top` are laid out in the page's own, zoomed again. Anything
 * placed by hand next to something else measures through here, or lands that much further out.
 */

/** How much the page is zoomed, as the browser actually draws it (1 where it measures unzoomed). */
export function layoutZoom(): number {
  const de = document.documentElement;
  const w = de.offsetWidth;
  if (w <= 0) return 1;
  const z = de.getBoundingClientRect().width / w;
  return z > 0.2 && z < 6 ? z : 1;
}

/** An element's box in the page's own units — what `position: fixed` with left/top expects. */
export function pageRect(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const z = layoutZoom();
  return z === 1 ? r : new DOMRect(r.left / z, r.top / z, r.width / z, r.height / z);
}

/** The window's size in the page's own units. */
export function pageSize(): { width: number; height: number } {
  const z = layoutZoom();
  return { width: window.innerWidth / z, height: window.innerHeight / z };
}
