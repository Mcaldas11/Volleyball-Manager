/**
 * The match's sounds: recordings of the real thing (public/sounds, all CC0 — see CREDITS.txt there)
 * — the referee's whistle before each serve, the ball off the hand, a spike, the crowd for a point
 * (louder when the home side wins it), and the scorer's buzzer for a timeout. Each is
 * played a little differently every time, so a rally never sounds like a loop. Until a recording has
 * loaded — or if it cannot be — the sound is made on the spot with the Web Audio API instead. Off with
 * one click — remembered per browser, as is how loud they are.
 */

const KEY = 'vm.sound';
const VOLUME_KEY = 'vm.soundVolume';
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
/** Every sound goes out through this, at the volume chosen. */
let master: GainNode | null = null;

export function soundOn(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Without storage it simply isn't remembered.
  }
}

/** How loud the sounds are, 0 to 1. */
export function soundVolume(): number {
  try {
    const v = Number(window.localStorage.getItem(VOLUME_KEY) ?? '1');
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch {
    return 1;
  }
}

export function setSoundVolume(v: number): void {
  const level = Math.max(0, Math.min(1, v));
  try {
    window.localStorage.setItem(VOLUME_KEY, String(level));
  } catch {
    // Without storage it simply isn't remembered.
  }
  if (master !== null) master.gain.value = level;
}

/** The audio context, made on first use — and only with sound on, and a browser that has one. */
function audio(): AudioContext | null {
  if (!soundOn()) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  if (ctx === null) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    loadRecordings(ctx);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Where every sound goes: the master volume, made with the first. */
function output(a: AudioContext): GainNode {
  if (master === null) {
    master = a.createGain();
    master.gain.value = soundVolume();
    master.connect(a.destination);
  }
  return master;
}

const RECORDINGS = ['whistle', 'buzzer', 'spike-1', 'spike-2', 'touch-1', 'touch-2', 'touch-3', 'crowd'] as const;
type Recording = (typeof RECORDINGS)[number];
const recordings = new Map<Recording, AudioBuffer>();

/**
 * The arena's stingers: a monster spike, a stuff block, an ace. The game ships none of its own — a
 * file of the player's, put in public/sounds as monster-spike.mp3, block.mp3 or ace.mp3, is played if
 * it is there; otherwise the crowd erupts.
 */
export type Stinger = 'monster-spike' | 'block' | 'ace';
const STINGERS: readonly Stinger[] = ['monster-spike', 'block', 'ace'];
const stingers = new Map<Stinger, AudioBuffer>();

/** Fetches the recordings, once, as the first sound is played — the game's own files, next to the page. */
function loadRecordings(a: AudioContext): void {
  for (const name of STINGERS) {
    void fetch(`sounds/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => a.decodeAudioData(data))
      .then((buffer) => { stingers.set(name, buffer); })
      .catch(() => {
        // None of the player's: the crowd it is.
      });
  }
  for (const name of RECORDINGS) {
    void fetch(`sounds/${name}.wav`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => a.decodeAudioData(data))
      .then((buffer) => { recordings.set(name, buffer); })
      .catch(() => {
        // That sound stays the one made on the spot.
      });
  }
}

/** A number between `lo` and `hi`. */
function between(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/**
 * Plays a recording, if it has loaded — false if it hasn't. `rate` tunes it up or down a touch; `from`
 * and `length` play only a part of it, faded in and out.
 */
function play(a: AudioContext, name: Recording, gain: number, rate = 1, from = 0, length?: number): boolean {
  const buffer = recordings.get(name);
  if (buffer === undefined) return false;
  const src = a.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = a.createGain();
  const t = a.currentTime;
  if (length === undefined) {
    g.gain.value = gain;
    src.start(t, from);
  } else {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.15);
    g.gain.setValueAtTime(gain, t + length * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.start(t, from, length * rate);
  }
  src.connect(g).connect(output(a));
  return true;
}

/** A second of white noise, made once: the crowd and the ball are both shaped out of it when made on the spot. */
function noiseBuffer(a: AudioContext): AudioBuffer {
  if (noise !== null) return noise;
  noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

/** A gain that rises to `peak` and falls away to nothing over `length` seconds. */
function envelope(a: AudioContext, peak: number, attack: number, length: number): GainNode {
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  g.connect(output(a));
  return g;
}

/** The referee's whistle: a short blast. */
export function playWhistle(): void {
  const a = audio();
  if (a === null) return;
  if (play(a, 'whistle', 0.11, between(0.97, 1.03))) return;
  // Made on the spot: a sine with the pea's fast warble.
  const out = envelope(a, 0.05, 0.02, 0.38);
  const tone = a.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(3100, a.currentTime);
  const warble = a.createOscillator();
  warble.frequency.value = 38;
  const depth = a.createGain();
  depth.gain.value = 140;
  warble.connect(depth).connect(tone.frequency);
  tone.connect(out);
  tone.start();
  warble.start();
  tone.stop(a.currentTime + 0.4);
  warble.stop(a.currentTime + 0.4);
}

/** The ball off the hand: a soft touch for a pass or a set, a crack for a spike or a serve. */
export function playHit(hard: boolean): void {
  const a = audio();
  if (a === null) return;
  const take: Recording = hard
    ? (Math.random() < 0.5 ? 'spike-1' : 'spike-2')
    : (['touch-1', 'touch-2', 'touch-3'] as const)[Math.floor(Math.random() * 3)];
  if (play(a, take, hard ? between(0.24, 0.3) : between(0.16, 0.22), between(0.92, 1.08))) return;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = hard ? 1600 : 900;
  band.Q.value = 1.2;
  src.connect(band).connect(envelope(a, hard ? 0.12 : 0.05, 0.004, hard ? 0.12 : 0.07));
  src.start();
  src.stop(a.currentTime + 0.15);
  if (hard) {
    const thump = a.createOscillator();
    thump.frequency.setValueAtTime(140, a.currentTime);
    thump.frequency.exponentialRampToValueAtTime(60, a.currentTime + 0.1);
    thump.connect(envelope(a, 0.08, 0.004, 0.12));
    thump.start();
    thump.stop(a.currentTime + 0.14);
  }
}

/** The crowd for a point: a swell of applause, louder for the home side's — a different stretch of it each time. */
export function playCrowd(loud: number): void {
  const a = audio();
  if (a === null) return;
  const level = Math.max(0, Math.min(1, loud));
  const clip = recordings.get('crowd');
  const length = 1.6 + 0.8 * level;
  if (clip !== undefined && play(a, 'crowd', 0.08 + 0.26 * level, between(0.96, 1.04), between(0, Math.max(0, clip.duration - length - 0.1)), length)) return;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  const low = a.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 1100;
  src.connect(low).connect(envelope(a, 0.02 + 0.05 * level, 0.18, 1.5));
  src.start();
  src.stop(a.currentTime + 1.6);
}

/** A big moment's stinger — the player's own file for it, or the crowd erupting. */
export function playStinger(kind: Stinger): void {
  const a = audio();
  if (a === null) return;
  const buffer = stingers.get(kind);
  if (buffer === undefined) {
    playCrowd(1);
    return;
  }
  const src = a.createBufferSource();
  src.buffer = buffer;
  const g = a.createGain();
  g.gain.value = 0.35;
  src.connect(g).connect(output(a));
  src.start();
}

/** The hooter for a timeout: the scorer's buzzer. */
export function playHooter(): void {
  const a = audio();
  if (a === null) return;
  if (play(a, 'buzzer', 0.09)) return;
  const tone = a.createOscillator();
  tone.type = 'square';
  tone.frequency.value = 330;
  const soft = a.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 900;
  tone.connect(soft).connect(envelope(a, 0.04, 0.02, 0.6));
  tone.start();
  tone.stop(a.currentTime + 0.62);
}
