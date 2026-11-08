/**
 * The phone's screen, laid out as a computer's.
 *
 * The game is drawn for a computer's window — at least 1000 px wide and about 470 tall. The page is
 * told it is that wide (the viewport), and the phone draws it smaller to fit its screen, every
 * coordinate in the game staying the same as on a computer. A tablet is told 1280 px at the least:
 * the computer's own layout. A phone also gets the compact layout (phone.css, html.phone).
 *
 * The app is held sideways only (AndroidManifest.xml), so the long side is always the width.
 */

const PHONE_HEIGHT = 470;
const PHONE_LEAST_WIDTH = 1000;
const TABLET_LEAST_WIDTH = 1280;
/** A screen shorter than this, in the phone's own pixels, is a phone's. */
const PHONE_BELOW = 560;

function fitViewport(): void {
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  if (long <= 0 || short <= 0) return;
  const phone = short < PHONE_BELOW;
  const width = phone
    ? Math.max(PHONE_LEAST_WIDTH, Math.round((long * PHONE_HEIGHT) / short))
    : Math.max(TABLET_LEAST_WIDTH, long);
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta === null) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  // Only the width: the app (MainActivity.java) draws a page that wide to fit its own width exactly.
  const content = `width=${width}, user-scalable=no`;
  if (meta.content !== content) meta.content = content;
  document.documentElement.classList.toggle('phone', phone);
}

/** `--app-h` (the height the game lays itself out to) kept to the page's height. */
function fitHeight(): void {
  const h = Math.max(360, Math.floor(window.innerHeight));
  document.documentElement.style.setProperty('--app-h', `${h}px`);
  document.documentElement.classList.toggle('short-window', h <= 820);
}

export function watchScreen(): void {
  fitViewport();
  fitHeight();
  window.addEventListener('resize', () => { fitViewport(); fitHeight(); });
  screen.orientation?.addEventListener?.('change', () => { fitViewport(); fitHeight(); });
}
