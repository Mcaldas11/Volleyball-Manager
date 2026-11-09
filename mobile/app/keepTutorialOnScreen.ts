/**
 * The tutorial's card, kept on the screen.
 *
 * The game places the card by the size it had when it was last measured; a card that grows after that
 * (a longer step on the match screen) can end up partly below the screen's edge, its buttons out of
 * reach — and a phone has no room to spare. While a card is up, it is nudged back in (with `translate`,
 * which leaves the game's own placement and animation alone).
 */

const MARGIN = 12;

export function keepTutorialOnScreen(): void {
  let card: HTMLElement | null = null;
  let shift = { x: 0, y: 0 };

  const tick = (): void => {
    const now = document.querySelector<HTMLElement>('.tut-card');
    if (now !== card) {
      card = now;
      shift = { x: 0, y: 0 };
    }
    if (card !== null) {
      const r = card.getBoundingClientRect();
      // Where it would be without the nudge.
      const left = r.left - shift.x;
      const right = r.right - shift.x;
      const top = r.top - shift.y;
      const bottom = r.bottom - shift.y;
      let x = 0;
      let y = 0;
      if (bottom > innerHeight - MARGIN) y = innerHeight - MARGIN - bottom;
      if (top + y < MARGIN) y = MARGIN - top;
      if (right > innerWidth - MARGIN) x = innerWidth - MARGIN - right;
      if (left + x < MARGIN) x = MARGIN - left;
      x = Math.round(x);
      y = Math.round(y);
      if (x !== shift.x || y !== shift.y) {
        shift = { x, y };
        card.style.translate = x === 0 && y === 0 ? '' : `${x}px ${y}px`;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
