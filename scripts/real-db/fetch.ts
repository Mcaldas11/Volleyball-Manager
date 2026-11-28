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
import { bankFor, NAME_BANKS } from '../../src/engine/world/names.ts';
import { NATIONS } from '../../src/engine/world/nations.ts';
import { readdirSync, unlinkSync } from 'node:fs';
import { decode, Disallowed, fetchStats, getImage, getPage, LOGO_DIR, PHOTO_DIR, nameKey, splitSurnameFirst, textLines, titleCase } from './http.ts';

/** `--women`: the women's leagues, into a file of their own. */
const WOMEN = process.argv.includes('--women');
const OUT = join('data', 'local', WOMEN ? 'real-db-women.json' : 'real-db.json');

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
for (const [group, bank] of Object.entries(NAME_BANKS)) {
  for (const n of bank.first) FIRST_NAMES.add(nameKey(n));
  for (const n of bankFor(group, true).first) FIRST_NAMES.add(nameKey(n));
}

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
  { nation: 'SRB', tier: 1, host: 'ossrb-web.dataproject.com', comp: 104, name: 'Superliga', season: '2026/27', federation: 'OSS' },
  { nation: 'FIN', tier: 1, host: 'lml-web.dataproject.com', comp: 156, name: 'Mestaruusliiga', season: '2026/27', federation: 'Lentopalloliitto' },
  // Second tiers.
  { nation: 'SRB', tier: 2, host: 'ossrb-web.dataproject.com', comp: 110, name: 'Prva liga', season: '2026/27', federation: 'OSS' },
  { nation: 'POR', tier: 2, host: 'fpv-web.dataproject.com', comp: 148, name: '2.ª Divisão', season: '2026/27', federation: 'FPV' },
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

/** The women's leagues, the same federations' portals. */
const DP_LEAGUES_WOMEN: DpLeague[] = [
  { nation: 'POR', tier: 1, host: 'fpv-web.dataproject.com', comp: 145, name: 'Liga Solverde.pt', season: '2026/27', federation: 'FPV' },
  { nation: 'GER', tier: 1, host: 'vbl-web.dataproject.com', comp: 193, name: '1. Bundesliga', season: '2026/27', federation: 'VBL' },
  { nation: 'ESP', tier: 1, host: 'rfevb-web.dataproject.com', comp: 165, name: 'Liga Iberdrola', season: '2026/27', federation: 'RFEVB' },
  { nation: 'SLO', tier: 1, host: 'ozs-web.dataproject.com', comp: 146, name: 'Sportklub Superliga', season: '2026/27', federation: 'OZS' },
  { nation: 'ROU', tier: 1, host: 'frv-web.dataproject.com', comp: 80, name: 'Divizia A1', season: '2026/27', federation: 'FRV' },
  { nation: 'BUL', tier: 1, host: 'bvf-web.dataproject.com', comp: 66, name: 'Super League', season: '2026/27', federation: 'BVF' },
  { nation: 'UKR', tier: 1, host: 'uvf-web.dataproject.com', comp: 189, name: 'Superliga', season: '2026/27', federation: 'UVF' },
  { nation: 'HUN', tier: 1, host: 'hvf-web.dataproject.com', comp: 68, name: 'Extraliga', season: '2026/27', federation: 'MRSZ' },
  { nation: 'SWE', tier: 1, host: 'svbf-web.dataproject.com', comp: 458, name: 'Elitserien', season: '2026/27', federation: 'SVBF' },
  { nation: 'NOR', tier: 1, host: 'nvbf-web.dataproject.com', comp: 97, name: 'Mizunoligaen', season: '2026/27', federation: 'NVBF' },
  { nation: 'SVK', tier: 1, host: 'svf-web.dataproject.com', comp: 97, name: 'Extraliga', season: '2026/27', federation: 'SVF' },
  { nation: 'CRO', tier: 1, host: 'hos-web.dataproject.com', comp: 135, name: 'Superliga', season: '2026/27', federation: 'HOS' },
  { nation: 'EST', tier: 1, host: 'evf-web.dataproject.com', comp: 97, name: 'Meistriliiga', season: '2026/27', federation: 'EVF' },
  { nation: 'ISR', tier: 1, host: 'iva-web.dataproject.com', comp: 51, name: 'Premier League', season: '2026/27', federation: 'IVA' },
  { nation: 'BIH', tier: 1, host: 'osbih-web.dataproject.com', comp: 52, name: 'Premijer Liga', season: '2026/27', federation: 'OSBiH' },
  { nation: 'SRB', tier: 1, host: 'ossrb-web.dataproject.com', comp: 105, name: 'Superliga', season: '2026/27', federation: 'OSS' },
  { nation: 'FIN', tier: 1, host: 'lml-web.dataproject.com', comp: 157, name: 'Mestaruusliiga', season: '2026/27', federation: 'Lentopalloliitto' },
  { nation: 'GRE', tier: 1, host: 'eope-web.dataproject.com', comp: 19, name: 'Volley League', season: '2026/27', federation: 'EOPE' },
  { nation: 'SRB', tier: 2, host: 'ossrb-web.dataproject.com', comp: 111, name: 'Prva liga', season: '2026/27', federation: 'OSS' },
  { nation: 'POR', tier: 2, host: 'fpv-web.dataproject.com', comp: 147, name: '2.ª Divisão', season: '2026/27', federation: 'FPV' },
  { nation: 'GER', tier: 2, host: 'vbl-web.dataproject.com', comp: 198, name: '2. Liga Pro', season: '2026/27', federation: 'VBL' },
  { nation: 'ESP', tier: 2, host: 'rfevb-web.dataproject.com', comp: 164, name: 'Superliga 2', season: '2026/27', federation: 'RFEVB' },
  { nation: 'SLO', tier: 2, host: 'ozs-web.dataproject.com', comp: 147, name: '1. liga', season: '2026/27', federation: 'OZS' },
  { nation: 'ROU', tier: 2, host: 'frv-web.dataproject.com', comp: 83, more: [84], name: 'Divizia A2', season: '2026/27', federation: 'FRV' },
  { nation: 'BUL', tier: 2, host: 'bvf-web.dataproject.com', comp: 71, name: 'Top League', season: '2026/27', federation: 'BVF' },
  { nation: 'UKR', tier: 2, host: 'uvf-web.dataproject.com', comp: 190, name: 'Vyshcha Liha', season: '2026/27', federation: 'UVF' },
  { nation: 'HUN', tier: 2, host: 'hvf-web.dataproject.com', comp: 69, name: 'NB I', season: '2026/27', federation: 'MRSZ' },
  { nation: 'SWE', tier: 2, host: 'svbf-web.dataproject.com', comp: 460, more: [459], name: 'Division 1', season: '2026/27', federation: 'SVBF' },
  { nation: 'NOR', tier: 2, host: 'nvbf-web.dataproject.com', comp: 98, name: '1. divisjon', season: '2026/27', federation: 'NVBF' },
  { nation: 'SVK', tier: 2, host: 'svf-web.dataproject.com', comp: 104, name: '1. liga', season: '2026/27', federation: 'SVF' },
  { nation: 'CRO', tier: 2, host: 'hos-web.dataproject.com', comp: 136, name: 'Prva liga', season: '2026/27', federation: 'HOS' },
  { nation: 'EST', tier: 2, host: 'evf-web.dataproject.com', comp: 106, name: 'Esiliiga', season: '2026/27', federation: 'EVF' },
];

