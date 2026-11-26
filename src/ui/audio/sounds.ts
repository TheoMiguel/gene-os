/** Every interface event that has a sound. */
export const SOUND_IDS = [
  'click',
  'tab',
  'loaded',
  'exported',
  'error',
  'warning',
  'panelOpen',
  'panelClose',
] as const;
/** One interface sound. */
export type SoundId = (typeof SOUND_IDS)[number];

/** Gain that counts as silence: exponential ramps cannot reach 0. */
const SILENT = 0.0001;
/** Seconds between the call and the first scheduled event, so no event lands in the past. */
const LEAD = 0.005;
/** Seconds a source keeps running after its envelope reaches silence. */
const TAIL = 0.02;

interface Bus {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly noise: AudioBuffer;
}

/** One playing sound: the voice helpers schedule into it, and it releases every node once all sources end. */
interface Play {
  readonly ctx: AudioContext;
  /** Context time of the sound's start. */
  readonly t0: number;
  readonly out: AudioNode;
  readonly noise: AudioBuffer;
  node<T extends AudioNode>(node: T): T;
  source(node: AudioScheduledSourceNode, start: number, end: number): void;
}

type Recipe = (play: Play) => void;

/** A filter whose cutoff glides from `from` to `to` Hz over the voice's life. */
interface Sweep {
  readonly type: BiquadFilterType;
  readonly from: number;
  readonly to: number;
  readonly q: number;
}

interface FmVoice {
  /** Seconds after the sound's start. */
  readonly at: number;
  readonly dur: number;
  /** Carrier glide, start and end Hz. */
  readonly freq: readonly [number, number];
  /** Modulator frequency as a multiple of the carrier frequency. */
  readonly ratio: number;
  /** Modulation depth as a multiple of the carrier frequency, start and end. Both above 0. */
  readonly index: readonly [number, number];
  readonly gain: number;
  readonly wave?: OscillatorType;
  readonly filter?: Sweep;
}

type Note = Omit<FmVoice, 'at' | 'freq'>;

interface NoiseVoice {
  readonly at: number;
  readonly dur: number;
  readonly gain: number;
  readonly filter: Sweep;
}

let bus: Bus | null = null;

function createBus(): Bus {
  const ctx = new AudioContext();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(compressor).connect(ctx.destination);
  const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate / 2), ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return { ctx, master, noise };
}

function glide(param: AudioParam, start: number, end: number, from: number, to: number): void {
  param.setValueAtTime(from, start);
  param.exponentialRampToValueAtTime(to, end);
}

/** The chain a voice's source feeds: an optional swept filter, then a percussive envelope into the sound's output. */
function voiceInput(p: Play, at: number, dur: number, peak: number, filter?: Sweep): AudioNode {
  const start = p.t0 + at;
  const envelope = p.node(p.ctx.createGain());
  envelope.gain.setValueAtTime(SILENT, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.006, dur / 4));
  envelope.gain.exponentialRampToValueAtTime(SILENT, start + dur);
  envelope.connect(p.out);
  if (!filter) return envelope;
  const biquad = p.node(p.ctx.createBiquadFilter());
  biquad.type = filter.type;
  biquad.Q.value = filter.q;
  glide(biquad.frequency, start, start + dur, filter.from, filter.to);
  biquad.connect(envelope);
  return biquad;
}

function fm(p: Play, v: FmVoice): void {
  const start = p.t0 + v.at;
  const end = start + v.dur;
  const carrier = p.ctx.createOscillator();
  const modulator = p.ctx.createOscillator();
  const depth = p.node(p.ctx.createGain());
  carrier.type = v.wave ?? 'sine';
  glide(carrier.frequency, start, end, v.freq[0], v.freq[1]);
  glide(modulator.frequency, start, end, v.freq[0] * v.ratio, v.freq[1] * v.ratio);
  glide(depth.gain, start, end, v.freq[0] * v.index[0], v.freq[1] * v.index[1]);
  modulator.connect(depth).connect(carrier.frequency);
  carrier.connect(voiceInput(p, v.at, v.dur, v.gain, v.filter));
  p.source(carrier, start, end);
  p.source(modulator, start, end);
}

