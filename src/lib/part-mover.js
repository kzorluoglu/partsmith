/**
 * Selecting and moving parts right in the viewport, the Fusion 360 way:
 * left click a part to select it, drag one of the axis arrows growing out of
 * its centre to slide it along X, Y or Z, click empty space to let go.
 *
 * Only active while no sketch or measure tool is running. Plain module state
 * like sketcher.js, the store only carries what the HUD shows.
 */
import * as S from './scene.js'
import parts from '../stores/parts-store.js'
import sketch from '../stores/sketch-store.js'
import { on } from './bus.js'

const CLICK_SLOP = 4     // px; a pointer that moved further was orbiting, not clicking
const STEP = 0.5         // mm; drags snap to this, hold Shift to move freely
const AXIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
const INDEX = { x: 0, y: 1, z: 2 }

let down = null
let drag = null          // { axis, origin, start, offset }
let hover = null

const idle = () => !sketch.tool

export const init = () => {
  S.addPointerListeners({ down: onDown, move: onMove, up: onUp, leave: onLeave })
  document.addEventListener('keydown', onKey)
  S.onCameraChange(() => { if (parts.selected >= 0) S.refreshGizmo() })
  // The scene drops its parts on every build, the store decides what survives.
  on('geometry', () => S.selectPart(parts.selected))
  parts.observe('selected', () => S.selectPart(parts.selected))
}

/** Parameter along the drag axis closest to the pointer ray, or null when parallel. */
const axisParam = (e, origin, n) => {
  const { origin: r0, dir: r } = S.pointerRay(e)
  const w0 = [origin[0] - r0[0], origin[1] - r0[1], origin[2] - r0[2]]
  const b = n[0] * r[0] + n[1] * r[1] + n[2] * r[2]
  const d = n[0] * w0[0] + n[1] * w0[1] + n[2] * w0[2]
  const ee = r[0] * w0[0] + r[1] * w0[1] + r[2] * w0[2]
  const denom = 1 - b * b
  // Looking straight down the axis there is nothing sensible to follow.
  if (denom < 0.03) return null
  return (b * ee - d) / denom
}

function onDown(e) {
  if (!idle() || e.button !== 0) return
  down = { x: e.clientX, y: e.clientY }
  const axis = S.gizmoAxisAt(e)
  if (!axis) return
  const origin = S.partCenter(parts.selected)
  const start = axisParam(e, origin, AXIS[axis])
  if (start == null) return
  drag = { axis, origin, start, offset: [...parts.items[parts.selected].offset] }
  S.setControlsEnabled(false)
  e.preventDefault()
}

function onMove(e) {
  if (!idle()) return
  if (drag) {
    const s = axisParam(e, drag.origin, AXIS[drag.axis])
    if (s == null) return
    let delta = s - drag.start
    if (!e.shiftKey) delta = Math.round(delta / STEP) * STEP
    const offset = [...drag.offset]
    offset[INDEX[drag.axis]] += delta
    parts.setOffset(parts.selected, offset)
    const total = offset[INDEX[drag.axis]]
    parts.moving = `${drag.axis.toUpperCase()} ${total >= 0 ? '+' : ''}${total.toFixed(1)} mm`
    return
  }
  if (e.buttons) return
  const axis = S.gizmoAxisAt(e)
  if (axis !== hover) {
    hover = axis
    S.hoverGizmo(axis)
  }
  S.setCursor(axis ? 'grab' : '')
}

function onUp(e) {
  if (!idle()) return
  if (drag) {
    drag = null
    parts.moving = ''
    S.setControlsEnabled(true)
    return
  }
  const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_SLOP
  down = null
  if (!click || parts.count < 2) return    // that was an orbit
  parts.select(S.pickPart(e))
}

function onLeave() {
  if (hover) { hover = null; S.hoverGizmo(null) }
}

function onKey(e) {
  if (!idle() || parts.selected < 0) return
  const t = e.target
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.closest?.('.cm-editor')) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key === 'Escape') { parts.select(-1); return }
  if (e.key === 'h' || e.key === 'H') parts.setVisible(parts.selected, false)
}
