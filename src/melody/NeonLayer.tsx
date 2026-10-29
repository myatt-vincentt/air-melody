// The picture over the camera: the strokes as glossy neon tubes, the
// playhead, and a glow wherever the playhead plays a stroke.
//
// Strokes: every stroke segment is drawn into an offscreen picture of "how
// close am I to a stroke", one colour channel per instrument, keeping the
// closest. A full-screen pass then turns that into the tube: a bright core,
// darker glassy edges lit from the top left with a sharp highlight, rounded
// ends, and a soft outer glow. Crossing strokes of one colour melt into one
// shape. The offscreen picture is only redrawn when the drawing changes.
//
// The playhead is a thin magenta line with a soft glow, drawn in the same
// pass. Each note is a burst of the stroke's colour, brightened, at the spot
// where the playhead touched it, shown when the note is heard. Each tracked
// hand has a small ring at its pinch point (HandPen.tsx).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  LinearFilter,
  MaxEquation,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";

import { INSTRUMENTS, instrumentIndex, PLAYHEAD_HEX } from "./instruments";
import { fieldFor, RAIL, tubeRadius } from "./layout";
import { ROWS, TICKS } from "./music";
import { pens } from "./HandPen";
import { sequencer } from "./sequencer";
import { drawing, MAX_POINTS } from "./state";

const LOOK = {
  /** The glow reaches this many tube radii out from the centre line. */
  glow: 3.2,
  /** A dot is this much fatter than a line (in tube radii). */
  dotGrow: 0.45,
  /** The offscreen picture's size per CSS pixel (at most). */
  fieldScale: 1.2,
  /** A note's glow: rise and fade (s), size (tube radii). */
  hitRise: 0.05,
  hitFade: 0.6,
  hitSize: 14,
};

const MAX_SEGMENTS = MAX_POINTS + 256;
const MAX_HITS = 64;
/** Notes that light up their stroke at once. */
const FLASHES = 16;
/** Unused by the shaders (they work in screen space), but render() wants one. */
const CAMERA = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

// --- the offscreen "closeness" picture -------------------------------------

const segVertex = /* glsl */ `
  attribute vec2 a;
  attribute vec2 b;
  attribute vec2 corner;
  attribute float channel;
  attribute float grow;
  uniform vec2 screen;
  uniform float reach;
  varying vec2 vPx;
  varying vec2 vA;
  varying vec2 vB;
  varying vec4 vMask;
  varying float vGrow;
  void main() {
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec2 end = corner.x < 0.0 ? a : b;
    vec2 px = end + dir * corner.x * reach + nrm * corner.y * reach;
    vPx = px;
    vA = a;
    vB = b;
    vGrow = grow;
    vMask = vec4(equal(vec4(channel), vec4(0.0, 1.0, 2.0, 3.0)));
    gl_Position = vec4(px.x / screen.x * 2.0 - 1.0, 1.0 - px.y / screen.y * 2.0, 0.0, 1.0);
  }
`;

const segFragment = /* glsl */ `
  uniform float reach;
  varying vec2 vPx;
  varying vec2 vA;
  varying vec2 vB;
  varying vec4 vMask;
  varying float vGrow;
  void main() {
    vec2 ab = vB - vA;
    float t = clamp(dot(vPx - vA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = max(0.0, length(vPx - vA - ab * t) - vGrow);
    float k = clamp(1.0 - d / reach, 0.0, 1.0);
    gl_FragColor = vMask * k;
  }
`;

// --- the full-screen pass: tubes, glow, playhead ---------------------------

