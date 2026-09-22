/**
 * Software renderer for machines where WebGL is unavailable, which on Chrome
 * usually means hardware acceleration is off or the GPU is blocklisted.
 *
 * It renders a three.js scene with plain Canvas2D: project the triangles,
 * sort them back to front and fill them flat shaded. Slower than WebGL by a
 * wide margin, but it needs no GPU at all and keeps the same scene, camera and
 * orbit controls the WebGL path uses.
 */
import { Matrix4, Vector3, Color } from 'three'

const viewProjection = new Matrix4()
const modelViewProjection = new Matrix4()
const modelView = new Matrix4()
const normalMatrix = new Matrix4()

const v = new Vector3()
const lightDir = new Vector3(0.4, -0.6, 0.7).normalize()
const baseColor = new Color()
const shaded = new Color()

/** Projects a point into screen space, returns null when it is behind the eye. */
const project = (x, y, z, matrix, width, height, out) => {
  out.set(x, y, z).applyMatrix4(matrix)
  // applyMatrix4 already divides by w, but a point behind the camera comes out
  // mirrored, so the view space depth decides whether we keep it.
  if (out.z < -1 || out.z > 1) return null
  out.x = (out.x * 0.5 + 0.5) * width
  out.y = (-out.y * 0.5 + 0.5) * height
  return out
}

const a = new Vector3()
const b = new Vector3()
const c = new Vector3()
const n = new Vector3()
const mid = new Vector3()

export class Canvas2DRenderer {
  constructor(canvas) {
    this.domElement = canvas
    this.ctx = canvas.getContext('2d')
    this.width = 1
    this.height = 1
    this.pixelRatio = 1
    this.software = true
  }

  setPixelRatio(ratio) {
    this.pixelRatio = Math.min(ratio, 1.5)
  }

  setSize(width, height) {
    this.width = width
    this.height = height
    this.domElement.width = Math.round(width * this.pixelRatio)
    this.domElement.height = Math.round(height * this.pixelRatio)
    this.domElement.style.width = `${width}px`
    this.domElement.style.height = `${height}px`
  }

