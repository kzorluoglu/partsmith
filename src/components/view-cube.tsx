import { Component } from '@geajs/core'
import { onCameraChange, setViewDirection, orbitBy } from '../lib/scene.js'

const SIZE = 58
const HALF = SIZE / 2
/** Outer share of a face that counts as its edge or corner, in -1..1 face units. */
const BAND = 0.5
const DRAG_PX = 3

/**
 * Each face as (r, d, n) in world space, Z up: the direction text runs, the
 * direction "down" on the face, and the outward normal. With those the face
 * matrix is just [r d n | n*HALF], and the cube container carries the camera
 * rotation. Chosen so every label reads upright seen from outside.
 */
const FACES = [
  { id: 'front', label: 'FRONT', r: [1, 0, 0], d: [0, 0, -1], n: [0, -1, 0] },
  { id: 'back', label: 'BACK', r: [-1, 0, 0], d: [0, 0, -1], n: [0, 1, 0] },
  { id: 'right', label: 'RIGHT', r: [0, 1, 0], d: [0, 0, -1], n: [1, 0, 0] },
  { id: 'left', label: 'LEFT', r: [0, -1, 0], d: [0, 0, -1], n: [-1, 0, 0] },
  { id: 'top', label: 'TOP', r: [1, 0, 0], d: [0, -1, 0], n: [0, 0, 1] },
  { id: 'bottom', label: 'BOTTOM', r: [1, 0, 0], d: [0, 1, 0], n: [0, 0, -1] }
]
const BY_ID = Object.fromEntries(FACES.map((f) => [f.id, f]))

const faceMatrix = ({ r, d, n }) =>
  `matrix3d(${r[0]},${r[1]},${r[2]},0,${d[0]},${d[1]},${d[2]},0,${n[0]},${n[1]},${n[2]},0,${n[0] * HALF},${n[1] * HALF},${n[2] * HALF},1)`

/**
 * Where on a face the pointer is, as the view it stands for. The middle is
 * the face view, the outer band towards a neighbour adds that neighbour's
 * normal (an edge view), and a corner adds both (a corner view): 6 faces,
 * 12 edges, 8 corners, the 26 views of a Fusion style view cube.
 */
const regionAt = (face, px, py) => {
  const u = (px - HALF) / HALF          // -1 left .. 1 right, in face units
  const w = (py - HALF) / HALF          // -1 top .. 1 bottom
  const su = Math.abs(u) > BAND ? Math.sign(u) : 0
  const sw = Math.abs(w) > BAND ? Math.sign(w) : 0
  const dir = [0, 1, 2].map((i) => face.n[i] + su * face.r[i] + sw * face.d[i])
  return { su, sw, dir }
}

/** Navigation cube: follows the camera, drag to orbit, click a region to fly there. */
export default class ViewCube extends Component {
  stageEl = null
  cubeEl = null
  view = null

