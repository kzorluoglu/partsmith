/**
 * Web worker that evaluates user / model authored JSCAD scripts and turns the
 * resulting solids into plain typed arrays the main thread can hand to three.js.
 *
 * Everything heavy lives here: CSG evaluation, mesh extraction, print analysis
 * and the STL / 3MF serialization. The main thread never touches JSCAD.
 */
import jscad from '@jscad/modeling'
import stlSerializer from '@jscad/stl-serializer'
import threeMfSerializer from '@jscad/3mf-serializer'

const { geometries, transforms, measurements, booleans } = jscad

/** Result of the most recent successful run, reused by the exporters. */
let current = null

/**
 * Minimal `require` shim so scripts copied from the JSCAD docs keep working.
 */
const requireShim = (name) => {
  const clean = String(name).replace(/^@jscad\//, '').replace(/^jscad-/, '')
  if (clean === 'modeling' || name === '@jscad/modeling') return jscad
  if (jscad[clean]) return jscad[clean]
  throw new Error(`module "${name}" is not available in the browser sandbox`)
}

/**
 * Compiles a script and returns its `main` plus optional parameter definitions.
 * Supports both the CommonJS style (`module.exports = { main }`) used by the
 * JSCAD CLI and plain top level function declarations.
 */
const compile = (code) => {
  const moduleObj = { exports: {} }
  const factory = new Function(
    'jscad',
    'require',
    'module',
    'exports',
    `"use strict";\n${code}\n;return {
       main: typeof main !== 'undefined' ? main : undefined,
       getParameterDefinitions: typeof getParameterDefinitions !== 'undefined' ? getParameterDefinitions : undefined
     };`
  )
  const locals = factory(jscad, requireShim, moduleObj, moduleObj.exports)
  const exported = moduleObj.exports || {}

  const main = locals.main || exported.main || (typeof exported === 'function' ? exported : undefined)
  const getParameterDefinitions =
    locals.getParameterDefinitions || exported.getParameterDefinitions

  if (typeof main !== 'function') {
    throw new Error('the script does not export a main() function')
  }
  return { main, getParameterDefinitions }
}

/** Reads the parameter definitions and folds in the values the user picked. */
const readParams = (getParameterDefinitions, overrides = {}) => {
  if (typeof getParameterDefinitions !== 'function') return { defs: [], values: {} }
  const defs = getParameterDefinitions() || []
  const values = {}
  for (const def of defs) {
    if (!def || !def.name || def.type === 'group') continue
    const fallback = def.initial !== undefined ? def.initial : def.default
    const picked = overrides[def.name]
    values[def.name] = picked === undefined ? fallback : picked
  }
  return { defs, values }
}

/** Flattens whatever main() returned into a list of geom3 solids. */
const collectSolids = (value) => {
  const out = []
  const walk = (item) => {
    if (!item) return
    if (Array.isArray(item)) return item.forEach(walk)
    if (geometries.geom3.isA(item)) out.push(item)
  }
  walk(value)
  return out
}

/**
 * Turns solids into interleaved triangle data plus the numbers a print needs:
 * bounding box, volume, manifoldness and unsupported overhang area.
 */
const tessellate = (solids) => {
  const polygons = solids.flatMap((solid) => geometries.geom3.toPolygons(solid))

  let triangleCount = 0
  for (const poly of polygons) triangleCount += Math.max(0, poly.vertices.length - 2)

  const positions = new Float32Array(triangleCount * 9)
  const normals = new Float32Array(triangleCount * 9)

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let volume = 0
  let t = 0

  // Vector area of the surface. On a closed surface it sums to zero, and
  // unlike edge matching it is not confused by the T-junctions that JSCAD's
  // boolean ops leave behind on perfectly valid solids.
  let areaX = 0
  let areaY = 0
  let areaZ = 0
  let totalArea = 0

  const downFaces = []

  for (const poly of polygons) {
    const verts = poly.vertices
    const a = verts[0]
    for (let i = 1; i < verts.length - 1; i++) {
      const b = verts[i]
      const c = verts[i + 1]

      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz)
      const area = len / 2
      areaX += nx / 2
      areaY += ny / 2
      areaZ += nz / 2
      totalArea += area
      if (len > 0) { nx /= len; ny /= len; nz /= len }

      if (nz < -0.7071 && area > 0) downFaces.push({ area, z: Math.min(a[2], b[2], c[2]) })

      // Signed tetrahedron volume against the origin.
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) -
                 a[1] * (b[0] * c[2] - b[2] * c[0]) +
                 a[2] * (b[0] * c[1] - b[1] * c[0])) / 6

      for (const v of [a, b, c]) {
        positions[t] = v[0]; positions[t + 1] = v[1]; positions[t + 2] = v[2]
        normals[t] = nx; normals[t + 1] = ny; normals[t + 2] = nz
        t += 3
        for (let d = 0; d < 3; d++) {
          if (v[d] < min[d]) min[d] = v[d]
          if (v[d] > max[d]) max[d] = v[d]
        }
      }
    }
  }

  const closureError = totalArea > 0 ? Math.hypot(areaX, areaY, areaZ) / totalArea : 1

  // Faces sitting on the build plate rest on the bed, they need no support.
  const plateZ = min[2] + 0.05
  const overhangArea = downFaces.reduce((sum, f) => (f.z > plateZ ? sum + f.area : sum), 0)

  const empty = triangleCount === 0
  return {
    positions,
    normals,
    stats: {
      empty,
      triangles: triangleCount,
      polygons: polygons.length,
      solids: solids.length,
      volume: Math.abs(volume),
      size: empty ? [0, 0, 0] : [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
      min: empty ? [0, 0, 0] : min,
      max: empty ? [0, 0, 0] : max,
      manifold: !empty && closureError < 1e-6,
      closureError,
      inverted: volume < 0,
      overhangArea
    }
  }
}

