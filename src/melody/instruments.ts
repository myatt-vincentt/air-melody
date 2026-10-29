// The four instruments, each with its stroke colour. A stroke keeps the
// instrument it was drawn with, so you can layer them.

export type InstrumentId = "marimba" | "keys" | "pluck" | "bass";

export type Instrument = {
  id: InstrumentId;
  /** Read out by screen readers; never shown. */
  label: string;
  /** The stroke colour. */
  hex: string;
  /** Octaves up or down from the drawing's rows. */
  octave: number;
};

export const INSTRUMENTS: readonly Instrument[] = [
  { id: "marimba", label: "Marimba", hex: "#b4ff3c", octave: 0 },
  { id: "keys", label: "Soft keys", hex: "#5ec8ff", octave: 0 },
  { id: "pluck", label: "Synth pluck", hex: "#ff6fc4", octave: 0 },
  { id: "bass", label: "Round bass", hex: "#ffb438", octave: -1 },
];

/** The instrument's place in the list (its colour channel when drawn). */
export const instrumentIndex = (id: InstrumentId) =>
  INSTRUMENTS.findIndex((i) => i.id === id);

/** The playhead colour. */
export const PLAYHEAD_HEX = "#ff2bd6";
