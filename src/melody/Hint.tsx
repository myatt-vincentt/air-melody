// The only hint, wordless: a small see-through ghost hand (the SDK's hint
// hand, no disc behind it) low in the middle of the screen. It pinches,
// draws a short wave in the air (a faint line in the chosen instrument's
// colour follows its fingertips), opens and glides back to start again. It
// fades in once the sound is on and goes for good after your first stroke,
// drawn by hand or by touch (strict ease-out).
import { useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  Sphere,
  Vector3,
  type Group,
} from "three";
// eslint-disable-next-line import/extensions
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  HandGestureHint,
  sampleHintLoop,
  type HandGestureHintProps,
} from "@vincentt-xr/sdk/instructions";

import { useSoundOn } from "./Controls";
import { INSTRUMENTS, instrumentIndex } from "./instruments";
import { drawing } from "./state";

const HAND_URL = "/models/hand-v1.glb";

const HINT = {
  /** Hand height (CSS px), and its middle above the bottom edge. */
  px: 84,
  above: 168,
  /** The wave: width and height (px). */
  span: 132,
  amp: 15,
  /** The pinch point, from the middle of the hand (px, x right, y up). */
  tip: [-15, 4] as const,
  /** How far from the camera it is drawn (world): in front of everything. */
  distance: 1.6,
  /** After the sound comes on before it shows, and the fades (s). */
  delay: 0.6,
  fade: 0.35,
  order: 1100,
};

/** One cycle: open, pinch, draw while held, open, glide back. */
const LOOP = { seconds: 3.4, hold: 0.72, from: 0.15 };
/** The share of the cycle the hand is fully pinched (from the loop's hold). */
const HELD = [0.15, 0.85] as const;

/** Ghost style: see-through white, no dark edge and no disc behind it. */
const LOOK: HandGestureHintProps["look"] = {
  ghost: { core: 0.42, rim: 0.8, whiten: 0.75 },
  halo: false,
  glow: false,
};

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** The trail: a soft line in screen pixels, in its own little mesh. */
const TRAIL_POINTS = 48;

const trailVertex = /* glsl */ `
  attribute vec2 a;
  attribute vec2 b;
  attribute vec2 corner;
  uniform vec2 screen;
  uniform float width;
  varying vec2 vPx;
  varying vec2 vA;
  varying vec2 vB;
  void main() {
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 end = corner.x < 0.0 ? a : b;
    vec2 px = end + dir * corner.x * width + nrm * corner.y * width;
    vPx = px;
    vA = a;
    vB = b;
    gl_Position = vec4(px.x / screen.x * 2.0 - 1.0, 1.0 - px.y / screen.y * 2.0, 0.0, 1.0);
  }
`;

const trailFragment = /* glsl */ `
  uniform float width;
  uniform float opacity;
  uniform vec3 color;
  varying vec2 vPx;
  varying vec2 vA;
  varying vec2 vB;
  void main() {
    vec2 ab = vB - vA;
    float t = clamp(dot(vPx - vA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(vPx - vA - ab * t) / width;
    float core = 1.0 - smoothstep(0.25, 0.45, d);
    float glow = (1.0 - smoothstep(0.3, 1.0, d)) * 0.35;
    float a = max(core, glow) * opacity;
    gl_FragColor = vec4(mix(color, vec3(1.0), core * 0.4) * a, a * 0.7);
  }
`;

