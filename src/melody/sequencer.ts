// The loop that plays the drawing. A playhead crosses the screen once every
// loop; on each 16th-note step it looks at what is under it (music.ts) and
// books those notes on the audio clock a little ahead of time, so they land
// on time however busy the page is. The timer only wakes the booking up;
// the notes' times come from the audio clock.
//
// Continuous mode: instead of notes on the steps, every line under the
// playhead holds a tone that follows its height (music.ts `glidePitch`).
// The tones' pitches are booked ahead the same way, every few milliseconds
// of the loop, and each tone glides between them. A tone fades in when the
// playhead reaches a line and out when it leaves; several lines make a
// chord. Switching mode fades the held tones in or out, so nothing clicks.
//
// Before the sound is unlocked the loop still runs on the page clock, so the
// playhead sweeps and the strokes glow; the first tap moves it onto the
// audio clock without a jump.
import { synth } from "./audio";
import type { HeldVoice } from "./held";
import { INSTRUMENTS, instrumentIndex, type InstrumentId } from "./instruments";
import { fieldFor } from "./layout";
import {
  crossings,
  glidePitch,
  LOOP,
  midiToHz,
  rowAt,
  SCALE,
  shouldPlay,
  STEP,
  STEPS,
  touchesAt,
} from "./music";
import { drawing, type Mode, type Stroke } from "./state";

/** How far ahead notes are booked (s), and how often the booking wakes (ms). */
const LOOKAHEAD = 0.14;
const WAKE_MS = 25;
/** A step this late (s) is skipped rather than played late. */
const LATE = 0.04;
/** Most notes started on one step. */
const MAX_CHORD = 8;
/** Glows kept for drawing. */
const MAX_HITS = 64;
/** Continuous: how often the held tones' pitches are booked (s). */
const GLIDE_STEP = 0.015;
/** Most held tones at once. */
export const MAX_HELD = 6;
/** Switching mode: held tones fade in and out this gently (time constant, s). */
const SWITCH_FADE = 0.07;
/** How long after switching to Continuous new tones fade in gently (s). */
const SWITCH_WINDOW = 0.3;

/** A line under the playhead in Continuous mode, and the tone it holds. */
export type HeldTouch = {
  /** Which line and which of its crossings (top to bottom). */
  key: string;
  strokeId: number;
  instrument: InstrumentId;
  u: number;
  v: number;
  /** The tone's pitch (fractional MIDI) and how much it snapped (0..1). */
  midi: number;
  pull: number;
};

/** Every line under the playhead at a spot (share of the width), at most `MAX_HELD`. */
export const heldTouches = (
  strokes: readonly Stroke[],
  u: number,
  width: number,
  height: number,
): HeldTouch[] => {
  const field = fieldFor(height);
  const aspect = height / Math.max(1, width);
  const out: HeldTouch[] = [];
  strokes.forEach((stroke) => {
    const { octave } = INSTRUMENTS[instrumentIndex(stroke.instrument)];
    touchesAt(stroke.points, u, aspect).forEach((t, k) => {
      const p = glidePitch(t.v, t.slope, field);
      out.push({
        key: `${stroke.id}:${k}`,
        strokeId: stroke.id,
        instrument: stroke.instrument,
        u,
        v: t.v,
        midi: p.midi + 12 * octave,
        pull: p.pull,
      });
    });
  });
  return out.slice(0, MAX_HELD);
};

/** A note seen on screen: where the playhead touched a stroke, and when. */
export type Hit = {
  time: number;
  u: number;
  v: number;
  /** The instrument's place in the list (its colour). */
  channel: number;
  midi: number;
  instrument: InstrumentId;
};

type Memory = { wasPresent: boolean; lastPlayed: number | null };

const pageClock = () => performance.now() / 1000;

class Sequencer {
  /** The clock the loop runs on, and the loop's start on it. */
  private audio = false;

  private origin = pageClock();

  /** The next step to book, counted from the start. */
  private next = 0;

  private memory = new Map<number, Memory>();

  private timer = 0;

  private screenHeight = 800;

  private screenWidth = 400;

