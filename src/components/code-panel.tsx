import { Component } from '@geajs/core'
import { EditorView, basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import model from '../stores/model-store.js'

/** CodeMirror view over the current script, with a manual run button. */
export default class CodePanel extends Component {
  hostEl = null
  dirty = false
  editor = null

  template() {
    return (
      <section class="panel code">
        <header class="panel-head">
          <h2>Script</h2>
          <div class="panel-head-actions">
            {this.dirty && <span class="hint">unsaved</span>}
            <button class="link" disabled={model.history.length === 0} click={() => model.undo()}>undo</button>
            <button class="button small" click={this.apply}>run</button>
          </div>
        </header>
        <div ref={this.hostEl} class="code-host"></div>
      </section>
    )
  }

  apply = () => {
    if (!this.editor) return
    model.setCode(this.editor.state.doc.toString())
    this.dirty = false
    model.run()
  }

  onAfterRender() {
    this.editor = new EditorView({
      parent: this.hostEl,
      state: EditorState.create({
        doc: model.code,
        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.dirty = true
          }),
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, monospace', fontSize: '12px' } })
        ]
      })
    })

    // The model and the undo stack both rewrite the script behind our back.
    this.offCode = model.observe('code', () => {
      const incoming = model.code
      if (!this.editor || incoming === this.editor.state.doc.toString()) return
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: incoming }
      })
      this.dirty = false
    })
  }

  dispose() {
    this.offCode?.()
    this.editor?.destroy()
    super.dispose()
  }
}
