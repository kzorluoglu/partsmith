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

/** Viewer and print preferences, persisted so a reload keeps the setup. */
class SettingsStore extends Store {
  printerId = 'bambu-a1'
  materialId = 'pla'
  infill = 0.2
  showGrid = true
  showBuildVolume = true
  showWireframe = false
  showAxes = true
  autoPlace = true
  shading = 'matcap'

  constructor() {
    super()
    Object.assign(this, load())
  }

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
    for (const key of ['printerId', 'materialId', 'infill', 'showGrid', 'showBuildVolume', 'showWireframe', 'showAxes', 'autoPlace', 'shading']) {
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