  /** Continuous: the held tones by line, and the next time to book. */
  private held = new Map<string, HeldVoice>();

  private nextGlide = 0;

  private lastMode: Mode = "notes";

  private switchedAt = -Infinity;

  /** Continuous, for debugging: the pitches booked lately (newest last). */
  glideLog: {
    time: number;
    key: string;
    hz: number;
    midi: number;
    pull: number;
    v: number;
  }[] = [];

  /** Notes booked lately, oldest first (for the glows). */
  hits: Hit[] = [];

  /** Every note booked, heard or not, and every note actually played. */
  counts = { hits: 0, notes: 0 };

  /** The last notes played, for debugging (newest last). */
  log: { time: number; instrument: InstrumentId; midi: number }[] = [];

  start() {
    if (this.timer) return;
    this.origin = pageClock();
    this.next = 0;
    this.timer = window.setInterval(() => this.book(), WAKE_MS);
    this.book();
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    if (synth.ctx) this.releaseAll(synth.ctx.currentTime);
  }

  setScreenSize(w: number, h: number) {
    this.screenWidth = w;
    this.screenHeight = h;
  }

  /** How many held tones are sounding (Continuous). */
  get voices() {
    return this.held.size;
  }

  /** Where the playhead is at a time on the loop's clock (share of the width). */
  private phaseAt(t: number) {
    const x = (t - this.origin) / LOOP;
    return x - Math.floor(x);
  }

  /** The time booking works against. */
  private schedTime() {
    if (this.audio && synth.ctx) return synth.ctx.currentTime;
    return pageClock();
  }

  /** The time as seen and heard (for the playhead and the glows). */
  seenTime() {
    return this.audio ? synth.heardTime() : pageClock();
  }

  /** Where the playhead is now, as a share of the screen width. */
  playhead() {
    const t = (this.seenTime() - this.origin) / LOOP;
    return t - Math.floor(t);
  }

  /** Moves the loop onto the audio clock once the sound is running. */
  private followAudio() {
    if (this.audio || !synth.running || !synth.ctx) return;
    const elapsed = pageClock() - this.origin;
    this.audio = true;
    this.origin = synth.heardTime() - elapsed;
    // Glows booked on the page clock move onto the audio clock too.
    const shift = this.origin - (pageClock() - elapsed);
    this.hits.forEach((h) => {
      // eslint-disable-next-line no-param-reassign -- our own records
      h.time += shift;
    });
  }

  private book() {
    this.followAudio();
    const now = this.schedTime();
    const mode = drawing.mode();
    if (mode !== this.lastMode) {
      // Switching: the held tones fade out (to Notes) or in (to Continuous).
      if (mode === "notes") this.releaseAll(now, SWITCH_FADE);
      this.nextGlide = now;
      this.switchedAt = now;
      this.lastMode = mode;
    }
    for (;;) {
      const at = this.origin + this.next * STEP;
      if (at >= now + LOOKAHEAD) break;
      if (mode === "notes" && at >= now - LATE) this.playStep(this.next, at);
      else this.forget(this.next);
      this.next += 1;
    }
    if (mode === "continuous") this.bookGlides(now);
  }

