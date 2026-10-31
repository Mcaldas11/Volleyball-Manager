/**
 * The game in other languages: Portuguese and Spanish, beside the English it is written in.
 *
 * The screens are written in English, and the words are turned as they appear — as the women's game
 * turns its pronouns (pronouns.ts): each piece of text on the page, and each tooltip, is looked up in
 * the dictionary (translations.ts) and replaced when it is there. A row can have holes — "{0} players",
 * "Finish {0} or better" — filled with whatever stands there, itself translated if it can be (a
 * number stays a number, a name a name). A sentence the page writes in pieces, a number or a name
 * in the middle, is put together and looked up whole. Names never are translated: a name is not in
 * the dictionary, and anything inside an element marked `translate="no"` is left alone. What the
 * dictionary does not have stays in English — the generated text of messages and news, mostly.
 *
 * The English each piece was is kept, so the language can be changed at any moment and back.
 * Kept in this browser, as the other preferences are.
 */

import { CONTEXTUAL, PATTERNS, PHRASES } from './translations.ts';

export type Language = 'en' | 'pt' | 'es';

export const LANGUAGES: ReadonlyArray<{ id: Language; name: string }> = [
  { id: 'en', name: 'English' },
  { id: 'pt', name: 'Português' },
  { id: 'es', name: 'Español' },
];

const KEY = 'vm.language';
const COLUMN: Readonly<Record<Exclude<Language, 'en'>, 1 | 2>> = { pt: 1, es: 2 };

let current: Language = 'en';
let dictionary = new Map<string, string>();

/** A row with holes: matched by a pattern, its translation filled in from what the holes held. */
interface Template {
  re: RegExp;
  /** Written in parts, "Since {0} · next report {1}": tried before the parts are taken one by one. */
  dotted: boolean;
  /** Which hole each capture is: "{1} of {0}" captures 1 first. */
  holes: number[];
  to: string;
}
/** Kept by the row's first word, or — when it starts with a hole — its last. */
let byFirst = new Map<string, Template[]>();
let byLast = new Map<string, Template[]>();
let open: Template[] = [];

export function language(): Language {
  return current;
}

function stored(): Language {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'pt' || v === 'es' ? v : 'en';
  } catch {
    return 'en';
  }
}

function template(en: string, to: string): Template {
  const holes: number[] = [];
  const source = en.split(/(\{\d\})/).map((part) => {
    const hole = /^\{(\d)\}$/.exec(part);
    if (hole === null) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    holes.push(Number(hole[1]));
    return "(.*?)";
  }).join('');
  return { re: new RegExp(`^${source}$`), holes, to, dotted: en.includes(' · ') };
}

function file(map: Map<string, Template[]>, key: string, t: Template): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [t]);
  else list.push(t);
}

function build(lang: Language): void {
  dictionary = new Map();
  byFirst = new Map();
  byLast = new Map();
  open = [];
  if (lang === 'en') return;
  const col = COLUMN[lang];
  for (const row of PHRASES) {
    if (!/\{\d\}/.test(row[0])) {
      dictionary.set(row[0], row[col]);
      continue;
    }
    const t = template(row[0], row[col]);
    const words = row[0].split(' ');
    if (!/^\{\d\}/.test(row[0])) file(byFirst, words[0], t);
    else if (!/\{\d\}$/.test(row[0])) file(byLast, words[words.length - 1], t);
    else open.push(t);
  }
}

function fill(core: string, dotted: boolean): string | null {
  const words = core.split(' ');
  const candidates = [...(byFirst.get(words[0]) ?? []), ...(byLast.get(words[words.length - 1]) ?? []), ...open];
  for (const t of candidates) {
    if (dotted && !t.dotted) continue;
    const m = t.re.exec(core);
    if (m === null) continue;
    const held: string[] = [];
    t.holes.forEach((h, i) => { held[h] = translate(m[i + 1]); });
    return t.to.replace(/\{(\d)\}/g, (_, h: string) => held[Number(h)] ?? '');
  }
  return null;
}

