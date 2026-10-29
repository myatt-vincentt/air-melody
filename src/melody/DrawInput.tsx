// Drawing with a finger or the mouse: drag to draw a stroke, tap or click to
// drop a dot. The stroke appears (and plays) as you draw it, in the chosen
// instrument. The tap that turns the sound on doesn't drop a dot; a drag
// that turns it on still draws.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

import { synth } from "./audio";
import type { Point } from "./music";
import { drawing, type Stroke } from "./state";

/** A tap moves less than this (px). */
const TAP_SLOP = 10;
/** Points closer than this (px) are skipped. */
const MIN_STEP = 2.5;
/**
 * Jitter smoothing: a tiny move is eased (this share of it is taken), a move
 * of `SMOOTH_PX` or more is taken whole, so fast corners are never cut.
 */
const SMOOTHING = 0.45;
const SMOOTH_PX = 10;

export const DrawInput = () => {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    let pointer: number | null = null;
    let stroke: Stroke | null = null;
    let down = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let smooth = { x: 0, y: 0 };
    let moved = 0;

    const toPoint = (x: number, y: number): Point => {
      const r = el.getBoundingClientRect();
      return {
        u: (x - r.left) / Math.max(1, r.width),
        v: (y - r.top) / Math.max(1, r.height),
      };
    };

    const onDown = (e: PointerEvent) => {
      if (pointer !== null || (e.pointerType === "mouse" && e.button !== 0))
        return;
      pointer = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      down = { x: e.clientX, y: e.clientY };
      last = { ...down };
      smooth = { ...down };
      moved = 0;
      // The tap that turns the sound on only does that.
      stroke = synth.isUnlocking(e)
        ? null
        : drawing.begin(toPoint(down.x, down.y));
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      moved = Math.max(
        moved,
        Math.hypot(e.clientX - down.x, e.clientY - down.y),
      );
      if (moved <= TAP_SLOP) return;
      // A drag that turned the sound on draws from where it started.
      if (!stroke) stroke = drawing.begin(toPoint(down.x, down.y));
      const samples = e.getCoalescedEvents?.() ?? [];
      const events = samples.length > 0 ? samples : [e];
      const add: Point[] = [];
      events.forEach((s) => {
        const step = Math.hypot(s.clientX - smooth.x, s.clientY - smooth.y);
        const k = Math.min(1, SMOOTHING + (1 - SMOOTHING) * (step / SMOOTH_PX));
        smooth = {
          x: smooth.x + (s.clientX - smooth.x) * k,
          y: smooth.y + (s.clientY - smooth.y) * k,
        };
        if (Math.hypot(smooth.x - last.x, smooth.y - last.y) < MIN_STEP) return;
        last = { ...smooth };
        add.push(toPoint(smooth.x, smooth.y));
      });
      drawing.extend(stroke, add);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (stroke && moved <= TAP_SLOP) drawing.toDot(stroke);
      else if (stroke && e.type !== "pointercancel")
        drawing.extend(stroke, [toPoint(e.clientX, e.clientY)]);
      stroke = null;
    };

    const { touchAction } = el.style;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.style.touchAction = touchAction;
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  return null;
};
