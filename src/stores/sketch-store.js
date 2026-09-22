import { Store } from '@geajs/core'

/**
 * What the sketch HUD and the rail show. The tool logic itself lives in
 * lib/sketcher.js and writes here; templates only read.
 *
 * No constructor: Gea only compiles constructor-less stores into their
 * reactive form, see settings-store.js.
 */
class SketchStore extends Store {
  tool = null            // line | rect | circle | polygon | ellipse | measure | null
  phase = 'idle'         // idle | draw | extrude
  hint = ''
  rectMode = 'corner'    // corner | center
  sides = 6
  depth = 0
  measureText = ''
}

export default new SketchStore()
