/**
 * The inbox's plainer messages, given something to look at: a body laid out
 * as paragraphs, lists and quotes, and — for the kinds that carry no report of
 * their own — a sheet drawn from the game as it stands: the board's mood and
 * target, a cup run, the transfer window, the books, the friendlies, contracts
 * running out, an achievement, the club or the member of staff a message is about.
 */

import type { JSX, ReactNode } from 'react';
import { compareTableRows } from '../engine/model/club.ts';
import { STAFF_ROLE_NAMES } from '../engine/model/staff.ts';
import { POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import { cupProgress, isCupCompetition, stageLabel } from '../engine/season/cups.ts';
import { isFriendly } from '../engine/season/friendlies.ts';
import { achievementList } from '../engine/world/achievements.ts';
import { boardMood } from '../engine/world/career.ts';
import { ordinal } from '../engine/world/inbox.ts';
import { contractEndSeason, type GameMessage, type World } from '../engine/world/world.ts';
import { ClubCrest, money, StarMeter } from './components.tsx';
import { Icon } from './icons.tsx';
import { useGame } from './state.ts';

// ---- The body ---------------------------------------------------------------------------

/** A line that reads as a bullet. */
const BULLET = /^\s*(?:[•·\-–*]|\d+[.)])\s+/;
/** "Label: value", short enough to be a row of a report. */
const ROW = /^([A-Z][^:\n]{1,30}):\s+(.{1,80})$/;

/**
 * A message's text, laid out: paragraphs split on blank lines, bulleted lines
 * as a list, runs of "Label: value" lines as a report, a paragraph that is all
 * one quotation as a pull quote, and a line on its own that ends in a colon
 * — or is short and has no full stop — as a heading.
 */
export function RichBody({ text }: { text: string }): JSX.Element {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  const out: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // A heading: a short line on its own over the lines that follow.
      if (i === 0 && lines.length > 1 && line.length <= 40 && !/[.!?]$/.test(line) && !BULLET.test(line) && !ROW.test(line)) {
        out.push(<h4 key={`${bi}-${i}`} className="rb-head">{line.replace(/:$/, '')}</h4>);
        i++;
        continue;
      }
      if (BULLET.test(line)) {
        const items: string[] = [];
        while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ''));
        out.push(<ul key={`${bi}-${i}`} className="rb-list">{items.map((t, k) => <li key={k}>{t}</li>)}</ul>);
        continue;
      }
      if (ROW.test(line) && i + 1 < lines.length && ROW.test(lines[i + 1])) {
        const rows: Array<[string, string]> = [];
        while (i < lines.length && ROW.test(lines[i])) {
          const m = ROW.exec(lines[i++])!;
          rows.push([m[1], m[2]]);
        }
        out.push(
          <div key={`${bi}-${i}`} className="paper-report rb-rows">
            {rows.map(([k, v]) => <div key={k} className="paper-report-row"><span>{k}</span><b>{v}</b></div>)}
          </div>,
        );
        continue;
      }
      // The rest of the block, up to the next list or report, is one paragraph.
      const para: string[] = [];
      while (i < lines.length && !BULLET.test(lines[i]) && !(ROW.test(lines[i]) && i + 1 < lines.length && ROW.test(lines[i + 1]))) para.push(lines[i++]);
      const joined = para.join(' ');
      const quote = /^["“].*["”]$/.test(joined);
      out.push(quote
        ? <blockquote key={`${bi}-${i}`} className="rb-quote">{joined.replace(/^["“]|["”]$/g, '')}</blockquote>
        : <p key={`${bi}-${i}`} className="rb-p">{joined}</p>);
    }
  });
  return <div className="paper-text rb">{out}</div>;
}

// ---- Pieces -----------------------------------------------------------------------------

function Sheet({ label, icon, children, aside }: { label: string; icon?: Parameters<typeof Icon>[0]['name']; children: ReactNode; aside?: ReactNode }): JSX.Element {
  return (
    <section className="paper-report ibx-sheet">
      <div className="paper-label ibx-sheet-label">
        <span>{icon !== undefined && <Icon name={icon} size={13} />} {label}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ k, children, tone }: { k: string; children: ReactNode; tone?: 'good' | 'bad' }): JSX.Element {
  return <div className="paper-report-row"><span>{k}</span><b className={tone ?? ''}>{children}</b></div>;
}