  render(scene, camera) {
    const { ctx } = this
    const w = this.domElement.width
    const h = this.domElement.height

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (scene.background) {
      ctx.fillStyle = `#${scene.background.getHexString()}`
      ctx.fillRect(0, 0, w, h)
    } else {
      ctx.clearRect(0, 0, w, h)
    }

    camera.updateMatrixWorld()
    scene.updateMatrixWorld()
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

    const queue = []

    scene.traverse((object) => {
      if (!object.visible) return
      if (object.isMesh && !object.material?.isShaderMaterial) this.collectMesh(object, camera, w, h, queue)
      else if (object.isLineSegments || object.isLine) this.collectLines(object, camera, w, h, queue)
    })

    // Painter's algorithm: no depth buffer, so draw far things first.
    queue.sort((p, q) => q.depth - p.depth)

    for (const item of queue) {
      if (item.kind === 'tri') {
        ctx.beginPath()
        ctx.moveTo(item.x0, item.y0)
        ctx.lineTo(item.x1, item.y1)
        ctx.lineTo(item.x2, item.y2)
        ctx.closePath()
        ctx.fillStyle = item.color
        ctx.fill()
        // Hairline stroke in the same colour hides the seams that antialiased
        // fills leave between neighbouring triangles.
        ctx.strokeStyle = item.color
        ctx.lineWidth = 1
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(item.x0, item.y0)
        ctx.lineTo(item.x1, item.y1)
        ctx.strokeStyle = item.color
        ctx.globalAlpha = item.opacity
        ctx.lineWidth = item.width
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  }

  collectMesh(mesh, camera, w, h, queue) {
    const position = mesh.geometry?.attributes?.position
    if (!position) return
    const normal = mesh.geometry.attributes.normal
    const material = mesh.material
    const isNormalMaterial = Boolean(material?.isMeshNormalMaterial)

    if (material?.color) baseColor.copy(material.color)
    else baseColor.set(0xcccccc)

    modelView.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    modelViewProjection.multiplyMatrices(viewProjection, mesh.matrixWorld)
    normalMatrix.extractRotation(mesh.matrixWorld)

    // Our own meshes are non indexed, but three's helpers (the plate plane)
    // are, so resolve through the index buffer when there is one.
    const index = mesh.geometry.index
    const count = index ? index.count : position.count
    const at = index ? (i) => index.getX(i) : (i) => i

    for (let i = 0; i < count; i += 3) {
      const i0 = at(i)
      const i1 = at(i + 1)
      const i2 = at(i + 2)

      if (!project(position.getX(i0), position.getY(i0), position.getZ(i0), modelViewProjection, w, h, a)) continue
      if (!project(position.getX(i1), position.getY(i1), position.getZ(i1), modelViewProjection, w, h, b)) continue
      if (!project(position.getX(i2), position.getY(i2), position.getZ(i2), modelViewProjection, w, h, c)) continue

      // Screen space winding, negative area means we are looking at the back.
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
      if (area >= 0) continue

      if (normal) {
        n.set(normal.getX(i0), normal.getY(i0), normal.getZ(i0)).applyMatrix4(normalMatrix)
      } else {
        n.set(0, 0, 1)
      }

      if (isNormalMaterial) {
        shaded.setRGB(n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, n.z * 0.5 + 0.5)
      } else {
        // Lambert term plus a fixed ambient floor, enough to read the shape.
        const lambert = Math.max(0, n.dot(lightDir))
        const level = 0.32 + 0.68 * lambert
        shaded.copy(baseColor).multiplyScalar(level)
      }

      mid.set(
        (position.getX(i0) + position.getX(i1) + position.getX(i2)) / 3,
        (position.getY(i0) + position.getY(i1) + position.getY(i2)) / 3,
        (position.getZ(i0) + position.getZ(i1) + position.getZ(i2)) / 3
      ).applyMatrix4(modelView)

      queue.push({
        kind: 'tri',
        depth: mid.z,
        color: `#${shaded.getHexString()}`,
        x0: a.x, y0: a.y, x1: b.x, y1: b.y, x2: c.x, y2: c.y
      })
    }
  }

  collectLines(lines, camera, w, h, queue) {
    const position = lines.geometry?.attributes?.position
    if (!position) return
    const material = lines.material
    const colors = material?.vertexColors ? lines.geometry.attributes.color : null
    const color = material?.color ? `#${material.color.getHexString()}` : '#555'
    const opacity = material?.transparent ? (material.opacity ?? 1) : 1

    modelView.multiplyMatrices(camera.matrixWorldInverse, lines.matrixWorld)
    modelViewProjection.multiplyMatrices(viewProjection, lines.matrixWorld)

    // Segments come in pairs, a strip shares every vertex, a loop also closes.
    const strip = !lines.isLineSegments
    const step = strip ? 1 : 2
    const count = strip && lines.isLineLoop ? position.count : position.count - (strip ? 1 : 0)
    for (let i = 0; i < count; i += step) {
      const j = strip ? (i + 1) % position.count : i + 1
      if (!project(position.getX(i), position.getY(i), position.getZ(i), modelViewProjection, w, h, a)) continue
      if (!project(position.getX(j), position.getY(j), position.getZ(j), modelViewProjection, w, h, b)) continue

      v.set(
        (position.getX(i) + position.getX(j)) / 2,
        (position.getY(i) + position.getY(j)) / 2,
        (position.getZ(i) + position.getZ(j)) / 2
      ).applyMatrix4(modelView)

      queue.push({
        kind: 'line',
        depth: v.z,
        color: colors
          ? `rgb(${Math.round(colors.getX(i) * 255)},${Math.round(colors.getY(i) * 255)},${Math.round(colors.getZ(i) * 255)})`
          : color,
        opacity,
        width: this.pixelRatio,
        x0: a.x, y0: a.y, x1: b.x, y1: b.y
      })
    }
  }

  dispose() {}
}
