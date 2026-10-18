# Render the liquid as a static PNG

Used for `apps/web/public/email/liquid-header.png` (1120×280, shown at 560px wide).

1. Build an HTML page that draws one frame of the `VERT`/`FRAG` shaders from
   `liquid-background.tsx` on a canvas of the target size (same uniforms: `uRes`, `uT`).
   Pick the moment with `uT` (the email header uses `uT = 63`). To leave room for text, shift
   the group: replace `vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;` with
   `... / uRes.y - vec2(0.95, 0.0);` and lay the text over the canvas with HTML.
2. Screenshot it with headless Chrome using software WebGL:

```bash
chrome --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=1120,280 --screenshot=liquid-header.png \
  "file:///path/to/banner.html#63"
```

3. Look at 2–3 different `uT` values side by side and pick the one with a balanced,
   clearly liquid composition (one bridge or pinch visible, nothing cut in half awkwardly).
4. Put the PNG in `apps/web/public/` and reference it by absolute URL.
