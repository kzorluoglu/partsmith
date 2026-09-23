import { Component } from '@geajs/core'
import library from '../stores/library-store.js'
import ai from '../stores/ai-store.js'

const when = (time) => {
  const d = new Date(time)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Every model saved in this browser. Click to open, delete asks once. */
export default class LibraryPanel extends Component {
  template() {
    const { projects, currentId, confirmId, error, loaded } = library
    const { busy } = ai
    return (
      <section class="panel library">
        <header class="panel-head">
          <h2>Models</h2>
          <div class="panel-head-actions">
            <button class="link" disabled={busy} click={() => library.newModel()}>new model</button>
          </div>
        </header>

        {error && <p class="chat-error">{error}</p>}
        {loaded && projects.length === 0 && (
          <p class="empty">Nothing saved yet. Every model you generate is kept here in this browser until you delete it.</p>
        )}

        <div class="library-list">
          {projects.map((p) => (
            <div key={p.id} class={`library-item ${p.id === currentId ? 'on' : ''}`} click={() => library.open(p.id)}>
              <div class="library-thumb">{p.thumb && <img src={p.thumb} alt="" />}</div>
              <div class="library-text">
                <span class="library-name">{p.name}</span>
                <span class="library-date">{p.id === currentId ? 'open now' : when(p.updatedAt)}</span>
              </div>
              <button
                class={`library-delete ${confirmId === p.id ? 'armed' : ''}`}
                title="Delete this model from the browser"
                click={(e) => { e.stopPropagation(); library.remove(p.id) }}
              >{confirmId === p.id ? 'Delete?' : '×'}</button>
            </div>
          ))}
        </div>
      </section>
    )
  }
}
