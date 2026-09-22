import { Component } from '@geajs/core'
import sketch from '../stores/sketch-store.js'
import { setTool, selectFace, showSketch } from '../lib/scene.js'

const TOOLS = [
  { id: 'select', label: 'Select', icon: 'i-cursor', title: 'Pick a face' },
  { id: 'line', label: 'Line', icon: 'i-line', title: 'Click point to point, type exact lengths' },
  { id: 'rect', label: 'Rectangle', icon: 'i-rect', title: 'Drag a rectangle on the selected face' },
  { id: 'circle', label: 'Circle', icon: 'i-circle', title: 'Drag a circle on the selected face' }
]

/** Floats over the viewer: tools, live dimensions and the depth popover. */
export default class SketchToolbar extends Component {
  lengthEl = null

  template() {
    const { tool, selected, pending, hint, depth, readout, drawing, canClose } = sketch
    return (
      <div class="sketchbar">
        <div class="sketchbar-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              class={`seg ${tool === t.id ? 'on' : ''}`}
              title={t.title}
              disabled={t.id !== 'select' && !selected}
              click={() => this.pick(t.id)}
            ><span class={`ico sm ${t.icon}`}></span><span>{t.label}</span></button>
          ))}
          {selected && <button class="seg" title="Deselect face" click={() => selectFace(null)}><span class="ico sm i-close"></span></button>}
        </div>

        <p class="sketchbar-hint">{hint}</p>

        {tool === 'line' && selected && !pending && (
          <div class="dimbar">
            <label class="dim">
              <span>Length</span>
              <input
                ref={this.lengthEl}
                type="number"
                min="0"
                step="0.5"
                placeholder={readout ? readout.length.toFixed(1) : '0'}
                value={sketch.lengthInput}
                input={(e) => { sketch.lengthInput = e.target.value }}
                keydown={this.onDimKey}
              />
              <span class="dim-unit">mm</span>
            </label>
            <label class="dim">
              <span>Angle</span>
              <input
                type="number"
                step="15"
                placeholder={readout ? readout.angle.toFixed(0) : 'auto'}
                value={sketch.angleInput}
                input={(e) => { sketch.angleInput = e.target.value }}
                keydown={this.onDimKey}
              />
              <span class="dim-unit">°</span>
            </label>
            <div class="dim-actions">
              <button class="seg" disabled={!drawing} title="Remove the last point (Backspace)" click={() => sketch.undoPoint()}>Undo point</button>
              <button class="seg on" disabled={!canClose} title="Close the profile (Enter)" click={() => this.close()}>Close</button>
            </div>
          </div>
        )}

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
                keydown={this.onDepthKey}
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

  close() {
    if (sketch.closeProfile()) this.blurDim()
  }

  commit(op) {
    showSketch(null)
    sketch.commit(op)
  }

  cancel() {
    showSketch(null)
    sketch.cancel()
  }

  blurDim() {
    this.lengthEl?.blur()
  }

  onDimKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // A typed length places the point, an empty box means "close the shape".
      if (!sketch.applyExact()) this.close()
    }
    if (event.key === 'Escape') this.cancel()
  }

  onDepthKey = (event) => {
    if (event.key === 'Enter') this.commit(sketch.op)
    if (event.key === 'Escape') this.cancel()
  }

  onAfterRender() {
    document.addEventListener('keydown', this.onGlobalKey)
  }

  onGlobalKey = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (sketch.tool !== 'line') return
    if (event.key === 'Enter' && sketch.canClose) { event.preventDefault(); this.close() }
    if (event.key === 'Backspace' && sketch.drawing) { event.preventDefault(); sketch.undoPoint() }
    if (event.key === 'Escape') this.cancel()
  }

  dispose() {
    document.removeEventListener('keydown', this.onGlobalKey)
    super.dispose()
  }
}
