/**
 * The three.js side of the app. Kept as a plain module rather than component
 * state so none of it ever passes through Gea's reactive proxy.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Canvas2DRenderer } from './canvas2d-renderer.js'
import { planeBasis, toPlane, fromPlane, sketchFromDrag, sketchOutline, snapPoint, segmentLength, segmentAngle, pointAt } from './features.js'

let renderer, scene, camera, controls
let perspCamera, orthoCamera
let orthographic = false
let modelGroup, meshMaterial, mesh, wireframe
let plate, grid, volumeBox, axes
let gridUniforms = null
const cameraListeners = new Set()
// Last camera matrix the listeners saw. NaN so the first frame always counts.
const lastView = new Array(16).fill(NaN)
let frameHandle = 0
let resizeObserver
let software = false
let dirty = true

// Picking and sketching state. Plain module state on purpose, see the header.
let meshData = null          // { positions, planeIds, planes } of the current model
let highlight = null         // mesh covering the hovered or selected planar face
let preview = null           // line showing the sketch being dragged
let pick = { enabled: false, tool: 'select', selected: null, hoverId: -1, onSelect: null, onSketch: null, onPoly: null }
let drag = null

// Polyline being drawn: committed points plus the rubber band cursor.
let poly = null
let overlay = null
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

/** True when the scene is being drawn on the CPU because WebGL was unavailable. */
export const isSoftware = () => software

/** Asks for one more frame. The software path only draws when something changed. */
export const requestRender = () => { dirty = true }

/**
 * WebGL first, Canvas2D when the browser refuses a context. On Linux laptops
 * that usually means graphics acceleration is switched off in the browser.
 */
const createRenderer = (canvas) => {
  try {
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    gl.setPixelRatio(Math.min(devicePixelRatio, 2))
    gl.setClearColor(0x000000, 0)
    gl.toneMapping = THREE.NeutralToneMapping
    gl.toneMappingExposure = 1.0
    software = false
    return gl
  } catch {
    const cpu = new Canvas2DRenderer(canvas)
    cpu.setPixelRatio(devicePixelRatio)
    software = true
    return cpu
  }
}

/**
 * Looks, all shadow free. Lighting comes from a studio environment map rather
 * than from shadow casting lamps, which gives soft reflections on curved
 * faces without a single cast shadow. 'cad' is the matte grey engineering
 * look, 'studio' the glossy filament look of apps like Shapr3D.
 */
const LOOKS = {
  studio: { color: 0xf5891f, roughness: 0.36, metalness: 0.0 },
  cad: { color: 0xc3cad4, roughness: 0.82, metalness: 0.0 },
  clay: { color: 0xd9d2c7, roughness: 0.95, metalness: 0.0 }
}

