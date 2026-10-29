import { describe, expect, it } from "vitest";

import {
  feedGlide,
  glideAt,
  nextPinch,
  PEN,
  startGlide,
  strokeLength,
} from "./pen";

describe("pinch with hysteresis", () => {
  it("needs a firm pinch to start and a clear opening to stop", () => {
    expect(nextPinch(false, 0.5, 0, false)).toBe(false);
    expect(nextPinch(false, PEN.down, 0, false)).toBe(true);
    // Between the two thresholds it keeps what it was: no flicker.
    expect(nextPinch(true, 0.5, 0, false)).toBe(true);
    expect(nextPinch(false, 0.5, 0, false)).toBe(false);
    expect(nextPinch(true, PEN.up - 0.01, 0, false)).toBe(false);
  });

  it("doesn't count a fist or two hands together", () => {
    expect(nextPinch(false, 1, 0.9, false)).toBe(false);
    expect(nextPinch(true, 1, 0, true)).toBe(false);
  });
});

describe("the glide between readings", () => {
  const W = 400;
  const H = 800;

  it("reaches each reading and passes through it", () => {
    const g = startGlide({ u: 0.2, v: 0.5 }, 0);
    expect(feedGlide(g, { u: 0.3, v: 0.5 }, 83, W, H)).toBe(true);
    const mid = glideAt(g, 83 + g.span / 2);
    expect(mid.u).toBeGreaterThan(0.2);
    expect(mid.u).toBeLessThan(0.3);
    const end = glideAt(g, 83 + g.span);
    expect(end.u).toBeCloseTo(0.3, 6);
    expect(end.v).toBeCloseTo(0.5, 6);
  });

  it("starts where the pen is, so there is never a step", () => {
    const g = startGlide({ u: 0.2, v: 0.5 }, 0);
    feedGlide(g, { u: 0.3, v: 0.5 }, 83, W, H);
    const here = glideAt(g, 100);
    feedGlide(g, { u: 0.4, v: 0.55 }, 100, W, H);
    const now = glideAt(g, 100);
    expect(now.u).toBeCloseTo(here.u, 6);
    expect(now.v).toBeCloseTo(here.v, 6);
  });

  it("breaks on a jump", () => {
    const g = startGlide({ u: 0.1, v: 0.5 }, 0);
    expect(feedGlide(g, { u: 0.8, v: 0.5 }, 83, W, H)).toBe(false);
    expect(glideAt(g, 90).u).toBeCloseTo(0.8, 6);
  });

  it("steadies a hand held still", () => {
    const g = startGlide({ u: 0.5, v: 0.5 }, 0);
    feedGlide(g, { u: 0.5 + 1 / W, v: 0.5 }, 83, W, H);
    expect(glideAt(g, 1000).u - 0.5).toBeLessThan(1 / W);
  });
});

describe("a quick pinch is a dot", () => {
  it("measures strokes in pixels", () => {
    expect(
      strokeLength(
        [
          { u: 0, v: 0 },
          { u: 0.01, v: 0 },
        ],
        400,
        800,
      ),
    ).toBeCloseTo(4, 6);
    expect(strokeLength([{ u: 0, v: 0 }], 400, 800)).toBe(0);
  });
});
