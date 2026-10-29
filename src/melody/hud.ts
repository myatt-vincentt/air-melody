// The control band's chips as targets for the hands. Each chip is a button
// marked `data-hud`: "pick" (an instrument or a play mode: a pinch picks it)
// or "hold" (clear: the pinch has to be held a moment). Hands hover, press
// and fill them through data attributes and CSS variables, so React's own
// rendering of the buttons is never disturbed.

/** Hands are less exact than a finger: chips reach this far out for them (px). */
const REACH = 10;
/** A press shows for this long (ms). */
const PRESS_MS = 260;

export type HudKind = "pick" | "hold";

/** The chip under a point on the page (CSS px), or null. */
export const hudAt = (x: number, y: number): HTMLElement | null => {
  const els = document.querySelectorAll<HTMLElement>("[data-hud]");
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d <= REACH && d < bestD) {
      bestD = d;
      best = el;
    }
  });
  return best;
};

export const hudKind = (el: HTMLElement): HudKind =>
  el.dataset.hud === "hold" ? "hold" : "pick";

let hovered = new Set<HTMLElement>();

/** Marks the chips the hands are over (and only those) as hovered. */
export const setHudHover = (els: Set<HTMLElement>) => {
  hovered.forEach((el) => {
    // eslint-disable-next-line no-param-reassign -- our own marker
    if (!els.has(el)) delete el.dataset.hover;
  });
  els.forEach((el) => {
    // eslint-disable-next-line no-param-reassign -- our own marker
    el.dataset.hover = "1";
  });
  hovered = els;
};

/** Presses a chip: a short press animation, then its own action. */
export const pressHud = (el: HTMLElement) => {
  // eslint-disable-next-line no-param-reassign -- our own marker
  delete el.dataset.press;
  // Restart the animation even on a quick second press.
  el.getBoundingClientRect();
  // eslint-disable-next-line no-param-reassign -- our own marker
  el.dataset.press = "1";
  window.setTimeout(() => {
    // eslint-disable-next-line no-param-reassign -- our own marker
    delete el.dataset.press;
  }, PRESS_MS);
  el.click();
};

/** Shows a hold's progress (0..1) as a ring filling around the chip, or hides it. */
export const setHudFill = (el: HTMLElement, fill: number | null) => {
  el.style.setProperty("--fill", String(fill ?? 0));
  el.style.setProperty("--fill-on", fill === null ? "0" : "1");
};
