/**
 * Sketch, extrude and measure tools, the Shapr3D way:
 *
 *   pick a tool → click a face or the grid (that locks the sketch plane) →
 *   click or type the dimensions → the closed profile gets an arrow → drag it
 *   or type a distance → Enter. Positive grows material, negative cuts.
 *
 * Dimensions are pills drawn right next to the geometry. Typing digits goes
 * straight into the active pill, no text box to click first; Tab moves to the
 * next one, and a typed value locks that dimension (the lock icon) while the
 * mouse keeps driving the others.
 *
 * Plain module state, no framework. It reports what the HUD needs into the
 * sketch store and draws its pills as ordinary DOM, which keeps 60 fps pointer
 * updates away from the reactive templates.
 */
import * as S from './scene.js'
import store from '../stores/sketch-store.js'
import model from '../stores/model-store.js'
import parts from '../stores/parts-store.js'
import { on } from './bus.js'
import {
  snap, snapPoint, segmentLength, segmentAngle, pointAt, fromPlane,
  sketchOutline, regularPolygon, ellipsePoints, outlineCentroid
} from './features.js'

const CLICK_SLOP = 4     // px; a pointer that moved further was orbiting, not clicking
const CLOSE_PX = 14      // px; landing this close to the first point closes a profile
const SNAP_PX = 14       // px; measure snaps to corners and edge midpoints within this

let layer = null
const pills = new Map()
let st = blank()

function blank() {
  return {
    phase: 'idle',        // idle | draw | extrude
    plane: null,          // locked sketch plane
    pts: [],              // placed points in plane coordinates
    cursor: null,         // live point in plane coordinates
    closing: false,
    fields: [],           // dimensions of the shape being drawn
    active: 0,
    buffer: '',           // digits typed into the active dimension
    profile: null,        // { sketch, outline, plane } once closed
    depth: 0,
    arrow: null,
    drag: null,
    down: null,
    measure: { a: null, b: null, hover: null }
  }
}

/* ---- setup and public API -------------------------------------------- */

export const init = (layerEl) => {
  layer = layerEl
  S.addPointerListeners({ down: onDown, move: onMove, up: onUp, leave: onLeave })
  document.addEventListener('keydown', onKey)
  S.onCameraChange(() => {
    // The arrow is sized in pixels, so it follows the zoom.
    if (st.phase === 'extrude') drawExtrude()
    renderPills()
  })
  // A rebuild invalidates face ids, and a finished feature shows up as geometry.
  on('geometry', () => { if (st.phase === 'idle') S.highlightFace(null, 'hover') })
}

export const setTool = (tool) => {
  reset()
  // Sketching and measuring work in model coordinates, so an exploded view
  // goes back together first.
  if (tool && parts.changed) parts.reset()
  store.tool = tool
  S.setCursor(tool ? 'crosshair' : '')
  hint()
}

/** Clicking the active tool again switches its variant. */
export const cycleOption = (tool) => {
  if (tool === 'rect') store.rectMode = store.rectMode === 'corner' ? 'center' : 'corner'
  if (tool === 'polygon') {
    const order = [6, 8, 3, 4, 5]
    store.sides = order[(order.indexOf(store.sides) + 1) % order.length]
  }
  if (st.phase === 'draw') update()
  hint()
}

export const exit = () => setTool(null)

export const apply = () => commitExtrude()

export const cancel = () => {
  if (store.tool === 'measure') { st.measure = { a: null, b: null, hover: null }; drawMeasure(); return }
  reset()
  hint()
}

export const flipDepth = () => {
  if (st.phase !== 'extrude') return
  st.depth = -st.depth || -5
  drawExtrude()
  report()
}

/* ---- dimensions per tool ---------------------------------------------- */

const FIELDS = {
  line: [{ key: 'len', unit: 'mm' }, { key: 'ang', unit: '°' }],
  rect: [{ key: 'w', unit: 'mm' }, { key: 'h', unit: 'mm' }],
  circle: [{ key: 'd', unit: 'mm', prefix: 'Ø ' }],
  polygon: [{ key: 'd', unit: 'mm', prefix: 'Ø ' }],
  ellipse: [{ key: 'w', unit: 'mm' }, { key: 'h', unit: 'mm' }]
}

const field = (key) => st.fields.find((f) => f.key === key)
const lockedValue = (key) => {
  const f = field(key)
  return f && f.locked ? f.value : null
}

