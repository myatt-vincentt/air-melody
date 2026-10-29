// Drawing in the air: pinch to put the pen down, open the hand to lift it.
// The line follows the pinch point (between the thumb and index tips) in the
// chosen instrument. Either hand draws, and two hands draw at once, each its
// own stroke. A quick pinch drops a dot.
//
// Hands also work the control band: a pinch over a chip picks it (an
// instrument or a play mode) instead of drawing; clear needs the pinch held
// over the trash for a moment, with a ring filling around it, so it can't be
// wiped by accident. A chip glows softly while a hand hovers over it.
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
import { hudAt, hudKind, pressHud, setHudFill, setHudHover } from "./hud";
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
/** Clear by hand: how long the pinch is held over the trash (ms). */
const CLEAR_HOLD_MS = 600;
/** Pinches count down to this far below the bottom row (share of the height). */
const BELOW_FIELD = 0.03;

type Side = "left" | "right";
const SIDES: Side[] = ["left", "right"];

/** One reading of a hand: where its pinch is, how pinched, how fisted. */
export type HandReading = {
  stamp: number;
  /** The pinch point (share of the screen, y down). */
  tip: Point;
  /** The palm centre (tracker units, for telling two hands apart). */
  palm: { x: number; y: number };
  pinch: number;
  grab: number;
};

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
  /** Over the drawing area (where a stroke can start; the ring shows). */
  drawable: boolean;
  /** The chip under the pinch point at the last reading. */
  over: HTMLElement | null;
  down: boolean;
  stamp: number;
  glide: Glide | null;
  stroke: Stroke | null;
  last: Point | null;
  /** A pinch that went to a chip: which, when, and whether it is done. */
  chip: { el: HTMLElement; at: number; done: boolean } | null;
};

/** The two hands' rings, for the picture. */
export const pens: Record<Side, Pen> = {
  left: { shown: 0, filled: 0, u: 0.5, v: 0.5 },
  right: { shown: 0, filled: 0, u: 0.5, v: 0.5 },
};

/**
 * Development only: readings to use instead of the tracker's, per hand
 * (window.__melody.fakeHand), for checking the hand controls without a
 * camera.
 */
export const devHands: Partial<Record<Side, HandReading | null>> = {};

const fresh = (): PenState => ({
  tracked: false,
  pinched: false,
  run: 0,
  drawable: false,
  over: null,
  down: false,
  stamp: -1,
  glide: null,
  stroke: null,
  last: null,
  chip: null,
});

type HandPose = NonNullable<XRModelNodeHandTracking["poses"]>["left"];

/** A tracker hand as a reading. Tracker points are centre origin, y up and already mirrored like the picture. */
const readPose = (h: NonNullable<HandPose>): HandReading => {
  const pts = h.image;
  return {
    stamp: h.timestampMs,
    tip: {
      u: ((pts[THUMB_TIP].x + pts[INDEX_TIP].x) / 2) * 0.5 + 0.5,
      v: 0.5 - ((pts[THUMB_TIP].y + pts[INDEX_TIP].y) / 2) * 0.5,
    },
    palm: { x: pts[PALM].x, y: pts[PALM].y },
    pinch: measurePinch(pts),
    grab: measureGrab(pts),
  };
};

