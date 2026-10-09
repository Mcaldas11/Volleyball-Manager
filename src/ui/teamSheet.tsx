/**
 * The team-sheet UI: the six starting zones laid out on a court, the libero's
 * own slot beside it, and the bench as a list alongside — shared by the
 * pre-match Team Selection screen and the Tactics › Team Sheet editor, so
 * both look and behave identically and neither reimplements the drag-and-drop.
 */

import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { familiarityLabel, MATCHDAY_SQUAD, Position, POSITION_SHORT } from '../engine/model/positions.ts';
import type { PlayerStore } from '../engine/model/players.ts';
import { registeredLiberos } from '../engine/match/engine.ts';
import { LINEUP_SLOT_POSITIONS } from '../engine/season/seasonEngine.ts';
import { Bar, initials, PlayerFace, Pos, POSITION_ACCENT, starRating } from './components.tsx';
import { playerFaceUrl } from './faces.ts';
import { Dropdown } from './dropdown.tsx';

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
  label, playerIdx, store, swapOptions, isDragOver, draggable = true, role,
  onSelectChange, onDropPlayer, onDragOverZone, onDragLeaveZone,
}: {
  label: string;
  playerIdx: number;
  store: PlayerStore;
  /** The position the slot plays — his own, or another he is put in. */
  role?: Position;
  swapOptions: number[];
  isDragOver: boolean;
  draggable?: boolean;
  onSelectChange: (playerIdx: number) => void;
  onDropPlayer: (draggedPlayerIdx: number) => void;
  onDragOverZone: () => void;
  onDragLeaveZone: () => void;
}): JSX.Element {
  const natural = store.position[playerIdx] as Position;
  const pos = role ?? natural;
  const ca = store.currentAbility[playerIdx];
  const fam = familiarityLabel(store.familiarityWith(playerIdx, pos), pos === natural);
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
      {pos !== natural && (
        <span className={`lineup-card-oop ${fam.cls}`} title={`A natural ${POSITION_SHORT[natural]} playing ${POSITION_SHORT[pos]}: ${fam.label.toLowerCase()} there`}>
          {POSITION_SHORT[natural]} · {fam.label}
        </span>
      )}
      <ConditionStrip value={store.condition[playerIdx]} />
      {swapOptions.length > 0 && (
        <>
          <span className="lineup-card-swap-hint">⇅</span>
          <Dropdown
            size="sm"
            className="lineup-card-select"
            value={playerIdx}
            title={`${label} — change`}
            menuWidth={190}
            searchable={false}
            onChange={(v) => { if (v !== playerIdx) onSelectChange(v); }}
            options={[
              { value: playerIdx, label: store.shortName(playerIdx), hint: label },
              ...swapOptions.map((b) => ({
                value: b, label: store.shortName(b), hint: POSITION_SHORT[store.position[b] as Position],
              })),
            ]}
          />
        </>
      )}
    </div>
  );
}

/** A bench row, draggable onto any starting slot unless told otherwise. */
export function BenchCard({
  playerIdx, store, tag, tagTitle, onTag, draggable = true, action, out = false,
}: {
  playerIdx: number;
  store: PlayerStore;
  tag?: string;
  tagTitle?: string;
  /** The tag is a switch: a reserve libero between the spare libero and the six. */
  onTag?: () => void;
  draggable?: boolean;
  /** A button at the end of the row — into the squad, or out of it. */
  action?: ReactNode;
  /** Not in the matchday squad: shown faded. */
  out?: boolean;
}): JSX.Element {
  const pos = store.position[playerIdx] as Position;
  return (
    <div
      className={`bench-token${draggable ? ' draggable' : ''}${action !== undefined ? ' with-action' : ''}${out ? ' out' : ''}`}
      style={{ '--token-accent': POSITION_ACCENT[pos] } as CSSProperties}
      draggable={draggable}
      onDragStart={draggable ? (e) => e.dataTransfer.setData('text/plain', String(playerIdx)) : undefined}
    >
      {draggable && <span className="bench-token-grip" aria-hidden="true">⋮⋮</span>}
      <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={30} />
      <span className={`bench-token-name${tag !== undefined ? ' has-tag' : ''}`}>
        <span className="bench-token-text">{store.shortName(playerIdx)}</span>
        {tag !== undefined && (onTag !== undefined
          ? <button className="bench-token-tag switch" title={tagTitle} onClick={onTag}>{tag} <span aria-hidden="true">⇄</span></button>
          : <span className="bench-token-tag" title={tagTitle}>{tag}</span>)}
      </span>
      <Pos pos={pos} />
      <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
      <Bar value={store.condition[playerIdx]} />
      {action}
    </div>
  );
}

