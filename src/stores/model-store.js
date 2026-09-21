import { Store } from '@geajs/core'
import { runScript, exportModel } from '../lib/runner.js'
import { printWarnings, estimateMaterial } from '../lib/print.js'
import { saveFile, slugify, formatBytes } from '../lib/download.js'
import { STARTER } from '../lib/examples.js'
import { emit } from '../lib/bus.js'
import settings from './settings-store.js'

const CODE_STORAGE = 'printforge.code'

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
  exportInfo = ''

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

  setCode(code, { remember = true } = {}) {
    if (remember && this.code && this.code !== code) {
      this.history = [...this.history.slice(-9), this.code]
    }
    this.code = code
    try {
      localStorage.setItem(CODE_STORAGE, code)
    } catch {
      /* ignore */
    }
  }

  undo() {
    if (this.history.length === 0) return
    const previous = this.history[this.history.length - 1]
    this.history = this.history.slice(0, -1)
    this.setCode(previous, { remember: false })
    this.run()
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
    if (this.running) return false
    this.running = true
    this.error = ''
    try {
      const result = await runScript(this.code, keepParams ? this.params : {}, {
        autoPlace: settings.autoPlace
      })
      this.paramDefs = result.paramDefs
      this.params = result.paramValues
      this.stats = result.stats
      this.warnings = printWarnings(result.stats, settings.printer)
      emit('geometry', { positions: result.positions, normals: result.normals, stats: result.stats })
      return true
    } catch (error) {
      this.error = error.message
      this.stats = null
      this.warnings = []
      emit('geometry', null)
      return false
    } finally {
      this.running = false
    }
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
