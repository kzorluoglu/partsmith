import { Store } from '@geajs/core'
import model from './model-store.js'
import { describeNormal } from '../lib/features.js'

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

  get faceLabel() {
    if (!this.selected) return ''
    return `face ${describeNormal(this.selected.normal)}`
  }

  get hint() {
    if (this.pending) return 'Set a depth, then Add or Cut.'
    if (!this.selected) return 'Click a face of the model.'
    if (this.tool === 'select') return `${this.faceLabel} selected. Pick a shape tool to sketch on it.`
    return `Drag on the ${this.faceLabel} to draw a ${this.tool === 'rect' ? 'rectangle' : 'circle'}.`
  }

  setTool(tool) {
    this.tool = tool
    this.pending = null
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
