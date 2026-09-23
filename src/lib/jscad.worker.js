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

const { geometries, transforms, measurements, booleans, primitives, extrusions, maths } = jscad

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

  const main = exported.main || locals.main || (typeof exported === 'function' ? exported : undefined)
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
  // Polygons stay grouped by solid, so the viewer can show, hide and move
  // every part of a multi part model on its own.
  const polygons = []
  const polygonPart = []
  solids.forEach((solid, part) => {
    for (const poly of geometries.geom3.toPolygons(solid)) {
      polygons.push(poly)
      polygonPart.push(part)
    }
  })
  const partTris = solids.map(() => ({ start: 0, count: 0 }))
  const partMin = solids.map(() => [Infinity, Infinity, Infinity])
  const partMax = solids.map(() => [-Infinity, -Infinity, -Infinity])

  let triangleCount = 0
  for (const poly of polygons) triangleCount += Math.max(0, poly.vertices.length - 2)

  const positions = new Float32Array(triangleCount * 9)
  const normals = new Float32Array(triangleCount * 9)

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let volume = 0
  let t = 0

  // Planar face grouping for picking. Triangles that share a plane (quantised
  // normal and offset) get one id, so the viewer can highlight and sketch on a
  // whole face even though JSCAD splits it into many polygons.
  const planeIds = new Uint32Array(triangleCount)
  const planeIndex = new Map()
  const planes = []

  // Feature edges for the CAD style outline. An edge is real when the two
  // triangles sharing it meet at a sharp angle. Two extra rules matter here:
  // an edge used only once is a T-junction left by the boolean ops (which is
  // why EdgesGeometry draws lines across a boolean result), and the facets of
  // a tessellated cylinder are separate planes but meet almost flat, so they
  // must be filtered by angle or every segment line shows up.
  const collectEdges = triangleCount <= 200000
  const edgeUse = collectEdges ? new Map() : null
  const SHARP_COS = Math.cos((30 * Math.PI) / 180)
  const vkey = (v) => `${Math.round(v[0] * 1e3)},${Math.round(v[1] * 1e3)},${Math.round(v[2] * 1e3)}`

  // Smooth shading data: which triangles touch each vertex, and how big they
  // are. Normals are averaged only across triangles within the crease angle,
  // so a cylinder shades round while a box keeps its hard corners.
  const vertexTris = collectEdges ? new Map() : null
  const cornerKeys = collectEdges ? new Array(triangleCount * 3) : null
  const triArea = new Float32Array(triangleCount)

  // Vector area of the surface. On a closed surface it sums to zero, and
  // unlike edge matching it is not confused by the T-junctions that JSCAD's
  // boolean ops leave behind on perfectly valid solids.
  let areaX = 0
  let areaY = 0
  let areaZ = 0
  let totalArea = 0

  const downFaces = []
  let tri = 0

  for (let p = 0; p < polygons.length; p++) {
    const verts = polygons[p].vertices
    const part = polygonPart[p]
    if (partTris[part].count === 0) partTris[part].start = tri
    partTris[part].count += Math.max(0, verts.length - 2)
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

      const offset = nx * a[0] + ny * a[1] + nz * a[2]
      const planeKey = `${Math.round(nx * 500)},${Math.round(ny * 500)},${Math.round(nz * 500)}|${Math.round(offset * 50)}`
      let planeId = planeIndex.get(planeKey)
      if (planeId === undefined) {
        planeId = planes.length
        planeIndex.set(planeKey, planeId)
        planes.push({ normal: [nx, ny, nz], offset, area: 0, cx: 0, cy: 0, cz: 0 })
      }
      const plane = planes[planeId]
      plane.area += area
      plane.cx += area * (a[0] + b[0] + c[0]) / 3
      plane.cy += area * (a[1] + b[1] + c[1]) / 3
      plane.cz += area * (a[2] + b[2] + c[2]) / 3
      planeIds[tri++] = planeId

      triArea[tri - 1] = area

      if (collectEdges) {
        const keys = [vkey(a), vkey(b), vkey(c)]
        for (let k = 0; k < 3; k++) {
          cornerKeys[(tri - 1) * 3 + k] = keys[k]
          let list = vertexTris.get(keys[k])
          if (!list) vertexTris.set(keys[k], (list = []))
          list.push(tri - 1)
        }
        const corners = [a, b, c]
        for (let e = 0; e < 3; e++) {
          const k1 = keys[e]
          const k2 = keys[(e + 1) % 3]
          const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
          const seen = edgeUse.get(key)
          if (seen === undefined) {
            edgeUse.set(key, { planeId, part, uses: 1, p: corners[e], q: corners[(e + 1) % 3] })
          } else {
            seen.uses++
            if (seen.planeId !== planeId) {
              const n1 = planes[seen.planeId].normal
              const n2 = planes[planeId].normal
              const dot = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
              if (dot < SHARP_COS) seen.sharp = true
            }
          }
        }
      }

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
          if (v[d] < partMin[part][d]) partMin[part][d] = v[d]
          if (v[d] > partMax[part][d]) partMax[part][d] = v[d]
        }
      }
    }
  }

  const closureError = totalArea > 0 ? Math.hypot(areaX, areaY, areaZ) / totalArea : 1

  // Faces sitting on the build plate rest on the bed, they need no support.
  const plateZ = min[2] + 0.05
  const overhangArea = downFaces.reduce((sum, f) => (f.z > plateZ ? sum + f.area : sum), 0)

  const empty = triangleCount === 0
  if (collectEdges) {
    // Flat normals were written per triangle above, read them before overwriting.
    const flat = normals.slice()
    for (let t = 0; t < triangleCount; t++) {
      const nx = flat[t * 9], ny = flat[t * 9 + 1], nz = flat[t * 9 + 2]
      for (let k = 0; k < 3; k++) {
        let sx = 0, sy = 0, sz = 0
        for (const u of vertexTris.get(cornerKeys[t * 3 + k])) {
          const ux = flat[u * 9], uy = flat[u * 9 + 1], uz = flat[u * 9 + 2]
          if (nx * ux + ny * uy + nz * uz < SHARP_COS) continue
          const w = triArea[u]
          sx += ux * w; sy += uy * w; sz += uz * w
        }
        const len = Math.hypot(sx, sy, sz)
        if (len > 0) {
          const o = t * 9 + k * 3
          normals[o] = sx / len; normals[o + 1] = sy / len; normals[o + 2] = sz / len
        }
      }
    }
  }

  // Edges are written part by part, each part then owns one contiguous run.
  let edgePositions = new Float32Array(0)
  const partEdges = solids.map(() => ({ start: 0, count: 0 }))
  if (collectEdges) {
    const perPart = solids.map(() => [])
    for (const [, edge] of edgeUse) {
      if (edge.uses !== 2 || !edge.sharp) continue
      perPart[edge.part].push(edge.p[0], edge.p[1], edge.p[2], edge.q[0], edge.q[1], edge.q[2])
    }
    let offset = 0
    perPart.forEach((list, part) => {
      partEdges[part] = { start: offset / 6, count: list.length / 6 }
      offset += list.length
    })
    edgePositions = new Float32Array(perPart.flat())
  }

  const parts = solids.map((_, part) => {
    const lo = partMin[part]
    const hi = partMax[part]
    const empty = partTris[part].count === 0
    return {
      triStart: partTris[part].start,
      triCount: partTris[part].count,
      edgeStart: partEdges[part].start,
      edgeCount: partEdges[part].count,
      min: empty ? [0, 0, 0] : lo,
      max: empty ? [0, 0, 0] : hi
    }
  })

  for (const plane of planes) {
    if (plane.area > 0) {
      plane.centroid = [plane.cx / plane.area, plane.cy / plane.area, plane.cz / plane.area]
    } else {
      plane.centroid = [0, 0, 0]
    }
    delete plane.cx; delete plane.cy; delete plane.cz
  }

  return {
    positions,
    normals,
    planeIds,
    planes,
    edgePositions,
    parts,
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

/**
 * Sketch features drawn in the viewer: a 2D shape on a picked face, extruded
 * outwards (add) or into the body (cut). They are applied after layFlat so the
 * plane data recorded in the viewer's coordinates stays valid.
 */
const buildTool = (feature) => {
  const { plane, sketch, depth, op } = feature
  const shape = sketch.type === 'circle'
    ? primitives.circle({ radius: sketch.r, center: [sketch.u, sketch.v], segments: 64 })
    : sketch.type === 'poly'
      ? primitives.polygon({ points: sketch.points })
      : primitives.rectangle({ size: [sketch.w, sketch.h], center: [sketch.u, sketch.v] })

  // Sink the tool 0.2 mm into the body so no face ends up coplanar with the
  // one it was sketched on, that is the classic source of broken CSG output.
  // On the build plate there is nothing to sink into, a bleed there would
  // push the part 0.2 mm below the bed.
  const bleed = plane.ground ? 0 : 0.2
  let solid = extrusions.extrudeLinear({ height: depth + bleed }, shape)
  solid = transforms.translateZ(op === 'cut' ? -depth : -bleed, solid)

  const [u, v, n, o] = [plane.u, plane.v, plane.normal, plane.origin]
  const matrix = maths.mat4.fromValues(
    u[0], u[1], u[2], 0,
    v[0], v[1], v[2], 0,
    n[0], n[1], n[2], 0,
    o[0], o[1], o[2], 1
  )
  return transforms.transform(matrix, solid)
}

const applyFeatures = (solids, features) => {
  if (!features || features.length === 0) return solids
  let body = solids.length === 1 ? solids[0] : booleans.union(solids)
  for (const feature of features) {
    const tool = buildTool(feature)
    body = feature.op === 'cut' ? booleans.subtract(body, tool) : booleans.union(body, tool)
  }
  return [body]
}

const run = ({ code, params, autoPlace = true, features = [] }) => {
  const { main, getParameterDefinitions } = compile(code)
  const { defs, values } = readParams(getParameterDefinitions, params)

  const started = performance.now()
  let solids = collectSolids(main(values))
  if (solids.length === 0) throw new Error('main() did not return any 3D geometry (geom3)')
  if (autoPlace) solids = layFlat(solids)
  solids = applyFeatures(solids, features)

  const mesh = tessellate(solids)
  current = { solids, code, params: values }

  return {
    positions: mesh.positions,
    normals: mesh.normals,
    planeIds: mesh.planeIds,
    planes: mesh.planes,
    edgePositions: mesh.edgePositions,
    parts: mesh.parts,
    stats: { ...mesh.stats, duration: Math.round(performance.now() - started) },
    paramDefs: defs,
    paramValues: values
  }
}

const exportModel = ({ format, separate = false }) => {
  if (!current) throw new Error('nothing to export, run the script first')
  if (separate) {
    return {
      files: current.solids.map((solid, index) => {
        if (format === '3mf') {
          return {
            index: index + 1,
            parts: threeMfSerializer.serialize({ unit: 'millimeter' }, [solid]),
            mimeType: 'model/3mf',
            extension: '3mf'
          }
        }
        return {
          index: index + 1,
          parts: stlSerializer.serialize({ binary: format !== 'stl-ascii' }, [solid]),
          mimeType: 'model/stl',
          extension: 'stl'
        }
      })
    }
  }
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
      self.postMessage({ id, ok: true, result }, [
        result.positions.buffer, result.normals.buffer, result.planeIds.buffer, result.edgePositions.buffer
      ])
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
