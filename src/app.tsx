import { Component } from '@geajs/core'
import Viewer from './components/viewer.tsx'
import ProjectBar from './components/project-bar.tsx'
import Rail from './components/rail.tsx'
import PromptBar from './components/prompt-bar.tsx'
import ChatPanel from './components/chat-panel.tsx'
import ParamPanel from './components/param-panel.tsx'
import StatsPanel from './components/stats-panel.tsx'
import CodePanel from './components/code-panel.tsx'
import SettingsDialog from './components/settings-dialog.tsx'
import ai from './stores/ai-store.js'
import ui from './stores/ui-store.js'

const TITLES = { chat: 'Generate', params: 'Parameters', code: 'Script', print: 'Print check' }

/**
 * The viewport fills the window and every control floats on top of it, the
 * layout of Shapr3D and friends. The side panels stay mounted and are only
 * swapped by CSS, unmounting would throw away the editor state.
 */
export default class App extends Component {
  template() {
    const { panel } = ui
    return (
      <div class={`shell ${panel ? 'dock-open' : ''}`}>
        <Viewer />
        <ProjectBar />
        <Rail />

        <aside class={`dock ${panel ? 'open' : ''}`}>
          <header class="dock-head">
            <h2>{TITLES[panel] || ''}</h2>
            <button class="icon-button small" title="Close panel" click={() => ui.togglePanel(panel)}>×</button>
          </header>
          <div class={`dock-pane ${panel === 'chat' ? 'on' : ''}`}><ChatPanel /></div>
          <div class={`dock-pane ${panel === 'params' ? 'on' : ''}`}><ParamPanel /></div>
          <div class={`dock-pane ${panel === 'code' ? 'on' : ''}`}><CodePanel /></div>
          <div class={`dock-pane ${panel === 'print' ? 'on' : ''}`}><StatsPanel /></div>
        </aside>

        <PromptBar />
        <SettingsDialog />
      </div>
    )
  }

  onAfterRender() {
    ai.init()
  }
}
