// The loop that plays the drawing. A playhead crosses the screen once every
// loop; on each 16th-note step it looks at what is under it (music.ts) and
// books those notes on the audio clock a little ahead of time, so they land
// on time however busy the page is. The timer only wakes the booking up;
// the notes' times come from the audio clock.
//
// Before the sound is unlocked the loop still runs on the page clock, so the
// playhead sweeps and the strokes glow; the first tap moves it onto the
// audio clock without a jump.
import { synth } from "./audio";
import { INSTRUMENTS, instrumentIndex, type InstrumentId } from "./instruments";
import { fieldFor } from "./layout";
import {
  crossings,
  LOOP,
  midiToHz,
  rowAt,
  SCALE,
  shouldPlay,
  STEP,
  STEPS,
} from "./music";
import { drawing } from "./state";

/** How far ahead notes are booked (s), and how often the booking wakes (ms). */
const LOOKAHEAD = 0.14;
const WAKE_MS = 25;
/** A step this late (s) is skipped rather than played late. */
const LATE = 0.04;
/** Most notes started on one step. */
const MAX_CHORD = 8;
/** Glows kept for drawing. */
const MAX_HITS = 64;

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
  }

  setScreenHeight(h: number) {
    this.screenHeight = h;
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
    for (;;) {
      const at = this.origin + this.next * STEP;
      if (at >= now + LOOKAHEAD) break;
      if (at >= now - LATE) this.playStep(this.next, at);
      else this.forget(this.next);
      this.next += 1;
    }
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
