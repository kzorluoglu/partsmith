/**
 * The three.js side of the app. Kept as a plain module rather than component
 * state so none of it ever passes through Gea's reactive proxy.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Canvas2DRenderer } from './canvas2d-renderer.js'
import { planeBasis, toPlane } from './features.js'

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
  applySection()   // drops the cap, it shares the geometry just disposed
  dirty = true
  if (!payload) return

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3))
  geometry.computeBoundingSphere()

  meshData = { positions: payload.positions, planeIds: payload.planeIds, planes: payload.planes, edges: payload.edgePositions, snaps: null }
  // Face ids from the previous build mean nothing now.
  highlightFace(null, 'hover')
  highlightFace(null, 'active')

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
  applySection()
}

/* ---- interaction primitives -----------------------------------------
   The sketch, extrude and measure tools live in sketcher.js. This module only
   offers what needs three.js: rays, face lookup, overlay drawing and screen
   projection, so the tool logic stays readable on its own. */

let hoverFaceMesh = null
let activeFaceMesh = null
const overlayParts = new Map()

const facePlane = (planeId) => {
  const plane = meshData?.planes?.[planeId]
  if (!plane) return null
  return { id: planeId, ...planeBasis(plane.normal, plane.centroid), area: plane.area }
}

/** The build plate as a sketch plane: world X and Y, normal up. */
export const groundPlane = () => ({ id: -1, origin: [0, 0, 0], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], area: Infinity })

const faceMesh = (planeId, color, opacity) => {
  if (planeId == null || planeId < 0 || !meshData) return null
  const { positions, planeIds } = meshData
  const picked = []
  for (let t = 0; t < planeIds.length; t++) {
    if (planeIds[t] !== planeId) continue
    for (let k = 0; k < 9; k++) picked.push(positions[t * 9 + k])
  }
  if (picked.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(picked, 3))
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, toneMapped: false, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide
  }))
}

/** 'hover' is the faint pre-selection, 'active' the face being sketched on. */
export const highlightFace = (planeId, mode) => {
  if (mode === 'hover') {
    if (hoverFaceMesh?.userData.planeId === planeId) return
    disposeObject(hoverFaceMesh)
    hoverFaceMesh = faceMesh(planeId, 0xffffff, 0.14)
    if (hoverFaceMesh) { hoverFaceMesh.userData.planeId = planeId; overlay.add(hoverFaceMesh) }
  } else {
    if (activeFaceMesh?.userData.planeId === planeId) return
    disposeObject(activeFaceMesh)
    activeFaceMesh = faceMesh(planeId, 0x3b82f6, 0.32)
    if (activeFaceMesh) { activeFaceMesh.userData.planeId = planeId; overlay.add(activeFaceMesh) }
  }
  dirty = true
}

/** Named overlay slots: setting a name replaces whatever was there. */
export const setOverlay = (name, object) => {
  disposeTree(overlayParts.get(name))
  overlayParts.delete(name)
  if (object) {
    overlayParts.set(name, object)
    overlay.add(object)
  }
  dirty = true
}

export const clearOverlay = () => {
  for (const name of [...overlayParts.keys()]) setOverlay(name, null)
  highlightFace(null, 'hover')
  highlightFace(null, 'active')
}

const disposeTree = (object) => {
  if (!object) return
  object.traverse((o) => {
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else o.material?.dispose()
  })
  object.parent?.remove(object)
}

const updatePointer = (event) => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  return raycaster
}

/** Model surface under the pointer, with the planar face it belongs to. */
export const pickModel = (event) => {
  if (!mesh) return null
  updatePointer(event)
  const hit = raycaster.intersectObject(mesh, false)[0]
  if (!hit) return null
  const planeId = meshData.planeIds[hit.faceIndex]
  const p = meshData.positions
  const t = hit.faceIndex * 9
  return {
    point: hit.point.toArray(),
    planeId,
    plane: facePlane(planeId),
    triangle: [[p[t], p[t + 1], p[t + 2]], [p[t + 3], p[t + 4], p[t + 5]], [p[t + 6], p[t + 7], p[t + 8]]]
  }
}

/**
 * Corners and edge midpoints of the real feature edges, built once per model.
 * Measuring snaps to these, so it hits a corner even where the ray itself
 * would slip past the silhouette.
 */
