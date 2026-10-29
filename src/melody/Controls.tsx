// The page UI over the camera, on Night glass:
//   - the note names, small, on a slim rail along the left edge, one at
//     each row of the grid
//   - the control band, wordless: the four instruments as
//     chips in their stroke colour with a tiny icon, the two play modes
//     (dots = Notes, a wave = Continuous; the active one ringed in Arles),
//     then clear
//   - until the sound is on: a softly pulsing speaker, low in the middle
//     under the band, with "Tap to play". Any tap or click turns the sound on.
// The band sits about three quarters of the way down, where a raised hand
// reaches it: a pinch over a chip picks it (HandPen.tsx; clear needs a short
// hold, shown as a ring filling around the trash), with a soft Arles glow
// while a hand hovers. Touch is a plain tap.
// Nothing sits over the face.
import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

import { synth } from "./audio";
import { INSTRUMENTS, type InstrumentId } from "./instruments";
import { BAND_AT, fieldFor, RAIL } from "./layout";
import { noteName, rowV, SCALE } from "./music";
import { drawing, useDrawingVersion, type Mode } from "./state";

const ARLES = "#f4d968";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const CSS = `
.am-root { position: absolute; inset: 0; pointer-events: none; color: #fff;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.am-glass { background: rgb(35 37 40 / .64);
  backdrop-filter: blur(20px) saturate(1.5); -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgb(235 246 253 / .18);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / .22), 0 8px 24px rgb(0 0 0 / .22); }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .am-glass { background: rgb(35 37 40 / .82); } }
.am-scrim { position: absolute; left: 0; right: 0; bottom: 0; top: ${BAND_AT * 100 - 16}%;
  background: linear-gradient(rgb(35 37 40 / 0), rgb(35 37 40 / .4) 40%, rgb(35 37 40 / .5)); }
.am-rail { position: absolute; left: 0; width: ${RAIL - 6}px; border-left: 0;
  border-radius: 0 12px 12px 0; }
.am-note { position: absolute; left: 0; width: ${RAIL - 6}px; text-align: center;
  transform: translateY(-50%); font: 600 13px/1 system-ui, -apple-system, sans-serif;
  letter-spacing: 0; font-variant-numeric: tabular-nums; opacity: .92; }
.am-note.c { opacity: 1; font-weight: 700; }
.am-band { pointer-events: auto; position: absolute; left: 50%; top: ${BAND_AT * 100}%; transform: translate(-50%, -50%);
  display: flex; align-items: center; gap: 10px; }
.am-seg { pointer-events: auto; display: flex; gap: 4px; padding: 4px; border-radius: 999px; }
.am-btn { pointer-events: auto; border: 0; padding: 0; margin: 0; color: inherit; background: transparent;
  display: grid; place-items: center; cursor: pointer; outline: none; touch-action: manipulation;
  transition: transform 160ms ease-out, box-shadow 160ms ease-out, opacity 160ms ease-out; }
.am-btn:active { transform: scale(0.96); }
.am-btn[data-hover="1"] { transform: scale(1.1);
  box-shadow: 0 0 0 1px rgb(244 217 104 / .3), 0 0 20px 3px rgb(244 217 104 / .5); }
.am-btn[data-press="1"] { animation: am-press 240ms ease-out; }
@keyframes am-press { from { transform: scale(0.9); } to { transform: scale(1.1); } }
.am-clear { position: relative; }
.am-clear::before { content: ""; position: absolute; inset: -4px; border-radius: 50%;
  background: conic-gradient(${ARLES} calc(var(--fill, 0) * 1turn), transparent 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  opacity: var(--fill-on, 0); transition: opacity 120ms ease-out; pointer-events: none; }
.am-btn:focus-visible { box-shadow: 0 0 0 2px ${ARLES}; }
.am-round { width: 44px; height: 44px; border-radius: 50%; flex: none; }
.am-round.off { opacity: .45; }
.am-chip .am-dot { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
  color: rgb(20 22 24 / .82);
  box-shadow: inset 0 2px 4px rgb(255 255 255 / .45), inset 0 -3px 5px rgb(0 0 0 / .22),
    0 0 12px var(--glow); transition: box-shadow 160ms ease-out; }
.am-chip.on { box-shadow: 0 0 0 2px ${ARLES}; }
.am-mode { width: 38px; height: 38px; border-radius: 50%; }
.am-mode.on { box-shadow: inset 0 0 0 2px ${ARLES}; }
@media (max-width: 379px) {
  .am-band { gap: 6px; }
  .am-seg { gap: 2px; padding: 3px; }
  .am-round { width: 40px; height: 40px; }
  .am-chip .am-dot { width: 30px; height: 30px; }
  .am-mode { width: 36px; height: 36px; } }
.am-chip.on .am-dot { box-shadow: inset 0 2px 4px rgb(255 255 255 / .45),
  inset 0 -3px 5px rgb(0 0 0 / .22), 0 0 18px var(--glow); }
.am-start { position: absolute; left: 50%; top: calc(${BAND_AT * 100}% + 44px);
  transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 10px;
  transition: opacity 160ms ease-out; }
.am-start.gone { opacity: 0; }
.am-speaker { position: relative; width: 64px; height: 64px; border-radius: 50%;
  display: grid; place-items: center; }
.am-speaker::after { content: ""; position: absolute; inset: -1px; border-radius: 50%;
  border: 2px solid ${ARLES}; animation: am-pulse 1.8s ${EASE} infinite; }
.am-caption { padding: 6px 14px; border-radius: 999px; font: 500 14px/1.2 system-ui, -apple-system, sans-serif;
  white-space: nowrap; }
@keyframes am-pulse { from { transform: scale(1); opacity: .9; } to { transform: scale(1.45); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .am-btn:active, .am-btn[data-hover="1"] { transform: none; }
  .am-btn[data-press="1"] { animation: none; }
  @keyframes am-pulse { from { opacity: .9; } to { opacity: 0; } } }
`;