/** A big number with its label beneath — a row of these heads a sheet. */
function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'warn' }): JSX.Element {
  return (
    <div className={`ibx-fig${tone !== undefined ? ` ${tone}` : ''}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** A 0-100 meter on the paper, with its reading. */
function Meter({ value, label }: { value: number; label: string }): JSX.Element {
  const tone = value >= 60 ? 'good' : value >= 40 ? 'mid' : 'bad';
  return (
    <div className="ibx-meter" title={`${Math.round(value)} / 100`}>
      <span className="ibx-meter-track"><span className={tone} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></span>
      <b className={tone}>{label}</b>
    </div>
  );
}

/** Where a club stands in its league: the place, of how many, and the points. */
function leagueStanding(world: World, clubId: number): { pos: number; of: number; played: number; won: number; lost: number; points: number; compId: number } | null {
  const comp = world.competitions.find((c) => c.kind === 'league' && c.table.some((r) => r.clubId === clubId));
  if (comp === undefined) return null;
  const rows = [...comp.table].sort(compareTableRows);
  const at = rows.findIndex((r) => r.clubId === clubId);
  const r = rows[at];
  return { pos: at + 1, of: rows.length, played: r.played, won: r.won, lost: r.lost, points: r.points, compId: comp.id };
}

/** A club's last few results, oldest first: W or L. */
function formOf(world: World, clubId: number, n = 5): Array<{ won: boolean; title: string }> {
  return world.fixtures
    .filter((f) => f.played && (f.home === clubId || f.away === clubId) && !isFriendly(world, f))
    .sort((a, b) => a.day - b.day)
    .slice(-n)
    .map((f) => {
      const home = f.home === clubId;
      const won = home ? f.homeSets > f.awaySets : f.awaySets > f.homeSets;
      const opp = world.clubs[home ? f.away : f.home];
      return { won, title: `${won ? 'W' : 'L'} ${home ? f.homeSets : f.awaySets}–${home ? f.awaySets : f.homeSets} ${home ? 'v' : 'at'} ${opp?.name ?? '—'}` };
    });
}

function Form({ world, clubId }: { world: World; clubId: number }): JSX.Element {
  const form = formOf(world, clubId);
  if (form.length === 0) return <span className="paper-muted">No games yet</span>;
  return <span className="ibx-form">{form.map((r, i) => <i key={i} className={r.won ? 'w' : 'l'} title={r.title}>{r.won ? 'W' : 'L'}</i>)}</span>;
}

// ---- Sheets -----------------------------------------------------------------------------

/** The board: how it feels about the manager, the target against where the club is, the money. */
function BoardSheet({ world, clubId }: { world: World; clubId: number }): JSX.Element | null {
  const g = useGame();
  const club = world.clubs[clubId];
  if (club === undefined) return null;
  const st = leagueStanding(world, clubId);
  const onTarget = st !== null && st.played > 0 ? st.pos <= club.boardExpectation : null;
  return (
    <Sheet label="Where you stand with the board" icon="board">
      <div className="ibx-board">
        <div>
          <span className="paper-muted">Board confidence</span>
          <Meter value={club.boardConfidence} label={boardMood(club.boardConfidence)} />
        </div>
        <div className="ibx-figs">
          <Figure label="Target" value={club.boardExpectation === 1 ? 'Win it' : `${ordinal(club.boardExpectation)}+`} />
          <Figure
            label={st !== null ? `Now · of ${st.of}` : 'Now'}
            value={st !== null && st.played > 0 ? ordinal(st.pos) : '—'}
            tone={onTarget === null ? undefined : onTarget ? 'good' : 'bad'}
          />
          <Figure label="Balance" value={money(club.finances.balance)} tone={club.finances.balance < 0 ? 'bad' : undefined} />
        </div>
      </div>
      {st !== null && st.played > 0 && <Row k="League record">{st.won}W {st.lost}L · {st.points} pts</Row>}
      <Row k="Recent form"><Form world={world} clubId={clubId} /></Row>
      {g.club !== null && g.club.id === clubId && <Row k="Head coach since">{g.dateLabelForDay(club.coachSince)}</Row>}
    </Sheet>
  );
}

/** A cup: the club's way through it, round by round, and where it stands now. */
function CupSheet({ world, compId, clubId }: { world: World; compId: number; clubId: number }): JSX.Element | null {
  const g = useGame();
  const comp = world.competitions[compId];
  if (comp === undefined) return null;
  const games = world.fixtures.filter((f) => f.competitionId === compId && (f.home === clubId || f.away === clubId)).sort((a, b) => a.day - b.day);
  const progress = cupProgress(comp, clubId);
  if (games.length === 0 && progress === null) return null;
  const tone = progress === null ? '' : progress.champion ? 'good' : progress.alive ? '' : 'bad';
  return (
    <Sheet
      label={`Your ${comp.name} run`}
      icon="trophy"
      aside={progress !== null && <span className={`ibx-pill ${tone}`}>{progress.champion ? 'Winners' : progress.alive ? `Still in · ${progress.stage}` : `Out · ${progress.stage}`}</span>}
    >
      <div className="ibx-cup">
        {games.map((f) => {
          const home = f.home === clubId;
          const opp = world.clubs[home ? f.away : f.home];
          const won = f.played ? (home ? f.homeSets > f.awaySets : f.awaySets > f.homeSets) : null;
          return (
            <div key={f.id} className={`ibx-cup-row${won === null ? ' next' : won ? ' won' : ' lost'}`}>
              <span className="ibx-cup-stage">{stageLabel(world, f)}</span>
              <span className="ibx-cup-opp">
                {opp !== undefined && <ClubCrest club={opp} size={20} />}
                <span>{home ? 'v' : 'at'} {opp?.name ?? '—'}</span>
              </span>
              <b className="ibx-cup-score">
                {f.played ? `${home ? f.homeSets : f.awaySets}–${home ? f.awaySets : f.homeSets}` : g.dateLabelForDay(f.day)}
              </b>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** The transfer window: open or shut and till when, the money to spend, and this season's moves in and out. */
function WindowSheet({ world, clubId }: { world: World; clubId: number }): JSX.Element | null {
  const g = useGame();
  const club = world.clubs[clubId];
  if (club === undefined) return null;
  const w = g.transferWindowStatus();
  const moves = world.transferLog.filter((t) => t.season === world.season && (t.toClub === clubId || t.fromClub === clubId));
  const store = world.players;
  const bill = g.wageBill();
  return (
    <Sheet
      label="The transfer window"
      icon="transfers"
      aside={<span className={`ibx-pill ${w.open ? 'good' : ''}`}>{w.label} {w.open ? `open till ${g.dateLabelForDay(w.untilDay)}` : `opens ${g.dateLabelForDay(w.untilDay)}`}</span>}
    >
      <div className="ibx-figs">
        <Figure label="Transfer budget" value={money(club.finances.transferBudget)} />
        <Figure label={`Wage bill · of ${money(club.finances.wageBudget)}`} value={money(bill)} tone={bill > club.finances.wageBudget ? 'bad' : undefined} />
        <Figure label="Squad" value={`${club.players.length}`} />
      </div>
      {moves.length > 0 && (
        <div className="ibx-moves">
          {moves.map((t, i) => {
            const incoming = t.toClub === clubId;
            const other = world.clubs[incoming ? t.fromClub : t.toClub];
            return (
              <div key={i} className={`ibx-move ${incoming ? 'in' : 'out'}`}>
                <span className="ibx-move-dir">{incoming ? 'IN' : 'OUT'}</span>
                <span className="player-link" onClick={() => g.select(t.playerIdx)}>{store.fullName(t.playerIdx)}</span>
                <span className="paper-muted">{POSITION_SHORT[store.position[t.playerIdx] as Position]} · {incoming ? 'from' : 'to'} {other?.name ?? (incoming ? 'free agency' : 'released')}</span>
                <b>{t.fee > 0 ? money(t.fee) : 'Free'}</b>
              </div>
            );
          })}
        </div>
      )}
      {moves.length === 0 && <p className="paper-muted ibx-none">No moves in or out yet this season.</p>}
    </Sheet>
  );
}

/** The money: cash, the budgets, the wage bill against its limit, the season's sponsorship. */
function FinanceSheet({ world, clubId }: { world: World; clubId: number }): JSX.Element | null {
  const g = useGame();
  const club = world.clubs[clubId];
  if (club === undefined) return null;
  const f = club.finances;
  const bill = g.wageBill();
  return (
    <Sheet label="The club's money" icon="finances">
      <div className="ibx-figs">
        <Figure label="Balance" value={money(f.balance)} tone={f.balance < 0 ? 'bad' : 'good'} />
        <Figure label="Transfer budget" value={money(f.transferBudget)} />
        <Figure label="Sponsorship / season" value={money(f.sponsorshipIncome)} />
      </div>
      <div className="ibx-wage">
        <span className="paper-muted">Wage bill {money(bill)} of {money(f.wageBudget)}</span>
        <span className="ibx-meter-track"><span className={bill > f.wageBudget ? 'bad' : 'good'} style={{ width: `${Math.min(100, (bill / Math.max(1, f.wageBudget)) * 100)}%` }} /></span>
      </div>
    </Sheet>
  );
}

/** The friendlies arranged from the message's day on: played, with the score, or still to come. */
function FriendliesSheet({ world, clubId, from }: { world: World; clubId: number; from: number }): JSX.Element | null {
  const g = useGame();
  const games = world.fixtures
    .filter((f) => (f.home === clubId || f.away === clubId) && isFriendly(world, f) && f.day >= from - 1)
    .sort((a, b) => a.day - b.day);
  if (games.length === 0) return null;
  return (
    <Sheet label="Friendlies on the calendar" icon="calendar">
      <div className="ibx-cup">
        {games.map((f) => {
          const home = f.home === clubId;
          const opp = world.clubs[home ? f.away : f.home];
          return (
            <div key={f.id} className={`ibx-cup-row${!f.played ? ' next' : (home ? f.homeSets > f.awaySets : f.awaySets > f.homeSets) ? ' won' : ' lost'}`}>
              <span className="ibx-cup-stage">{g.dateLabelForDay(f.day)}</span>
              <span className="ibx-cup-opp">{opp !== undefined && <ClubCrest club={opp} size={20} />}<span>{home ? 'v' : 'at'} {opp?.name ?? '—'}</span></span>
              <b className="ibx-cup-score">{f.played ? `${home ? f.homeSets : f.awaySets}–${home ? f.awaySets : f.homeSets}` : home ? 'Home' : 'Away'}</b>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Contracts that end this season: the staff's, or the players'. */
function ExpiringSheet({ world, clubId, staff }: { world: World; clubId: number; staff: boolean }): JSX.Element | null {
  const g = useGame();
  const club = world.clubs[clubId];
  if (club === undefined) return null;
  const year = world.startYear + world.season + 1;
  if (staff) {
    const list = world.staff.filter((s) => s.clubId === clubId && contractEndSeason(s.contractUntil) <= world.season);
    if (list.length === 0) return null;
    return (
      <Sheet label={`Contracts ending 30 June ${year}`} icon="contract">
        {list.map((s) => (
          <Row key={s.id} k={`${s.firstName} ${s.lastName} · ${STAFF_ROLE_NAMES[s.role]}`}>{money(s.wage)} a season</Row>
        ))}
      </Sheet>
    );
  }
  const store = world.players;
  const list = club.players.filter((p) => contractEndSeason(store.contractUntil[p]) <= world.season);
  if (list.length === 0) return null;
  return (
    <Sheet label={`Contracts ending 30 June ${year}`} icon="contract">
      {list.map((p) => (
        <div key={p} className="paper-report-row">
          <span><span className="player-link" onClick={() => g.select(p)}>{store.fullName(p)}</span> · {POSITION_SHORT[store.position[p] as Position]}, {store.ageOn(p, world.year, 181)}</span>
          <b>{money(store.wage[p])}</b>
        </div>
      ))}
    </Sheet>
  );
}

/** An achievement: its badge, what it took, and how many of them are in. */
function AchievementSheet({ world, title }: { world: World; title: string }): JSX.Element | null {
  const list = achievementList(world);
  const a = list.find((x) => x.title === title);
  if (a === undefined) return null;
  const got = list.filter((x) => x.day !== null).length;
  return (
    <Sheet label="Achievement unlocked" icon="trophy">
      <div className="ibx-ach">
        <span className="ibx-ach-badge"><Icon name="star" size={30} /></span>
        <div>
          <strong>{a.title}</strong>
          <span className="paper-muted">{a.hint} · {a.group}</span>
        </div>
      </div>
      <div className="ibx-wage">
        <span className="paper-muted">{got} of {list.length} achievements</span>
        <span className="ibx-meter-track"><span className="good" style={{ width: `${(got / list.length) * 100}%` }} /></span>
      </div>
    </Sheet>
  );
}

/** The squad as the staff see it today: who is fit, how fresh and how happy, who is out, and the next game. */
function SquadPulseSheet({ world, clubId }: { world: World; clubId: number }): JSX.Element | null {
  const g = useGame();
  const club = world.clubs[clubId];
  if (club === undefined || club.players.length === 0) return null;
  const store = world.players;
  const squad = club.players;
  const fit = squad.filter((p) => store.isAvailable(p)).length;
  const cond = Math.round(squad.reduce((n, p) => n + store.condition[p], 0) / squad.length);
  const morale = Math.round(squad.reduce((n, p) => n + store.morale[p], 0) / squad.length);
  const out = squad.filter((p) => store.injuryDaysLeft[p] > 0).sort((a, b) => store.injuryDaysLeft[b] - store.injuryDaysLeft[a]);
  const next = world.fixtures
    .filter((f) => !f.played && f.day >= world.day && (f.home === clubId || f.away === clubId))
    .sort((a, b) => a.day - b.day)[0];
  const opp = next !== undefined ? world.clubs[next.home === clubId ? next.away : next.home] : undefined;
  return (
    <Sheet label="The squad today" icon="squad">
      <div className="ibx-figs">
        <Figure label={`Fit to play · of ${squad.length}`} value={fit} tone={fit < 8 ? 'bad' : undefined} />
        <Figure label="Average condition" value={`${cond}%`} tone={cond < 70 ? 'bad' : undefined} />
        <Figure label="Average morale" value={`${morale}`} tone={morale >= 65 ? 'good' : morale < 40 ? 'bad' : undefined} />
      </div>
      {out.length > 0 && (
        <Row k="Injured">
          {out.slice(0, 4).map((p, i) => (
            <span key={p}>{i > 0 && ', '}<span className="player-link" onClick={() => g.select(p)}>{store.shortName(p)}</span> ({store.injuryDaysLeft[p]}d)</span>
          ))}
          {out.length > 4 && ` +${out.length - 4}`}
        </Row>
      )}
      {next !== undefined && opp !== undefined && (
        <div className="paper-report-row">
          <span>Next match</span>
          <b className="ibx-next">
            <ClubCrest club={opp} size={18} /> {next.home === clubId ? 'v' : 'at'} {opp.name} · {g.dateLabelForDay(next.day)}
            {next.day > world.day && <span className="paper-muted"> · in {next.day - world.day} days</span>}
          </b>
        </div>
      )}
    </Sheet>
  );
}

/** Another club: its crest, its league place, its form and its standing. */
function ClubSheet({ world, clubId }: { world: World; clubId: number }): JSX.Element | null {
  const g = useGame();
  const club = world.clubs[clubId];
  if (club === undefined) return null;
  const st = leagueStanding(world, clubId);
  return (
    <Sheet label="About the club" icon="club">
      <div className="ibx-club">
        <ClubCrest club={club} size={46} />
        <div className="ibx-club-id">
          <strong className="player-link" onClick={() => g.selectClub(club.id)}>{club.name}</strong>
          <span className="paper-muted">{world.competitions[club.leagueId]?.name ?? ''}</span>
        </div>
        <StarMeter value={club.reputation} max={10000} size={14} />
      </div>
      {st !== null && st.played > 0 && <Row k="League">{ordinal(st.pos)} of {st.of} · {st.won}W {st.lost}L</Row>}
      <Row k="Recent form"><Form world={world} clubId={clubId} /></Row>
      <Row k="Arena">{club.arenaName} · {club.arenaCapacity.toLocaleString()}</Row>
    </Sheet>
  );
}

/** A member of staff: who, what he does, how good, on what terms. */
function StaffSheet({ world, staffId }: { world: World; staffId: number }): JSX.Element | null {
  const s = world.staff.find((x) => x.id === staffId);
  if (s === undefined) return null;
  const club = s.clubId >= 0 ? world.clubs[s.clubId] : undefined;
  return (
    <Sheet label="About him" icon="staff">
      <div className="ibx-club">
        <span className="ibx-initials">{s.firstName[0]}{s.lastName[0]}</span>
        <div className="ibx-club-id">
          <strong>{s.firstName} {s.lastName}</strong>
          <span className="paper-muted">{STAFF_ROLE_NAMES[s.role]}{club !== undefined ? ` · ${club.name}` : ' · out of work'}</span>
        </div>
        <StarMeter value={s.reputation} max={10000} size={14} />
      </div>
      <Row k="Wage">{money(s.wage)} a season</Row>
      <Row k="Contract until">30 June {world.startYear + contractEndSeason(s.contractUntil) + 1}</Row>
    </Sheet>
  );
}

/** The competition a message names in its subject, for messages from before they carried one. */
function competitionNamed(world: World, subject: string): number | undefined {
  return world.competitions.find((c) => isCupCompetition(c) && subject.startsWith(`${c.name}:`))?.id;
}

/**
 * The sheet for a message that has no report of its own, chosen from what it
 * is about — or null, when the text is all there is to it.
 */
export function ContextSheet({ message: m }: { message: GameMessage }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const me = world.userClubId;
  const s = m.subject;
  const compId = m.competitionId ?? competitionNamed(world, s);
  if (compId !== undefined && world.competitions[compId] !== undefined && isCupCompetition(world.competitions[compId]) && me >= 0) {
    const cup = <CupSheet world={world} compId={compId} clubId={me} />;
    return m.clubId !== undefined && m.clubId !== me ? <>{cup}<ClubSheet world={world} clubId={m.clubId} /></> : cup;
  }
  if (s.startsWith('Achievement: ')) return <AchievementSheet world={world} title={s.slice('Achievement: '.length)} />;
  if (me < 0) return m.clubId !== undefined ? <ClubSheet world={world} clubId={m.clubId} /> : null;
  if (/transfer window|deadline day/i.test(s)) return <WindowSheet world={world} clubId={me} />;
  if (/friendl|invitation/i.test(s)) {
    return <>{m.clubId !== undefined && m.clubId !== me && <ClubSheet world={world} clubId={m.clubId} />}<FriendliesSheet world={world} clubId={me} from={m.day} /></>;
  }
  if (/staff contracts/i.test(s)) return <ExpiringSheet world={world} clubId={me} staff />;
  if (/^contracts running out/i.test(s)) return <ExpiringSheet world={world} clubId={me} staff={false} />;
  if (m.category === 'board') return <BoardSheet world={world} clubId={me} />;
  if (m.category === 'finance') return <FinanceSheet world={world} clubId={me} />;
  if (m.staffId !== undefined) return <StaffSheet world={world} staffId={m.staffId} />;
  if (m.category === 'staff' && m.playerIdx === undefined) return <SquadPulseSheet world={world} clubId={me} />;
  if (m.clubId !== undefined && m.clubId !== me && m.playerIdx === undefined) return <ClubSheet world={world} clubId={m.clubId} />;
  return null;
}

