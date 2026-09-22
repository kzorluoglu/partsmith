import App from './app.tsx'
import model from './stores/model-store.js'
import ai from './stores/ai-store.js'
import settings from './stores/settings-store.js'
import * as runner from './lib/runner.js'
import * as scene from './lib/scene.js'
import sketch from './stores/sketch-store.js'
import ui from './stores/ui-store.js'
import './styles.css'
import './icons.css'

const root = document.getElementById('app')
if (!root) throw new Error('#app root element is missing')

new App().render(root)

// Handy in the console while working on a script: partsmith.model.run() etc.
if (import.meta.env.DEV) {
  window.partsmith = { model, ai, settings, runner, scene, sketch, ui }
}
