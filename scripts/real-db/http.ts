/**
 * Polite fetching for the local real-data import.
 *
 * Every page is fetched at most once and kept under `data/local/real-cache/`
 * (git-ignored), so running the import again reads the disk, not the site.
 * Requests to one host are spaced out; robots.txt is read first and any path
 * it disallows is skipped rather than fetched.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CACHE_DIR = join('data', 'local', 'real-cache');
const USER_AGENT = 'VolleyballManagerLocalImport/0.1 (personal, offline use; one request per second)';
/** Milliseconds between two requests to the same host. */
const GAP_MS = 1100;
/** A cached page older than this is fetched again. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

const lastHit = new Map<string, number>();
const robots = new Map<string, string[]>();
let network = 0;
let cached = 0;

export function fetchStats(): { network: number; cached: number } {
  return { network, cached };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Static image servers (a CDN) are asked a little faster than the sites themselves. */
const FAST_HOSTS = new Set(['images.dataproject.com']);

async function waitTurn(host: string): Promise<void> {
  const gap = FAST_HOSTS.has(host) ? 340 : GAP_MS;
  const last = lastHit.get(host) ?? 0;
  const wait = last + gap - Date.now();
  lastHit.set(host, Math.max(Date.now(), last + gap));
  if (wait > 0) await sleep(wait);
}

/** The Disallow rules for `User-agent: *`. */
function parseRobots(text: string): string[] {
  const rules: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (m === null) continue;
    const key = m[1].toLowerCase();
    if (key === 'user-agent') applies = m[2].trim() === '*';
    else if (key === 'disallow' && applies && m[2].trim() !== '') rules.push(m[2].trim());
  }
  return rules;
}

function ruleMatches(rule: string, path: string): boolean {
  const re = new RegExp('^' + rule.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
  return re.test(path);
}

async function allowed(url: URL): Promise<boolean> {
  let rules = robots.get(url.host);
  if (rules === undefined) {
    try {
      await waitTurn(url.host);
      network++;
      const res = await fetch(`${url.protocol}//${url.host}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } });
      rules = res.ok ? parseRobots(await res.text()) : [];
    } catch {
      rules = [];
    }
    robots.set(url.host, rules);
  }
  const path = url.pathname + url.search;
  return !rules.some((r) => ruleMatches(r, path));
}

export class Disallowed extends Error {}

/** The page at `url`, from the cache when it is there and fresh. */
export async function getPage(url: string, init?: { method?: string; body?: string; contentType?: string }): Promise<string> {
  const key = createHash('sha1').update((init?.method ?? 'GET') + ' ' + url + ' ' + (init?.body ?? '')).digest('hex');
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${key}.txt`);
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8');
    const nl = raw.indexOf('\n');
    const meta = JSON.parse(raw.slice(0, nl)) as { url: string; at: number };
    if (Date.now() - meta.at < MAX_AGE_MS) {
      cached++;
      return raw.slice(nl + 1);
    }
  }
  const u = new URL(url);
  if (!(await allowed(u))) throw new Disallowed(`robots.txt disallows ${url}`);
  await waitTurn(u.host);
  network++;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' };
      if (init?.contentType !== undefined) headers['Content-Type'] = init.contentType;
      const res = await fetch(url, { method: init?.method ?? 'GET', body: init?.body, headers });
      if (res.status === 429 || res.status >= 500) {
        await sleep(5000 * (attempt + 1));
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      writeFileSync(file, JSON.stringify({ url, at: Date.now() }) + '\n' + text);
      return text;
    } catch (err) {
      lastErr = err;
      await sleep(3000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const LOGO_DIR = join('data', 'local', 'real-logos');

/**
 * An image saved as `data/local/real-logos/<name>.<ext>`, fetched once.
 * Returns the file name, or null when it could not be had.
 */
export const PHOTO_DIR = join('data', 'local', 'real-photos');

export async function getImage(url: string, name: string, dir = LOGO_DIR): Promise<string | null> {
  const LOGO_DIR = dir;
  mkdirSync(LOGO_DIR, { recursive: true });
  let safe = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // A name in another script (Cyrillic, say) leaves too little to tell people apart: the address does.
  const latin = name.normalize('NFD').replace(/[^A-Za-z]/g, '').length;
  const letters = name.replace(/[^\p{L}]/gu, '').length;
  if (latin < letters / 2) safe = `${safe}-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;
  for (const ext of ['png', 'jpg', 'gif', 'webp', 'svg']) {
    if (existsSync(join(LOGO_DIR, `${safe}.${ext}`))) { cached++; return `${safe}.${ext}`; }
  }
  try {
    const u = new URL(url);
    if (!(await allowed(u))) return null;
    await waitTurn(u.host);
    network++;
    const res = await fetch(u, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    const ext = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : type.includes('webp') ? 'webp'
      : type.includes('svg') ? 'svg' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
    if (ext === null) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 200) return null;
    writeFileSync(join(LOGO_DIR, `${safe}.${ext}`), bytes);
    return `${safe}.${ext}`;
  } catch {
    return null;
  }
}

// ---- Small HTML helpers ----------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z#0-9]+);/gi, (m, k: string) => ENTITIES[k.toLowerCase()] ?? m);
}

/** The visible text of an HTML fragment, one trimmed line per text node. */
export function textLines(html: string): string[] {
  return decode(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n'),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

/** "LEITE Filipe" or "DE LA CRUZ José M." → first and last name, the surname in title case. */
export function splitSurnameFirst(raw: string): { first: string; last: string } {
  const words = raw.trim().split(/\s+/);
  const caps: string[] = [];
  let i = 0;
  while (i < words.length && isUpperWord(words[i])) caps.push(words[i++]);
  if (caps.length === 0 || i === words.length) {
    // No capitalised surname to go by: the last word is the surname.
    if (caps.length === words.length && words.length > 1) {
      return { first: titleCase(words.slice(1).join(' ')), last: titleCase(words[0]) };
    }
    return { first: words.slice(0, -1).join(' '), last: titleCase(words[words.length - 1] ?? raw) };
  }
  return { first: words.slice(i).join(' '), last: titleCase(caps.join(' ')) };
}

function isUpperWord(w: string): boolean {
  return /\p{L}/u.test(w) && w === w.toUpperCase() && w.replace(/[^\p{L}]/gu, '').length >= 2;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'\-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/\b(De|Da|Do|Dos|Das|Di|Van|Von|Der|Den|La|Le|Del)\b/g, (w) => w.toLowerCase())
    .replace(/^(\p{L})/u, (c) => c.toUpperCase());
}

/** Lower case, no accents, letters only: for matching the same person across sources. */
export function nameKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ł/g, 'l').replace(/[^a-z]+/g, ' ').trim();
}