/**
 * Turns the placed points, the cursor and any locked dimensions into the
 * shape being drawn: its outline for the preview, a label per dimension, and
 * the sketch that becomes a feature.
 */
const compute = () => {
  const tool = store.tool
  const a = st.pts[0]
  const c = st.cursor || a
  if (!a || !c) return null

  if (tool === 'line') {
    const last = st.pts[st.pts.length - 1]
    const path = [...st.pts, c]
    return {
      path,
      labels: [
        { key: 'len', at: mid(last, c), out: normalOf(last, c), value: segmentLength(last, c) },
        { key: 'ang', at: [...last], value: segmentAngle(last, c), small: true }
      ]
    }
  }

  if (tool === 'rect') {
    const centre = store.rectMode === 'center'
    let du = c[0] - a[0]
    let dv = c[1] - a[1]
    let w = lockedValue('w') ?? Math.abs(centre ? du * 2 : du)
    let h = lockedValue('h') ?? Math.abs(centre ? dv * 2 : dv)
    const su = Math.sign(du) || 1
    const sv = Math.sign(dv) || 1
    const cu = centre ? a[0] : a[0] + su * w / 2
    const cv = centre ? a[1] : a[1] + sv * h / 2
    const sketch = { type: 'rect', u: cu, v: cv, w, h }
    const outline = sketchOutline(sketch).slice(0, 4)
    return {
      outline,
      sketch,
      valid: w > 0.2 && h > 0.2,
      labels: [
        { key: 'w', at: [cu, cv - sv * h / 2], out: [0, -sv], value: w },
        { key: 'h', at: [cu + su * w / 2, cv], out: [su, 0], value: h }
      ]
    }
  }

  if (tool === 'circle' || tool === 'polygon') {
    const d = lockedValue('d') ?? segmentLength(a, c) * 2
    const r = d / 2
    const dir = segmentLength(a, c) > 1e-6 ? segmentAngle(a, c) : 0
    const edge = pointAt(a, r, dir)
    let sketch
    let outline
    if (tool === 'circle') {
      sketch = { type: 'circle', u: a[0], v: a[1], r }
      outline = sketchOutline(sketch).slice(0, -1)
    } else {
      outline = regularPolygon(a[0], a[1], r, store.sides, (dir * Math.PI) / 180)
      sketch = { type: 'poly', points: outline, label: `${store.sides}-gon Ø${d.toFixed(1)}` }
    }
    return { outline, sketch, valid: r > 0.1, radius: [a, edge], labels: [{ key: 'd', at: mid(a, edge), out: normalOf(a, edge), value: d }] }
  }

  if (tool === 'ellipse') {
    const w = lockedValue('w') ?? Math.abs(c[0] - a[0]) * 2
    const h = lockedValue('h') ?? Math.abs(c[1] - a[1]) * 2
    const outline = ellipsePoints(a[0], a[1], w / 2, h / 2)
    return {
      outline,
      sketch: { type: 'poly', points: outline, label: `ellipse ${w.toFixed(1)}×${h.toFixed(1)}` },
      valid: w > 0.2 && h > 0.2,
      labels: [
        { key: 'w', at: [a[0], a[1] - h / 2], out: [0, -1], value: w },
        { key: 'h', at: [a[0] + w / 2, a[1]], out: [1, 0], value: h }
      ]
    }
  }
  return null
}

const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]

/** Left hand normal of a segment, the side its dimension label goes to. */
const normalOf = (p, q) => {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const len = Math.hypot(dx, dy) || 1
  return [-dy / len, dx / len]
}

/** Label offset from its anchor, in screen pixels. */
const LABEL_GAP = 22

/** Where the cursor should really be, given snapping and locked dimensions. */
const constrain = (raw) => {
  const tool = store.tool
  const a = st.pts[st.pts.length - 1]
  if (!a) return [snap(raw[0]), snap(raw[1])]

  if (tool === 'line') {
    const len = lockedValue('len')
    const ang = lockedValue('ang')
    if (len == null && ang == null) return snapPoint(a, raw)
    const useAng = ang ?? snap(segmentAngle(a, raw), 1)
    const useLen = len ?? snap(Math.max(0, projectLength(a, raw, useAng)), 0.5)
    return pointAt(a, useLen, useAng)
  }
  // Every other tool measures from its first point on a 0.5 mm grid.
  return [snap(raw[0], 0.5), snap(raw[1], 0.5)]
}

