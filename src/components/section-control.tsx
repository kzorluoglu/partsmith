import { Component } from '@geajs/core'
import ui from '../stores/ui-store.js'
import model from '../stores/model-store.js'
import { setSection } from '../lib/scene.js'

const AXES = ['x', 'y', 'z']
const INDEX = { x: 0, y: 1, z: 2 }

/** Section plane controls: axis, and the position by slider or typed mm. */
export default class SectionControl extends Component {
  template() {
    const { sectionOn, sectionAxis, sectionPos } = ui
    const { lo, hi } = this.range(sectionAxis)
    return (
      <div class={`section-panel ${sectionOn ? 'open' : ''}`}>
        <div class="section-head">
          <span class="section-title">Section</span>
          <div class="seg-group">
            {AXES.map((a) => (
              <button key={a} class={`seg ${sectionAxis === a ? 'on' : ''}`} click={() => this.axis(a)}>{a.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div class="section-row">
          <input
            type="range"
            min={lo}
            max={hi}
            step="0.1"
            value={sectionPos}
            input={(e) => this.position(Number(e.target.value))}
          />
          <label class="unit-input">
            <input
              type="number"
              step="0.5"
              value={Number(sectionPos).toFixed(1)}
              change={(e) => this.position(Number(e.target.value))}
            />
            <span>mm</span>
          </label>
        </div>
      </div>
    )
  }

  range(axis) {
    const s = model.stats
    if (!s) return { lo: -50, hi: 50 }
    const i = INDEX[axis]
    return { lo: Number(s.min[i].toFixed(1)), hi: Number(s.max[i].toFixed(1)) }
  }

  axis(a) {
    const { lo, hi } = this.range(a)
    ui.sectionAxis = a
    ui.sectionPos = Number(((lo + hi) / 2).toFixed(1))
    this.push()
  }

  position(v) {
    if (!Number.isFinite(v)) return
    ui.sectionPos = v
    this.push()
  }

  push() {
    setSection({ enabled: ui.sectionOn, axis: ui.sectionAxis, position: ui.sectionPos })
  }

  onAfterRender() {
    this.off = ui.observe('sectionOn', () => {
      if (ui.sectionOn) {
        // Start in the middle of the part so the cut shows something at once.
        const { lo, hi } = this.range(ui.sectionAxis)
        ui.sectionPos = Number(((lo + hi) / 2).toFixed(1))
      }
      this.push()
    })
  }

  dispose() {
    this.off?.()
    super.dispose()
  }
}
