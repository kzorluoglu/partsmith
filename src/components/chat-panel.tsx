import { Component } from '@geajs/core'
import ai from '../stores/ai-store.js'
import model from '../stores/model-store.js'
import library from '../stores/library-store.js'
import { PROMPT_IDEAS } from '../lib/examples.js'
import { emit } from '../lib/bus.js'

const LABELS = {
  user: 'you',
  assistant: 'model',
  note: 'retry',
  error: 'error'
}

/**
 * Conversation log, the live stream of the current reply, and once the first
 * model exists the field for every follow up change.
 */
export default class ChatPanel extends Component {
  logEl = null
  inputEl = null

  template() {
    const { messages, streaming, streamText, error, busy } = ai
    const talking = messages.length > 0

    return (
      <section class="panel chat">
        <header class="panel-head">
          <h2>Conversation</h2>
          <div class="panel-head-actions">
            {talking && <button class="link" title="Keep this model, start a new one" disabled={busy} click={() => library.newModel()}>new model</button>}
          </div>
        </header>

        <div ref={this.logEl} class="chat-log">
          {!talking && !streaming && (
            <div class="chat-empty">
              <p>Describe a part in the bar at the bottom. The model answers with a parametric JSCAD script that is built, checked and shown right away. Or start from one of these:</p>
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

        <form class={`chat-compose ${talking ? '' : 'gone'}`} submit={this.submit}>
          <textarea
            ref={this.inputEl}
            class="chat-input"
            spellcheck="false"
            rows="1"
            placeholder="Ask for a change…"
            keydown={this.onKeydown}
            input={this.autosize}
          ></textarea>
          {streaming
            ? <button type="button" class="round-btn danger" title="Stop" click={() => ai.abort()}><span class="ico sm i-stop"></span></button>
            : <button type="submit" class="round-btn" title="Send (Enter)" disabled={model.running || busy}><span class="ico sm i-send"></span></button>}
        </form>
      </section>
    )
  }

  useIdea(idea) {
    emit('prompt:fill', idea)
  }

  autosize = () => {
    const el = this.inputEl
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
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

  scrollDown() {
    requestAnimationFrame(() => {
      if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight
      // Follow the script as it streams in, otherwise only its first lines
      // are ever visible while the rest arrives below the fold.
      const live = this.logEl?.querySelector('.streaming .msg-code')
      if (live) live.scrollTop = live.scrollHeight
    })
  }

  onAfterRender() {
    this.offStream = ai.observe('streamText', () => this.scrollDown())
    this.offMessages = ai.observe('messages', () => this.scrollDown())
  }

  dispose() {
    this.offStream?.()
    this.offMessages?.()
    super.dispose()
  }
}
