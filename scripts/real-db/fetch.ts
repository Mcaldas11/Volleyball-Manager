/**
 * Builds `data/local/real-db.json` from public league and federation pages.
 *
 *   npx tsx scripts/real-db/fetch.ts            every source below
 *   npx tsx scripts/real-db/fetch.ts POR ITA    just these countries
 *
 * Pages are cached in `data/local/real-cache/` (git-ignored) and each host is
 * asked at most about once a second, after its robots.txt. The result stays on
 * this machine: it is real people's data, for a local look only, never for the
 * public build.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RealClub, RealCoach, RealDb, RealNationalCoach, RealInternational, RealLeague, RealPlayer, RealPosition } from '../../src/data/real/realDb.ts';
import { createHash } from 'node:crypto';
import { NAME_BANKS } from '../../src/engine/world/names.ts';
import { readdirSync, unlinkSync } from 'node:fs';
import { decode, Disallowed, fetchStats, getImage, getPage, PHOTO_DIR, nameKey, splitSurnameFirst, textLines, titleCase } from './http.ts';

const OUT = join('data', 'local', 'real-db.json');

// ---- Positions, in the languages the sources write them in ----------------

const POSITION_WORDS: [RegExp, RealPosition][] = [
  [/libero|líbero|либеро|ліберо/i, 'L'],
  [/setter|levantador|palleggiat|zuspiel|passeu|colocador|pas[oö]r|nahr[aá]va|podajal|ridic|uppspel|hevar|разиграв|зв.язуюч|feladó|rozgrywaj|regista|alzador|armador|passare|opplegger|пасуюч/i, 'S'],
  [/opposite|oposto|opposto|diagonal|universal|diagonaal|atakuj|dia\b|opposé|pointu|smeč|korektor|opus|корект|діагон|átló|zmenitel|opposit|opuesto|univerz[aá]l/i, 'OP'],
  [/middle|center|central|blok[aá]r|centrale|mittel|bloqueur|centr|blokař|srednj|blocant|mitt|midt|центр|центральн|блок|közép|środkow|mb\b/i, 'MB'],
  [/outside|ponteiro|ponta|schiacc|außen|aussen|réceptionneur|attaquant|receptor|smečař|sprejem|extrem|kant|vant|primač|домач|доигр|нападник|centr?\b|ütő|догравальн|przyjmuj|zewn|attacker|hitter|wing|spiker|punta|recepto/i, 'OH'],
];

const unknownPositions = new Map<string, number>();

export function parseRealPosition(raw: string | null | undefined): RealPosition | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (s === '' || s === '-') return null;
  const short: Record<string, RealPosition> = { S: 'S', OH: 'OH', OP: 'OP', O: 'OP', MB: 'MB', M: 'MB', L: 'L', L1: 'L', L2: 'L' };
  if (short[s.toUpperCase()] !== undefined) return short[s.toUpperCase()];
  for (const [re, pos] of POSITION_WORDS) if (re.test(s)) return pos;
  unknownPositions.set(s, (unknownPositions.get(s) ?? 0) + 1);
  return null;
}

// ---- Shared bits -----------------------------------------------------------

function num(s: string | undefined | null, lo: number, hi: number): number | null {
  if (s === undefined || s === null) return null;
  const n = Number(s.replace(',', '.').trim());
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
}

/** "25/01/2002" or "15.09.1993" or "2002-01-25" → year and day of the year. */
function parseDate(s: string | null | undefined): { year: number; day: number } | null {
  if (s === null || s === undefined) return null;
  let d: number, m: number, y: number;
  let r = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (r !== null) { d = +r[1]; m = +r[2]; y = +r[3]; } else {
    r = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (r === null) return null;
    y = +r[1]; m = +r[2]; d = +r[3];
  }
  if (y < 1950 || y > 2015 || m < 1 || m > 12) return null;
  const day = Math.min(364, Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000));
  return { year: y, day };
}

function shortNameOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 0);
  const caps = words.filter((w) => w.length >= 2 && w === w.toUpperCase() && /\p{L}/u.test(w));
  if (caps.length > 0 && caps[0].length <= 4) {
    const rest = words.find((w) => w !== caps[0] && w.length > 3);
    return rest !== undefined ? rest.slice(0, 3).toUpperCase() : caps[0].slice(0, 3);
  }
  const main = words.find((w) => w.length > 3) ?? words[0] ?? name;
  return main.slice(0, 3).toUpperCase();
}

function emptyPlayer(): RealPlayer {
  return {
    first: '', last: '', position: null, nation: null, birthYear: null, birthDay: null,
    heightCm: null, weightKg: null, spikeReachCm: null, blockReachCm: null, shirt: null,
  };
}

/** Each player's photo address, fetched once every league is read. */
const photoUrls = new Map<{ photo?: string | null }, { url: string; name: string }>();

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

// ---- Which part of a name is the first name -------------------------------

/** Every first name the game's own name banks know, to tell "Kolev Kiril" from "Kiril Kolev". */
const FIRST_NAMES = new Set<string>();
for (const bank of Object.values(NAME_BANKS)) for (const n of bank.first) FIRST_NAMES.add(nameKey(n));

interface Ambiguous { target: { first: string; last: string }; raw: string }

/** Written with no capitalised surname: "Kolev Kiril" or "Kiril Kolev", the portal's habit decides. */
function isAmbiguous(raw: string): boolean {
  return !raw.trim().split(/\s+/).some((w) => /\p{L}/u.test(w) && w === w.toUpperCase() && w.replace(/[^\p{L}]/gu, '').length >= 2);
}

/**
 * A portal writes its names one way. Its two-word names vote, by which of the two words is a
 * known first name; then every name is split that way. Surname first: "Oliva Alonso Adrián" is
 * Adrián Oliva Alonso, and two known first names at the end ("... Juan Pablo") are both his.
 */
