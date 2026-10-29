// Where things sit on screen, in CSS pixels. The drawing area (the rows of
// notes) runs from just under the top edge to just above the control band.
// The band sits about three quarters of the way down rather than at the
// very bottom, where a hand held up in front of a webcam can reach it.
import type { Field } from "./music";

/** The control band's middle, as a share of the screen height. */
export const BAND_AT = 0.77;
/** Half the band's height, and the gap kept between it and the bottom row (px). */
const BAND_HALF = 26;
const BAND_GAP = 24;
/** The note-name rail on the left edge (px). */
export const RAIL = 38;
/**
 * The top row's distance from the top edge (px): below a phone's notch and
 * the HUD band, and clear of the media switcher button in development.
 */
const TOP = 64;

/** The drawing area for a screen height, as shares of the height. */
export const fieldFor = (height: number): Field => {
  const h = Math.max(1, height);
  const top = Math.min(TOP, h * 0.09) / h;
  const bottom = Math.max(top + 0.3, (h * BAND_AT - BAND_HALF - BAND_GAP) / h);
  return { top, bottom: Math.min(1, bottom) };
};

/** The band's bottom edge (px from the top). */
export const bandBottom = (height: number) => height * BAND_AT + BAND_HALF;

/** The tube's radius for a screen size (px): about the reference's weight. */
export const tubeRadius = (width: number, height: number) =>
  Math.min(10, Math.max(5, Math.min(width, height) * 0.0125));