const projectLength = (a, p, angDeg) => {
  const r = (angDeg * Math.PI) / 180
  return (p[0] - a[0]) * Math.cos(r) + (p[1] - a[1]) * Math.sin(r)
}

/* ---- pointer handling -------------------------------------------------- */

const isClick = (e) => st.down && Math.hypot(e.clientX - st.down.x, e.clientY - st.down.y) <= CLICK_SLOP

function onDown(e) {
  if (!store.tool || e.button !== 0) return
  st.down = { x: e.clientX, y: e.clientY }
  if (st.phase === 'extrude' && S.hitsObject(e, st.arrow)) {
    // Remember where on the axis the arrow was grabbed so it does not jump.
    const s = axisParam(e)
    st.drag = { offset: s == null ? 0 : s - st.depth, startDepth: st.depth, startY: e.clientY }
    S.setControlsEnabled(false)
    e.preventDefault()
  }
}

function onMove(e) {
  if (!store.tool) return
  st.pointer = { x: e.offsetX, y: e.offsetY }

  if (st.drag) {
    const s = axisParam(e)
    const step = e.shiftKey ? 0.1 : 0.5
    const raw = s == null
      // Looking straight down the arrow: fall back to vertical mouse travel.
      ? st.drag.startDepth + (st.drag.startY - e.clientY) * S.mmPerPixel(axisOrigin())
      : s - st.drag.offset
    st.depth = snap(raw, step)
    st.buffer = ''
    drawExtrude()
    report()
    return
  }

  if (store.tool === 'measure') {
    st.measure.hover = findSnap(e)
    drawMeasure()
    return
  }

  if (st.phase === 'idle') {
    // Pre-selection: show which face a click would sketch on.
    const hit = S.pickModel(e)
    S.highlightFace(hit ? hit.planeId : null, 'hover')
    return
  }

  if (st.phase === 'draw') {
    const raw = S.pointOnPlane(e, st.plane)
    if (!raw) return
    let c = constrain(raw)
    st.closing = false
    if (store.tool === 'line' && st.pts.length >= 3) {
      const first = S.toScreen(fromPlane(st.plane, ...st.pts[0]))
      const here = S.toScreen(fromPlane(st.plane, ...c))
      if (Math.hypot(first.x - here.x, first.y - here.y) <= CLOSE_PX) {
        c = [...st.pts[0]]
        st.closing = true
      }
    }
    st.cursor = c
    update()
  }
}

function onUp(e) {
  if (!store.tool) return
  override = ''
  if (st.drag) {
    st.drag = null
    S.setControlsEnabled(true)
    return
  }
  if (!isClick(e)) return    // that was an orbit
  st.down = null

  if (store.tool === 'measure') return measureClick(e)

  if (st.phase === 'idle') return startShape(e)

  if (st.phase === 'draw') {
    if (store.tool === 'line') {
      if (st.closing) return closeLine()
      placeLinePoint()
      return
    }
    finishShape()
  }
}

function onLeave() {
  if (st.phase === 'idle') S.highlightFace(null, 'hover')
}

/* ---- shape lifecycle --------------------------------------------------- */

function startShape(e) {
  const hit = S.pickModel(e)
  const plane = hit ? hit.plane : S.groundPlane()
  const p = S.pointOnPlane(e, plane)
  if (!plane || !p) return
  st.plane = plane
  st.phase = 'draw'
  st.pts = [[snap(p[0], 0.5), snap(p[1], 0.5)]]
  st.cursor = [...st.pts[0]]
  st.fields = (FIELDS[store.tool] || []).map((f) => ({ ...f, locked: false, value: null }))
  st.active = 0
  st.buffer = ''
  S.highlightFace(null, 'hover')
  S.highlightFace(hit ? hit.planeId : null, 'active')
  update()
  report()
}

function placeLinePoint() {
  const c = st.cursor
  const last = st.pts[st.pts.length - 1]
  if (!c || segmentLength(last, c) < 0.1) return
  st.pts.push([...c])
  // Each new segment starts with free dimensions again.
  st.fields.forEach((f) => { f.locked = false; f.value = null })
  st.active = 0
  st.buffer = ''
  update()
}

function closeLine() {
  if (st.pts.length < 3) return
  const outline = st.pts.map((p) => [...p])
  toExtrude({ type: 'poly', points: outline, label: `profile, ${outline.length} pts` }, outline)
}

