import { chartScale, formatAxis } from "../homeRules";

// Month bar chart drawn as plain SVG (no chart package), on the design's own grid: a 360 × 200 view box,
// bars between x 34–354 and y 16–174, four horizontal guide lines, month names under the bars.
// One series draws one 24 px bar per month with its value above; two series draw a pair of narrower bars.
//   bars:   [{ key, label, values: [number, …] }]
//   series: [{ name, color }]
//   formatValue: optional, writes the number above single bars
//   axisUnit: the axis shows value / axisUnit (money charts use 1000, like the design: 200 = 200.000 TL)
const LEFT = 34;
const RIGHT = 354;
const TOP = 16;
const BOTTOM = 174;
const PLOT_HEIGHT = BOTTOM - TOP;

export default function BarChart({ bars, series, formatValue, title, axisUnit = 1 }) {
  const max = Math.max(0, ...bars.flatMap((bar) => bar.values));
  const scale = chartScale(max);
  const slot = (RIGHT - LEFT) / bars.length;
  const paired = series.length > 1;
  const width = paired ? 19.67 : 24;
  const y = (value) => BOTTOM - (value / scale.max) * PLOT_HEIGHT;

  return (
    <svg viewBox="0 0 360 200" width="100%" role="img" aria-label={title} className="home-chart">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)} stroke="#e1e7ed" />
          <text x={LEFT - 5} y={y(tick) + 4} fontSize="10" textAnchor="end" fill="#6c7a89">
            {formatAxis(tick / axisUnit)}
          </text>
        </g>
      ))}
      {bars.map((bar, index) => {
        const center = LEFT + slot * index + slot / 2;
        return (
          <g key={bar.key}>
            {bar.values.map((value, part) => {
              if (!(value > 0)) return null;
              const x = paired ? center - 21.67 + part * 21.67 : center - width / 2;
              const height = BOTTOM - y(value);
              return (
                <rect key={part} x={x} y={BOTTOM - height} width={width} height={height} rx="4" fill={series[part].color}>
                  <title>{`${bar.label} · ${series[part].name}: ${formatValue ? formatValue(value) : value}`}</title>
                </rect>
              );
            })}
            {!paired && formatValue && (
              <text
                x={center}
                y={bar.values[0] > 0 ? Math.max(26, y(bar.values[0]) - 4) : BOTTOM - 4}
                fontSize="8"
                fontWeight="700"
                textAnchor="middle"
                fill="#244D9C"
              >
                {formatValue(bar.values[0])}
              </text>
            )}
            <text x={center + 1} y="192" fontSize="11" textAnchor="middle" fill="#6c7a89">
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
