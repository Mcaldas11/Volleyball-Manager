import type { JSX } from 'react';
import { abilityClass, Empty, StarMeter } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { TeamSheet } from '../teamSheet.tsx';
import { useGame } from '../state.ts';

/**
 * The club's default starting lineup — set here, once, rather than only ever
 * improvised on the pre-match Team Sheet. `pickLineup` reads this first and
 * only auto-picks whichever slots it's missing (nobody named yet, or that
 * player has since left or gotten hurt), so whatever is arranged here is
 * what actually takes the court, match after match, until it's changed.
 */
export function LineupScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const picked = g.lineup();

  if (club.players.length === 0) return <Empty>No players under contract.</Empty>;
  if (picked === null) return <Empty>No players under contract.</Empty>;

  const { lineup, libero, bench } = picked;
  const teamAvg = lineup.length > 0
    ? Math.round(lineup.reduce((s, p) => s + store.currentAbility[p], 0) / lineup.length)
    : 0;
  const hasPreference = club.preferredLineup.some((p) => p >= 0) || club.preferredLibero >= 0;

  return (
    <div className="lineup-page">
      <div className="lineup-bar">
        <div className="lineup-bar-text">
          <strong>Default team sheet</strong>
          <span className="dim">
            Used automatically for every match, and the starting point whenever you rearrange it on
            match day. Anyone injured or sold is swapped for the next best fit until you pick a replacement.
          </span>
        </div>
        <div className="lineup-bar-rating">
          <span className="faint">Starting six</span>
          <StarMeter value={teamAvg} size={16} />
          <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
        </div>
        <button disabled={!hasPreference} onClick={() => g.resetPreferredLineup()}>
          <Icon name="swap" size={14} /> Reset to auto-pick
        </button>
      </div>

      <TeamSheet
        lineup={lineup}
        libero={libero}
        bench={bench}
        store={store}
        onSetPlayer={(slot, p) => g.setPreferredLineupSlot(slot, p)}
        onSwapPlayers={(a, b) => g.swapPreferredLineupSlots(a, b)}
        onSetLibero={(p) => g.setPreferredLibero(p)}
        restrictSwapsByPosition
      />
    </div>
  );
}