function finishShape() {
  const shape = compute()
  if (!shape || !shape.valid) {
    hint('Too small to use, make it a bit bigger.')
    return
  }
  toExtrude(shape.sketch, shape.outline)
}

function toExtrude(sketch, outline) {
  st.profile = { sketch, outline, plane: st.plane }
  st.phase = 'extrude'
  st.depth = 0
  st.fields = [{ key: 'depth', unit: 'mm', locked: false, value: null }]
  st.active = 0
  st.buffer = ''
  S.setOverlay('shape', null)
  S.setOverlay('dots', null)
  S.setOverlay('radius', null)
  drawExtrude()
  report()
}

async function commitExtrude() {
  if (st.phase !== 'extrude') return
  if (st.buffer) st.depth = parse(st.buffer) ?? st.depth
  if (Math.abs(st.depth) < 0.1) {
    hint('Pull the arrow or type a distance first. A negative number cuts.')
    return
  }
  const { sketch, plane } = st.profile
  const depth = st.depth
  reset()
  hint()
  await model.addFeature({
    op: depth > 0 ? 'add' : 'cut',
    depth: Math.abs(depth),
    plane: { origin: plane.origin, normal: plane.normal, u: plane.u, v: plane.v, ground: plane.id === -1 },
    sketch
  })
}

function reset() {
  const tool = store.tool
  S.clearOverlay()
  S.setControlsEnabled(true)
  st = blank()
  store.phase = 'idle'
  store.depth = 0
  store.measureText = ''
  if (tool === 'measure') drawMeasure()
  renderPills()
}

/* ---- extrude arrow ------------------------------------------------------ */

const axisOrigin = () => {
  const [cu, cv] = outlineCentroid(st.profile.outline)
  return fromPlane(st.profile.plane, cu, cv, 0)
}

/** Parameter along the extrude axis closest to the pointer ray, or null when parallel. */
function axisParam(e) {
  const o = axisOrigin()
  const n = st.profile.plane.normal
  const { origin: r0, dir: r } = S.pointerRay(e)
  const w0 = [o[0] - r0[0], o[1] - r0[1], o[2] - r0[2]]
  const b = n[0] * r[0] + n[1] * r[1] + n[2] * r[2]
  const d = n[0] * w0[0] + n[1] * w0[1] + n[2] * w0[2]
  const ee = r[0] * w0[0] + r[1] * w0[1] + r[2] * w0[2]
  const denom = 1 - b * b
  if (denom < 0.03) return null
  return (b * ee - d) / denom
}

function drawExtrude() {
  if (st.phase !== 'extrude') return
  report()
  const { outline, plane } = st.profile
  const depth = st.buffer ? (parse(st.buffer) ?? st.depth) : st.depth
  const cut = depth < 0
  S.setOverlay('region', S.makeRegion(outline, plane, { color: cut ? 0xf0524d : 0x3b82f6, opacity: 0.22 }))
  S.setOverlay('outline', S.makePolyline(outline.map(([u, v]) => fromPlane(plane, u, v, 0.1)), { closed: true, color: cut ? 0xff8f8a : 0x9cc2ff }))
  S.setOverlay('extrude', S.makeExtrudePreview(outline, plane, depth))
  const o = axisOrigin()
  const n = plane.normal
  const base = [o[0] + n[0] * depth, o[1] + n[1] * depth, o[2] + n[2] * depth]
  st.arrow = S.makeArrow(base, n, { color: cut ? 0xf0524d : 0x3b82f6 })
  S.setOverlay('arrow', st.arrow)
  renderPills()
}

/* ---- drawing the shape in progress ------------------------------------- */

function update() {
  const shape = compute()
  const plane = st.plane
  if (!shape || !plane) return
  const lift = 0.12
  if (store.tool === 'line') {
    S.setOverlay('shape', S.makePolyline(shape.path.map(([u, v]) => fromPlane(plane, u, v, lift)), { color: st.closing ? 0x3fb950 : 0x9cc2ff }))
    S.setOverlay('dots', S.makeDots(st.pts.map(([u, v]) => fromPlane(plane, u, v, lift)), { color: 0xffffff, size: 7 }))
  } else {
    S.setOverlay('shape', S.makePolyline(shape.outline.map(([u, v]) => fromPlane(plane, u, v, lift)), { closed: true }))
    const markers = shape.radius ? shape.radius : [st.pts[0]]
    S.setOverlay('dots', S.makeDots(markers.map(([u, v]) => fromPlane(plane, u, v, lift)), { size: 7 }))
    if (shape.radius) {
      S.setOverlay('radius', S.makePolyline(shape.radius.map(([u, v]) => fromPlane(plane, u, v, lift)), { opacity: 0.55 }))
    }
  }
  st.labels = shape.labels
  renderPills()
  report()
}

