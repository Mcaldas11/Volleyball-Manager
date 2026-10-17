/**
 * The press room written by a language model: an optional setting.
 *
 * With an Anthropic API key, the questions of a press conference and the six
 * answers to each are written by Claude rather than by the game's own writer
 * (engine/world/pressRoom.ts) — from the same notebook the game gives its own
 * writer: the box score, the table, the story around the match, what the
 * manager said last time. Only the words change. Which journalist asks, what
 * the question is about, how many there are and what each tone of answer
 * does to morale stay the game's, so a model can make a conference read
 * differently every time but can never change what an answer is worth.
 *
 * The key stays in this browser's storage and goes nowhere but Anthropic's
 * API, called straight from the page. Anything that goes wrong — no network,
 * a bad key, a reply that isn't what was asked for — leaves the game's own
 * questions in place.
 */

import type { AnswerCategory, InterviewQuestion, InterviewSession } from '../engine/world/interviews.ts';
import { VOICE_LABEL } from '../engine/world/pressRoom.ts';
import type { World } from '../engine/world/world.ts';

export interface PressAiSettings {
  on: boolean;
  key: string;
  model: string;
}

/** The models offered, fastest first. */
export const PRESS_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fast' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — sharper' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best' },
];

const STORAGE_KEY = 'vm.pressAi';
const DEFAULTS: PressAiSettings = { on: false, key: '', model: PRESS_MODELS[0].id };

export function loadPressAi(): PressAiSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Partial<PressAiSettings>;
    return {
      on: v.on === true,
      key: typeof v.key === 'string' ? v.key : '',
      model: PRESS_MODELS.some((m) => m.id === v.model) ? v.model! : DEFAULTS.model,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePressAi(s: PressAiSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the setting lasts as long as the page.
  }
}

export function pressAiReady(s: PressAiSettings): boolean {
  return s.on && s.key.trim().length > 20;
}

/** Questions from `from` on that the model hasn't written yet. */
export function unwritten(session: InterviewSession, from = session.currentIndex): number[] {
  const out: number[] = [];
  for (let i = from; i < session.questions.length; i++) {
    const q = session.questions[i];
    if (q.answeredIndex === null && q.written !== true) out.push(i);
  }
  return out;
}

const TONES: Readonly<Record<'pre' | 'post', Record<AnswerCategory, string>>> = {
  pre: {
    positive: 'respectful and warm — praises the opponent, the players, the fans; humble confidence',
    neutral: 'measured and non-committal — calm, gives little away, a professional deflection',
    convince: 'bold and provocative — predicts victory, challenges the opponent, makes a headline',
  },
  post: {
    positive: 'praise — credit to the players, warmth, pride, protects the group',
    neutral: 'measured — calm analysis, perspective, neither praise nor blame',
    convince: 'demanding — critical, sets standards, calls out what was not good enough',
  },
};

const SYSTEM = `You write the press conferences of a volleyball management game, in English.
A real head coach (the player) answers questions from journalists before or after a match.
Write like real sports journalism: specific, grounded in the facts you are given, varied, never generic filler.
Use the numbers and names from the facts — scores, points, aces, blocks, errors, the table, streaks, injuries, signings — where they fit.
Each journalist has a voice (statistician, straight talker, local reporter, tactician, feature writer, headline hunter): let it show in how they ask.
Questions: one or two sentences, at most 35 words, ending with a question mark. Never repeat a question already asked in this conference.
Answers: the coach speaking, first person, at most 24 words each, natural spoken English, no quotation marks around them.
For every question write exactly six answers in this order: two of the first tone, two of the second, two of the third, as described.
The two answers of a tone must say different things.
Also write how the journalist reacts to each tone: one short line each, naming the journalist by first name, no pronouns for the journalist.
Refer to players as he/him. Do not invent facts that contradict the ones given; you may leave facts out.`;

interface Written {
  prompt: string;
  answers: string[];
  reactions: { positive?: string; neutral?: string; convince?: string };
}

const TOOL = {
  name: 'press_conference',
  description: 'The questions of the press conference, in order, each with six answers and the reactions to each tone.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question, as the journalist asks it.' },
            answers: {
              type: 'array', items: { type: 'string' }, minItems: 6, maxItems: 6,
              description: 'Six answers: two of tone A, two of tone B, two of tone C.',
            },
            reactions: {
              type: 'object',
              properties: { positive: { type: 'string' }, neutral: { type: 'string' }, convince: { type: 'string' } },
              required: ['positive', 'neutral', 'convince'],
            },
          },
          required: ['prompt', 'answers', 'reactions'],
        },
      },
    },
    required: ['questions'],
  },
} as const;

