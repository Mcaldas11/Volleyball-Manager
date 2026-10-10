import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Position, POSITION_SHORT } from '../../engine/model/positions.ts';
import { INJURY_NAMES, type PlayerStore } from '../../engine/model/players.ts';
import type { ShoutKind } from '../../engine/match/engine.ts';
import {
  abilityClass, Bar, ChoiceField, ClubCrest, clubHue, Flag, PlayerFace, Pos, POSITION_ACCENT, RatingBadge,
  Segmented, StarMeter, useDismiss,
} from '../components.tsx';
import { NATIONS } from '../../engine/world/nations.ts';
import type { World } from '../../engine/world/world.ts';
import { Icon } from '../icons.tsx';
import { kitsFor, LiveCourt, type CourtLabels } from '../LiveCourt.tsx';
import { rallyBeats, setupScene, type Radar, type Scene } from '../matchCourt.ts';
import { bigPlayMs, playBeats, RADAR_MS, sleep, type BigPlay } from '../rallyPlayer.ts';
import type { Kit } from '../court3d.ts';
import { servesJump } from '../../engine/match/ratings.ts';
import { TeamSheet } from '../teamSheet.tsx';
import {
  ATTACKER_OPTIONS, BLOCK_OPTIONS, COMBINATION_OPTIONS, DEFENSE_OPTIONS, OFFENSE_OPTIONS, SERVE_OPTIONS,
  SERVE_TARGET_OPTIONS, SHAPE_OPTIONS, SliderField, TEMPO_OPTIONS,
} from './Manage.tsx';
import {
  combinationsOf, Formation, FORMATION_NAMES, formationOf, lineupSlotPositions, type TeamTactics,
} from '../../engine/match/tactics.ts';
import { TacticsBoard } from '../tacticsBoard.tsx';
import { defenceLayoutsOf, type DefenceLayouts } from '../../engine/match/defence.ts';
import { describeRallyHighlight } from './Match.tsx';
import { useGame, WARM_READY, type LiveInjury, type MatchdayLogEntry, type MatchdaySnapshot, type MatchSide } from '../state.ts';
import { Dropdown } from '../dropdown.tsx';

/** National teams play in something like their flag's colour. */
const NATION_HUES: Readonly<Record<string, number>> = {
  POL: 352, ITA: 214, FRA: 224, BRA: 50, USA: 222, JPN: 0, SLO: 135, SRB: 356, ARG: 198, GER: 0, NED: 28, CUB: 0,
  CAN: 356, IRI: 130, TUR: 357, BEL: 4, CHN: 358, BUL: 130, UKR: 50, CZE: 220, FIN: 210, KOR: 220, EGY: 0,
  POR: 140, ESP: 2, SWE: 48, GRE: 210, AUS: 50, MEX: 145, QAT: 335, TUN: 0, CRO: 0, SVK: 220, ROU: 52, NOR: 0,
  AUT: 0, SUI: 0, DEN: 0, CHI: 0, COL: 50, VEN: 350, PUR: 210, DOM: 220, IND: 28, THA: 220, KAZ: 190,
};

/** The hue a side's kit is made from. */
function sideHue(world: World, side: MatchSide): number {
  if (side.clubId >= 0) {
    const club = world.clubs[side.clubId];
    return club !== undefined ? clubHue(club) : 210;
  }
  return NATION_HUES[NATIONS[side.nation]?.code ?? ''] ?? (side.nation * 137.508) % 360;
}

/** A side's badge: the club's crest, or the nation's flag. */
function SideCrest({ side, size }: { side: MatchSide; size: number }): JSX.Element | null {
  const g = useGame();
  if (side.clubId < 0) {
    return <span className="side-flag" style={{ width: size * 1.3, height: size * 0.88 }}><Flag nation={side.nation} /></span>;
  }
  const club = g.world?.clubs[side.clubId];
  return club !== undefined ? <ClubCrest club={club} size={size} /> : null;
}

/** Both sides set up for the next serve, from the live snapshot — the
 *  server where his own serve, jump or float, starts. */
function sceneFor(snap: MatchdaySnapshot | null, roles: Uint8Array, nearTeam: 0 | 1, store: PlayerStore): Scene {
  if (snap === null) return { positions: new Map(), poses: new Map(), ball: null, arc: 0, actor: null, ms: 400 };
  return setupScene(snap, snap.serving, roles, nearTeam, (p) => (servesJump(store, p) ? 'jump' : 'float'));
}

/**
 * Play one rally out on the court: every beat moves the players into where
 * they would really be — serve receive, the switch, the setter running to
 * the target, hitters approaching, the block closing — and sends the ball to
 * whoever touches it next.
 */
async function animateRally(
  logEntry: MatchdayLogEntry,
  roles: Uint8Array,
  nearTeam: 0 | 1,
  speed: number,
  cancelled: { current: boolean },
  setScene: (scene: Scene) => void,
  onBigPlay: (play: BigPlay) => void,
  onRadar: (radar: Radar) => void,
  defenceOf?: (team: 0 | 1) => DefenceLayouts | undefined,
): Promise<void> {
  const { entry } = logEntry;
  const seed = entry.set * 1000 + entry.scoreBefore[0] * 31 + entry.scoreBefore[1];
  const beats = rallyBeats(logEntry, entry.serveTeam, entry.contacts, roles, seed, nearTeam, entry.winner, defenceOf);
  await playBeats(beats, speed, cancelled, setScene, onBigPlay, onRadar);
}

/** How full the stand is: a big competition draws a crowd, a big match fills the place. */
export function crowdFor(world: World, competitionId: number, importance: number): number {
  const comp = world.competitions[competitionId];
  const draw = comp !== undefined ? Math.min(1, comp.reputation / 8000) : 0.7;
  return Math.min(1, 0.42 + 0.38 * draw + 0.3 * importance);
}

/** A big moment flashed over the court — with, for a spike put away or an
 *  ace, the ball's speed and how high it was struck, and for a stuff block
 *  how high the hands were. */
