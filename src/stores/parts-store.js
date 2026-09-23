import { Store } from '@geajs/core'
import { setPartVisible, setPartOffset } from '../lib/scene.js'

const AXES = ['x', 'y', 'z']
const RESET_MS = 480

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

let tween = 0

/**
 * Per part display state for multi part models: visibility and an offset to
 * pull the parts apart and see how they sit together. Display only, the
 * model, the print check and every export ignore it.
 * No constructor, see the note in settings-store.js.
 */
class PartsStore extends Store {
  open = false
  selected = 0
  span = 100
  items = []   // { visible, offset: [x, y, z], size: [x, y, z] }

  get count() {
    return this.items.length
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
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const r of ranges) {
      for (let d = 0; d < 3; d++) {
        min[d] = Math.min(min[d], r.min[d])
        max[d] = Math.max(max[d], r.max[d])
      }
    }
    const size = ranges.length ? Math.max(...max.map((v, d) => v - min[d])) : 0
    // Enough room to pull a part fully clear of the rest on any axis.
    this.span = Math.max(50, Math.ceil(size * 1.5 / 10) * 10)

    const keep = ranges.length === this.items.length
    this.items = ranges.map((r, i) => ({
      visible: keep ? this.items[i].visible : true,
      offset: keep ? [...this.items[i].offset] : [0, 0, 0],
      size: r.max.map((v, d) => v - r.min[d])
    }))
    if (this.selected >= this.items.length) this.selected = 0
  }

  /** Pushes the whole state into the scene, after the viewer rebuilt it. */
  apply() {
    this.items.forEach((item, i) => {
      setPartVisible(i, item.visible)
      setPartOffset(i, item.offset)
    })
  }

  toggle() {
    this.open = !this.open
  }

  select(index) {
    this.selected = index
  }

  setVisible(index, visible) {
    const item = this.items[index]
    if (!item) return
    item.visible = visible
    setPartVisible(index, visible)
  }

  /** Shows only this part, a second click brings the others back. */
  solo(index) {
    const alone = this.items.every((item, i) => item.visible === (i === index))
    this.items.forEach((_, i) => this.setVisible(i, alone || i === index))
  }

  showAll() {
    this.items.forEach((_, i) => this.setVisible(i, true))
  }

  setOffset(index, axis, value) {
    const item = this.items[index]
    const d = AXES.indexOf(axis)
    if (!item || d < 0 || !Number.isFinite(value)) return
    cancelAnimationFrame(tween)
    const offset = [...item.offset]
    offset[d] = value
    item.offset = offset
    setPartOffset(index, offset)
  }

  /** Glides every part back to where it belongs and shows them all again. */
  reset({ animate = true } = {}) {
    cancelAnimationFrame(tween)
    this.showAll()
    const from = this.items.map((item) => [...item.offset])
    const place = (k) => {
      this.items.forEach((item, i) => {
        const offset = from[i].map((v) => v * (1 - k))
        item.offset = k >= 1 ? [0, 0, 0] : offset
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
