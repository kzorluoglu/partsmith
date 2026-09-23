import { Component } from '@geajs/core'
import ui from '../stores/ui-store.js'
import model from '../stores/model-store.js'
import sketch from '../stores/sketch-store.js'
import parts from '../stores/parts-store.js'
import * as sketcher from '../lib/sketcher.js'
import RailItem from './rail-item.tsx'

const PANELS = [
  { id: 'chat', label: 'Generate', icon: 'i-spark' },
  { id: 'params', label: 'Parameters', icon: 'i-sliders' },
  { id: 'code', label: 'Script', icon: 'i-code' },
  { id: 'print', label: 'Print', icon: 'i-printer' }
]

/**
 * Left tool rail. In model mode it opens the panels; in sketch mode the same
 * rail turns into the sketch toolbox, the way Shapr3D swaps its left bar.
 */
export default class Rail extends Component {
  template() {
    const { panel, sketchMode, sectionOn } = ui
    const { tool, rectMode, sides } = sketch

    const sketchTools = [
      { id: 'line', label: 'Line', sub: 'Click points', icon: 'i-line' },
      { id: 'rect', label: 'Rectangle', sub: rectMode === 'center' ? 'From centre' : 'Two corners', icon: 'i-rect' },
      { id: 'circle', label: 'Circle', sub: 'Centre, size', icon: 'i-circle' },
      { id: 'polygon', label: 'Polygon', sub: `${sides} sides`, icon: 'i-polygon' },
      { id: 'ellipse', label: 'Ellipse', sub: 'Centre, size', icon: 'i-ellipse' }
    ]

    return (
      <nav class={`rail ${sketchMode ? 'sketching' : ''}`}>
        <div class={`rail-group ${sketchMode ? 'hidden' : ''}`}>
          {PANELS.map((p) => (
            <div key={p.id} class="rail-slot">
              <RailItem label={p.label} icon={p.icon} active={panel === p.id} onPress={() => ui.togglePanel(p.id)} />
            </div>
          ))}
        </div>

        <div class={`rail-group ${sketchMode ? 'hidden' : ''}`}>
          <RailItem label="Sketch" sub="Draw on a face" icon="i-sketch" active={false} onPress={() => this.enterSketch()} />
        </div>

        <div class={`rail-group ${sketchMode ? '' : 'hidden'}`}>
          <RailItem label="Exit Sketching" sub="Back to the model" icon="i-close" active={false} onPress={() => this.exitSketch()} />
        </div>

        <div class={`rail-group ${sketchMode ? '' : 'hidden'}`}>
          {sketchTools.map((t) => (
            <div key={t.id} class="rail-slot">
              <RailItem label={t.label} sub={t.sub} icon={t.icon} active={tool === t.id} onPress={() => this.pickTool(t.id)} />
            </div>
          ))}
        </div>

        <div class="rail-group rail-lower">
          <RailItem label="Section View" sub={sectionOn ? 'On' : 'Off'} icon="i-section" active={sectionOn} onPress={() => this.toggleSection()} />
          <RailItem label="Parts" sub={parts.count === 1 ? '1 part' : `${parts.count} parts`} icon="i-layers" active={parts.open} onPress={() => parts.toggle()} />
          <RailItem label="Measure" sub={tool === 'measure' ? 'On' : 'Off'} icon="i-measure" active={tool === 'measure'} onPress={() => this.toggleMeasure()} />
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

  enterSketch() {
    ui.sketchMode = true
    sketcher.setTool('line')
  }

  exitSketch() {
    ui.sketchMode = false
    sketcher.exit()
  }

  pickTool(id) {
    // A second click on the active tool switches its variant.
    if (sketch.tool === id) sketcher.cycleOption(id)
    else sketcher.setTool(id)
  }

  toggleMeasure() {
    if (sketch.tool === 'measure') sketcher.setTool(ui.sketchMode ? 'line' : null)
    else sketcher.setTool('measure')
  }

  toggleSection() {
    ui.sectionOn = !ui.sectionOn
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
