/**
 * Sketch features: pure helpers shared by the viewer, the store and the bake
 * step. No three.js and no JSCAD in here so both sides can import it.
 *
 * A feature is plain data:
 *   { id, op: 'add' | 'cut', depth,
 *     plane: { origin, normal, u, v },        // world space basis of the face
 *     sketch: { type: 'rect', u, v, w, h } | { type: 'circle', u, v, r } }
 * Sketch coordinates are in the plane's (u, v) frame, relative to origin.
 */

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Builds a stable right handed (u, v, n) frame on a face. */
export const planeBasis = (normal, origin) => {
  const n = normalize(normal)
  // Any helper not parallel to n works, the choice just decides which way "u" points.
  const helper = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = normalize(cross(helper, n))
  const v = cross(n, u)
  return { origin: [...origin], normal: n, u, v }
}

/** World point to (u, v) on the plane. */
export const toPlane = (plane, p) => {
  const d = [p[0] - plane.origin[0], p[1] - plane.origin[1], p[2] - plane.origin[2]]
  return [
    d[0] * plane.u[0] + d[1] * plane.u[1] + d[2] * plane.u[2],
    d[0] * plane.v[0] + d[1] * plane.v[1] + d[2] * plane.v[2]
  ]
}

/** (u, v) on the plane back to a world point, optionally lifted off the face. */
export const fromPlane = (plane, u, v, lift = 0) => [
  plane.origin[0] + u * plane.u[0] + v * plane.v[0] + lift * plane.normal[0],
  plane.origin[1] + u * plane.u[1] + v * plane.v[1] + lift * plane.normal[1],
  plane.origin[2] + u * plane.u[2] + v * plane.v[2] + lift * plane.normal[2]
]

export const snap = (value, step = 1) => Math.round(value / step) * step

/** Turns a drag from a to b (plane coords) into a sketch shape. */
export const sketchFromDrag = (type, a, b, step = 1) => {
  const [au, av] = [snap(a[0], step), snap(a[1], step)]
  const [bu, bv] = [snap(b[0], step), snap(b[1], step)]
  if (type === 'circle') {
    const r = Math.max(step, snap(Math.hypot(bu - au, bv - av), step))
    return { type, u: au, v: av, r }
  }
  const w = Math.max(step, Math.abs(bu - au))
  const h = Math.max(step, Math.abs(bv - av))
  return { type: 'rect', u: (au + bu) / 2, v: (av + bv) / 2, w, h }
}

/** Outline of a sketch as plane coordinates, for the preview line. */
export const sketchOutline = (sketch) => {
  if (sketch.type === 'circle') {
    const pts = []
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2
      pts.push([sketch.u + Math.cos(t) * sketch.r, sketch.v + Math.sin(t) * sketch.r])
    }
    return pts
  }
  const hw = sketch.w / 2
  const hh = sketch.h / 2
  return [
    [sketch.u - hw, sketch.v - hh], [sketch.u + hw, sketch.v - hh],
    [sketch.u + hw, sketch.v + hh], [sketch.u - hw, sketch.v + hh],
    [sketch.u - hw, sketch.v - hh]
  ]
}

export const describeFeature = (f) => {
  const shape = f.sketch.type === 'circle'
    ? `circle Ø${(f.sketch.r * 2).toFixed(1)}`
    : `rect ${f.sketch.w.toFixed(1)}×${f.sketch.h.toFixed(1)}`
  return `${f.op === 'cut' ? 'Cut' : 'Add'} ${shape} · ${f.depth.toFixed(1)} mm`
}

export const describeNormal = (n) => {
  const axes = ['X', 'Y', 'Z']
  let best = 0
  for (let i = 1; i < 3; i++) if (Math.abs(n[i]) > Math.abs(n[best])) best = i
  const aligned = Math.abs(n[best]) > 0.95
  return `${n[best] < 0 ? '-' : '+'}${axes[best]}${aligned ? '' : ' (tilted)'}`
}

const num = (n) => Number(n.toFixed(4))
const vec = (v) => `[${v.map(num).join(', ')}]`

/**
 * Writes the features into the script as JSCAD code, so the model stops
 * depending on viewer data and the AI can see and edit the geometry.
 * The wrapper chains: a second bake wraps the first one, not the raw main.
 */
export const bakeFeatures = (code, features, { autoPlace = true } = {}) => {
  if (!features.length) return code
  const tag = Date.now().toString(36)
  const lines = features.map((f, i) => {
    const shape = f.sketch.type === 'circle'
      ? `primitives.circle({ radius: ${num(f.sketch.r)}, center: [${num(f.sketch.u)}, ${num(f.sketch.v)}], segments: 64 })`
      : `primitives.rectangle({ size: [${num(f.sketch.w)}, ${num(f.sketch.h)}], center: [${num(f.sketch.u)}, ${num(f.sketch.v)}] })`
    const sink = f.op === 'cut' ? -f.depth : -0.2
    const { u, v, normal: n, origin: o } = f.plane
    const matrix = `maths.mat4.fromValues(${vec(u).slice(1, -1)}, 0, ${vec(v).slice(1, -1)}, 0, ${vec(n).slice(1, -1)}, 0, ${vec(o).slice(1, -1)}, 1)`
    const boolOp = f.op === 'cut' ? 'subtract' : 'union'
    return `  // ${i + 1}. ${describeFeature(f)} on face ${describeNormal(n)}
  body = booleans.${boolOp}(body, transforms.transform(${matrix},
    transforms.translateZ(${num(sink)}, extrusions.extrudeLinear({ height: ${num(f.depth + 0.2)} }, ${shape}))))`
  })

  return `${code.trimEnd()}

// ---- sketch features baked from the PartSmith viewer ----
const applySketch_${tag} = (input) => {
  const { primitives, extrusions, transforms, booleans, maths } = jscad
  const solids = Array.isArray(input) ? input : [input]
  let body = solids.length === 1 ? solids[0] : booleans.union(solids)
${autoPlace ? `  // Same placement the viewer used when the sketches were drawn: centred on
  // the plate, resting on z = 0. The sketch coordinates below assume it.
  const [lo, hi] = jscad.measurements.measureBoundingBox(body)
  body = transforms.translate([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]], body)
` : ''}${lines.join('\n')}
  return body
}
const base_${tag} = (module.exports && typeof module.exports.main === 'function') ? module.exports.main : main
module.exports = {
  main: (params) => applySketch_${tag}(base_${tag}(params)),
  getParameterDefinitions: typeof getParameterDefinitions === 'function' ? getParameterDefinitions : undefined
}
`
}
