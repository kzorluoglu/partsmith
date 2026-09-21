import { Component } from '@geajs/core'
import FeatureRow from './feature-row.tsx'
import model from '../stores/model-store.js'

/** The committed sketch features, editable and bakeable into the script. */
export default class FeaturePanel extends Component {
  template() {
    const { features } = model
    const any = features.length > 0

    return (
      <section class="features">
        <header class="panel-head">
          <h2>Sketch features</h2>
          {any && (
            <div class="panel-head-actions">
              <button class="link" click={() => model.clearFeatures()}>clear</button>
              <button class="button small" click={() => model.bakeFeatures()}>bake into script</button>
            </div>
          )}
        </header>

        {!any && (
          <p class="empty">None yet. Click a face in the viewer, pick rect or circle, drag, set a depth.</p>
        )}

        <ul class="feature-list">
          {features.map((f) => (
            <li key={f.id} class="feature-item">
              <FeatureRow feature={f} />
            </li>
          ))}
        </ul>
      </section>
    )
  }
}