export interface TeamSheetProps {
  /** Six starting player indices, in zone order 0-5. */
  lineup: number[];
  /** The reception libero — or the only libero when no defensive one is named. */
  libero: number;
  /** The second libero, on court whenever the team serves; -1 for none. */
  defensiveLibero: number;
  /** Everyone else available — neither in `lineup` nor either libero role. */
  bench: number[];
  store: PlayerStore;
  onSetPlayer: (slot: number, playerIdx: number) => void;
  onSwapPlayers: (slotA: number, slotB: number) => void;
  onSetLibero: (playerIdx: number) => void;
  /** Name a defensive libero, or -1 to go back to one libero throughout. */
  onSetDefensiveLibero: (playerIdx: number) => void;
  /** Only offer same-position bench players as a zone's swap-in options.
   *  The one-off pre-match sheet leaves this off — an emergency reshuffle is
   *  exactly when playing someone out of position can be worth it, and it
   *  only affects that single match. The persistent default lineup turns it
   *  on: a saved preference for a mismatched position is silently ignored by
   *  `pickLineup` anyway, so offering it here would just be a dead end. */
  restrictSwapsByPosition?: boolean;
  /** Each slot's position for the team's system — the 5-1 unless told otherwise. */
  slotPositions?: readonly Position[];
  /** Fit players left out of the matchday squad — given with the two below,
   *  the fourteen can be picked here. */
  outOfSquad?: number[];
  onAddToSquad?: (playerIdx: number) => void;
  onDropFromSquad?: (playerIdx: number) => void;
  /** The liberos named for the match, once it is under way: only they may take
   *  the libero slots, and none of them a zone. Absent: worked out as picked. */
  registered?: number[];
  /** Before kickoff, reserve liberos down to play in the six rather than as the spare libero. */
  outfieldLiberos?: number[];
  /** Before kickoff: switch a reserve libero between the spare libero and the six. */
  onToggleReserveLibero?: (playerIdx: number) => void;
}

/**
 * The court with the six starting zones, the libero slots beside it, and the
 * bench list alongside.
 *
 * The liberos get dedicated slots rather than sitting in the bench list: a
 * libero can never take one of the six rotation zones (it may not serve or
 * play front row), so grouping it with players who *can* be dragged into
 * any of those zones would be misleading. There are two slots, as a real team
 * sheet allows: the reception libero passes serve, and an optional defensive
 * libero replaces them whenever the team is serving. Both swap lists are
 * restricted to libero-registered players.
 */