function fixNameOrder(list: Ambiguous[]): void {
  let surnameFirst = 0;
  let firstFirst = 0;
  for (const { raw } of list) {
    const w = raw.trim().split(/\s+/);
    if (w.length !== 2) continue;
    const a = FIRST_NAMES.has(nameKey(w[0]));
    const b = FIRST_NAMES.has(nameKey(w[1]));
    if (b && !a) surnameFirst++;
    if (a && !b) firstFirst++;
  }
  const lastFirst = surnameFirst >= firstFirst;
  for (const { target, raw } of list) {
    const w = raw.trim().split(/\s+/);
    if (w.length < 2) continue;
    if (lastFirst) {
      const two = w.length >= 3 && FIRST_NAMES.has(nameKey(w[w.length - 2])) && FIRST_NAMES.has(nameKey(w[w.length - 1]));
      const k = two ? w.length - 2 : w.length - 1;
      target.first = w.slice(k).join(' ');
      target.last = w.slice(0, k).join(' ');
    } else {
      const two = w.length >= 3 && FIRST_NAMES.has(nameKey(w[0])) && FIRST_NAMES.has(nameKey(w[1]));
      const k = two ? 2 : 1;
      target.first = w.slice(0, k).join(' ');
      target.last = w.slice(k).join(' ');
    }
  }
}

// ---- DataProject portals (FPV and many other federations) -----------------

interface DpLeague {
  nation: string;
  host: string;
  comp: number;
  name: string;
  season: string;
  federation: string;
  /** 1 for the top flight, 2 for the one below. */
  tier: number;
  /** Further groups of the same division (a second tier split by region), merged into one. */
  more?: number[];
}

const DP_LEAGUES: DpLeague[] = [
  // Top flights.
  { nation: 'POR', tier: 1, host: 'fpv-web.dataproject.com', comp: 146, name: 'Liga UNA Seguros', season: '2026/27', federation: 'FPV' },
  { nation: 'GER', tier: 1, host: 'vbl-web.dataproject.com', comp: 191, name: '1. Bundesliga', season: '2026/27', federation: 'VBL' },
  { nation: 'ESP', tier: 1, host: 'rfevb-web.dataproject.com', comp: 166, name: 'Superliga', season: '2026/27', federation: 'RFEVB' },
  { nation: 'SLO', tier: 1, host: 'ozs-web.dataproject.com', comp: 142, name: 'Sportklub Superliga', season: '2026/27', federation: 'OZS' },
  { nation: 'ROU', tier: 1, host: 'frv-web.dataproject.com', comp: 77, name: 'Divizia A1', season: '2026/27', federation: 'FRV' },
  { nation: 'BUL', tier: 1, host: 'bvf-web.dataproject.com', comp: 65, name: 'Super Volley', season: '2026/27', federation: 'BVF' },
  { nation: 'UKR', tier: 1, host: 'uvf-web.dataproject.com', comp: 183, name: 'Superliga', season: '2026/27', federation: 'UVF' },
  { nation: 'HUN', tier: 1, host: 'hvf-web.dataproject.com', comp: 64, name: 'Extraliga', season: '2026/27', federation: 'MRSZ' },
  { nation: 'SWE', tier: 1, host: 'svbf-web.dataproject.com', comp: 453, name: 'Elitserien', season: '2026/27', federation: 'SVBF' },
  { nation: 'NOR', tier: 1, host: 'nvbf-web.dataproject.com', comp: 95, name: 'Mizunoligaen', season: '2026/27', federation: 'NVBF' },
  { nation: 'SVK', tier: 1, host: 'svf-web.dataproject.com', comp: 99, name: 'Extraliga', season: '2026/27', federation: 'SVF' },
  { nation: 'CRO', tier: 1, host: 'hos-web.dataproject.com', comp: 141, name: 'Superliga', season: '2026/27', federation: 'HOS' },
  { nation: 'EST', tier: 1, host: 'evf-web.dataproject.com', comp: 96, name: 'Meistriliiga', season: '2026/27', federation: 'EVF' },
  { nation: 'ISR', tier: 1, host: 'iva-web.dataproject.com', comp: 50, name: 'Premier League', season: '2026/27', federation: 'IVA' },
  { nation: 'BIH', tier: 1, host: 'osbih-web.dataproject.com', comp: 50, name: 'Premijer Liga', season: '2026/27', federation: 'OSBiH' },
  // Second tiers.
  { nation: 'POR', tier: 2, host: 'fpv-web.dataproject.com', comp: 148, name: '2.ª Divisão', season: '2026/27', federation: 'FPV' },
  { nation: 'GER', tier: 2, host: 'vbl-web.dataproject.com', comp: 198, name: '2. Liga Pro', season: '2026/27', federation: 'VBL' },
  { nation: 'ESP', tier: 2, host: 'rfevb-web.dataproject.com', comp: 167, name: 'Superliga 2', season: '2026/27', federation: 'RFEVB' },
  { nation: 'SLO', tier: 2, host: 'ozs-web.dataproject.com', comp: 143, name: '1. liga', season: '2026/27', federation: 'OZS' },
  { nation: 'ROU', tier: 2, host: 'frv-web.dataproject.com', comp: 85, more: [86], name: 'Divizia A2', season: '2026/27', federation: 'FRV' },
  { nation: 'BUL', tier: 2, host: 'bvf-web.dataproject.com', comp: 67, name: 'Top League', season: '2026/27', federation: 'BVF' },
  { nation: 'UKR', tier: 2, host: 'uvf-web.dataproject.com', comp: 184, name: 'Vyshcha Liha', season: '2026/27', federation: 'UVF' },
  { nation: 'HUN', tier: 2, host: 'hvf-web.dataproject.com', comp: 65, name: 'NB I', season: '2026/27', federation: 'MRSZ' },
  { nation: 'SWE', tier: 2, host: 'svbf-web.dataproject.com', comp: 455, more: [454], name: 'Division 1', season: '2026/27', federation: 'SVBF' },
  { nation: 'NOR', tier: 2, host: 'nvbf-web.dataproject.com', comp: 96, name: '1. divisjon', season: '2026/27', federation: 'NVBF' },
  { nation: 'SVK', tier: 2, host: 'svf-web.dataproject.com', comp: 102, name: '1. liga', season: '2026/27', federation: 'SVF' },
  { nation: 'CRO', tier: 2, host: 'hos-web.dataproject.com', comp: 142, name: 'Prva liga', season: '2026/27', federation: 'HOS' },
  { nation: 'EST', tier: 2, host: 'evf-web.dataproject.com', comp: 98, name: 'Esiliiga', season: '2026/27', federation: 'EVF' },
];