export const HandPen = () => {
  const hands = useXRModelNode<XRModelNodeHandTracking>(XRModel.HAND_TRACKER);
  const size = useThree((s) => s.size);
  const canvas = useThree((s) => s.gl.domElement);
  const state = useRef<Record<Side, PenState>>({
    left: fresh(),
    right: fresh(),
  });

  useFrame((_, delta) => {
    const now = performance.now();
    const { width, height } = size;
    const rect = canvas.getBoundingClientRect();
    const chipAt = (p: Point) =>
      hudAt(rect.left + p.u * rect.width, rect.top + p.v * rect.height);
    const reading = (s: Side): HandReading | null => {
      if (process.env.NODE_ENV !== "production" && devHands[s] !== undefined)
        return devHands[s] ?? null;
      const h = hands?.poses?.[s];
      return h && !h.held && h.image.length > 20 ? readPose(h) : null;
    };
    const ease = 1 - Math.exp(-delta / RING_EASE);
    const hovering = new Set<HTMLElement>();

    SIDES.forEach((side) => {
      const st = state.current[side];
      const hand = reading(side);
      const pen = pens[side];

      const release = () => {
        if (st.stroke) {
          if (strokeLength(st.stroke.points, width, height) < PEN.dotPx)
            drawing.toDot(st.stroke);
        }
        if (st.chip) setHudFill(st.chip.el, null);
        st.chip = null;
        st.stroke = null;
        st.last = null;
        st.down = false;
      };

      if (!hand) {
        if (st.tracked) release();
        st.tracked = false;
        st.glide = null;
        st.pinched = false;
        st.run = 0;
        st.over = null;
        pen.shown += (0 - pen.shown) * ease;
        pen.filled += (0 - pen.filled) * ease;
        return;
      }

      if (hand.stamp !== st.stamp) {
        st.stamp = hand.stamp;
        const { tip } = hand;
        const other = reading(side === "left" ? "right" : "left");
        const together =
          !!other &&
          Math.hypot(other.palm.x - hand.palm.x, other.palm.y - hand.palm.y) <
            PEN.handsApart;
        // Strokes start only over the drawing area: hands resting low
        // (crossed arms, a hand coming into view from below) are often
        // misread. Chips count wherever they are.
        const field = fieldFor(height);
        const inside = insideScreen(tip);
        st.over = inside ? chipAt(tip) : null;
        st.drawable = inside && !st.over && tip.v < field.bottom + BELOW_FIELD;
        st.pinched =
          (st.drawable || !!st.over || (st.pinched && inside)) &&
          nextPinch(st.pinched, hand.pinch, hand.grab, together);
        st.run = st.pinched ? st.run + 1 : 0;
        // Down once the pinch has held a moment (no stray strokes from a
        // misread hand), up as soon as it opens.
        const down = st.pinched && (st.down || st.run >= PEN.confirm);
        let joined = true;
        if (!st.glide) st.glide = startGlide(tip, now);
        else joined = feedGlide(st.glide, tip, now, width, height);
        // A jump breaks the line: lift and, if still pinched, start again there.
        if (!joined && st.down && st.stroke) release();
        if (down && !st.down) {
          // Sound on, where the browser allows it without a tap.
          synth.unlock();
          if (st.over) {
            // A pinch on a chip works the chip and never draws.
            const el = st.over;
            const hold = hudKind(el) === "hold";
            st.chip = { el, at: now, done: !hold };
            if (hold) setHudFill(el, 0);
            else pressHud(el);
          } else {
            // Pen down: a fresh stroke right at the pinch.
            st.glide = startGlide(st.glide.to, now);
            st.stroke = drawing.begin(st.glide.to);
            st.last = st.glide.to;
          }
        } else if (!down && st.down) release();
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
      // Hover follows the gliding pinch point.
      const over = !st.stroke && insideScreen(at) ? chipAt(at) : null;
      if (over) hovering.add(over);
      // Clear: the hold fills while the pinch stays on the trash.
      const { chip } = st;
      if (chip && !chip.done) {
        if (over !== chip.el) {
          setHudFill(chip.el, null);
          chip.done = true;
        } else {
          const fill = (now - chip.at) / CLEAR_HOLD_MS;
          if (fill >= 1) {
            setHudFill(chip.el, null);
            pressHud(chip.el);
            chip.done = true;
          } else setHudFill(chip.el, fill);
        }
      }
      pen.u = at.u;
      pen.v = at.v;
      const showRing = st.drawable || !!over || st.down;
      pen.shown += ((showRing ? 1 : 0) - pen.shown) * ease;
      pen.filled += ((st.down ? 1 : 0) - pen.filled) * ease;
    });
    setHudHover(hovering);
  });

  return <HandTracker targetFps={HAND_FPS} />;
};
