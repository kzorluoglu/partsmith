import { Component } from '@geajs/core'
import { onCameraChange, setView } from '../lib/scene.js'

const SIZE = 58
const HALF = SIZE / 2

/**
 * Each face as (r, d, n) in world space, Z up: the direction text runs, the
 * direction "down" on the face, and the outward normal. With those the face
 * matrix is just [r d n | n*HALF], and the cube container carries the camera
 * rotation, so no CSS rotateX/Y guesswork is involved. Chosen so every label
 * reads upright when its face is viewed from outside.
 */
const FACES = [
  { id: 'front', label: 'FRONT', r: [1, 0, 0], d: [0, 0, -1], n: [0, -1, 0] },
  { id: 'back', label: 'BACK', r: [-1, 0, 0], d: [0, 0, -1], n: [0, 1, 0] },
  { id: 'right', label: 'RIGHT', r: [0, 1, 0], d: [0, 0, -1], n: [1, 0, 0] },
  { id: 'left', label: 'LEFT', r: [0, -1, 0], d: [0, 0, -1], n: [-1, 0, 0] },
  { id: 'top', label: 'TOP', r: [1, 0, 0], d: [0, -1, 0], n: [0, 0, 1] },
  { id: 'bottom', label: 'BOTTOM', r: [1, 0, 0], d: [0, 1, 0], n: [0, 0, -1] }
]

const faceMatrix = ({ r, d, n }) =>
  `matrix3d(${r[0]},${r[1]},${r[2]},0,${d[0]},${d[1]},${d[2]},0,${n[0]},${n[1]},${n[2]},0,${n[0] * HALF},${n[1] * HALF},${n[2] * HALF},1)`

/** Navigation cube: shows the camera orientation, a face click snaps the view. */
export default class ViewCube extends Component {
  cubeEl = null

  template() {
    return (
      <div class="viewcube" title="Click a face to look at it">
        <div class="viewcube-stage">
          <div ref={this.cubeEl} class="viewcube-cube">
            {FACES.map((f) => (
              <button key={f.id} class={`vc-face vc-${f.id}`} data-face={f.id} click={() => setView(f.id)}>{f.label}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  onAfterRender() {
    let latest = null

    // Container = flip(Y) * view rotation. The view matrix maps world into
    // camera space (y up), CSS space has y down, hence the flip.
    const apply = () => {
      const el = this.cubeEl
      if (!el) return
      // Face transforms are static; set them on whichever node is live.
      if (!el.dataset.faces) {
        for (const f of FACES) {
          const face = el.querySelector(`[data-face="${f.id}"]`)
          if (face) face.style.transform = faceMatrix(f)
        }
        el.dataset.faces = '1'
      }
      const e = latest
      if (!e) return
      el.style.transform =
        `matrix3d(${e[0]},${-e[1]},${e[2]},0,${e[4]},${-e[5]},${e[6]},0,${e[8]},${-e[9]},${e[10]},0,0,0,0,1)`
    }

    this.off = onCameraChange((e) => {
      latest = Array.from(e)
      apply()
    })
    // Harmless safety net: re-apply once the page has settled.
    requestAnimationFrame(apply)
    setTimeout(apply, 250)
  }

  dispose() {
    this.off?.()
    super.dispose()
  }
}
