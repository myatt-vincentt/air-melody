// Drawing in the air: pinch to put the pen down, open the hand to lift it.
// The line follows the pinch point (between the thumb and index tips) in the
// chosen instrument. Either hand draws, and two hands draw at once, each its
// own stroke. A quick pinch drops a dot.
//
// Each tracked hand shows a small glowing ring at its pinch point, in the
// instrument's colour: hollow while open, filled while pinched (NeonLayer.tsx
// draws it from `pens`).
//
// Hands follow their stable identity (the SDK's `poses.left` / `.right`).
// Only fresh readings count; a lost hand lifts its pen.
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { XRModel } from "@vincentt-xr/sdk";
import { HandTracker } from "@vincentt-xr/sdk/tracking";
import {
  measureGrab,
  measurePinch,
  useXRModelNode,
  type XRModelNodeHandTracking,
} from "@vincentt-xr/sdk/low-level";

import { synth } from "./audio";
import { fieldFor } from "./layout";
import type { Point } from "./music";
import {
  feedGlide,
  glideAt,
  insideScreen,
  nextPinch,
  PEN,
  startGlide,
  strokeLength,
  type Glide,
} from "./pen";
import { drawing, type Stroke } from "./state";

/**
 * Hand readings per second. The hand model is the costliest thing on
 * screen; 12 is plenty for drawing with the glide in between.
 */
export const HAND_FPS = 12;

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const PALM = 9;
/** Points closer than this (px) are skipped. */
const MIN_STEP = 2.5;
/** The ring fades in and out, and fills, over about this long (s). */
const RING_EASE = 0.12;

type Side = "left" | "right";
const SIDES: Side[] = ["left", "right"];

/** What the picture needs to draw one hand's ring. */
export type Pen = {
  /** 0..1: seen (fades in and out). */
  shown: number;
  /** 0..1: filled while pinched. */
  filled: number;
  u: number;
  v: number;
};

type PenState = {
  tracked: boolean;
  /** The pinch as read (with hysteresis), and how many readings in a row. */
  pinched: boolean;
  run: number;
  /** Over the drawing area (where a pinch can start; the ring shows). */
  drawable: boolean;
  down: boolean;
  stamp: number;
  glide: Glide | null;
  stroke: Stroke | null;
  last: Point | null;
};

/** The two hands' rings, for the picture. */
export const pens: Record<Side, Pen> = {
  left: { shown: 0, filled: 0, u: 0.5, v: 0.5 },
  right: { shown: 0, filled: 0, u: 0.5, v: 0.5 },
};

const fresh = (): PenState => ({
  tracked: false,
  pinched: false,
  run: 0,
  drawable: false,
  down: false,
  stamp: -1,
  glide: null,
  stroke: null,
  last: null,
});

export const HandPen = () => {
  const hands = useXRModelNode<XRModelNodeHandTracking>(XRModel.HAND_TRACKER);
  const size = useThree((s) => s.size);
  const state = useRef<Record<Side, PenState>>({
    left: fresh(),
    right: fresh(),
  });

  useFrame((_, delta) => {
    const now = performance.now();
    const { width, height } = size;
    const poses = hands?.poses;
    const live = (s: Side) => {
      const h = poses?.[s];
      return h && !h.held && h.image.length > 20 ? h : null;
    };
    const ease = 1 - Math.exp(-delta / RING_EASE);

    SIDES.forEach((side) => {
      const st = state.current[side];
      const hand = live(side);
      const pen = pens[side];

      const lift = () => {
        if (st.stroke) {
          if (strokeLength(st.stroke.points, width, height) < PEN.dotPx)
            drawing.toDot(st.stroke);
        }
        st.stroke = null;
        st.last = null;
        st.down = false;
      };

      if (!hand) {
        if (st.tracked) lift();
        st.tracked = false;
        st.glide = null;
        st.pinched = false;
        st.run = 0;
        pen.shown += (0 - pen.shown) * ease;
        pen.filled += (0 - pen.filled) * ease;
        return;
      }

      if (hand.timestampMs !== st.stamp) {
        st.stamp = hand.timestampMs;
        const pts = hand.image;
        // The pinch point, between the tips. Tracker points are centre
        // origin, y up and already mirrored like the picture.
        const tip = {
          u: ((pts[THUMB_TIP].x + pts[INDEX_TIP].x) / 2) * 0.5 + 0.5,
          v: 0.5 - ((pts[THUMB_TIP].y + pts[INDEX_TIP].y) / 2) * 0.5,
        };
        const other = live(side === "left" ? "right" : "left");
        const together =
          !!other &&
          Math.hypot(
            other.image[PALM].x - pts[PALM].x,
            other.image[PALM].y - pts[PALM].y,
          ) < PEN.handsApart;
        // Pinches only count over the drawing area: hands resting low (crossed
        // arms, a hand coming into view from below) are often misread.
        const field = fieldFor(height);
        st.drawable =
          insideScreen(tip) && tip.v < field.bottom + 0.25 * (1 - field.bottom);
        st.pinched =
          (st.drawable || (st.pinched && insideScreen(tip))) &&
          nextPinch(st.pinched, measurePinch(pts), measureGrab(pts), together);
        st.run = st.pinched ? st.run + 1 : 0;
        // Down once the pinch has held a moment (no stray strokes from a
        // misread hand), up as soon as it opens.
        const down = st.pinched && (st.down || st.run >= PEN.confirm);
        let joined = true;
        if (!st.glide) st.glide = startGlide(tip, now);
        else joined = feedGlide(st.glide, tip, now, width, height);
        // A jump breaks the line: lift and, if still pinched, start again there.
        if (!joined && st.down) lift();
        if (down && !st.down) {
          // Pen down: a fresh stroke right at the pinch.
          st.glide = startGlide(st.glide.to, now);
          st.stroke = drawing.begin(st.glide.to);
          st.last = st.glide.to;
          // Sound on, where the browser allows it without a tap.
          synth.unlock();
        } else if (!down && st.down) lift();
        st.down = down;
        st.tracked = true;
      }

      const at = st.glide ? glideAt(st.glide, now) : null;
      if (!at) return;
      if (st.down && st.stroke && st.last) {
        const px = Math.hypot(
          (at.u - st.last.u) * width,
          (at.v - st.last.v) * height,
        );
        if (px >= MIN_STEP) {
          drawing.extend(st.stroke, [at]);
          st.last = at;
        }
      }
      pen.u = at.u;
      pen.v = at.v;
      pen.shown += ((st.drawable || st.down ? 1 : 0) - pen.shown) * ease;
      pen.filled += ((st.down ? 1 : 0) - pen.filled) * ease;
    });
  });

  return <HandTracker targetFps={HAND_FPS} />;
};