const DP_YOUTH_WOMEN: DpLeague[] = [
  { nation: 'POR', tier: 9, host: 'fpv-web.dataproject.com', comp: 150, more: [153], name: 'Sub21', season: '2026/27', federation: 'FPV' },
  { nation: 'HUN', tier: 9, host: 'hvf-web.dataproject.com', comp: 71, name: 'U20', season: '2026/27', federation: 'MRSZ' },
  { nation: 'SVK', tier: 9, host: 'svf-web.dataproject.com', comp: 101, name: '1. liga juniorky', season: '2026/27', federation: 'SVF' },
  { nation: 'EST', tier: 9, host: 'evf-web.dataproject.com', comp: 105, name: 'U-20', season: '2026/27', federation: 'EVF' },
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
  // "CA Madalena B (Sub21)": the club's second under-21 side is the club's too.
  return youthName.replace(/\(.*?\)/g, ' ').replace(/\s+B\s*$/, ' ').replace(/[-–]\s*(juniori|junior|u-?2\d|sub-?2\d)\b.*$/i, ' ')
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
      // The same side can play in two divisions of the under-21s: each player once.
      const had = new Set((club.youth ?? []).map((p) => nameKey(`${p.first} ${p.last}`)));
      club.youth = [...(club.youth ?? []), ...yc.players.filter((p) => {
        const k = nameKey(`${p.first} ${p.last}`);
        if (senior.has(k) || had.has(k)) return false;
        had.add(k);
        return true;
      })];
      n += yc.players.length;
    }
  }
  return n;
}

/** A season label's first year: "2022/2023", "FPV 2021/22", "21/22". */
function seasonYear(label: string): number | null {
  let m = /(19|20)(\d{2})\s*[/-]\s*(\d{2,4})/.exec(label);
  if (m !== null) return Number(m[1] + m[2]);
  m = /\b(\d{2})\s*\/\s*(\d{2})\b/.exec(label);
  if (m !== null && Number(m[2]) === (Number(m[1]) + 1) % 100) return 2000 + Number(m[1]);
  return null;
}

