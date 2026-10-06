// Throwaway visual harness: one rally ending in a given shot. Deleted after the check.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MatchFormat, MatchSimulator } from '../engine/match/engine.ts';
import { toTeamSetup } from '../engine/season/seasonEngine.ts';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import { kitsFor, LiveCourt } from './LiveCourt.tsx';
import { rallyBeats, setupScene, type Scene } from './matchCourt.ts';
import { playBeats, type BigPlay } from './rallyPlayer.ts';
import { BigPlayCallout } from './screens/Matchday.tsx';
import './styles.css';

const q = new URLSearchParams(location.search);
const want = q.get('shot') ?? 'cut';
const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
const rallies: Array<{ pre: ReturnType<MatchSimulator['snapshot']>; e: NonNullable<ReturnType<MatchSimulator['step']>> }> = [];
for (const seed of [3, 4, 5, 6, 7, 8]) {
  const sim = new MatchSimulator(world.players, {
    home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b), format: MatchFormat.BestOf5,
    importance: 0.5, neutralVenue: false, collectLog: true, seed,
  });
  for (let i = 0; i < 400; i++) {
    const pre = sim.snapshot();
    const e = sim.step();
    if (e === null) break;
    rallies.push({ pre, e: { ...e, contacts: [...e.contacts] } });
  }
}
// The near side (home) makes the shot.
const pick = rallies.find((r) => {
  const cs = r.e.contacts;
  if (want === 'recycle') return cs.some((c) => c.shot === 'recycle' && c.team === 0) && cs.length <= 9;
  if (want.startsWith('dug-')) {
    const s = want.slice(4);
    return cs.some((c, k) => c.kind === 'attack' && c.shot === s && c.team === 0 && cs[k + 1]?.kind === 'dig') && cs.length <= 7;
  }
  const last = cs[cs.length - 1];
  return last?.kind === 'kill' && last.shot === want && last.team === 0 && cs.length <= 5;
})!;
console.log('shots', pick.e.contacts.map((c) => `${c.kind}:${c.shot ?? ''}`).join(' '));
const roles = world.players.position;
const home = new Set([...pick.pre.homeCourt, pick.pre.homeLibero]);
const kits = kitsFor(30, 210);

function Harness(): JSX.Element {
  const [scene, setScene] = useState<Scene>(() => setupScene(pick.pre, pick.e.serveTeam, roles, 0));
  const [play, setPlay] = useState<(BigPlay & { key: number }) | null>(null);
  (window as unknown as { go: () => void }).go = () => {
    const beats = rallyBeats(pick.pre, pick.e.serveTeam, pick.e.contacts, roles, 1, 0, pick.e.winner);
    void playBeats(beats, 1, { current: false }, setScene, (p) => setPlay({ ...p, key: Date.now() }));
  };
  return (
    <div style={{ position: 'relative', display: 'flex', flex: 1 }}>
      <LiveCourt scene={scene} store={world.players} roles={roles} kits={kits} teamOf={(p) => (home.has(p) ? 0 : 1)}
        ratings={new Map()} labels="off" />
      {play !== null && <BigPlayCallout key={play.key} play={play} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
