import { Component } from '@geajs/core'
import { setVisibility, setProjection, setOverlayVisible, frameModel, setView } from '../lib/scene.js'
import settings from '../stores/settings-store.js'
import model from '../stores/model-store.js'

const LOOKS = [
  { id: 'studio', label: 'Studio', title: 'Glossy filament look, soft reflections, no shadows' },
  { id: 'cad', label: 'CAD', title: 'Matte grey engineering look' },
  { id: 'clay', label: 'Clay', title: 'Warm matte clay' },
  { id: 'normal', label: 'Normals', title: 'Colour by surface normal, spots flipped faces' }
]

/** Right hand column under the view cube: camera and display switches. */
export default class ViewTools extends Component {
  lookOpen = false

  template() {
    const ortho = settings.projection === 'ortho'
    return (
      <div class="viewtools">
        <div class="tool-group">
          <button class="tbtn" title="Home view" click={() => setView('iso')}><span class="ico i-home"></span></button>
          <button class="tbtn" title="Zoom to fit" click={() => frameModel(model.stats)}><span class="ico i-fit"></span></button>
          <button
            class={`tbtn ${ortho ? 'on' : ''}`}
            title={ortho ? 'Orthographic, click for perspective' : 'Perspective, click for orthographic'}
            click={() => this.projection(ortho ? 'persp' : 'ortho')}
          ><span class={`ico ${ortho ? 'i-ortho' : 'i-persp'}`}></span></button>
        </div>

        <div class="tool-group">
          <button class={`tbtn ${settings.showGrid ? 'on' : ''}`} title="Grid" click={() => this.toggle('showGrid')}><span class="ico i-grid"></span></button>
          <button class={`tbtn ${settings.showWireframe ? 'on' : ''}`} title="Edges" click={() => this.toggle('showWireframe')}><span class="ico i-edges"></span></button>
          <button class={`tbtn ${settings.showBuildVolume ? 'on' : ''}`} title="Printer bed and build volume" click={() => this.toggle('showBuildVolume')}><span class="ico i-volume"></span></button>
          <button class={`tbtn ${settings.showAxes ? 'on' : ''}`} title="Axes" click={() => this.toggle('showAxes')}><span class="ico i-axes"></span></button>
          <button class={`tbtn ${settings.showSketch ? 'on' : ''}`} title="Sketch overlay, never exported" click={() => this.overlay()}><span class="ico i-eye"></span></button>
        </div>

        <div class="tool-group">
          <button class={`tbtn ${this.lookOpen ? 'on' : ''}`} title="Look" click={() => { this.lookOpen = !this.lookOpen }}><span class="ico i-shade"></span></button>
        </div>

        <div class={`look-menu ${this.lookOpen ? 'open' : ''}`}>
          {LOOKS.map((l) => (
            <button
              key={l.id}
              class={`look ${settings.shading === l.id ? 'on' : ''}`}
              title={l.title}
              click={() => this.look(l.id)}
            >{l.label}</button>
          ))}
        </div>
      </div>
    )
  }

  toggle(key) {
    settings.toggle(key)
    setVisibility(settings)
  }

  overlay() {
    settings.toggle('showSketch')
    setOverlayVisible(settings.showSketch)
  }

  projection(mode) {
    settings.set('projection', mode)
    setProjection(mode)
  }

  look(id) {
    settings.set('shading', id)
    this.lookOpen = false
  }
}
