import { Component } from '@geajs/core'
import ai from '../stores/ai-store.js'
import { PROMPT_IDEAS } from '../lib/examples.js'
import { emit } from '../lib/bus.js'

const LABELS = {
  user: 'you',
  assistant: 'model',
  note: 'retry',
  error: 'error'
}

/** Prompt input, conversation log and the live stream of the current reply. */
export default class ChatPanel extends Component {
  logEl = null

  template() {
    const { messages, streaming, streamText, error } = ai

    return (
      <section class="panel chat">
        <header class="panel-head">
          <h2>Conversation</h2>
          <div class="panel-head-actions">
            {messages.length > 0 && <button class="link" click={() => ai.clear()}>clear</button>}
          </div>
        </header>

        <div ref={this.logEl} class="chat-log">
          {messages.length === 0 && !streaming && (
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
      </section>
    )
  }

  useIdea(idea) {
    emit('prompt:fill', idea)
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
  }

  dispose() {
    this.offStream?.()
    super.dispose()
  }
}
