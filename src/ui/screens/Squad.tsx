import { useState, type JSX } from 'react';
import { feeText, youthRound, youthRoundDay, youthTable, type YouthLeague } from '../../engine/world/youth.ts';
import { Dropdown } from '../dropdown.tsx';
import {
  ATTR_LABELS, HIDDEN_ATTR_SET, MENTAL_ATTRS, PHYSICAL_ATTRS, TECHNICAL_ATTRS,
  type AttributeName,
} from '../../engine/model/attributes.ts';
import {
  POSITION_NAMES, POSITIONS, familiarityLabel, Position,
} from '../../engine/model/positions.ts';
import { PlayerFlag, type PlayerStore } from '../../engine/model/players.ts';
import { NATIONS } from '../../engine/world/nations.ts';
import { secondNation, tiedNation } from '../../engine/world/internationals.ts';
import { canRecall, coachTalkBlock, PLAYING_TIME_NAMES } from '../../engine/world/loans.ts';
import { averageRating, seasonRecords, seasonTotals } from '../../engine/world/records.ts';
import { contractEndSeason, type World } from '../../engine/world/world.ts';
import {
  abilityClass, attrClass, Bar, Card, ClubCrest, ClubLink, Empty, Flag, KV, money, Morale, PlayerFace, Pos,
  RatingBadge, Segmented, SortTh, StarMeter, StatTile, Status, sortBy, useDismiss, useSort,
} from '../components.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { useGame } from '../state.ts';

type SquadSort =
  | 'name' | 'pos' | 'age' | 'height' | 'spike' | 'block' | 'ability' | 'potential'
  | 'condition' | 'morale' | 'wage' | 'contract' | 'apps' | 'rating';

