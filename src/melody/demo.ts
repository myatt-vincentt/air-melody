// The short phrase drawn for you on the first visit, so it is clear what to
// do: a rising and falling marimba line on the left, a soft-keys arc on the
// right and two synth-pluck dots low in the middle, clear of the face. It plays as soon
// as the sound is on and goes with clear.
import type { InstrumentId } from "./instruments";
import { rowV, type Field, type Point } from "./music";
import { drawing } from "./state";

/** Each stroke as (across, row) control points; rows count up from the lowest note. */
const PHRASE: { instrument: InstrumentId; points: [number, number][] }[] = [
  {
    instrument: "marimba",
    points: [
      [0.05, 3],
      [0.14, 5.2],
      [0.23, 6.2],
      [0.31, 4.4],
      [0.4, 5.6],
    ],
  },
  {
    instrument: "keys",
    points: [
      [0.6, 4],
      [0.7, 6.2],
      [0.8, 6.9],
      [0.89, 5.6],
      [0.95, 3.8],
    ],
  },
  { instrument: "pluck", points: [[0.46, 1.6]] },
  { instrument: "pluck", points: [[0.54, 2.6]] },
];

/** Samples between two control points. */
const SAMPLES = 18;

/** A smooth curve through the points (Catmull-Rom). */
const smooth = (ps: Point[]): Point[] => {
  if (ps.length < 2) return ps;
  const out: Point[] = [ps[0]];
  for (let i = 0; i < ps.length - 1; i += 1) {
    const p0 = ps[Math.max(0, i - 1)];
    const p1 = ps[i];
    const p2 = ps[i + 1];
    const p3 = ps[Math.min(ps.length - 1, i + 2)];
    for (let s = 1; s <= SAMPLES; s += 1) {
      const t = s / SAMPLES;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t2 +
          (-a + 3 * b - 3 * c + d) * t3);
      out.push({
        u: f(p0.u, p1.u, p2.u, p3.u),
        v: f(p0.v, p1.v, p2.v, p3.v),
      });
    }
  }
  return out;
};

let shown = false;

/** Draws the phrase once per visit, on an empty canvas. */
export const showDemo = (field: Field) => {
  if (shown || drawing.strokes().length > 0) return;
  shown = true;
  PHRASE.forEach(({ instrument, points }) => {
    const ps = points.map(([u, row]) => ({ u, v: rowV(row, field) }));
    drawing.add(instrument, smooth(ps));
  });
};
