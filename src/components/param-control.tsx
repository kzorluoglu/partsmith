import model from '../stores/model-store.js'

/**
 * One control for one script parameter. This lives in its own function
 * component because Gea only compiles JSX inside template() or a default
 * exported function, not inside an ordinary helper method.
 */
export default function ParamControl({ def, value }) {
  const type = def.type || 'float'
  const numeric = type !== 'checkbox' && type !== 'choice' && type !== 'text'

  const min = def.min ?? 0
  const max = def.max ?? Math.max(100, Number(value) * 2 || 100)
  const step = def.step ?? (type === 'int' ? 1 : 0.1)
  const values = def.values || []
  const captions = def.captions || values

  return (
    <div class="param-control">
      {type === 'checkbox' && (
        <input
          type="checkbox"
          class="param-check"
          checked={Boolean(value)}
          change={(e) => model.setParam(def.name, e.target.checked)}
        />
      )}

      {type === 'choice' && (
        <select class="param-select" change={(e) => model.setParam(def.name, e.target.value)}>
          {values.map((option, index) => (
            <option key={option} value={option} selected={String(option) === String(value)}>
              {captions[index] ?? option}
            </option>
          ))}
        </select>
      )}

      {type === 'text' && (
        <input
          type="text"
          class="param-text"
          value={value ?? ''}
          change={(e) => model.setParam(def.name, e.target.value)}
        />
      )}

      {/* A bare slider is useless when someone needs 6.35 mm on the nose, so
          numbers get the slider and an exact box side by side. */}
      {numeric && (
        <div class="param-number">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(value ?? min)}
            input={(e) => model.setParam(def.name, Number(e.target.value))}
          />
          <input
            type="number"
            class="param-exact"
            min={min}
            max={max}
            step={step}
            value={Number(value ?? min)}
            change={(e) => model.setParam(def.name, Number(e.target.value))}
          />
        </div>
      )}
    </div>
  )
}
