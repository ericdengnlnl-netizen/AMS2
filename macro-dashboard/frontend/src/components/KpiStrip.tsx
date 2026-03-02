import type { DashboardView } from '../api/client';

interface Props {
  dashboard: DashboardView | null;
}

function latest(series: { points: Array<{ value: number }> }) {
  const points = series.points;
  if (!points.length) return { value: null as number | null, delta: null as number | null };
  const value = points[points.length - 1].value;
  const prev = points.length > 1 ? points[points.length - 2].value : null;
  return {
    value,
    delta: prev === null ? null : value - prev
  };
}

export function KpiStrip({ dashboard }: Props) {
  const allSeries = dashboard?.charts.flatMap((chart) => chart.series) ?? [];

  return (
    <section className="kpi-strip">
      {allSeries.map((series) => {
        const metric = latest(series);
        return (
          <article key={series.seriesKey} className="kpi-card">
            <p className="kpi-name">{series.displayName}</p>
            <p className="kpi-value">{metric.value === null ? '--' : `${metric.value.toFixed(2)}%`}</p>
            <p className={`kpi-delta ${metric.delta !== null && metric.delta >= 0 ? 'up' : 'down'}`}>
              {metric.delta === null ? '--' : `${metric.delta >= 0 ? '+' : ''}${metric.delta.toFixed(2)}pp`}
            </p>
          </article>
        );
      })}
    </section>
  );
}
