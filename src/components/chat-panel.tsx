import { Component } from '@geajs/core'
import ai from '../stores/ai-store.js'
import model from '../stores/model-store.js'
import { PROMPT_IDEAS } from '../lib/examples.js'

const LABELS = {
  user: 'you',
  assistant: 'model',
  note: 'retry',
  error: 'error'
}

/** Prompt input, conversation log and the live stream of the current reply. */
export default class ChatPanel extends Component {
  inputEl = null
  logEl = null

  template() {
    const { messages, streaming, streamText, error } = ai

    return (
      <section class="panel chat">
        <header class="panel-head">
          <h2>Describe the part</h2>
          <div class="panel-head-actions">
            {messages.length > 0 && <button class="link" click={() => ai.clear()}>clear</button>}
            <button class="link" click={() => { ai.settingsOpen = true }}>settings</button>
          </div>
        </header>

        <div ref={this.logEl} class="chat-log">
          {messages.length === 0 && !streaming && (
            <div class="chat-empty">
              <p>Ask for a part in plain words. The model answers with a parametric JSCAD script that is built, checked and shown right away.</p>
              <div class="ideas">
                {PROMPT_IDEAS.map((idea) => (
                  <button key={idea} class="idea" click={() => this.useIdea(idea)}>{idea}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <article key={message.at} class={`msg msg-${message.role}`}>
              <span class="msg-role">{LABELS[message.role] || message.role}</span>
              {message.role === 'assistant'
                ? <pre class="msg-code">{message.content}</pre>
                : <p class="msg-text">{message.content}</p>}
            </article>
          ))}

          {streaming && (
            <article class="msg msg-assistant streaming">
              <span class="msg-role">model</span>
              <pre class="msg-code">{streamText || 'thinking…'}</pre>
            </article>
          )}
        </div>

        {error && <p class="chat-error">{error}</p>}

        <form class="chat-form" submit={this.submit}>
          <textarea
            ref={this.inputEl}
            class="chat-input"
            rows="3"
            placeholder="e.g. a wall hook for a 20 mm rail, 3 mm walls, two screw holes"
            keydown={this.onKeydown}
          ></textarea>
          <div class="chat-actions">
            <span class="hint">{ai.modelId}</span>
            {streaming
              ? <button type="button" class="button danger" click={() => ai.abort()}>stop</button>
              : <button type="submit" class="button" disabled={model.running}>generate</button>}
          </div>
        </form>
      </section>
    )
  }

  useIdea(idea) {
    this.inputEl.value = idea
    this.inputEl.focus()
  }

  onKeydown = (event) => {
    // Enter sends, shift+enter keeps the newline, same as every chat box.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.submit(event)
    }
  }

  submit = (event) => {
    event.preventDefault()
    const text = this.inputEl.value.trim()
    if (!text) return
    this.inputEl.value = ''
    ai.send(text).then(() => this.scrollDown())
    this.scrollDown()
  }

  scrollDown() {
    requestAnimationFrame(() => {
      if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight
    })
  }

  onAfterRender() {
    this.offStream = ai.observe('streamText', () => this.scrollDown())
  }

  dispose() {
    this.offStream?.()
    super.dispose()
  }
}