const Icon = ({
  children,
  size = 20,
  stroke = 1.8,
}: {
  children: ReactNode;
  size?: number;
  stroke?: number;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** Tiny icons, one per instrument. */
const INSTRUMENT_ICON: Record<InstrumentId, ReactNode> = {
  // The bars of a marimba, long to short, on their two rails.
  marimba: (
    <Icon size={18} stroke={2}>
      <path d="M3 9.5h18M3 14.5h18" strokeWidth={1.4} />
      <path d="M6.5 5v14M10.5 6v12M14.5 7v10M18.5 8v8" strokeWidth={2.6} />
    </Icon>
  ),
  // Piano keys.
  keys: (
    <Icon size={18} stroke={2}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 5v8M15 5v8M12 13v6" />
    </Icon>
  ),
  // A plucked string: a sharp start that dies away.
  pluck: (
    <Icon size={18} stroke={2.2}>
      <path d="M3 13h3l2-8 3 14 2.5-9 2 5 1.5-2H21" />
    </Icon>
  ),
  // A speaker cone, for the deep round bass.
  bass: (
    <Icon size={18} stroke={2.2}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Icon>
  ),
};

/** The play modes: separate notes, or one continuous line. */
const MODE_ICON: Record<Mode, ReactNode> = {
  notes: (
    <Icon>
      <circle cx="5.5" cy="15" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9" r="2" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="13" r="2" fill="currentColor" stroke="none" />
    </Icon>
  ),
  continuous: (
    <Icon>
      <path d="M3 15c2.5 0 3.5-6 6.5-6s3.5 5 6 5 3-3 5.5-3" />
    </Icon>
  ),
};

const MODES: { id: Mode; label: string }[] = [
  { id: "notes", label: "Play as notes" },
  { id: "continuous", label: "Play as a continuous line" },
];

const ClearIcon = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M9 7V4.5h6V7" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

const SpeakerIcon = () => (
  <Icon size={26}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
);

const subscribeAudio = (l: () => void) => synth.onChange(l);
const audioRunning = () => synth.running;

/** True while the sound is on. */
export const useSoundOn = () =>
  useSyncExternalStore(subscribeAudio, audioRunning);

export const Controls = () => {
  useDrawingVersion();
  const height = useThree((s) => s.size.height);
  const soundOn = useSoundOn();
  const current = drawing.instrument();
  const mode = drawing.mode();
  const empty = drawing.strokes().length === 0;
  const field = fieldFor(height);
  const rowsTop = field.top * height;
  const rowsBottom = field.bottom * height;

  // The first tap or click anywhere turns the sound on (and again after
  // the phone interrupts it, such as a call).
  useEffect(() => {
    const unlock = (e: Event) => {
      if (!synth.running) synth.unlock(e);
    };
    const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
    events.forEach((e) =>
      window.addEventListener(e, unlock, { capture: true, passive: true }),
    );
    return () =>
      events.forEach((e) =>
        window.removeEventListener(e, unlock, { capture: true }),
      );
  }, []);

  return (
    <Html fullscreen zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
      <style>{CSS}</style>
      <div className="am-root">
        <div className="am-scrim" />
        <div
          className="am-rail am-glass"
          style={{ top: rowsTop - 16, height: rowsBottom - rowsTop + 32 }}
        />
        {SCALE.map((midi, row) => (
          <div
            key={midi}
            className={`am-note ${row % 5 === 0 ? "c" : ""}`}
            style={{ top: rowV(row, field) * height }}
            aria-hidden="true"
          >
            {noteName(midi)}
          </div>
        ))}
        <div
          className={`am-start ${soundOn ? "gone" : ""}`}
          aria-hidden={soundOn}
        >
          <div className="am-caption am-glass">Tap to play</div>
          <div className="am-speaker am-glass">
            <SpeakerIcon />
          </div>
        </div>
        <div className="am-band">
          <div
            className="am-seg am-glass"
            role="radiogroup"
            aria-label="Instrument"
          >
            {INSTRUMENTS.map((inst) => (
              <button
                type="button"
                key={inst.id}
                role="radio"
                aria-checked={current === inst.id}
                aria-label={inst.label}
                data-instrument={inst.id}
                data-hud="pick"
                className={`am-btn am-round am-chip ${current === inst.id ? "on" : ""}`}
                onClick={() => drawing.setInstrument(inst.id)}
              >
                <span
                  className="am-dot"
                  style={
                    {
                      background: inst.hex,
                      "--glow": `${inst.hex}88`,
                    } as CSSProperties
                  }
                >
                  {INSTRUMENT_ICON[inst.id]}
                </span>
              </button>
            ))}
          </div>
          <div className="am-seg am-glass" role="radiogroup" aria-label="Play">
            {MODES.map((m) => (
              <button
                type="button"
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                aria-label={m.label}
                data-mode={m.id}
                data-hud="pick"
                className={`am-btn am-mode ${mode === m.id ? "on" : ""}`}
                onClick={() => drawing.setMode(m.id)}
              >
                {MODE_ICON[m.id]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Clear"
            data-action="clear"
            data-hud="hold"
            className={`am-btn am-round am-glass am-clear ${empty ? "off" : ""}`}
            onClick={() => drawing.clear()}
          >
            <ClearIcon />
          </button>
        </div>
      </div>
    </Html>
  );
};
