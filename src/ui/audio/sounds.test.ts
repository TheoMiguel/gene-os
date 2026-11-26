import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOUND_IDS, type SoundId } from './sounds';

/** Latest stop time, in seconds after the call, that each sound may reach. */
const LIMITS: Record<SoundId, number> = {
  click: 0.15,
  tab: 0.15,
  loaded: 0.65,
  exported: 0.65,
  error: 0.65,
  warning: 0.65,
  panelOpen: 0.65,
  panelClose: 0.65,
};

let created: FakeNode[] = [];
let contexts = 0;

class FakeParam {
  value = 0;
  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number): this {
    if (!(value > 0)) throw new RangeError(`exponential ramp to ${value}`);
    this.value = value;
    return this;
  }
}

class FakeNode {
  disconnected = false;
  constructor() {
    created.push(this);
  }
  connect<T>(target: T): T {
    return target;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeSource extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  stopAt = Number.NaN;
  start(): void {}
  stop(time: number): void {
    this.stopAt = time;
  }
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  constructor() {
    contexts += 1;
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    return new FakeSource();
  }
  createBufferSource() {
    return new FakeSource();
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: 'lowpass', Q: new FakeParam(), frequency: new FakeParam() });
  }
  createDynamicsCompressor() {
    const params = ['threshold', 'knee', 'ratio', 'attack', 'release'].map((name) => [name, new FakeParam()]);
    return Object.assign(new FakeNode(), Object.fromEntries(params));
  }
  createBuffer(_channels: number, length: number) {
    const samples = new Float32Array(length);
    return { getChannelData: () => samples };
  }
  resume() {
    return Promise.resolve();
  }
}

async function freshModule() {
  vi.resetModules();
  return import('./sounds');
}

async function withFakeAudio() {
  created = [];
  contexts = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return freshModule();
}

describe('without Web Audio', () => {
  it('ignores every sound before and after the unlock', async () => {
    const { playSound, unlockAudio } = await freshModule();
    expect(() => {
      playSound('click', 1);
      unlockAudio();
      playSound('error', 1);
    }).not.toThrow();
  });
});

describe('with Web Audio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates one audio context, and only on the unlock', async () => {
    const { playSound, unlockAudio } = await withFakeAudio();
    playSound('click', 1);
    expect(contexts).toBe(0);
    unlockAudio();
    unlockAudio();
    expect(contexts).toBe(1);
  });

  it('plays nothing at volume 0', async () => {
    const { playSound, unlockAudio } = await withFakeAudio();
    unlockAudio();
    const before = created.length;
    playSound('loaded', 0);
    expect(created.length).toBe(before);
  });

  it.each(SOUND_IDS)('%s stays short and releases every node once it ends', async (id) => {
    const { playSound, unlockAudio } = await withFakeAudio();
    unlockAudio();
    const before = created.length;
    playSound(id, 0.5);
    const nodes = created.slice(before);
    const sources = nodes.filter((n): n is FakeSource => n instanceof FakeSource);

    expect(sources.length).toBeGreaterThan(0);
    expect(Math.max(...sources.map((s) => s.stopAt))).toBeLessThanOrEqual(LIMITS[id]);
    expect(nodes.some((n) => n.disconnected)).toBe(false);

    for (const source of sources) source.onended?.();
    expect(nodes.every((n) => n.disconnected)).toBe(true);
  });
});
