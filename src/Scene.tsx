// Scene.tsx — Air Melody: draw glowing lines over the camera and a looping
// playhead turns them into music. Height is pitch, across is time. See
// PLAN.md.
import { lazy, Suspense } from "react";

import { MelodyScene } from "./melody/MelodyScene";

// Dev-only helpers for previewing without a camera. Lazy and behind a
// constant esbuild folds to false in production. Two rules:
// `process.env.NODE_ENV`, not `import.meta.env.DEV` (vincentt-xr/v2-template#112);
// and write the check INSIDE the ternary — hoisted into a `const`, esbuild
// keeps the dead branch.
const DevMediaSwitcher =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./DevMediaSwitcher"))
    : null;
const DevDebug =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./melody/DevDebug"))
    : null;

export const Scene = () => (
  <>
    <MelodyScene />
    {DevMediaSwitcher && DevDebug ? (
      <Suspense fallback={null}>
        <DevMediaSwitcher />
        <DevDebug />
      </Suspense>
    ) : null}
  </>
);
