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

// --- Continuous: every point of a line sounds --------------------------------

/** Where a line crosses the playhead line exactly, and how steep it is there. */
export type Touch = { v: number; slope: number };

/** A dot sounds while the playhead is within this of it (share of the width). */
export const DOT_REACH = 0.5 / STEPS;

/**
 * Every place a stroke crosses the vertical line at `x` (share of the
 * width), top to bottom, with the line's steepness there (screen pixels up
 * per pixel across, from a few pixels either side). `aspect` is the screen's
 * height over its width; `reach` how far either side the slope is read.
 */
export const touchesAt = (
  points: readonly Point[],
  x: number,
  aspect: number,
  reach = 0.02,
): Touch[] => {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0];
    return Math.abs(p.u - x) < DOT_REACH ? [{ v: p.v, slope: 0 }] : [];
  }
  const at = (xx: number) => {
    const out: number[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const lo = Math.min(a.u, b.u);
      const hi = Math.max(a.u, b.u);
      if (hi > lo && xx >= lo && xx < hi)
        out.push(a.v + ((b.v - a.v) * (xx - a.u)) / (b.u - a.u));
    }
    return out;
  };
  const here = at(x).sort((p, q) => p - q);
  if (here.length === 0) return [];
  const left = at(x - reach);
  const right = at(x + reach);
  const nearest = (vs: number[], v: number) =>
    vs.reduce<number | null>(
      (best, c) =>
        best === null || Math.abs(c - v) < Math.abs(best - v) ? c : best,
      null,
    );
  return here.map((v) => {
    const l = nearest(left, v);
    const r = nearest(right, v);
    let slope = 0;
    if (l !== null && r !== null) slope = ((r - l) * aspect) / (2 * reach);
    else if (r !== null) slope = ((r - v) * aspect) / reach;
    else if (l !== null) slope = ((v - l) * aspect) / reach;
    return { v, slope: Math.abs(slope) };
  });
};

/** Snapping: full on lines flatter than this slope, none on lines steeper than that. */
export const SNAP_SLOPE = [0.12, 0.8] as const;
/** How close to the note a flat line settles (1 = exactly on it). */
export const SNAP_MAX = 0.94;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The pitch of a line at a height, gliding but settling onto the scale: the
 * exact height between rows, pulled toward the nearest row the flatter the
 * line is. Returns the row (with its fraction) and the MIDI pitch (with its
 * fraction), sliding between neighbouring scale notes.
 */
export const glidePitch = (v: number, slope: number, field: Field) => {
  const exact = Math.min(
    ROWS - 1,
    Math.max(0, ((field.bottom - v) / (field.bottom - field.top)) * (ROWS - 1)),
  );
  const near = Math.round(exact);
  const pull = (1 - smoothstep(SNAP_SLOPE[0], SNAP_SLOPE[1], slope)) * SNAP_MAX;
  const row = exact + (near - exact) * pull;
  const lo = Math.floor(row);
  const hi = Math.min(ROWS - 1, lo + 1);
  const midi = SCALE[lo] + (SCALE[hi] - SCALE[lo]) * (row - lo);
  return { exact, row, midi, pull };
};
