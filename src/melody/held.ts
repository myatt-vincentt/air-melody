// Held tones for Continuous mode: the same four colours as a smooth lead
// (lime), a soft pad (blue), a warm filtered synth (pink) and a deep bass
// (amber). A held tone fades in, glides to each new pitch with a short
// portamento (no zipper noise), eases its loudness as chords grow and
// shrink, and fades out, so nothing clicks.
import type { InstrumentId } from "./instruments";

/** A pitch-following setting: an AudioParam that tracks the tone's frequency. */
type Follow = { param: AudioParam; ratio: number; max?: number };

type HeldParts = {
  sources: AudioScheduledSourceNode[];
  follow: Follow[];
  /** Rise and fall times (s). */
  attack: number;
  release: number;
};

type HeldMaker = (
  ctx: AudioContext,
  out: GainNode,
  hz: number,
  t: number,
) => HeldParts;

/** How loud one held tone is, before the compressor: held tones add up. */
const HELD_GAIN = 0.11;
/** The glide to a new pitch (time constant, s): settles in about 3 of these. */
const PORTAMENTO = 0.02;

const held = (
  ctx: AudioContext,
  type: OscillatorType,
  hz: number,
  t: number,
) => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  o.start(t);
  return o;
};

const HELD: Record<InstrumentId, HeldMaker> = {
  // A smooth lead: a triangle with a faint octave, and a gentle vibrato
  // that comes in as the tone is held.
  marimba: (ctx, out, hz, t) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2600;
    filter.connect(out);
    const body = held(ctx, "triangle", hz, t);
    const air = held(ctx, "sine", hz * 2, t);
    const ag = ctx.createGain();
    ag.gain.value = 0.12;
    body.connect(filter);
    air.connect(ag);
    ag.connect(filter);
    const lfo = held(ctx, "sine", 5.2, t);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(7, t + 0.6);
    lfo.connect(depth);
    depth.connect(body.detune);
    depth.connect(air.detune);
    return {
      sources: [body, air, lfo],
      follow: [
        { param: body.frequency, ratio: 1 },
        { param: air.frequency, ratio: 2 },
      ],
      attack: 0.04,
      release: 0.09,
    };
  },
  // A soft pad: three slightly detuned saws, darkly filtered, slow to swell.
  keys: (ctx, out, hz, t) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(Math.min(hz * 2.2, 2200), t);
    filter.connect(out);
    const saws = [-9, 0, 9].map((cents) => {
      const o = held(ctx, "sawtooth", hz, t);
      o.detune.value = cents;
      o.connect(filter);
      return o;
    });
    return {
      sources: saws,
      follow: [
        ...saws.map((o) => ({ param: o.frequency, ratio: 1 })),
        { param: filter.frequency, ratio: 2.2, max: 2200 },
      ],
      attack: 0.16,
      release: 0.22,
    };
  },
  // A warm synth: two saws through a soft resonant filter.
  pluck: (ctx, out, hz, t) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(Math.min(hz * 3.2, 2600), t);
    filter.connect(out);
    const saws = [-6, 6].map((cents) => {
      const o = held(ctx, "sawtooth", hz, t);
      o.detune.value = cents;
      o.connect(filter);
      return o;
    });
    return {
      sources: saws,
      follow: [
        ...saws.map((o) => ({ param: o.frequency, ratio: 1 })),
        { param: filter.frequency, ratio: 3.2, max: 2600 },
      ],
      attack: 0.05,
      release: 0.1,
    };
  },
  // A deep held bass: a sine with a little triangle edge, filtered low.
  bass: (ctx, out, hz, t) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.connect(out);
    const body = held(ctx, "sine", hz, t);
    const edge = held(ctx, "triangle", hz, t);
    const eg = ctx.createGain();
    eg.gain.value = 0.4;
    body.connect(filter);
    edge.connect(eg);
    eg.connect(filter);
    return {
      sources: [body, edge],
      follow: [
        { param: body.frequency, ratio: 1 },
        { param: edge.frequency, ratio: 1 },
      ],
      attack: 0.03,
      release: 0.09,
    };
  },
};

/** How loud each instrument's held tone is, to sit together. */
const HELD_TRIM: Record<InstrumentId, number> = {
  marimba: 1,
  keys: 0.75,
  pluck: 0.65,
  bass: 1.25,
};

/** One held tone: glides to new pitches, changes level, and fades out. */
export class HeldVoice {
  private parts: HeldParts;

  private amp: GainNode;

  private level: GainNode;

  private released = false;

  constructor(
    ctx: AudioContext,
    dest: AudioNode[],
    readonly instrument: InstrumentId,
    hz: number,
    at: number,
    level: number,
    /** A slower fade-in (time constant, s), e.g. when switching mode. */
    fadeIn?: number,
  ) {
    this.level = ctx.createGain();
    this.level.gain.value = level * HELD_GAIN * HELD_TRIM[instrument];
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(this.level);
    dest.forEach((d) => this.level.connect(d));
    this.parts = HELD[instrument](ctx, this.amp, hz, at);
    this.amp.gain.setValueAtTime(0, at);
    this.amp.gain.setTargetAtTime(1, at, fadeIn ?? this.parts.attack / 3);
    this.parts.sources[0].onended = () => {
      this.level.disconnect();
    };
  }

  /** Glides to a new pitch from `at`. */
  glide(at: number, hz: number) {
    if (this.released) return;
    this.parts.follow.forEach(({ param, ratio, max }) =>
      param.setTargetAtTime(Math.min(hz * ratio, max ?? 20000), at, PORTAMENTO),
    );
  }

  /** Eases to a new loudness from `at` (for chords: more tones, each softer). */
  setLevel(at: number, level: number) {
    if (this.released) return;
    this.level.gain.setTargetAtTime(
      level * HELD_GAIN * HELD_TRIM[this.instrument],
      at,
      0.05,
    );
  }

  /** Fades out from `at` and lets go; `fade` (time constant, s) for a slower fade. */
  release(at: number, fade?: number) {
    if (this.released) return;
    this.released = true;
    const g = this.amp.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
    else g.cancelScheduledValues(at);
    const tau = fade ?? this.parts.release / 3;
    g.setTargetAtTime(0, at, tau);
    const end = at + tau * 9 + 0.05;
    this.parts.sources.forEach((src) => {
      try {
        src.stop(end);
      } catch {
        // Already stopped.
      }
    });
  }
}
