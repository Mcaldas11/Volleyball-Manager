/**
 * The team-sheet card UI: the six starting-zone cards, the libero's own card,
 * and the bench — shared by the pre-match Team Sheet screen and the Squad
 * screen's persistent starting-lineup editor, so both look and behave
 * identically and neither reimplements the drag-and-drop.
 */

import { useState, type JSX } from 'react';
import { Position, POSITION_SHORT } from '../engine/model/positions.ts';
import type { PlayerStore } from '../engine/model/players.ts';
import { LINEUP_SLOT_POSITIONS } from '../engine/season/seasonEngine.ts';
import { initials, POSITION_ACCENT, starRating } from './components.tsx';
import { playerFaceUrl } from './faces.ts';

export const ZONE_ORDER = [3, 2, 1, 4, 5, 0]; // front row first: 4,3,2 then back row 5,6,1
export const ZONE_LABELS = ['1', '2', '3', '4', '5', '6'];

/** The card's full-bleed photo, falling back to initials like PlayerFace does. */
export function CardPhoto({ playerId, name }: { playerId: number; name: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <div className="lineup-card-photo">
      {!failed
        ? <img src={playerFaceUrl(playerId)} alt={name} loading="lazy" onError={() => setFailed(true)} />
        : <span className="lineup-card-photo-fallback">{initials(name)}</span>}
    </div>
  );
}

/** The colour tint every card gets, radiating from the top in its role's colour. */
export function cardTint(pos: Position): string {
  return `linear-gradient(165deg, color-mix(in srgb, ${POSITION_ACCENT[pos]} 38%, transparent), transparent 60%)`;
}

/** One starting slot — a court zone or the libero: a full player card, a drop
 *  target, and (when there is anyone to swap in) a select as a non-drag
 *  alternative. */
