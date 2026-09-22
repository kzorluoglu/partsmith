import { Component } from '@geajs/core'
import ParamControl from './param-control.tsx'
import FeaturePanel from './feature-panel.tsx'
import model from '../stores/model-store.js'
import { splitCaption, startScrub } from '../lib/param-input.js'

/** Renders the script's getParameterDefinitions() as live controls. */
export default class ParamPanel extends Component {
  template() {
    const { paramDefs, params } = model
    const usable = paramDefs.filter((def) => def && def.name && def.type !== 'group')

    return (
      <section class="panel params">
        <header class="panel-head">
          <h2>Parameters</h2>
          {usable.length > 0 && <button class="link" click={() => model.resetParams()}>reset</button>}
        </header>

        {usable.length === 0 && (
          <p class="empty">This script has no getParameterDefinitions(). Ask the model to make the dimensions adjustable.</p>
        )}

        <div class="param-list">
          {usable.map((def) => (
            <div key={def.name} class="param">
              <label
                class={`param-label ${isNumeric(def) ? 'scrub' : ''}`}
                title={isNumeric(def) ? 'Drag sideways to change, Shift for big steps' : ''}
                pointerdown={(e) => { if (isNumeric(def)) startScrub(e, def, params[def.name]) }}
              >
                <span>{splitCaption(def).label}</span>
                {isNumeric(def) && <span class="param-range">{rangeText(def)}</span>}
              </label>
              <ParamControl def={def} value={params[def.name]} />
            </div>
          ))}
          <FeaturePanel />
        </div>
      </section>
    )
  }
}

const isNumeric = (def) => !['checkbox', 'choice', 'text'].includes(def.type)

const rangeText = (def) => (def.min != null && def.max != null ? `${def.min}–${def.max}` : '')
