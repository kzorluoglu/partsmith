import { Component } from '@geajs/core'
import sketch from '../stores/sketch-store.js'
import { setTool, selectFace, showSketch } from '../lib/scene.js'

const TOOLS = [
  { id: 'select', label: 'select', title: 'Pick a face' },
  { id: 'rect', label: '▭ rect', title: 'Drag a rectangle on the selected face' },
  { id: 'circle', label: '○ circle', title: 'Drag a circle on the selected face' }
]

/** Floats over the viewer: shape tools, the current hint and the depth popover. */
export default class SketchToolbar extends Component {
  template() {
    const { tool, selected, pending, hint, depth } = sketch
    return (
      <div class="sketchbar">
        <div class="sketchbar-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              class={`chip ${tool === t.id ? 'on' : ''}`}
              title={t.title}
              disabled={t.id !== 'select' && !selected}
              click={() => this.pick(t.id)}
            >{t.label}</button>
          ))}
          {selected && <button class="chip" title="Deselect face" click={() => selectFace(null)}>✕ face</button>}
        </div>

        <p class="sketchbar-hint">{hint}</p>

        {pending && (
          <div class="sketch-popover">
            <label class="field">
              <span>Depth (mm)</span>
              <input
                type="number"
                min="0.2"
                step="0.5"
                value={depth}
                input={(e) => { sketch.depth = Number(e.target.value) }}
                keydown={this.onKeydown}
              />
            </label>
            <div class="sketch-popover-actions">
              <button class="button small" click={() => this.commit('add')}>Add</button>
              <button class="button small danger" click={() => this.commit('cut')}>Cut</button>
              <button class="link" click={() => this.cancel()}>cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  pick(id) {
    sketch.setTool(id)
    setTool(id)
    showSketch(null)
  }

  commit(op) {
    showSketch(null)
    sketch.commit(op)
  }

  cancel() {
    showSketch(null)
    sketch.cancel()
  }

  onKeydown = (event) => {
    if (event.key === 'Enter') this.commit(sketch.op)
    if (event.key === 'Escape') this.cancel()
  }
}
