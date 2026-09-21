import { Store } from '@geajs/core'
import model from './model-store.js'
import { describeNormal } from '../lib/features.js'
import { finishPoly, cancelPoly, commitExactSegment, undoPolyPoint } from '../lib/scene.js'

/**
 * State of the direct modelling tools: which face is picked, which tool is
 * active, and the sketch waiting for a depth. The committed features belong
 * to the model store, this is only the in-progress part.
 */
class SketchStore extends Store {
  tool = 'select'
  selected = null
  pending = null
  depth = 5
  op = 'add'

  // Live polyline readout, driven by the viewer.
  poly = { points: [], cursor: null, length: 0, angle: 0, closing: false }
  lengthInput = ''
  angleInput = ''

  get drawing() {
    return this.tool === 'line' && this.poly.points.length > 0
  }

  get canClose() {
    return this.poly.points.length >= 3
  }

  get faceLabel() {
    if (!this.selected) return ''
    return `face ${describeNormal(this.selected.normal)}`
  }

  get hint() {
    if (this.pending) return 'Set a depth, then Add or Cut.'
    if (!this.selected) return 'Click a face of the model.'
    if (this.tool === 'select') return `${this.faceLabel} selected. Pick a shape tool to sketch on it.`
    if (this.tool === 'line') {
      if (this.poly.points.length === 0) return `Click on the ${this.faceLabel} to start the profile.`
      if (this.poly.closing) return 'Click the first point to close the profile.'
      return `${this.poly.points.length} point(s). Type a length and press Enter, or click. Enter closes, Backspace undoes.`
    }
    return `Drag on the ${this.faceLabel} to draw a ${this.tool === 'rect' ? 'rectangle' : 'circle'}.`
  }

  /** Live segment readout, snapped values as they will be committed. */
  get readout() {
    if (this.tool !== 'line' || this.poly.points.length === 0) return null
    return { length: this.poly.length, angle: this.poly.angle }
  }

  onPoly(state) {
    this.poly = state
  }

  /** Enter in the length box: place the point at exactly that distance. */
  applyExact() {
    const len = Number(this.lengthInput)
    if (!len || len <= 0) return false
    const angle = this.angleInput === '' ? null : Number(this.angleInput)
    const ok = commitExactSegment(len, Number.isFinite(angle) ? angle : null)
    if (ok) { this.lengthInput = ''; this.angleInput = '' }
    return ok
  }

  closeProfile() {
    return finishPoly()
  }

  undoPoint() {
    undoPolyPoint()
  }

  setTool(tool) {
    this.tool = tool
    this.pending = null
    this.lengthInput = ''
    this.angleInput = ''
    cancelPoly()
  }

  onSelect(plane) {
    this.selected = plane
    this.pending = null
  }

  onSketch(sketch, plane) {
    this.pending = { sketch, plane }
  }

  cancel() {
    this.pending = null
    cancelPoly()
    this.lengthInput = ''
    this.angleInput = ''
  }

  async commit(op) {
    if (!this.pending) return
    const depth = Math.max(0.2, Number(this.depth) || 0)
    const { sketch, plane } = this.pending
    this.op = op
    this.pending = null
    await model.addFeature({
      op,
      depth,
      plane: { origin: plane.origin, normal: plane.normal, u: plane.u, v: plane.v },
      sketch
    })
  }
}

export default new SketchStore()
