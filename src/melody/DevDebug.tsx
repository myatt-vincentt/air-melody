// Dev only: keys and window.__melody, for checking the drawing and the sound.
//   1–4 pick an instrument · m switches Notes / Continuous · x clears
// window.__melody:
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
//   fakeHand(side, { u, v, pinch } | null)   a pretend hand for that side,
//               read 12 times a second like the tracker (pinch 0..1; null =
//               hand gone; undefined = back to the tracker)
//   clear(), setInstrument(id)
// Scene.tsx lazy-imports this behind an inline NODE_ENV check, so it never
// reaches production.
import { useEffect } from "react";

import { synth } from "./audio";
import { devHands, pens } from "./HandPen";
import { INSTRUMENTS, type InstrumentId } from "./instruments";
import { LOOP, noteName } from "./music";
import { sequencer } from "./sequencer";
import { drawing, type Mode } from "./state";

type Side = "left" | "right";
type Fake = { u: number; v: number; pinch: number } | null | undefined;

const DevDebug = () => {
  useEffect(() => {
    const fakes: Partial<Record<Side, Fake>> = {};
    let stamp = 0;
    const tick = window.setInterval(() => {
      (Object.keys(fakes) as Side[]).forEach((side) => {
        const f = fakes[side];
        if (f === undefined) delete devHands[side];
        else if (f === null) devHands[side] = null;
        else {
          stamp += 1;
          devHands[side] = {
            stamp,
            tip: { u: f.u, v: f.v },
            palm: { x: side === "left" ? -0.8 : 0.8, y: 0 },
            pinch: f.pinch,
            grab: 0,
          };
        }
      });
    }, 1000 / 12);
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
      fakeHand: (side: Side, f: Fake) => {
        fakes[side] = f;
      },
      clear: () => drawing.clear(),
      setInstrument: (id: InstrumentId) => drawing.setInstrument(id),
    };
    (window as unknown as Record<string, unknown>).__melody = api;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= INSTRUMENTS.length)
        drawing.setInstrument(INSTRUMENTS[n - 1].id);
      else if (e.key === "m")
        drawing.setMode(drawing.mode() === "notes" ? "continuous" : "notes");
      else if (e.key === "x") drawing.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(tick);
      delete (window as unknown as Record<string, unknown>).__melody;
    };
  }, []);
  return null;
};

export default DevDebug;
