// The music: the loop, the scale and how a drawing turns into notes.
//
// X is time: the playhead crosses the screen once per loop, left to right.
// Y is pitch: the drawing area has one row per note of C major pentatonic
// over two octaves, low at the bottom. Any height snaps to the nearest row,
// so every scribble stays in tune.
//
// The loop is cut into 16th-note steps. A stroke plays when the playhead
// first reaches it (on the nearest 16th), and while it stays under the
// playhead it plays again every 8th note, so a long line is a run of notes
// rather than a drone. Strokes under the playhead together play as a chord.
// Pure and dependency-free, so it can be tested on its own.

/** Tempo and loop: 2 bars of 4/4 at 96 BPM, about 5 s across the screen. */
export const BPM = 96;
export const LOOP_BEATS = 8;
export const BEAT = 60 / BPM;
export const LOOP = LOOP_BEATS * BEAT;
/** 16th-note steps per loop (where notes can start). */
export const STEPS = LOOP_BEATS * 4;
export const STEP = LOOP / STEPS;
/** A held stroke plays again after this many steps (an 8th note). */
export const REPEAT_STEPS = 2;
/** Ticks along the bottom edge: one per 8th note. */
export const TICKS = LOOP_BEATS * 2;

/** The rows, low to high: C major pentatonic from C4 to C6 (MIDI numbers). */
export const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84] as const;
export const ROWS = SCALE.length;

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "C4", "A5"… for a MIDI note. */
export const noteName = (midi: number) =>
  `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

export const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A point of a stroke, as a share of the screen (u across, v down). */
export type Point = { u: number; v: number };

/** The drawing area's top and bottom, as shares of the screen height. */
export type Field = { top: number; bottom: number };

/** The row (0 = lowest) for a height on screen. */
export const rowAt = (v: number, field: Field) => {
  const f = (field.bottom - v) / (field.bottom - field.top);
  return Math.min(ROWS - 1, Math.max(0, Math.round(f * (ROWS - 1))));
};

/** The height on screen of a row's line. */
export const rowV = (row: number, field: Field) =>
  field.bottom - (row / (ROWS - 1)) * (field.bottom - field.top);

/** Where the playhead is at a step (share of the screen width). */
export const stepU = (step: number) => step / STEPS;

/**
 * Where a stroke is under the playhead at a step: one entry per separate
 * crossing (a loop crosses twice, a wave can cross several times). Each is
 * the point of the stroke where the playhead touches it.
 */
export const crossings = (points: readonly Point[], step: number): Point[] => {
  const x = stepU(step);
  const half = 0.5 / STEPS;
  const lo = x - half;
  const hi = x + half;
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0];
    return p.u >= lo && p.u < hi ? [{ u: p.u, v: p.v }] : [];
  }
  const out: Point[] = [];
  // A run is a stretch of consecutive segments inside the step's column.
  let inRun = false;
  let best: Point | null = null;
  let bestD = Infinity;
  let crossed = false;
  const endRun = () => {
    if (best) out.push(best);
    inRun = false;
    best = null;
    bestD = Infinity;
    crossed = false;
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const min = Math.min(a.u, b.u);
    const max = Math.max(a.u, b.u);
    const inside = max >= lo && min < hi;
    if (!inside) {
      if (inRun) endRun();
    } else {
      inRun = true;
      if (!crossed && min <= x && max >= x && max > min) {
        // The segment crosses the playhead line: take the exact spot.
        const t = (x - a.u) / (b.u - a.u);
        best = { u: x, v: a.v + (b.v - a.v) * t };
        crossed = true;
      } else if (!crossed) {
        const ends = [a, b];
        for (let e = 0; e < 2; e += 1) {
          const p = ends[e];
          const d = Math.abs(p.u - x);
          if (d < bestD && p.u >= lo && p.u < hi) {
            bestD = d;
            best = { u: p.u, v: p.v };
          }
        }
      }
    }
  }
  if (inRun) endRun();
  return out;
};

/**
 * Should a stroke play at this step? On the step it first appears under the
 * playhead, and then every `REPEAT_STEPS` steps while it stays there. Steps
 * are counted from the start and never wrap. `lastPlayed` is the step it last
 * played (or null), `wasPresent` whether it was under the playhead at the
 * step before.
 */
export const shouldPlay = (
  step: number,
  present: boolean,
  wasPresent: boolean,
  lastPlayed: number | null,
) => {
  if (!present) return false;
  if (!wasPresent || lastPlayed === null) return true;
  return step - lastPlayed >= REPEAT_STEPS;
};
