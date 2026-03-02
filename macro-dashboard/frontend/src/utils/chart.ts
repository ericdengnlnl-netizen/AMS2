import type { EChartsOption } from 'echarts';
import type { DashboardChart, DashboardSeries } from '../api/client';

function toSeriesLine(series: DashboardSeries, color: string): Record<string, unknown> {
  return {
    type: 'line',
    smooth: true,
    showSymbol: false,
    name: series.displayName,
    data: series.points.map((p) => [p.date, p.value]),
    lineStyle: {
      width: 2,
      color
    },
    areaStyle: {
      opacity: 0.08,
      color
    }
  };
}

export function buildChartOption(chart: DashboardChart): EChartsOption {
  return {
    animationDuration: 450,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => `${Number(value).toFixed(2)}%`
    },
    legend: {
      top: 4,
      textStyle: {
        color: '#dbe6ff'
      }
    },
    grid: {
      left: 48,
      right: 20,
      top: 44,
      bottom: 34
    },
    xAxis: {
      type: 'time',
      axisLabel: {
        color: '#9fb0d3'
      },
      axisLine: {
        lineStyle: {
          color: '#3b4d73'
        }
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#9fb0d3',
        formatter: '{value}%'
      },
      splitLine: {
        lineStyle: {
          color: '#273754'
        }
      }
    },
    series: chart.series.map((series, idx) => toSeriesLine(series, chart.colorTokens[idx % chart.colorTokens.length]))
  };
}
