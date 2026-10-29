// The sound: four instruments made in code with Web Audio (no sample files).
//
//   marimba   a struck bar: a pure tone with its two bright overtones, quick
//             to fade
//   keys      a soft electric piano: a bell-like FM tone that mellows as it
//             rings
//   pluck     two slightly detuned saw waves through a closing filter
//   bass      a round low tone, an octave down
//
// Every note starts and ends on a short ramp, so nothing clicks. All of them
// go through a little room reverb and then a compressor and a limiter, so a
// big chord never distorts. Notes are booked ahead on the audio clock (see
// sequencer.ts), so they land on time however busy the page is.
//
// Continuous mode plays held tones instead (see `hold`): the same four
// colours as a smooth lead, a soft pad, a warm filtered synth and a deep
// bass, each gliding to its new pitch and fading in and out, so nothing
// clicks.
//
// Browsers only allow sound after a tap: `unlock()` is called from the first
// tap or click and starts the audio.
import { HeldVoice } from "./held";
import type { InstrumentId } from "./instruments";

type Voice = {
  /** The nodes to stop and let go of when the note is over. */
  sources: AudioScheduledSourceNode[];
  end: number;
  /** The note's own volume, faded out if the note is cut short. */
  amp?: GainNode;
};

/** How loud one note is, before the compressor. */
const NOTE_GAIN = 0.26;
/** Most notes sounding at once; past this the oldest are let go. */
const MAX_VOICES = 32;
/** Reverb: length (s) and how much of each note goes to it. */
const REVERB = { seconds: 1.6, send: 0.2 };

type AudioSessionNavigator = Navigator & {
  audioSession?: { type: string };
};

/** A soft room: stereo noise fading out, a little darker as it fades. */
const roomImpulse = (ctx: BaseAudioContext) => {
  const length = Math.floor(ctx.sampleRate * REVERB.seconds);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const k = 0.5 - 0.42 * t;
      lp += k * (Math.random() * 2 - 1 - lp);
      data[i] = lp * (1 - t) ** 2.4;
    }
  }
  return ir;
};

/**
 * Shapes a note's loudness: silent, a quick rise to `peak`, a decay that
 * falls to near nothing by `end`, and a last short fade to zero.
 */
const envelope = (
  g: AudioParam,
  t: number,
  peak: number,
  attack: number,
  end: number,
) => {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(Math.max(1e-4, peak * 0.002), end);
  g.linearRampToValueAtTime(0, end + 0.02);
};

const osc = (
  ctx: AudioContext,
  type: OscillatorType,
  hz: number,
  t: number,
  stop: number,
) => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  o.start(t);
  o.stop(stop);
  return o;
};

type VoiceMaker = (
  ctx: AudioContext,
  out: GainNode,
  hz: number,
  t: number,
  peak: number,
) => Voice;

const VOICES: Record<InstrumentId, VoiceMaker> = {
  marimba: (ctx, out, hz, t, peak) => {
    const end = t + 0.9;
    envelope(out.gain, t, peak, 0.003, end);
    const body = osc(ctx, "sine", hz, t, end + 0.05);
    body.connect(out);
    // The bar's overtones: brighter at the strike, gone quickly.
    const partials = [
      [3.93, 0.32, 0.16],
      [9.2, 0.1, 0.05],
    ].map(([ratio, level, decay]) => {
      const g = ctx.createGain();
      envelope(g.gain, t, level, 0.002, t + decay);
      const o = osc(ctx, "sine", Math.min(hz * ratio, 16000), t, end + 0.05);
      o.connect(g);
      g.connect(out);
      return o;
    });
    return { sources: [body, ...partials], end };
  },

  keys: (ctx, out, hz, t, peak) => {
    const end = t + 1.6;
    envelope(out.gain, t, peak * 0.9, 0.006, end);
    // FM: a modulator that starts bright and mellows as the note rings.
    const carrier = osc(ctx, "sine", hz, t, end + 0.05);
    const mod = osc(ctx, "sine", hz, t, end + 0.05);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(hz * 1.6, t);
    depth.gain.exponentialRampToValueAtTime(hz * 0.15, t + 0.9);
    mod.connect(depth);
    depth.connect(carrier.frequency);
    carrier.connect(out);
    // A faint bell an octave and a fifth up, for the "tine".
    const tine = osc(ctx, "sine", Math.min(hz * 3, 16000), t, end + 0.05);
    const tg = ctx.createGain();
    envelope(tg.gain, t, 0.12, 0.002, t + 0.35);
    tine.connect(tg);
    tg.connect(out);
    return { sources: [carrier, mod, tine], end };
  },

  pluck: (ctx, out, hz, t, peak) => {
    const end = t + 0.55;
    envelope(out.gain, t, peak * 0.7, 0.003, end);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(Math.min(hz * 9, 12000), t);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(hz * 1.4, 200),
      t + 0.3,
    );
    filter.connect(out);
    const saws = [-7, 7].map((cents) => {
      const o = osc(ctx, "sawtooth", hz, t, end + 0.05);
      o.detune.value = cents;
      o.connect(filter);
      return o;
    });
    return { sources: saws, end };
  },

  bass: (ctx, out, hz, t, peak) => {
    const end = t + 0.8;
    envelope(out.gain, t, peak * 1.15, 0.008, end);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(Math.min(hz * 6, 1400), t);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(hz * 2, 120),
      t + 0.4,
    );
    filter.connect(out);
    const body = osc(ctx, "sine", hz, t, end + 0.05);
    body.connect(filter);
    const edge = osc(ctx, "triangle", hz, t, end + 0.05);
    const eg = ctx.createGain();
    eg.gain.value = 0.45;
    edge.connect(eg);
    eg.connect(filter);
    return { sources: [body, edge], end };
  },
};

