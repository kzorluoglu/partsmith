import { Component } from '@geajs/core'
import { initScene, setGeometry, setVisibility, setShading, buildPlate, frameModel, setView, destroyScene, isSoftware } from '../lib/scene.js'
import { on } from '../lib/bus.js'
import settings from '../stores/settings-store.js'
import model from '../stores/model-store.js'

const VIEWS = ['iso', 'front', 'right', 'top']

/** Hosts the WebGL canvas and the overlays drawn on top of it. */
export default class Viewer extends Component {
  canvasEl = null
  firstFrame = true
  glError = ''
  software = false

  template() {
    const { running, error, stats } = model
    return (
      <section class="viewer">
        <canvas ref={this.canvasEl} class="viewer-canvas"></canvas>

        {this.software && (
          <div class="viewer-software" title="WebGL was unavailable, drawing on the CPU instead">
            software renderer
          </div>
        )}

        {this.glError && (
          <div class="viewer-blocked">
            <strong>No preview</strong>
            <p>{this.glError}</p>
            <p class="hint">The script still runs and STL export still works.</p>
          </div>
        )}

        <div class="viewer-views">
          {VIEWS.map((name) => (
            <button key={name} class="chip" click={() => setView(name)}>{name}</button>
          ))}
          <button class="chip" click={() => frameModel(model.stats)}>fit</button>
        </div>

        <div class="viewer-toggles">
          <button class={`chip ${settings.showGrid ? 'on' : ''}`} click={() => this.toggle('showGrid')}>grid</button>
          <button class={`chip ${settings.showBuildVolume ? 'on' : ''}`} click={() => this.toggle('showBuildVolume')}>volume</button>
          <button class={`chip ${settings.showWireframe ? 'on' : ''}`} click={() => this.toggle('showWireframe')}>edges</button>
          <button class={`chip ${settings.showAxes ? 'on' : ''}`} click={() => this.toggle('showAxes')}>axes</button>
        </div>

        {stats && (
          <div class="viewer-dims">
            {stats.size[0].toFixed(1)} × {stats.size[1].toFixed(1)} × {stats.size[2].toFixed(1)} mm
          </div>
        )}

        {running && <div class="viewer-status">building…</div>}

        {error && (
          <div class="viewer-error">
            <strong>Script error</strong>
            <pre>{error}</pre>
          </div>
        )}
      </section>
    )
  }

  toggle(key) {
    settings.toggle(key)
    setVisibility(settings)
  }

  onAfterRender() {
    // A blocked or missing WebGL context must not take the rest of the app
    // down with it, the script and the exporters work fine without a preview.
    try {
      initScene(this.canvasEl)
      setVisibility(settings)
      buildPlate(settings.printer.volume)

      this.offGeometry = on('geometry', (payload) => {
        setGeometry(payload, { shading: settings.shading, showWireframe: settings.showWireframe })
        if (payload && this.firstFrame) {
          frameModel(payload.stats)
          this.firstFrame = false
        }
      })

      this.offPrinter = settings.observe('printerId', () => buildPlate(settings.printer.volume))
      this.offShading = settings.observe('shading', () => setShading(settings.shading))
      this.software = isSoftware()
    } catch (error) {
      this.glError = error.message || String(error)
    }

    model.run()
  }

  dispose() {
    this.offGeometry?.()
    this.offPrinter?.()
    this.offShading?.()
    if (!this.glError) destroyScene()
    super.dispose()
  }
}
