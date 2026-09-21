import model from '../stores/model-store.js'
import { describeFeature, describeNormal } from '../lib/features.js'

/**
 * One committed sketch feature. Its own component because the Gea compiler
 * choked on the same markup inline in a keyed list (undefined element refs).
 */
export default function FeatureRow({ feature }) {
  return (
    <div class={`feature feature-${feature.op}`}>
      <div class="feature-main">
        <span class="feature-title">{describeFeature(feature)}</span>
        <span class="feature-sub">on face {describeNormal(feature.plane.normal)}</span>
      </div>
      <input
        class="param-exact"
        type="number"
        min="0.2"
        step="0.5"
        value={feature.depth}
        change={(e) => model.updateFeature(feature.id, { depth: Math.max(0.2, Number(e.target.value)) })}
      />
      <button class="icon-button small" click={() => model.removeFeature(feature.id)}>×</button>
    </div>
  )
}