/**
 * Drops the model onto z = 0 and centers it over the plate origin, which is
 * what every slicer expects and what the viewer's build volume assumes.
 */
const layFlat = (solids) => {
  if (solids.length === 0) return solids
  const union = solids.length === 1 ? solids[0] : booleans.union(solids)
  const bounds = measurements.measureBoundingBox(union)
  const [lo, hi] = bounds
  return solids.map((solid) => transforms.translate([
    -(lo[0] + hi[0]) / 2,
    -(lo[1] + hi[1]) / 2,
    -lo[2]
  ], solid))
}

const run = ({ code, params, autoPlace = true }) => {
  const { main, getParameterDefinitions } = compile(code)
  const { defs, values } = readParams(getParameterDefinitions, params)

  const started = performance.now()
  let solids = collectSolids(main(values))
  if (solids.length === 0) throw new Error('main() did not return any 3D geometry (geom3)')
  if (autoPlace) solids = layFlat(solids)

  const mesh = tessellate(solids)
  current = { solids, code, params: values }

  return {
    positions: mesh.positions,
    normals: mesh.normals,
    stats: { ...mesh.stats, duration: Math.round(performance.now() - started) },
    paramDefs: defs,
    paramValues: values
  }
}

const exportModel = ({ format }) => {
  if (!current) throw new Error('nothing to export, run the script first')
  if (format === '3mf') {
    const parts = threeMfSerializer.serialize({ unit: 'millimeter' }, current.solids)
    return { parts, mimeType: 'model/3mf', extension: '3mf' }
  }
  if (format === 'stl-ascii') {
    const parts = stlSerializer.serialize({ binary: false }, current.solids)
    return { parts, mimeType: 'model/stl', extension: 'stl' }
  }
  const parts = stlSerializer.serialize({ binary: true }, current.solids)
  return { parts, mimeType: 'model/stl', extension: 'stl' }
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data
  try {
    if (type === 'run') {
      const result = run(payload)
      self.postMessage({ id, ok: true, result }, [result.positions.buffer, result.normals.buffer])
      return
    }
    if (type === 'export') {
      const result = exportModel(payload)
      self.postMessage({ id, ok: true, result })
      return
    }
    throw new Error(`unknown worker command "${type}"`)
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: { message: error.message || String(error), stack: error.stack || '' }
    })
  }
}
