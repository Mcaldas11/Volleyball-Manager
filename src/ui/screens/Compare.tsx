/**
 * Two players side by side, FM style: who they are, what they cost, how
 * their season is going — and every attribute, the better of the two
 * marked, with a bar each way from the names down the middle.
 */

import type { JSX } from 'react';
import {
  ATTR_LABELS, HIDDEN_ATTR_SET, MENTAL_ATTRS, PHYSICAL_ATTRS, TECHNICAL_ATTRS, type AttributeName,
} from '../../engine/model/attributes.ts';
import { POSITION_NAMES, type Position } from '../../engine/model/positions.ts';
import { TRAIT_NAMES, traitsOf } from '../../engine/model/traits.ts';
import { averageRating, seasonTotals } from '../../engine/world/records.ts';
import { contractEndSeason } from '../../engine/world/world.ts';
import { Card, ClubLink, money, PlayerFace, Pos } from '../components.tsx';
import { Icon } from '../icons.tsx';
import { useGame } from '../state.ts';

export function PlayerCompare({ a, b }: { a: number; b: number }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const own = (p: number): boolean => store.clubId[p] === world.userClubId && world.userClubId >= 0;
  const age = (p: number): number => store.ageOn(p, world.year, 181);
  const season = (p: number): { apps: number; rating: number } => {
    const t = seasonTotals(world, p);
    return { apps: t.apps, rating: averageRating(t) };
  };
  const contract = (p: number): string => (store.clubId[p] < 0 ? 'Free agent' : `30 Jun ${world.startYear + contractEndSeason(store.contractUntil[p]) + 1}`);

  /** A row of two values: the better one marked — the higher, or for `lower` the lower. */
  const facts: Array<{ k: string; va: number; vb: number; show: (v: number, p: number) => string; lower?: boolean; none?: boolean }> = [
    { k: 'Age', va: age(a), vb: age(b), show: (v) => `${v}`, none: true },
    { k: 'Ability', va: store.currentAbility[a], vb: store.currentAbility[b], show: (v) => `${v}` },
    ...(own(a) && own(b) ? [{ k: 'Potential', va: store.potentialAbility[a], vb: store.potentialAbility[b], show: (v: number) => `${v}` }] : []),
    { k: 'Height', va: store.heightCm[a], vb: store.heightCm[b], show: (v) => `${v} cm` },
    { k: 'Spike reach', va: store.spikeReachCm[a], vb: store.spikeReachCm[b], show: (v) => `${v} cm` },
    { k: 'Block reach', va: store.blockReachCm[a], vb: store.blockReachCm[b], show: (v) => `${v} cm` },
    { k: 'Value', va: store.value[a], vb: store.value[b], show: (v) => money(v), none: true },
    { k: 'Wage', va: store.wage[a], vb: store.wage[b], show: (v) => money(v), lower: true },
    { k: 'Apps this season', va: season(a).apps, vb: season(b).apps, show: (v) => `${v}` },
    { k: 'Average rating', va: season(a).rating, vb: season(b).rating, show: (v) => (v > 0 ? v.toFixed(2) : '—') },
  ];

  const side = (p: number, right: boolean): JSX.Element => (
    <div className={`pc-who${right ? ' right' : ''}`}>
      <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={56} />
      <div className="pc-who-text">
        <span className="pc-name player-link" onClick={() => g.select(p)}>{store.fullName(p)}</span>
        <span className="pc-sub">
          <Pos pos={store.position[p] as Position} /> {POSITION_NAMES[store.position[p] as Position]}
          {store.clubId[p] >= 0 ? <> · <ClubLink id={store.clubId[p]} short /></> : ' · Free agent'}
        </span>
        <span className="pc-sub faint">{contract(p)}{traitsOf(store, p).length > 0 ? ` · ${traitsOf(store, p).map((t) => TRAIT_NAMES[t]).join(', ')}` : ''}</span>
      </div>
    </div>
  );

  const attrs = (list: readonly AttributeName[], title: string): JSX.Element => (
    <Card title={title} icon="stats" className="pc-card">
      {list.filter((x) => !HIDDEN_ATTR_SET.has(x)).map((x) => {
        const va = store.getAttr(a, x);
        const vb = store.getAttr(b, x);
        return (
          <div key={x} className="pc-row">
            <span className={`pc-val${va > vb ? ' better' : ''}`}>{va}</span>
            <span className="pc-bar left"><i style={{ width: `${va * 5}%` }} className={va > vb ? 'better' : ''} /></span>
            <span className="pc-label">{ATTR_LABELS[x]}</span>
            <span className="pc-bar"><i style={{ width: `${vb * 5}%` }} className={vb > va ? 'better' : ''} /></span>
            <span className={`pc-val${vb > va ? ' better' : ''}`}>{vb}</span>
          </div>
        );
      })}
    </Card>
  );

  return (
    <div className="pc">
      <div className="pc-head card">
        {side(a, false)}
        <span className="pc-vs">VS</span>
        {side(b, true)}
        <button className="icon-btn pc-close" title="Back to the profile" onClick={() => g.compareWith(null)}><Icon name="close" size={16} /></button>
      </div>
      <div className="pc-grid">
        <Card title="At a glance" icon="user" className="pc-card">
          {facts.map((f) => {
            const better = f.none === true || f.va === f.vb ? 0 : (f.lower === true ? f.va < f.vb : f.va > f.vb) ? -1 : 1;
            return (
              <div key={f.k} className="pc-row facts">
                <span className={`pc-val${better < 0 ? ' better' : ''}`}>{f.show(f.va, a)}</span>
                <span className="pc-label">{f.k}</span>
                <span className={`pc-val${better > 0 ? ' better' : ''}`}>{f.show(f.vb, b)}</span>
              </div>
            );
          })}
        </Card>
        {attrs(TECHNICAL_ATTRS, 'Technical')}
        {attrs(MENTAL_ATTRS, 'Mental')}
        {attrs(PHYSICAL_ATTRS, 'Physical')}
      </div>
    </div>
  );
}