  template() {
    return (
      <div class="viewcube">
        <div ref={this.stageEl} class="viewcube-stage" title="Drag to orbit, click a face, edge or corner">
          <div ref={this.cubeEl} class="viewcube-cube">
            {FACES.map((f) => (
              <button key={f.id} class={`vc-face vc-${f.id}`} data-face={f.id} aria-label={`${f.label} view`}>
                <span class="vc-label">{f.label}</span>
                <span class="vc-hot"></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  onAfterRender() {
    const cube = this.cubeEl
    for (const f of FACES) {
      const el = cube.querySelector(`[data-face="${f.id}"]`)
      if (el) el.style.transform = faceMatrix(f)
    }

    // Container = flip(Y) * view rotation. The view matrix maps world into
    // camera space (y up), CSS space has y down, hence the flip.
    const apply = () => {
      const e = this.view
      if (!e) return
      cube.style.transform =
        `matrix3d(${e[0]},${-e[1]},${e[2]},0,${e[4]},${-e[5]},${e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`
    }
    this.offCamera = onCameraChange((e) => {
      this.view = Array.from(e)
      apply()
    })
    requestAnimationFrame(apply)

    this.bindPointer(cube)
  }

  /**
   * Which face, and where on it, is under the pointer. Computed from the
   * cube's own rotation instead of trusting the browser's hit testing, which
   * is unreliable for 3D transformed elements seen straight on: the same
   * pixel sometimes lands on the face and sometimes on the stage behind it.
   *
   * The CSS projection is orthographic, so a screen point is a line along
   * CSS z. Rotated back into cube space (the container matrix is orthogonal,
   * its inverse is its transpose) it gets intersected with the six faces.
   */
  pick(e) {
    const m = this.view
    if (!m) return null
    const rect = this.stageEl.getBoundingClientRect()
    const x = e.clientX - (rect.left + rect.width / 2)
    const y = e.clientY - (rect.top + rect.height / 2)
    // Columns of the container matrix, see apply(): flip(Y) * view rotation.
    const c0 = [m[0], -m[1], m[2]]
    const c1 = [m[4], -m[5], m[6]]
    const c2 = [m[8], -m[9], m[10]]
    const back = (v) => [
      c0[0] * v[0] + c0[1] * v[1] + c0[2] * v[2],
      c1[0] * v[0] + c1[1] * v[1] + c1[2] * v[2],
      c2[0] * v[0] + c2[1] * v[1] + c2[2] * v[2]
    ]
    const origin = back([x, y, 0])
    const towardViewer = back([0, 0, 1])
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    let best = null
    for (const face of FACES) {
      const facing = dot(face.n, towardViewer)
      if (facing <= 1e-6) continue
      const t = (HALF - dot(face.n, origin)) / facing
      const p = [0, 1, 2].map((i) => origin[i] + t * towardViewer[i])
      const a = dot(p, face.r)
      const b = dot(p, face.d)
      if (Math.abs(a) > HALF + 0.5 || Math.abs(b) > HALF + 0.5) continue
      if (!best || t > best.t) best = { face, t, px: a + HALF, py: b + HALF }
    }
    return best
  }

  /** Drag to orbit, hover to preview a region, click to fly to it. */
  bindPointer(cube) {
    const stage = this.stageEl
    let press = null

    const showRegion = (hit) => {
      for (const hot of cube.querySelectorAll('.vc-hot')) hot.classList.remove('on')
      if (!hit) return
      const faceEl = cube.querySelector(`[data-face="${hit.face.id}"]`)
      const hot = faceEl?.querySelector('.vc-hot')
      if (!hot) return
      const { su, sw } = regionAt(hit.face, hit.px, hit.py)
      // Middle, edge band or corner square, in face pixels.
      const band = SIZE * (1 - BAND) / 2
      const x = su === 0 ? band : su < 0 ? 0 : SIZE - band
      const y = sw === 0 ? band : sw < 0 ? 0 : SIZE - band
      const wd = su === 0 ? SIZE - 2 * band : band
      const ht = sw === 0 ? SIZE - 2 * band : band
      hot.style.cssText = `left:${x}px;top:${y}px;width:${wd}px;height:${ht}px`
      hot.classList.add('on')
    }

    stage.addEventListener('pointermove', (e) => {
      if (press) {
        const dx = e.clientX - press.lastX
        const dy = e.clientY - press.lastY
        if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) {
          press.dragging = true
          stage.classList.add('dragging')
          showRegion(null)
        }
        if (press.dragging) orbitBy(dx, dy)
        press.lastX = e.clientX
        press.lastY = e.clientY
        return
      }
      showRegion(this.pick(e))
    })

    stage.addEventListener('pointerleave', () => { if (!press) showRegion(null) })

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      stage.setPointerCapture(e.pointerId)
      const hit = this.pick(e)
      press = {
        x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false,
        region: hit ? regionAt(hit.face, hit.px, hit.py) : null
      }
    })

    const release = (e) => {
      if (!press) return
      const p = press
      press = null
      stage.classList.remove('dragging')
      if (stage.hasPointerCapture?.(e.pointerId)) stage.releasePointerCapture(e.pointerId)
      if (!p.dragging && p.region) setViewDirection(p.region.dir)
    }
    stage.addEventListener('pointerup', release)
    stage.addEventListener('pointercancel', release)

    // Keyboard: Enter or Space on a focused face takes its face view.
    cube.addEventListener('click', (e) => {
      if (e.detail !== 0) return
      const face = BY_ID[e.target?.closest?.('.vc-face')?.dataset.face]
      if (face) setViewDirection(face.n)
    })
  }

  dispose() {
    this.offCamera?.()
    super.dispose()
  }
}
