import { Store } from '@geajs/core'
import { setPartVisible, setPartOffset } from '../lib/scene.js'

const RESET_MS = 480

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let tween = 0

/**
 * Per part display state for multi part models: visibility and an offset to
 * pull the parts apart and see how they sit together. Display only, the
 * model, the print check and every export ignore it. The viewport side, the
 * picking and the axis gizmo, lives in lib/part-mover.js.
 * No constructor, see the note in settings-store.js.
 */
class PartsStore extends Store {
  selected = -1
  moving = ''  // live readout while an axis is dragged, e.g. "X +12.5 mm"
  items = []   // { visible, offset: [x, y, z] }

  get count() {
    return this.items.length
  }

  /** The HUD line: the live readout while dragging, otherwise what to do next. */
  get hint() {
    if (this.moving) return this.moving
    return this.selected >= 0 ? 'Drag an arrow to move, Shift for free' : 'Click a part to move it'
  }

  /** True when something differs from the assembled model. */
  get changed() {
    return this.items.some((item) => !item.visible || item.offset.some((v) => v !== 0))
  }

  /**
   * Called with the part ranges of every build. A parameter tweak keeps the
   * same parts, so their state survives; a different part count starts over.
   */
  sync(ranges = []) {
    const keep = ranges.length === this.items.length
    this.items = ranges.map((_, i) => ({
      visible: keep ? this.items[i].visible : true,
      offset: keep ? [...this.items[i].offset] : [0, 0, 0]
    }))
    if (!keep || ranges.length < 2) this.selected = -1
  }

  /** Pushes the whole state into the scene, after the viewer rebuilt it. */
  apply() {
    this.items.forEach((item, i) => {
      setPartVisible(i, item.visible)
      setPartOffset(i, item.offset)
    })
  }

  select(index) {
    this.selected = this.items[index] ? index : -1
  }

  setVisible(index, visible) {
    const item = this.items[index]
    if (!item) return
    item.visible = visible
    setPartVisible(index, visible)
    if (!visible && this.selected === index) this.selected = -1
  }

  /** Shows only this part, a second call brings the others back. */
  isolate(index) {
    const alone = this.items.every((item, i) => item.visible === (i === index))
    this.items.forEach((_, i) => this.setVisible(i, alone || i === index))
  }

  showAll() {
    this.items.forEach((_, i) => this.setVisible(i, true))
  }

  setOffset(index, offset) {
    const item = this.items[index]
    if (!item || !offset.every(Number.isFinite)) return
    cancelAnimationFrame(tween)
    item.offset = [...offset]
    setPartOffset(index, item.offset)
  }

  /** Glides every part back to where it belongs and shows them all again. */
  reset({ animate = true } = {}) {
    cancelAnimationFrame(tween)
    this.showAll()
    const from = this.items.map((item) => [...item.offset])
    const place = (k) => {
      this.items.forEach((item, i) => {
        item.offset = k >= 1 ? [0, 0, 0] : from[i].map((v) => v * (1 - k))
        setPartOffset(i, item.offset)
      })
    }
    if (!animate) return place(1)
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / RESET_MS)
      place(t >= 1 ? 1 : ease(t))
      if (t < 1) tween = requestAnimationFrame(step)
    }
    tween = requestAnimationFrame(step)
  }
}

export default new PartsStore()
