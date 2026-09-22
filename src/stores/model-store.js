import { Store } from '@geajs/core'
import { runScript, exportModel } from '../lib/runner.js'
import { printWarnings, estimateMaterial } from '../lib/print.js'
import { saveFile, slugify, formatBytes } from '../lib/download.js'
import { STARTER } from '../lib/examples.js'
import { bakeFeatures } from '../lib/features.js'
import { emit } from '../lib/bus.js'
import settings from './settings-store.js'

const CODE_STORAGE = 'partsmith.code'
const FEATURES_STORAGE = 'partsmith.features'

const loadFeatures = () => {
  try {
    return JSON.parse(localStorage.getItem(FEATURES_STORAGE) || '[]')
  } catch {
    return []
  }
}

const loadCode = () => {
  try {
    return localStorage.getItem(CODE_STORAGE) || STARTER
  } catch {
    return STARTER
  }
}

/** The script, its parameters and everything derived from the last run. */
class ModelStore extends Store {
  code = loadCode()
  name = 'model'
  params = {}
  paramDefs = []
  stats = null
  warnings = []
  running = false
  error = ''
  history = []
  future = []
  queued = false
  exportInfo = ''
  features = loadFeatures()
  planes = []

  get material() {
    if (!this.stats) return null
    return estimateMaterial(this.stats.volume, {
      density: settings.material.density,
      infill: settings.infill
    })
  }

  get cost() {
    const material = this.material
    if (!material) return 0
    return (material.grams / 1000) * settings.material.pricePerKg
  }

  /* ---- history --------------------------------------------------------
     A snapshot is the script plus the sketch features, so undo covers both a
     model rewrite from the AI and a cut drawn in the viewer. */

  snapshot() {
    return { code: this.code, features: JSON.parse(JSON.stringify(this.features)) }
  }

  remember() {
    this.history = [...this.history.slice(-29), this.snapshot()]
    this.future = []
  }

  restore(state) {
    this.code = state.code
    this.features = state.features
    try {
      localStorage.setItem(CODE_STORAGE, state.code)
    } catch {
      /* ignore */
    }
    this.persistFeatures()
    return this.run({ keepParams: true })
  }

  get canUndo() {
    return this.history.length > 0
  }

  get canRedo() {
    return this.future.length > 0
  }

  undo() {
    if (this.history.length === 0) return
    const previous = this.history[this.history.length - 1]
    this.history = this.history.slice(0, -1)
    this.future = [...this.future, this.snapshot()]
    return this.restore(previous)
  }

  redo() {
    if (this.future.length === 0) return
    const next = this.future[this.future.length - 1]
    this.future = this.future.slice(0, -1)
    this.history = [...this.history, this.snapshot()]
    return this.restore(next)
  }

  setCode(code, { remember = true } = {}) {
    if (remember && this.code && this.code !== code) this.remember()
    this.code = code
    try {
      localStorage.setItem(CODE_STORAGE, code)
    } catch {
      /* ignore */
    }
  }

  setParam(name, value) {
    this.params = { ...this.params, [name]: value }
    this.run({ keepParams: true })
  }

  resetParams() {
    this.params = {}
    this.run()
  }

  /**
   * Evaluates the current script. Resolves to true on success so callers like
   * the AI flow can decide whether to ask the model for a repair.
   */
  async run({ keepParams = false } = {}) {
    // A build is already going: remember that another one is wanted instead
    // of dropping the call, otherwise the last value of a dragged slider or
    // an undo during a rebuild would never make it to the screen.
    if (this.running) {
      this.queued = true
      return false
    }
    this.running = true
    this.error = ''
    try {
      const result = await runScript(this.code, keepParams ? this.params : {}, {
        autoPlace: settings.autoPlace,
        features: this.features
      })
      this.paramDefs = result.paramDefs
      this.params = result.paramValues
      this.stats = result.stats
      this.planes = result.planes
      this.warnings = printWarnings(result.stats, settings.printer)
      emit('geometry', {
        positions: result.positions,
        normals: result.normals,
        planeIds: result.planeIds,
        planes: result.planes,
        edgePositions: result.edgePositions,
        stats: result.stats
      })
      return true
    } catch (error) {
      this.error = error.message
      this.stats = null
      this.warnings = []
      emit('geometry', null)
      return false
    } finally {
      this.running = false
      if (this.queued) {
        this.queued = false
        this.run({ keepParams: true })
      }
    }
  }

  /* ---- sketch features ------------------------------------------------ */

  persistFeatures() {
    try {
      localStorage.setItem(FEATURES_STORAGE, JSON.stringify(this.features))
    } catch {
      /* ignore */
    }
  }

  addFeature(feature) {
    this.remember()
    this.features = [...this.features, { id: Date.now().toString(36), ...feature }]
    this.persistFeatures()
    return this.run({ keepParams: true })
  }

  updateFeature(id, patch) {
    this.remember()
    this.features = this.features.map((f) => (f.id === id ? { ...f, ...patch } : f))
    this.persistFeatures()
    return this.run({ keepParams: true })
  }

  removeFeature(id) {
    this.remember()
    this.features = this.features.filter((f) => f.id !== id)
    this.persistFeatures()
    return this.run({ keepParams: true })
  }

  clearFeatures() {
    this.remember()
    this.features = []
    this.persistFeatures()
    return this.run({ keepParams: true })
  }

  /**
   * Writes the features into the script as JSCAD code and empties the list.
   * From then on they are ordinary geometry the AI can see and edit.
   */
  async bakeFeatures() {
    if (this.features.length === 0) return
    const before = this.snapshot()
    // One undo step for the whole bake, taken before the features are cleared.
    this.remember()
    const baked = bakeFeatures(this.code, this.features, { autoPlace: settings.autoPlace })
    this.features = []
    this.persistFeatures()
    this.setCode(baked, { remember: false })
    const ok = await this.run({ keepParams: true })
    if (!ok) {
      // Roll back rather than leave a broken script and lost features.
      this.history = this.history.slice(0, -1)
      await this.restore(before)
    }
    return ok
  }

  async download(format) {
    if (!this.stats) return
    try {
      const { parts, mimeType, extension } = await exportModel(format)
      const size = saveFile(parts, `${slugify(this.name)}.${extension}`, mimeType)
      this.exportInfo = `Saved ${slugify(this.name)}.${extension} (${formatBytes(size)})`
    } catch (error) {
      this.error = error.message
    }
  }

  downloadScript() {
    const size = saveFile([this.code], `${slugify(this.name)}.jscad.js`, 'text/javascript')
    this.exportInfo = `Saved ${slugify(this.name)}.jscad.js (${formatBytes(size)})`
  }
}

export default new ModelStore()