/** The clubs a DataProject player page lists, the seasons it can tell, newest first. */
function dpCareer(html: string): { year: number; club: string }[] | undefined {
  // The history list: a team and a season to each row.
  const out: { year: number; club: string }[] = [];
  for (const m of html.matchAll(/HistoryListView_ctrl(\d+)_link"[^>]*>([\s\S]*?)<\/span>[\s\S]*?HistoryListView_ctrl\1_period"[^>]*>([\s\S]*?)<\/span>/g)) {
    const club = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const year = seasonYear(decode(m[3]));
    if (club === '' || year === null) continue;
    if (!out.some((x) => x.year === year && x.club === club)) out.push({ year, club });
  }
  if (out.length > 0) return out;
  if (/HistoryListView/.test(html)) return undefined;
  // An older page: the table under the history heading (not the menu's link to the history page).
  const at = html.search(/<h3>\s*(?:Hist[oó]ri[ae]|History|Historik|Zgodovina|Istoric|История|Історія)\s*<\/h3>/);
  if (at < 0) return undefined;
  const table = /<table[\s\S]*?<\/table>/.exec(html.slice(at));
  if (table === null) return undefined;
  for (const row of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    if (cells.length < 2 || cells[0] === '') continue;
    const year = seasonYear(cells[1]);
    if (year === null) continue;
    if (!out.some((x) => x.year === year && x.club === cells[0])) out.push({ year, club: cells[0] });
  }
  return out.length > 0 ? out : undefined;
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
  // The table's rows: its team links, up to the first one seen twice (the
  // results breakdown and the other phases' lists come after it).
  const ids: number[] = [];
  const table = [...html.matchAll(/TeamID=(\d+)&(?:amp;)?ID=\d+" id="TeamDetails_Link"/g)];
  for (const m of table) {
    const id = Number(m[1]);
    if (ids.includes(id)) break;
    ids.push(id);
  }
  if (ids.length > 0) return ids;
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
  const leagueLogo = compLogo !== null ? await getImage(decode(compLogo[1]), `league-${WOMEN ? 'w-' : ''}${def.nation}-${def.tier}`) : null;
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
  // The competition lists every club entered in any of its phases (the A2
  // series, the relegation play-off): only those in the league table play it.
  if (order.length >= 6 && order.length >= teams.size * 0.6 && order.length < teams.size) {
    for (const id of [...teams.keys()]) {
      if (order.includes(id)) continue;
      log(`  ${def.nation} ${def.comp}: ${teams.get(id) || id} is not in the table, left out`);
      teams.delete(id);
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
      if (after.slice(0, 12).some((l) => /^(till och med|hasta el|slutter|bis|jusqu|until|até|fino al|do|koniec|vége|ends at)\s.*\d{4}/i.test(l))) continue;
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
          p.career = dpCareer(pp);
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
  // The women's league runs on the same site software, under its own address.
  const base = WOMEN ? 'https://www.tauronliga.pl' : 'https://www.plusliga.pl';
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
      // His career in the league: from, to, position, number, club — a row at a time.
      const k = lines.indexOf('Drużyna', lines.indexOf('KARIERA ZAWODOWA W LIDZE'));
      if (k > 0) {
        const career: { year: number; club: string }[] = [];
        // A row: from, to, then the position and number when given, the club last.
        const isDate = (l: string | undefined): boolean => l !== undefined && /^\d{2}\.\d{2}\.\d{4}$/.test(l);
        for (let r = k + 1; isDate(lines[r]) && isDate(lines[r + 1]);) {
          const [, mo, y] = lines[r].split('.').map(Number);
          const year = mo >= 7 ? y : y - 1;
          let e = r + 2;
          while (e < lines.length && e < r + 6 && !(isDate(lines[e]) && isDate(lines[e + 1])) && !/^Powrót/.test(lines[e])) e++;
          const club = lines[e - 1];
          if (e > r + 2 && !/^\d+$/.test(club) && !career.some((x) => x.year === year && x.club === club)) career.push({ year, club });
          r = e;
        }
        if (career.length > 0) p.career = career;
      }
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
  return { nation: 'POL', tier: 1, name: WOMEN ? 'TauronLiga' : 'PlusLiga', season: '2026/27', source: WOMEN ? 'TauronLiga' : 'PlusLiga', url: `${base}/teams.html`, clubs };
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
    // The club's badge (LogoSocieta, by its code); the team's own picture is mostly a blank stand-in.
    const society = /Proc=LogoSocieta&(?:amp;)?maxWidth=\d+&(?:amp;)?Key=([^&"]+)/.exec(page);
    const logo = (society !== null
      ? await getImage(`${base}/GetLogo.aspx?Field=LogoWeb&Proc=LogoSocieta&maxWidth=220&Key=${society[1]}&Char=True`, `ITA-club-${name}`)
      : null)
      ?? await getImage(`${base}/GetLogo.aspx?Field=LogoWeb&maxWidth=220&Proc=LogoSquadra&Web=0&Key=${id}&Char=False`, `ITA-${name}`);
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
  Sweden: 'SWE', 'Dominican Republic': 'DOM', Kenya: 'KEN', Vietnam: 'VIE', Netherlands_: 'NED', Thailand_: 'THA',
};

async function fetchInternationals(): Promise<{ list: RealInternational[]; coaches: RealNationalCoach[]; source: string }> {
  const page = WOMEN ? "2025_FIVB_Women's_Volleyball_World_Championship_squads" : "2025_FIVB_Men's_Volleyball_World_Championship_squads";
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
    for (const m of sec.matchAll(/<li[^>]*>\s*\d+\s*<a([^>]*)>([^<]+)<\/a>[\s\S]*?>(S|OH|OP|MB|L)<\/span>\s*<\/li>/g)) {
      const name = decode(m[2]).trim();
      const words = name.split(' ');
      // A page of his own, when the link is not a red one.
      const href = /href="(https:\/\/en\.wikipedia\.org\/wiki\/[^"?]+)"/.exec(m[1]);
      const wiki = href !== null && !/class="new"/.test(m[1]) ? decode(href[1]) : undefined;
      list.push({ nation, first: words.slice(0, -1).join(' '), last: words[words.length - 1], position: WIKI_POS[m[3]] ?? null, wiki });
    }
  }
  return { list, coaches, source: `https://en.wikipedia.org/wiki/${page} (rosters as registered with the FIVB)` };
}

// ---- zerozero.pt leagues: the countries whose federation has no portal -----------

/** A league zerozero follows this season: its edition, the country and the division. */
interface ZzLeague { nation: string; tier: number; name: string; edition: string }

/** Top flights only zerozero has for 2026/27 (the men's; it follows no women's league abroad). */
const ZZ_LEAGUES: ZzLeague[] = [
  { nation: 'BEL', tier: 1, name: 'Lotto Volley League', edition: '/edicao/lotto-volley-league-fase-regular-2026-27/226976' },
  { nation: 'FRA', tier: 1, name: 'Marmara SpikeLigue', edition: '/edicao/liga-francesa-voleibol-2026-27/226978' },
  { nation: 'CZE', tier: 1, name: 'Extraliga', edition: '/edicao/liga-checa-voleibol-fase-regular-2026-27/227521' },
  { nation: 'AUT', tier: 1, name: 'Austrian Volley League', edition: '/edicao/austrian-league-voleibol-2026-27/227528' },
];

/** zerozero's flags, two letters, to the game's three-letter codes. */
const ISO2: Record<string, string> = {
  PL: 'POL', IT: 'ITA', FR: 'FRA', SI: 'SLO', RS: 'SRB', NL: 'NED', DE: 'GER', BG: 'BUL', UA: 'UKR', TR: 'TUR', RU: 'RUS',
  CZ: 'CZE', GR: 'GRE', BE: 'BEL', FI: 'FIN', PT: 'POR', ES: 'ESP', HR: 'CRO', RO: 'ROU', SK: 'SVK', EE: 'EST', LV: 'LAT',
  AT: 'AUT', CH: 'SUI', DK: 'DEN', SE: 'SWE', NO: 'NOR', HU: 'HUN', IL: 'ISR', MK: 'MKD', BA: 'BIH', ME: 'MNE', BR: 'BRA',
  AR: 'ARG', CL: 'CHI', CO: 'COL', VE: 'VEN', PE: 'PER', UY: 'URU', US: 'USA', CU: 'CUB', CA: 'CAN', MX: 'MEX', PR: 'PUR',
  DO: 'DOM', JP: 'JPN', IR: 'IRI', CN: 'CHN', KR: 'KOR', QA: 'QAT', AU: 'AUS', IN: 'IND', TH: 'THA', KZ: 'KAZ', EG: 'EGY',
  TN: 'TUN', MA: 'MAR', DZ: 'ALG', CM: 'CMR', ZA: 'RSA',
};

/** zerozero's squad sections, by position. */
function zzPosition(section: string): RealPosition | null {
  const s = section.toLowerCase();
  if (/distrib/.test(s)) return 'S';
  if (/l[ií]bero/.test(s)) return 'L';
  if (/central|zona 3/.test(s)) return 'MB';
  if (/oposto|zona 2/.test(s)) return 'OP';
  if (/zona 4|recetor|ponta/.test(s)) return 'OH';
  return null;
}

/** A zerozero page about a person: asked again when the copy kept is someone else's. */
async function zzPersonPage(url: string, name: string): Promise<string> {
  const key = nameKey(name);
  const page = await getPage(url);
  const title = nameKey(decode(/<title>([^<]*)/.exec(page)?.[1] ?? ''));
  if (title.includes(key)) return page;
  const again = await getPage(url, { fresh: true });
  if (!nameKey(decode(/<title>([^<]*)/.exec(again)?.[1] ?? '')).includes(key)) throw new Error(`zerozero gave another person's page for ${name}`);
  return again;
}

async function fetchZeroZeroLeague(def: ZzLeague): Promise<RealLeague> {
  const base = 'https://www.zerozero.pt';
  let edition = await getPage(base + def.edition);
  // The copy kept may be another page (zerozero's general list): asked again, the edition's own.
  if (!/Voleibol|Volley|League|Liga/i.test(/<title>([^<]*)/.exec(edition)?.[1] ?? '')) edition = await getPage(base + def.edition, { fresh: true });
  const season = Math.max(0, ...[...edition.matchAll(/epoca_id=(\d+)/g)].map((m) => Number(m[1])));
  // The teams in the edition's table, in its order (the site's menus add football clubs: their pages say so).
  const teams = [...new Set([...edition.matchAll(/href="(\/equipa\/[^"/]+\/\d+)[^"]*"/g)].map((m) => m[1]))];
  const clubs: RealClub[] = [];
  for (const team of teams) {
    const url = `${base}${team}${season > 0 ? `?epoca_id=${season}` : ''}`;
    let page = await getPage(url);
    let title = decode(/<title>([^<]*)/.exec(page)?.[1] ?? '');
    // zerozero now and then answers with another team's page: asked again, it gives the right one.
    // (A page that is not about the team in its own address; the menus' football clubs are, and are left out below.)
    const slugWords = team.split('/')[2].split('-').filter((w) => w.length >= 4);
    const titleKey = nameKey(title);
    if (!/\(Voleibol\)/.test(title) && !slugWords.some((w) => titleKey.includes(w))) {
      page = await getPage(url, { fresh: true });
      title = decode(/<title>([^<]*)/.exec(page)?.[1] ?? '');
    }
    if (!/\(Voleibol\)/.test(title)) continue;
    const name = title.replace(/\s*\(Voleibol\)[\s\S]*$/, '').trim();
    const logoSrc = /(\/\/?img\/logos\/equipas\/\d+_[^"')\s]+)/.exec(page)?.[1];
    const logo = logoSrc !== undefined
      ? await getImage(`${base}/${logoSrc.replace(/^\/+/, '')}`, `${def.nation}-${name}`)
      : null;
    const squad = /id="team_squad"[\s\S]*?(?=<div class="card-data |<\/main>|$)/.exec(page)?.[0] ?? '';
    const players: RealPlayer[] = [];
    const coaches: RealCoach[] = [];
    let section = '';
    // The list a piece at a time: a section's heading (the position), then its people.
    for (const block of squad.split(/(?=<div class="section">)|(?=<div class="staff">)/)) {
      const heading = /^<div class="section">([^<]+)<\/div>/.exec(block);
      if (heading !== null) { section = decode(heading[1]).trim(); continue; }
      const link = /href="\/(jogador|treinador)\/([^"/]+)\/(\d+)[^"]*">([^<]+)<\/a>/.exec(block);
      if (link === null) continue;
      const fullName = decode(link[4]).trim();
      const words = fullName.split(/\s+/);
      const first = words.slice(0, -1).join(' ') || words[0];
      const last = words.length > 1 ? words[words.length - 1] : '';
      const src = /background-image: url\('([^']+)'\)/.exec(block)?.[1] ?? '';
      const photo = src === '' || /No_Photo|default/i.test(src) ? null : src;
      if (link[1] === 'treinador') {
        const coach: RealCoach = { first, last, role: /adjunt|assist/i.test(section) ? 'assistant' : 'head' };
        if (photo !== null) photoUrls.set(coach, { url: photo.startsWith('http') ? photo : base + photo, name: `${def.nation}-zz-coach-${first}-${last}` });
        coaches.push(coach);
        continue;
      }
      const p = emptyPlayer();
      p.first = first;
      p.last = last;
      p.position = zzPosition(section);
      const flag = /flag:([A-Z]{2})/.exec(block)?.[1];
      p.nation = flag !== undefined ? (ISO2[flag] ?? null) : null;
      // His birth date from his own page; his age on the squad list where the page has none.
      try {
        const own = await zzPersonPage(`${base}/jogador/${link[2]}/${link[3]}`, last || first);
        const born = /,\s*(\d{4})-(\d{2})-(\d{2})\s*</.exec(own);
        const d = born !== null ? parseDate(`${born[1]}-${born[2]}-${born[3] === '00' ? '01' : born[3]}`) : null;
        if (d !== null) { p.birthYear = d.year; p.birthDay = d.day; }
      } catch { /* the squad list's age will do */ }
      if (p.birthYear === null) {
        const age = /<span>(\d{2}) anos<\/span>/.exec(block);
        if (age !== null) p.birthYear = 2026 - Number(age[1]);
      }
      if (photo !== null) photoUrls.set(p, { url: photo.startsWith('http') ? photo : base + photo, name: `${def.nation}-zz-${first}-${last}` });
      // His seasons, club by club.
      try {
        const seasons = await zzPersonPage(`${base}/jogador/${link[2]}/${link[3]}/epocas`, last || first);
        const table = /<table[\s\S]*?<\/table>/.exec(seasons)?.[0] ?? '';
        const career: NonNullable<RealPlayer['career']> = [];
        for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
          const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
          const year = cells.length > 2 ? seasonYear(cells[1]) : null;
          const clubName = cells[2]?.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
          const apps = /^\d+$/.test(cells[4] ?? '') ? Number(cells[4]) : undefined;
          const points = /^\d+$/.test(cells[5] ?? '') ? Number(cells[5]) : undefined;
          if (year !== null && clubName && !career.some((c) => c.year === year && c.club === clubName)) career.push({ year, club: clubName, apps, points });
        }
        if (career.length > 0) p.career = career;
      } catch { /* no seasons page */ }
      players.push(p);
    }
    clubs.push({ name, shortName: shortNameOf(name), city: null, arena: null, standing: clubs.length + 1, logo, coaches, players });
    log(`  ${def.nation} ${name}: ${players.length} players (zerozero)`);
  }
  return { nation: def.nation, tier: def.tier, name: def.name, season: '2026/27', source: 'zerozero.pt', url: base + def.edition, clubs };
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
      // The page must be the club's: its title names it too.
      const title = /<title>([^<(]+)/.exec(page);
      if (title !== null && ![...clubTokens(decode(title[1]))].some((t) => clubTokens(club!.name).has(t))) continue;
      const entries = [...page.matchAll(/class="photo" style="background-image: url\('([^']+)'\)"><\/div><div class="name">[\s\S]*?<a href="(\/(jogador|treinador)\/[^"?]+)[^"]*">([^<]+)<\/a>/g)];
      for (const [, src, href, kind, rawName] of entries) {
        const name = decode(rawName).trim();
        const people: { first: string; last: string; photo?: string | null; aka?: string[]; career?: { year: number; club: string; apps?: number; points?: number }[] }[] =
          kind === 'jogador' ? [...club.players, ...(club.youth ?? [])] : (club.coaches ?? []);
        const who = people.find((x) => samePerson(x.first, x.last, name, people, x.aka));
        if (who === undefined) continue;
        if (!who.photo && !/No_Photo/i.test(src)) {
          who.photo = await getImage(src.startsWith('http') ? src : base + src, `POR-zz-${kind}-${who.first}-${who.last}`, PHOTO_DIR);
          if (who.photo) found++;
        }
        // His career, season by season.
        if (kind === 'jogador') {
          try {
            const seasons = await getPage(`${base}${href}/epocas`);
            const career: { year: number; club: string; apps?: number; points?: number }[] = [];
            // The first table is the season-by-season one; what follows repeats it by competition.
            const first = /<table[\s\S]*?<\/table>/.exec(seasons)?.[0] ?? '';
            for (const row of first.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
              const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
              const year = cells.length > 2 ? seasonYear(cells[1]) : null;
              const clubName = cells[2]?.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
              // Matches (J) and points (GM, goals in football, points in volleyball) where the season has them.
              const apps = /^\d+$/.test(cells[4] ?? '') ? Number(cells[4]) : undefined;
              const points = /^\d+$/.test(cells[5] ?? '') ? Number(cells[5]) : undefined;
              if (year !== null && clubName && !career.some((c) => c.year === year && c.club === clubName)) career.push({ year, club: clubName, apps, points });
            }
            // The right man: his latest season on zerozero is at this club (a page's address is not always its club's).
            const latest = career.reduce((m, c) => Math.max(m, c.year), 0);
            const here = clubTokens(club.name);
            const sameClub = career.some((c) => c.year === latest && [...clubTokens(c.club)].some((t) => here.has(t)));
            if (career.length > 0 && sameClub) who.career = career;
          } catch (err) {
            log(`  zerozero career ${name}: ${(err as Error).message}`);
          }
        }
      }
    }
  }
  return found;
}

