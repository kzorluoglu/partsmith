import { Component } from '@geajs/core'
import sketch from '../stores/sketch-store.js'
import * as sketcher from '../lib/sketcher.js'

/**
 * Bottom centre, above the prompt: one line saying what the next click does,
 * and while extruding the Apply / Flip / Cancel buttons.
 */
export default class SketchHud extends Component {
  template() {
    const { tool, phase, hint, depth, measureText } = sketch
    const extruding = phase === 'extrude'
    const cut = depth < 0
    return (
      <div class={`sketch-hud ${tool ? 'open' : ''}`}>
        {measureText && <div class="hud-result"><span class="ico sm i-measure"></span>{measureText}</div>}
        <div class="hud-row">
          <span class="hud-hint">{hint}</span>
          {extruding && (
            <div class="hud-actions">
              <span class={`hud-mode ${cut ? 'cut' : 'add'}`}>{cut ? 'Cut' : 'Add'} {Math.abs(depth).toFixed(1)} mm</span>
              <button class="seg" title="Switch between adding and cutting" click={() => sketcher.flipDepth()}>Flip</button>
              <button class="button small" click={() => sketcher.apply()}><span class="ico sm i-check"></span>Apply</button>
              <button class="seg" click={() => sketcher.cancel()}>Cancel</button>
            </div>
          )}
          {!extruding && phase === 'draw' && (
            <button class="seg" click={() => sketcher.cancel()}>Cancel</button>
          )}
          {tool === 'measure' && measureText && (
            <button class="seg" click={() => sketcher.cancel()}>Clear</button>
          )}
        </div>
      </div>
    )
  }
}
