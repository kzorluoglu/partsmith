import { Component } from '@geajs/core'
import ui from '../stores/ui-store.js'
import model from '../stores/model-store.js'
import sketch from '../stores/sketch-store.js'
import { setTool, selectFace } from '../lib/scene.js'

const PANELS = [
  { id: 'chat', label: 'Generate', icon: 'i-spark' },
  { id: 'params', label: 'Parameters', icon: 'i-sliders' },
  { id: 'code', label: 'Script', icon: 'i-code' },
  { id: 'print', label: 'Print', icon: 'i-printer' }
]

/** Left tool rail in the Shapr3D manner: icon plus label, grouped. */
export default class Rail extends Component {
  template() {
    const { panel, sketchMode } = ui
    return (
      <nav class="rail">
        <div class="rail-group">
          {PANELS.map((p) => (
            <button key={p.id} class={`rail-btn ${panel === p.id ? 'on' : ''}`} click={() => ui.togglePanel(p.id)}>
              <span class={`ico ${p.icon}`}></span>
              <span class="rail-label">{p.label}</span>
            </button>
          ))}
        </div>

        <div class="rail-group">
          <button class={`rail-btn ${sketchMode ? 'on' : ''}`} click={() => this.toggleSketch()}>
            <span class="ico i-sketch"></span>
            <span class="rail-label">Sketch</span>
          </button>
        </div>

        <div class="rail-group rail-bottom">
          <button class="rail-btn icon-only" title="Undo (Ctrl+Z)" disabled={!model.canUndo} click={() => model.undo()}>
            <span class="ico i-undo"></span>
          </button>
          <button class="rail-btn icon-only" title="Redo (Ctrl+Shift+Z)" disabled={!model.canRedo} click={() => model.redo()}>
            <span class="ico i-redo"></span>
          </button>
        </div>
      </nav>
    )
  }

  toggleSketch() {
    ui.sketchMode = !ui.sketchMode
    if (!ui.sketchMode) {
      // Leaving sketch mode drops any half drawn profile and the face pick.
      sketch.cancel()
      sketch.setTool('select')
      setTool('select')
      selectFace(null)
    }
  }

  onKeydown = (event) => {
    const t = event.target
    // The script editor and text fields have their own undo.
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.closest?.('.cm-editor')) return
    const mod = event.ctrlKey || event.metaKey
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); model.undo() }
    if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); model.redo() }
  }

  onAfterRender() {
    document.addEventListener('keydown', this.onKeydown)
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeydown)
    super.dispose()
  }
}
