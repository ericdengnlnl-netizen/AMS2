import { describe, expect, it } from 'vitest';
import { buildChartOption } from '../utils/chart';

describe('chart builder', () => {
  it('builds echarts series from config data', () => {
    const option = buildChartOption({
      key: 'gdp',
      title: 'GDP YoY (%)',
      seriesKeys: ['us_gdp_yoy'],
      xAxis: 'time',
      yAxisFormat: 'percent',
      tooltipFormat: 'percent',
      colorTokens: ['#000'],
      series: [
        {
          seriesKey: 'us_gdp_yoy',
          displayName: 'US GDP YoY',
          source: 'FRED',
          frequency: 'Q',
          unit: '%',
          points: [
            {
              date: '2026-01-01',
              periodLabel: '2026-Q1',
              rawValue: 100,
              value: 2.3,
              sourceCode: 'GDP'
            }
          ]
        }
      ]
    });

    expect(option.series).toBeDefined();
    const lines = option.series as Array<{ name: string }>;
    expect(lines[0].name).toBe('US GDP YoY');
  });
});