class SynthEngine {
  ctx: AudioContext | null = null;

  private input: GainNode | null = null;

  private reverb: GainNode | null = null;

  private meterNode: AnalyserNode | null = null;

  /** Held tones go through their own bus (metered on its own). */
  private heldBus: GainNode | null = null;

  private heldMeter: AnalyserNode | null = null;

  private meterData: Float32Array<ArrayBuffer> | null = null;

  private voices: Voice[] = [];

  private listeners = new Set<() => void>();

  /** The tap or click that turned the sound on. */
  private unlockedBy: Event | null = null;

  /** True if this tap is (or will be) the one turning the sound on. */
  isUnlocking(e: Event) {
    return !this.running || this.unlockedBy === e;
  }

  /** True once the audio is running. */
  get running() {
    return this.ctx?.state === "running";
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Starts the audio. Call from a tap or click (and again after an interruption). */
  unlock(e?: Event) {
    try {
      // Phones: play even with the ring/silent switch on, like a music app.
      const nav = navigator as AudioSessionNavigator;
      if (nav.audioSession && nav.audioSession.type !== "playback")
        nav.audioSession.type = "playback";
    } catch {
      // Not supported here.
    }
    if (this.running) return;
    this.unlockedBy = e ?? null;
    if (!this.ctx) this.build();
    const { ctx } = this;
    if (!ctx || ctx.state === "running") return;
    ctx.resume().catch(() => {});
    // A silent blip inside the tap makes older iPhones start the audio.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(ctx.destination);
    blip.start();
  }

  private build() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;
    ctx.onstatechange = () => this.listeners.forEach((l) => l());

    // instruments → dry + room → compressor → limiter → speakers
    const input = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    input.connect(comp);
    const reverb = ctx.createGain();
    reverb.gain.value = REVERB.send;
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    reverb.connect(room);
    room.connect(comp);
    comp.connect(limiter);
    limiter.connect(out);
    out.connect(ctx.destination);
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    out.connect(meter);
    this.input = input;
    this.reverb = reverb;
    this.meterNode = meter;
    const heldBus = ctx.createGain();
    heldBus.connect(input);
    heldBus.connect(reverb);
    const heldMeter = ctx.createAnalyser();
    heldMeter.fftSize = 1024;
    heldBus.connect(heldMeter);
    this.heldBus = heldBus;
    this.heldMeter = heldMeter;
  }

  /** The audio clock, as heard: the time of the sound leaving the speakers now. */
  heardTime() {
    const { ctx } = this;
    if (!ctx) return 0;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime) {
      const t =
        ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      // Guard against a stale stamp: never ahead of the clock.
      return Math.min(t, ctx.currentTime);
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /** Starts a held tone at an audio-clock time (Continuous), or null without sound. */
  hold(
    instrument: InstrumentId,
    hz: number,
    at: number,
    level: number,
    fadeIn?: number,
  ) {
    const { ctx, heldBus } = this;
    if (!ctx || !heldBus || ctx.state !== "running") return null;
    return new HeldVoice(
      ctx,
      [heldBus],
      instrument,
      hz,
      Math.max(at, ctx.currentTime),
      level,
      fadeIn,
    );
  }

  /**
   * Loudness right now, peak and RMS of the last ~20 ms: of the whole
   * output, or of the held tones alone (`"held"`).
   */
  meter(which: "out" | "held" = "out") {
    const m = which === "held" ? this.heldMeter : this.meterNode;
    if (!m) return { peak: 0, rms: 0 };
    if (!this.meterData || this.meterData.length !== m.fftSize)
      this.meterData = new Float32Array(m.fftSize);
    const d = this.meterData;
    m.getFloatTimeDomainData(d);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < d.length; i += 1) {
      peak = Math.max(peak, Math.abs(d[i]));
      sum += d[i] * d[i];
    }
    return { peak, rms: Math.sqrt(sum / d.length) };
  }

  /** Plays a note at an audio-clock time. `gain` scales it (for chords). */
  play(instrument: InstrumentId, hz: number, at: number, gain = 1) {
    const { ctx, input, reverb } = this;
    if (!ctx || !input || !reverb || ctx.state !== "running") return;
    const t = Math.max(at, ctx.currentTime);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    amp.connect(input);
    amp.connect(reverb);
    const voice = VOICES[instrument](ctx, amp, hz, t, NOTE_GAIN * gain);
    voice.amp = amp;
    voice.sources[0].onended = () => {
      amp.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
    this.voices.push(voice);
    if (this.voices.length > MAX_VOICES) {
      // Too many notes ringing: fade the oldest out quickly (no click).
      const old = this.voices.shift();
      const now = ctx.currentTime;
      if (old?.amp) {
        const g = old.amp.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
        g.setTargetAtTime(0, now, 0.012);
      }
      old?.sources.forEach((src) => {
        try {
          src.stop(now + 0.08);
        } catch {
          // Already stopped.
        }
      });
    }
  }
}

/** The one sound engine. */
export const synth = new SynthEngine();