export const snapPoints = () => {
  if (!meshData?.edges) return []
  if (meshData.snaps) return meshData.snaps
  const e = meshData.edges
  const seen = new Set()
  const out = []
  const add = (x, y, z, kind) => {
    const k = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ point: [x, y, z], kind })
  }
  for (let i = 0; i < e.length; i += 6) {
    add(e[i], e[i + 1], e[i + 2], 'corner')
    add(e[i + 3], e[i + 4], e[i + 5], 'corner')
    add((e[i] + e[i + 3]) / 2, (e[i + 1] + e[i + 4]) / 2, (e[i + 2] + e[i + 5]) / 2, 'mid')
  }
  meshData.snaps = out
  return out
}

export const cameraPosition = () => camera.position.toArray()

/** Where the pointer ray meets a sketch plane, in that plane's (u, v). */
export const pointOnPlane = (event, plane) => {
  updatePointer(event)
  const p = new THREE.Plane().setFromNormalAndCoplanarPoint(
    new THREE.Vector3(...plane.normal), new THREE.Vector3(...plane.origin)
  )
  const hit = raycaster.ray.intersectPlane(p, new THREE.Vector3())
  return hit ? toPlane(plane, hit.toArray()) : null
}

/** The pointer ray itself, for the extrude drag. */
export const pointerRay = (event) => {
  updatePointer(event)
  return { origin: raycaster.ray.origin.toArray(), dir: raycaster.ray.direction.toArray() }
}

/** World point to canvas pixels. */
export const toScreen = (world) => {
  const v = new THREE.Vector3(...world).project(camera)
  const el = renderer.domElement
  return {
    x: (v.x * 0.5 + 0.5) * el.clientWidth,
    y: (-v.y * 0.5 + 0.5) * el.clientHeight,
    visible: v.z > -1 && v.z < 1
  }
}

/** Roughly how many millimetres one screen pixel covers at a world point. */
export const mmPerPixel = (world) => {
  const el = renderer.domElement
  if (orthographic) return (orthoCamera.top - orthoCamera.bottom) / (el.clientHeight || 1)
  const distance = camera.position.distanceTo(new THREE.Vector3(...world))
  return (2 * distance * Math.tan((perspCamera.fov * Math.PI) / 360)) / (el.clientHeight || 1)
}

export const setControlsEnabled = (enabled) => { if (controls) controls.enabled = enabled }

export const canvasElement = () => renderer?.domElement

/** Pointer events on the canvas, for the tool controller. Returns an unsubscribe. */
export const addPointerListeners = ({ down, move, up, leave }) => {
  const el = renderer.domElement
  if (down) el.addEventListener('pointerdown', down)
  if (move) el.addEventListener('pointermove', move)
  if (up) el.addEventListener('pointerup', up)
  if (leave) el.addEventListener('pointerleave', leave)
  return () => {
    if (down) el.removeEventListener('pointerdown', down)
    if (move) el.removeEventListener('pointermove', move)
    if (up) el.removeEventListener('pointerup', up)
    if (leave) el.removeEventListener('pointerleave', leave)
  }
}

export const setCursor = (cursor) => { if (renderer) renderer.domElement.style.cursor = cursor || '' }

/* ---- overlay builders ------------------------------------------------- */

const SKETCH_BLUE = 0x6ea8ff

export const makePolyline = (points, { color = SKETCH_BLUE, closed = false, opacity = 1 } = {}) => {
  const pts = points.map((p) => new THREE.Vector3(...p))
  if (closed && pts.length > 2) pts.push(pts[0].clone())
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, depthTest: false, toneMapped: false, transparent: opacity < 1, opacity })
  )
  line.renderOrder = 20
  return line
}

export const makeDots = (points, { color = 0xffffff, size = 8 } = {}) => {
  const dots = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))),
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, toneMapped: false })
  )
  dots.renderOrder = 21
  return dots
}

/** 2D outline in plane coordinates to a THREE.Shape. */
const shapeFrom = (outline) => {
  const shape = new THREE.Shape()
  outline.forEach(([u, v], i) => (i === 0 ? shape.moveTo(u, v) : shape.lineTo(u, v)))
  shape.closePath()
  return shape
}

const planeMatrix = (plane) => new THREE.Matrix4().set(
  plane.u[0], plane.v[0], plane.normal[0], plane.origin[0],
  plane.u[1], plane.v[1], plane.normal[1], plane.origin[1],
  plane.u[2], plane.v[2], plane.normal[2], plane.origin[2],
  0, 0, 0, 1
)

