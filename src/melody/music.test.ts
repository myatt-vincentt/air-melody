import { describe, expect, it } from "vitest";

import {
  crossings,
  LOOP,
  noteName,
  ROWS,
  rowAt,
  rowV,
  SCALE,
  shouldPlay,
  STEP,
  STEPS,
  stepU,
} from "./music";

const field = { top: 0.05, bottom: 0.9 };

describe("the loop", () => {
  it("is 2 bars of 4/4 at 96 BPM in 16th-note steps", () => {
    expect(LOOP).toBeCloseTo(5, 5);
    expect(STEPS).toBe(32);
    expect(STEP).toBeCloseTo(0.15625, 6);
  });
});

describe("pitch", () => {
  it("is C major pentatonic over two octaves, C4 to C6", () => {
    expect(ROWS).toBe(11);
    expect(SCALE.map(noteName)).toEqual([
      "C4",
      "D4",
      "E4",
      "G4",
      "A4",
      "C5",
      "D5",
      "E5",
      "G5",
      "A5",
      "C6",
    ]);
  });

  it("snaps any height to the nearest row, low at the bottom", () => {
    for (let r = 0; r < ROWS; r += 1)
      expect(rowAt(rowV(r, field), field)).toBe(r);
    expect(rowAt(field.bottom, field)).toBe(0);
    expect(rowAt(field.top, field)).toBe(ROWS - 1);
    expect(rowAt(1, field)).toBe(0);
    expect(rowAt(0, field)).toBe(ROWS - 1);
    const gap = (field.bottom - field.top) / (ROWS - 1);
    expect(rowAt(rowV(4, field) - gap * 0.4, field)).toBe(4);
    expect(rowAt(rowV(4, field) - gap * 0.6, field)).toBe(5);
  });
});

describe("crossings", () => {
  const line = (u0: number, u1: number, v: number, n = 40) =>
    Array.from({ length: n + 1 }, (_, i) => ({
      u: u0 + ((u1 - u0) * i) / n,
      v,
    }));

  it("finds where a line crosses the playhead", () => {
    const step = 8;
    const hit = crossings(line(0.1, 0.5, 0.4), step);
    expect(hit).toHaveLength(1);
    expect(hit[0].u).toBeCloseTo(stepU(step), 6);
    expect(hit[0].v).toBeCloseTo(0.4, 6);
    expect(crossings(line(0.1, 0.5, 0.4), 20)).toHaveLength(0);
  });

  it("finds a dot on its nearest 16th", () => {
    const dot = [{ u: 0.26, v: 0.3 }];
    expect(crossings(dot, 8)).toHaveLength(1);
    expect(crossings(dot, 9)).toHaveLength(0);
  });

  it("finds a stroke crossing twice (a loop) as two notes", () => {
    const loop = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 63) * Math.PI * 2;
      return { u: 0.5 + Math.cos(a) * 0.05, v: 0.5 + Math.sin(a) * 0.05 };
    });
    expect(crossings(loop, 16)).toHaveLength(2);
  });

  it("finds a fast stroke with few points", () => {
    expect(
      crossings(
        [
          { u: 0.1, v: 0.2 },
          { u: 0.9, v: 0.6 },
        ],
        16,
      )[0].v,
    ).toBeCloseTo(0.4, 6);
  });
});

describe("when a stroke plays", () => {
  it("plays when it arrives, then every 8th while held", () => {
    let last: number | null = null;
    let was = false;
    const played: number[] = [];
    for (let s = 3; s < 12; s += 1) {
      if (shouldPlay(s, true, was, last)) {
        played.push(s);
        last = s;
      }
      was = true;
    }
    expect(played).toEqual([3, 5, 7, 9, 11]);
  });

  it("plays again when it comes back after a gap", () => {
    expect(shouldPlay(10, true, false, 9)).toBe(true);
    expect(shouldPlay(10, false, true, 8)).toBe(false);
  });
});
