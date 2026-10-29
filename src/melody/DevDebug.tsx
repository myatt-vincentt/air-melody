// Dev only: window.__melody, for checking the drawing and the sound.
//   strokes()   every stroke: instrument, dot or line, its points
//   playhead()  where the playhead is (share of the width) and the loop time
//   counts      notes booked to glow (hits) and notes played out loud (notes)
//   log         the last notes played: time, instrument, MIDI note, name
//   soundOn()   whether the sound is running
//   clear(), setInstrument(id)
// Scene.tsx lazy-imports this behind an inline NODE_ENV check, so it never
// reaches production.
import { useEffect } from "react";

import { synth } from "./audio";
import type { InstrumentId } from "./instruments";
import { LOOP, noteName } from "./music";
import { sequencer } from "./sequencer";
import { drawing } from "./state";

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