export function TeamSheet({
  lineup, libero, defensiveLibero, bench, store, onSetPlayer, onSwapPlayers, onSetLibero,
  onSetDefensiveLibero, restrictSwapsByPosition = false, slotPositions = LINEUP_SLOT_POSITIONS,
  outOfSquad, onAddToSquad, onDropFromSquad, registered, outfieldLiberos, onToggleReserveLibero,
}: TeamSheetProps): JSX.Element {
  const [dragOverZone, setDragOverZone] = useState<number | null>(null);
  const [liberoDragOver, setLiberoDragOver] = useState<'reception' | 'defence' | null>(null);
  // Once the match is on, the liberos named for it are fixed: they play libero and nothing else.
  const fixed = new Set(registered ?? []);
  const namedLiberos = registered ?? registeredLiberos(store, { libero, defensiveLibero, bench, outfield: outfieldLiberos });

  const dropOnZone = (targetZone: number, draggedPlayerIdx: number): void => {
    if (draggedPlayerIdx === lineup[targetZone] || fixed.has(draggedPlayerIdx)) return;
    if (restrictSwapsByPosition && store.position[draggedPlayerIdx] !== slotPositions[targetZone]) return;
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
      ? bench.filter((b) => store.position[b] === slotPositions[z])
      : bench.filter((b) => !fixed.has(b));
    return (
      <LineupCard
        key={z}
        label={`Zone ${ZONE_LABELS[z]}`}
        playerIdx={p}
        role={slotPositions[z]}
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

  const benchLiberos = registered !== undefined
    ? bench.filter((b) => fixed.has(b))
    : [...bench].sort((a, b) =>
      Number(store.position[b] === Position.Libero) - Number(store.position[a] === Position.Libero));
  const isLibero = (p: number): boolean => p >= 0 && (registered === undefined || fixed.has(p));
  const starters = lineup.filter((p) => p >= 0).length;
  const inSquad = starters + (libero >= 0 ? 1 : 0) + (defensiveLibero >= 0 ? 1 : 0) + bench.length;
  const full = inSquad >= MATCHDAY_SQUAD;
  /** What a reserve is down as, when it isn't obvious: the spare libero, or a libero playing in the six — and, before kickoff, the switch between the two. */
  const benchTag = (p: number): { tag?: string; tagTitle?: string; onTag?: () => void } => {
    const canSwitch = registered === undefined && onToggleReserveLibero !== undefined;
    const toggle = canSwitch ? () => onToggleReserveLibero(p) : undefined;
    if (namedLiberos.includes(p)) {
      return {
        tag: 'Spare',
        tagTitle: `Named as the second libero for the match: plays libero, and nothing else${canSwitch ? ' — click to play him in the six instead' : ''}`,
        onTag: toggle,
      };
    }
    if (store.position[p] === Position.Libero) {
      const chosen = (outfieldLiberos ?? []).includes(p);
      return {
        tag: 'Outfield',
        tagTitle: chosen
          ? `Down to play in the six: an outfield player, who can never take a libero's place${canSwitch ? ' — click to name him the spare libero' : ''}`
          : `Only ${namedLiberos.length} liberos can be named — he is down to play in the six`,
        onTag: chosen ? toggle : undefined,
      };
    }
    return {};
  };
  const frontZones = ZONE_ORDER.slice(0, 3);
  const backZones = ZONE_ORDER.slice(3);
  const liberoDrop = (role: 'reception' | 'defence') => ({
    isDragOver: liberoDragOver === role,
    onDragOverZone: () => setLiberoDragOver(role),
    onDragLeaveZone: () => setLiberoDragOver((cur) => (cur === role ? null : cur)),
    onDropPlayer: (dragged: number) => {
      if (!isLibero(dragged)) return;
      if (role === 'reception') onSetLibero(dragged);
      else onSetDefensiveLibero(dragged);
    },
  });

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
          <div className="ts-liberos">
            <div className="ts-libero">
              <span className="ts-libero-label">{defensiveLibero >= 0 ? 'Reception libero' : 'Libero'}</span>
              <LineupCard
                label="Reception"
                playerIdx={libero}
                role={Position.Libero}
                store={store}
                swapOptions={defensiveLibero >= 0 ? [...benchLiberos, defensiveLibero] : benchLiberos}
                draggable={false}
                onSelectChange={onSetLibero}
                {...liberoDrop('reception')}
              />
              <span className="ts-libero-note">
                {defensiveLibero >= 0 ? 'On court while you receive serve' : 'Replaces the back-row middle'}
              </span>
            </div>

            <div className="ts-libero ts-libero-defence">
              <span className="ts-libero-label">Defensive libero</span>
              {defensiveLibero >= 0 ? (
                <>
                  <LineupCard
                    label="Defence"
                    playerIdx={defensiveLibero}
                    role={Position.Libero}
                    store={store}
                    swapOptions={[...benchLiberos, libero]}
                    draggable={false}
                    onSelectChange={onSetDefensiveLibero}
                    {...liberoDrop('defence')}
                  />
                  <button className="sm ghost" onClick={() => onSetDefensiveLibero(-1)}>Remove</button>
                </>
              ) : (
                <div
                  className={`lineup-card-empty ts-libero-empty${liberoDragOver === 'defence' ? ' drag-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setLiberoDragOver('defence'); }}
                  onDragLeave={() => setLiberoDragOver((cur) => (cur === 'defence' ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setLiberoDragOver(null);
                    const dragged = Number(e.dataTransfer.getData('text/plain'));
                    if (!Number.isNaN(dragged) && isLibero(dragged)) onSetDefensiveLibero(dragged);
                  }}
                >
                  <span className="ts-libero-plus">+</span>
                  {benchLiberos.length > 0 ? (
                    <Dropdown<number>
                      size="sm"
                      value={null}
                      placeholder="Add libero"
                      menuWidth={170}
                      onChange={(v) => onSetDefensiveLibero(v)}
                      options={benchLiberos.map((p) => ({ value: p, label: store.shortName(p) }))}
                    />
                  ) : (
                    <span className="ts-libero-none">No second libero available</span>
                  )}
                </div>
              )}
              <span className="ts-libero-note">
                {defensiveLibero >= 0 ? 'On court while you serve' : 'Optional — digs while you serve'}
              </span>
            </div>
          </div>
        )}
      </div>

      <section className="card ts-bench">
        <header className="card-head">
          <h3 className="card-title">Substitutes</h3>
          <span className={`card-actions${outOfSquad !== undefined && full ? '' : ' faint'}`}>
            {outOfSquad !== undefined ? `Squad ${inSquad}/${MATCHDAY_SQUAD}` : bench.length}
          </span>
        </header>
        <p className="ts-bench-hint">
          {outOfSquad !== undefined
            ? `${MATCHDAY_SQUAD} can be named, two of them liberos. Drag a player onto a court slot, or use ⇅ on a card.`
            : 'Drag a player onto a court slot to bring them in, or use ⇅ on a card.'}
        </p>
        <div className="ts-bench-list">
          {bench.map((p) => (
            <BenchCard
              key={p}
              playerIdx={p}
              store={store}
              draggable={!fixed.has(p)}
              {...benchTag(p)}
              action={onDropFromSquad !== undefined ? (
                <button className="ts-squad-btn" title="Leave out of the squad" onClick={() => onDropFromSquad(p)}>−</button>
              ) : undefined}
            />
          ))}
          {bench.length === 0 && <p className="empty">No other players available.</p>}
          {outOfSquad !== undefined && outOfSquad.length > 0 && (
            <>
              <div className="ts-out-label">Not in the squad <span>{outOfSquad.length}</span></div>
              {outOfSquad.map((p) => (
                <BenchCard
                  key={p}
                  playerIdx={p}
                  store={store}
                  out
                  action={onAddToSquad !== undefined ? (
                    <button
                      className="ts-squad-btn add"
                      disabled={full}
                      title={full ? `The squad is full — leave someone out first` : 'Name in the squad'}
                      onClick={() => onAddToSquad(p)}
                    >+</button>
                  ) : undefined}
                />
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
