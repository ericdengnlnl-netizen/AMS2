import ReactECharts from 'echarts-for-react';
import type { DashboardChart } from '../api/client';
import { buildChartOption } from '../utils/chart';

interface Props {
  chart: DashboardChart;
}

export function MacroChartPanel({ chart }: Props) {
  return (
    <section className="chart-panel">
      <header>
        <h3>{chart.title}</h3>
      </header>
      <ReactECharts option={buildChartOption(chart)} style={{ height: 340 }} notMerge lazyUpdate />
    </section>
  );
}