  /** Continuous: books the held tones' pitches up to the lookahead. */
  private bookGlides(now: number) {
    const audible = this.audio && synth.running;
    if (!audible) {
      this.nextGlide = now;
      return;
    }
    // Lines that were cleared let go at once.
    const strokes = drawing.strokes();
    const ids = new Set(strokes.map((s) => s.id));
    this.held.forEach((voice, key) => {
      if (!ids.has(Number(key.split(":")[0]))) {
        voice.release(now);
        this.held.delete(key);
      }
    });
    if (this.nextGlide < now - LATE) this.nextGlide = now;
    while (this.nextGlide < now + LOOKAHEAD) {
      const at = this.nextGlide;
      const touches = heldTouches(
        strokes,
        this.phaseAt(at),
        this.screenWidth,
        this.screenHeight,
      );
      const live = new Set<string>();
      // More tones, each softer: held tones add up.
      const level = 1 / Math.sqrt(Math.max(1, touches.length / 1.5));
      touches.forEach((t) => {
        live.add(t.key);
        const hz = midiToHz(t.midi);
        let voice = this.held.get(t.key);
        if (voice && voice.instrument !== t.instrument) {
          voice.release(at);
          voice = undefined;
        }
        if (!voice) {
          const v = synth.hold(
            t.instrument,
            hz,
            at,
            level,
            at - this.switchedAt < SWITCH_WINDOW ? SWITCH_FADE : undefined,
          );
          if (v) this.held.set(t.key, v);
        } else {
          voice.glide(at, hz);
          voice.setLevel(at, level);
        }
        // For debugging only: kept in development builds.
        if (process.env.NODE_ENV !== "production")
          this.glideLog.push({
            time: at,
            key: t.key,
            hz,
            midi: t.midi,
            pull: t.pull,
            v: t.v,
          });
      });
      this.held.forEach((voice, key) => {
        if (!live.has(key)) {
          voice.release(at);
          this.held.delete(key);
        }
      });
      this.nextGlide += GLIDE_STEP;
    }
    if (this.glideLog.length > 4000)
      this.glideLog.splice(0, this.glideLog.length - 4000);
  }

  /** Fades every held tone out from `at`. */
  private releaseAll(at: number, fade?: number) {
    this.held.forEach((voice) => voice.release(at, fade));
    this.held.clear();
  }

  /** A skipped step: what is under the playhead counts as heard. */
  private forget(step: number) {
    const s = step % STEPS;
    drawing.strokes().forEach((stroke) => {
      const m = this.memory.get(stroke.id);
      const present = crossings(stroke.points, s).length > 0;
      this.memory.set(stroke.id, {
        wasPresent: present,
        lastPlayed: m?.lastPlayed ?? null,
      });
    });
  }

  private playStep(step: number, at: number) {
    const s = step % STEPS;
    const field = fieldFor(this.screenHeight);
    const notes: Hit[] = [];
    const strokes = drawing.strokes();
    strokes.forEach((stroke) => {
      const where = crossings(stroke.points, s);
      const m = this.memory.get(stroke.id) ?? {
        wasPresent: false,
        lastPlayed: null,
      };
      const present = where.length > 0;
      const play = shouldPlay(step, present, m.wasPresent, m.lastPlayed);
      this.memory.set(stroke.id, {
        wasPresent: present,
        lastPlayed: play ? step : m.lastPlayed,
      });
      if (!play) return;
      const channel = instrumentIndex(stroke.instrument);
      const { octave } = INSTRUMENTS[channel];
      where.forEach((p) => {
        const midi = SCALE[rowAt(p.v, field)] + 12 * octave;
        notes.push({
          time: at,
          u: p.u,
          v: p.v,
          channel,
          midi,
          instrument: stroke.instrument,
        });
      });
    });
    // Strokes that are gone are forgotten.
    if (this.memory.size > strokes.length * 2 + 16) {
      const ids = new Set(strokes.map((x) => x.id));
      [...this.memory.keys()].forEach((id) => {
        if (!ids.has(id)) this.memory.delete(id);
      });
    }
    if (notes.length === 0) return;

    const audible = this.audio && synth.running;
    // The same note twice in one chord is played once (but glows twice).
    const played = new Set<string>();
    const unique = notes.filter((n) => {
      const key = `${n.instrument}:${n.midi}`;
      if (played.has(key)) return false;
      played.add(key);
      return true;
    });
    const chord = unique.slice(0, MAX_CHORD);
    // Bigger chords play each note a little softer.
    const gain = 1 / Math.sqrt(Math.max(1, chord.length / 1.5));
    if (audible) {
      chord.forEach((n) => {
        synth.play(n.instrument, midiToHz(n.midi), at, gain);
        this.counts.notes += 1;
        this.log.push({ time: at, instrument: n.instrument, midi: n.midi });
      });
      if (this.log.length > 256) this.log.splice(0, this.log.length - 256);
    }
    this.counts.hits += notes.length;
    this.hits.push(...notes);
    if (this.hits.length > MAX_HITS)
      this.hits.splice(0, this.hits.length - MAX_HITS);
  }
}

/** The one loop. */
export const sequencer = new Sequencer();