function describe(world: World, session: InterviewSession, idx: readonly number[]): string {
  const tones = TONES[session.kind];
  const store = world.players;
  const lines: string[] = [];
  lines.push(`${session.kind === 'pre' ? 'Pre-match' : 'Post-match'} press conference — ${session.occasion}. ${session.crowd} journalists in the room.`);
  lines.push('', 'Facts the press have:');
  for (const f of session.brief ?? []) lines.push(`- ${f}`);
  lines.push('', `Tone A (${session.kind === 'pre' ? 'positive' : 'praise'}): ${tones.positive}.`);
  lines.push(`Tone B (${session.kind === 'pre' ? 'neutral' : 'measured'}): ${tones.neutral}.`);
  lines.push(`Tone C (${session.kind === 'pre' ? 'convince' : 'demanding'}): ${tones.convince}.`);
  const asked = session.questions.slice(0, session.currentIndex).filter((q) => q.answeredIndex !== null);
  if (asked.length > 0) {
    lines.push('', 'Already asked and answered in this conference:');
    for (const q of asked) lines.push(`- ${q.journalist.name}: "${q.prompt}" — Coach: "${q.options[q.answeredIndex!].text}"`);
  }
  lines.push('', `Write ${idx.length} question${idx.length === 1 ? '' : 's'}, in this order:`);
  idx.forEach((i, n) => {
    const q = session.questions[i];
    const about = q.options.find((o) => o.playerIdx !== undefined)?.playerIdx;
    const voice = q.journalist.voice !== undefined ? VOICE_LABEL[q.journalist.voice] : 'reporter';
    lines.push(`${n + 1}. ${q.journalist.name} (${q.journalist.outlet}, ${voice})` +
      `${q.followUp === true ? ' — a follow-up pressing the coach on his last answer' : ''}. ` +
      `Same subject as this draft, in your own words: "${q.prompt}"` +
      `${about !== undefined && store.isActive(about) ? ` The question is about ${store.fullName(about)}.` : ''}`);
  });
  return lines.join('\n');
}

function clean(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/^["“”']+|["“”']+$/g, '').replace(/\s+/g, ' ');
  return t.length === 0 || t.length > max ? null : t;
}

/**
 * Has the model write the questions of `session` from `idx` on: returns how many it wrote, or
 * throws with a message fit to show. The world is changed only if the questions are still
 * unanswered when the reply comes back.
 */
export async function writeQuestions(world: World, session: InterviewSession, idx: readonly number[], s: PressAiSettings): Promise<number> {
  if (idx.length === 0) return 0;
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.key.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: s.model,
        max_tokens: 700 + idx.length * 650,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: describe(world, session, idx) }],
      }),
    });
  } catch {
    throw new Error('Could not reach the AI — check the connection.');
  }
  if (!res.ok) {
    const why = res.status === 401 ? 'the API key was refused'
      : res.status === 429 ? 'too many requests — try again in a moment'
        : res.status === 404 ? 'that model is not available to this key'
          : `the AI replied ${res.status}`;
    throw new Error(`AI press unavailable: ${why}.`);
  }
  const body = await res.json() as { content?: Array<{ type: string; input?: { questions?: Written[] } }> };
  const written = body.content?.find((c) => c.type === 'tool_use')?.input?.questions;
  if (!Array.isArray(written)) throw new Error('The AI did not write the questions.');
  let n = 0;
  idx.forEach((i, k) => {
    const q: InterviewQuestion | undefined = session.questions[i];
    const w = written[k];
    if (q === undefined || w === undefined || q.answeredIndex !== null) return;
    const prompt = clean(w.prompt, 320);
    const answers = Array.isArray(w.answers) ? w.answers.map((a) => clean(a, 220)) : [];
    if (prompt === null || answers.length !== 6 || answers.some((a) => a === null)) return;
    q.prompt = prompt;
    q.options.forEach((o, j) => { o.text = answers[j]!; });
    const r = w.reactions ?? {};
    q.reactions = {
      positive: clean(r.positive, 200) ?? undefined,
      neutral: clean(r.neutral, 200) ?? undefined,
      convince: clean(r.convince, 200) ?? undefined,
    };
    q.written = true;
    n++;
  });
  if (n > 0) session.ai = true;
  return n;
}