/* ---- measure ------------------------------------------------------------ */

/**
 * Snap target under the pointer. First the model's real corners and edge
 * midpoints within SNAP_PX, skipping any that sit behind the surface, then
 * the surface point, then the grid. Pure triangle corners are not enough:
 * exactly on a corner the ray often slips past the silhouette.
 */
function findSnap(e) {
  const hit = S.pickModel(e)
  const cursor = { x: e.offsetX, y: e.offsetY }
  const eye = S.cameraPosition()
  const dist3 = (p) => Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2])
  const hitDepth = hit ? dist3(hit.point) : Infinity

  let best = null
  for (const cand of S.snapPoints()) {
    const s = S.toScreen(cand.point)
    if (!s.visible) continue
    const px = Math.hypot(s.x - cursor.x, s.y - cursor.y)
    if (px > SNAP_PX) continue
    const depth = dist3(cand.point)
    // Behind the surface the cursor is over: not what the user is pointing at.
    if (depth > hitDepth + 0.5) continue
    // Corners beat midpoints, then the nearest on screen, then the nearest to the eye.
    const score = px + (cand.kind === 'mid' ? 4 : 0) + depth * 1e-4
    if (!best || score < best.score) best = { ...cand, score }
  }
  if (best) return best
  if (hit) return { point: hit.point, kind: 'face' }
  const g = S.pointOnPlane(e, S.groundPlane())
  return g ? { point: fromPlane(S.groundPlane(), g[0], g[1], 0), kind: 'grid' } : null
}

const midpoint3 = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]

function measureClick(e) {
  const target = findSnap(e)
  if (!target) return
  const m = st.measure
  if (!m.a || m.b) { m.a = target.point; m.b = null } else { m.b = target.point }
  drawMeasure()
}

function drawMeasure() {
  const m = st.measure
  const dots = [m.a, m.b].filter(Boolean)
  S.setOverlay('m-dots', dots.length ? S.makeDots(dots, { color: 0xffd166, size: 9 }) : null)
  S.setOverlay('m-hover', m.hover ? S.makeDots([m.hover.point], { color: m.hover.kind === 'face' ? 0xffffff : 0xffd166, size: m.hover.kind === 'face' ? 6 : 11 }) : null)
  const end = m.b || (m.a && m.hover ? m.hover.point : null)
  S.setOverlay('m-line', m.a && end ? S.makePolyline([m.a, end], { color: 0xffd166 }) : null)
  if (m.a && m.b) {
    const d = [m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2]]
    store.measureText = `${Math.hypot(...d).toFixed(2)} mm   Δx ${Math.abs(d[0]).toFixed(2)}  Δy ${Math.abs(d[1]).toFixed(2)}  Δz ${Math.abs(d[2]).toFixed(2)}`
  } else {
    store.measureText = ''
  }
  renderPills()
  report()
}

/* ---- keyboard ------------------------------------------------------------ */

