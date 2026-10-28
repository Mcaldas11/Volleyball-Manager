/**
 * The match's sounds, made on the spot with the Web Audio API — no files to
 * load: the referee's whistle before each serve, the ball off the hand, the
 * crowd for a point (louder when the home side wins it), and the hooter for a
 * timeout. Quiet by design, and off with one click — remembered per browser,
 * as is how loud they are.
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
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A second of white noise, made once: the crowd and the ball are both shaped out of it. */
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
  if (master === null) {
    master = a.createGain();
    master.gain.value = soundVolume();
    master.connect(a.destination);
  }
  g.connect(master);
  return g;
}

/** The referee's whistle: a short trill. */
export function playWhistle(): void {
  const a = audio();
  if (a === null) return;
  const out = envelope(a, 0.05, 0.02, 0.38);
  const tone = a.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(3100, a.currentTime);
  // The pea in the whistle: a fast warble.
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

/** The crowd for a point: a swell, louder for the home side's. */
export function playCrowd(loud: number): void {
  const a = audio();
  if (a === null) return;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  const low = a.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 1100;
  src.connect(low).connect(envelope(a, 0.02 + 0.05 * Math.max(0, Math.min(1, loud)), 0.18, 1.5));
  src.start();
  src.stop(a.currentTime + 1.6);
}

/** The hooter for a timeout. */
export function playHooter(): void {
  const a = audio();
  if (a === null) return;
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
