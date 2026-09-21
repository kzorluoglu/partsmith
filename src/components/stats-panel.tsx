import { Component } from '@geajs/core'
import model from '../stores/model-store.js'
import settings from '../stores/settings-store.js'
import { PRINTERS, MATERIALS } from '../lib/print.js'

/** Measurements, print warnings and the material estimate. */
export default class StatsPanel extends Component {
  template() {
    const { stats, warnings, material, cost, exportInfo } = model

    return (
      <section class="panel stats">
        <header class="panel-head"><h2>Print check</h2></header>

        <div class="field-row">
          <label class="field">
            <span>Printer</span>
            <select change={(e) => settings.set('printerId', e.target.value)}>
              {PRINTERS.map((printer) => (
                <option key={printer.id} value={printer.id} selected={printer.id === settings.printerId}>
                  {printer.name}
                </option>
              ))}
            </select>
          </label>

          <label class="field">
            <span>Material</span>
            <select change={(e) => settings.set('materialId', e.target.value)}>
              {MATERIALS.map((entry) => (
                <option key={entry.id} value={entry.id} selected={entry.id === settings.materialId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          <label class="field">
            <span>Infill {Math.round(settings.infill * 100)}%</span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={settings.infill}
              input={(e) => settings.set('infill', Number(e.target.value))}
            />
          </label>
        </div>

        {!stats && <p class="empty">Nothing built yet.</p>}

        {stats && (
          <dl class="metrics">
            <div class="metric">
              <dt>Size</dt>
              <dd>{stats.size.map((n) => n.toFixed(1)).join(' × ')} mm</dd>
            </div>
            <div class="metric">
              <dt>Volume</dt>
              <dd>{(stats.volume / 1000).toFixed(2)} cm³</dd>
            </div>
            <div class="metric">
              <dt>Filament</dt>
              <dd>{material ? `${material.grams.toFixed(1)} g · ${material.meters.toFixed(2)} m` : '—'}</dd>
            </div>
            <div class="metric">
              <dt>Material cost</dt>
              <dd>{cost ? `€${cost.toFixed(2)}` : '—'}</dd>
            </div>
            <div class="metric">
              <dt>Triangles</dt>
              <dd>{stats.triangles.toLocaleString()}</dd>
            </div>
            <div class="metric">
              <dt>Watertight</dt>
              <dd class={stats.manifold ? 'ok' : 'bad'}>{stats.manifold ? 'yes' : 'no, surface is open'}</dd>
            </div>
          </dl>
        )}

        {warnings.map((warning) => (
          <p key={warning.text} class={`warning ${warning.level}`}>{warning.text}</p>
        ))}

        <div class="export-row">
          <button class="button" disabled={!stats} click={() => model.download('stl')}>STL</button>
          <button class="button ghost" disabled={!stats} click={() => model.download('3mf')}>3MF</button>
          <button class="button ghost" click={() => model.downloadScript()}>script</button>
        </div>

        {exportInfo && <p class="hint">{exportInfo}</p>}
      </section>
    )
  }
}
