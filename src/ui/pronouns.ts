/**
 * The women's game in words.
 *
 * The game's text speaks of its players as "he" — written for the men's game,
 * in a great many places. In the women's game every player is a woman, so the
 * words on the screen are turned as they appear: he to she, his and him to
 * her, himself to herself, the boys to the girls. Coaches, staff, owners and
 * the manager's own career keep theirs: anything inside an element marked
 * `data-pronouns="keep"` is left alone.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bhimself\b/g, 'herself'], [/\bHimself\b/g, 'Herself'],
  [/\bhe\b/g, 'she'], [/\bHe\b/g, 'She'], [/\bHE\b/g, 'SHE'],
  [/\bhim\b/g, 'her'], [/\bHim\b/g, 'Her'], [/\bHIM\b/g, 'HER'],
  [/\bhis\b/g, 'her'], [/\bHis\b/g, 'Her'], [/\bHIS\b/g, 'HER'],
  [/\blads\b/g, 'players'], [/\blad\b/g, 'player'],
  [/\bboys\b/g, 'girls'], [/\bBoys\b/g, 'Girls'],
  [/\bsportsman\b/g, 'sportswoman'],
];

/** A text as the women's game says it. */
export function toWomen(text: string): string {
  if (!/\b(he|He|HE|him|Him|HIM|his|His|HIS|himself|Himself|lads?|boys|Boys|sportsman)\b/.test(text)) return text;
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}

const KEEP = '[data-pronouns="keep"], input, textarea, script, style';
const ATTRS = ['title', 'placeholder', 'aria-label'] as const;

function kept(el: Element | null): boolean {
  return el !== null && el.closest(KEEP) !== null;
}

function turnText(node: Text): void {
  const v = node.nodeValue;
  if (v === null || v.length < 2 || kept(node.parentElement)) return;
  const w = toWomen(v);
  if (w !== v) node.nodeValue = w;
}

function turnAttrs(el: Element): void {
  if (kept(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    const w = toWomen(v);
    if (w !== v) el.setAttribute(a, w);
  }
}

function turnTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) { turnText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (kept(el)) return;
  turnAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) turnText(n as Text);
    else turnAttrs(n as Element);
  }
}

let observer: MutationObserver | null = null;

/** Speak of the players as women — or stop. */
export function setPronouns(women: boolean): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (women && observer === null) {
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') turnText(r.target as Text);
        else if (r.type === 'attributes') turnAttrs(r.target as Element);
        else r.addedNodes.forEach(turnTree);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    turnTree(document.body);
  } else if (!women && observer !== null) {
    observer.disconnect();
    observer = null;
  }
}
