import { Component } from '@geajs/core'
import ParamControl from './param-control.tsx'
import model from '../stores/model-store.js'

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
              <label class="param-label">
                <span>{def.caption || def.name}</span>
                <span class="param-value">{formatValue(def, params[def.name])}</span>
              </label>
              <ParamControl def={def} value={params[def.name]} />
            </div>
          ))}
        </div>
      </section>
    )
  }
}

const formatValue = (def, value) => {
  if (def.type === 'checkbox') return value ? 'on' : 'off'
  if (def.type === 'choice' || def.type === 'text') return ''
  const number = Number(value ?? 0)
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}
