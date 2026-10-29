// Dev only: window.__melody, for checking the drawing and the sound.
//   strokes()   every stroke: instrument, dot or line, its points
//   playhead()  where the playhead is (share of the width) and the loop time
//   counts      notes booked to glow (hits) and notes played out loud (notes)
//   log         the last notes played: time, instrument, MIDI note, name
//   soundOn()   whether the sound is running
//   pens()      each hand's ring: shown, filled (pinched), where
//   drewOwn()   whether the person has drawn yet (the hint goes then)
//   mode(), setMode(m)   "notes" or "continuous"
//   voices()    held tones sounding now (Continuous)
//   glideLog    the held tones' pitches booked lately: time, line, Hz, snap
//   meter(w)    loudness now, peak and RMS: the output, or "held" tones only
//   clear(), setInstrument(id)
// Scene.tsx lazy-imports this behind an inline NODE_ENV check, so it never
// reaches production.
import { useEffect } from "react";

import { synth } from "./audio";
import { pens } from "./HandPen";
import type { InstrumentId } from "./instruments";
import { LOOP, noteName } from "./music";
import { sequencer } from "./sequencer";
import { drawing, type Mode } from "./state";

const DevDebug = () => {
  useEffect(() => {
    const api = {
      strokes: () =>
        drawing.strokes().map((s) => ({
          id: s.id,
          instrument: s.instrument,
          dot: s.dot,
          points: s.points.map((p) => ({ ...p })),
        })),
      playhead: () => {
        const u = sequencer.playhead();
        return { u, time: u * LOOP, clock: sequencer.seenTime() };
      },
      get counts() {
        return { ...sequencer.counts };
      },
      get log() {
        return sequencer.log.map((n) => ({ ...n, name: noteName(n.midi) }));
      },
      soundOn: () => synth.running,
      mode: () => drawing.mode(),
      setMode: (m: Mode) => drawing.setMode(m),
      voices: () => sequencer.voices,
      get glideLog() {
        return sequencer.glideLog.map((g) => ({ ...g }));
      },
      meter: (which?: "out" | "held") => synth.meter(which),
      pens: () => ({ left: { ...pens.left }, right: { ...pens.right } }),
      drewOwn: () => drawing.drewOwn(),
      instrument: () => drawing.instrument(),
      clear: () => drawing.clear(),
      setInstrument: (id: InstrumentId) => drawing.setInstrument(id),
    };
    (window as unknown as Record<string, unknown>).__melody = api;
    return () => {
      delete (window as unknown as Record<string, unknown>).__melody;
    };
  }, []);
  return null;
};

export default DevDebug;
