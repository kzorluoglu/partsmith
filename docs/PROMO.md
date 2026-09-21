# Promo drafts

Working notes, not part of the app. Edit before posting, the voice should be yours.

## Twitter / X thread

**1/**
Most "AI 3D model" tools give you a mesh. A blob of triangles you can't edit,
usually not watertight, rarely printable.

So I built one that writes parametric CAD code instead.

PartSmith: describe a part, get a printable STL. Runs entirely in your browser.
🔗 kzorluoglu.github.io/partsmith

[demo.gif]

**2/**
The trick is what you ask the model for.

Not a mesh. A JSCAD script: real solid geometry, booleans, every dimension a named
parameter.

You get sliders for all of them. Move one, it rebuilds in a worker. No re-prompting to
change a wall from 2mm to 3mm.

[screenshot: parameter sliders + model]

**3/**
Printability is checked, not assumed:

· watertight (via surface closure, not edge matching, more on that below)
· fits your printer's build volume
· steep overhang area, so you know if you need supports
· filament grams, metres and cost

Export STL or 3MF, straight into your slicer.

**4/**
My first watertight check matched directed edges. Every model failed with hundreds of
"open edges".

They were T-junctions. JSCAD's boolean ops leave them on perfectly valid solids.

Fix: sum the vector area of the surface. Closed solids give ~1e-17, an open shell gives
0.2. Immune to how the polygons are split.

**5/**
When a generated script throws, the error and the script go back to the model once and
the fix is rerun automatically. You mostly never see it happen.

**6/**
No backend. No accounts. No telemetry. Your OpenRouter key stays in localStorage and the
browser talks to the API directly, so you pick any model you want and pay for exactly
what you use.

Built with @geajs (compile-time JSX, no virtual DOM), three.js and JSCAD.

MIT: github.com/kzorluoglu/partsmith

## Single tweet version

Describe a part in plain words, get a printable STL.

PartSmith asks the LLM for parametric CAD code instead of a mesh, so you get a real solid
with a slider for every dimension, a printability check and STL/3MF export.

No backend, bring your own key, MIT.
kzorluoglu.github.io/partsmith

## LinkedIn / longer post

Every "AI 3D generator" I tried has the same problem: it produces a mesh. You cannot
change a wall thickness, you cannot guarantee it is watertight, and half the time your
slicer refuses it.

I tried a different angle. Instead of asking the model for geometry, ask it for code.

PartSmith sends your description to an LLM and gets back a parametric JSCAD script. The
script runs in a web worker and produces real solid geometry through boolean operations.
Because every dimension is a named parameter, the UI can render a slider for each one and
rebuild the model as you drag it. No re-prompting to go from 2 mm walls to 3 mm.

Before you export, it checks what actually matters for FDM: whether the surface is closed,
whether it fits your printer's build volume, how much steep overhang needs support, and
what the part will cost in filament.

The whole thing runs in the browser. No backend, no accounts, no telemetry. Your API key
stays in localStorage.

Open source, MIT: github.com/kzorluoglu/partsmith

## Notes before posting

- Replace [demo.gif] and [screenshot] markers with the real files.
- Post the thread when the Pages deploy is live and you have clicked the link yourself.
- Tweet 4 is the one that tends to travel. Engineers like a specific bug with a specific
  fix far more than a feature list.
- r/3Dprinting and r/functionalprint want the printed result, not the software. Print
  something with it first and lead with the photo.
- Hacker News: title "Show HN: PartSmith – describe a part, get a printable STL, in the
  browser". No emoji, no adjectives, first comment explains why code beats meshes.