/** This season's men's under-21 (or under-20) leagues: their squads join the top-flight clubs they belong to. */
const DP_YOUTH: DpLeague[] = [
  { nation: 'POR', tier: 9, host: 'fpv-web.dataproject.com', comp: 149, more: [152], name: 'Sub21', season: '2026/27', federation: 'FPV' },
  { nation: 'HUN', tier: 9, host: 'hvf-web.dataproject.com', comp: 67, name: 'U20', season: '2026/27', federation: 'MRSZ' },
  { nation: 'SVK', tier: 9, host: 'svf-web.dataproject.com', comp: 103, name: '1. liga juniori', season: '2026/27', federation: 'SVF' },
  { nation: 'EST', tier: 9, host: 'evf-web.dataproject.com', comp: 104, name: 'U-20', season: '2026/27', federation: 'EVF' },
];

/** "SL Benfica (Sub21)", "MOK Rijeka - juniori": the club's own name. */
function seniorName(youthName: string): string {
  return youthName.replace(/\(.*?\)/g, ' ').replace(/[-–]\s*(juniori|junior|u-?2\d|sub-?2\d)\b.*$/i, ' ')
    .replace(/\b(u-?2\d|sub-?2\d|juniori|junior)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Each youth squad onto the top-flight club it belongs to; squads of other clubs are left out. */
function attachYouth(leagues: RealLeague[], youth: RealLeague[]): number {
  let n = 0;
  for (const y of youth) {
    const top = leagues.find((l) => l.nation === y.nation && l.tier === 1);
    if (top === undefined) continue;
    for (const yc of y.clubs) {
      const want = nameKey(seniorName(yc.name));
      let club = top.clubs.find((c) => nameKey(c.name) === want);
      if (club === undefined) {
        const t = new Set(want.split(' ').filter((x) => x.length >= 4));
        const hits = top.clubs.filter((c) => nameKey(c.name).split(' ').some((x) => t.has(x)));
        if (hits.length === 1) club = hits[0];
      }
      if (club === undefined) continue;
      // Someone on both lists plays for the first team.
      const senior = new Set(club.players.map((p) => nameKey(`${p.first} ${p.last}`)));
      club.youth = [...(club.youth ?? []), ...yc.players.filter((p) => !senior.has(nameKey(`${p.first} ${p.last}`)))];
      n += yc.players.length;
    }
  }
  return n;
}

function spanText(html: string, idEnd: string): string | null {
  const re = new RegExp(`id="[^"]*${idEnd}"[^>]*>([\\s\\S]*?)</span>`);
  const m = re.exec(html);
  if (m === null) return null;
  const t = decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return t === '' || t === '-' ? null : t;
}

/** A standings page: team ids in table order. */
function dpStandings(html: string): number[] {
  const ids: number[] = [];
  for (const m of html.matchAll(/TeamID=(\d+)/g)) {
    const id = Number(m[1]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function fetchDataProject(def: DpLeague): Promise<RealLeague> {
  const base = `https://${def.host}`;
  const home = await getPage(`${base}/CompetitionHome.aspx?ID=${def.comp}`);
  const teams = new Map<number, string>();
  const logos = new Map<number, string>();
  for (const m of home.matchAll(/TeamListView_ctrl\d+_Image1" title="([^"]*)" src="([^"]*TeamLogo_(\d+)[^"]*)"/g)) {
    teams.set(Number(m[3]), decode(m[1]).trim());
    logos.set(Number(m[3]), decode(m[2]));
  }
  const compLogo = new RegExp(`src="([^"]*CompetitionLogo_${def.comp}\.[a-z]+)"`).exec(home);
  const leagueLogo = compLogo !== null ? await getImage(decode(compLogo[1]), `league-${def.nation}`) : null;
  if (teams.size === 0) {
    for (const m of home.matchAll(/CompetitionTeamDetails\.aspx\?TeamID=(\d+)&(?:amp;)?ID=(\d+)/g)) {
      if (Number(m[2]) === def.comp) teams.set(Number(m[1]), '');
    }
  }

  // The table, for each club's standing.
  let order: number[] = [];
  const pid = /CompetitionStandings\.aspx\?ID=\d+&(?:amp;)?PID=(\d+)/.exec(home);
  if (pid !== null) {
    try {
      order = dpStandings(await getPage(`${base}/CompetitionStandings.aspx?ID=${def.comp}&PID=${pid[1]}`))
        .filter((id) => teams.has(id));
    } catch (err) {
      log(`  ${def.nation}: no standings (${(err as Error).message})`);
    }
  }

  const clubs: RealClub[] = [];
  const ambiguous: Ambiguous[] = [];
  for (const [teamId, listedName] of teams) {
    const page = await getPage(`${base}/CompetitionTeamDetails.aspx?TeamID=${teamId}&ID=${def.comp}`);
    const players: RealPlayer[] = [];
    const rows = page.split(/_PlayerRow(?:_Alt)?"/).slice(1);
    for (const row of rows) {
      const idm = /PlayerID=(\d+)/.exec(row);
      const lines = textLines('<x ' + row);
      const nameLine = lines.find((l) => /\p{L}{2,}/u.test(l) && !/^\d+$/.test(l) && !/^id=|class=|style=/.test(l));
      if (nameLine === undefined) continue;
      const after = lines.slice(lines.indexOf(nameLine) + 1).filter((l) => !l.startsWith('<'));
      // Gone from the club: the portal keeps him on the list with the date he left.
      if (after.slice(0, 12).some((l) => /^(till och med|hasta el|slutter|bis|jusqu|until|até|fino al|do|koniec|vége)\s.*\d{4}/i.test(l))) continue;
      const p = emptyPlayer();
      const n = splitSurnameFirst(nameLine);
      p.first = n.first;
      p.last = n.last;
      if (isAmbiguous(nameLine)) ambiguous.push({ target: p, raw: nameLine });
      p.shirt = num(lines.find((l) => /^\d{1,2}$/.test(l)), 0, 99);
      p.position = parseRealPosition(after.find((l) => l !== nameLine && /\p{L}/u.test(l)) ?? null);
      const nums = after.filter((l) => /^\d{3,4}$/.test(l)).map(Number);
      p.heightCm = nums.find((v) => v >= 150 && v <= 230) ?? null;
      p.birthYear = nums.find((v) => v >= 1960 && v <= 2014) ?? null;
      const reaches = nums.filter((v) => v >= 240 && v <= 400);
      p.spikeReachCm = reaches[0] ?? null;
      p.blockReachCm = reaches[1] ?? null;
      const ph = /src="(https:\/\/images\.dataproject\.com\/[^"]*\/TeamPlayer\/\d+\/\d+\/TeamPlayer_[^"]+)"/.exec(row);
      if (ph !== null) photoUrls.set(p, { url: ph[1].replace(/\/TeamPlayer\/\d+\/\d+\//, '/TeamPlayer/200/200/'), name: `${def.nation}-${p.first}-${p.last}` });

      // The player's own page has the full birth date and the nationality.
      if (idm !== null) {
        try {
          const pp = await getPage(`${base}/PlayerDetails.aspx?TeamID=${teamId}&PlayerID=${idm[1]}&ID=${def.comp}`);
          const date = parseDate(spanText(pp, 'LBL_BirthDate'));
          if (date !== null) { p.birthYear = date.year; p.birthDay = date.day; }
          const nat = spanText(pp, 'Label10');
          if (nat !== null && /^[A-Z]{3}$/.test(nat)) p.nation = nat;
          p.position ??= parseRealPosition(spanText(pp, 'LBL_Position'));
          p.heightCm ??= num(spanText(pp, 'Label7'), 150, 230);
        } catch (err) {
          if (err instanceof Disallowed) throw err;
          log(`  ${def.nation}: player ${idm[1]} failed (${(err as Error).message})`);
        }
      }
      players.push(p);
    }
    const name = listedName !== '' ? listedName : (spanText(page, 'Lbl_TeamName') ?? `Team ${teamId}`);
    const standing = order.indexOf(teamId);
    const logoUrl = logos.get(teamId);
    // The bench: head coach and assistant, top flights only.
    const coaches: RealCoach[] = [];
    if (def.tier === 1) {
      for (const chunk of page.split(/_CoachRow_\d+"/).slice(1)) {
        const t = textLines('<x ' + chunk).filter((l) => !l.startsWith('<')).slice(0, 4);
        // A row is a name, then the role in the portal's language. The head coach comes first.
        const nm = t[0];
        const role = t[1] ?? '';
        if (nm === undefined || !/\p{L}{2,}/u.test(nm)) continue;
        const assistant = /assist|asyst|asist|second|2nd|adjunto|segundo|co-|помічн|помощ|segéd|pomoc|hjelpe/i.test(role);
        const head = !assistant && !coaches.some((c) => c.role === 'head');
        if (!head && !assistant) continue;
        const n = splitSurnameFirst(nm);
        const coach: RealCoach = { first: n.first, last: n.last, role: head ? 'head' : 'assistant' };
        if (isAmbiguous(nm)) ambiguous.push({ target: coach, raw: nm });
        const cph = /src="(https:\/\/images\.dataproject\.com\/[^"]*\/TeamCoach\/\d+\/\d+\/TeamCoach_[^"]+)"/.exec(chunk);
        if (cph !== null) photoUrls.set(coach, { url: cph[1].replace(/\/TeamCoach\/\d+\/\d+\//, '/TeamCoach/200/200/'), name: `${def.nation}-coach-${teamId}-${coach.role}-${coaches.length}` });
        coaches.push(coach);
      }
    }
    clubs.push({
      coaches,
      logo: logoUrl !== undefined ? await getImage(logoUrl, `${def.nation}-${name}`) : null,
      name,
      shortName: shortNameOf(name),
      city: spanText(page, 'TeamStadium_ctrl0_CityLabel'),
      arena: spanText(page, 'TeamStadium_ctrl0_StadiumName'),
      standing: standing >= 0 ? standing + 1 : null,
      players,
    });
    log(`  ${def.nation} ${name}: ${players.length} players`);
  }
  fixNameOrder(ambiguous);
  return {
    nation: def.nation, tier: def.tier, name: def.name, season: def.season,
    source: `${def.federation} (DataProject)`, url: `${base}/CompetitionHome.aspx?ID=${def.comp}`, logo: leagueLogo, clubs,
  };
}

// ---- PlusLiga (Poland) -----------------------------------------------------

async function fetchPlusLiga(): Promise<RealLeague> {
  const base = 'https://www.plusliga.pl';
  const list = await getPage(`${base}/teams.html`);
  const ids = [...new Set([...list.matchAll(/href="\/teams\/id\/(\d+)\.html"/g)].map((m) => Number(m[1])))];
  // The table, for the standing.
  let order: number[] = [];
  try {
    const table = await getPage(`${base}/table.html`);
    order = [...new Set([...table.matchAll(/\/teams\/id\/(\d+)/g)].map((m) => Number(m[1])))];
  } catch { /* no table */ }

  const clubs: RealClub[] = [];
  for (const id of ids) {
    const page = await getPage(`${base}/teams/id/${id}.html`);
    const title = /og:title" content="([^"]*)"/.exec(page);
    const name = title !== null ? decode(title[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : `Team ${id}`;
    const links = [...new Set([...page.matchAll(/href="(\/players\/id\/\d+\/tour\/\d+\.html)"/g)].map((m) => m[1]))];
    const players: RealPlayer[] = [];
    let logo: string | null = null;
    for (const link of links) {
      const pp = await getPage(base + link);
      if (logo === null) {
        const lm = /class="[^"]*logo">\s*<a href='\/teams\/id\/\d+[^']*'>\s*<img src="([^"]+)"/.exec(pp);
        if (lm !== null) logo = await getImage(base + decode(lm[1]), `POL-${name}`);
      }
      const lines = textLines(pp);
      const at = (label: string): string | null => {
        const i = lines.findIndex((l) => l.startsWith(label));
        return i >= 0 ? (lines[i].slice(label.length).trim() || lines[i + 1] || null) : null;
      };
      const born = at('Data urodzenia:');
      const i = lines.findIndex((l) => l === 'Data urodzenia:');
      const fullName = i >= 2 ? lines[i - 2] : null;
      if (fullName === null) continue;
      const words = fullName.split(' ');
      const p = emptyPlayer();
      p.first = words.slice(0, -1).join(' ') || fullName;
      p.last = words[words.length - 1];
      const date = parseDate(born);
      if (date !== null) { p.birthYear = date.year; p.birthDay = date.day; }
      p.position = parseRealPosition(at('Pozycja:'));
      p.heightCm = num(at('Wzrost:'), 150, 230);
      p.weightKg = num(at('Waga:'), 50, 140);
      p.spikeReachCm = num(at('Zasięg z wyskoku do ataku:'), 240, 400);
      const ph = /player-page-grid-photo[\s\S]*?(?:src|data-background)="(\/dl\/[^"]+)"/.exec(pp);
      if (ph !== null) photoUrls.set(p, { url: base + decode(ph[1]), name: `POL-${p.first}-${p.last}` });
      players.push(p);
    }
    const standing = order.indexOf(id);
    const coaches: RealCoach[] = [];
    for (const [re, role] of [[/Pierwszy trener:<\/b>\s*([^<]+)/, 'head'], [/Drugi trener:<\/b>\s*([^<]+)/, 'assistant']] as const) {
      const m = re.exec(page);
      if (m === null) continue;
      for (const one of decode(m[1]).split(',')) {
        const words = one.trim().split(/\s+/);
        if (words.length >= 2) coaches.push({ first: words.slice(0, -1).join(' '), last: words[words.length - 1], role });
      }
    }
    clubs.push({ name, shortName: shortNameOf(name), city: null, arena: null, standing: standing >= 0 ? standing + 1 : null, logo, coaches, players });
    log(`  POL ${name}: ${players.length} players`);
  }
  return { nation: 'POL', tier: 1, name: 'PlusLiga', season: '2026/27', source: 'PlusLiga', url: `${base}/teams.html`, clubs };
}

// ---- Lega Pallavolo Serie A (Italy) ---------------------------------------

async function fetchSuperLega(tier: 1 | 2): Promise<RealLeague> {
  const base = 'https://www.legavolley.it';
  const home = await getPage(`${base}/`);
  // The menu's "Squadre SuperLega" list: the top flight only, not A2 and A3.
  const from = home.indexOf(tier === 1 ? 'Squadre SuperLega' : 'Squadre Serie A2');
  const to = home.indexOf('Squadre', from + 20);
  const menu = from >= 0 ? home.slice(from, to > from ? to : undefined) : '';
  const ids = [...new Set([...menu.matchAll(/href="\/team\/(\d+)"/g)].map((m) => Number(m[1])))];
  const clubs: RealClub[] = [];
  for (const id of ids) {
    const page = await getPage(`${base}/team/${id}`);
    const lines = textLines(page);
    // Only the top flight: the page names the championship it plays in.
    const title = /<title>([\s\S]*?)<\/title>/.exec(page);
    const name = title !== null
      ? decode(title[1]).replace(/\s*[-|–].*$/, '').replace(/\s+/g, ' ').trim()
      : `Team ${id}`;
    const r = lines.indexOf('Roster');
    // Each roster row's photo, by the name written beside it.
    const photoOf = new Map<string, string>();
    for (const m of page.matchAll(/<td class="foto">\s*<img src="([^"]+)"[\s\S]*?<td class="nome">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/g)) {
      photoOf.set(decode(m[2]).replace(/\s+/g, ' ').trim(), decode(m[1]).replace(/heightImg=\d+/, 'heightImg=240'));
    }
    const players: RealPlayer[] = [];
    if (r >= 0) {
      const body = lines.slice(r + 1);
      const header = body.indexOf('Sport.');
      const rows = body.slice(header + 1);
      for (let k = 0; k < rows.length; k++) {
        // A row: shirt, NAME First, role, role, year, height, place, nation.
        if (!/^\d{1,2}$/.test(rows[k])) continue;
        const nm = rows[k + 1];
        if (nm === undefined || !/\p{Lu}{2,}/u.test(nm)) continue;
        const year = num(rows[k + 4], 1960, 2014);
        if (year === null) continue;
        const p = emptyPlayer();
        const n = splitSurnameFirst(nm);
        p.first = n.first; p.last = n.last;
        p.shirt = Number(rows[k]);
        p.position = parseRealPosition(rows[k + 2]);
        p.birthYear = year;
        p.heightCm = num(rows[k + 5], 150, 230);
        const nat = rows.slice(k + 6, k + 8).find((x) => /^[A-Z]{3}$/.test(x));
        p.nation = nat ?? null;
        const ph = photoOf.get(nm.replace(/\s+/g, ' ').trim());
        if (ph !== undefined) photoUrls.set(p, { url: ph, name: `ITA-${p.first}-${p.last}` });
        players.push(p);
        k += 6;
      }
    }
    if (players.length === 0) continue;
    const coaches: RealCoach[] = [];
    for (const m of page.matchAll(/<td class="foto">\s*<img src="([^"]+)">\s*<\/td>\s*<td class="nome">\s*([^<]+?)\s*<div[\s\S]*?<\/td>\s*<td class="ruolo">\s*([^<]+?)\s*<\/td>/g)) {
      const role = decode(m[3]);
      const head = /^1°\s*Allenatore/i.test(role);
      const assistant = /^2°\s*Allenatore/i.test(role);
      if ((!head && !assistant) || tier !== 1) continue;
      const n = splitSurnameFirst(decode(m[2]));
      const coach: RealCoach = { first: n.first, last: n.last, role: head ? 'head' : 'assistant' };
      photoUrls.set(coach, { url: decode(m[1]).replace(/heightImg=\d+/, 'heightImg=240'), name: `ITA-coach-${id}-${coach.role}-${coaches.length}` });
      coaches.push(coach);
    }
    const logo = await getImage(`${base}/GetLogo.aspx?Field=LogoWeb&maxWidth=220&Proc=LogoSquadra&Web=0&Key=${id}&Char=False`, `ITA-${name}`);
    clubs.push({ name, shortName: shortNameOf(name), city: null, arena: null, standing: null, logo, coaches, players });
    log(`  ITA ${name}: ${players.length} players`);
  }
  const lm = /src="([^"]*Lega-Pallavolo-SerieA_transp[^"]*)"/.exec(home);
  const logo = lm !== null && tier === 1 ? await getImage(decode(lm[1]), 'league-ITA') : null;
  return { nation: 'ITA', tier, name: tier === 1 ? 'SuperLega' : 'Serie A2', season: '2026/27', source: 'Lega Pallavolo Serie A', url: base, logo, clubs };
}

// ---- National-team rosters (2025 World Championship) ----------------------

const WIKI_POS: Record<string, RealPosition> = { S: 'S', OH: 'OH', OP: 'OP', MB: 'MB', L: 'L' };

/** Country names as the squads page writes them, to FIVB codes. */
const COUNTRY: Record<string, string> = {
  Algeria: 'ALG', Argentina: 'ARG', Belgium: 'BEL', Brazil: 'BRA', Bulgaria: 'BUL', Canada: 'CAN', Chile: 'CHI',
  China: 'CHN', Colombia: 'COL', Cuba: 'CUB', Czech: 'CZE', 'Czech Republic': 'CZE', Czechia: 'CZE', Egypt: 'EGY',
  Finland: 'FIN', France: 'FRA', Germany: 'GER', Iran: 'IRI', Italy: 'ITA', Japan: 'JPN', Libya: 'LBA',
  Netherlands: 'NED', Philippines: 'PHI', Poland: 'POL', Portugal: 'POR', Qatar: 'QAT', Romania: 'ROU',
  Serbia: 'SRB', Slovenia: 'SLO', 'South Korea': 'KOR', Tunisia: 'TUN', Turkey: 'TUR', Türkiye: 'TUR',
  Ukraine: 'UKR', 'United States': 'USA', Kazakhstan: 'KAZ', Mexico: 'MEX', Australia: 'AUS', Spain: 'ESP',
  Greece: 'GRE', Slovakia: 'SVK', Croatia: 'CRO', Estonia: 'EST', 'Puerto Rico': 'PUR', Thailand: 'THA',
  India: 'IND', Cameroon: 'CMR', Morocco: 'MAR', Venezuela: 'VEN', Peru: 'PER', Uruguay: 'URU',
};

async function fetchInternationals(): Promise<{ list: RealInternational[]; coaches: RealNationalCoach[]; source: string }> {
  const page = "2025_FIVB_Men's_Volleyball_World_Championship_squads";
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(page).replace(/%27/g, "'")}`;
  const html = await getPage(url);
  const list: RealInternational[] = [];
  const coaches: RealNationalCoach[] = [];
  const sections = html.split(/<h3 id="/).slice(1);
  for (const sec of sections) {
    const country = decode(sec.slice(0, sec.indexOf('"'))).replace(/_/g, ' ');
    const nation = COUNTRY[country] ?? null;
    if (nation === null) { log(`  internationals: no code for "${country}"`); continue; }
    const hc = /Head coach:[\s\S]*?<a[^>]*title="[^"]*"[^>]*>([^<]+)<\/a>\s*<\/p>/.exec(sec);
    if (hc !== null) {
      const words = decode(hc[1]).trim().split(/\s+/);
      coaches.push({ nation, first: words.slice(0, -1).join(' '), last: words[words.length - 1] });
    }
    for (const m of sec.matchAll(/<li[^>]*>\s*\d+\s*<a[^>]*>([^<]+)<\/a>[\s\S]*?>(S|OH|OP|MB|L)<\/span>\s*<\/li>/g)) {
      const name = decode(m[1]).trim();
      const words = name.split(' ');
      list.push({ nation, first: words.slice(0, -1).join(' '), last: words[words.length - 1], position: WIKI_POS[m[2]] ?? null });
    }
  }
  return { list, coaches, source: `https://en.wikipedia.org/wiki/${page} (rosters as registered with the FIVB)` };
}

// ---- zerozero.pt: photos the federation does not have ---------------------

/** Portuguese divisions on zerozero, for the players and coaches the FPV shows no photo of. */
const ZZ_COMPS: { tier: number; path: string }[] = [
  { tier: 1, path: '/competicao/campeonato-nacional-voleibol' },
  { tier: 2, path: '/competicao/ii-divisao-voleibol' },
];
const ZZ_GENERIC = new Set(['aa', 'aas', 'sc', 'cv', 'gc', 'ca', 'cd', 'cf', 'ad', 'gd', 'sl', 'fc', 'clube', 'voleibol', 'volei', 'de', 'da', 'do', 'dos']);

function clubTokens(name: string): Set<string> {
  return new Set(nameKey(name).split(' ').filter((t) => t.length >= 3 && !ZZ_GENERIC.has(t)));
}

/** Same person: the full name, or surname and first initial, or the one surname in the squad. */
function samePerson(first: string, last: string, zzName: string, everyone: { first: string; last: string }[], aka: string[] = []): boolean {
  const full = nameKey(`${first} ${last}`);
  const z = nameKey(zzName);
  if (full === z || aka.some((a) => nameKey(a) === z)) return true;
  const zw = z.split(' ');
  const lastKey = nameKey(last).split(' ');
  const surname = lastKey[lastKey.length - 1];
  if (zw[zw.length - 1] !== surname) return false;
  if (zw[0].charAt(0) === nameKey(first).charAt(0)) return true;
  return everyone.filter((x) => nameKey(x.last).split(' ').pop() === surname).length === 1;
}

async function fillFromZeroZero(leagues: RealLeague[]): Promise<number> {
  const base = 'https://www.zerozero.pt';
  let found = 0;
  for (const { tier, path } of ZZ_COMPS) {
    const league = leagues.find((l) => l.nation === 'POR' && l.tier === tier);
    if (league === undefined) continue;
    let comp: string;
    try { comp = await getPage(base + path); } catch (err) { log(`  zerozero: ${(err as Error).message}`); continue; }
    // This season's team pages: the season id most links carry.
    const seasons = [...comp.matchAll(/epoca_id=(\d+)/g)].map((m) => Number(m[1]));
    const season = Math.max(...seasons);
    const teams = [...new Set([...comp.matchAll(new RegExp(`href="(/equipa/[^"/]+/\\d+)\\?epoca_id=${season}"`, 'g'))].map((m) => m[1]))];
    for (const team of teams) {
      const page = await getPage(`${base}${team}?epoca_id=${season}`);
      // The club by the address's name ("sc-espinho"): a page's title is not always its own.
      const slug = team.split('/')[2].replace(/-/g, ' ');
      const zzAll = new Set(nameKey(slug).split(' '));
      const zzTokens = clubTokens(slug);
      let club: RealClub | undefined;
      let best = 0;
      let tied = false;
      for (const c of league.clubs) {
        const main = [...clubTokens(c.name)].filter((x) => zzTokens.has(x)).length;
        if (main === 0) continue;
        // "AA" against "SC": the small words only break a tie between two clubs of one town.
        const small = nameKey(c.name).split(' ').filter((x) => ZZ_GENERIC.has(x) && zzAll.has(x)).length * 0.5;
        const score = main + small;
        if (score > best) { best = score; club = c; tied = false; } else if (score === best) tied = true;
      }
      if (club === undefined || tied) continue;
      const entries = [...page.matchAll(/class="photo" style="background-image: url\('([^']+)'\)"><\/div><div class="name">[\s\S]*?<a href="\/(jogador|treinador)\/[^"]+">([^<]+)<\/a>/g)];
      for (const [, src, kind, rawName] of entries) {
        if (/No_Photo/i.test(src)) continue;
        const url = src.startsWith('http') ? src : base + src;
        const name = decode(rawName).trim();
        const people: { first: string; last: string; photo?: string | null; aka?: string[] }[] = kind === 'jogador' ? [...club.players, ...(club.youth ?? [])] : (club.coaches ?? []);
        const who = people.find((x) => !x.photo && samePerson(x.first, x.last, name, people, x.aka));
        if (who === undefined) continue;
        who.photo = await getImage(url, `POR-zz-${kind}-${who.first}-${who.last}`, PHOTO_DIR);
        if (who.photo) found++;
      }
    }
  }
  return found;
}

// ---- Putting it together ---------------------------------------------------

/** Nationality for players whose page leaves it out: their national team, if they have one. */
function fillNations(league: RealLeague, intl: RealInternational[]): void {
  const byName = new Map<string, string>();
  for (const p of intl) byName.set(nameKey(`${p.first} ${p.last}`), p.nation);
  for (const club of league.clubs) {
    for (const p of club.players) {
      if (p.nation !== null) continue;
      p.nation = byName.get(nameKey(`${p.first} ${p.last}`)) ?? null;
    }
  }
}

interface Correction {
  nation: string;
  club: string;
  /** Rename: the name the source has. */
  from?: string;
  first?: string;
  last?: string;
  /** Add him: a player the source leaves out. */
  add?: boolean;
  /** Another name the same player goes by on other sites. */
  aka?: string;
  position?: RealPosition;
  /** His second position. */
  secondary?: RealPosition;
  birthYear?: number;
  /** Full birth date, "2005-09-08". */
  born?: string;
  heightCm?: number;
  /** Ability and potential set by hand, 0-2000. */
  ability?: number;
  potential?: number;
}

/**
 * Hand corrections for what the sources get wrong, from `data/local/real-corrections.json`.
 * Each one renames a player (`from`) or adds one the source leaves out (`add`). Applied on every run.
 */
function applyCorrections(leagues: RealLeague[]): void {
  const file = join('data', 'local', 'real-corrections.json');
  if (!existsSync(file)) return;
  const fixes = JSON.parse(readFileSync(file, 'utf8')) as Correction[];
  for (const f of fixes) {
    const club = leagues.filter((l) => l.nation === f.nation).flatMap((l) => l.clubs).find((c) => c.name === f.club);
    if (club === undefined) { log(`  correction not applied: no club ${f.club}`); continue; }
    if (f.add === true) {
      if (f.first === undefined || f.last === undefined) continue;
      const k = nameKey(`${f.first} ${f.last}`);
      // On the under-21 list too: he is a first-team player now, with what that list knows of him.
      const fromYouth = club.youth?.find((x) => nameKey(`${x.first} ${x.last}`) === k);
      if (club.youth !== undefined) club.youth = club.youth.filter((x) => x !== fromYouth);
      const existing = club.players.find((x) => nameKey(`${x.first} ${x.last}`) === k);
      const p = existing ?? { ...(fromYouth ?? emptyPlayer()), first: f.first, last: f.last, nation: fromYouth?.nation ?? f.nation };
      if (f.position !== undefined) p.position = f.position;
      if (f.secondary !== undefined) p.secondary = f.secondary;
      if (f.birthYear !== undefined) p.birthYear = f.birthYear;
      const date = parseDate(f.born);
      if (date !== null) { p.birthYear = date.year; p.birthDay = date.day; }
      if (f.heightCm !== undefined) p.heightCm = f.heightCm;
      if (existing === undefined) club.players.push(p);
      log(`  added: ${f.first} ${f.last} (${f.club})`);
      continue;
    }
    const p = [...club.players, ...(club.youth ?? [])].find((x) => nameKey(`${x.first} ${x.last}`) === nameKey(f.from ?? ''));
    if (p === undefined) { log(`  correction not applied: ${f.from} (${f.club})`); continue; }
    if (f.aka !== undefined) {
      p.aka = [...new Set([...(p.aka ?? []), f.aka])];
      log(`  ${f.from} is also ${f.aka} (${f.club})`);
      continue;
    }
    // Position, second position, birth date or height put right.
    if (f.position !== undefined) p.position = f.position;
    if (f.secondary !== undefined) p.secondary = f.secondary;
    const when = parseDate(f.born);
    if (when !== null) { p.birthYear = when.year; p.birthDay = when.day; }
    if (f.heightCm !== undefined) p.heightCm = f.heightCm;
    if (f.ability !== undefined) p.ability = f.ability;
    if (f.potential !== undefined) p.potential = f.potential;
    if (f.first === undefined || f.last === undefined) { log(`  corrected: ${f.from} (${f.club})`); continue; }
    p.first = f.first;
    p.last = f.last;
    log(`  corrected: ${f.from} is ${f.first} ${f.last} (${f.club})`);
  }
}

/**
 * Photos put in `data/local/real-photos-manual/` by hand, named like `POR-Eduardo-Assuncao.jpg`
 * (country code, first name, surname): copied over, they win over whatever the source has.
 */
function applyManualPhotos(leagues: RealLeague[]): number {
  const dir = join('data', 'local', 'real-photos-manual');
  mkdirSync(dir, { recursive: true });
  const files = new Map<string, string>();
  for (const f of readdirSync(dir)) {
    const m = /^(.+)\.(jpe?g|png|webp|gif)$/i.exec(f);
    if (m !== null) files.set(nameKey(m[1]), f);
  }
  let used = 0;
  for (const l of leagues) for (const c of l.clubs) for (const p of c.players) {
    const f = files.get(nameKey(`${l.nation} ${p.first} ${p.last}`));
    if (f === undefined) continue;
    const ext = f.split('.').pop()!.toLowerCase().replace('jpeg', 'jpg');
    const out = `manual-${nameKey(`${l.nation} ${p.first} ${p.last}`).replace(/ /g, '-')}.${ext}`;
    writeFileSync(join(PHOTO_DIR, out), readFileSync(join(dir, f)));
    p.photo = out;
    used++;
  }
  return used;
}

/** "João S. Pinheiro" on the under-21 list and "João Pinheiro" in the first team are one player: he stays in the first team. */
function dedupeYouth(leagues: RealLeague[]): void {
  const loose = (p: RealPlayer): string => {
    const f = nameKey(p.first).split(' ')[0] ?? '';
    const l = nameKey(p.last).split(' ').pop() ?? '';
    return `${f} ${l}`;
  };
  for (const l of leagues) for (const c of l.clubs) {
    if (c.youth === undefined) continue;
    const senior = new Set(c.players.map(loose));
    c.youth = c.youth.filter((p) => !senior.has(loose(p)));
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const want = (code: string): boolean => only.length === 0 || only.includes(code);

  log('National-team rosters...');
  const intl = await fetchInternationals();
  log(`  ${intl.list.length} players, ${intl.coaches.length} head coaches`);

  // Keep what an earlier run gathered for countries not asked for this time.
  const leagues: RealLeague[] = [];
  if (only.length > 0 && existsSync(OUT)) {
    const old = JSON.parse(readFileSync(OUT, 'utf8')) as RealDb;
    leagues.push(...old.leagues.filter((l) => !want(l.nation)));
  }

  // One job per site, its divisions one after the other; sites run side by side, each asked once a second.
  const jobs: (() => Promise<RealLeague[]>)[] = [];
  const byPortal = new Map<string, DpLeague[]>();
  for (const def of DP_LEAGUES) if (want(def.nation)) byPortal.set(def.host, [...(byPortal.get(def.host) ?? []), def]);
  for (const defs of byPortal.values()) {
    jobs.push(async () => {
      const out: RealLeague[] = [];
      for (const def of defs) {
        try {
          const league = await fetchDataProject(def);
          for (const extra of def.more ?? []) league.clubs.push(...(await fetchDataProject({ ...def, comp: extra })).clubs);
          out.push(league);
        } catch (err) {
          log(`FAILED ${def.nation} ${def.name}: ${(err as Error).message}`);
        }
      }
      return out;
    });
  }
  if (want('POL')) jobs.push(async () => [await fetchPlusLiga()]);
  if (want('ITA')) jobs.push(async () => [await fetchSuperLega(1), await fetchSuperLega(2)]);

  const results = await Promise.allSettled(jobs.map((j) => j()));
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const league of r.value) {
        fillNations(league, intl.list);
        leagues.push(league);
      }
    } else {
      log(`FAILED: ${(r.reason as Error).message}`);
    }
  }
  leagues.sort((a, b) => a.nation.localeCompare(b.nation) || a.tier - b.tier);

  // Under-21 squads, onto their top-flight clubs.
  const youthLeagues: RealLeague[] = [];
  await Promise.all(DP_YOUTH.filter((d) => want(d.nation)).map(async (def) => {
    try {
      const y = await fetchDataProject(def);
      for (const extra of def.more ?? []) y.clubs.push(...(await fetchDataProject({ ...def, comp: extra })).clubs);
      youthLeagues.push(y);
    } catch (err) {
      log(`FAILED youth ${def.nation}: ${(err as Error).message}`);
    }
  }));
  log(`  ${attachYouth(leagues, youthLeagues)} youth players on top-flight clubs`);

  applyCorrections(leagues);
  dedupeYouth(leagues);

  // Photos, once every roster is read: hosts side by side, each at its own pace.
  log(`Photos: ${photoUrls.size} to get...`);
  const blankFile = join('data', 'local', 'real-photos-blank.json');
  const blankUrls = new Set<string>(existsSync(blankFile) ? JSON.parse(readFileSync(blankFile, 'utf8')) as string[] : []);
  const byHost = new Map<string, [{ photo?: string | null }, { url: string; name: string }][]>();
  for (const entry of photoUrls) {
    const host = new URL(entry[1].url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), entry]);
  }
  await Promise.all([...byHost.values()].map(async (list) => {
    for (const [p, { url, name }] of list) p.photo = blankUrls.has(url) ? null : await getImage(url, name, PHOTO_DIR);
  }));
  // The "no photo yet" picture a site shows for many players is not anyone's face: the same file
  // turning up three times or more is that, and is dropped.
  const seen = new Map<string, string[]>();
  for (const f of readdirSync(PHOTO_DIR)) {
    const h = createHash('sha1').update(readFileSync(join(PHOTO_DIR, f))).digest('hex');
    seen.set(h, [...(seen.get(h) ?? []), f]);
  }
  const blank = new Set<string>();
  for (const files of seen.values()) if (files.length >= 3) for (const f of files) blank.add(f);
  for (const f of blank) unlinkSync(join(PHOTO_DIR, f));
  for (const [p, { url }] of photoUrls) if (p.photo && blank.has(p.photo)) blankUrls.add(url);
  writeFileSync(blankFile, JSON.stringify([...blankUrls]));
  let withPhoto = 0;
  for (const l of leagues) for (const c of l.clubs) for (const p of c.players) {
    if (p.photo && blank.has(p.photo)) p.photo = null;
    if (p.photo) withPhoto++;
  }
  const fromZz = want('POR') ? await fillFromZeroZero(leagues) : 0;
  log(`  ${fromZz} photos from zerozero.pt`);
  const manual = applyManualPhotos(leagues);
  log(`  ${withPhoto} players with a photo from the sources, ${manual} put in by hand, ${blank.size} placeholder pictures dropped.`);

  const db: RealDb = {
    version: 1,
    builtAt: new Date().toISOString(),
    gender: 'men',
    sources: leagues.map((l) => ({ name: `${l.source}: ${l.name} ${l.season}`, url: l.url, note: `${l.clubs.length} clubs` })),
    leagues,
    internationals: intl.list,
    nationalCoaches: intl.coaches,
    internationalsSource: intl.source,
  };
  mkdirSync(join('data', 'local'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(db, null, 1));

  const players = leagues.reduce((s, l) => s + l.clubs.reduce((t, c) => t + c.players.length, 0), 0);
  const st = fetchStats();
  log(`\nWrote ${OUT}: ${leagues.length} leagues, ${players} players, ${intl.list.length} internationals.`);
  log(`Requests: ${st.network} to the network, ${st.cached} from the cache.`);
  if (unknownPositions.size > 0) log(`Positions not recognised: ${[...unknownPositions].map(([k, v]) => `${k} (${v})`).join(', ')}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('real-db/fetch.ts')) {
  main().catch((err) => {
    process.stderr.write(String(err instanceof Error ? err.stack : err) + '\n');
    process.exit(1);
  });
}

export { titleCase };
