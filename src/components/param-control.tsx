import model from '../stores/model-store.js'
import { splitCaption, bounds, format, setSoon, setNow, onKeydown } from '../lib/param-input.js'

/**
 * One control for one script parameter. This lives in its own function
 * component because Gea only compiles JSX inside template() or a default
 * exported function, not inside an ordinary helper method.
 */
export default function ParamControl({ def, value }) {
  const type = def.type || 'float'
  const numeric = type !== 'checkbox' && type !== 'choice' && type !== 'text'

  const { min, max, step } = bounds(def, value)
  const { unit } = splitCaption(def)
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

      {/* Slider for feel, the unit box for exact numbers: typing rebuilds
          after a short pause, Enter at once, arrow keys step. */}
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
          <label class="unit-input">
            <input
              type="text"
              inputmode="decimal"
              value={format(def, value)}
              input={(e) => setSoon(def, e.target.value)}
              change={(e) => setNow(def, e.target.value)}
              keydown={(e) => onKeydown(e, def, value)}
            />
            <span>{unit}</span>
          </label>
        </div>
      )}
    </div>
  )
}
