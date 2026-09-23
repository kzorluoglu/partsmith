import { Component } from '@geajs/core'
import parts from '../stores/parts-store.js'

const AXES = [
  { id: 'x', index: 0 },
  { id: 'y', index: 1 },
  { id: 'z', index: 2 }
]

/**
 * Parts of a multi part model: hide or solo each one, pull the selected part
 * apart along X, Y and Z, and glide everything back with one click.
 */
export default class PartsPanel extends Component {
  template() {
    const { open, items, selected, span, changed } = parts
    const current = items[selected]
    return (
      <div class={`parts-panel ${open ? 'open' : ''}`}>
        <div class="section-head">
          <span class="section-title">Parts</span>
          <div class="parts-actions">
            <button class="seg" disabled={!changed} title="Put every part back and show all" click={() => parts.reset()}>
              <span class="ico sm i-undo"></span>Reset
            </button>
          </div>
        </div>

        {items.length === 0 && <p class="parts-empty">Nothing built yet.</p>}
        {items.length === 1 && <p class="parts-empty">One solid. Return several from main() to get separate parts.</p>}

        <div class="parts-list">
          {items.map((item, i) => (
            <div key={i} class={`part-row ${i === selected ? 'on' : ''} ${item.visible ? '' : 'hidden'}`} click={() => parts.select(i)}>
              <button
                class={`tbtn small ${item.visible ? 'on' : ''}`}
                title={item.visible ? 'Hide' : 'Show'}
                click={(e) => { e.stopPropagation(); parts.setVisible(i, !item.visible) }}
              ><span class={`ico sm ${item.visible ? 'i-eye' : 'i-eye-off'}`}></span></button>
              <span class="part-name">Part {i + 1}</span>
              <span class="part-size">{item.size.map((n) => n.toFixed(0)).join(' × ')}</span>
              <button
                class="seg part-solo"
                title="Show only this part, click again for all"
                click={(e) => { e.stopPropagation(); parts.solo(i) }}
              >Solo</button>
            </div>
          ))}
        </div>

        {current && items.length > 1 && (
          <div class="part-move">
            {AXES.map((a) => (
              <div key={a.id} class="section-row">
                <span class={`axis-tag axis-${a.id}`}>{a.id.toUpperCase()}</span>
                <input
                  type="range"
                  min={-span}
                  max={span}
                  step="0.5"
                  value={current.offset[a.index]}
                  input={(e) => parts.setOffset(selected, a.id, Number(e.target.value))}
                />
                <label class="unit-input">
                  <input
                    type="number"
                    step="1"
                    value={Number(current.offset[a.index]).toFixed(1)}
                    change={(e) => parts.setOffset(selected, a.id, Number(e.target.value))}
                  />
                  <span>mm</span>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
}
