// A hand as a pen: pinch (thumb tip to index tip) is pen down, open is pen
// up. The tracker reads the hand about 12 times a second; between readings
// the pen glides on a smooth curve from where it is to the newest point
// (rounding the corners between readings), so a line drawn in the air is
// smooth. Pure, so it can be tested on its own.
import type { Point } from "./music";

export const PEN = {
  /** Pinch amount (1 = tips touching) that puts the pen down, and lifts it. */
  down: 0.62,
  up: 0.4,
  /** A fist also brings the tips together; above this grab it isn't a pinch. */
  maxGrab: 0.5,
  /**
   * Two hands closer than this (palm to palm, tracker units: the screen is
   * 2 wide) overlap, and the hidden fingers misread as a pinch.
   */
  handsApart: 0.4,
  /** Readings in a row a pinch must last before the pen goes down. */
  confirm: 2,
  /**
   * A hand only half in the picture (at an edge) is often misread; a pinch
   * this close to an edge (share of the screen) doesn't count.
   */
  edge: 0.03,
  /** A reading this far from the last (share of the screen) is a new place: no line between. */
  jump: 0.22,
  /** Small moves are eased (this share taken), so a held hand doesn't shake. */
  steady: 0.55,
  steadyPx: 6,
  /** A stroke shorter than this (px) when the pen lifts is a dot. */
  dotPx: 16,
  /**
   * The glide to a new reading takes this share of the time between
   * readings (ms, within the bounds): shorter keeps the line close behind the
   * fingers, longer is smoother.
   */
  glideShare: 0.65,
  glide: [30, 100] as const,
};

/** Pinch with hysteresis: harder to start than to keep, so it doesn't flicker. */
export const nextPinch = (
  wasDown: boolean,
  pinch: number,
  grab: number,
  handsTogether: boolean,
) => {
  if (grab > PEN.maxGrab || handsTogether) return false;
  return wasDown ? pinch > PEN.up : pinch >= PEN.down;
};

/** True when a point is far enough inside the screen for its pinch to count. */
export const insideScreen = (p: Point) =>
  p.u > PEN.edge && p.u < 1 - PEN.edge && p.v > PEN.edge && p.v < 1 - PEN.edge;

export type Glide = {
  from: Point;
  to: Point;
  /** The curve's direction leaving `from` and arriving at `to`. */
  out: Point;
  in: Point;
  /** The reading before `to`. */
  prev: Point;
  /** When the newest reading arrived, and how long the glide to it takes (ms). */
  at: number;
  span: number;
  /** When the reading before arrived (ms), or null. */
  last: number | null;
};

const ZERO: Point = { u: 0, v: 0 };

export const startGlide = (p: Point, now: number): Glide => ({
  from: p,
  to: p,
  out: ZERO,
  in: ZERO,
  prev: p,
  at: now,
  span: 1,
  last: null,
});

/** Where the pen is now on its glide. */
export const glideAt = (g: Glide, now: number): Point => {
  const t = Math.min(1, Math.max(0, (now - g.at) / g.span));
  // A Hermite curve: leaves `from` along `out`, arrives at `to` along `in`.
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    u: h00 * g.from.u + h10 * g.out.u + h01 * g.to.u + h11 * g.in.u,
    v: h00 * g.from.v + h10 * g.out.v + h01 * g.to.v + h11 * g.in.v,
  };
};

/**
 * A new reading: glide on to it from where the pen is now. Returns false
 * when it is a jump (the pen should snap there and any line should break).
 * `width` and `height` are the screen size (px), for the steadying.
 */
export const feedGlide = (
  g: Glide,
  raw: Point,
  now: number,
  width: number,
  height: number,
): boolean => {
  const here = glideAt(g, now);
  const du = raw.u - g.to.u;
  const dv = raw.v - g.to.v;
  if (Math.hypot(du, dv * (height / Math.max(1, width))) > PEN.jump) {
    Object.assign(g, startGlide(raw, now));
    return false;
  }
  // Steady a hand held still: tiny moves are eased, real moves taken whole.
  const px = Math.hypot(du * width, dv * height);
  const k = Math.min(1, PEN.steady + (1 - PEN.steady) * (px / PEN.steadyPx));
  const span =
    g.last === null
      ? PEN.glide[0]
      : Math.min(
          PEN.glide[1],
          Math.max(PEN.glide[0], (now - g.last) * PEN.glideShare),
        );
  const to = { u: g.to.u + du * k, v: g.to.v + dv * k };
  // Leave along the line through the readings either side of here (a
  // Catmull-Rom tangent), arrive heading straight on.
  const out = { u: (to.u - g.prev.u) * 0.5, v: (to.v - g.prev.v) * 0.5 };
  const arrive = { u: (to.u - g.to.u) * 0.5, v: (to.v - g.to.v) * 0.5 };
  Object.assign(g, {
    from: here,
    to,
    out,
    in: arrive,
    prev: g.to,
    at: now,
    span,
    last: now,
  });
  return true;
};

/** How long a stroke is, in pixels. */
export const strokeLength = (
  ps: readonly Point[],
  width: number,
  height: number,
) => {
  let n = 0;
  for (let i = 1; i < ps.length; i += 1)
    n += Math.hypot(
      (ps[i].u - ps[i - 1].u) * width,
      (ps[i].v - ps[i - 1].v) * height,
    );
  return n;
};
