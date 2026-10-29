// The drawing and the chosen instrument, shared by the input, the picture,
// the sound and the controls. Points are shares of the screen, so a drawing
// keeps its shape when the window changes size.
import { useSyncExternalStore } from "react";

import type { InstrumentId } from "./instruments";
import type { Point } from "./music";

export type Stroke = {
  id: number;
  instrument: InstrumentId;
  points: Point[];
  /** A tap: a single dot. */
  dot: boolean;
};

/** Most points kept in the whole drawing; the oldest strokes go first. */
export const MAX_POINTS = 6000;

let strokes: Stroke[] = [];
let nextId = 1;
/**
 * How every line plays: as notes on the steps, or as held tones that follow
 * each line's height as the playhead crosses it.
 */
export type Mode = "notes" | "continuous";

let instrument: InstrumentId = "marimba";
let mode: Mode = "notes";
/** True once the person has drawn something themselves (not the demo). */
let drew = false;
let version = 0;
const listeners = new Set<() => void>();

const changed = () => {
  version += 1;
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const trim = () => {
  let total = strokes.reduce((n, s) => n + s.points.length, 0);
  while (total > MAX_POINTS && strokes.length > 1) {
    total -= strokes[0].points.length;
    strokes = strokes.slice(1);
  }
};

export const drawing = {
  strokes: () => strokes,
  version: () => version,
  instrument: () => instrument,
  mode: () => mode,
  setMode: (m: Mode) => {
    if (m === mode) return;
    mode = m;
    changed();
  },
  /** True once the person has drawn something themselves (not the demo). */
  drewOwn: () => drew,
  setInstrument: (id: InstrumentId) => {
    instrument = id;
    changed();
  },
  /** Starts a stroke of the person's own at a point, in the chosen instrument. */
  begin: (p: Point, as: InstrumentId = instrument): Stroke => {
    const s: Stroke = { id: nextId, instrument: as, points: [p], dot: true };
    nextId += 1;
    drew = true;
    strokes = [...strokes, s];
    trim();
    changed();
    return s;
  },
  extend: (s: Stroke, ps: Point[]) => {
    if (ps.length === 0) return;
    s.points.push(...ps);
    // eslint-disable-next-line no-param-reassign -- the stroke is ours
    s.dot = false;
    trim();
    changed();
  },
  /** Turns a stroke into a dot at its first point (a tap). */
  toDot: (s: Stroke) => {
    s.points.splice(1);
    // eslint-disable-next-line no-param-reassign -- the stroke is ours
    s.dot = true;
    changed();
  },
  /** Adds a finished stroke (the demo phrase). */
  add: (as: InstrumentId, points: Point[]) => {
    const s: Stroke = {
      id: nextId,
      instrument: as,
      points,
      dot: points.length === 1,
    };
    nextId += 1;
    strokes = [...strokes, s];
    trim();
    changed();
    return s;
  },
  clear: () => {
    strokes = [];
    changed();
  },
};

/** Re-renders when the drawing or the instrument changes. */
export const useDrawingVersion = () =>
  useSyncExternalStore(subscribe, drawing.version);
