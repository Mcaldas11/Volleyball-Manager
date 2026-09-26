/**
 * The team-sheet UI: the six starting zones laid out on a court, the libero's
 * own slot beside it, and the bench as a list alongside — shared by the
 * pre-match Team Selection screen and the Tactics › Team Sheet editor, so
 * both look and behave identically and neither reimplements the drag-and-drop.
 */

import { useState, type CSSProperties, type JSX } from 'react';
import { Position, POSITION_SHORT } from '../engine/model/positions.ts';
import type { PlayerStore } from '../engine/model/players.ts';
import { LINEUP_SLOT_POSITIONS } from '../engine/season/seasonEngine.ts';
import { Bar, initials, PlayerFace, Pos, POSITION_ACCENT, starRating } from './components.tsx';
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
  return `linear-gradient(170deg, color-mix(in srgb, ${POSITION_ACCENT[pos]} 34%, transparent), transparent 58%)`;
}

/** A thin condition strip along a card's foot — full and green when fresh. */
function ConditionStrip({ value }: { value: number }): JSX.Element {
  const colour = value > 66 ? 'var(--good)' : value > 33 ? 'var(--warn)' : 'var(--bad)';
  return (
    <span className="lineup-card-cond" title={`Condition ${value}%`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: colour }} />
    </span>
  );
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
      <span className="lineup-card-zone">{label}</span>
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
      <ConditionStrip value={store.condition[playerIdx]} />
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

/** A bench row, draggable onto any starting slot unless told otherwise. */
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
      className={`bench-token${draggable ? ' draggable' : ''}`}
      style={{ '--token-accent': POSITION_ACCENT[pos] } as CSSProperties}
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData('text/plain', String(playerIdx)) : undefined}
    >
      {draggable && <span className="bench-token-grip" aria-hidden="true">⋮⋮</span>}
      <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={30} />
      <span className="bench-token-name">
        {store.shortName(playerIdx)}
        {tag !== undefined && <span className="bench-token-tag">{tag}</span>}
      </span>
      <Pos pos={pos} />
      <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
      <Bar value={store.condition[playerIdx]} />
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
 * The court with the six starting zones, the libero's own slot beside it,
 * and the bench list alongside.
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
    if (p === undefined || p < 0) {
      return (
        <div
          key={z}
          className={`lineup-card-empty${dragOverZone === z ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOverZone(z); }}
          onDragLeave={() => setDragOverZone((cur) => (cur === z ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverZone(null);
            const dragged = Number(e.dataTransfer.getData('text/plain'));
            if (!Number.isNaN(dragged)) dropOnZone(z, dragged);
          }}
        >
          Zone {ZONE_LABELS[z]}
        </div>
      );
    }
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
    <div className="ts">
      <div className="ts-main">
        <div className="ts-court">
          <div className="ts-net"><span>Net</span></div>
          <div className="ts-row-label">Front row</div>
          <div className="ts-row">{frontZones.map(renderZone)}</div>
          <div className="ts-attack-line"><span>3 m</span></div>
          <div className="ts-row-label">Back row</div>
          <div className="ts-row">{backZones.map(renderZone)}</div>
        </div>
        {libero >= 0 && (
          <div className="ts-libero">
            <span className="ts-libero-label">Libero</span>
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
            <span className="ts-libero-note">Replaces the back-row middle</span>
          </div>
        )}
      </div>

      <section className="card ts-bench">
        <header className="card-head">
          <h3 className="card-title">Substitutes</h3>
          <span className="card-actions faint">{bench.length}</span>
        </header>
        <p className="ts-bench-hint">Drag a player onto a court slot to bring them in, or use ⇅ on a card.</p>
        <div className="ts-bench-list">
          {bench.map((p) => <BenchCard key={p} playerIdx={p} store={store} />)}
          {bench.length === 0 && <p className="empty">No other players available.</p>}
        </div>
      </section>
    </div>
  );
}
