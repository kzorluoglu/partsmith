import { Component } from '@geajs/core'
import { initScene, setGeometry, setVisibility, setShading, buildPlate, frameModel, destroyScene, isSoftware, enablePicking, showSketch, setProjection, setOverlayVisible } from '../lib/scene.js'
import SketchToolbar from './sketch-toolbar.tsx'
import ViewCube from './view-cube.tsx'
import ViewTools from './view-tools.tsx'
import ui from '../stores/ui-store.js'
import sketch from '../stores/sketch-store.js'
import { on } from '../lib/bus.js'
import settings from '../stores/settings-store.js'
import model from '../stores/model-store.js'

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

        <div class="viewer-corner">
          <ViewCube />
          <ViewTools />
        </div>

        {/* Always mounted, only shown in sketch mode: unmounting would drop
            its document level key handler and any half drawn profile. */}
        <div class={`sketch-dock ${ui.sketchMode ? 'open' : ''}`}>
          <SketchToolbar />
        </div>

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

      enablePicking({
        onPoly: (state) => sketch.onPoly(state),
        onSelect: (plane) => sketch.onSelect(plane),
        onSketch: (shape, plane) => {
          sketch.onSketch(shape, plane)
          // Keep the outline visible while the depth popover is open.
          showSketch(shape, plane)
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