const fullVertex = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fullFragment = /* glsl */ `
  #define FLASHES ${FLASHES}
  uniform sampler2D field;
  uniform vec2 texel;
  uniform vec2 buffer;
  uniform float pxScale;
  uniform float reach;
  uniform float radius;
  uniform vec3 colors[4];
  uniform float playhead;
  uniform vec3 playheadColor;
  uniform vec2 css;
  uniform vec2 rowsAt;
  uniform float rail;
  uniform float rows;
  uniform float ticks;
  // The notes sounding now: where (CSS px), how bright, which colour.
  uniform vec4 flashes[FLASHES];

  // A 1px line's coverage at a distance (px).
  float hair(float d) { return 1.0 - smoothstep(0.0, 1.0, d); }

  // The faint grid under the strokes: a line per note, a line per beat,
  // and ticks along the bottom edge (taller on beats and bars).
  vec4 grid(vec2 p) {
    float a = 0.0;
    // A faint dark edge under each note line keeps it readable on bright walls.
    float shade = 0.0;
    float top = rowsAt.x;
    float bottom = rowsAt.y;
    float gap = (bottom - top) / (rows - 1.0);
    float f = (bottom - p.y) / gap;
    float row = floor(f + 0.5);
    if (row >= 0.0 && row <= rows - 1.0 && p.x > rail) {
      float isC = mod(row, 5.0) < 0.5 ? 1.0 : 0.0;
      float strength = mix(0.17, 0.3, isC);
      float d = (f - row) * gap;
      a = max(a, hair(abs(d)) * strength);
      shade = hair(abs(d + 1.0)) * strength * 0.45;
    }
    float g = p.x / css.x * ticks;
    float k = floor(g + 0.5);
    float dx = abs(g - k) * css.x / ticks;
    float beat = mod(k, 2.0) < 0.5 ? 1.0 : 0.0;
    float bar = mod(k, ticks * 0.5) < 0.5 ? 1.0 : 0.0;
    if (p.y > top - gap * 0.4 && p.y < bottom && beat > 0.5)
      a = max(a, hair(dx) * mix(0.09, 0.16, bar));
    float len = mix(mix(5.0, 9.0, beat), 13.0, bar);
    if (p.y >= bottom && p.y < bottom + len)
      a = max(a, hair(dx) * 0.7);
    if (p.x > rail)
      a = max(a, hair(abs(p.y - bottom)) * 0.25);
    return vec4(vec3(a), a + shade * (1.0 - a));
  }

  // One instrument's strokes, laid over what is below.
  void layer(float k, vec2 g, vec3 col, float flash, inout vec4 acc) {
    if (k <= 0.0) return;
    float d = (1.0 - k) * reach;
    float x = d / radius;
    vec3 rgb = vec3(0.0);
    float a = 0.0;
    if (x < 1.0) {
      // The tube's surface: round across, lit from the top left.
      vec2 out2 = -g / max(length(g), 1e-5);
      float nz = sqrt(max(0.0, 1.0 - x * x));
      vec3 n = normalize(vec3(out2 * x, nz));
      vec3 l = normalize(vec3(-0.45, 0.65, 0.62));
      vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
      float diff = max(dot(n, l), 0.0);
      float nh = max(dot(n, h), 0.0);
      vec3 c = mix(col * 0.3, col, smoothstep(1.0, 0.2, x)) * (0.5 + 0.65 * diff);
      c += mix(col, vec3(1.0), 0.55) * smoothstep(0.55, 0.0, x) * 0.4;
      c += vec3(1.0) * (pow(nh, 70.0) * 0.95 + pow(nh, 9.0) * 0.12);
      c += col * pow(x, 5.0) * 0.45;
      // Where a note plays, the tube flares up.
      c += mix(col, vec3(1.0), 0.55) * flash * 1.3;
      a = smoothstep(1.0, 1.0 - 1.4 / radius, x) * 0.97;
      rgb = c * a;
    }
    // The soft glow around it.
    float gd = clamp((d - radius) / (reach - radius), 0.0, 1.0);
    float glow = pow(1.0 - gd, 2.4) * (0.42 + flash * 0.9) * (1.0 - a);
    rgb += col * glow;
    a += glow * 0.35;
    acc = vec4(rgb, a) + acc * (1.0 - a);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / buffer;
    vec4 k = texture2D(field, uv);
    vec4 gx = texture2D(field, uv + vec2(texel.x, 0.0)) - texture2D(field, uv - vec2(texel.x, 0.0));
    vec4 gy = texture2D(field, uv + vec2(0.0, texel.y)) - texture2D(field, uv - vec2(0.0, texel.y));
    vec2 p = vec2(gl_FragCoord.x / pxScale, css.y - gl_FragCoord.y / pxScale);
    vec4 acc = grid(p);
    vec4 fl = vec4(0.0);
    float spread = radius * radius * 10.0;
    for (int i = 0; i < FLASHES; i++) {
      vec4 f = flashes[i];
      if (f.z <= 0.0) continue;
      vec2 d = p - f.xy;
      fl += vec4(equal(vec4(f.w), vec4(0.0, 1.0, 2.0, 3.0))) * f.z * exp(-dot(d, d) / spread);
    }
    fl = min(fl, vec4(1.0));
    layer(k.r, vec2(gx.r, gy.r), colors[0], fl.r, acc);
    layer(k.g, vec2(gx.g, gy.g), colors[1], fl.g, acc);
    layer(k.b, vec2(gx.b, gy.b), colors[2], fl.b, acc);
    layer(k.a, vec2(gx.a, gy.a), colors[3], fl.a, acc);

    // The playhead: a thin bright line in a soft magenta glow.
    float dx = abs(gl_FragCoord.x / pxScale - playhead);
    float line = smoothstep(1.7, 0.5, dx);
    float glow = exp(-dx / 7.0) * 0.5 + exp(-dx / 26.0) * 0.16;
    vec3 ph = playheadColor * glow + mix(playheadColor, vec3(1.0), 0.45) * line;
    float pa = clamp(line * 0.95 + glow * 0.25, 0.0, 1.0);
    acc = vec4(acc.rgb + ph, acc.a + pa * (1.0 - acc.a));
    gl_FragColor = acc;
  }
`;

