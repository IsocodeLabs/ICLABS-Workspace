---
name: workspace-liquid-background
description: >-
  The Isocode Workspace background: a few black liquid shapes slowly drifting, stretching,
  merging and pinching apart on a white screen, drawn by a tiny WebGL2 fragment shader that
  adapts to slow machines. Use when changing, tuning, porting or reproducing that background
  (in the workspace, another Isocode page, a static image, or an email header), or when
  someone says the background lags, looks like spheres/streaks, or is too busy.
---

# Workspace liquid background

Implementation: `apps/web/src/components/liquid-background.tsx` (copy kept in
`references/liquid-background.tsx`), mounted once in `app/layout.tsx` inside
`<div className="liquid-bg">`; CSS in `app/globals.css` (`.liquid-bg`, `.liquid-canvas`,
`html.liquid-static`, `html.lite`).

## What it must look like

- **White screen, black liquid.** Ink `#030305`-ish bodies with a faint graphite diffuse,
  a small soft white specular highlight, a thin cool rim and a very soft contact shadow on
  the white. No colour, ever (the multicolour version was rejected as distracting).
- **Liquid, not spheres.** Shapes squash and stretch along a slowly turning axis, their
  outlines wobble (domain warp), and they **bridge and pinch off** when two come close.
- **Calm.** 8 blobs, slow drift (periods of tens of seconds), mostly at the edges and
  middle distance so content stays readable. It must never compete with the glass cards.

## How it works

One full-screen triangle; the fragment shader evaluates a metaball field per pixel.

```glsl
// per blob k (N = 8)
sp = 0.045 + 0.012 * mod(k*1.7, 5.0);                  // own speed
c  = vec2(0.55*sin(t*sp*1.3 + k*2.399) + 0.25*sin(t*sp*0.7 + k*1.1),
          0.38*sin(t*sp*1.1 + k*1.618 + 1.2) + 0.2*cos(t*sp*0.9 + k*0.7));
a  = t*(0.05 + 0.02*mod(k,3.0)) + k*1.3;               // turning axis
s  = exp(0.3*sin(t*0.16 + k*2.1));                     // squash/stretch 0.79–1.27
d  = rot(a) * (uv - c);  d.x /= s;  d.y *= s;
d += 0.03*vec2(sin(d.y*7.0 + t*0.35 + k), cos(d.x*6.0 - t*0.3 + k*1.7)); // wobble
R  = 0.2 + 0.14*mod(k*1.37, 2.0);
q  = max(0.0, 1.0 - dot(d,d)/(R*R));  f += q*q*q;      // COMPACT kernel
// inside liquid where f > T = 0.42, edge antialiased with fwidth(f)
```

Key decisions (each fixed a real failure):
- **Compact kernel** `(1 - d²/R²)³`, not `1/d²`: the inverse-square field covered the whole
  screen in black. The compact one lets drops stay separate until close, then bridge.
- **Stretch capped at `exp(0.3·sin)`**: stronger stretch turned blobs into streaks.
- Lighting: normal from the field gradient (finite differences ~1.5px), Blinn specular
  `pow(·,48)·0.55`, rim `pow(1-n.z,2)·0.45`, liquid colour
  `mix(#040405, #17171d, diff*.55 + depth*.2)`, shadow `smoothstep(0.08,T,f)*0.07`.
- `uv = (fragCoord - 0.5*res) / res.y` keeps shapes round on any aspect ratio; offset
  `uv` to move the group (the email banner uses `uv - vec2(0.95, 0)`).
- Time starts at `t0 = now - 9000ms` so the very first frame already looks composed.

## Performance rules (it must never lag)

- Render at **reduced resolution and fps**, CSS upscales: levels
  `[{scale .5, 30fps}, {.36, 24}, {.26, 18}]`. Weak devices (≤2 cores or ≤2 GB) start at
  the lowest level.
- **Adaptive:** average 45 frame gaps; if slower than 1.45× target, drop a level; at the
  lowest level still struggling → draw one still frame, stop, add `html.lite` (glass loses
  live blur).
- Context `{antialias:false, alpha:false, depth:false, stencil:false,
  powerPreference:"low-power"}`; one draw call; no textures.
- **Pause** on `visibilitychange` hidden; **reduced motion** → one still frame + `lite`;
  draw the first frame immediately (no blank canvas size flash).
- `.liquid-bg { position:fixed; inset:0; z-index:-1; contain:strict; pointer-events:none }`.
- **No WebGL2 / shader fails / context lost** → `html.liquid-static`: CSS radial-gradient
  black ellipses on white, zero animation cost.

## Tuning knobs

| Want | Change |
|---|---|
| Fewer/more shapes | `N` (keep ≤ 10; cost is linear ×5 field evaluations per pixel) |
| Bigger/smaller drops | `R` base `0.2` and spread `0.14` |
| Slower/faster | `sp` base `0.045` (and axis turn `0.05`) |
| More/less merging | threshold `T` (lower = fatter, more merging) |
| Wobblier outline | domain-warp amplitude `0.03` |
| Softer/glossier | specular power `48` / weight `0.55` |

## Static uses (emails, OG images, slides)

Render the same shader once with headless Chrome and save a PNG (see
`references/render-static.md`). Email clients can't run WebGL, strip SVG, and Gmail
proxies images — so ship a PNG from `apps/web/public/` (copied into the runtime image by
the Dockerfile) and reference it by absolute URL.

## Checklist

- [ ] Still black-on-white only; still reads as liquid (stretch, bridge, pinch), not dots.
- [ ] Titles over it stay readable (`mix-blend-mode: difference` on page titles).
- [ ] Throttled (scale/fps), adaptive, pauses when hidden, honours reduced motion.
- [ ] Fallback works with WebGL disabled (`html.liquid-static`).