const makeMaterial = (shading) => {
  if (shading === 'normal') return new THREE.MeshNormalMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
  const look = LOOKS[shading] || LOOKS.studio
  // polygonOffset pushes the faces a hair behind their own edge lines, so the
  // lines never lose the depth test to the surface they lie on and stay solid
  // instead of breaking up into dashes.
  return new THREE.MeshStandardMaterial({
    ...look,
    envMapIntensity: 1.0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
}

/** Builds the renderer, camera, lights and the static build plate furniture. */
export const initScene = (canvas) => {
  renderer = createRenderer(canvas)

  scene = new THREE.Scene()
  scene.background = null

  if (!software) {
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
  }

  perspCamera = new THREE.PerspectiveCamera(42, 1, 1, 4000)
  perspCamera.up.set(0, 0, 1)
  perspCamera.position.set(180, -220, 160)

  // CAD work wants parallel projection: equal lengths stay equal on screen.
  orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000)
  orthoCamera.up.set(0, 0, 1)
  orthoCamera.position.copy(perspCamera.position)

  camera = perspCamera

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI
  controls.target.set(0, 0, 30)

  // Three soft lights from different sides plus ambient: no face goes black,
  // nothing blows out, and there is not a single shadow caster in the scene.
  const key = new THREE.DirectionalLight(0xffffff, software ? 1.5 : 0.9)
  key.position.set(120, -180, 220)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xdfe7f5, software ? 0.9 : 0.35)
  fill.position.set(-180, 120, 90)
  scene.add(fill)

  scene.add(new THREE.AmbientLight(0xffffff, software ? 0.55 : 0.15))

  modelGroup = new THREE.Group()
  scene.add(modelGroup)

  // Sketch graphics live in their own group: never exported, never shaded,
  // and switchable without touching the model.
  overlay = new THREE.Group()
  overlay.name = 'sketch-overlay'
  scene.add(overlay)

  buildPlate([256, 256, 256])

  // Redrawing thousands of triangles on the CPU every frame would peg a core
  // for nothing, so the software path only draws when the scene changed.
  controls.addEventListener('change', requestRender)

  const animate = () => {
    frameHandle = requestAnimationFrame(animate)
    const moving = controls.update()
    if (orthographic && (moving || dirty)) {
      const canvas = renderer.domElement
      syncOrtho((canvas.clientWidth || 1) / (canvas.clientHeight || 1))
    }
    if (gridUniforms) {
      // Keep the grid readable at any zoom: cell size follows camera distance.
      const distance = camera.position.distanceTo(controls.target)
      const reach = orthographic ? (orthoCamera.top - orthoCamera.bottom) : distance
      gridUniforms.uMinor.value = Math.pow(10, Math.floor(Math.log10(Math.max(reach / 8, 0.1))))
      gridUniforms.uFade.value = Math.max(reach * 2.2, 60)
      gridUniforms.uCenter.value.set(controls.target.x, controls.target.y)
    }
    if (!software || dirty || moving) {
      renderer.render(scene, camera)
      dirty = false
    }
    const view = camera.matrixWorldInverse.elements
    let changed = false
    // OrbitControls rebuilds the position from spherical coordinates every
    // frame, which jitters in the last bits, so compare with a tolerance.
    for (let i = 0; i < 16; i++) {
      if (!(Math.abs(view[i] - lastView[i]) < 1e-7)) { changed = true; break }
    }
    if (changed) {
      for (let i = 0; i < 16; i++) lastView[i] = view[i]
      for (const fn of cameraListeners) fn(view, camera)
    }
  }
  animate()

  resizeObserver = new ResizeObserver(() => resize(canvas))
  resizeObserver.observe(canvas.parentElement || canvas)
  resize(canvas)
}

/** Orthographic frustum sized so it frames the same volume the camera sees. */
const syncOrtho = (aspect) => {
  const distance = orthoCamera.position.distanceTo(controls.target)
  const halfHeight = Math.max(1, distance * Math.tan((perspCamera.fov * Math.PI) / 360))
  const halfWidth = halfHeight * aspect
  orthoCamera.left = -halfWidth
  orthoCamera.right = halfWidth
  orthoCamera.top = halfHeight
  orthoCamera.bottom = -halfHeight
  orthoCamera.updateProjectionMatrix()
}

const resize = (canvas) => {
  const host = canvas.parentElement || canvas
  const width = host.clientWidth || 1
  const height = host.clientHeight || 1
  renderer.setSize(width, height, false)
  perspCamera.aspect = width / height
  perspCamera.updateProjectionMatrix()
  syncOrtho(width / height)
  dirty = true
}

/**
 * Switches projection. Both cameras share one position and target, so the
 * view does not jump, and the ortho frustum is rebuilt from the distance.
 */
export const setProjection = (mode) => {
  const wantOrtho = mode === 'ortho'
  if (wantOrtho === orthographic) return
  orthographic = wantOrtho
  const next = wantOrtho ? orthoCamera : perspCamera
  next.position.copy(camera.position)
  next.up.copy(camera.up)
  camera = next
  controls.object = camera
  const canvas = renderer.domElement
  syncOrtho((canvas.clientWidth || 1) / (canvas.clientHeight || 1))
  controls.update()
  dirty = true
}

export const isOrthographic = () => orthographic

const disposeObject = (object) => {
  if (!object) return
  object.geometry?.dispose()
  if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose())
  else object.material?.dispose()
  object.parent?.remove(object)
}

