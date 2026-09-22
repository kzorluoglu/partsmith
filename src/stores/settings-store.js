import { Store } from '@geajs/core'
import { PRINTERS, MATERIALS } from '../lib/print.js'

const STORAGE = 'partsmith.settings'

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}')
  } catch {
    return {}
  }
}

/**
 * Saved values, read once at module load. Settings from before the studio
 * look drop their old shading so the new default applies once; after that
 * the user's own pick sticks.
 */
const saved = (() => {
  const data = load()
  if (data.version !== 2) {
    delete data.shading
    delete data.projection
  }
  return data
})()

const pick = (key, fallback) => (key in saved ? saved[key] : fallback)

/**
 * Viewer and print preferences, persisted so a reload keeps the setup.
 *
 * No constructor on purpose: Gea's compiler only turns a Store subclass into
 * its reactive compiled form when it has none. With a constructor the class
 * stays a plain Store and no template ever sees its changes, which is why the
 * display toggles once looked stuck.
 */
class SettingsStore extends Store {
  printerId = pick('printerId', 'bambu-a1')
  materialId = pick('materialId', 'pla')
  infill = pick('infill', 0.2)
  showGrid = pick('showGrid', true)
  showBuildVolume = pick('showBuildVolume', true)
  showWireframe = pick('showWireframe', true)
  showAxes = pick('showAxes', true)
  autoPlace = pick('autoPlace', true)
  shading = pick('shading', 'studio')
  showSketch = pick('showSketch', true)
  projection = pick('projection', 'persp')
  version = 2

  get printer() {
    return PRINTERS.find((p) => p.id === this.printerId) || PRINTERS[0]
  }

  get material() {
    return MATERIALS.find((m) => m.id === this.materialId) || MATERIALS[0]
  }

  set(key, value) {
    this[key] = value
    this.persist()
  }

  toggle(key) {
    this[key] = !this[key]
    this.persist()
  }

  persist() {
    const snapshot = {}
    for (const key of ['printerId', 'materialId', 'infill', 'showGrid', 'showBuildVolume', 'showWireframe', 'showAxes', 'autoPlace', 'shading', 'showSketch', 'projection', 'version']) {
      snapshot[key] = this[key]
    }
    try {
      localStorage.setItem(STORAGE, JSON.stringify(snapshot))
    } catch {
      /* ignore quota or private mode */
    }
  }
}

export default new SettingsStore()