/** FM notes `step` seconds apart from `at`; each note glides by the factor `bend`. */
function arpeggio(p: Play, at: number, step: number, notes: readonly number[], voice: Note, bend = 1): void {
  notes.forEach((freq, i) => {
    fm(p, { ...voice, at: at + i * step, freq: [freq, freq * bend] });
  });
}

function noise(p: Play, v: NoiseVoice): void {
  const start = p.t0 + v.at;
  const src = p.ctx.createBufferSource();
  src.buffer = p.noise;
  src.loop = true;
  src.connect(voiceInput(p, v.at, v.dur, v.gain, v.filter));
  p.source(src, start, start + v.dur);
}

/** Filtered-noise whoosh with a faint FM undertone, gliding from `from` to `to` Hz. */
function whoosh(from: number, to: number): Recipe {
  return (p) => {
    noise(p, { at: 0, dur: 0.26, gain: 0.1, filter: { type: 'bandpass', from, to, q: 7 } });
    fm(p, { at: 0, dur: 0.22, freq: [from / 4, to / 4], ratio: 2, index: [0.8, 0.8], gain: 0.035 });
  };
}

const RECIPES: Record<SoundId, Recipe> = {
  click: (p) => fm(p, { at: 0, dur: 0.05, freq: [2200, 1700], ratio: 1.5, index: [2.5, 0.2], gain: 0.15 }),
  tab: (p) =>
    arpeggio(p, 0, 0.05, [1150, 1650], { dur: 0.055, ratio: 2, index: [1.8, 0.3], gain: 0.12 }, 1.08),
  loaded: (p) =>
    arpeggio(p, 0, 0.07, [523.25, 659.25, 783.99, 1046.5], {
      dur: 0.18,
      ratio: 3,
      index: [1.4, 0.15],
      gain: 0.11,
      wave: 'triangle',
      filter: { type: 'lowpass', from: 700, to: 4200, q: 9 },
    }),
  exported: (p) => {
    fm(p, { at: 0, dur: 0.04, freq: [1568, 2093], ratio: 2, index: [1.5, 0.2], gain: 0.09 });
    arpeggio(p, 0.045, 0.015, [1046.5, 1568, 2093], { dur: 0.45, ratio: 3.5, index: [3, 0.2], gain: 0.07 });
  },
  error: (p) =>
    arpeggio(
      p,
      0,
      0.13,
      [196, 147],
      {
        dur: 0.16,
        ratio: 0.5,
        index: [5, 1.5],
        gain: 0.12,
        wave: 'sawtooth',
        filter: { type: 'lowpass', from: 1600, to: 380, q: 5 },
      },
      0.75,
    ),
  warning: (p) =>
    arpeggio(p, 0, 0.12, [880, 660], {
      dur: 0.09,
      ratio: 1,
      index: [1, 0.5],
      gain: 0.12,
      wave: 'triangle',
      filter: { type: 'bandpass', from: 1400, to: 1400, q: 3 },
    }),
  panelOpen: whoosh(300, 3200),
  panelClose: whoosh(3200, 300),
};

/**
 * Creates or resumes the audio context. Call it from a user gesture (the first pointerdown or keydown):
 * a context created earlier starts suspended and makes the browser log a warning.
 */
export function unlockAudio(): void {
  if (!bus) {
    if (typeof AudioContext === 'undefined') return;
    bus = createBus();
  }
  if (bus.ctx.state !== 'running') bus.ctx.resume().catch(() => undefined);
}

/** Plays `id` at `volume` (0..1). Does nothing before `unlockAudio`, at volume 0, or without Web Audio. */
export function playSound(id: SoundId, volume: number): void {
  if (bus?.ctx.state !== 'running' || !(volume > 0)) return;
  const { ctx, master } = bus;
  const nodes: AudioNode[] = [];
  let live = 0;
  const node = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const out = node(ctx.createGain());
  out.gain.value = Math.min(volume, 1);
  out.connect(master);
  RECIPES[id]({
    ctx,
    out,
    noise: bus.noise,
    t0: ctx.currentTime + LEAD,
    node,
    source(src, start, end) {
      node(src);
      live += 1;
      src.onended = () => {
        live -= 1;
        if (live === 0) for (const n of nodes) n.disconnect();
      };
      src.start(start);
      src.stop(end + TAIL);
    },
  });
}