export const Hint = () => {
  const camera = useThree((st) => st.camera);
  const size = useThree((st) => st.size);
  const hand = useLoader(GLTFLoader, HAND_URL);
  const soundOn = useSoundOn();
  const root = useRef<Group>(null);
  const on = useRef(-1);
  const gone = useRef(-1);
  const ray = useMemo(() => new Vector3(), []);

  const trail = useMemo(() => {
    const g = new BufferGeometry();
    const n = TRAIL_POINTS;
    const attrs = {
      a: new BufferAttribute(new Float32Array(n * 4 * 2), 2),
      b: new BufferAttribute(new Float32Array(n * 4 * 2), 2),
      corner: new BufferAttribute(new Float32Array(n * 4 * 2), 2),
    };
    const index: number[] = [];
    for (let i = 0; i < n; i += 1) {
      attrs.corner.setXY(i * 4, -1, -1);
      attrs.corner.setXY(i * 4 + 1, 1, -1);
      attrs.corner.setXY(i * 4 + 2, 1, 1);
      attrs.corner.setXY(i * 4 + 3, -1, 1);
      const k = i * 4;
      index.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    g.setAttribute("position", attrs.corner);
    Object.entries(attrs).forEach(([name, a]) => g.setAttribute(name, a));
    g.setIndex(index);
    g.boundingSphere = new Sphere(new Vector3(), 1);
    const material = new ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      uniforms: {
        screen: { value: [1, 1] },
        width: { value: 6 },
        opacity: { value: 0 },
        color: { value: new Color(INSTRUMENTS[0].hex) },
      },
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    return { g, attrs, material };
  }, []);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    const now = performance.now() / 1000;
    if (on.current < 0 && soundOn) on.current = now;
    if (gone.current < 0 && drawing.drewOwn()) gone.current = now;
    const shown =
      on.current < 0 ? 0 : easeOut((now - on.current - HINT.delay) / HINT.fade);
    const left =
      gone.current < 0 ? 1 : 1 - easeOut((now - gone.current) / HINT.fade);
    const k = shown * left;
    g.visible = k > 0.01;
    trail.material.uniforms.opacity.value = 0;
    if (!g.visible) return;

    // Where the hand is on its cycle, in sync with the hint's own pinch.
    const { phase } = sampleHintLoop(clock.elapsedTime, LOOP);
    const wave = (p: number) => ({
      x: -HINT.span / 2 + HINT.span * p,
      y: Math.sin(p * Math.PI * 2) * HINT.amp,
    });
    let x: number;
    let y: number;
    let drawn = 0;
    if (phase >= HELD[0] && phase <= HELD[1]) {
      drawn = easeInOut((phase - HELD[0]) / (HELD[1] - HELD[0]));
      ({ x, y } = wave(drawn));
    } else {
      // Open, gliding back to the start, a little above the line.
      const q = phase > HELD[1] ? phase - HELD[1] : phase + 1 - HELD[1];
      const back = easeInOut(q / (1 - (HELD[1] - HELD[0])));
      const from = wave(phase > HELD[1] ? 1 : 0);
      if (phase > HELD[1]) {
        x = from.x + (wave(0).x - from.x) * back;
        y = from.y + Math.sin(back * Math.PI) * 10;
      } else {
        x = wave(0).x;
        y = 0;
      }
      drawn = phase > HELD[1] ? 1 : 0;
    }

    // Pinned low in the middle of the screen, facing the camera, sized in
    // screen pixels.
    const cx = size.width / 2;
    const cy = size.height - HINT.above;
    const tan = Math.tan(
      ((camera as { fov?: number }).fov ?? 45) * (Math.PI / 360),
    );
    const perPx = (2 * HINT.distance * tan) / size.height;
    const sx = (2 * (cx + x)) / size.width - 1;
    const sy = 1 - (2 * (cy - y)) / size.height;
    ray.set(sx, sy, 0.5).unproject(camera).sub(camera.position);
    g.position
      .copy(camera.position)
      .addScaledVector(ray.normalize(), HINT.distance);
    g.quaternion.copy(camera.quaternion);
    g.scale.setScalar(Math.max(1e-4, HINT.px * perPx * k));

    // The faint line behind the fingertips, fading as the hand glides back.
    const fadeBack = phase > HELD[1] ? 1 - easeOut((phase - HELD[1]) / 0.1) : 1;
    const a = trail.attrs;
    const n = TRAIL_POINTS;
    let segs = 0;
    if (drawn > 0) {
      const at = (p: number) => {
        const w = wave(p);
        return [cx + w.x + HINT.tip[0], cy - w.y - HINT.tip[1]];
      };
      for (let i = 0; i < n; i += 1) {
        const p0 = (i / n) * drawn;
        const p1 = ((i + 1) / n) * drawn;
        const [ax, ay] = at(p0);
        const [bx, by] = at(p1);
        for (let c = 0; c < 4; c += 1) {
          a.a.setXY(i * 4 + c, ax, ay);
          a.b.setXY(i * 4 + c, bx, by);
        }
        segs += 1;
      }
      a.a.needsUpdate = true;
      a.b.needsUpdate = true;
    }
    trail.g.setDrawRange(0, segs * 6);
    const u = trail.material.uniforms;
    u.screen.value = [size.width, size.height];
    u.opacity.value = 0.75 * k * fadeBack;
    u.color.value.set(INSTRUMENTS[instrumentIndex(drawing.instrument())].hex);
  });

  return (
    <>
      <mesh
        geometry={trail.g}
        material={trail.material}
        frustumCulled={false}
        renderOrder={HINT.order - 1}
      />
      <group ref={root} visible={false}>
        <HandGestureHint
          gesture="ok"
          model={hand.scene}
          poses={hand.animations}
          height={1}
          orbit={0}
          loop={LOOP}
          look={LOOK}
          renderOrder={HINT.order}
        />
      </group>
    </>
  );
};
