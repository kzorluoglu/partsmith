import { Component } from '@geajs/core'
import parts from '../stores/parts-store.js'

/**
 * Bottom centre, like the sketch HUD: what can be done with the selected
 * part. Once parts are moved or hidden it stays up with a Reset, so getting
 * back to the assembled model is always one click away.
 *
 * The drag readout changes on every pointer move, so the markup is fixed and
 * only text and classes change, no conditional blocks come and go.
 */
export default class PartHud extends Component {
  template() {
    const { selected, moving, changed, hint } = parts
    const picked = selected >= 0
    return (
      <div class={`sketch-hud ${picked || changed ? 'open' : ''}`}>
        <div class="hud-row">
          <span class={`part-name ${picked ? '' : 'gone'}`}>Part {selected + 1}</span>
          <span class={`hud-hint ${moving ? 'part-moving' : ''}`}>{hint}</span>
          <div class="hud-actions">
            <button class={`seg ${picked ? '' : 'gone'}`} title="Hide this part (H)" click={() => parts.setVisible(parts.selected, false)}><span class="ico sm i-eye-off"></span>Hide</button>
            <button class={`seg ${picked ? '' : 'gone'}`} title="Show only this part, again for all" click={() => parts.isolate(parts.selected)}>Isolate</button>
            <button class="seg" disabled={!changed} title="Put every part back and show all" click={() => parts.reset()}><span class="ico sm i-undo"></span>Reset</button>
            <button class={`seg ${picked ? '' : 'gone'}`} title="Deselect (Esc)" click={() => parts.select(-1)}><span class="ico sm i-close"></span></button>
          </div>
        </div>
      </div>
    )
  }
}