export function LineupCard({
  label, playerIdx, store, swapOptions, isDragOver, draggable = true,
  onSelectChange, onDropPlayer, onDragOverZone, onDragLeaveZone,
}: {
  label: string;
  playerIdx: number;
  store: PlayerStore;
  swapOptions: number[];
  isDragOver: boolean;
  draggable?: boolean;
  onSelectChange: (playerIdx: number) => void;
  onDropPlayer: (draggedPlayerIdx: number) => void;
  onDragOverZone: () => void;
  onDragLeaveZone: () => void;
}): JSX.Element {
  const pos = store.position[playerIdx] as Position;
  const ca = store.currentAbility[playerIdx];
  return (
    <div
      className={`lineup-card${isDragOver ? ' drag-over' : ''}`}
      style={{ borderColor: POSITION_ACCENT[pos], backgroundImage: cardTint(pos) }}
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData('text/plain', String(playerIdx)) : undefined}
      onDragOver={(e) => { e.preventDefault(); onDragOverZone(); }}
      onDragLeave={onDragLeaveZone}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeaveZone();
        const dragged = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(dragged)) onDropPlayer(dragged);
      }}
    >
      <span className="lineup-card-shine" />
      <span className="lineup-card-pos" style={{ background: POSITION_ACCENT[pos] }}>
        {POSITION_SHORT[pos]}
      </span>
      <CardPhoto playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} />
      <div className="lineup-card-info">
        <div className="lineup-card-name">{store.shortName(playerIdx)}</div>
        <div className="lineup-card-meta">
          <span className="stars">{starRating(ca)}</span>
          <span className="lineup-card-ability">{ca}</span>
        </div>
      </div>
      {swapOptions.length > 0 && (
        <>
          <span className="lineup-card-swap-hint">⇅</span>
          <select
            className="lineup-card-select"
            value={playerIdx}
            title={`${label} — change`}
            onChange={(e) => onSelectChange(Number(e.target.value))}
          >
            <option value={playerIdx}>{store.shortName(playerIdx)} ({label})</option>
            {swapOptions.map((b) => (
              <option key={b} value={b}>
                {store.shortName(b)} ({POSITION_SHORT[store.position[b] as Position]})
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

/** A bench card, draggable onto any starting slot unless told otherwise. */
export function BenchCard({
  playerIdx, store, tag, draggable = true,
}: {
  playerIdx: number;
  store: PlayerStore;
  tag?: string;
  draggable?: boolean;
}): JSX.Element {
  const pos = store.position[playerIdx] as Position;
  return (
    <div
      className="lineup-card lineup-card-small"
      style={{ borderColor: POSITION_ACCENT[pos], backgroundImage: cardTint(pos) }}
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData('text/plain', String(playerIdx)) : undefined}
    >
      <span className="lineup-card-shine" />
      {tag !== undefined && <span className="lineup-card-tag">{tag}</span>}
      <span className="lineup-card-pos" style={{ background: POSITION_ACCENT[pos] }}>
        {POSITION_SHORT[pos]}
      </span>
      <CardPhoto playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} />
      <div className="lineup-card-info">
        <div className="lineup-card-name">{store.shortName(playerIdx)}</div>
        <div className="lineup-card-meta">
          <span className="lineup-card-ability">{store.currentAbility[playerIdx]}</span>
        </div>
      </div>
    </div>
  );
}

export interface TeamSheetProps {
  /** Six starting player indices, in zone order 0-5. */
  lineup: number[];
  libero: number;
  /** Everyone else available — neither in `lineup` nor the libero. */
  bench: number[];
  store: PlayerStore;
  onSetPlayer: (slot: number, playerIdx: number) => void;
  onSwapPlayers: (slotA: number, slotB: number) => void;
  onSetLibero: (playerIdx: number) => void;
  /** Only offer same-position bench players as a zone's swap-in options.
   *  The one-off pre-match sheet leaves this off — an emergency reshuffle is
   *  exactly when playing someone out of position can be worth it, and it
   *  only affects that single match. The persistent default lineup turns it
   *  on: a saved preference for a mismatched position is silently ignored by
   *  `pickLineup` anyway, so offering it here would just be a dead end. */
  restrictSwapsByPosition?: boolean;
}

/**
 * The formation grid, the libero's own card beside it, and the bench below.
 *
 * The libero gets a dedicated slot rather than sitting in the bench list: it
 * can never actually take one of the six rotation zones (it may not serve or
 * play front row), so grouping it with players who *can* be dragged into
 * any of those zones was always a little misleading. Its swap list is
 * likewise restricted to other libero-registered players on the bench.
 */
export function TeamSheet({
  lineup, libero, bench, store, onSetPlayer, onSwapPlayers, onSetLibero,
  restrictSwapsByPosition = false,
}: TeamSheetProps): JSX.Element {
  const [dragOverZone, setDragOverZone] = useState<number | null>(null);
  const [liberoDragOver, setLiberoDragOver] = useState(false);

  const dropOnZone = (targetZone: number, draggedPlayerIdx: number): void => {
    if (draggedPlayerIdx === lineup[targetZone]) return;
    if (restrictSwapsByPosition && store.position[draggedPlayerIdx] !== LINEUP_SLOT_POSITIONS[targetZone]) return;
    const sourceZone = lineup.indexOf(draggedPlayerIdx);
    if (sourceZone === -1) onSetPlayer(targetZone, draggedPlayerIdx);
    else if (sourceZone !== targetZone) onSwapPlayers(sourceZone, targetZone);
  };

  const renderZone = (z: number): JSX.Element | null => {
    const p = lineup[z];
    if (p === undefined || p < 0) return null;
    const swapOptions = restrictSwapsByPosition
      ? bench.filter((b) => store.position[b] === LINEUP_SLOT_POSITIONS[z])
      : bench;
    return (
      <LineupCard
        key={z}
        label={`Zone ${ZONE_LABELS[z]}`}
        playerIdx={p}
        store={store}
        swapOptions={swapOptions}
        isDragOver={dragOverZone === z}
        onSelectChange={(np) => onSetPlayer(z, np)}
        onDropPlayer={(dragged) => dropOnZone(z, dragged)}
        onDragOverZone={() => setDragOverZone(z)}
        onDragLeaveZone={() => setDragOverZone((cur) => (cur === z ? null : cur))}
      />
    );
  };

  const liberoOptions = bench.filter((p) => store.position[p] === Position.Libero);
  const frontZones = ZONE_ORDER.slice(0, 3);
  const backZones = ZONE_ORDER.slice(3);

  return (
    <>
      <div className="lineup-court-row">
        <div className="lineup-formation">
          <div className="lineup-row">{frontZones.map(renderZone)}</div>
          <div className="lineup-net" />
          <div className="lineup-row">{backZones.map(renderZone)}</div>
        </div>
        {libero >= 0 && (
          <div className="lineup-libero-slot">
            <div className="lineup-subheading" style={{ margin: '0 0 8px' }}>Libero</div>
            <LineupCard
              label="Libero"
              playerIdx={libero}
              store={store}
              swapOptions={liberoOptions}
              isDragOver={liberoDragOver}
              draggable={false}
              onSelectChange={onSetLibero}
              onDropPlayer={(dragged) => {
                if (store.position[dragged] === Position.Libero) onSetLibero(dragged);
              }}
              onDragOverZone={() => setLiberoDragOver(true)}
              onDragLeaveZone={() => setLiberoDragOver(false)}
            />
          </div>
        )}
      </div>

      <h3 className="lineup-subheading">Bench — drag onto a slot above to bring a player on</h3>
      <div className="lineup-bench">
        {bench.map((p) => <BenchCard key={p} playerIdx={p} store={store} />)}
        {bench.length === 0 && <p className="faint">No other players available.</p>}
      </div>
    </>
  );
}
