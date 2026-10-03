/**
 * Honours, the way FM lists them: a line per competition — how many times it
 * was won, and when — the biggest first.
 */

import type { JSX } from 'react';
import type { CompetitionKind, World } from '../engine/world/world.ts';
import { Empty } from './components.tsx';
import { Icon } from './icons.tsx';

/** One title won. */
export interface Honour {
  competitionId: number;
  name: string;
  kind: CompetitionKind;
  tier: number;
  key?: string;
  /** The year the season it was won in ended. */
  year: number;
  /** Whose it was, where titles from more than one club are shown together. */
  club?: string;
}

/** A title won, as the world's history records it, made an honour. */
export function honourOf(world: World, competitionId: number, year: number, club?: string): Honour | null {
  const comp = world.competitions[competitionId];
  if (comp === undefined) return null;
  return { competitionId, name: comp.name, kind: comp.kind, tier: comp.tier, key: comp.key, year, club };
}

/** How big a title is: the world first, then a continent's best, a top-flight league, the cups. */
export function prestige(h: Honour): number {
  if (h.kind === 'clubworld') return 6;
  if (h.kind === 'continental') return h.key === 'cont:CEV:2' ? 4 : 5;
  if (h.kind === 'league') return h.tier <= 1 ? 4.5 : 2.5;
  if (h.kind === 'cup') return 3;
  if (h.kind === 'supercup') return 2;
  return 1;
}

/** The titles by competition, each newest first, the biggest competitions first. */
export function groupHonours(honours: readonly Honour[]): Honour[][] {
  const groups = new Map<number, Honour[]>();
  for (const h of honours) {
    const list = groups.get(h.competitionId) ?? [];
    list.push(h);
    groups.set(h.competitionId, list);
  }
  return [...groups.values()]
    .map((list) => [...list].sort((a, b) => b.year - a.year))
    .sort((a, b) => prestige(b[0]) - prestige(a[0]) || b.length - a.length);
}

/** A line per competition won; `limit` keeps the biggest. */
export function HonourList({ honours, limit, empty = 'No major honours yet.' }: {
  honours: readonly Honour[];
  limit?: number;
  empty?: string;
}): JSX.Element {
  if (honours.length === 0) return <Empty>{empty}</Empty>;
  const groups = groupHonours(honours);
  const shown = limit !== undefined ? groups.slice(0, limit) : groups;
  return (
    <div className="hon-list">
      {shown.map((list) => {
        const first = list[0];
        const years = list.map((h) => (h.club !== undefined ? `${h.year} ${h.club}` : String(h.year))).join(' · ');
        return (
          <div key={first.competitionId} className={`hon-row${prestige(first) >= 5 ? ' top' : ''}`}>
            <Icon name="trophy" size={16} />
            <span className="hon-main">
              <strong title={first.name}>{first.name}</strong>
              <span className="hon-years" title={years}>{years}</span>
            </span>
            <b className="hon-count">{list.length}</b>
          </div>
        );
      })}
      {shown.length < groups.length && (
        <span className="hon-more">+{groups.length - shown.length} more competitions won</span>
      )}
    </div>
  );
}
