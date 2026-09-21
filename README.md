# PrintForge

Browser only 3D viewer and parametric modeller for 3D printing. You describe a part in
plain words, an OpenRouter model answers with a parametric [JSCAD](https://openjscad.xyz)
script, the script is evaluated in a worker and the resulting solid is shown, measured,
checked for printability and exported as STL or 3MF.

No backend. No build step at runtime. The OpenRouter key lives in `localStorage` and the
browser talks to `openrouter.ai` directly.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Open the app, paste an OpenRouter key from <https://openrouter.ai/keys> into the settings
dialog and start asking for parts.

```bash
npm run build    # static bundle in dist/, host it anywhere
npm run preview
```

## How it works

```
prompt ──▶ OpenRouter (streamed) ──▶ JSCAD script
                                        │
                              worker: evaluate + tessellate
                                        │
                     ┌──────────────────┼──────────────────┐
                three.js viewer    print check       STL / 3MF
```

- **`src/lib/jscad.worker.js`** — the only place that touches JSCAD. It compiles the script
  in a `new Function` sandbox, runs `main(params)`, drops the result onto z = 0, turns the
  polygons into triangle buffers and computes the print metrics. It also owns the STL and
  3MF serializers so nothing large crosses back to the main thread twice.
- **`src/lib/runner.js`** — promise wrapper around the worker, with a hard timeout that
  terminates and replaces a worker stuck in an endless loop.
- **`src/lib/scene.js`** — three.js: build plate, grid, build volume cage, orbit controls,
  shading modes. Deliberately plain module state, so none of it ends up inside Gea's
  reactive proxy.
- **`src/lib/prompt.js`** — the system prompt. This is what decides whether the generated
  parts are printable: the JSCAD API the sandbox exposes, plus wall thickness, overhang,
  clearance and orientation rules.
- **`src/stores/*`** — Gea stores. `model-store` holds the script and everything derived
  from the last run, `ai-store` runs the generate / refine / repair loop, `settings-store`
  persists printer, material and viewer preferences.

### Printability checks

- **Watertight** — the vector area of a closed surface sums to zero. Edge matching was the
  obvious approach and is wrong here: JSCAD's boolean ops leave T-junctions on perfectly
  valid solids, and an edge test flags every one of them.
- **Build volume** — bounding box against the selected printer.
- **Overhang** — total area of downward faces steeper than 45°, ignoring what sits on the
  plate.
- **Material** — volume scaled by shell plus infill, converted to grams, metres of 1.75 mm
  filament and a rough cost.

### Self repair

When a generated script throws, the error and the script go back to the model once and the
corrected version is rerun. The chat shows that as a `retry` line.

## Stack

[Gea](https://github.com/dashersw/gea) (compile-time JSX, proxy stores, no virtual DOM),
three.js, @jscad/modeling, CodeMirror 6, Vite.

Two Gea details worth knowing before editing the UI:

- JSX only compiles inside `template()` or a default exported function. A helper method that
  returns JSX compiles to broken code, see `param-control.tsx` for the way around it.
- Components are `.tsx`. Vite's dependency scanner does not run the Gea plugin and resolves
  plain `.jsx` against React's runtime, which fails the scan. `tsconfig.json` points
  `jsxImportSource` at `@geajs/core` and its `include` must list the `.tsx` files.

The official Gea agent skill is vendored at `.claude/skills/gea-framework/`.

## Not done yet

- Slicing and time estimates. The material figure is a volume estimate, not a G-code run.
- Mesh repair. A model that fails the watertight check has to be fixed in the script.
- Multi part projects and assemblies.
