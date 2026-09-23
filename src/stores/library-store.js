import { Store } from '@geajs/core'
import { listProjects, getProject, putProject, deleteProject } from '../lib/project-db.js'
import { thumbnail } from '../lib/scene.js'
import { STARTER } from '../lib/examples.js'
import { on, emit } from '../lib/bus.js'
import model from './model-store.js'
import ai from './ai-store.js'

const CURRENT_STORAGE = 'partsmith.current'
const SAVE_DELAY = 700

const BLANK = { id: '', code: STARTER, name: 'model', messages: [] }

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Structured clone refuses Gea proxies, a JSON round trip gives plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const rememberCurrent = (id) => {
  try {
    if (id) localStorage.setItem(CURRENT_STORAGE, id)
    else localStorage.removeItem(CURRENT_STORAGE)
  } catch {
    /* ignore */
  }
}

let timer = 0
let applying = false     // true while a saved model is being loaded, no autosave then
let thumbWanted = false
let created = 0

/**
 * Every model made in this browser, saved on its own as it changes: script,
 * sketch features, parameters, the conversation and a thumbnail. Kept until
 * the user deletes it. The records live in IndexedDB, this store only holds
 * what the list shows.
 * No constructor, see the note in settings-store.js.
 */
class LibraryStore extends Store {
  projects = []    // { id, name, updatedAt, thumb }
  currentId = ''
  confirmId = ''   // the model whose delete button asks "sure?"
  error = ''
  loaded = false

  async init() {
    try {
      const all = await listProjects()
      this.projects = all.map(meta)
      let wanted = ''
      try { wanted = localStorage.getItem(CURRENT_STORAGE) || '' } catch { /* ignore */ }
      const record = all.find((p) => p.id === wanted)
      if (record) await this.apply(record, { fit: false })
    } catch (error) {
      this.error = error.message
    }
    this.loaded = true

    const later = () => this.scheduleSave()
    model.observe('code', later)
    model.observe('features', later)
    model.observe('params', later)
    model.observe('name', later)
    ai.observe('messages', later)
    // A finished build is what the thumbnail should show.
    on('geometry', (payload) => {
      if (!payload || applying) return
      thumbWanted = true
      this.scheduleSave()
    })
    // An older workspace from before the library becomes its first model.
    if (!this.currentId) this.scheduleSave()
  }

  /** Worth keeping: anything but the untouched starter part. */
  get worthSaving() {
    return ai.messages.length > 0 || (model.code.trim() && model.code !== STARTER) || model.features.length > 0
  }

  scheduleSave() {
    if (applying || !this.loaded) return
    clearTimeout(timer)
    timer = setTimeout(() => this.save(), SAVE_DELAY)
  }

  async save() {
    clearTimeout(timer)
    if (applying || !this.loaded || !this.worthSaving) return
    if (!this.currentId) {
      this.currentId = newId()
      created = Date.now()
      rememberCurrent(this.currentId)
    }
    const id = this.currentId
    const old = this.projects.find((p) => p.id === id)
    let thumb = old?.thumb || ''
    if (thumbWanted || !thumb) {
      thumbWanted = false
      try { thumb = thumbnail() || thumb } catch { /* no preview, keep the old one */ }
    }
    const record = {
      id,
      name: model.name || 'model',
      code: model.code,
      features: plain(model.features),
      params: plain(model.params),
      messages: plain(ai.messages),
      thumb,
      createdAt: old?.createdAt || created || Date.now(),
      updatedAt: Date.now()
    }
    try {
      await putProject(record)
      this.error = ''
    } catch (error) {
      this.error = `Could not save: ${error.message}`
      return
    }
    // The list is newest first, the model just saved moves to the top.
    this.projects = [meta(record), ...this.projects.filter((p) => p.id !== id)]
  }

  async apply(record, { fit = true } = {}) {
    applying = true
    try {
      this.currentId = record.id
      rememberCurrent(record.id)
      ai.load(record.messages || [])
      await model.load(record)
    } finally {
      applying = false
    }
    if (fit) emit('fit-view')
  }

  async open(id) {
    if (id === this.currentId || ai.busy) return
    this.confirmId = ''
    await this.save()
    const record = await getProject(id).catch(() => null)
    if (!record) {
      this.error = 'That model is gone from the browser storage.'
      this.projects = this.projects.filter((p) => p.id !== id)
      return
    }
    await this.apply(record)
  }

  /** Starts over with the starter part and an empty conversation. */
  async newModel() {
    if (ai.busy) return
    this.confirmId = ''
    await this.save()
    await this.apply(BLANK)
  }

  /** First click arms the button, the second one deletes for good. */
  async remove(id) {
    if (this.confirmId !== id) {
      this.confirmId = id
      // An armed button that is left alone goes back to normal.
      setTimeout(() => { if (this.confirmId === id) this.confirmId = '' }, 3000)
      return
    }
    this.confirmId = ''
    try {
      await deleteProject(id)
    } catch (error) {
      this.error = `Could not delete: ${error.message}`
      return
    }
    this.projects = this.projects.filter((p) => p.id !== id)
    if (id === this.currentId) {
      // The open model is gone. Skip open() here, it would save the old
      // workspace first and bring the deleted model straight back.
      clearTimeout(timer)
      this.currentId = ''
      const next = this.projects[0]
      const record = next ? await getProject(next.id).catch(() => null) : null
      await this.apply(record || BLANK)
    }
  }
}

const meta = (record) => ({
  id: record.id,
  name: record.name || 'model',
  updatedAt: record.updatedAt,
  thumb: record.thumb || ''
})

export default new LibraryStore()