/** Redraws the plate, grid and build volume cage for the selected printer. */
export const buildPlate = ([x, y, z]) => {
  ;[plate, grid, volumeBox, axes].forEach(disposeObject)

  // The bed is an outline now, a filled plate hides the grid and reads heavy.
  const hx = x / 2, hy = y / 2
  plate = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hx, -hy, 0.02), new THREE.Vector3(hx, -hy, 0.02),
      new THREE.Vector3(hx, hy, 0.02), new THREE.Vector3(-hx, hy, 0.02)
    ]),
    new THREE.LineBasicMaterial({ color: 0x5b6784, transparent: true, opacity: 0.8 })
  )
  scene.add(plate)

  grid = software ? makeLineGrid(x, y) : makeInfiniteGrid()
  scene.add(grid)

  const cage = new THREE.BoxGeometry(x, y, z)
  volumeBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(cage),
    new THREE.LineBasicMaterial({ color: 0x46506a, transparent: true, opacity: 0.35 })
  )
  volumeBox.position.z = z / 2
  cage.dispose()
  scene.add(volumeBox)

  axes = makeAxes(4000)
  scene.add(axes)
  dirty = true
}

/** X red, Y green, Z blue through the origin, the convention every CAD app uses. */
const makeAxes = (length) => {
  const group = new THREE.Group()
  const line = (to, color, opacity) => {
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...to.map((v) => -v)), new THREE.Vector3(...to)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    )
    group.add(l)
  }
  line([length, 0, 0], 0xe5484d, 0.75)
  line([0, length, 0], 0x46a758, 0.75)
  line([0, 0, length], 0x3e63dd, 0.75)
  group.position.z = 0.03
  return group
}

/** Plain line grid for the software renderer, which cannot run shaders. */
const makeLineGrid = (x, y) => {
  const g = new THREE.GridHelper(Math.max(x, y), Math.round(Math.max(x, y) / 10), 0x3d4557, 0x262c38)
  g.rotation.x = Math.PI / 2
  return g
}

/**
 * Infinite grid on one big quad. Lines are drawn in the fragment shader with
 * screen space derivatives so they stay one pixel sharp at any zoom, the cell
 * size adapts to the camera distance, and the grid fades out towards the
 * horizon instead of ending in a hard square.
 */
