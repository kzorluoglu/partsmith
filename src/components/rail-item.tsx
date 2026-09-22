/** One rail entry: round icon tile, label and an optional sub line. */
export default function RailItem({ label, sub, icon, active, onPress }) {
  return (
    <button class={`rail-item ${active ? 'on' : ''}`} click={() => onPress()}>
      <span class="rail-tile"><span class={`ico ${icon}`}></span></span>
      <span class="rail-text">
        <span class="rail-label">{label}</span>
        {sub && <span class="rail-sub">{sub}</span>}
      </span>
    </button>
  )
}
