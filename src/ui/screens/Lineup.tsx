import type { JSX } from 'react';
import { abilityClass, Empty } from '../components.tsx';
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
    <div className="lineup-screen">
      <div className="lineup-header">
        <div>
          <h1>Starting Lineup</h1>
          <p className="subtitle">
            Your default team sheet — used automatically for every match, and still the starting
            point the next time you rearrange it there. Anyone injured or sold is swapped out
            for the next best fit until you pick a replacement.
          </p>
        </div>
        <div className="lineup-team-avg">
          <span className="faint">Team ability</span>
          <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
        </div>
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

      <div className="toolbar" style={{ marginTop: 20, justifyContent: 'center' }}>
        <button disabled={!hasPreference} onClick={() => g.resetPreferredLineup()}>
          Reset to auto-pick
        </button>
      </div>
    </div>
  );
}