export function BigPlayCallout({ play }: { play: BigPlay }): JSX.Element {
  const reading = play.reading !== undefined && (play.speed !== undefined || play.height !== undefined);
  return (
    <div className={`big-play ${play.team === 0 ? 'home' : 'away'}${reading ? ' with-speed' : ''}`}>
      {play.text}
      {reading && (
        <span className="big-play-reading">
          {play.speed !== undefined && play.reading === 'strike' && (
            <span className="big-play-speed"><small>Speed</small> {play.speed} <small>km/h</small></span>
          )}
          {play.height !== undefined && (
            <span className="big-play-speed">
              <small>{play.reading === 'block' ? 'Block' : 'Contact'}</small> {play.height.toFixed(2)} <small>m</small>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/** The radar's reading of a serve as it flies: who served, how fast, how high — tucked in a corner, the way television shows it. */
export function ServeRadar({ radar, store, kits }: { radar: Radar & { key: number }; store: PlayerStore; kits: [Kit, Kit] }): JSX.Element {
  return (
    <div className="serve-radar" style={{ borderLeftColor: kits[radar.team].shirt }}>
      <span className="serve-radar-who"><small>Serve</small> {store.shortName(radar.player)}</span>
      {radar.speed !== undefined && <span className="serve-radar-val"><b>{radar.speed}</b> km/h</span>}
      {radar.height !== undefined && <span className="serve-radar-val"><b>{radar.height.toFixed(2)}</b> m</span>}
    </div>
  );
}

export function MatchdayScreen(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday;
  if (md === null) return null;
  if (md.stage === 'lineup') return <LineupSetup />;
  return md.stage === 'setBreak' ? <SetBreak /> : <LiveMatchView />;
}

/** Average current ability of a squad's best six — a quick read of how strong a side is. */
function bestSixAverage(players: readonly number[], store: PlayerStore, canPlay: (p: number) => boolean): number {
  const top = [...players]
    .filter(canPlay)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])
    .slice(0, 6);
  return top.length > 0 ? Math.round(top.reduce((s, p) => s + store.currentAbility[p], 0) / top.length) : 0;
}

function LineupSetup(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;

  const [home, away] = md.sides;
  const opponent = md.sides[md.userIsHome ? 1 : 0];
  // The reserves named for today; everyone else fit is left out, to be called up instead.
  const bench = md.homeBench.filter((p) =>
    g.matchAvailable(p) && !md.homeLineup.includes(p) && p !== md.homeLibero && p !== md.homeDefensiveLibero);

  const starters = md.homeLineup.filter((p): p is number => p !== undefined);
  const teamAvg = starters.length > 0
    ? Math.round(starters.reduce((s, p) => s + store.currentAbility[p], 0) / starters.length)
    : 0;
  const oppAvg = bestSixAverage(opponent.players, store, (p) => g.matchAvailable(p));

  return (
    <div className="md-setup">
      <div className="md-banner">
        <div className="md-banner-team">
          <SideCrest side={home} size={46} />
          <div className="md-banner-team-text">
            <span className="md-banner-name">{home.name}</span>
            <span className="md-banner-tag">Home{md.userIsHome ? ' · Your team' : ''}</span>
          </div>
        </div>
        <div className="md-banner-mid">
          <span className="md-banner-comp">{md.title}</span>
          <span className="md-banner-vs">VS</span>
          <span className="md-banner-date">{g.weekdayLabelForDay(md.fixture.day)} {g.dateLabelForDay(md.fixture.day)}</span>
        </div>
        <div className="md-banner-team right">
          <div className="md-banner-team-text">
            <span className="md-banner-name">{away.name}</span>
            <span className="md-banner-tag">Away{!md.userIsHome ? ' · Your team' : ''}</span>
          </div>
          <SideCrest side={away} size={46} />
        </div>
        <div className="md-banner-side">
          <div className="md-strength">
            <div className="lineup-bar-rating">
              <span className="faint">Your starting six</span>
              <StarMeter value={teamAvg} size={13} />
              <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
            </div>
            <div className="lineup-bar-rating">
              <span className="faint">{opponent.shortName} best six</span>
              <StarMeter value={oppAvg} size={13} />
              <strong className={abilityClass(oppAvg)}>{oppAvg}</strong>
            </div>
          </div>
          {md.national === null && <MatchdayTacticSelect />}
          <MatchdayFormation />
          <button className="primary lg" onClick={() => g.kickOff()}>
            <Icon name="whistle" size={18} /> Kick off
          </button>
        </div>
      </div>

      <TeamSheet
        lineup={md.homeLineup}
        libero={md.homeLibero}
        defensiveLibero={md.homeDefensiveLibero}
        bench={bench}
        store={store}
        onSetPlayer={(slot, p) => g.setMatchdayPlayer(slot, p)}
        onSwapPlayers={(a, b) => g.swapMatchdayPlayers(a, b)}
        onSetLibero={(p) => g.setMatchdayLibero(p)}
        onSetDefensiveLibero={(p) => g.setMatchdayDefensiveLibero(p)}
        slotPositions={lineupSlotPositions(formationOf(g.matchTactics() ?? undefined))}
        outOfSquad={g.matchdayLeftOut()}
        onAddToSquad={(p) => g.addToMatchdaySquad(p)}
        onDropFromSquad={(p) => g.dropFromMatchdaySquad(p)}
        outfieldLiberos={md.homeOutfieldLiberos}
        onToggleReserveLibero={(p) => g.toggleReserveLibero(p)}
      />
    </div>
  );
}

/** The saved tactic to play today — loading another picks the six again for it. */
function MatchdayTacticSelect(): JSX.Element | null {
  const g = useGame();
  const saved = g.savedTactics();
  if (saved === null || saved.slots.length < 2) return null;
  const load = (v: number): void => {
    if (g.matchday?.stage !== 'setBreak') {
      g.loadTactic(v);
      return;
    }
    // At a set break the tactic's system comes with it, and the six is picked for it.
    const f = g.loadTacticInMatch(v);
    if (f !== null && f !== formationOf(g.matchTactics() ?? undefined)) g.setMatchdayFormation(f);
  };
  return (
    <div className="md-formation">
      <span className="faint">Tactic</span>
      <Dropdown
        size="sm"
        className="md-tactic-select"
        value={saved.active}
        onChange={load}
        options={saved.slots.map((t, i) => ({ value: i, label: `${i + 1}. ${t.name}` }))}
      />
    </div>
  );
}

/** The 5-1 / 4-2 switch of the team-sheet screens — before kickoff, or for the next set. */
function MatchdayFormation(): JSX.Element {
  const g = useGame();
  return (
    <div className="md-formation" title="5-1: one setter and an opposite. 4-2: two setters, diagonal — the one in the back row sets, the one at the net attacks.">
      <span className="faint">Formation</span>
      <Segmented<Formation>
        size="sm"
        options={[[Formation.FiveOne, FORMATION_NAMES[Formation.FiveOne]], [Formation.FourTwo, FORMATION_NAMES[Formation.FourTwo]]]}
        value={formationOf(g.matchTactics() ?? undefined)}
        onChange={(f) => g.setMatchdayFormation(f)}
      />
    </div>
  );
}

/**
 * The break between two sets: the score so far, and the team sheet again,
 * filled in with the six who started the set just played — keep them, or
 * change anyone and any zone before the next set starts.
 */
function SetBreak(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;

  const [home, away] = md.sides;
  const setsPlayed = md.snapshot?.set ?? 0;
  const setScores = completedSets(md.log, setsPlayed, false);
  // Only the fourteen named at kickoff can play.
  const bench = g.matchSquadOf(md.userIsHome ? 0 : 1).filter((p) =>
    g.matchAvailable(p) && !md.homeLineup.includes(p) && p !== md.homeLibero && p !== md.homeDefensiveLibero);
  const teamAvg = Math.round(
    md.homeLineup.reduce((s, p) => s + store.currentAbility[p], 0) / Math.max(1, md.homeLineup.length));
  const last = g.lastSetSheet();
  const changed = last !== null && (
    last.lineup.some((p, i) => md.homeLineup[i] !== p)
    || last.libero !== md.homeLibero || last.defensiveLibero !== md.homeDefensiveLibero);
  // The opponent has already handed in its sheet: say what it changed.
  const opponentText = md.opponentChanges.length === 0
    ? 'Same six as last set'
    : md.opponentChanges.map((c) => `${store.shortName(c.inPlayerIdx)} for ${store.shortName(c.outPlayerIdx)}${
      c.reason === 'fatigue' ? ' (tired)' : c.reason === 'form' ? ' (struggling)' : ''}`).join(' · ');
  const opponentNote = (
    <span className={`md-banner-changes${md.opponentChanges.length > 0 ? ' changed' : ''}`} title={opponentText}>
      {md.opponentChanges.length > 0 && <Icon name="swap" size={11} />}
      <span>{opponentText}</span>
    </span>
  );

  return (
    <div className="md-setup">
      <div className="md-banner">
        <div className="md-banner-team">
          <SideCrest side={home} size={46} />
          <div className="md-banner-team-text">
            <span className="md-banner-name">{home.name}</span>
            <span className="md-banner-tag">Home{md.userIsHome ? ' · Your team' : ''}</span>
            {!md.userIsHome && opponentNote}
          </div>
        </div>
        <div className="md-banner-mid">
          <span className="md-banner-comp">End of set {setsPlayed}</span>
          <span className="md-banner-vs md-banner-sets">{md.snapshot?.homeSets ?? 0} – {md.snapshot?.awaySets ?? 0}</span>
          <span className="md-banner-date mono">{setScores.map(([h, a]) => `${h}-${a}`).join('  ·  ')}</span>
        </div>
        <div className="md-banner-team right">
          <div className="md-banner-team-text">
            <span className="md-banner-name">{away.name}</span>
            <span className="md-banner-tag">Away{!md.userIsHome ? ' · Your team' : ''}</span>
            {md.userIsHome && opponentNote}
          </div>
          <SideCrest side={away} size={46} />
        </div>
        <div className="md-banner-side">
          <div className="md-strength">
            <div className="lineup-bar-rating">
              <span className="faint">Set {setsPlayed + 1} six</span>
              <StarMeter value={teamAvg} size={13} />
              <strong className={abilityClass(teamAvg)}>{teamAvg}</strong>
            </div>
            <div className="md-setbreak-actions">
              {changed && (
                <button className="sm ghost" onClick={() => g.resetSetBreakSheet()} title="Back to the six who started the last set">
                  <Icon name="swap" size={13} /> Same as last set
                </button>
              )}
              <button className="sm danger" onClick={() => g.finishMatchdayNow()} title="Skip to the result">
                <Icon name="fastForward" size={13} /> Finish match
              </button>
            </div>
          </div>
          {md.national === null && <MatchdayTacticSelect />}
          <MatchdayFormation />
          <button className="primary lg" onClick={() => g.startNextSet()}>
            <Icon name="whistle" size={18} /> Start set {setsPlayed + 1}
          </button>
        </div>
      </div>

      <TeamSheet
        lineup={md.homeLineup}
        libero={md.homeLibero}
        defensiveLibero={md.homeDefensiveLibero}
        bench={bench}
        store={store}
        onSetPlayer={(slot, p) => g.setMatchdayPlayer(slot, p)}
        onSwapPlayers={(a, b) => g.swapMatchdayPlayers(a, b)}
        onSetLibero={(p) => g.setMatchdayLibero(p)}
        onSetDefensiveLibero={(p) => g.setMatchdayDefensiveLibero(p)}
        slotPositions={lineupSlotPositions(formationOf(g.matchTactics() ?? undefined))}
        registered={md.homeLiberos ?? g.matchLiberosOf(md.userIsHome ? 0 : 1)}
      />
    </div>
  );
}

const TIMEOUT_SECONDS = 30;

/** The compact tactics editor shown while a timeout is active — the same club.tactics
 *  object the rally engine reads live, so a change here applies from the next rally on. */
/**
 * Someone down hurt: who, and what — and when it is the user's own player,
 * his call: let him play on with a knock, or take him off — and for whom, the
 * assistant's choice first; an exceptional substitution when the five are
 * spent. One who has to come off, has to.
 */
function InjuryPanel(): JSX.Element | null {
  const g = useGame();
  const md = g.matchday!;
  const live = md.injury;
  if (live == null) return null;
  const store = g.world!.players;
  const roles = g.liveRoles();
  const { inj } = live;
  const knock = inj.severity === 'knock';
  const deciding = live.phase === 'decide';
  const liberos = g.liveLiberos();
  const isLibero = live.ours && (inj.p === liberos.reception || inj.p === liberos.defence);
  const options = deciding ? g.injuryOptions() : [];
  const otherLibero = inj.p === liberos.reception ? liberos.defence : liberos.reception;
  const line = live.phase === 'down' ? 'He is down. The physio is on his way.'
    : live.phase === 'treat' ? 'The physio is with him.'
      : live.phase === 'decide'
        ? knock ? 'He can carry on — below his best, and every rally he plays on with it, it may get worse.'
          : inj.aggravated === true ? 'Playing on has made it worse — he has to come off.' : 'He cannot carry on. Who comes on?'
        : live.phase === 'up' ? 'Back on his feet — he plays on.' : 'Helped off.';
  return (
    <div className={`injury-panel${deciding ? ' deciding' : ''}`}>
      <div className="injury-head">
        <span className="injury-icon"><Icon name="medical" size={22} /></span>
        <PlayerFace playerId={store.id[inj.p]} name={store.fullName(inj.p)} size={38} />
        <div className="injury-title">
          <strong>{store.fullName(inj.p)} <Pos pos={roles[inj.p] as Position} /></strong>
          <span className="faint">{INJURY_NAMES[inj.type] ?? 'Injury'} · {md.sides[inj.team].shortName}</span>
        </div>
        <span className={`injury-tag ${knock ? 'knock' : 'serious'}`}>{knock ? 'Knock' : 'Has to come off'}</span>
      </div>
      <p className="injury-line">{line}</p>
      {deciding && (
        <div className="injury-choices">
          {knock && (
            <button className="primary" onClick={() => g.injuryPlayOn()}>
              <Icon name="play" size={13} /> Play on
            </button>
          )}
          <span className="faint">{knock ? 'or take him off for' : 'Bring on'}</span>
          <div className="injury-options">
            {isLibero && (
              <button className="injury-option" onClick={() => g.injuryTakeOff(-1)}>
                {otherLibero >= 0 ? `${store.shortName(otherLibero)} plays libero alone` : 'Go on without a libero'}
              </button>
            )}
            {options.map((o) => (
              <button key={o.p} className={`injury-option${o.pick ? ' pick' : ''}`} onClick={() => g.injuryTakeOff(o.p)}>
                <PlayerFace playerId={store.id[o.p]} name={store.fullName(o.p)} size={24} />
                <span className="injury-option-name">{store.shortName(o.p)}</span>
                <Pos pos={roles[o.p] as Position} />
                <b>{store.currentAbility[o.p]}</b>
                {o.pick && <span className="injury-flag pick">Assistant's pick</span>}
                {o.exceptional && (
                  <span className="injury-flag" title="Your five are spent: the rules allow an exceptional substitution for an injury, and it uses none of them">
                    Exceptional
                  </span>
                )}
              </button>
            ))}
            {options.length === 0 && !isLibero && !knock && (
              <button className="injury-option" onClick={() => g.injuryCarryOn()}>Nobody left — he carries on as best he can</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TimeoutPanel({
  secondsLeft, calledBy,
}: {
  secondsLeft: number;
  calledBy?: string;
}): JSX.Element | null {
  const g = useGame();
  const t = g.matchTactics();
  if (t === null) return null;
  return (
    <div className="timeout-panel">
      <div className="timeout-head">
        <span className="timeout-icon"><Icon name="whistle" size={22} /></span>
        <div className="timeout-title">
          <strong>Timeout{calledBy !== undefined ? ` — ${calledBy}` : ''}</strong>
          <span className="faint">Adjust the instructions here, or open Tactics for the system and each rotation — changes apply from the next rally.</span>
        </div>
        <span className="timeout-countdown">0:{secondsLeft.toString().padStart(2, '0')}</span>
        <button className="primary" onClick={() => g.resumeFromTimeout()}>
          <Icon name="play" size={14} /> Resume play
        </button>
      </div>
      <div className="timeout-clock"><span style={{ width: `${(secondsLeft / TIMEOUT_SECONDS) * 100}%` }} /></div>
      <div className="grid2 timeout-fields">
        <ChoiceField
          label="Offensive system"
          value={t.offense}
          onChange={(v) => { t.offense = v; g.touch(); }}
          options={OFFENSE_OPTIONS}
        />
        <ChoiceField
          label="Tempo"
          value={t.tempo}
          onChange={(v) => { t.tempo = v; g.touch(); }}
          options={TEMPO_OPTIONS}
        />
        <ChoiceField
          label="Combination plays"
          value={combinationsOf(t)}
          onChange={(v) => { t.combinations = v; g.touch(); }}
          options={COMBINATION_OPTIONS}
        />
        <ChoiceField
          label="Defensive system"
          value={t.defense}
          onChange={(v) => { t.defense = v; g.touch(); }}
          options={DEFENSE_OPTIONS}
        />
        <ChoiceField
          label="Serve strategy"
          value={t.serve}
          onChange={(v) => { t.serve = v; g.touch(); }}
          options={SERVE_OPTIONS}
        />
      </div>
    </div>
  );
}

interface TeamLiveStats { points: number; kills: number; aces: number; blocks: number; errors: number; }

/** Running per-team totals, read off how each revealed rally ended. A block
 *  or an error is logged against the player who lost the point, so the
 *  credit for a block goes to the other side. */
function liveStats(log: readonly MatchdayLogEntry[]): [TeamLiveStats, TeamLiveStats] {
  const s: [TeamLiveStats, TeamLiveStats] = [
    { points: 0, kills: 0, aces: 0, blocks: 0, errors: 0 },
    { points: 0, kills: 0, aces: 0, blocks: 0, errors: 0 },
  ];
  for (const { entry } of log) {
    s[entry.winner].points++;
    const last = entry.contacts[entry.contacts.length - 1];
    if (last === undefined) continue;
    switch (last.kind) {
      case 'kill': s[last.team].kills++; break;
      case 'ace': s[last.team].aces++; break;
      case 'blocked': s[1 - last.team].blocks++; break;
      case 'attackError': case 'serveError': case 'receptionError': case 'setError': case 'digError':
        s[last.team].errors++;
        break;
      default: break;
    }
  }
  return s;
}

/** Final scores of every set already finished, from the last rally of each. */
function completedSets(log: readonly MatchdayLogEntry[], currentSet: number, matchOver: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const last = new Map<number, MatchdayLogEntry>();
  for (const l of log) last.set(l.entry.set, l);
  for (const [set, l] of [...last.entries()].sort((a, b) => a[0] - b[0])) {
    if (set >= currentSet && !matchOver) continue;
    const e = l.entry;
    out.push([e.scoreBefore[0] + (e.winner === 0 ? 1 : 0), e.scoreBefore[1] + (e.winner === 1 ? 1 : 0)]);
  }
  return out;
}


const STAT_ROWS: ReadonlyArray<[keyof TeamLiveStats, string]> = [
  ['points', 'Points won'],
  ['kills', 'Kills'],
  ['aces', 'Aces'],
  ['blocks', 'Blocks'],
  ['errors', 'Errors'],
];

/** The players on court for a side, in the order a team sheet lists them: setter, hitters, middles, libero. */
const ROLE_ORDER: Readonly<Record<Position, number>> = {
  [Position.Setter]: 0, [Position.OutsideHitter]: 1, [Position.Opposite]: 2, [Position.MiddleBlocker]: 3, [Position.Libero]: 4,
};

/** What a shout sounded like from the touchline, and how it landed. */
const SHOUT_LINES: Readonly<Record<ShoutKind, { label: string; hint: string; line: string }>> = {
  encourage: { label: 'Encourage', hint: 'Lift the side', line: 'Come on — keep going!' },
  demand: { label: 'Demand more', hint: 'Best when behind', line: 'Is that all you have got?!' },
  calm: { label: 'Calm down', hint: 'Settle a side in a slump', line: 'Breathe — one point at a time.' },
};
const SHOUT_EFFECT: Readonly<Record<'lifted' | 'flat' | 'tense', string>> = {
  lifted: 'the side responds',
  flat: 'it changes little',
  tense: 'they tighten up',
};

/** A side's six on court and its libero, each with the live rating — the panel down either side of the court. */
function LiveTeamCard({ team, serving, ratings }: { team: 0 | 1; serving: boolean; ratings: Map<number, number> }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const side = md.sides[team];
  const roles = g.liveRoles();
  const court = (team === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const libero = (team === 0 ? md.snapshot?.homeLibero : md.snapshot?.awayLibero) ?? -1;
  const rows = [...court, ...(libero >= 0 ? [libero] : [])]
    .filter((p, i, all) => all.indexOf(p) === i)
    .sort((a, b) => ROLE_ORDER[roles[a] as Position] - ROLE_ORDER[roles[b] as Position]);
  const knocks = g.liveKnocks();
  return (
    <section className="card lv-team">
      <header className="lv-team-head">
        <SideCrest side={side} size={22} />
        <strong>{side.name}</strong>
        <span className={`lv-serve-dot${serving ? ' on' : ''}`} title={serving ? 'Serving' : undefined} />
      </header>
      <div className="lv-team-rows">
        {rows.map((p) => {
          const r = ratings.get(p);
          return (
            <div key={p} className="lv-team-row" onClick={() => g.select(p)} title={store.fullName(p)}>
              <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={22} />
              <span className="lv-team-name">
                {store.shortName(p).split(' ').pop()}
                {knocks.has(p) && <span className="lv-knock" title="Playing on with a knock — below his best, and it may get worse">+</span>}
              </span>
              <Pos pos={roles[p] as Position} />
              {r !== undefined ? <RatingBadge value={r} size="sm" /> : <span className="lv-rating-none">—</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** What switching system takes on court: who could make way, who could come on, and the obvious pair. */
interface SystemChange {
  out: number[];
  in: number[];
  why: string;
}

/**
 * The substitution a change of system needs, or null if the six on court
 * already fit it: a 4-2 wants a second setter, diagonal to the first — so on
 * for the opposite; a 5-1 wants one, so an opposite on for the other.
 */
function systemChangeFor(
  store: PlayerStore, roles: ArrayLike<number>, target: Formation, court: readonly number[], bench: readonly number[],
): SystemChange | null {
  const pos = (p: number): Position => roles[p] as Position;
  const best = (ps: number[]): number[] => [...ps].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const setters = court.filter((p) => pos(p) === Position.Setter);
  if (target === Formation.FourTwo) {
    if (setters.length >= 2) return null;
    const zone = court.findIndex((p) => pos(p) === Position.Setter);
    const diagonal = zone >= 0 ? court[(zone + 3) % 6] : -1;
    const rank = (p: number): number => (p === diagonal ? 0 : pos(p) === Position.Opposite ? 1 : 2);
    return {
      out: court.filter((p) => pos(p) !== Position.Setter && pos(p) !== Position.Libero).sort((a, b) => rank(a) - rank(b)),
      in: best(bench.filter((p) => pos(p) === Position.Setter)),
      why: 'A 4-2 plays two setters, diagonal to each other: a second one comes on, for the opposite.',
    };
  }
  if (setters.length <= 1) return null;
  return {
    // The weaker of the two makes way.
    out: [...setters].sort((a, b) => store.currentAbility[a] - store.currentAbility[b]),
    in: [
      ...best(bench.filter((p) => pos(p) === Position.Opposite)),
      ...best(bench.filter((p) => pos(p) === Position.OutsideHitter)),
    ],
    why: 'A 5-1 runs on one setter: an opposite comes on for the other.',
  };
}

/** The system the side plays, and the switch to the other — with the substitution it takes. */
function LiveSystem({ tactics, target, onTarget }: {
  tactics: TeamTactics;
  target: Formation | null;
  onTarget: (f: Formation | null) => void;
}): JSX.Element {
  const g = useGame();
  const md = g.matchday!;
  const store = g.world!.players;
  const team: 0 | 1 = md.userIsHome ? 0 : 1;
  const court = (team === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  const liberos = g.liveLiberos();
  const roles = g.liveRoles();
  const named = new Set(g.matchLiberosOf(team));
  const bench = g.matchSquadOf(team).filter((p) => !court.includes(p) && g.matchAvailable(p)
    && !named.has(p) && p !== liberos.reception && p !== liberos.defence);
  const playing = formationOf(tactics);
  const pending = target !== null && target !== playing ? target : null;
  const change = pending !== null ? systemChangeFor(store, roles, pending, court, bench) : null;
  const [out, setOut] = useState<number | null>(null);
  const [inc, setInc] = useState<number | null>(null);
  useEffect(() => { setOut(null); setInc(null); }, [pending]);
  const remaining = g.subsRemaining();
  const outP = out ?? change?.out[0] ?? -1;
  const inP = inc ?? change?.in[0] ?? -1;

  const name = (p: number): string => store.shortName(p);
  const setters = court.filter((p) => roles[p] === Position.Setter);
  const opposite = court.find((p) => roles[p] === Position.Opposite);
  const now = playing === Formation.FourTwo && setters.length >= 2
    ? `${name(setters[0])} and ${name(setters[1])} set, from the back row`
    : `${setters.length > 0 ? `${name(setters[0])} sets` : 'No setter on court'}${opposite !== undefined ? ` · ${name(opposite)} opposite` : ''}`;

  const pick = (f: Formation): void => {
    if (f === playing) { onTarget(null); return; }
    if (systemChangeFor(store, roles, f, court, bench) === null) {
      g.changeLiveFormation(f);
      onTarget(null);
      return;
    }
    onTarget(f);
  };
  const blocked = md.setBreakPending
    ? 'The set is over: change it at the set break.'
    : change === null ? null
      : remaining <= 0 ? 'No substitutions left this set: the change can be made at the set break.'
        : change.in.length === 0
          ? pending === Formation.FourTwo ? 'There is no setter on the bench to bring on.' : 'There is no opposite or outside hitter on the bench to bring on.'
          : null;
  const option = (p: number): { value: number; label: string; hint: string } => ({
    value: p, label: name(p), hint: `${POSITION_SHORT[store.position[p] as Position]} · ${store.currentAbility[p]}`,
  });

  return (
    <section className="lv-sys">
      <div className="lv-sys-head">
        <div className="lv-sys-now">
          <span className="lv-tac-label">System</span>
          <b>{FORMATION_NAMES[playing]}</b>
          <span className="faint">{now}</span>
        </div>
        <Segmented<Formation>
          options={[[Formation.FiveOne, '5-1 · one setter'], [Formation.FourTwo, '4-2 · two setters']]}
          value={pending ?? playing}
          onChange={pick}
        />
      </div>
      {pending !== null && (
        <div className="lv-sys-change">
          <p>{change?.why ?? `The six on court already fit a ${FORMATION_NAMES[pending]}.`}</p>
          {change !== null && change.in.length > 0 && (
            <div className="lv-sys-swap">
              <div className="lv-sys-pick">
                <span className="lv-tac-label">Off</span>
                <Dropdown size="sm" value={outP} options={change.out.map(option)} onChange={setOut} />
              </div>
              <Icon name="swap" size={16} />
              <div className="lv-sys-pick">
                <span className="lv-tac-label">On</span>
                <Dropdown size="sm" value={inP} options={change.in.map(option)} onChange={setInc} />
              </div>
            </div>
          )}
          {blocked !== null && <p className="lv-sys-blocked"><Icon name="alert" size={13} /> {blocked}</p>}
          <div className="lv-sys-actions">
            <button
              className="primary sm"
              disabled={blocked !== null || (change !== null && (outP < 0 || inP < 0))}
              onClick={() => {
                g.changeLiveFormation(pending, change === null ? undefined : { out: outP, in: inP });
                onTarget(null);
              }}
            >
              <Icon name="check" size={13} />
              {change === null ? ` Switch to ${FORMATION_NAMES[pending]}` : ` Make the change · uses 1 of ${remaining} subs`}
            </button>
            <button className="sm ghost" onClick={() => onTarget(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Each rotation's instructions, the one the side stands in now first. */
function LiveRotations({ tactics, current }: { tactics: TeamTactics; current: number }): JSX.Element {
  const g = useGame();
  const [rot, setRot] = useState(current);
  const r = tactics.rotations[rot];
  const fourTwo = formationOf(tactics) === Formation.FourTwo;
  const setterFront = !fourTwo && rot >= 1 && rot <= 3;
  const copyToAll = (): void => {
    for (let i = 0; i < tactics.rotations.length; i++) if (i !== rot) tactics.rotations[i] = { ...r };
    g.touch();
  };
  return (
    <div className="lv-rot">
      <div className="lv-rot-tabs">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <button key={i} className={`lv-rot-tab${i === rot ? ' active' : ''}${i === current ? ' now' : ''}`} onClick={() => setRot(i)}>
            <b>P{i + 1}</b>
            <span>{i === current ? 'Now' : !fourTwo && i >= 1 && i <= 3 ? 'Setter front' : 'Setter back'}</span>
          </button>
        ))}
      </div>
      <div className="lv-rot-meta">
        <span className={`rot-flag${setterFront ? ' warn' : ''}`}>
          {fourTwo ? 'A setter always in the back row · three attackers' : setterFront ? 'Setter front row · two attackers' : 'Setter back row · three attackers'}
        </span>
        <button className="sm ghost" onClick={copyToAll} title={`Every rotation gets P${rot + 1}'s instructions`}>
          <Icon name="swap" size={13} /> Use for every rotation
        </button>
      </div>
      <div className="grid2 timeout-fields lv-rot-fields">
        <ChoiceField label="Preferred attacker" value={r.preferredAttacker} onChange={(v) => { r.preferredAttacker = v; g.touch(); }} options={ATTACKER_OPTIONS} />
        <ChoiceField label="Serve target" value={r.serveTarget} onChange={(v) => { r.serveTarget = v; g.touch(); }} options={SERVE_TARGET_OPTIONS} />
        <ChoiceField label="Block assignment" value={r.blockAssignment} onChange={(v) => { r.blockAssignment = v; g.touch(); }} options={BLOCK_OPTIONS} />
        <ChoiceField label="Defensive shape" value={r.defensiveShape} onChange={(v) => { r.defensiveShape = v; g.touch(); }} options={SHAPE_OPTIONS} />
        <SliderField label="Back-row transition" value={r.transitionBackRow} onChange={(v) => { r.transitionBackRow = v; g.touch(); }} left="Rarely" right="Often" />
        <SliderField label="Setter tempo bias" value={r.setterTempoBias} onChange={(v) => { r.setterTempoBias = v; g.touch(); }} left="Slower" right="Quicker" />
      </div>
    </div>
  );
}

/**
 * The tactics, changed during the match — the same object the engine reads,
 * so a change applies from the next rally: the system (with the substitution
 * a switch takes), the team instructions, each rotation's, or another saved
 * tactic altogether.
 */
function TacticsOverlay({ onClose }: { onClose: () => void }): JSX.Element | null {
  const g = useGame();
  const md = g.matchday!;
  const t = g.matchTactics();
  const [tab, setTab] = useState<'team' | 'rotations'>('team');
  /** A system picked that takes a substitution to play — waiting on who goes off and who comes on. */
  const [target, setTarget] = useState<Formation | null>(null);
  if (t === null) return null;
  const saved = md.national === null ? g.savedTactics() : null;
  const rotation = (md.userIsHome ? md.snapshot?.homeRotation : md.snapshot?.awayRotation) ?? 0;
  return (
    <div className="lv-overlay lv-tac">
      <header className="lv-overlay-head">
        <strong><Icon name="tactics" size={16} /> Tactics</strong>
        <Segmented<'team' | 'rotations'> size="sm" options={[['team', 'Team'], ['rotations', 'Rotations']]} value={tab} onChange={setTab} />
        <span className="faint">Changes apply from the next rally.</span>
        {saved !== null && saved.slots.length >= 2 && (
          <Dropdown
            size="sm"
            className="lv-tac-load"
            title="Load another of your tactics"
            value={saved.active}
            onChange={(i) => {
              const f = g.loadTacticInMatch(i);
              if (f !== null && f !== formationOf(t)) {
                setTab('team');
                setTarget(f);
              }
            }}
            options={saved.slots.map((s, i) => ({ value: i, label: s.name, hint: FORMATION_NAMES[formationOf(s.tactics)] }))}
          />
        )}
        <button className="icon-btn" onClick={onClose} title="Close"><Icon name="close" size={16} /></button>
      </header>
      <div className="lv-overlay-body">
        {tab === 'team'
          ? (
            <>
              <LiveSystem tactics={t} target={target} onTarget={setTarget} />
              <TacticsBoard tactics={t} onChange={() => g.touch()} compact />
            </>
          )
          : <LiveRotations tactics={t} current={rotation} />}
      </div>
    </div>
  );
}

function LiveMatchView(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  const store = world.players;
  const snap = md.snapshot;
  const logRef = useRef<HTMLDivElement>(null);
  // The user's side plays in the half nearest the camera.
  const nearTeam: 0 | 1 = md.userIsHome ? 0 : 1;
  const [scene, setScene] = useState<Scene>(() => sceneFor(md.snapshot, g.liveRoles(), nearTeam, store));
  const [labels, setLabels] = useState<CourtLabels>('ratings');
  const [overlay, setOverlay] = useState<'subs' | 'tactics' | null>(null);
  const [shoutOpen, setShoutOpen] = useState(false);
  const shoutRef = useDismiss(shoutOpen, () => setShoutOpen(false));
  /** True while a rally is being played out, so snapshot changes don't yank the court mid-rally. */
  const animatingRef = useRef(false);
  const [bigPlay, setBigPlay] = useState<(BigPlay & { key: number }) | null>(null);
  const [subAnnouncement, setSubAnnouncement] = useState<{ text: string; team: 0 | 1; key: number } | null>(null);
  const [timeoutSecondsLeft, setTimeoutSecondsLeft] = useState(TIMEOUT_SECONDS);
  /** Rallies whose animation has finished — the scoreboard, commentary and
   *  stats only count these, so they change as the ball lands, not before. */
  const [revealed, setRevealed] = useState(md.log.length);
  const bigPlayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const subAnnounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Counts down a called timeout. Purely a presentation-layer clock — the
  // engine has no concept of timeouts — kept as one tick-the-clock effect...
  useEffect(() => {
    if (md.timeoutActive === null) { setTimeoutSecondsLeft(TIMEOUT_SECONDS); return; }
    setTimeoutSecondsLeft(TIMEOUT_SECONDS);
    const interval = setInterval(() => {
      setTimeoutSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [md.timeoutActive]);

  // ...and one separate effect that reacts to the clock hitting zero, rather
  // than calling back into game state from inside a setState updater.
  useEffect(() => {
    if (md.timeoutActive !== null && timeoutSecondsLeft === 0) g.resumeFromTimeout();
  }, [md.timeoutActive, timeoutSecondsLeft]);

  const [radar, setRadar] = useState<(Radar & { key: number }) | null>(null);
  const radarTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const triggerRadar = (r: Radar): void => {
    setRadar({ ...r, key: Date.now() });
    clearTimeout(radarTimer.current);
    radarTimer.current = setTimeout(() => setRadar(null), RADAR_MS / (g.matchday?.speed ?? 1));
  };

  const triggerBigPlay = (play: BigPlay): void => {
    setBigPlay({ ...play, key: Date.now() });
    if (bigPlayTimer.current !== undefined) clearTimeout(bigPlayTimer.current);
    bigPlayTimer.current = setTimeout(() => setBigPlay(null), bigPlayMs(play));
  };

  // Announces every substitution live, either side — driven off state.ts's
  // own record of the last one rather than the call site, since it can come
  // from the user's Substitutions panel or from the AI's own decisions.
  const lastSubSeq = md.lastSubstitution?.seq;
  useEffect(() => {
    const sub = md.lastSubstitution;
    if (sub === null) return;
    const teamName = md.sides[sub.team].shortName;
    const text = sub.libero !== undefined
      ? `${teamName}: ${store.shortName(sub.inPlayerIdx)} in as ${sub.libero === 'reception' ? 'reception' : 'defensive'} libero`
      : `${teamName}: ${store.shortName(sub.inPlayerIdx)} ON for ${store.shortName(sub.outPlayerIdx)}${
        sub.reason === 'fatigue' ? ' (tired)' : sub.reason === 'form' ? ' (struggling)' : ''}`;
    setSubAnnouncement({ text, team: sub.team, key: sub.seq });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3000);
  }, [lastSubSeq]);

  // A shout from the touchline goes up on the same banner.
  const lastShoutSeq = md.lastShout?.seq;
  useEffect(() => {
    const s = md.lastShout;
    if (s == null) return;
    const team: 0 | 1 = md.userIsHome ? 0 : 1;
    setSubAnnouncement({ text: `“${SHOUT_LINES[s.kind].line}” — ${SHOUT_EFFECT[s.effect]}`, team, key: s.seq });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3000);
  }, [lastShoutSeq]);

  /** A line on the banner, for either side. */
  const announce = (text: string, team: 0 | 1): void => {
    setSubAnnouncement({ text, team, key: Date.now() });
    if (subAnnounceTimer.current !== undefined) clearTimeout(subAnnounceTimer.current);
    subAnnounceTimer.current = setTimeout(() => setSubAnnouncement(null), 3200);
  };

  /**
   * Someone hurt: he goes down, the physio comes on and down beside him; the
   * coach makes his call — the user, for his own; the engine has made it for
   * the other side — and he is up and playing on, or helped off and someone
   * else on.
   */
  const playInjury = async (live: LiveInjury, speed: number, cancelled: { current: boolean }): Promise<void> => {
    const who = store.shortName(live.inj.p);
    const side = live.inj.team;
    const sideName = g.matchday?.sides[side].shortName ?? '';
    announce(`${sideName}: ${who} is down — ${(INJURY_NAMES[live.inj.type] ?? 'hurt').toLowerCase()}`, side);
    await sleep(1500 / speed);
    if (cancelled.current) return;
    g.setInjuryPhase('treat');
    await sleep(2200 / speed);
    if (cancelled.current) return;
    if (g.injuryNeedsCall(live)) {
      g.setInjuryPhase('decide');
      while (!cancelled.current && g.matchday?.injury?.phase === 'decide') await sleep(150);
    } else {
      g.setInjuryPhase(live.inj.off === true ? 'off' : 'up');
    }
    if (cancelled.current) return;
    const off = g.matchday?.injury?.phase === 'off';
    const by = live.inj.replacedBy ?? -1;
    announce(off ? `${sideName}: ${who} helped off${by >= 0 ? ` — ${store.shortName(by)} on` : ''}` : `${sideName}: ${who} plays on`, side);
    await sleep((off ? 3400 : 1700) / speed);
    g.endInjuryStoppage();
  };

  // Drives the match forward itself: play a rally, animate it, repeat.
  // No timer in state.ts — pacing is entirely a presentation concern here.
  useEffect(() => {
    // Each mount runs its own loop with its own stop flag. React's development
    // StrictMode mounts the view twice; a flag shared between mounts let the
    // discarded first loop run on beside the real one, two rallies animating
    // over each other on the one court.
    const cancelled = { current: false };
    const run = async (): Promise<void> => {
      // A moment before the first serve, for the referee to wave it on — which
      // also stops a throwaway mount before it has played a single rally.
      await sleep(1200 / (g.matchday?.speed ?? 1));
      let stopped = false;
      while (!cancelled.current) {
        const current = g.matchday;
        if (current === null) break;
        if (current.paused) {
          stopped = true;
          // A substitution stoppage ends by itself once its wall-clock time is
          // up — but never while a timeout is open, which only the clock or
          // the Resume button may close.
          if (current.pauseUntil !== null && current.timeoutActive === null && Date.now() >= current.pauseUntil) {
            g.resume();
            continue;
          }
          await sleep(150);
          continue;
        }
        if (stopped) {
          // Play back on: a moment for the referee to wave the serve on.
          stopped = false;
          await sleep(1100 / current.speed);
          continue;
        }
        // A set won while this view was away (it unmounted mid-pause) still
        // needs its break before another rally can be played.
        if (current.setBreakPending) {
          g.openSetBreak();
          break;
        }
        animatingRef.current = true;
        const logEntry = g.playNextRally();
        if (logEntry === null) { animatingRef.current = false; break; }
        await animateRally(logEntry, g.liveRoles(), nearTeam, current.speed, cancelled, setScene, triggerBigPlay, triggerRadar, (team) => {
          // The user's side defends as set now; the other as its club has it.
          const userTeam = current.userIsHome ? 0 : 1;
          if (team === userTeam) return defenceLayoutsOf(g.matchTactics() ?? undefined);
          const club = current.sides[team].clubId >= 0 ? world.clubs[current.sides[team].clubId] : undefined;
          return club !== undefined ? defenceLayoutsOf(club.tactics) : undefined;
        });
        animatingRef.current = false;
        if (cancelled.current) break;
        setRevealed(g.matchday?.log.length ?? 0);
        // Anyone hurt in that rally: the stoppage for him, played out on the court.
        if (g.matchday?.snapshot?.matchOver !== true) {
          for (let live = g.beginInjuryStoppage(); live !== null && !cancelled.current; live = g.beginInjuryStoppage()) {
            await playInjury(live, current.speed, cancelled);
          }
          if (cancelled.current) break;
        }
        if (g.matchday?.snapshot?.matchOver === true) {
          // Full time: let the last point sink in, then on to the report.
          await sleep(2200 / current.speed);
          if (!cancelled.current) g.completeMatchday();
          break;
        }
        if (g.matchday?.setBreakPending === true) {
          // Set over: same pause, then the set break's team sheet takes the
          // screen. Coming back from it mounts this view, and its loop, afresh.
          await sleep(2200 / current.speed);
          if (!cancelled.current) g.openSetBreak();
          break;
        }
        // Everyone walks into position for the next serve — rotating on a
        // side-out — while the referee gives the point and waves the serve on.
        setScene(sceneFor(g.matchday?.snapshot ?? null, g.liveRoles(), nearTeam, store));
        await sleep(1800 / current.speed);
      }
    };
    void run();
    return () => {
      cancelled.current = true;
      clearTimeout(bigPlayTimer.current);
      clearTimeout(subAnnounceTimer.current);
    };
  }, []);

  // The newest point is at the top of the list: keep it in view.
  useEffect(() => {
    logRef.current?.scrollTo(0, 0);
  }, [revealed]);

  // A timeout is the moment for changes — open the substitutions.
  useEffect(() => {
    if (md.timeoutActive !== null) setOverlay('subs');
  }, [md.timeoutActive]);

  // A substitution or libero change between rallies redraws the set-up.
  useEffect(() => {
    if (!animatingRef.current) setScene(sceneFor(md.snapshot, g.liveRoles(), nearTeam, store));
  }, [md.snapshot]);

  const [homeClub, awayClub] = md.sides;
  const userTeamIdx: 0 | 1 = md.userIsHome ? 0 : 1;
  const kits = kitsFor(sideHue(world, homeClub), sideHue(world, awayClub));
  const teamOf = (p: number): 0 | 1 => (homeClub.players.includes(p) ? 0 : 1);
  // What the scoreboard shows: the state before the rally still being
  // animated, or the live snapshot once every rally has been shown.
  const pending = revealed < md.log.length ? md.log[revealed] : null;
  const shownLog = pending === null ? md.log : md.log.slice(0, revealed);
  const view = pending !== null
    ? {
      homeScore: pending.entry.scoreBefore[0],
      awayScore: pending.entry.scoreBefore[1],
      homeSets: pending.setsBefore[0],
      awaySets: pending.setsBefore[1],
      set: pending.entry.set,
      serving: pending.entry.serveTeam,
      matchOver: false,
    }
    : {
      homeScore: snap?.homeScore ?? 0,
      awayScore: snap?.awayScore ?? 0,
      homeSets: snap?.homeSets ?? 0,
      awaySets: snap?.awaySets ?? 0,
      set: snap?.set ?? 0,
      serving: snap?.serving ?? 0,
      matchOver: snap?.matchOver ?? false,
    };
  const stats = liveStats(shownLog);
  const ratings = g.liveRatings();
  const setHistory = completedSets(shownLog, view.set, view.matchOver);
  const homeProb = shownLog.length > 0 ? shownLog[shownLog.length - 1].entry.homeWinProb : 0.5;
  const status = view.matchOver
    ? 'Full time'
    : md.injury != null
      ? 'Injury'
    : md.timeoutActive !== null
      ? 'Timeout'
      : md.paused && md.pauseUntil !== null
        ? 'Substitution'
        : md.paused ? 'Paused' : 'Live';
  const remaining = g.subsRemaining();
  const shoutWait = g.shoutWait();
  const last = shownLog[shownLog.length - 1]?.entry;
  const lastText = last !== undefined ? describeRallyHighlight(last, store) : null;
  const points = [...shownLog].reverse().map((l) => l.entry);
  const crowdFill = crowdFor(world, md.fixture.competitionId, md.fixture.importance);

  return (
    <div className="lv" style={{ ["--lv-home" as string]: kits[0].shirt, ["--lv-away" as string]: kits[1].shirt } as CSSProperties}>
      <div className="lv-top">
        <div className="lv-score">
          <div className="lv-score-meta">
            <span className={`lv-live status-${status.toLowerCase().replace(' ', '-')}`}><i />{status}</span>
            <span className="faint">{md.title}</span>
          </div>
          <div className="lv-score-main">
            <span className="lv-kitbar" style={{ background: kits[0].shirt }} />
            <SideCrest side={homeClub} size={26} />
            <b className="lv-code">{homeClub.shortName}</b>
            <span className={`lv-serve-dot${view.serving === 0 ? ' on' : ''}`} />
            <span className="lv-points">{view.homeScore}</span>
            <span className="lv-dash">–</span>
            <span className="lv-points">{view.awayScore}</span>
            <span className={`lv-serve-dot${view.serving === 1 ? ' on' : ''}`} />
            <b className="lv-code">{awayClub.shortName}</b>
            <SideCrest side={awayClub} size={26} />
            <span className="lv-kitbar" style={{ background: kits[1].shirt }} />
          </div>
          <div className="lv-score-sets">
            <span>{view.matchOver ? 'Full time' : `Set ${view.set + 1}`} · Sets {view.homeSets}–{view.awaySets}</span>
            {setHistory.map(([h, a], i) => (
              <span key={i} className="lv-set-chip"><b className={h > a ? 'won' : ''}>{h}</b>-<b className={a > h ? 'won' : ''}>{a}</b></span>
            ))}
          </div>
        </div>
        <div className="lv-momentum" title="Win probability">
          <span>{homeClub.name}</span>
          <div className="lv-momentum-bar">
            <i style={{ width: `${homeProb * 100}%`, background: kits[0].shirt }} />
            <i style={{ width: `${(1 - homeProb) * 100}%`, background: kits[1].shirt }} />
          </div>
          <span>{awayClub.name}</span>
        </div>
      </div>

      <div className="lv-main">
        <div className="lv-col">
          <LiveTeamCard team={0} serving={view.serving === 0} ratings={ratings} />
          <section className="card lv-points-card">
            <header className="lv-card-head">Point by point</header>
            <div className="lv-pbp" ref={logRef}>
              {points.length === 0 && <div className="lv-pbp-row dim">Kicking off…</div>}
              {points.map((r, i) => {
                const won = r.winner;
                const d = describeRallyHighlight(r, store);
                return (
                  <div key={points.length - i} className={`lv-pbp-row ${won === 0 ? 'home' : 'away'}`}>
                    <span className="lv-pbp-score">{r.scoreBefore[0] + (won === 0 ? 1 : 0)}-{r.scoreBefore[1] + (won === 1 ? 1 : 0)}</span>
                    <span className="lv-pbp-text">{d.before}{d.player !== '' && <strong>{d.player}</strong>}{d.after}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="lv-center">
          <div className="card court-panel lv-court">
            <LiveCourt
              scene={scene} store={store} roles={g.liveRoles()} kits={kits} teamOf={teamOf} ratings={ratings} labels={labels}
              injury={md.injury != null ? { p: md.injury.inj.p, team: md.injury.inj.team, phase: md.injury.phase } : null}
              sideline={g.liveSideline()}
              nearTeam={nearTeam}
              crowdFill={crowdFill}
              // The referee sees a stoppage — and signals a time-out — once
              // the rally it followed has been shown.
              timeout={pending === null ? md.timeoutActive : null}
              paused={pending === null && md.paused}
              speed={md.speed}
              teamNames={[homeClub.shortName, awayClub.shortName]}
              view={g.courtView}
            />
            <div className="lv-court-tools">
              <Segmented<'3d' | '2d'> size="sm" options={[['3d', '3D'], ['2d', '2D']]} value={g.courtView} onChange={(v) => g.setCourtView(v)} />
              <Segmented<CourtLabels>
                size="sm"
                options={[['ratings', 'Ratings'], ['names', 'Names'], ['off', 'Off']]}
                value={labels}
                onChange={setLabels}
              />
            </div>

            {bigPlay !== null && <BigPlayCallout key={bigPlay.key} play={bigPlay} />}
            {radar !== null && <ServeRadar key={radar.key} radar={radar} store={store} kits={kits} />}
            {subAnnouncement !== null && (
              <div
                key={subAnnouncement.key}
                className={`big-play sub-announcement ${subAnnouncement.team === 0 ? 'home' : 'away'}`}
              >
                {subAnnouncement.text}
              </div>
            )}
            {md.injury != null && <InjuryPanel />}
            {md.timeoutActive !== null && overlay !== 'subs' && (
              <TimeoutPanel
                secondsLeft={timeoutSecondsLeft}
                calledBy={md.timeoutActive === 0 ? homeClub.shortName : awayClub.shortName}
              />
            )}
            {overlay === 'subs' && (
              <div className="lv-overlay">
                <header className="lv-overlay-head">
                  <strong><Icon name="swap" size={16} /> Substitutions</strong>
                  <span className="faint">{remaining} left this set{md.timeoutActive !== null ? ` · timeout 0:${timeoutSecondsLeft.toString().padStart(2, '0')}` : ''}</span>
                  {md.timeoutActive !== null && (
                    <button className="primary sm" onClick={() => g.resumeFromTimeout()}><Icon name="play" size={13} /> Resume play</button>
                  )}
                  <button className="icon-btn" onClick={() => setOverlay(null)} title="Close"><Icon name="close" size={16} /></button>
                </header>
                <div className="lv-overlay-body"><Substitutions teamIdx={userTeamIdx} /></div>
              </div>
            )}
            {overlay === 'tactics' && <TacticsOverlay onClose={() => setOverlay(null)} />}
          </div>
          <div className="lv-caption">
            <span className="lv-caption-text">
              {lastText === null ? 'Waiting for the first serve' : <>{lastText.before}{lastText.player !== '' && <strong>{lastText.player}</strong>}{lastText.after}</>}
            </span>
            <b>{view.homeScore}-{view.awayScore}</b>
          </div>
        </div>

        <div className="lv-col">
          <LiveTeamCard team={1} serving={view.serving === 1} ratings={ratings} />
          <section className="card lv-stats-card">
            <header className="lv-card-head">Match stats</header>
            <div className="lv-stats-names">
              <span>{homeClub.shortName}</span>
              <span>{awayClub.shortName}</span>
            </div>
            {STAT_ROWS.map(([key, label]) => {
              const h = stats[0][key];
              const a = stats[1][key];
              const total = h + a;
              return (
                <div className="lv-stat" key={key}>
                  <div className="lv-stat-row"><b>{h}</b><span>{label}</span><b>{a}</b></div>
                  <div className="lv-stat-bar">
                    <i style={{ width: `${total > 0 ? (h / total) * 100 : 50}%`, background: kits[0].shirt }} />
                    <i style={{ width: `${total > 0 ? (a / total) * 100 : 50}%`, background: kits[1].shirt }} />
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </div>

      <div className="lv-coachbar">
        <span className="lv-coach-label">Coach</span>
        <button
          disabled={md.timeoutActive !== null || md.timeoutsUsed[userTeamIdx] >= 2}
          onClick={() => g.callTimeout()}
          title="Call a timeout"
        >
          <Icon name="whistle" size={15} /> Timeout <span className="lv-badge">{2 - md.timeoutsUsed[userTeamIdx]}</span>
        </button>
        <button className={overlay === 'subs' ? 'on' : ''} onClick={() => setOverlay((o) => (o === 'subs' ? null : 'subs'))}>
          <Icon name="swap" size={15} /> Substitution <span className={`lv-badge${remaining <= 0 ? ' bad' : ''}`}>{remaining}</span>
        </button>
        <div className="lv-shout" ref={shoutRef}>
          <button
            className={shoutOpen ? 'on' : ''}
            disabled={shoutWait > 0 || view.matchOver}
            title={shoutWait > 0 ? `You can shout again in ${shoutWait} rallies` : 'A word from the touchline'}
            onClick={() => setShoutOpen((o) => !o)}
          >
            <Icon name="press" size={15} /> Shout{shoutWait > 0 && <span className="lv-badge">{shoutWait}</span>}
          </button>
          {shoutOpen && (
            <div className="menu-pop lv-shout-menu">
              {(Object.keys(SHOUT_LINES) as ShoutKind[]).map((k) => (
                <button key={k} onClick={() => { g.shout(k); setShoutOpen(false); }}>
                  <span className="menu-pop-stack">
                    <span>{SHOUT_LINES[k].label}</span>
                    <span className="faint">{SHOUT_LINES[k].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className={overlay === 'tactics' ? 'on' : ''} onClick={() => setOverlay((o) => (o === 'tactics' ? null : 'tactics'))}>
          <Icon name="tactics" size={15} /> Tactics
        </button>
        <span className="flex-spacer" />
        {md.paused
          ? (
            <button disabled={md.timeoutActive !== null || md.injury != null} onClick={() => g.resume()}>
              <Icon name="play" size={14} /> Resume
            </button>
          )
          : (
            <button disabled={md.timeoutActive !== null || md.injury != null} onClick={() => g.pause()}>
              <Icon name="pause" size={14} /> Pause
            </button>
          )}
        <Segmented
          size="sm"
          options={[[1, '1×'], [1.5, '1.5×'], [2, '2×']] as const}
          value={md.speed}
          onChange={(sp) => g.setSpeed(sp)}
        />
        <button className="lv-skip" onClick={() => g.finishMatchdayNow()} title="Skip to the result">
          Skip to result <Icon name="arrowRight" size={14} />
        </button>
      </div>
    </div>
  );
}

/** A clickable, draggable player row for the substitution picker. Dragging one
 *  onto another (in either direction — bench-to-court or court-to-bench) subs
 *  them in one motion; clicking both, then confirming, does the same thing. */
function SubCard({
  playerIdx, store, role, rating, selected, isDragOver, onClick, onDropPlayer, onDragOverCard, onDragLeaveCard, warm,
}: {
  playerIdx: number;
  store: PlayerStore;
  /** What he plays in this match — a libero down to play in the six is no libero here. */
  role?: Position;
  /** Live match rating, if the player has played yet. */
  rating?: number;
  /** A substitute's warm-up: how warm he is, whether he is warming up, and the button to send him. */
  warm?: { level: number; warming: boolean; onToggle: () => void };
  selected: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onDropPlayer: (draggedPlayerIdx: number) => void;
  onDragOverCard: () => void;
  onDragLeaveCard: () => void;
}): JSX.Element {
  const pos = role ?? (store.position[playerIdx] as Position);
  return (
    <div
      className={`bench-token sub-token draggable${selected ? ' selected' : ''}${isDragOver ? ' drag-over' : ''}`}
      style={{ '--token-accent': POSITION_ACCENT[pos] } as CSSProperties}
      onClick={onClick}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(playerIdx))}
      onDragOver={(e) => { e.preventDefault(); onDragOverCard(); }}
      onDragLeave={onDragLeaveCard}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeaveCard();
        const dragged = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(dragged)) onDropPlayer(dragged);
      }}
    >
      <span className="bench-token-grip" aria-hidden="true">⋮⋮</span>
      <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={26} />
      <span className="bench-token-name">
        <span className="sub-name-line">
          {store.shortName(playerIdx)}
          {rating !== undefined && <RatingBadge value={rating} size="sm" />}
        </span>
        {warm !== undefined && (
          <span className={`sub-warm ${warm.level >= WARM_READY ? 'ready' : warm.warming ? 'warming' : 'cold'}`}>
            <span className="sub-warm-bar"><i style={{ width: `${Math.round(warm.level * 100)}%` }} /></span>
            <span className="sub-warm-text">{warm.level >= WARM_READY ? 'Ready' : warm.warming ? 'Warming up' : 'Cold'}</span>
            <button
              className="sm ghost sub-warm-btn"
              onClick={(e) => { e.stopPropagation(); warm.onToggle(); }}
              title={warm.warming ? 'Back to stand in the warm-up area' : 'Send him to warm up — on cold, he risks a strain'}
            >
              {warm.warming ? 'Stop' : 'Warm up'}
            </button>
          </span>
        )}
      </span>
      <Pos pos={pos} />
      <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
      <Bar value={store.condition[playerIdx]} />
    </div>
  );
}

/** One libero role in the substitutions panel: whoever holds it, as a drop target. */
function LiberoSlot({
  label, note, playerIdx, rating, store, isDragOver, onDropPlayer, onDragOver, onDragLeave, action,
}: {
  label: string;
  note: string;
  playerIdx: number;
  rating?: number;
  store: PlayerStore;
  isDragOver: boolean;
  onDropPlayer: (dragged: number) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div
      className={`libero-slot${isDragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDragLeave();
        const dragged = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(dragged)) onDropPlayer(dragged);
      }}
    >
      <div className="libero-slot-head">
        <span className="libero-slot-label">{label}</span>
        <span className="faint">{note}</span>
        {action}
      </div>
      {playerIdx >= 0 ? (
        <div className="bench-token libero-token" style={{ '--token-accent': 'var(--pos-l)' } as CSSProperties}>
          <PlayerFace playerId={store.id[playerIdx]} name={store.fullName(playerIdx)} size={26} />
          <span className="bench-token-name">
            {store.shortName(playerIdx)}
            {rating !== undefined && <RatingBadge value={rating} size="sm" />}
          </span>
          <Pos pos={store.position[playerIdx] as Position} />
          <span className="bench-token-ability">{store.currentAbility[playerIdx]}</span>
          <Bar value={store.condition[playerIdx]} />
        </div>
      ) : (
        <div className="libero-slot-empty">Drop a libero here</div>
      )}
    </div>
  );
}

function Substitutions({ teamIdx }: { teamIdx: 0 | 1 }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const md = g.matchday!;
  // Only the fourteen named for the match.
  const squad = g.matchSquadOf(teamIdx);
  const named = new Set(g.matchLiberosOf(teamIdx));
  const store = world.players;
  const [outPlayer, setOutPlayer] = useState<number | null>(null);
  const [inPlayer, setInPlayer] = useState<number | null>(null);
  const [dragOverPlayer, setDragOverPlayer] = useState<number | null>(null);

  const onCourt = (teamIdx === 0 ? md.snapshot?.homeCourt : md.snapshot?.awayCourt) ?? [];
  // The liberos named for the match are changed in their own section below —
  // they can never take an ordinary rotation spot, so they never appear on
  // this bench. A libero beyond the two is in the squad to play in the six.
  const bench = squad.filter((p) => !onCourt.includes(p) && g.matchAvailable(p) && !named.has(p));
  const ratings = g.liveRatings();
  const roles = g.liveRoles();
  const liberos = g.liveLiberos();
  const spareLiberos = squad.filter((p) =>
    named.has(p) && g.matchAvailable(p) && !onCourt.includes(p) && p !== liberos.reception && p !== liberos.defence);
  const [liberoDragOver, setLiberoDragOver] = useState<'reception' | 'defence' | null>(null);
  // Reads the engine's own per-set counter — it resets every set, unlike a
  // UI-tracked total would (that used to be the bug here: it never reset).
  const remaining = g.subsRemaining();
  // The warm-up is the user's own side's.
  const userSide = teamIdx === (md.userIsHome ? 0 : 1);
  const coldIn = inPlayer !== null && userSide && g.warmthOf(inPlayer) < WARM_READY;

  const makeSub = (): void => {
    if (outPlayer === null || inPlayer === null) return;
    g.substitute(outPlayer, inPlayer);
    setOutPlayer(null);
    setInPlayer(null);
  };

  // Dropping either card onto the other works the same regardless of which
  // one was dragged — whichever of the pair is on court is the one going off.
  const dropPair = (targetIdx: number, draggedIdx: number): void => {
    if (targetIdx === draggedIdx) return;
    const targetIsOnCourt = onCourt.includes(targetIdx);
    const draggedIsOnCourt = onCourt.includes(draggedIdx);
    if (targetIsOnCourt === draggedIsOnCourt) return; // need one of each
    g.substitute(targetIsOnCourt ? targetIdx : draggedIdx, targetIsOnCourt ? draggedIdx : targetIdx);
    setOutPlayer(null);
    setInPlayer(null);
  };

  const dragProps = (p: number): {
    isDragOver: boolean; onDropPlayer: (d: number) => void;
    onDragOverCard: () => void; onDragLeaveCard: () => void;
  } => ({
    isDragOver: dragOverPlayer === p,
    onDropPlayer: (dragged) => dropPair(p, dragged),
    onDragOverCard: () => setDragOverPlayer(p),
    onDragLeaveCard: () => setDragOverPlayer((cur) => (cur === p ? null : cur)),
  });

  return (
    <div className="subs">
      <div className="subs-scroll">
        <div className="subs-top">
          <span className={`count-chip${remaining <= 0 ? ' bad' : ''}`}>{remaining} left this set</span>
          <p className="field-hint">
            Drag a bench player onto someone on court, or pick both and confirm. A player who comes off can
            only return for whoever replaced them.
          </p>
        </div>

        <div className="sub-cols">
          <div className="sub-col">
            <div className="section-label">On court — pick who comes off</div>
            <div className="sub-list">
              {onCourt.map((p) => (
                <SubCard
                  key={p}
                  playerIdx={p}
                  store={store}
                  role={roles[p] as Position}
                  rating={ratings.get(p)}
                  selected={outPlayer === p}
                  onClick={() => setOutPlayer(outPlayer === p ? null : p)}
                  {...dragProps(p)}
                />
              ))}
            </div>
          </div>
          <div className="sub-col">
            <div className="section-label">Bench — pick who comes on</div>
            <div className="sub-list">
              {bench.length === 0 && <p className="empty">No fit players available.</p>}
              {bench.map((p) => (
                <SubCard
                  key={p}
                  playerIdx={p}
                  store={store}
                  role={roles[p] as Position}
                  rating={ratings.get(p)}
                  selected={inPlayer === p}
                  onClick={() => setInPlayer(inPlayer === p ? null : p)}
                  warm={userSide ? { level: g.warmthOf(p), warming: g.isWarming(p), onToggle: () => g.toggleWarmup(p) } : undefined}
                  {...dragProps(p)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="libero-panel">
          <div className="section-label">Liberos — changes are unlimited and never use a substitution</div>
          <div className="libero-slots">
            <LiberoSlot
              label={liberos.defence >= 0 ? 'Reception libero' : 'Libero'}
              note={liberos.defence >= 0 ? 'on court while you receive' : 'plays every back-row rally'}
              playerIdx={liberos.reception}
              rating={ratings.get(liberos.reception)}
              store={store}
              isDragOver={liberoDragOver === 'reception'}
              onDragOver={() => setLiberoDragOver('reception')}
              onDragLeave={() => setLiberoDragOver((c) => (c === 'reception' ? null : c))}
              onDropPlayer={(d) => g.changeLibero('reception', d)}
              action={liberos.defence >= 0 ? (
                <button className="sm ghost" onClick={() => g.changeLibero('reception', liberos.defence)}>
                  <Icon name="swap" size={13} /> Swap roles
                </button>
              ) : undefined}
            />
            <LiberoSlot
              label="Defensive libero"
              note="on court while you serve"
              playerIdx={liberos.defence}
              rating={ratings.get(liberos.defence)}
              store={store}
              isDragOver={liberoDragOver === 'defence'}
              onDragOver={() => setLiberoDragOver('defence')}
              onDragLeave={() => setLiberoDragOver((c) => (c === 'defence' ? null : c))}
              onDropPlayer={(d) => g.changeLibero('defence', d)}
              action={liberos.defence >= 0 ? (
                <button className="sm ghost" onClick={() => g.changeLibero('defence', -1)}>Remove</button>
              ) : undefined}
            />
          </div>
          {spareLiberos.length > 0 ? (
            <div className="libero-spares">
              {spareLiberos.map((p) => (
                <div
                  key={p}
                  className="bench-token libero-token draggable"
                  style={{ '--token-accent': 'var(--pos-l)' } as CSSProperties}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p))}
                >
                  <span className="bench-token-grip" aria-hidden="true">⋮⋮</span>
                  <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={26} />
                  <span className="bench-token-name">{store.shortName(p)}</span>
                  <span className="bench-token-ability">{store.currentAbility[p]}</span>
                  <span className="libero-spare-actions">
                    <button className="sm" onClick={() => g.changeLibero('reception', p)}>Reception</button>
                    <button className="sm" onClick={() => g.changeLibero('defence', p)}>Defence</button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="field-hint">No other libero available on the bench.</p>
          )}
        </div>
      </div>

      <div className="sub-confirm">
        <span className="sub-summary">
          {outPlayer !== null
            ? <><span className="bad">▼ {store.shortName(outPlayer)}</span> off</>
            : <span className="faint">Pick who comes off</span>}
          <span className="faint">·</span>
          {inPlayer !== null
            ? <><span className="good">▲ {store.shortName(inPlayer)}</span> on</>
            : <span className="faint">Pick who comes on</span>}
          {coldIn && <span className="sub-cold-warning"><Icon name="alert" size={13} /> Not warmed up — he risks a strain</span>}
        </span>
        <button
          className="primary"
          disabled={outPlayer === null || inPlayer === null || remaining <= 0}
          onClick={makeSub}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