/** A piece of text in the language chosen — as it is, if the dictionary does not have it. */
export function translate(text: string, where: Element | null = null): string {
  if (current === 'en') return text;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (m === null || m[2].length < 2) return text;
  const [, lead, core, trail] = m;
  const col = COLUMN[current];
  if (where !== null) {
    for (const row of CONTEXTUAL) {
      if (row[1] === core && where.closest(row[0]) !== null) return lead + row[col + 1] + trail;
    }
  }
  const hit = dictionary.get(core);
  if (hit !== undefined) return lead + hit + trail;
  // "Win a match" as "Win a match." is, without its full stop.
  const dotted = dictionary.get(`${core}.`);
  if (dotted !== undefined) return lead + dotted.replace(/\.$/, '') + trail;
  // "Name:" and "Saving…" as "Name" and "Saving" are.
  const end = /[:…]$/.exec(core);
  if (end !== null) {
    const base = dictionary.get(core.slice(0, -1));
    if (base !== undefined) return lead + base + end[0] + trail;
  }
  for (const [re, to] of PATTERNS) {
    if (re.test(core)) return lead + core.replace(re, (...args) => to(current as 'pt' | 'es', args.slice(1, -2) as string[])) + trail;
  }
  // "Win a match · 12 Oct 2026": each part on its own — unless the whole has a row of its own.
  if (core.includes(' · ')) {
    const whole = fill(core, true);
    if (whole !== null) return lead + whole + trail;
    const parts = core.split(' · ');
    const out = parts.map((s) => translate(s));
    if (out.some((s, i) => s !== parts[i])) return lead + out.join(' · ') + trail;
  }
  const filled = fill(core, false);
  if (filled !== null) return lead + filled + trail;
  return text;
}

// An input's placeholder is translated; what is typed in it is its value, which never is.
const SKIP = '[translate="no"], .notranslate, textarea, script, style';
const ATTRS = ['title', 'placeholder', 'aria-label'] as const;

/** The English a piece of text was, while it shows a translation — and the translation shown. */
const englishText = new WeakMap<Text, { en: string; shown: string }>();
const englishAttrs = new WeakMap<Element, Map<string, { en: string; shown: string }>>();

function skipped(el: Element | null): boolean {
  return el !== null && el.closest(SKIP) !== null;
}

/** The English a piece of text says: what this put there stood for it, or what the page wrote since. */
function englishOf(node: Text): string {
  const v = node.nodeValue ?? '';
  const was = englishText.get(node);
  return was !== undefined && was.shown === v ? was.en : v;
}

function show(node: Text, en: string, out: string): void {
  if (out === en) englishText.delete(node);
  else englishText.set(node, { en, shown: out });
  if (node.nodeValue !== out) node.nodeValue = out;
}

/**
 * An element holding only text, written in pieces — "Finish ", "3rd", " or better" — looked up as
 * the one sentence it is: the translation in the first piece, the rest emptied. False if it is not
 * one, or the sentence is not in the dictionary.
 */
function turnJoined(el: Element): boolean {
  const nodes = el.childNodes;
  if (nodes.length < 2) return false;
  for (const n of nodes) if (n.nodeType !== Node.TEXT_NODE) return false;
  const texts = [...nodes] as Text[];
  const en = texts.map(englishOf);
  const whole = en.join('');
  const out = translate(whole, el);
  if (out === whole) return false;
  texts.forEach((n, i) => show(n, en[i], i === 0 ? out : ''));
  return true;
}

function turnText(node: Text): void {
  const parent = node.parentElement;
  if (parent === null || skipped(parent)) return;
  if (turnJoined(parent)) return;
  const en = englishOf(node);
  show(node, en, en.trim().length < 2 ? en : translate(en, parent));
}

function turnAttrs(el: Element): void {
  if (skipped(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    let kept = englishAttrs.get(el);
    const was = kept?.get(a);
    const en = was !== undefined && was.shown === v ? was.en : v;
    const out = translate(en, el);
    if (out === en) {
      kept?.delete(a);
      if (v !== en) el.setAttribute(a, en);
      continue;
    }
    if (kept === undefined) {
      kept = new Map();
      englishAttrs.set(el, kept);
    }
    kept.set(a, { en, shown: out });
    if (v !== out) el.setAttribute(a, out);
  }
}

function turnTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) { turnText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (skipped(el)) return;
  turnAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) turnText(n as Text);
    else turnAttrs(n as Element);
  }
}

let observer: MutationObserver | null = null;

function watch(): void {
  if (observer !== null || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') turnText(r.target as Text);
      else if (r.type === 'attributes') turnAttrs(r.target as Element);
      else r.addedNodes.forEach(turnTree);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

/** Show the game in a language — at once, the page as it stands included. Remembered. */
export function setLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // Without storage it simply isn't remembered.
  }
  apply(lang);
}

function apply(lang: Language): void {
  current = lang;
  build(lang);
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  // English needs no watching — but what is on the page is put back into it.
  watch();
  turnTree(document.body);
}

/** The language this browser chose, put on as the game opens. */
export function startLanguage(): void {
  const lang = stored();
  if (lang !== 'en') apply(lang);
}
