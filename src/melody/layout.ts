// Where things sit on screen, in CSS pixels. The drawing area (the rows of
// notes) runs from just under the top edge to just above the control band.
import type { Field } from "./music";

/** Space kept clear at the bottom for the control band (px). */
export const BAND = 104;
/** The note-name rail on the left edge (px). */
export const RAIL = 34;
/** The top row's distance from the top edge (px). */
const TOP = 40;

/** The drawing area for a screen height, as shares of the height. */
export const fieldFor = (height: number): Field => {
  const h = Math.max(1, height);
  const top = Math.min(TOP, h * 0.08) / h;
  const bottom = Math.max(top + 0.3, (h - BAND) / h);
  return { top, bottom: Math.min(1, bottom) };
};

/** The tube's radius for a screen size (px): about the reference's weight. */
export const tubeRadius = (width: number, height: number) =>
  Math.min(10, Math.max(5, Math.min(width, height) * 0.0125));