// --- the note glows ----------------------------------------------------------

const hitVertex = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float pixelRatio;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    gl_PointSize = size * pixelRatio;
    vAlpha = alpha;
    vTint = tint;
  }
`;

const hitFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    if (vAlpha <= 0.0) discard;
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(0.22, 0.04, r);
    float halo = exp(-r * r * 5.0) * 0.9 + exp(-r * r * 16.0) * 0.7;
    vec3 c = mix(vTint, vec3(1.0), core * 0.55);
    float i = min(1.0, core + halo) * vAlpha;
    // Light added, and partly covering what is behind, so the colour shows
    // even on a bright wall.
    gl_FragColor = vec4(c * i, i * 0.7);
  }
`;

// --- the hand rings ----------------------------------------------------------

const ringVertex = /* glsl */ `
  attribute float shown;
  attribute float filled;
  uniform float pixelRatio;
  uniform float size;
  varying float vShown;
  varying float vFilled;
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    gl_PointSize = size * pixelRatio;
    vShown = shown;
    vFilled = filled;
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 color;
  uniform float px;
  varying float vShown;
  varying float vFilled;
  void main() {
    if (vShown <= 0.01) discard;
    float r = length(gl_PointCoord - 0.5) * 2.0;
    // Open: a thin ring. Pinched: a bright filled dot inside it.
    float ring = 1.0 - smoothstep(0.0, px * 1.4, abs(r - 0.5));
    float dot = (1.0 - smoothstep(0.36 - px, 0.36 + px, r)) * vFilled;
    float glow = exp(-pow(max(0.0, r - 0.3), 2.0) * 22.0) * (0.25 + 0.35 * vFilled);
    vec3 c = mix(color, vec3(1.0), 0.35 * max(ring, dot));
    float i = clamp(max(ring * 0.95, dot) + glow * (1.0 - max(ring, dot)), 0.0, 1.0) * vShown;
    gl_FragColor = vec4(c * i, i * 0.8);
  }
`;

/** The ring's size (CSS px): outer edge at half of it. */
const RING_PX = 52;

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Writes every stroke's segments, in pixels; returns how many. */
const writeSegments = (
  attrs: Record<string, BufferAttribute>,
  width: number,
  height: number,
  dotGrow: number,
) => {
  let n = 0;
  const put = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    channel: number,
    grow: number,
  ) => {
    if (n >= MAX_SEGMENTS) return;
    for (let c = 0; c < 4; c += 1) {
      const i = n * 4 + c;
      attrs.a.setXY(i, ax, ay);
      attrs.b.setXY(i, bx, by);
      attrs.channel.setX(i, channel);
      attrs.grow.setX(i, grow);
    }
    n += 1;
  };
  drawing.strokes().forEach((s) => {
    const ch = instrumentIndex(s.instrument);
    const p = s.points;
    if (p.length === 1 || s.dot) {
      const x = p[0].u * width;
      const y = p[0].v * height;
      put(x, y, x, y, ch, dotGrow);
      return;
    }
    for (let i = 0; i < p.length - 1; i += 1)
      put(
        p[i].u * width,
        p[i].v * height,
        p[i + 1].u * width,
        p[i + 1].v * height,
        ch,
        0,
      );
  });
  return n;
};

