import { Component } from '@geajs/core'
import ai from '../stores/ai-store.js'

const SUGGESTED = [
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4.1',
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  'deepseek/deepseek-chat',
  'qwen/qwen3-coder'
]

/** API key and model picker. Everything here stays in this browser. */
export default class SettingsDialog extends Component {
  keyEl = null
  filter = ''

  template() {
    if (!ai.settingsOpen) return <div class="dialog-hidden"></div>

    const needle = this.filter.trim().toLowerCase()
    const list = (needle
      ? ai.models.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      : ai.models.filter((m) => SUGGESTED.includes(m.id))
    ).slice(0, 40)

    return (
      <div class="backdrop" click={this.maybeClose}>
        <div class="dialog">
          <header class="dialog-head">
            <h2>OpenRouter</h2>
            <button class="icon-button" title="Close (Esc)" aria-label="Close" click={this.close}>×</button>
          </header>

          <label class="field">
            <span>API key</span>
            <input
              ref={this.keyEl}
              type="password"
              placeholder="sk-or-v1-…"
              value={ai.apiKey}
              change={(e) => ai.saveKey(e.target.value)}
            />
          </label>
          <p class="hint">
            Stored in this browser's localStorage and sent only to openrouter.ai. There is no backend.
            Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.
          </p>

          {ai.credits && (
            <p class="hint">Used ${Number(ai.credits.usage).toFixed(2)}{ai.credits.limit ? ` of $${Number(ai.credits.limit).toFixed(2)}` : ''}.</p>
          )}

          <label class="field">
            <span>Model</span>
            <input
              type="search"
              placeholder="filter all models, empty shows the good ones for CAD"
              input={(e) => { this.filter = e.target.value }}
            />
          </label>

          {ai.modelsError && <p class="warning error">{ai.modelsError}</p>}

          <div class="model-list">
            {list.map((entry) => (
              <button
                key={entry.id}
                class={`model-row ${entry.id === ai.modelId ? 'on' : ''}`}
                click={() => ai.selectModel(entry.id)}
              >
                <span class="model-name">{entry.name}</span>
                <span class="model-meta">
                  {entry.free ? 'free' : `$${(entry.promptPrice * 1e6).toFixed(2)} / $${(entry.completionPrice * 1e6).toFixed(2)} per M`}
                </span>
              </button>
            ))}
            {list.length === 0 && <p class="empty">No model matches that filter.</p>}
          </div>

          <footer class="dialog-foot">
            <span class="hint">{ai.apiKey ? 'Key saved in this browser.' : 'Paste a key to start generating.'}</span>
            <button class="button" click={this.close}>Done</button>
          </footer>
        </div>
      </div>
    )
  }

  close = () => { ai.settingsOpen = false }

  maybeClose = (event) => {
    if (event.target === event.currentTarget) this.close()
  }

  onKeydown = (event) => {
    if (event.key === 'Escape' && ai.settingsOpen) this.close()
  }

  onAfterRender() {
    // The dialog is always mounted, so the key handler lives on the document
    // rather than on an element that comes and goes.
    document.addEventListener('keydown', this.onKeydown)
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeydown)
    super.dispose()
  }
}