const parse = (text) => {
  const n = Number(String(text).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function lockActive() {
  const f = st.fields[st.active]
  const n = parse(st.buffer)
  st.buffer = ''
  if (!f || n == null) return false
  if (f.key !== 'ang' && f.key !== 'depth' && n <= 0) return false
  f.locked = true
  f.value = n
  return true
}

function onKey(e) {
  if (!store.tool) return
  const t = e.target
  const typingElsewhere = (t instanceof HTMLInputElement && !t.classList.contains('dim-input'))
    || t instanceof HTMLTextAreaElement || t?.closest?.('.cm-editor')
  if (typingElsewhere) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  const k = e.key
  override = ''
  const collecting = st.phase === 'draw' || st.phase === 'extrude'

  if (collecting && /^[0-9.,-]$/.test(k)) {
    e.preventDefault()
    if (k === '-' && st.buffer.length) return
    st.buffer += k === ',' ? '.' : k
    after()
    return
  }

  if (k === 'Backspace') {
    if (st.buffer) { st.buffer = st.buffer.slice(0, -1); after(); e.preventDefault(); return }
    if (st.phase === 'draw' && store.tool === 'line' && st.pts.length > 1) {
      st.pts.pop(); update(); e.preventDefault(); return
    }
    return
  }

  if (k === 'Tab' && st.phase === 'draw' && st.fields.length > 1) {
    e.preventDefault()
    if (st.buffer) lockActive()
    st.active = (st.active + 1) % st.fields.length
    after()
    return
  }

  if (k === 'Enter') {
    e.preventDefault()
    if (st.phase === 'extrude') { commitExtrude(); return }
    if (st.phase !== 'draw') return
    if (st.buffer) {
      lockActive()
      if (store.tool === 'line') {
        st.cursor = constrain(st.cursor || st.pts[st.pts.length - 1])
        placeLinePoint()
        return
      }
      const next = st.fields.findIndex((f) => !f.locked)
      if (next !== -1) { st.active = next; after(); return }
      finishShape()
      return
    }
    if (store.tool === 'line') closeLine()
    else finishShape()
    return
  }

  if (k === 'Escape') {
    e.preventDefault()
    if (st.buffer) { st.buffer = ''; after(); return }
    cancel()
  }
}

/** Re-applies locks after typing so the preview follows the number at once. */
function after() {
  if (st.phase === 'draw' && st.cursor) {
    const f = st.fields[st.active]
    const n = parse(st.buffer)
    // Preview the typed value without locking it yet.
    const saved = f && { locked: f.locked, value: f.value }
    if (f && n != null && n !== 0) { f.locked = true; f.value = n }
    if (store.tool === 'line') st.cursor = constrain(st.cursor)
    update()
    if (f && saved) { f.locked = saved.locked; f.value = saved.value }
    return
  }
  if (st.phase === 'extrude') drawExtrude()
  renderPills()
  report()
}

/* ---- pills (DOM) ---------------------------------------------------------- */

const fmt = (key, value) => {
  if (value == null || !Number.isFinite(value)) return '0'
  if (key === 'ang') return `${Math.round(value)}`
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(value % 1 === 0 ? 0 : 1)
}

function pillList() {
  const out = []
  if (st.phase === 'draw' && st.labels) {
    st.labels.forEach((l) => {
      const idx = st.fields.findIndex((f) => f.key === l.key)
      const f = st.fields[idx]
      if (!f) return
      const active = idx === st.active
      const shown = active && st.buffer ? st.buffer : fmt(l.key, f.locked ? f.value : l.value)
      out.push({
        id: `dim-${l.key}`, world: fromPlane(st.plane, l.at[0], l.at[1], 0.2),
        outWorld: l.out ? fromPlane(st.plane, l.at[0] + l.out[0], l.at[1] + l.out[1], 0.2) : null,
        text: `${f.prefix || ''}${shown}`, unit: f.unit, active, locked: f.locked,
        typing: active && !!st.buffer, small: l.small, fieldIndex: idx,
        // The angle sits beside its vertex instead of on top of the dot.
        offset: l.small ? [12, 16] : null
      })
    })
  }
  if (st.phase === 'extrude' && st.arrow) {
    const shown = st.buffer ? st.buffer : `${st.depth > 0 ? '+' : ''}${fmt('depth', st.depth)}`
    out.push({
      id: 'dim-depth', world: st.arrow.userData.tip, text: shown, unit: 'mm',
      active: true, typing: !!st.buffer, offset: [18, -4], tone: st.depth < 0 ? 'cut' : 'add', fieldIndex: 0
    })
  }
  const m = st.measure
  if (store.tool === 'measure' && m.a && m.b) {
    const d = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1], m.b[2] - m.a[2])
    out.push({ id: 'dim-measure', world: midpoint3(m.a, m.b), text: d.toFixed(2), unit: 'mm', tone: 'measure' })
  }
  return out
}

