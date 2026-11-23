/**
 * A match report in a window over the screen it was opened from — a
 * national team's from a tournament's results, its bracket or a nation's
 * page, any match from the calendar: box score and rotations, the rally log
 * too while it is in memory.
 */

import { useEffect, type JSX } from 'react';
import { MatchScreen } from './screens/Match.tsx';
import { useGame } from './state.ts';

export function MatchReportWindow(): JSX.Element | null {
  const g = useGame();
  const open = g.reportOverlay && g.reviewLast() !== null && g.matchday === null && g.postMatch === null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') g.closeMatchReport(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, g]);
  if (!open) return null;
  const watched = g.reviewLast()!;
  return (
    <div className="settings-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) g.closeMatchReport(); }}>
      <div className="intl-report-window" role="dialog" aria-label="Match report">
        <MatchScreen key={watched.fixture.id} onClose={() => g.closeMatchReport()} />
      </div>
    </div>
  );
}