/** Filled translucent profile lying on its plane. */
export const makeRegion = (outline, plane, { color = 0x3b82f6, opacity = 0.28 } = {}) => {
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shapeFrom(outline)),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
  )
  mesh.applyMatrix4(planeMatrix(plane))
  mesh.translateZ(0.06)
  mesh.renderOrder = 15
  return mesh
}

/** Live extrusion preview: positive depth grows along the normal, negative cuts in. */
export const makeExtrudePreview = (outline, plane, depth, { color } = {}) => {
  const group = new THREE.Group()
  if (Math.abs(depth) < 1e-6) return group
  const geometry = new THREE.ExtrudeGeometry(shapeFrom(outline), { depth: Math.abs(depth), bevelEnabled: false, curveSegments: 48 })
  if (depth < 0) geometry.translate(0, 0, depth)
  const tint = color ?? (depth > 0 ? 0x3b82f6 : 0xf0524d)
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, side: THREE.DoubleSide
  }))
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 30),
    new THREE.LineBasicMaterial({ color: tint, toneMapped: false, depthTest: false, transparent: true, opacity: 0.9 })
  )
  body.renderOrder = 16
  edges.renderOrder = 22
  group.add(body, edges)
  group.applyMatrix4(planeMatrix(plane))
  return group
}

/**
 * Drag handle for the extrusion: shaft plus cone along the normal, and a fat
 * invisible cylinder so it is easy to grab. Sized in screen pixels so it looks
 * the same at any zoom.
 */
export const makeArrow = (origin, normal, { color = 0x3b82f6 } = {}) => {
  const scale = mmPerPixel(origin)
  const len = 64 * scale
  const group = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false })
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4 * scale, 1.4 * scale, len * 0.72, 12), mat)
  shaft.position.y = len * 0.36
  const cone = new THREE.Mesh(new THREE.ConeGeometry(6 * scale, len * 0.3, 20), mat)
  cone.position.y = len * 0.86
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(9 * scale, 9 * scale, len * 1.05, 10),
    new THREE.MeshBasicMaterial({ visible: false })
  )
  grip.position.y = len * 0.5
  grip.name = 'grip'
  shaft.renderOrder = cone.renderOrder = 25
  group.add(shaft, cone, grip)
  // Cylinders point along +Y, rotate that onto the normal.
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...normal))
  group.position.set(...origin)
  group.userData.tip = [origin[0] + normal[0] * len, origin[1] + normal[1] * len, origin[2] + normal[2] * len]
  return group
}

export const hitsObject = (event, object) => {
  if (!object) return false
  updatePointer(event)
  return raycaster.intersectObject(object, true).length > 0
}

/* ---- section view ------------------------------------------------------ */

const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)
let sectionState = { enabled: false, axis: 'z', position: 0 }
let sectionCap = null

const AXIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }

/** Applies the clip to whatever materials the model currently has. */
const applySection = () => {
  if (!renderer || software) return
  const planes = sectionState.enabled ? [sectionPlane] : []
  renderer.localClippingEnabled = sectionState.enabled
  if (mesh) { mesh.material.clippingPlanes = planes; mesh.material.needsUpdate = true }
  if (wireframe) { wireframe.material.clippingPlanes = planes; wireframe.material.needsUpdate = true }
  if (sectionCap) { sectionCap.material.dispose(); sectionCap.parent?.remove(sectionCap) }
  sectionCap = null
  if (sectionState.enabled && mesh) {
    // The inside of a solid is its back faces. Drawn flat in a cut colour
    // they read as a solid section surface without computing a real cap.
    sectionCap = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
      color: 0x6f7fa3, side: THREE.BackSide, clippingPlanes: planes, toneMapped: false
    }))
    modelGroup.add(sectionCap)
  }
  dirty = true
}

/** Keeps everything on the low side of `position` along `axis`. */
export const setSection = ({ enabled, axis = 'z', position = 0 }) => {
  sectionState = { enabled, axis, position }
  const n = AXIS[axis] || AXIS.z
  sectionPlane.set(new THREE.Vector3(-n[0], -n[1], -n[2]), position)
  applySection()
}

export const setOverlayVisible = (visible) => {
  if (overlay) overlay.visible = visible
  dirty = true
}

export const setShading = (shading) => {
  if (!mesh) return
  mesh.material.dispose()
  mesh.material = makeMaterial(shading)
  applySection()
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