const makeInfiniteGrid = () => {
  gridUniforms = {
    uMinor: { value: 10 },
    uFade: { value: 600 },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uColorMinor: { value: new THREE.Color(0x2a3040) },
    uColorMajor: { value: new THREE.Color(0x3d465c) }
  }
  const material = new THREE.ShaderMaterial({
    uniforms: gridUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      varying vec3 vWorld;
      uniform float uMinor;
      uniform float uFade;
      uniform vec2 uCenter;
      uniform vec3 uColorMinor;
      uniform vec3 uColorMajor;
      float gridLine(vec2 p, float size) {
        vec2 q = p / size;
        vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        float minor = gridLine(vWorld.xy, uMinor);
        float major = gridLine(vWorld.xy, uMinor * 10.0);
        float d = length(vWorld.xy - uCenter);
        float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
        float a = max(minor * 0.45, major * 0.9) * fade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(uColorMinor, uColorMajor, major), a);
      }`
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), material)
  quad.position.z = -0.01
  quad.renderOrder = -1
  return quad
}

/** Subscribe to camera moves, e.g. for the view cube. Returns an unsubscribe. */
export const onCameraChange = (fn) => {
  cameraListeners.add(fn)
  if (camera) fn(camera.matrixWorldInverse.elements, camera)
  return () => cameraListeners.delete(fn)
}

/** Replaces the displayed mesh with new triangle soup from the worker. */
export const setGeometry = (payload, { shading = 'studio', showWireframe = true } = {}) => {
  disposeObject(mesh)
  disposeObject(wireframe)
  mesh = null
  wireframe = null
  dirty = true
  if (!payload) return

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3))
  geometry.computeBoundingSphere()

  meshData = { positions: payload.positions, planeIds: payload.planeIds, planes: payload.planes }
  setHighlight(null)
  setPreview(null)

  meshMaterial = makeMaterial(shading)
  mesh = new THREE.Mesh(geometry, meshMaterial)
  modelGroup.add(mesh)

  // Edges come precomputed from the worker, see the note there on why
  // EdgesGeometry draws phantom lines across boolean results.
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(
    payload.edgePositions?.length ? payload.edgePositions : new Float32Array(0), 3
  ))
  wireframe = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({ color: 0x14161b, transparent: true, opacity: 0.85 })
  )
  wireframe.visible = showWireframe
  modelGroup.add(wireframe)
}

/* ---- face picking and sketching ------------------------------------- */

const facePlane = (planeId) => {
  const plane = meshData?.planes?.[planeId]
  if (!plane) return null
  return { id: planeId, ...planeBasis(plane.normal, plane.centroid), area: plane.area }
}

/** Draws a translucent copy of every triangle on the given plane. */
const setHighlight = (planeId, strong = false) => {
  disposeObject(highlight)
  highlight = null
  dirty = true
  if (planeId == null || planeId < 0 || !meshData) return

  const { positions, planeIds } = meshData
  const picked = []
  for (let t = 0; t < planeIds.length; t++) {
    if (planeIds[t] !== planeId) continue
    for (let k = 0; k < 9; k++) picked.push(positions[t * 9 + k])
  }
  if (picked.length === 0) return

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(picked, 3))
  highlight = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: strong ? 0x3b82f6 : 0xffffff,
    transparent: true,
    opacity: strong ? 0.72 : 0.16,
    toneMapped: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide
  }))
  overlay.add(highlight)
}

const setPreview = (sketch, plane) => {
  disposeObject(preview)
  preview = null
  dirty = true
  if (!sketch || !plane) return
  const pts = sketchOutline(sketch).map(([u, v]) => new THREE.Vector3(...fromPlane(plane, u, v, 0.15)))
  preview = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x9cc2ff, depthTest: false, toneMapped: false })
  )
  preview.renderOrder = 10
  overlay.add(preview)
}

const updatePointer = (event) => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
}

const hitModel = () => {
  if (!mesh) return null
  const hits = raycaster.intersectObject(mesh, false)
  return hits.length ? hits[0] : null
}

/** Where the pointer ray crosses the selected face's infinite plane, in (u, v). */
const hitPlane = (plane) => {
  const p = new THREE.Plane().setFromNormalAndCoplanarPoint(
    new THREE.Vector3(...plane.normal), new THREE.Vector3(...plane.origin)
  )
  const point = raycaster.ray.intersectPlane(p, new THREE.Vector3())
  return point ? toPlane(plane, point.toArray()) : null
}

/** Redraws the polyline plus its rubber band segment. */
const drawPoly = () => {
  disposeObject(preview)
  preview = null
  dirty = true
  if (!poly || !pick.selected) return

  const pts = [...poly.points]
  if (poly.cursor) pts.push(poly.cursor)
  if (pts.length < 2) {
    // A single placed point still needs to be visible.
    if (pts.length === 1) {
      const p = new THREE.Vector3(...fromPlane(pick.selected, pts[0][0], pts[0][1], 0.2))
      preview = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([p]),
        new THREE.PointsMaterial({ color: 0x9cc2ff, size: 7, sizeAttenuation: false, depthTest: false, toneMapped: false })
      )
      preview.renderOrder = 10
      overlay.add(preview)
    }
    return
  }

  const world = pts.map(([u, v]) => new THREE.Vector3(...fromPlane(pick.selected, u, v, 0.2)))
  if (poly.closing && poly.points.length > 2) world.push(world[0])
  preview = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(world),
    new THREE.LineBasicMaterial({ color: poly.closing ? 0x3fb950 : 0x9cc2ff, depthTest: false, toneMapped: false })
  )
  preview.renderOrder = 10
  overlay.add(preview)
}

const CLOSE_TOLERANCE = 2.5

const reportPoly = () => {
  if (!pick.onPoly) return
  const last = poly?.points[poly.points.length - 1]
  pick.onPoly({
    points: poly ? poly.points.map((p) => [...p]) : [],
    cursor: poly?.cursor ? [...poly.cursor] : null,
    length: last && poly?.cursor ? segmentLength(last, poly.cursor) : 0,
    angle: last && poly?.cursor ? segmentAngle(last, poly.cursor) : 0,
    closing: Boolean(poly?.closing)
  })
}

/** Places the next polyline point, or closes the profile when back at the start. */
const addPolyPoint = (uv) => {
  if (!poly) poly = { points: [], cursor: null, closing: false }
  if (poly.points.length > 2 && segmentLength(poly.points[0], uv) <= CLOSE_TOLERANCE) {
    return finishPoly()
  }
  poly.points.push(uv)
  poly.cursor = null
  drawPoly()
  reportPoly()
}

export const finishPoly = () => {
  if (!poly || poly.points.length < 3) return false
  const points = poly.points.map((p) => [...p])
  const plane = pick.selected
  poly = null
  drawPoly()
  reportPoly()
  pick.onSketch?.({ type: 'poly', points }, plane)
  return true
}

export const cancelPoly = () => {
  poly = null
  drawPoly()
  reportPoly()
}

/** Commits the pending segment at an exact length, optionally an exact angle. */
export const commitExactSegment = (lengthMm, angleDeg) => {
  if (!poly || poly.points.length === 0 || !lengthMm) return false
  const from = poly.points[poly.points.length - 1]
  const angle = angleDeg == null
    ? (poly.cursor ? segmentAngle(from, poly.cursor) : 0)
    : angleDeg
  addPolyPoint(pointAt(from, lengthMm, angle))
  return true
}

export const undoPolyPoint = () => {
  if (!poly || poly.points.length === 0) return
  poly.points.pop()
  if (poly.points.length === 0) poly = null
  drawPoly()
  reportPoly()
}

const onPointerDown = (event) => {
  if (!pick.enabled || event.button !== 0) return
  updatePointer(event)
  // The polyline is click to place, so it must not lock the orbit controls.
  if (pick.tool === 'line' && pick.selected) {
    drag = { kind: 'maybe-point', x: event.clientX, y: event.clientY }
    return
  }

  const sketching = pick.tool !== 'select' && pick.selected
  if (sketching) {
    const start = hitPlane(pick.selected)
    if (!start) return
    // The drag belongs to the sketch now, not to the camera.
    controls.enabled = false
    drag = { kind: 'sketch', start, sketch: null }
    event.preventDefault()
    return
  }
  drag = { kind: 'maybe-select', x: event.clientX, y: event.clientY }
}

const onPointerMove = (event) => {
  if (!pick.enabled) return
  updatePointer(event)

  if (pick.tool === 'line' && pick.selected && (!drag || drag.kind === 'maybe-point')) {
    const raw = hitPlane(pick.selected)
    if (!raw) return
    if (!poly) poly = { points: [], cursor: null, closing: false }
    const from = poly.points[poly.points.length - 1] || null
    poly.cursor = snapPoint(from, raw)
    poly.closing = poly.points.length > 2 && segmentLength(poly.points[0], poly.cursor) <= CLOSE_TOLERANCE
    drawPoly()
    reportPoly()
    return
  }

  if (drag?.kind === 'sketch') {
    const now = hitPlane(pick.selected)
    if (!now) return
    drag.sketch = sketchFromDrag(pick.tool, drag.start, now)
    setPreview(drag.sketch, pick.selected)
    return
  }

  // Hover feedback while nothing is being dragged.
  if (drag) return
  const hit = hitModel()
  const id = hit ? meshData?.planeIds[hit.faceIndex] : -1
  if (id !== pick.hoverId) {
    pick.hoverId = id
    if (pick.selected?.id !== id) setHighlight(id, false)
    else setHighlight(id, true)
    renderer.domElement.style.cursor = id >= 0 ? (pick.tool === 'select' ? 'pointer' : 'crosshair') : ''
  }
}

const onPointerUp = (event) => {
  if (!pick.enabled || !drag) return
  const current = drag
  drag = null

  if (current.kind === 'maybe-point') {
    const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y)
    if (moved > 4) return          // that was an orbit, not a click
    updatePointer(event)
    const raw = hitPlane(pick.selected)
    if (!raw) return
    const from = poly?.points[poly.points.length - 1] || null
    addPolyPoint(snapPoint(from, raw))
    return
  }

  if (current.kind === 'sketch') {
    controls.enabled = true
    setPreview(null)
    if (current.sketch) pick.onSketch?.(current.sketch, pick.selected)
    return
  }

  // A real orbit drag must not count as a click.
  const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y)
  if (moved > 4) return
  updatePointer(event)
  const hit = hitModel()
  const id = hit ? meshData.planeIds[hit.faceIndex] : -1
  selectFace(id >= 0 ? id : null)
}

export const selectFace = (planeId) => {
  poly = null
  drawPoly()
  pick.selected = planeId == null ? null : facePlane(planeId)
  setHighlight(pick.selected ? pick.selected.id : null, true)
  pick.onSelect?.(pick.selected)
}

/** Switches picking on and wires the callbacks the store listens to. */
export const enablePicking = ({ onSelect, onSketch, onPoly }) => {
  pick.enabled = true
  pick.onSelect = onSelect
  pick.onSketch = onSketch
  pick.onPoly = onPoly
  const el = renderer.domElement
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointerleave', () => { if (!drag) { pick.hoverId = -1; if (!pick.selected) setHighlight(null) } })
}

export const setTool = (tool) => {
  pick.tool = tool
  cancelPoly()
  if (pick.selected) setHighlight(pick.selected.id, true)
}

export const setOverlayVisible = (visible) => {
  if (overlay) overlay.visible = visible
  dirty = true
}

/** Draws a committed or pending sketch outline without a drag going on. */
export const showSketch = (sketch, plane) => setPreview(sketch, plane)

export const setShading = (shading) => {
  if (!mesh) return
  mesh.material.dispose()
  mesh.material = makeMaterial(shading)
  dirty = true
}

export const setVisibility = ({ showGrid, showBuildVolume, showWireframe, showAxes }) => {
  if (grid) grid.visible = showGrid
  if (plate) plate.visible = showBuildVolume
  if (volumeBox) volumeBox.visible = showBuildVolume
  if (axes) axes.visible = showAxes
  if (wireframe) wireframe.visible = showWireframe
  dirty = true
}

/** Frames the model, or the plate when there is nothing to show. */
export const frameModel = (stats) => {
  if (!camera || !controls) return
  const size = stats?.size?.some((n) => n > 0) ? stats.size : [200, 200, 200]
  const radius = Math.hypot(...size) / 2
  const distance = (radius / Math.sin((perspCamera.fov * Math.PI) / 360)) * 1.35
  const center = new THREE.Vector3(0, 0, size[2] / 2)

  const direction = new THREE.Vector3(0.75, -1, 0.72).normalize()
  camera.position.copy(center).addScaledVector(direction, distance)
  controls.target.copy(center)
  controls.update()
  dirty = true
}

/** Camera position and target, for debugging and tests. */
export const cameraState = () => (camera && controls
  ? { position: camera.position.toArray(), target: controls.target.toArray() }
  : null)

export const setView = (name) => {
  if (!camera || !controls) return
  const target = controls.target.clone()
  const distance = camera.position.distanceTo(target)
  const vectors = {
    front: [0, -1, 0],
    back: [0, 1, 0],
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 0, 1],
    bottom: [0, 0, -1],
    iso: [0.75, -1, 0.72]
  }
  const dir = new THREE.Vector3(...(vectors[name] || vectors.iso)).normalize()
  camera.position.copy(target).addScaledVector(dir, distance)
  controls.update()
  dirty = true
}

/** Renders the current view to a PNG data URL for a quick thumbnail. */
export const snapshot = () => {
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}

export const destroyScene = () => {
  cancelAnimationFrame(frameHandle)
  controls?.removeEventListener('change', requestRender)
  resizeObserver?.disconnect()
  controls?.dispose()
  renderer?.dispose()
}
