import { Component } from '@geajs/core'
import ai from '../stores/ai-store.js'
import model from '../stores/model-store.js'
import { on } from '../lib/bus.js'

/**
 * Floating prompt at the bottom centre, for the first description of a new
 * model. Once a conversation exists it steps aside and every follow up goes
 * through the chat panel. Enter sends, Shift+Enter breaks.
 */
export default class PromptBar extends Component {
  inputEl = null

  template() {
    const { streaming, busy, ready, messages } = ai
    return (
      <form class={`promptbar ${messages.length ? 'docked' : ''}`} submit={this.submit}>
        <span class="ico i-spark promptbar-mark"></span>
        <textarea
          ref={this.inputEl}
          class="promptbar-input"
          spellcheck="false"
          rows="1"
          placeholder={ready ? 'Describe a part, or ask to change this one…' : 'Add an API key to start generating'}
          keydown={this.onKeydown}
          input={this.autosize}
        ></textarea>
        <span class="promptbar-model" title="Model, change it in settings">{ai.modelId.split('/').pop()}</span>
        {streaming
          ? <button type="button" class="round-btn danger" title="Stop" click={() => ai.abort()}><span class="ico sm i-stop"></span></button>
          : <button type="submit" class="round-btn" title="Generate (Enter)" disabled={model.running || busy}><span class="ico sm i-send"></span></button>}
      </form>
    )
  }

  autosize = () => {
    const el = this.inputEl
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  onKeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.submit(event)
    }
  }

  submit = (event) => {
    event.preventDefault()
    if (!ai.submit(this.inputEl.value)) return
    this.inputEl.value = ''
    this.autosize()
  }

  onAfterRender() {
    // Idea chips in the chat panel fill this box.
    this.offFill = on('prompt:fill', (text) => {
      this.inputEl.value = text
      this.autosize()
      this.inputEl.focus()
    })
  }

  dispose() {
    this.offFill?.()
    super.dispose()
  }
}
