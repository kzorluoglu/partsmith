import { Store } from '@geajs/core'
import { getApiKey, setApiKey, listModels, streamCompletion, fetchCredits } from '../lib/openrouter.js'
import { SYSTEM_PROMPT, contextMessage, repairMessage, extractCode } from '../lib/prompt.js'
import settings from './settings-store.js'
import model from './model-store.js'

const MODEL_STORAGE = 'printforge.model'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

/** Chat state and the generate / refine / repair loop. */
class AiStore extends Store {
  apiKey = getApiKey()
  modelId = localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL
  models = []
  modelsError = ''
  messages = []
  draft = ''
  streaming = false
  streamText = ''
  error = ''
  credits = null
  settingsOpen = false

  controller = null

  get ready() {
    return Boolean(this.apiKey)
  }

  get currentModel() {
    return this.models.find((m) => m.id === this.modelId) || null
  }

  async init() {
    if (!this.ready) this.settingsOpen = true
    try {
      this.models = await listModels()
    } catch (error) {
      this.modelsError = error.message
    }
    this.refreshCredits()
  }

  async refreshCredits() {
    if (!this.apiKey) return
    this.credits = await fetchCredits(this.apiKey).catch(() => null)
  }

  saveKey(key) {
    const trimmed = key.trim()
    this.apiKey = trimmed
    setApiKey(trimmed)
    this.error = ''
    this.refreshCredits()
  }

  selectModel(id) {
    this.modelId = id
    try {
      localStorage.setItem(MODEL_STORAGE, id)
    } catch {
      /* ignore */
    }
  }

  abort() {
    this.controller?.abort()
    this.controller = null
    this.streaming = false
  }

  /**
   * Builds the conversation sent upstream: system prompt, a fresh snapshot of
   * the model state, then the chat so far. Only the newest script is included,
   * older ones are replaced by a marker to keep the context small.
   */
  buildMessages(userText) {
    const history = this.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map((m, index, all) => ({
        role: m.role,
        content: m.role === 'assistant' && index < all.length - 1
          ? '[previous script omitted]'
          : m.content
      }))

    return [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: contextMessage({
          stats: model.stats,
          printer: settings.printer,
          material: settings.material,
          warnings: model.warnings
        })
      },
      ...history,
      { role: 'user', content: userText }
    ]
  }

  /** One streamed round trip. Returns the assistant text. */
  async complete(messages) {
    this.controller = new AbortController()
    this.streaming = true
    this.streamText = ''
    try {
      return await streamCompletion({
        key: this.apiKey,
        model: this.modelId,
        messages,
        signal: this.controller.signal,
        onDelta: (_, full) => { this.streamText = full }
      })
    } finally {
      this.streaming = false
      this.controller = null
      this.streamText = ''
    }
  }

  /**
   * Sends a prompt, runs whatever script comes back, and if the script throws
   * gives the model one chance to fix its own error before giving up.
   */
  async send(text) {
    const userText = (text ?? this.draft).trim()
    if (!userText || this.streaming) return
    this.draft = ''
    this.error = ''
    this.messages = [...this.messages, { role: 'user', content: userText, at: Date.now() }]

    try {
      const reply = await this.complete(this.buildMessages(userText))
      await this.applyReply(reply, userText)
      this.refreshCredits()
    } catch (error) {
      if (error.name === 'AbortError') return
      this.error = error.message
      this.messages = [...this.messages, { role: 'error', content: error.message, at: Date.now() }]
    }
  }

  async applyReply(reply, userText) {
    const code = extractCode(reply)
    model.setCode(code)
    this.messages = [...this.messages, { role: 'assistant', content: code, at: Date.now() }]
    if (!model.name || model.name === 'model') model.name = userText.slice(0, 40)

    const ok = await model.run()
    if (ok) return

    // The script threw. Hand the error back once and rerun.
    this.messages = [...this.messages, { role: 'note', content: `Script failed: ${model.error}. Asking the model to fix it.`, at: Date.now() }]
    const fixed = await this.complete([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: repairMessage(model.error, code) }
    ])
    const fixedCode = extractCode(fixed)
    model.setCode(fixedCode)
    this.messages = [...this.messages, { role: 'assistant', content: fixedCode, at: Date.now() }]
    await model.run()
  }

  clear() {
    this.messages = []
    this.error = ''
  }
}

export default new AiStore()