// ---- National-team players with no club in the sources: their age and height ------

/** VIS position codes. */
const VIS_POS: Record<string, RealPosition> = { '1': 'S', '2': 'OP', '3': 'OH', '4': 'MB', '5': 'L' };

/**
 * A national-team player no roster has: his birth date and height, from his
 * Wikipedia page when he has one, and otherwise from the FIVB's registrations
 * for the championship (which give no names): where his team has one player
 * left at his position, that is him.
 */
async function ageInternationals(intl: RealInternational[], leagues: RealLeague[]): Promise<number> {
  const onRoster = new Set<string>();
  for (const l of leagues) for (const c of l.clubs) for (const p of [...c.players, ...(c.youth ?? [])]) onRoster.add(nameKey(`${p.first} ${p.last}`));
  const missing = intl.filter((p) => !onRoster.has(nameKey(`${p.first} ${p.last}`)));
  for (const p of missing) {
    if (p.wiki === undefined) continue;
    try {
      const page = await getPage(p.wiki);
      const bday = /class="bday">(\d{4})-(\d{2})-(\d{2})</.exec(page);
      if (bday !== null) {
        const d = parseDate(`${bday[1]}-${bday[2]}-${bday[3]}`);
        if (d !== null) { p.birthYear = d.year; p.birthDay = d.day; }
      }
      const h = /Height<\/th>[\s\S]{0,200}?(\d)\.(\d{2})\s*m/.exec(page);
      if (h !== null) p.heightCm = Number(h[1]) * 100 + Number(h[2]);
    } catch { /* no page after all */ }
  }
  // The FIVB's registrations, anonymous: one left per team and position is the one.
  try {
    const body = `Request=${encodeURIComponent(`<Request Type="GetVolleyPlayerList" Fields="No Birthdate Height Position TeamCode"><Filter NoTournament="${WOMEN ? 1521 : 1520}"/></Request>`)}`;
    const xml = await getPage('https://www.fivb.org/Vis2009/XmlRequest.asmx', { method: 'POST', body, contentType: 'application/x-www-form-urlencoded' });
    const regs = [...xml.matchAll(/<VolleyballPlayer ([^>]*)\/>/g)].map((m) => {
      const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
      return { team: a.TeamCode, pos: VIS_POS[a.Position], birth: a.Birthdate, height: Number(a.Height) / 10000 };
    });
    for (const team of new Set(intl.map((p) => p.nation))) {
      for (const pos of ['S', 'OP', 'OH', 'MB', 'L'] as RealPosition[]) {
        const squad = intl.filter((p) => p.nation === team && p.position === pos);
        const left = squad.filter((p) => p.birthYear === undefined);
        if (left.length !== 1) continue;
        // The registrations at this position not already someone's, by birth date.
        const known = new Set(squad.filter((p) => p.birthYear !== undefined).map((p) => p.birthYear));
        const free = regs.filter((r) => r.team === team && r.pos === pos && !known.has(Number(r.birth?.slice(0, 4))));
        if (free.length !== 1) continue;
        const d = parseDate(free[0].birth);
        if (d === null) continue;
        left[0].birthYear = d.year;
        left[0].birthDay = d.day;
        if (free[0].height > 150 && free[0].height < 230) left[0].heightCm = Math.round(free[0].height);
      }
    }
  } catch (err) {
    log(`  FIVB registrations: ${(err as Error).message}`);
  }
  // Still without a date: zerozero's search, a volleyball player of that name.
  const VOLLEY_POS = /^(DIST|LIB|Z4|Z2|CENT|OPO|OPOS|OP|PONT|PONTA)$/;
  for (const p of missing) {
    if (p.birthYear !== undefined) continue;
    try {
      const html = await getPage(`https://www.zerozero.pt/pesquisa?search_txt=${encodeURIComponent(`${p.first} ${p.last}`)}`);
      const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '|')).replace(/\s+/g, ' ').replace(/(\|\s*)+/g, '|');
      const want = nameKey(`${p.first} ${p.last}`);
      const last = nameKey(p.last);
      for (const m of text.matchAll(/\|(\d{1,2})\|([^|]{1,6})\|(?:\d{1,3}\|)?([^|]+)\|([^|]+)\|([^|,]+), (\d{4})-(\d{2})-(\d{2})\|/g)) {
        if (!VOLLEY_POS.test(m[2].trim())) continue;
        const short = nameKey(m[3]);
        const full = nameKey(m[4]);
        if (short !== want && !(full.includes(nameKey(p.first).split(' ')[0]) && full.includes(last))) continue;
        p.birthYear = Number(m[6]);
        if (m[7] !== '00') p.birthDay = parseDate(`${m[6]}-${m[7]}-${m[8] === '00' ? '01' : m[8]}`)?.day;
        break;
      }
    } catch { /* not found */ }
  }
  return missing.filter((p) => p.birthYear !== undefined).length;
}

