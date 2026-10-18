"use client";

import { useEffect, useRef } from "react";

/**
 * Black liquid drifting on white, drawn by a tiny fragment shader (one full-screen triangle).
 * - Shapes are metaballs that stretch, squash and pinch off, warped by noise, so they read as
 *   liquid rather than circles. Lit with a soft specular highlight and a thin rim.
 * - Cheap by design: rendered at reduced resolution and capped at 30fps; the browser upscales.
 * - Adaptive: if frames run slow it drops resolution/fps, then freezes and switches the glass
 *   to its "lite" (no backdrop blur) mode so the app stays smooth on weak machines.
 * - Pauses when the tab is hidden, holds one still frame for "reduce motion", and falls back to
 *   static CSS gradients without WebGL2.
 */

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uT;
out vec4 o;

const int N = 8;

// Field strength of all blobs at uv (aspect-corrected). Above T means "inside liquid".
const float T = 0.42;
float field(vec2 uv) {
  float f = 0.0;
  for (int i = 0; i < N; i++) {
    float k = float(i);
    float sp = 0.045 + 0.012 * mod(k * 1.7, 5.0);
    vec2 c = vec2(
      0.55 * sin(uT * sp * 1.3 + k * 2.399) + 0.25 * sin(uT * sp * 0.7 + k * 1.1),
      0.38 * sin(uT * sp * 1.1 + k * 1.618 + 1.2) + 0.2 * cos(uT * sp * 0.9 + k * 0.7)
    ) + vec2(0.0, 0.0);
    // Each blob squashes and stretches along a slowly turning axis (not a circle).
    float a = uT * (0.05 + 0.02 * mod(k, 3.0)) + k * 1.3;
    float s = exp(0.3 * sin(uT * 0.16 + k * 2.1)); // about 0.79x to 1.27x: gentle squash and stretch
    vec2 d = uv - c;
    d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
    d.x /= s;
    d.y *= s;
    // Domain warp makes the outline wobble like a surface under tension.
    d += 0.03 * vec2(sin(d.y * 7.0 + uT * 0.35 + k), cos(d.x * 6.0 - uT * 0.3 + k * 1.7));
    // Compact kernel: a blob only reaches R, so drops stay apart until they come close,
    // then bridge and stretch toward each other like liquid.
    float R = 0.2 + 0.14 * mod(k * 1.37, 2.0);
    float q = max(0.0, 1.0 - dot(d, d) / (R * R));
    f += q * q * q;
  }
  return f;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float F = field(uv);
  float w = max(fwidth(F), 0.01) * 0.9;
  float mask = smoothstep(T - w, T + w, F);

  // Surface normal from the field gradient (finite differences at ~1 pixel).
  float e = 1.5 / uRes.y;
  float gx = field(uv + vec2(e, 0.0)) - field(uv - vec2(e, 0.0));
  float gy = field(uv + vec2(0.0, e)) - field(uv - vec2(0.0, e));
  vec3 n = normalize(vec3(-gx * 0.9, -gy * 0.9, 1.0));
  float depth = clamp((F - T) / 0.7, 0.0, 1.0);

  vec3 L = normalize(vec3(-0.45, 0.65, 0.6));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 48.0);
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);

  vec3 liquid = mix(vec3(0.015, 0.015, 0.02), vec3(0.09, 0.09, 0.115), diff * 0.55 + depth * 0.2);
  liquid += vec3(0.85) * spec * 0.55 + vec3(0.30, 0.31, 0.36) * rim * 0.45;

  // Soft contact shadow on the white around the liquid.
  float shadow = smoothstep(0.08, T, F) * 0.07;
  vec3 paper = vec3(1.0) - shadow;
  o = vec4(mix(paper, liquid, mask), 1.0);
}`;

type Quality = { scale: number; fps: number };
const LEVELS: Quality[] = [
  { scale: 0.5, fps: 30 },
  { scale: 0.36, fps: 24 },
  { scale: 0.26, fps: 18 },
];

export function LiquidBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const root = document.documentElement;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      root.classList.add("liquid-static");
      return;
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    if (!vs || !fs) {
      root.classList.add("liquid-static");
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      root.classList.add("liquid-static");
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One oversized triangle covers the screen with a single draw call.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uT = gl.getUniformLocation(prog, "uT");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const weak =
      (navigator.hardwareConcurrency ?? 8) <= 2 ||
      ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 2;
    let level = weak ? 2 : 0;
    let stopped = false;
    let raf = 0;
    let last = 0;
    let t0 = performance.now();
    // Frame spacing while measuring; healthy frames arrive close to the target interval.
    let samples: number[] = [];
    let measuring = true;

    const resize = () => {
      const q = LEVELS[level]!;
      const w = Math.max(160, Math.round(window.innerWidth * q.scale));
      const h = Math.max(120, Math.round(window.innerHeight * q.scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const draw = (now: number) => {
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const freeze = () => {
      stopped = true;
      root.classList.add("lite");
      draw(performance.now());
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const q = LEVELS[level]!;
      const dt = now - last;
      if (dt < 1000 / q.fps - 2) return;
      draw(now);
      const hadLast = last > 0;
      last = now;
      if (!measuring || !hadLast) return;
      samples.push(dt);
      if (samples.length < 45) return;
      const avg = samples.reduce((x, y) => x + y, 0) / samples.length;
      samples = [];
      if (avg <= (1000 / q.fps) * 1.45) {
        measuring = false; // keeping up: stop measuring
      } else if (level < LEVELS.length - 1) {
        level++; // struggling: draw smaller and less often, then measure again
      } else {
        cancelAnimationFrame(raf);
        freeze(); // still struggling at the lowest setting: hold a still frame
      }
    };

    const start = () => {
      if (stopped || raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const pause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? pause() : start());
    const onResize = () => draw(performance.now());
    const onLost = (e: Event) => {
      e.preventDefault();
      pause();
      root.classList.add("liquid-static");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onLost);
    t0 = performance.now() - 9000; // start mid-flow so the first frame already looks composed
    draw(performance.now()); // first frame right away, before the animation loop starts
    if (reduced) {
      root.classList.add("lite");
    } else {
      if (weak) root.classList.add("lite");
      start();
    }
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
    };
  }, []);

  return <canvas ref={ref} className="liquid-canvas" aria-hidden="true" />;
}