function renderPills() {
  if (!layer) return
  const list = pillList()
  const seen = new Set()
  for (const p of list) {
    seen.add(p.id)
    let el = pills.get(p.id)
    if (!el) {
      el = document.createElement('div')
      el.className = 'dim-pill'
      el.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation()
        if (p.fieldIndex == null) return
        st.active = Number(el.dataset.field)
        openInput(el)
      })
      layer.appendChild(el)
      pills.set(p.id, el)
    }
    const s = S.toScreen(p.world)
    let [ox, oy] = p.offset || [0, 0]
    if (p.outWorld) {
      // Push the label off the geometry, outwards, like a drawing dimension,
      // so it never sits on the corner the user is about to click.
      const t = S.toScreen(p.outWorld)
      const len = Math.hypot(t.x - s.x, t.y - s.y) || 1
      ox = ((t.x - s.x) / len) * LABEL_GAP
      oy = ((t.y - s.y) / len) * LABEL_GAP
    }
    const x = s.x + ox
    const y = s.y + oy
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(${p.offset ? '0' : '-50%'}, -50%)`
    el.style.display = s.visible ? '' : 'none'
    // A pill right under the pointer lets clicks through to the canvas.
    const near = st.pointer && Math.hypot(st.pointer.x - x, st.pointer.y - y) < 34
    el.style.pointerEvents = near ? 'none' : ''
    el.dataset.field = p.fieldIndex ?? ''
    el.className = `dim-pill${p.active ? ' active' : ''}${p.locked ? ' locked' : ''}${p.typing ? ' typing' : ''}${p.small ? ' small' : ''}${p.tone ? ` tone-${p.tone}` : ''}`
    if (!el.querySelector('input')) {
      el.innerHTML = `${p.locked ? '<span class="ico sm i-lock"></span>' : ''}<span class="dim-val">${p.text}</span><span class="dim-unit">${p.unit || ''}</span>`
    }
  }
  for (const [id, el] of pills) {
    if (!seen.has(id)) { el.remove(); pills.delete(id) }
  }
}

/** Touch and click fallback: a real input inside the pill. */
function openInput(el) {
  if (el.querySelector('input')) return
  const input = document.createElement('input')
  input.className = 'dim-input'
  input.inputMode = 'decimal'
  input.value = st.buffer || ''
  el.innerHTML = ''
  el.appendChild(input)
  input.focus()
  const done = () => { input.remove(); renderPills() }
  input.addEventListener('input', () => { st.buffer = input.value.replace(',', '.'); after() })
  input.addEventListener('blur', done)
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === 'Tab' || ev.key === 'Escape') {
      ev.preventDefault()
      input.blur()
      onKey(ev)
    }
  })
}

/* ---- HUD text ------------------------------------------------------------ */

let override = ''

/** Pushes phase, the effective depth and the hint into the store for the HUD. */
function report() {
  store.phase = st.phase
  // While typing, the HUD shows the typed distance, not the last dragged one.
  const typed = st.phase === 'extrude' && st.buffer ? parse(st.buffer) : null
  store.depth = typed ?? st.depth
  store.hint = override || hintText()
}

function hint(text) {
  override = text || ''
  report()
}

function hintText() {
  const tool = store.tool
  const phase = st.phase
  if (phase === 'extrude') return 'Drag the arrow or type a distance, Enter applies. Negative cuts into the part.'
  const HINTS = {
    idle: {
      line: 'Click a face or the grid to start the profile.',
      rect: store.rectMode === 'center' ? 'Click a face or the grid for the centre.' : 'Click a face or the grid for the first corner.',
      circle: 'Click a face or the grid for the centre.',
      polygon: `Click for the centre. ${store.sides} sides, click Polygon again to change.`,
      ellipse: 'Click a face or the grid for the centre.',
      measure: 'Click two points. Snaps to corners and edge midpoints.'
    },
    draw: {
      line: st.pts.length >= 3
        ? 'Next point, or click the first point to close. Type a length, Tab for the angle, Enter places it.'
        : 'Click the next point, or type a length and press Enter. Tab switches to the angle.',
      rect: 'Click the opposite corner, or type the width, Tab, the height, Enter.',
      circle: 'Click to set the size, or type the diameter and press Enter.',
      polygon: 'Click to set size and rotation, or type the diameter and press Enter.',
      ellipse: 'Click to set the size, or type width, Tab, height, Enter.'
    }
  }
  if (tool === 'measure') return st.measure.a && !st.measure.b ? 'Click the second point.' : HINTS.idle.measure
  return HINTS[phase]?.[tool] || ''
}

/** Internal state, for tests and the console only. */
export const debugState = () => ({ phase: st.phase, pts: st.pts, cursor: st.cursor, down: st.down, plane: st.plane && st.plane.id, override, fields: st.fields.map((f) => `${f.key}:${f.locked ? f.value : '-'}`) })