export const NeonLayer = () => {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  const seg = useMemo(() => {
    const g = new BufferGeometry();
    const v = MAX_SEGMENTS * 4;
    const attrs = {
      a: new BufferAttribute(new Float32Array(v * 2), 2),
      b: new BufferAttribute(new Float32Array(v * 2), 2),
      corner: new BufferAttribute(new Float32Array(v * 2), 2),
      channel: new BufferAttribute(new Float32Array(v), 1),
      grow: new BufferAttribute(new Float32Array(v), 1),
    };
    for (let i = 0; i < MAX_SEGMENTS; i += 1) {
      attrs.corner.setXY(i * 4, -1, -1);
      attrs.corner.setXY(i * 4 + 1, 1, -1);
      attrs.corner.setXY(i * 4 + 2, 1, 1);
      attrs.corner.setXY(i * 4 + 3, -1, 1);
    }
    const index = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i += 1) {
      index.set(
        [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3],
        i * 6,
      );
    }
    // Vertex positions are worked out in the shader; three still wants one.
    g.setAttribute("position", attrs.corner);
    Object.entries(attrs).forEach(([n, a]) => g.setAttribute(n, a));
    g.setIndex(new BufferAttribute(index, 1));
    // Positions live in the shader; this keeps three's depth sort happy.
    g.boundingSphere = new Sphere(new Vector3(), 1);
    const material = new ShaderMaterial({
      vertexShader: segVertex,
      fragmentShader: segFragment,
      uniforms: { screen: { value: new Vector2(1, 1) }, reach: { value: 1 } },
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendEquationAlpha: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      // Quads are laid out in screen pixels (y down), so either face may show.
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const scene = new Scene();
    const mesh = new Mesh(g, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { g, attrs, material, scene };
  }, []);

  const target = useMemo(
    () =>
      new WebGLRenderTarget(1, 1, {
        format: RGBAFormat,
        type: UnsignedByteType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      target.dispose();
      seg.g.dispose();
      seg.material.dispose();
    },
    [target, seg],
  );

  const full = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: fullVertex,
        fragmentShader: fullFragment,
        uniforms: {
          field: { value: target.texture },
          texel: { value: new Vector2(1, 1) },
          buffer: { value: new Vector2(1, 1) },
          pxScale: { value: 1 },
          reach: { value: 1 },
          radius: { value: 1 },
          colors: { value: INSTRUMENTS.map((i) => new Color(i.hex)) },
          playhead: { value: 0 },
          playheadColor: { value: new Color(PLAYHEAD_HEX) },
          css: { value: new Vector2(1, 1) },
          rowsAt: { value: new Vector2(0, 1) },
          rail: { value: RAIL },
          rows: { value: ROWS },
          ticks: { value: TICKS },
          flashes: {
            value: Array.from({ length: FLASHES }, () => new Vector4()),
          },
        },
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    [target],
  );

  const hits = useMemo(() => {
    const g = new BufferGeometry();
    const attrs = {
      position: new BufferAttribute(new Float32Array(MAX_HITS * 3), 3),
      size: new BufferAttribute(new Float32Array(MAX_HITS), 1),
      alpha: new BufferAttribute(new Float32Array(MAX_HITS), 1),
      tint: new BufferAttribute(new Float32Array(MAX_HITS * 3), 3),
    };
    Object.entries(attrs).forEach(([n, a]) => g.setAttribute(n, a));
    const material = new ShaderMaterial({
      vertexShader: hitVertex,
      fragmentShader: hitFragment,
      uniforms: { pixelRatio: { value: 1 } },
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const tints = INSTRUMENTS.map((i) => {
      const c = new Color(i.hex);
      return c.lerp(new Color("#ffffff"), 0.18).multiplyScalar(1.25);
    });
    return { g, attrs, material, tints };
  }, []);

  const rings = useMemo(() => {
    const g = new BufferGeometry();
    const attrs = {
      position: new BufferAttribute(new Float32Array(2 * 3), 3),
      shown: new BufferAttribute(new Float32Array(2), 1),
      filled: new BufferAttribute(new Float32Array(2), 1),
    };
    Object.entries(attrs).forEach(([n, a]) => g.setAttribute(n, a));
    g.boundingSphere = new Sphere(new Vector3(), 1);
    const colors = INSTRUMENTS.map((i) => new Color(i.hex));
    const material = new ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: {
        pixelRatio: { value: 1 },
        size: { value: RING_PX },
        px: { value: 2 / RING_PX },
        color: { value: colors[0].clone() },
      },
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    return { g, attrs, material, colors };
  }, []);

  const drawn = useRef({ version: -1, w: 0, h: 0, segments: 0 });
  const bufferSize = useMemo(() => new Vector2(), []);
  const clear = useMemo(() => new Color(), []);

  useFrame(() => {
    const { width, height } = size;
    if (width < 1 || height < 1) return;
    gl.getDrawingBufferSize(bufferSize);
    const pxScale = bufferSize.x / width;
    const r = tubeRadius(width, height);
    const reach = r * LOOK.glow;
    const scale = Math.min(LOOK.fieldScale, pxScale);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));

    // Redraw the offscreen picture when the drawing or the size changed.
    const d = drawn.current;
    const version = drawing.version();
    if (d.version !== version || d.w !== tw || d.h !== th) {
      if (target.width !== tw || target.height !== th) target.setSize(tw, th);
      const n = writeSegments(seg.attrs, width, height, r * LOOK.dotGrow);
      Object.values(seg.attrs).forEach((a) => {
        if (a === seg.attrs.corner) return;
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4 * a.itemSize);
        // eslint-disable-next-line no-param-reassign
        a.needsUpdate = true;
      });
      seg.g.setDrawRange(0, n * 6);
      seg.material.uniforms.screen.value.set(width, height);
      seg.material.uniforms.reach.value = reach;
      const prevTarget = gl.getRenderTarget();
      const prevAlpha = gl.getClearAlpha();
      gl.getClearColor(clear);
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      if (n > 0) gl.render(seg.scene, CAMERA);
      gl.setRenderTarget(prevTarget);
      gl.setClearColor(clear, prevAlpha);
      drawn.current = { version, w: tw, h: th, segments: n };
    }

    const u = full.uniforms;
    u.texel.value.set(1 / tw, 1 / th);
    u.buffer.value.copy(bufferSize);
    u.pxScale.value = pxScale;
    u.reach.value = reach;
    u.radius.value = r;
    u.playhead.value = sequencer.playhead() * width;
    u.css.value.set(width, height);
    const field = fieldFor(height);
    u.rowsAt.value.set(field.top * height, field.bottom * height);

    // The note glows, as they are heard.
    const now = sequencer.seenTime();
    const ha = hits.attrs;
    let k = 0;
    let f = 0;
    const flashes = u.flashes.value as Vector4[];
    sequencer.hits.forEach((h) => {
      const age = now - h.time;
      if (age < 0 || age > LOOK.hitFade + LOOK.hitRise || k >= MAX_HITS) return;
      const rise = easeOut(age / LOOK.hitRise);
      const fade = 1 - easeOut((age - LOOK.hitRise) / LOOK.hitFade);
      ha.position.setXYZ(k, h.u * 2 - 1, 1 - h.v * 2, 0);
      ha.size.setX(k, r * LOOK.hitSize * (0.75 + 0.25 * rise));
      ha.alpha.setX(k, Math.min(rise, fade));
      const c = hits.tints[h.channel];
      ha.tint.setXYZ(k, c.r, c.g, c.b);
      k += 1;
      if (f < FLASHES) {
        flashes[f].set(
          h.u * width,
          h.v * height,
          Math.min(rise, fade),
          h.channel,
        );
        f += 1;
      }
    });
    for (let i = f; i < FLASHES; i += 1) flashes[i].set(0, 0, 0, 0);
    for (let i = k; i < MAX_HITS; i += 1) ha.alpha.setX(i, 0);
    Object.values(ha).forEach((a) => {
      // eslint-disable-next-line no-param-reassign
      a.needsUpdate = true;
    });
    hits.material.uniforms.pixelRatio.value = pxScale;

    // The hand rings, in the chosen instrument's colour.
    const ra = rings.attrs;
    [pens.left, pens.right].forEach((p, i) => {
      ra.position.setXYZ(i, p.u * 2 - 1, 1 - p.v * 2, 0);
      ra.shown.setX(i, p.shown);
      ra.filled.setX(i, p.filled);
    });
    Object.values(ra).forEach((a) => {
      // eslint-disable-next-line no-param-reassign
      a.needsUpdate = true;
    });
    rings.material.uniforms.pixelRatio.value = pxScale;
    rings.material.uniforms.color.value.copy(
      rings.colors[instrumentIndex(drawing.instrument())],
    );
  });

  return (
    <>
      <mesh frustumCulled={false} renderOrder={998} material={full}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <points
        geometry={hits.g}
        material={hits.material}
        frustumCulled={false}
        renderOrder={999}
      />
      <points
        geometry={rings.g}
        material={rings.material}
        frustumCulled={false}
        renderOrder={1000}
      />
    </>
  );
};