/** "2026/27" for a 0-based season index. */
export function seasonLabel(world: World, season: number): string {
  const y = world.startYear + season;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

const POSITION_FILTERS: ReadonlyArray<readonly [number, string]> = [
  [-1, 'All'],
  ...POSITIONS.map((p) => [p, `${POSITION_NAMES[p]}s`] as const),
];

export function SquadScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const club = g.club!;
  const store = world.players;
  const squad = g.squad();
  const selection = g.lineup();
  const starters = new Set(selection?.lineup ?? []);
  const libero = selection?.libero ?? -1;
  const defensiveLibero = selection?.defensiveLibero ?? -1;
  // Listed after the squad, greyed out: our players out on loan, who are still
  // ours, and players who have agreed to join and are waiting on the window.
  const away = g.loanedOut();
  const awayAt = new Map(away.map((l) => [l.playerIdx, l]));
  const arriving = g.arrivals();
  const arrivingAt = new Map(arriving.map((m) => [m.playerIdx, m]));
  const borrowed = new Set(squad.filter((p) => g.loanOf(p) !== null));
  const totals = new Map([...squad, ...awayAt.keys(), ...arrivingAt.keys()].map((p) => [p, seasonTotals(world, p)]));
  const avgRating = (p: number): number => averageRating(totals.get(p)!);
  const [posFilter, setPosFilter] = useState(-1);
  const [sort, onSort] = useSort<SquadSort>('ability');

  if (squad.length === 0) return <Empty>No players under contract.</Empty>;

  const age = (p: number): number => store.ageOn(p, world.year, 181);
  const wageBill = g.wageBill();
  const squadSize = g.squadSize();
  const avgAbility = Math.round(squad.reduce((s, p) => s + store.currentAbility[p], 0) / squad.length);
  const avgAge = squad.reduce((s, p) => s + age(p), 0) / squad.length;
  const injured = squad.filter((p) => store.injuryDaysLeft[p] > 0).length;
  const endsThisSeason = (p: number): boolean => contractEndSeason(store.contractUntil[p]) <= world.season;
  // Anyone here on loan is under contract to his own club.
  const expiring = [...squad, ...awayAt.keys()].filter((p) => !borrowed.has(p) && endsThisSeason(p)).length;

  const byPos = (list: number[]): number[] => (posFilter < 0 ? list : list.filter((p) => store.position[p] === posFilter));
  const sorter = (p: number, k: SquadSort): number | string => {
    switch (k) {
      case 'name': return store.fullName(p);
      case 'pos': return store.position[p];
      case 'age': return age(p);
      case 'height': return store.heightCm[p];
      case 'spike': return store.spikeReachCm[p];
      case 'block': return store.blockReachCm[p];
      case 'potential': return store.potentialAbility[p];
      case 'condition': return store.condition[p];
      case 'morale': return store.morale[p];
      case 'wage': return store.wage[p];
      case 'contract': return store.contractUntil[p];
      case 'apps': return totals.get(p)!.apps;
      case 'rating': return avgRating(p);
      default: return store.currentAbility[p];
    }
  };
  const rows = sortBy(byPos(squad), sort, sorter);
  const awayRows = sortBy(byPos([...arrivingAt.keys(), ...awayAt.keys()]), sort, sorter);

  return (
    <>
      <div className="tiles">
        <StatTile
          label="Squad size"
          value={`${squadSize}/16`}
          sub={[
            arriving.length > 0 ? `${arriving.length} arriving` : '',
            away.length > 0 ? `${away.length} out on loan` : '',
            `${16 - squadSize} ${away.length + arriving.length > 0 ? 'free' : 'places free'}`,
          ].filter((s) => s !== '').join(' · ')}
        />
        <StatTile label="Average age" value={avgAge.toFixed(1)} sub="years" />
        <StatTile
          label="Average ability"
          value={<span className={abilityClass(avgAbility)}>{avgAbility}</span>}
          sub={<StarMeter value={avgAbility} size={12} />}
        />
        <StatTile
          label="Wage bill"
          value={money(wageBill)}
          sub={`of ${money(club.finances.wageBudget)} budget`}
          tone={wageBill > club.finances.wageBudget ? 'bad' : undefined}
        />
        <StatTile
          label="Unavailable"
          value={injured}
          sub={injured === 1 ? 'player injured' : 'players injured'}
          tone={injured > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Expiring contracts"
          value={expiring}
          sub={`end on 30 Jun ${world.startYear + world.season + 1}`}
          tone={expiring > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card
        title="Players"
        icon="squad"
        flush
        actions={<Segmented size="sm" options={POSITION_FILTERS} value={posFilter} onChange={setPosFilter} />}
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <SortTh k="name" sort={sort} onSort={onSort}>Name</SortTh>
                <SortTh k="pos" sort={sort} onSort={onSort}>Pos</SortTh>
                <SortTh k="age" sort={sort} onSort={onSort} num>Age</SortTh>
                <th>Nat</th>
                <SortTh k="height" sort={sort} onSort={onSort} num title="Height (cm)">Ht</SortTh>
                <SortTh k="spike" sort={sort} onSort={onSort} num title="Spike reach (cm)">Spike</SortTh>
                <SortTh k="block" sort={sort} onSort={onSort} num title="Block reach (cm)">Block</SortTh>
                <SortTh k="ability" sort={sort} onSort={onSort}>Ability</SortTh>
                <SortTh k="potential" sort={sort} onSort={onSort} num>Potential</SortTh>
                <SortTh k="condition" sort={sort} onSort={onSort}>Condition</SortTh>
                <SortTh k="morale" sort={sort} onSort={onSort}>Morale</SortTh>
                <th>Status</th>
                <SortTh k="apps" sort={sort} onSort={onSort} num title="Appearances this season">Apps</SortTh>
                <SortTh k="rating" sort={sort} onSort={onSort} num title="Average match rating this season">Av Rat</SortTh>
                <SortTh k="wage" sort={sort} onSort={onSort} num>Wage</SortTh>
                <SortTh k="contract" sort={sort} onSort={onSort} num title="Contract ends on 30 June of">Contract</SortTh>
              </tr>
            </thead>
            <tbody>
              {[...rows, ...awayRows].map((p) => {
                const out = awayAt.get(p);
                const incoming = arrivingAt.get(p);
                return (
                  <tr
                    key={p}
                    className={`clickable${out !== undefined || incoming !== undefined ? ' row-away' : ''}`}
                    onClick={() => g.select(p)}
                  >
                    <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                    <td>
                      <span className="name-cell">
                        <span className="strong">{store.fullName(p)}</span>
                        {starters.has(p) && <span className="role-tag starter" title="In the starting six">XI</span>}
                        {p === libero && (
                          <span className="role-tag libero" title={defensiveLibero >= 0 ? 'Reception libero' : 'Starting libero'}>L</span>
                        )}
                        {p === defensiveLibero && <span className="role-tag libero" title="Defensive libero">DL</span>}
                        <MarketTags p={p} borrowed={borrowed.has(p)} />
                      </span>
                    </td>
                    <td><Pos pos={store.position[p] as Position} /></td>
                    <td className="num">{age(p)}</td>
                    <td><Flag nation={store.nation[p]} /></td>
                    <td className="num dim">{store.heightCm[p]}</td>
                    <td className="num dim">{store.spikeReachCm[p]}</td>
                    <td className="num dim">{store.blockReachCm[p]}</td>
                    <td>
                      <span className="ability-cell">
                        <StarMeter value={store.currentAbility[p]} size={11} />
                        <span className={abilityClass(store.currentAbility[p])}>{store.currentAbility[p]}</span>
                      </span>
                    </td>
                    <td className={`num ${abilityClass(store.potentialAbility[p])}`}>{store.potentialAbility[p]}</td>
                    <td><span className="cond-cell"><Bar value={store.condition[p]} /><span className="dim">{store.condition[p]}%</span></span></td>
                    <td><Morale value={store.morale[p]} /></td>
                    <td>
                      {out !== undefined
                        ? (
                          <span className="status-tag status-loan" title={`Back ${g.dateLabelForDay(out.endsOn)}`}>
                            On loan · {world.clubs[out.loanClubId]?.shortName ?? '—'}
                          </span>
                        )
                        : incoming !== undefined
                          ? (
                            <span className="status-tag status-loan" title="Agreed to join — he arrives when the window opens">
                              Joins {g.dateLabelForDay(incoming.movesOn)}
                            </span>
                          )
                          : <Status store={store} i={p} />}
                    </td>
                    <td className="num dim">{totals.get(p)!.apps}</td>
                    <td className="num"><RatingBadge value={avgRating(p)} size="sm" /></td>
                    <td className="num dim">{money(incoming?.kind === 'transfer' ? incoming.wage : store.wage[p])}</td>
                    {incoming !== undefined
                      ? (
                        <td className="num dim">
                          {incoming.kind === 'loan' ? 'Loan' : world.startYear + contractEndSeason(incoming.contractEnd) + 1}
                        </td>
                      )
                      : borrowed.has(p)
                        ? <td className="num dim" title="Under contract to his own club — here until the end of the season">Loan</td>
                        : (
                          <td
                            className={`num ${endsThisSeason(p) ? 'warn-text' : 'dim'}`}
                            title={endsThisSeason(p) ? 'Contract expires this season' : undefined}
                          >
                            {world.startYear + contractEndSeason(store.contractUntil[p]) + 1}
                          </td>
                        )}
                  </tr>
                );
              })}
              {rows.length + awayRows.length === 0 && (
                <tr><td colSpan={17}><Empty>No players in this position.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="legend">
        <span className="role-tag starter">XI</span> starting six
        <span className="role-tag libero">L</span> starting libero
        <span className="role-tag libero">DL</span> defensive libero
        <span className="role-tag loan">LOAN</span> here on loan
        <span className="role-tag leaving">OUT</span> leaving when the window opens
        <span className="role-tag listed">TL</span> transfer listed
        <span className="role-tag listed">LL</span> available for loan
        <span className="faint">· Click a column heading to sort, a player to open their profile.</span>
      </p>
    </>
  );
}

/** Axes of the attribute polygon: each one a volleyball skill rolled up from
 *  the raw attributes that feed it. Serving takes the player's best serve
 *  type rather than averaging all three — a float specialist isn't a weak
 *  server just because they never jump-serve. */
const RADAR_AXES: ReadonlyArray<readonly [string, (a: (n: AttributeName) => number) => number]> = [
  ['Serving', (a) => (Math.max(a('floatServe'), a('jumpServe'), a('powerServe')) + a('servingAccuracy') + a('servingPower')) / 3],
  ['Attacking', (a) => (a('spikeTechnique') * 2 + Math.max(a('quickAttack'), a('backRowAttack'), a('pipeAttack'))) / 3],
  ['Blocking', (a) => a('blocking')],
  ['Reception', (a) => (a('reception') * 2 + a('ballControl')) / 3],
  ['Defence', (a) => a('digging')],
  ['Setting', (a) => (a('setting') * 2 + a('ballControl')) / 3],
  ['Athleticism', (a) => (a('verticalJump') + a('acceleration') + a('agility')) / 3],
  ['Mentality', (a) => (a('composure') + a('concentration') + a('determination') + a('pressureHandling')) / 4],
];

/** The attribute polygon: one spoke per skill on the 1-20 scale. */
function AttributeRadar({ store, p }: { store: PlayerStore; p: number }): JSX.Element {
  const size = 280;
  const c = size / 2;
  const r = 92;
  const n = RADAR_AXES.length;
  const get = (name: AttributeName): number => store.getAttr(p, name);
  const values = RADAR_AXES.map(([, f]) => Math.max(1, Math.min(20, f(get))));
  const point = (i: number, v: number): [number, number] => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(angle) * r * (v / 20), c + Math.sin(angle) * r * (v / 20)];
  };
  const ring = (v: number): string => Array.from({ length: n }, (_, i) => point(i, v).join(',')).join(' ');
  const shape = values.map((v, i) => point(i, v).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar" role="img" aria-label="Attribute profile">
      {[5, 10, 15, 20].map((v) => <polygon key={v} points={ring(v)} className="radar-ring" />)}
      {RADAR_AXES.map((_, i) => {
        const [x, y] = point(i, 20);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="radar-spoke" />;
      })}
      <polygon points={shape} className="radar-shape" />
      {values.map((v, i) => {
        const [x, y] = point(i, v);
        return <circle key={i} cx={x} cy={y} r={2.6} className="radar-dot" />;
      })}
      {RADAR_AXES.map(([label], i) => {
        const [x, y] = point(i, 25.5);
        return (
          <text key={label} x={x} y={y} className="radar-label" textAnchor="middle" dominantBaseline="middle">
            {label}
            <tspan x={x} dy="12" className="radar-value">{values[i].toFixed(0)}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** The player profile's tabs — one screen each, the way FM splits a profile. */
type ProfileTab = 'overview' | 'stats' | 'details';
const PROFILE_TABS: ReadonlyArray<[ProfileTab, string, IconName]> = [
  ['overview', 'Overview', 'user'],
  ['stats', 'Statistics', 'stats'],
  ['details', 'Contract & Career', 'finances'],
];

/** How good a hand is, 1-20, in the words FM uses for a foot — and how many of the six pips it lights. */
const HAND_LEVELS: ReadonlyArray<[top: number, label: string]> = [
  [4, 'Very Weak'], [8, 'Weak'], [11, 'Reasonable'], [14, 'Fairly Strong'], [17, 'Strong'], [20, 'Very Strong'],
];

function handLevel(v: number): { label: string; pips: number } {
  const i = HAND_LEVELS.findIndex(([top]) => v <= top);
  const at = i < 0 ? HAND_LEVELS.length - 1 : i;
  return { label: HAND_LEVELS[at][1], pips: at + 1 };
}

/** His two arms: the one he hits with, and how well he can play with the other. */
function ArmsPanel({ store, p }: { store: PlayerStore; p: number }): JSX.Element {
  const lefty = store.hasFlag(p, PlayerFlag.LeftHanded);
  const off = store.offHand[p];
  const arms: Array<[string, number]> = [['Left Arm', lefty ? 20 : off], ['Right Arm', lefty ? off : 20]];
  return (
    <div className="arms">
      {arms.map(([name, v]) => {
        const { label, pips } = handLevel(v);
        return (
          <div key={name} className="arm" title={`${name}: ${label}`}>
            <span className="arm-name">{name}</span>
            <span className={`arm-box lvl-${pips}`}>
              {label}
              <span className="arm-pips">
                {HAND_LEVELS.map((_, i) => <i key={i} className={i < pips ? 'on' : ''} />)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** How comfortable a player is in a role, in the words a coach would use. */
/** The transfer actions on one of your own players: the transfer list, the loan list, and release. */
function TransferMenu({ p }: { p: number }): JSX.Element {
  const g = useGame();
  const store = g.world!.players;
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const listed = store.hasFlag(p, PlayerFlag.Transferable);
  const loanListed = store.hasFlag(p, PlayerFlag.LoanListed);
  const act = (f: () => void) => (): void => { setOpen(false); f(); };
  return (
    <div className="profile-menu" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="transfers" size={14} /> Transfer <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="menu-pop menu-pop-right">
          <button onClick={act(() => g.toggleTransferList(p))}>
            <Icon name="transfers" size={15} />
            <span className="menu-pop-stack">
              <span>{listed ? 'Remove from transfer list' : 'Add to transfer list'}</span>
              <span className="faint">{listed ? 'No more bids invited' : 'Other clubs are invited to bid'}</span>
            </span>
          </button>
          <button onClick={act(() => g.toggleLoanList(p))}>
            <Icon name="swap" size={15} />
            <span className="menu-pop-stack">
              <span>{loanListed ? 'Withdraw from loan list' : 'Offer out on loan'}</span>
              <span className="faint">{loanListed ? 'He stays at the club' : 'Clubs can borrow him until 30 June'}</span>
            </span>
          </button>
          <div className="menu-sep" />
          <button className="menu-danger" onClick={act(() => { g.releasePlayer(p); g.select(null); })}>
            <Icon name="close" size={15} /> Release
          </button>
        </div>
      )}
    </div>
  );
}

/** Short tags for where a player stands in the market: listed for transfer or loan, or here on loan. */
export function MarketTags({ p, borrowed }: { p: number; borrowed: boolean }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const move = g.pendingMoveOf(p);
  const leaving = move !== null && move.fromClubId === world.userClubId;
  return (
    <>
      {borrowed && <span className="role-tag loan" title="Here on loan from another club">LOAN</span>}
      {leaving && (
        <span
          className="role-tag leaving"
          title={`Agreed to ${move.kind === 'loan' ? 'go on loan to' : 'join'} ${world.clubs[move.toClubId]?.name ?? 'another club'} — leaves ${g.dateLabelForDay(move.movesOn)}`}
        >
          OUT
        </span>
      )}
      {store.hasFlag(p, PlayerFlag.Transferable) && <span className="role-tag listed" title="Transfer listed">TL</span>}
      {store.hasFlag(p, PlayerFlag.LoanListed) && <span className="role-tag listed" title="Available for loan">LL</span>}
    </>
  );
}

/**
 * Full player profile.
 *
 * Own players are shown exact attributes — a coach knows their own squad.
 * Anyone else goes through the scouting screen, where the numbers are ranges.
 */
export function PlayerDetail(): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const p = g.selectedPlayer;
  const [tab, setTab] = useState<ProfileTab>('overview');
  if (p === null) return null;

  const age = store.ageOn(p, world.year, 181);
  const club = store.clubId[p] >= 0 ? world.clubs[store.clubId[p]] : null;
  const natural = store.position[p] as Position;
  const secondary = store.secondary[p] as Position | -1;
  const ca = store.currentAbility[p];
  const pa = store.potentialAbility[p];
  const loan = g.loanOf(p);
  // Borrowed from another club, or one of ours out on loan elsewhere.
  const borrowed = loan !== null && loan.loanClubId === world.userClubId;
  const lentOut = loan !== null && loan.parentClubId === world.userClubId;
  const isOwn = club?.id === world.userClubId && !borrowed;
  // Only a manager with a club to sign him for can make an offer.
  const managing = g.club !== null;
  const elsewhere = managing && club !== null && club.id !== world.userClubId && !lentOut;
  const loanEnds = loan !== null ? g.dateLabelForDay(loan.endsOn) : '';
  const loanPct = loan !== null ? `${Math.round(loan.wageShare * 100)}%` : '';
  const transferTalks = g.talksWith(p, 'transfer');
  const loanTalks = g.talksWith(p, 'loan');
  // A deal agreed with the window shut: he moves when it opens.
  const move = g.pendingMoveOf(p);
  const joinsLater = g.joinDay(p) > world.day;
  const isYouth = isOwn && club !== null && club.youthPlayers.includes(p);
  const season = seasonTotals(world, p);
  const form = world.ratingForm.get(p) ?? [];
  const contractEnds = contractEndSeason(store.contractUntil[p]);
  const contractLabel = `30 Jun ${world.startYear + contractEnds + 1}`;
  const seasonsLeft = contractEnds - world.season + 1;
  const expiring = club !== null && contractEnds <= world.season;
  const renewalTalks = g.talksWith(p, 'renewal');

  const group = (attrs: readonly AttributeName[], title: string): JSX.Element => (
    <div className="attr-col">
      <h4 className="attr-col-title">{title}</h4>
      {attrs.filter((a) => !HIDDEN_ATTR_SET.has(a)).map((a) => {
        const v = store.getAttr(p, a);
        return (
          <div className="attr" key={a}>
            <span className="name">{ATTR_LABELS[a]}</span>
            <span className={`attr-val ${attrClass(v)}`}>{v}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="profile">
      <div className="profile-hero">
        <PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={104} />
        <div className="profile-id">
          <div className="profile-tags">
            <Pos pos={natural} />
            <span className="profile-role">{POSITION_NAMES[natural]}</span>
            {secondary !== -1 && <span className="faint">· also {POSITION_NAMES[secondary]}</span>}
            {store.hasFlag(p, PlayerFlag.Transferable) && <span className="list-tag">Transfer listed</span>}
            {store.hasFlag(p, PlayerFlag.LoanListed) && <span className="list-tag loan">Available for loan</span>}
          </div>
          <h2 className="profile-name">{store.fullName(p)}</h2>
          <div className="profile-sub">
            <span>
              <Flag nation={store.nation[p]} /> {NATIONS[store.nation[p]].name}
              {secondNation(world, p) >= 0 && <> · <Flag nation={secondNation(world, p)} /> {NATIONS[secondNation(world, p)].name}</>}
            </span>
            <span>{age} years old</span>
            <span>{store.heightCm[p]} cm</span>
            <span title="The hand he hits with">{store.hasFlag(p, PlayerFlag.LeftHanded) ? 'Left-handed' : 'Right-handed'}</span>
            <span>{club !== null ? <ClubLink id={club.id} /> : 'Free agent'}</span>
            {loan !== null && (
              <span className="loan-note">
                <Icon name="swap" size={13} /> On loan from <ClubLink id={loan.parentClubId} short /> until {loanEnds}
                {loan.playingTime !== undefined && <> · {PLAYING_TIME_NAMES[loan.playingTime].toLowerCase()}</>}
              </span>
            )}
            {move !== null && (
              <span className="loan-note">
                <Icon name="clock" size={13} />
                {move.kind === 'loan' ? 'Joins' : 'Agreed to join'} <ClubLink id={move.toClubId} short />
                {move.kind === 'loan' ? ' on loan' : ''} on {g.dateLabelForDay(move.movesOn)}
              </span>
            )}
          </div>
        </div>
        <div className="profile-ratings">
          <div className="profile-rating">
            <span className="profile-rating-label">Current ability</span>
            <StarMeter value={ca} size={20} />
            <span className={`profile-rating-num ${abilityClass(ca)}`}>{ca}</span>
          </div>
          <div className="profile-rating">
            <span className="profile-rating-label">Potential</span>
            <StarMeter value={pa} size={20} />
            <span className={`profile-rating-num ${abilityClass(pa)}`}>{pa}</span>
          </div>
        </div>
        <div className="profile-actions">
          {isYouth && (
            <button className="primary" onClick={() => { g.promotePlayer(p); g.select(null); }}>
              Promote to first team
            </button>
          )}
          {((isOwn && !isYouth) || lentOut) && move === null && (
            <button className={expiring ? 'primary' : ''} onClick={() => g.startRenewal(p)}>
              <Icon name="finances" size={14} />
              {renewalTalks === null ? 'Renew contract' : renewalTalks.pending !== null ? 'Awaiting his answer' : 'Contract talks'}
            </button>
          )}
          {isOwn && !isYouth && move === null && <TransferMenu p={p} />}
          {lentOut && (
            <button onClick={() => g.compileLoanMatches(p)}>
              <Icon name="stats" size={14} /> Compile matches
            </button>
          )}
          {lentOut && (
            <button
              disabled={coachTalkBlock(world, p) !== null}
              title={coachTalkBlock(world, p) ?? 'Ask his loan club\'s coach to play him more'}
              onClick={() => g.openCoachTalk(p)}
            >
              <Icon name="press" size={14} /> Talk to the coach
            </button>
          )}
          {lentOut && canRecall(world, p) && (
            <button className="danger" title="His loan club has not given him the games it promised" onClick={() => g.recallFromLoan(p)}>
              <Icon name="back" size={14} /> Recall from loan
            </button>
          )}
          {(elsewhere || (managing && club === null && store.isActive(p))) && move === null && (
            <button
              className="primary"
              title={joinsLater ? `The window is shut — agree a deal now and he joins on ${g.dateLabelForDay(g.joinDay(p))}` : undefined}
              onClick={() => g.startNegotiation(p)}
            >
              <Icon name="transfers" size={14} />
              {transferTalks !== null ? 'Transfer talks' : club === null ? 'Offer contract' : 'Make offer'}
            </button>
          )}
          {elsewhere && move === null && (
            <button
              disabled={!g.canBorrow(p) && loanTalks === null}
              title={!g.canBorrow(p) ? 'Not available for loan right now'
                : joinsLater ? `The window is shut — a loan agreed now starts on ${g.dateLabelForDay(g.joinDay(p))}`
                  : 'Borrow him until the end of the season'}
              onClick={() => g.startLoanRequest(p)}
            >
              <Icon name="swap" size={14} />
              {loanTalks === null ? 'Request loan' : loanTalks.pending !== null ? 'Awaiting their answer' : 'Loan talks'}
            </button>
          )}
          <button onClick={() => g.select(null)}><Icon name="close" size={14} /> Close</button>
        </div>
      </div>

      <div className="tiles">
        <StatTile label="Value" value={money(store.value[p])} />
        <StatTile
          label="Wage"
          value={money(store.wage[p])}
          sub={borrowed ? `you pay ${loanPct} · on loan to ${loanEnds}`
            : lentOut ? `${club?.shortName ?? 'they'} pay ${loanPct} · back ${loanEnds}`
              : club !== null ? `per season · to ${contractLabel}` : 'per season'}
          tone={expiring ? 'warn' : undefined}
        />
        <StatTile label="Condition" value={`${store.condition[p]}%`} sub={<Bar value={store.condition[p]} wide />} />
        <StatTile label="Morale" value={<Morale value={store.morale[p]} />} sub={<Bar value={store.morale[p]} wide />} />
        <StatTile label="Status" value={<Status store={store} i={p} />} />
        <StatTile
          label="Average rating"
          value={<RatingBadge value={averageRating(season)} size="lg" />}
          sub={`${season.apps} app${season.apps === 1 ? '' : 's'} this season`}
        />
      </div>

      <div className="profile-tabs" role="tablist">
        {PROFILE_TABS.map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`panel-tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'stats' && <SeasonStatsCard world={world} p={p} form={form} />}

      {tab === 'overview' && (
        <div className="profile-grid">
          <Card title="Attributes" icon="stats" className="profile-attrs">
            <div className="attr-cols">
              {group(TECHNICAL_ATTRS, 'Technical')}
              {group(MENTAL_ATTRS, 'Mental')}
              {group(PHYSICAL_ATTRS, 'Physical')}
            </div>
            <p className="footnote">
              Hidden attributes — injury proneness, consistency, big-match performance,
              loyalty, ambition and the rest — are never shown as numbers. They are
              inferred from scout reports and from how the player actually behaves.
            </p>
          </Card>

          <div className="stack profile-side">
            <Card title="Attribute Profile" icon="star">
              <AttributeRadar store={store} p={p} />
              <ArmsPanel store={store} p={p} />
            </Card>
            <Card title="Positions" icon="tactics">
              {POSITIONS.map((pos) => {
                const known = store.familiarityWith(p, pos);
                const fam = familiarityLabel(known, pos === natural);
                const learning = club?.id === world.userClubId ? g.positionTraining(p) === pos : false;
                return (
                  <div className="fam-row" key={pos} title={`${known}/100 — how much he plays like one`}>
                    <Pos pos={pos} />
                    <span className="fam-name">{POSITION_NAMES[pos]}{learning && <span className="fam-learning"> · training</span>}</span>
                    <span className={`fam-bar ${fam.cls}`}><span style={{ width: `${known}%` }} /></span>
                    <span className={`fam-label ${fam.cls}`}>{fam.label}</span>
                  </div>
                );
              })}
            </Card>
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="grid3 profile-details">
          <Card title="Physical Profile" icon="user">
            <KV k="Height">{store.heightCm[p]} cm</KV>
            <KV k="Weight">{store.weightKg[p]} kg</KV>
            <KV k="Preferred hand">
              {store.hasFlag(p, PlayerFlag.LeftHanded) ? 'Left' : 'Right'}
              {store.hasFlag(p, PlayerFlag.LeftHanded) && store.position[p] === Position.Opposite && (
                <span className="faint"> · a left-hander on the right side</span>
              )}
            </KV>
            <KV k="Spike reach">{store.spikeReachCm[p]} cm</KV>
            <KV k="Block reach">{store.blockReachCm[p]} cm</KV>
          </Card>
          <Card title="Career" icon="trophy">
            <KV k="Matches">{store.careerMatches[p].toLocaleString()}</KV>
            <KV k="Points">{store.careerPoints[p].toLocaleString()}</KV>
            <KV k="Aces">{store.careerAces[p].toLocaleString()}</KV>
            <KV k="Blocks">{store.careerBlocks[p].toLocaleString()}</KV>
            <KV k="Titles">{store.careerTitles[p]}</KV>
            <KV k="International caps">{store.nationalCaps[p]}</KV>
            <InternationalHonours p={p} />
          </Card>
          <Card title="Contract" icon="finances">
            <KV k="Club">{club !== null ? <ClubLink id={club.id} /> : 'Free agent'}</KV>
            {club !== null && (
              <KV k="Contract until" cls={expiring ? 'warn-text' : undefined}>
                {contractLabel} · {seasonsLeft <= 1 ? 'expires this season' : `${seasonsLeft} seasons left`}
              </KV>
            )}
            {loan !== null && (
              <KV k="Loan">
                At <ClubLink id={loan.loanClubId} short /> until {loanEnds} · they pay {loanPct} of his wage
              </KV>
            )}
            <KV k="Market value">{money(store.value[p])}</KV>
            <KV k="Wage">{money(store.wage[p])}</KV>
            <KV k="Nationality"><Flag nation={store.nation[p]} /> {NATIONS[store.nation[p]].name}</KV>
            {secondNation(world, p) >= 0 && (
              <KV k="Second nationality">
                <Flag nation={secondNation(world, p)} /> {NATIONS[secondNation(world, p)].name}
                {tiedNation(world, p) !== undefined && (
                  <span className="faint"> · committed to {NATIONS[tiedNation(world, p)!].name}</span>
                )}
              </KV>
            )}
            {store.fivbId[p] > 0 && <KV k="FIVB ID" cls="mono faint">{store.fivbId[p]}</KV>}
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * A player's season, split by competition — appearances, points, and the
 * average match rating in each — with last season one click away.
 */
function SeasonStatsCard({ world, p, form }: { world: World; p: number; form: number[] }): JSX.Element {
  const [which, setWhich] = useState(world.season);
  const lines = seasonRecords(world, p, which);
  const hasLast = world.season > 0 && seasonRecords(world, p, world.season - 1).length > 0;
  const total = lines.reduce(
    (acc, l) => ({
      apps: acc.apps + l.apps,
      ratingSum: acc.ratingSum + l.ratingSum,
      points: acc.points + l.points,
      aces: acc.aces + l.aces,
      blocks: acc.blocks + l.blocks,
      mvps: acc.mvps + l.mvps,
      best: Math.max(acc.best, l.best),
    }),
    { apps: 0, ratingSum: 0, points: 0, aces: 0, blocks: 0, mvps: 0, best: 0 },
  );

  return (
    <Card
      title="Statistics"
      icon="stats"
      flush
      className="profile-stats"
      actions={(
        <>
          {form.length > 0 && (
            <span className="rating-form" title="Last match ratings, oldest first">
              <span className="faint">Form</span>
              {form.map((r, i) => <RatingBadge key={i} value={r} size="sm" />)}
            </span>
          )}
          {hasLast && (
            <Segmented
              size="sm"
              options={[
                [world.season, seasonLabel(world, world.season)],
                [world.season - 1, seasonLabel(world, world.season - 1)],
              ]}
              value={which}
              onChange={setWhich}
            />
          )}
        </>
      )}
    >
      {lines.length === 0 ? (
        <Empty>No competitive matches played in {seasonLabel(world, which)} yet.</Empty>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Competition</th>
              <th className="num">Apps</th>
              <th className="num" title="Points (kills + aces + blocks)">Pts</th>
              <th className="num">Aces</th>
              <th className="num">Blocks</th>
              <th className="num" title="Player of the match">PoM</th>
              <th className="num" title="Best single-match rating">Best</th>
              <th className="num" title="Average match rating">Av Rat</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.competitionId}>
                <td className="strong">{world.competitions[l.competitionId]?.name ?? 'Competition'}</td>
                <td className="num">{l.apps}</td>
                <td className="num">{l.points}</td>
                <td className="num dim">{l.aces}</td>
                <td className="num dim">{l.blocks}</td>
                <td className="num">{l.mvps > 0 ? <span className="gold-text">{l.mvps}</span> : <span className="faint">0</span>}</td>
                <td className="num"><RatingBadge value={l.best} size="sm" /></td>
                <td className="num"><RatingBadge value={averageRating(l)} /></td>
              </tr>
            ))}
            {lines.length > 1 && (
              <tr className="total-row">
                <td>Total</td>
                <td className="num">{total.apps}</td>
                <td className="num">{total.points}</td>
                <td className="num">{total.aces}</td>
                <td className="num">{total.blocks}</td>
                <td className="num">{total.mvps}</td>
                <td className="num"><RatingBadge value={total.best} size="sm" /></td>
                <td className="num"><RatingBadge value={averageRating(total)} /></td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function assessment(pa: number): { text: string; cls: string } {
  if (pa > 1550) return { text: 'Potentially exceptional', cls: 'elite' };
  if (pa > 1250) return { text: 'Could play at the top level', cls: 'good' };
  if (pa > 950) return { text: 'Solid professional prospect', cls: '' };
  return { text: 'Unlikely to make the grade', cls: 'dim' };
}

type AcademyTab = 'players' | 'league';

/**
 * The academy: its prospects — what they might become, how their season in
 * the U19 side is going, promotion to the first team or a sale to a club that
 * wants them — and the U19 side's league.
 */
export function YouthScreen(): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const club = g.club!;
  const youth = g.youthSquad();
  const league = g.youthLeague();
  const [tab, setTab] = useState<AcademyTab>('players');
  const bestPotential = youth.length > 0 ? store.potentialAbility[youth[0]] : 0;
  const stats = world.youth?.stats;
  const position = league !== undefined ? youthTable(league).findIndex((r) => r.clubId === club.id) + 1 : 0;

  return (
    <div className="academy">
      <div className="tiles">
        <StatTile label="Youth facilities" value={`${club.youthFacilities}/20`} sub={<Bar value={club.youthFacilities} max={20} wide />} />
        <StatTile label="Recruitment reach" value={`${club.youthRecruitment}/20`} sub={<Bar value={club.youthRecruitment} max={20} wide />} />
        <StatTile label="Prospects" value={youth.length} sub="in the academy" />
        <StatTile
          label="Best potential"
          value={youth.length > 0 ? <span className={abilityClass(bestPotential)}>{bestPotential}</span> : '—'}
          sub={youth.length > 0 ? <StarMeter value={bestPotential} size={12} /> : 'no prospects yet'}
        />
        <StatTile
          label="U19 league"
          value={league !== undefined && league.round > 0 ? `${position}${ordinalSuffix(position)}` : '—'}
          sub={league?.name ?? 'no youth league'}
        />
      </div>

      <div className="academy-tabs">
        <Segmented<AcademyTab> options={[['players', 'Academy players'], ['league', 'U19 league']]} value={tab} onChange={setTab} />
        <span className="faint">
          {tab === 'players'
            ? 'A new intake arrives each summer. Who plays for the U19s gets the minutes that make training stick.'
            : "Your academy side against the other clubs' — a round every week from late August."}
        </span>
      </div>

      {tab === 'players' ? (
        <Card title="Academy Players" icon="youth" flush className="academy-card">
          {youth.length === 0
            ? <Empty>No youth players yet. The next intake arrives at the end of the season.</Empty>
            : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th />
                      <th>Name</th>
                      <th>Pos</th>
                      <th className="num">Age</th>
                      <th>Nat</th>
                      <th className="num">Ability</th>
                      <th>Potential</th>
                      <th>Assessment</th>
                      <th className="num" title="U19 matches this season">U19</th>
                      <th className="num" title="Points for the U19s">Pts</th>
                      <th className="num" title="Average rating for the U19s">Avg</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {youth.map((p) => {
                      const pa = store.potentialAbility[p];
                      const a = assessment(pa);
                      const line = stats?.get(p);
                      const offers = g.academyOffers(p);
                      return (
                        <tr key={p} className="clickable" onClick={() => g.select(p)}>
                          <td className="face-cell"><PlayerFace playerId={store.id[p]} name={store.fullName(p)} size={28} /></td>
                          <td className="strong">{store.fullName(p)}</td>
                          <td><Pos pos={store.position[p] as Position} /></td>
                          <td className="num">{store.ageOn(p, world.year, 181)}</td>
                          <td><Flag nation={store.nation[p]} /></td>
                          <td className={`num ${abilityClass(store.currentAbility[p])}`}>{store.currentAbility[p]}</td>
                          <td>
                            <span className="ability-cell">
                              <StarMeter value={pa} size={11} />
                              <span className={abilityClass(pa)}>{pa}</span>
                            </span>
                          </td>
                          <td className={a.cls}>{a.text}</td>
                          <td className="num">{line?.[0] ?? 0}</td>
                          <td className="num">{line?.[1] ?? 0}</td>
                          <td className="num">
                            {line !== undefined && line[0] > 0 ? <RatingBadge value={line[2] / line[0]} size="sm" /> : <span className="dim">—</span>}
                          </td>
                          <td className="num">
                            <span className="academy-actions" onClick={(e) => e.stopPropagation()}>
                              <button className="sm" onClick={() => g.promotePlayer(p)}>Promote</button>
                              <Dropdown<number>
                                size="sm"
                                className="academy-sell"
                                placeholder={offers.length > 0 ? 'Sell' : 'No offers'}
                                disabled={offers.length === 0}
                                value={null}
                                menuWidth={250}
                                searchable={false}
                                title="Clubs who would take him, and what they would pay"
                                onChange={(buyer) => g.sellAcademyPlayer(p, buyer)}
                                options={offers.map((o) => {
                                  const buyer = world.clubs[o.clubId];
                                  return {
                                    value: o.clubId,
                                    label: buyer?.name ?? '?',
                                    icon: buyer !== undefined ? <ClubCrest club={buyer} size={16} /> : undefined,
                                    hint: feeText(o.fee),
                                  };
                                })}
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      ) : league === undefined
        ? <Empty>Your club has no youth league this season.</Empty>
        : <YouthLeagueView league={league} />}
    </div>
  );
}

function ordinalSuffix(n: number): string {
  return n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/** The U19 league: the table, and the academy side's results and matches to come. */
function YouthLeagueView({ league }: { league: YouthLeague }): JSX.Element {
  const g = useGame();
  const world = g.world!;
  const store = world.players;
  const mine = world.userClubId;
  const table = youthTable(league);
  const results = (world.youth?.results ?? []).filter((r) => r.home === mine || r.away === mine).slice().reverse();
  const upcoming: Array<{ round: number; home: number; away: number }> = [];
  for (let r = league.round; r < league.rounds && upcoming.length < 6; r++) {
    const pair = youthRound(league, r).find(([h, a]) => h === mine || a === mine);
    if (pair !== undefined) upcoming.push({ round: r, home: pair[0], away: pair[1] });
  }
  const opponent = (h: number, a: number): number => (h === mine ? a : h);
  const status = league.champion >= 0
    ? `Champions: ${world.clubs[league.champion]?.name ?? '?'}`
    : `Round ${Math.min(league.round, league.rounds)} of ${league.rounds}`;
  return (
    <div className="academy-league">
      <Card title={league.name} icon="trophy" flush className="academy-card" actions={<span className="faint">{status}</span>}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Club</th>
                <th className="num">P</th>
                <th className="num">W</th>
                <th className="num">L</th>
                <th className="num">Sets</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row, i) => (
                <tr key={row.clubId} className={row.clubId === mine ? 'mine' : ''}>
                  <td className="num dim">{i + 1}</td>
                  <td className="strong"><ClubLink id={row.clubId} /></td>
                  <td className="num">{row.played}</td>
                  <td className="num">{row.won}</td>
                  <td className="num">{row.lost}</td>
                  <td className="num dim">{row.setsFor}-{row.setsAgainst}</td>
                  <td className="num strong">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="stack academy-side">
        <Card title="Results" icon="ball" flush className="academy-card">
          {results.length === 0
            ? <Empty>No matches played yet — the first round is in late August.</Empty>
            : (
              <div className="academy-results">
                {results.map((r) => {
                  const home = r.home === mine;
                  const own = home ? r.homeSets : r.awaySets;
                  const opp = home ? r.awaySets : r.homeSets;
                  return (
                    <div key={r.round} className={`academy-result ${own > opp ? 'won' : 'lost'}`}>
                      <b>{own > opp ? 'W' : 'L'}</b>
                      <span className="academy-result-score">{own}-{opp}</span>
                      <span className="academy-result-opp">{home ? 'vs' : 'at'} <ClubLink id={opponent(r.home, r.away)} /></span>
                      {r.mvp >= 0 && store.clubId[r.mvp] === mine && <span className="faint">MVP {store.shortName(r.mvp)}</span>}
                    </div>
                  );
                })}
              </div>
            )}
        </Card>
        <Card title="Coming up" icon="calendar" flush className="academy-card">
          {upcoming.length === 0
            ? <Empty>The season's youth matches are all played.</Empty>
            : (
              <div className="academy-results">
                {upcoming.map((m) => (
                  <div key={m.round} className="academy-result">
                    <span className="faint">{g.dateLabelForDay(youthRoundDay(world, m.round))}</span>
                    <span className="academy-result-opp">{m.home === mine ? 'vs' : 'at'} <ClubLink id={opponent(m.home, m.away)} /></span>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>
    </div>
  );
}

/** The medals a player has won with his country — and his country's call, if he is with it now. */
function InternationalHonours({ p }: { p: number }): JSX.Element | null {
  const g = useGame();
  const world = g.world!;
  const I = world.internationals;
  if (I === undefined) return null;
  const medals = I.history.flatMap((h) => {
    const at = h.medallists.findIndex(([, squad]) => squad.includes(p));
    return at < 0 ? [] : [{ name: h.name, medal: ['Gold', 'Silver', 'Bronze'][at], mvp: h.mvp === p }];
  });
  const away = I.tournaments.find((t) => t.status !== 'done' && t.status !== 'planned'
    && t.squads.some(([n, squad]) => squad.includes(p) && !t.out.includes(n)));
  if (medals.length === 0 && away === undefined) return null;
  return (
    <>
      {away !== undefined && <KV k="International duty" cls="accent-text">At the {away.name}</KV>}
      {medals.length > 0 && (
        <KV k="International honours">
          <span className="intl-honours-list">
            {medals.map((m) => (
              <span key={m.name} className={`intl-medal-tag ${m.medal.toLowerCase()}`}>
                {m.medal} · {m.name}{m.mvp ? ' · MVP' : ''}
              </span>
            ))}
          </span>
        </KV>
      )}
    </>
  );
}
