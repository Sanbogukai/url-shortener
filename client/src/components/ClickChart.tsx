// The 30-day bar chart on the stats page: one bar per UTC day, oldest on the left.
// One series, so there is no legend; the heading names it. A readout above the bars shows
// the hovered day, and a table view lists every day for screen readers and exact values.

// Which bar the pointer is over, and a handle on the scroll box.
import { useEffect, useRef, useState } from 'react'
// One chart entry: a day and its clicks.
import type { DayCount } from '../../../shared/types.ts'
// Labels.
import { clicksLabel, formatDay } from '../format.ts'

// Geometry in SVG units. The SVG scales to its box, so these set proportions, not pixels.
// Each day takes BAR_STEP; the bar fills BAR_WIDTH of it, leaving a gap between bars.
const BAR_STEP = 20
const BAR_WIDTH = 16
// Room for the plot, and below it for the day labels.
const PLOT_HEIGHT = 140
const LABEL_HEIGHT = 22
// Space above the tallest bar, room for the maximum label over the top grid line.
const TOP_PAD = 16
// Room left and right of the bars, so a centred day label at either end is not cut off.
const SIDE_PAD = 16
// Rounding on the top corners of each bar; the bottom stays square on the baseline.
const RADIUS = 4
// A day with clicks always shows at least this tall, so a 1 next to a 300 is still visible.
const MIN_BAR = 2
// Every seventh day gets a label, counted back from today, so today is always labelled.
const LABEL_EVERY = 7
// The day labels sit this far below the baseline.
const LABEL_OFFSET = 16
// The maximum's label sits this far above its grid line.
const AXIS_GAP = 2
// Halving, for centring a bar or a label in its slot.
const HALF = 2

// The outline of one bar: square at the bottom, rounded at the top. A bar shorter than the
// rounding is drawn as a plain rectangle, since the curves would not fit.
function barPath(x: number, y: number, width: number, height: number): string {
  // The baseline the bar stands on.
  const bottom = y + height
  if (height < RADIUS) return `M${x},${bottom}V${y}H${x + width}V${bottom}Z`
  // Up the left side, round the top-left corner, across, round the top-right, down.
  return [
    `M${x},${bottom}`,
    `V${y + RADIUS}`,
    `Q${x},${y} ${x + RADIUS},${y}`,
    `H${x + width - RADIUS}`,
    `Q${x + width},${y} ${x + width},${y + RADIUS}`,
    `V${bottom}`,
    'Z',
  ].join('')
}

// `daily` is the server's 30 entries, oldest first.
export function ClickChart({ daily }: { daily: DayCount[] }) {
  // The index of the hovered bar, or null when the pointer is elsewhere.
  const [hovered, setHovered] = useState<number | null>(null)
  // The scroll box around the SVG.
  const scroller = useRef<HTMLDivElement>(null)

  // On a phone the chart is wider than the screen. Scrolling to the right end first shows
  // the latest days, which matter most; on a wide screen there is nothing to scroll.
  useEffect(() => {
    // The ref is set once the box is on the page; scrollWidth is its full content width.
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
  }, [])
  // The tallest day sets the scale. At least 1, so an all-zero chart does not divide by 0.
  const max = Math.max(1, ...daily.map((entry) => entry.clicks))
  // The whole drawing's size.
  const width = daily.length * BAR_STEP
  const height = PLOT_HEIGHT + LABEL_HEIGHT
  // The day the readout describes: the hovered one, or else the most recent.
  const shown = daily[hovered ?? daily.length - 1]
  // The plot's usable height under the top padding.
  const usable = PLOT_HEIGHT - TOP_PAD

  return (
    <figure className="chart">
      {/* aria-live off: the readout changes on every pointer move, too often to announce. */}
      <figcaption className="chart-readout">
        {shown && (
          <>
            <strong>{clicksLabel(shown.clicks)}</strong> <span className="muted">on {formatDay(shown.day)}</span>
          </>
        )}
      </figcaption>
      {/* The scroll box lets the chart keep a readable size on a narrow phone. */}
      <div className="chart-scroll" ref={scroller}>
        <svg
          className="chart-svg"
          viewBox={`${-SIDE_PAD} 0 ${width + SIDE_PAD + SIDE_PAD} ${height}`}
          role="img"
          aria-label={`Clicks per day for the last ${daily.length} days, up to ${clicksLabel(max)} in a day. The table below lists every day.`}
          onMouseLeave={() => setHovered(null)}
        >
          {/* The top grid line marks the scale's maximum; the label names it. */}
          <line className="chart-grid" x1={0} x2={width} y1={TOP_PAD} y2={TOP_PAD} />
          <text className="chart-axis" x={width} y={TOP_PAD - AXIS_GAP} textAnchor="end">
            {max}
          </text>
          {daily.map((entry, index) => {
            // Bar height in proportion to the maximum, with a visible minimum for non-zero days.
            const scaled = (entry.clicks / max) * usable
            const barHeight = entry.clicks > 0 ? Math.max(MIN_BAR, scaled) : 0
            // Left edge of this day's slot, and of the bar centred in it.
            const slot = index * BAR_STEP
            const x = slot + (BAR_STEP - BAR_WIDTH) / HALF
            // Whether this day gets a date label under it.
            const labelled = (daily.length - 1 - index) % LABEL_EVERY === 0
            return (
              <g key={entry.day} onMouseEnter={() => setHovered(index)}>
                {/* An invisible full-height target, so a short bar is as easy to hover as a tall one. */}
                <rect className="chart-hit" x={slot} y={0} width={BAR_STEP} height={PLOT_HEIGHT} />
                {barHeight > 0 && (
                  <path
                    className={hovered === index ? 'chart-bar active' : 'chart-bar'}
                    d={barPath(x, PLOT_HEIGHT - barHeight, BAR_WIDTH, barHeight)}
                  />
                )}
                {labelled && (
                  <text className="chart-axis" x={slot + BAR_STEP / HALF} y={PLOT_HEIGHT + LABEL_OFFSET} textAnchor="middle">
                    {formatDay(entry.day)}
                  </text>
                )}
              </g>
            )
          })}
          {/* The baseline, drawn last so it sits over the bar bottoms. */}
          <line className="chart-baseline" x1={0} x2={width} y1={PLOT_HEIGHT} y2={PLOT_HEIGHT} />
        </svg>
      </div>
      {/* The same numbers as a table: exact values, and readable without the picture. */}
      <details className="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Day (UTC)</th>
              <th scope="col">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {/* Newest first, the order people read a log in. */}
            {daily.toReversed().map((entry) => (
              <tr key={entry.day}>
                <td>{formatDay(entry.day)}</td>
                <td>{entry.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