// ---- Careers: only clubs, one a season -----------------------------------------

/** Labels a page's other tables put where a club would be: a birth date, a stats link. */
const NOT_A_CLUB = /^(statysty|f[öo]delse|fecha|date of birth|geburt|data (de )?nas|datum|rojstv|na[sș]ter|дата|születés|powrót|więcej)/i;
/** Countries' names, for the national-team rows some histories carry. */
const NATION_NAMES = new Set(NATIONS.map((n) => n.name.toLowerCase()));
/** A side of the club's own: its B team, its under-23s. */
const SIDE_SUFFIX = /\s+(?:[B-FY]|II|III|U\d{2}|team(?:\s+\S+)?|UGP|JSM.*|junior(?:s|es)?|juvenil|sub\s?\d{2})$/i;

function cleanClubName(name: string): string {
  let n = name.replace(/\s*\([^)]*\b(?:liga|league)\b[^)]*\)\s*$/i, '')
    .replace(/\s+(?:19|20)\d{2}\s*\/\s*\d{2,4}$/, '')
    .replace(/\s+/g, ' ').trim();
  return n;
}

/** Every career: its rows cleaned, those that are not clubs dropped, the club's own B side in the same season folded into it. */
function cleanCareers(leagues: RealLeague[]): number {
  let dropped = 0;
  for (const l of leagues) for (const c of l.clubs) for (const p of [...c.players, ...(c.youth ?? [])]) {
    if (p.career === undefined) continue;
    const kept: NonNullable<RealPlayer['career']> = [];
    for (const row of p.career) {
      const club = cleanClubName(row.club);
      // A national team is not a club.
      if (!/\p{L}{2}/u.test(club) || /^\d/.test(club) || NOT_A_CLUB.test(club) || NATION_NAMES.has(club.toLowerCase()) || row.year < 1980 || row.year > 2026) { dropped++; continue; }
      const base = club.replace(SIDE_SUFFIX, '').toLowerCase();
      const same = kept.find((k) => k.year === row.year && (() => {
        const kb = k.club.replace(SIDE_SUFFIX, '').toLowerCase();
        return kb === base || kb.startsWith(`${base} `) || base.startsWith(`${kb} `);
      })());
      if (same !== undefined) {
        // The senior side's name over its B team's.
        if (SIDE_SUFFIX.test(same.club) && !SIDE_SUFFIX.test(club)) same.club = club;
        if (row.apps !== undefined) { same.apps = (same.apps ?? 0) + row.apps; same.points = (same.points ?? 0) + (row.points ?? 0); }
        continue;
      }
      kept.push({ ...row, club });
    }
    if (kept.length > 0) p.career = kept; else delete p.career;
  }
  return dropped;
}

