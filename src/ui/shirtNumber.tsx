/**
 * A player's shirt number, as a badge — and, for one of the manager's own, the way to change it: a
 * grid of every number from 1 to 99, those his team-mates wear marked with their names. Picking one
 * a team-mate wears swaps the two over.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { MAX_NUMBER, MIN_NUMBER } from '../engine/world/squadNumbers.ts';
import { useDismiss } from './components.tsx';
import { useGame } from './state.ts';

export function ShirtNumber({ p, editable = false, size = 'sm' }: { p: number; editable?: boolean; size?: 'sm' | 'lg' }): JSX.Element | null {
  const g = useGame();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const n = g.shirtNumber(p);
  if (n === null) return null;
  const badge = <span className={`shirt-no ${size}`}>{n}</span>;
  if (!editable) return badge;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`shirt-no-btn${open ? ' open' : ''}`}
        title="Change his shirt number"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        {badge}
      </button>
      {open && <NumberGrid p={p} anchor={trigger.current} close={() => setOpen(false)} />}
    </>
  );
}

function NumberGrid({ p, anchor, close }: { p: number; anchor: HTMLElement | null; close: () => void }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const ref = useDismiss(true, close);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  const wearers = g.squadNumbers();
  const byNumber = new Map([...wearers].map(([q, n]) => [n, q]));
  const mine = wearers.get(p);

  // Below the badge, or above it when there is no room; never off the side of the window.
  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    const el = ref.current;
    if (r === undefined || el === null) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const top = r.bottom + 6 + h < window.innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
    setPlace({ top, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) });
  }, [anchor]);

  const pick = (n: number): void => {
    g.setShirtNumber(p, n);
    close();
  };
  return createPortal(
    <div ref={ref} className="shirt-grid" style={place} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Shirt number">
      <div className="shirt-grid-head">
        <b>{store.fullName(p)}</b>
        <span className="faint">A number a team-mate wears swaps the two over.</span>
      </div>
      <div className="shirt-grid-cells">
        {Array.from({ length: MAX_NUMBER - MIN_NUMBER + 1 }, (_, i) => i + MIN_NUMBER).map((n) => {
          const q = byNumber.get(n);
          const taken = q !== undefined && q !== p;
          return (
            <button
              key={n}
              type="button"
              className={`shirt-cell${n === mine ? ' mine' : ''}${taken ? ' taken' : ''}`}
              title={n === mine ? 'His number' : taken ? `${store.fullName(q)} wears it — swap` : 'Free'}
              onClick={() => pick(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
