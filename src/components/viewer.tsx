import { Component } from '@geajs/core'
import { initScene, setGeometry, setVisibility, setShading, buildPlate, frameModel, destroyScene, isSoftware, setProjection, setOverlayVisible } from '../lib/scene.js'
import * as sketcher from '../lib/sketcher.js'
import ViewCube from './view-cube.tsx'
import ViewTools from './view-tools.tsx'
import SketchHud from './sketch-hud.tsx'
import SectionControl from './section-control.tsx'
import { on } from '../lib/bus.js'
import settings from '../stores/settings-store.js'
import model from '../stores/model-store.js'

/** Hosts the WebGL canvas and the overlays drawn on top of it. */
export default class Viewer extends Component {
  canvasEl = null
  pillLayer = null
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

        <div class="viewer-corner">
          <ViewCube />
          <ViewTools />
        </div>

        {/* Dimension pills, positioned by the sketcher in canvas pixels. */}
        <div ref={this.pillLayer} class="dim-layer"></div>

        <SketchHud />
        <SectionControl />

        <div class="statusbar">
          {stats && <span class="stat">{stats.size[0].toFixed(1)} × {stats.size[1].toFixed(1)} × {stats.size[2].toFixed(1)} mm</span>}
          {stats && <span class="stat muted">{stats.triangles.toLocaleString()} tris</span>}
          {running && <span class="stat busy">building</span>}
        </div>

        {error && (
          <div class="viewer-error">
            <strong>Script error</strong>
            <pre>{error}</pre>
          </div>
        )}
      </section>
    )
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

      setProjection(settings.projection)
      setOverlayVisible(settings.showSketch)

      sketcher.init(this.pillLayer)

      this.offFit = on('fit-view', () => frameModel(model.stats))

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
    this.offFit?.()
    this.offPrinter?.()
    this.offShading?.()
    if (!this.glError) destroyScene()
    super.dispose()
  }
}