// ---- Club logos: stand-ins dropped, Germany's from its league's own site -------

/** A logo three or more clubs share is a portal's stand-in, not a badge: dropped, so the game draws its own. */
function dropStandInLogos(leagues: RealLeague[]): number {
  const hashOf = new Map<string, string>();
  const count = new Map<string, number>();
  for (const l of leagues) for (const c of l.clubs) {
    if (!c.logo) continue;
    const file = join(LOGO_DIR, c.logo);
    if (!existsSync(file)) { c.logo = null; continue; }
    const h = createHash('sha1').update(readFileSync(file)).digest('hex');
    hashOf.set(c.logo, h);
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  let dropped = 0;
  for (const l of leagues) for (const c of l.clubs) {
    if (c.logo && (count.get(hashOf.get(c.logo) ?? '') ?? 0) >= 3) { c.logo = null; dropped++; }
  }
  return dropped;
}

/** The Volleyball Bundesliga's team lists: each club's badge beside its name. */
const VBL_TEAM_PAGES: Record<'men' | 'women', string[]> = {
  men: ['/cms/home/1_bundesliga_maenner/teamsspieler/mannschaften.xhtml'],
  women: ['/cms/home/1_bundesliga_frauen/teams_spielerinnen/mannschaften.xhtml'],
};

async function fillGermanLogos(leagues: RealLeague[]): Promise<number> {
  const base = 'https://www.volleyball-bundesliga.de';
  const badges: { name: string; url: string }[] = [];
  for (const path of VBL_TEAM_PAGES[WOMEN ? 'women' : 'men']) {
    try {
      const page = await getPage(base + path);
      for (const m of page.matchAll(/src="([^"]+)"[^>]*class="teamLogo"[^>]*\/>\s*<\/div>\s*<h1 class="samsCmsComponentBlockHeader">([^<]+)<\/h1>/g)) {
        badges.push({ url: decode(m[1]), name: decode(m[2]).trim() });
      }
    } catch (err) { log(`  VBL logos: ${(err as Error).message}`); }
  }
  let found = 0;
  for (const l of leagues.filter((x) => x.nation === 'GER')) {
    for (const c of l.clubs) {
      if (c.logo) continue;
      // The badge whose club shares the most words with this one's name; a tie is no match.
      const mine = clubTokens(c.name);
      let best: { name: string; url: string } | undefined;
      let top = 0;
      let tied = false;
      for (const b of badges) {
        const n = [...clubTokens(b.name)].filter((t) => mine.has(t)).length;
        if (n > top) { top = n; best = b; tied = false; } else if (n === top && n > 0) tied = true;
      }
      if (best === undefined || tied) continue;
      c.logo = await getImage(best.url, `GER-vbl-${c.name}`);
      if (c.logo) found++;
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
  const file = join('data', 'local', WOMEN ? 'real-corrections-women.json' : 'real-corrections.json');
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
  const only = process.argv.slice(2).filter((s) => !s.startsWith('--')).map((s) => s.toUpperCase());
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
  for (const def of WOMEN ? DP_LEAGUES_WOMEN : DP_LEAGUES) if (want(def.nation)) byPortal.set(def.host, [...(byPortal.get(def.host) ?? []), def]);
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
  // tauronliga.pl shows the men's clubs under the women's league's name: no women's rosters to be had from it.
  if (want('POL') && !WOMEN) jobs.push(async () => [await fetchPlusLiga()]);
  // The women's Serie A site turns Anthropic's crawler away in its robots.txt: left alone.
  if (want('ITA') && !WOMEN) jobs.push(async () => [await fetchSuperLega(1), await fetchSuperLega(2)]);
  // The countries only zerozero follows: one job, the site asked once a second.
  const zz = WOMEN ? [] : ZZ_LEAGUES.filter((d) => want(d.nation));
  if (zz.length > 0) {
    jobs.push(async () => {
      const out: RealLeague[] = [];
      for (const def of zz) {
        try { out.push(await fetchZeroZeroLeague(def)); } catch (err) { log(`FAILED ${def.nation} ${def.name}: ${(err as Error).message}`); }
      }
      return out;
    });
  }

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
  await Promise.all((WOMEN ? DP_YOUTH_WOMEN : DP_YOUTH).filter((d) => want(d.nation)).map(async (def) => {
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
  log(`  ${await ageInternationals(intl.list, leagues)} national-team players with no club in the sources given their real age`);

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
  const fromZz = want('POR') && !WOMEN ? await fillFromZeroZero(leagues) : 0;
  log(`  ${fromZz} photos from zerozero.pt`);
  const manual = applyManualPhotos(leagues);
  log(`  ${withPhoto} players with a photo from the sources, ${manual} put in by hand, ${blank.size} placeholder pictures dropped.`);

  log(`  ${cleanCareers(leagues)} career rows that were not clubs left out`);
  log(`  ${dropStandInLogos(leagues)} stand-in logos dropped`);
  if (want('GER')) log(`  ${await fillGermanLogos(leagues)} German badges from the Volleyball Bundesliga`);

  const db: RealDb = {
    version: 1,
    builtAt: new Date().toISOString(),
    gender: WOMEN ? 'women' : 'men',
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
