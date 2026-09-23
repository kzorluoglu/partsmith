import { Component } from '@geajs/core'
import model from '../stores/model-store.js'
import ai from '../stores/ai-store.js'
import ui from '../stores/ui-store.js'

/** Top centre pill: project name, build state, export, settings. */
export default class ProjectBar extends Component {
  template() {
    const { running, stats } = model
    return (
      <div class="projectbar">
        <span class="brand-mark" title="PartSmith">◆</span>
        <input
          class="project-name"
          value={model.name}
          change={(e) => { model.name = e.target.value || 'model' }}
          aria-label="Project name"
          spellcheck="false"
        />
        <span class={`state-dot ${running ? 'busy' : stats?.manifold ? 'ok' : stats ? 'bad' : ''}`}
          title={running ? 'Building…' : stats?.manifold ? 'Watertight, ready to print' : stats ? 'Not watertight' : ''}></span>

        <div class="export-wrap">
          <button class="pill-btn primary" disabled={!stats} click={() => { ui.exportOpen = !ui.exportOpen }}>
            <span class="ico sm i-export"></span>Export
          </button>
          <div class={`export-menu ${ui.exportOpen ? 'open' : ''}`}>
            <button class="menu-item" click={() => this.download('stl')}>STL <span class="menu-hint">binary, any slicer</span></button>
            <button class="menu-item" click={() => this.download('stl', true)}>STL parts <span class="menu-hint">one file per solid</span></button>
            <button class="menu-item" click={() => this.download('3mf')}>3MF <span class="menu-hint">Bambu, Prusa, Orca</span></button>
            <button class="menu-item" click={() => this.download('3mf', true)}>3MF parts <span class="menu-hint">one file per solid</span></button>
            <button class="menu-item" click={() => this.script()}>Script <span class="menu-hint">.jscad.js source</span></button>
          </div>
        </div>

        <button class={`pill-btn icon ${ai.ready ? '' : 'attention'}`} title={ai.ready ? 'Settings' : 'Add an API key'} click={() => { ai.settingsOpen = true }}>
          <span class="ico sm i-gear"></span>
        </button>
      </div>
    )
  }

  download(format, separate = false) {
    ui.exportOpen = false
    model.download(format, separate)
  }

  script() {
    ui.exportOpen = false
    model.downloadScript()
  }

  onOutside = (event) => {
    if (ui.exportOpen && !event.target.closest?.('.export-wrap')) ui.exportOpen = false
  }

  onAfterRender() {
    document.addEventListener('pointerdown', this.onOutside)
  }

  dispose() {
    document.removeEventListener('pointerdown', this.onOutside)
    super.dispose()
  }
}
