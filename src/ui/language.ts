/**
 * The game in other languages: Portuguese and Spanish, beside the English it is written in.
 *
 * The screens are written in English, and the words are turned as they appear — as the women's game
 * turns its pronouns (pronouns.ts): each piece of text on the page, and each tooltip, is looked up in
 * the dictionary (translations.ts) and replaced when it is there. What is not there stays in English:
 * the menus, the navigation, the preferences, the headings, the buttons and the match controls are
 * translated; the generated text — messages, news, reports — is not yet. Names never are: a name is
 * not in the dictionary, and anything inside an element marked `translate="no"` is left alone.
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

function build(lang: Language): void {
  dictionary = new Map();
  if (lang === 'en') return;
  const col = COLUMN[lang];
  for (const row of PHRASES) dictionary.set(row[0], row[col]);
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
  // "Win a match · 12 Oct 2026": each part on its own.
  if (core.includes(' · ')) {
    const parts = core.split(' · ');
    const out = parts.map((s) => translate(s));
    if (out.some((s, i) => s !== parts[i])) return lead + out.join(' · ') + trail;
  }
  // "Name:" and "Saving…" as "Name" and "Saving" are.
  const end = /[:…]$/.exec(core);
  if (end !== null) {
    const base = dictionary.get(core.slice(0, -1));
    if (base !== undefined) return lead + base + end[0] + trail;
  }
  for (const [re, to] of PATTERNS) {
    if (re.test(core)) return lead + core.replace(re, (...args) => to(current as 'pt' | 'es', args.slice(1, -2) as string[])) + trail;
  }
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

function turnText(node: Text): void {
  const v = node.nodeValue;
  if (v === null || v.trim().length < 2 || skipped(node.parentElement)) return;
  const was = englishText.get(node);
  // The page wrote new text: that is the English now. Else it is still the one this put there.
  const en = was !== undefined && was.shown === v ? was.en : v;
  const out = translate(en, node.parentElement);
  if (out === en) {
    englishText.delete(node);
    if (v !== en) node.nodeValue = en;
    return;
  }
  englishText.set(node, { en, shown: out });
  if (v !== out) node.nodeValue = out;
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
