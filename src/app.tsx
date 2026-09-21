import { Component } from '@geajs/core'
import Viewer from './components/viewer.tsx'
import ChatPanel from './components/chat-panel.tsx'
import ParamPanel from './components/param-panel.tsx'
import StatsPanel from './components/stats-panel.tsx'
import CodePanel from './components/code-panel.tsx'
import SettingsDialog from './components/settings-dialog.tsx'
import model from './stores/model-store.js'
import ai from './stores/ai-store.js'

export default class App extends Component {
  tab = 'params'

  template() {
    return (
      <div class="app">
        <header class="topbar">
          <span class="brand">PrintForge</span>
          <input
            class="name-input"
            value={model.name}
            change={(e) => { model.name = e.target.value }}
            aria-label="Model name"
          />
          <span class="spacer"></span>
          {!ai.ready && <span class="badge warn">no API key</span>}
          {model.running && <span class="badge">building</span>}
          <button class="link" click={() => { ai.settingsOpen = true }}>settings</button>
        </header>

        <main class="layout">
          <aside class="col left">
            <ChatPanel />
          </aside>

          <div class="col center">
            <Viewer />
          </div>

          <aside class="col right">
            <nav class="tabs">
              <button class={`tab ${this.tab === 'params' ? 'on' : ''}`} click={() => { this.tab = 'params' }}>Parameters</button>
              <button class={`tab ${this.tab === 'print' ? 'on' : ''}`} click={() => { this.tab = 'print' }}>Print</button>
              <button class={`tab ${this.tab === 'code' ? 'on' : ''}`} click={() => { this.tab = 'code' }}>Code</button>
            </nav>
            {/* All three stay mounted and are only swapped by CSS. Unmounting
                them would throw away the editor state on every tab click. */}
            <div class={`pane ${this.tab === 'params' ? 'on' : ''}`}><ParamPanel /></div>
            <div class={`pane ${this.tab === 'print' ? 'on' : ''}`}><StatsPanel /></div>
            <div class={`pane ${this.tab === 'code' ? 'on' : ''}`}><CodePanel /></div>
          </aside>
        </main>

        <SettingsDialog />
      </div>
    )
  }

  onAfterRender() {
    ai.init()
  }
}
