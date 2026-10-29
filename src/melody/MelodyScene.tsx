// Air Melody: draw lines over the camera and a looping playhead plays them.
// Height is pitch, across is time. The picture is NeonLayer.tsx; drawing is
// HandPen.tsx (pinch in the air) and DrawInput.tsx (touch and mouse); the
// sound is audio.ts played by sequencer.ts; the note names and controls are
// Controls.tsx, and the ghost-hand hint is Hint.tsx.
import { Suspense, useEffect } from "react";
import { useThree } from "@react-three/fiber";

import { Controls } from "./Controls";
import { showDemo } from "./demo";
import { DrawInput } from "./DrawInput";
import { HandPen } from "./HandPen";
import { Hint } from "./Hint";
import { fieldFor } from "./layout";
import { NeonLayer } from "./NeonLayer";
import { sequencer } from "./sequencer";

export const MelodyScene = () => {
  const height = useThree((s) => s.size.height);

  useEffect(() => {
    sequencer.setScreenHeight(height);
  }, [height]);

  useEffect(() => {
    showDemo(fieldFor(height));
    sequencer.start();
    return () => sequencer.stop();
    // The phrase is laid out for the first screen size only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <NeonLayer />
      <DrawInput />
      <HandPen />
      <Controls />
      <Suspense fallback={null}>
        <Hint />
      </Suspense>
    </>
  );
};
