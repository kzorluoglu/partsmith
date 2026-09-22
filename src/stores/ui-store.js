import { Store } from '@geajs/core'

const STORAGE = 'partsmith.ui'

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}')
  } catch {
    return {}
  }
}

const saved = load()

/**
 * Layout state of the floating shell: which side panel is open, whether the
 * sketch toolbar is out, and the export menu. Nothing here touches the model.
 * No constructor, see the note in settings-store.js.
 */
class UiStore extends Store {
  panel = 'panel' in saved ? saved.panel : 'chat'
  sketchMode = false
  exportOpen = false

  /** Clicking the active rail button again closes its panel. */
  togglePanel(id) {
    this.panel = this.panel === id ? null : id
    this.persist()
  }

  openPanel(id) {
    if (this.panel === id) return
    this.panel = id
    this.persist()
  }

  persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({ panel: this.panel }))
    } catch {
      /* ignore */
    }
  }
}

export default new UiStore()
