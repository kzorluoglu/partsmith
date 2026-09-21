/**
 * The three.js side of the app. Kept as a plain module rather than component
 * state so none of it ever passes through Gea's reactive proxy.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Canvas2DRenderer } from './canvas2d-renderer.js'

let renderer, scene, camera, controls
let modelGroup, meshMaterial, mesh, wireframe
let plate, grid, volumeBox, axes
let frameHandle = 0
let resizeObserver
let software = false
let dirty = true

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
    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    gl.setPixelRatio(Math.min(devicePixelRatio, 2))
    gl.shadowMap.enabled = true
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    software = false
    return gl
  } catch {
    const cpu = new Canvas2DRenderer(canvas)
    cpu.setPixelRatio(devicePixelRatio)
    software = true
    return cpu
  }
}

const makeMaterial = (shading) => {
  if (shading === 'normal') return new THREE.MeshNormalMaterial({ flatShading: true })
  if (shading === 'clay') {
    return new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95, metalness: 0, flatShading: false })
  }
  return new THREE.MeshStandardMaterial({
    color: 0xf5a524,
    roughness: 0.42,
    metalness: 0.12,
    envMapIntensity: 0.6
  })
}

/** Builds the renderer, camera, lights and the static build plate furniture. */
export const initScene = (canvas) => {
  renderer = createRenderer(canvas)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x14161c)
  scene.fog = new THREE.Fog(0x14161c, 600, 1600)

  camera = new THREE.PerspectiveCamera(42, 1, 1, 4000)
  camera.up.set(0, 0, 1)
  camera.position.set(180, -220, 160)

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.98
  controls.target.set(0, 0, 30)

  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(120, -160, 240)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 10
  key.shadow.camera.far = 900
  const span = 260
  Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span })
  key.shadow.bias = -0.0008
  scene.add(key)

  scene.add(new THREE.DirectionalLight(0x90a8ff, 0.5).translateX(-200))
  scene.add(new THREE.HemisphereLight(0xaac4ff, 0x20232c, 1.1))

  modelGroup = new THREE.Group()
  scene.add(modelGroup)

  buildPlate([256, 256, 256])

  // Redrawing thousands of triangles on the CPU every frame would peg a core
  // for nothing, so the software path only draws when the scene changed.
  controls.addEventListener('change', requestRender)

  const animate = () => {
    frameHandle = requestAnimationFrame(animate)
    const moving = controls.update()
    if (!software || dirty || moving) {
      renderer.render(scene, camera)
      dirty = false
    }
  }
  animate()

  resizeObserver = new ResizeObserver(() => resize(canvas))
  resizeObserver.observe(canvas.parentElement || canvas)
  resize(canvas)
}

const resize = (canvas) => {
  const host = canvas.parentElement || canvas
  const width = host.clientWidth || 1
  const height = host.clientHeight || 1
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  dirty = true
}

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

  plate = new THREE.Mesh(
    new THREE.PlaneGeometry(x, y),
    new THREE.MeshStandardMaterial({ color: 0x1b1f28, roughness: 1, metalness: 0 })
  )
  plate.receiveShadow = true
  plate.position.z = -0.05
  scene.add(plate)

  grid = new THREE.GridHelper(Math.max(x, y), Math.round(Math.max(x, y) / 10), 0x3d4557, 0x262c38)
  grid.rotation.x = Math.PI / 2
  grid.position.z = 0
  scene.add(grid)

  const cage = new THREE.BoxGeometry(x, y, z)
  volumeBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(cage),
    new THREE.LineBasicMaterial({ color: 0x46506a, transparent: true, opacity: 0.55 })
  )
  volumeBox.position.z = z / 2
  cage.dispose()
  scene.add(volumeBox)

  axes = new THREE.AxesHelper(Math.min(x, y) * 0.22)
  axes.position.set(-x / 2, -y / 2, 0.1)
  scene.add(axes)
  dirty = true
}

/** Replaces the displayed mesh with new triangle soup from the worker. */
export const setGeometry = (payload, { shading = 'matcap', showWireframe = false } = {}) => {
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

  meshMaterial = makeMaterial(shading)
  mesh = new THREE.Mesh(geometry, meshMaterial)
  mesh.castShadow = true
  mesh.receiveShadow = true
  modelGroup.add(mesh)

  const edges = new THREE.EdgesGeometry(geometry, 24)
  wireframe = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x11141b, transparent: true, opacity: 0.55 })
  )
  wireframe.visible = showWireframe
  modelGroup.add(wireframe)
}

export const setShading = (shading) => {
  if (!mesh) return
  mesh.material.dispose()
  mesh.material = makeMaterial(shading)
  dirty = true
}

export const setVisibility = ({ showGrid, showBuildVolume, showWireframe, showAxes }) => {
  if (grid) grid.visible = showGrid
  if (plate) plate.visible = showGrid
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
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.35
  const center = new THREE.Vector3(0, 0, size[2] / 2)

  const direction = new THREE.Vector3(0.75, -1, 0.72).normalize()
  camera.position.copy(center).addScaledVector(direction, distance)
  controls.target.copy(center)
  controls.update()
  dirty = true
}

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
