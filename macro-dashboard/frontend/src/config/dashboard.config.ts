export interface DashboardChartConfig {
  key: string;
  title: string;
  seriesKeys: string[];
  xAxis: 'time';
  yAxisFormat: 'percent';
  colorTokens: string[];
  tooltipFormat: 'percent';
}

export const DASHBOARD_CONFIG: DashboardChartConfig[] = [
  {
    key: 'gdp',
    title: 'GDP YoY (%)',
    seriesKeys: ['us_gdp_yoy', 'cn_gdp_yoy'],
    xAxis: 'time',
    yAxisFormat: 'percent',
    colorTokens: ['#0353a4', '#0466c8'],
    tooltipFormat: 'percent'
  },
  {
    key: 'cpi',
    title: 'CPI YoY (%)',
    seriesKeys: ['us_cpi_yoy', 'cn_cpi_yoy'],
    xAxis: 'time',
    yAxisFormat: 'percent',
    colorTokens: ['#3a7d44', '#7fb069'],
    tooltipFormat: 'percent'
  },
  {
    key: 'ppi',
    title: 'PPI YoY (%)',
    seriesKeys: ['us_ppi_yoy', 'cn_ppi_yoy'],
    xAxis: 'time',
    yAxisFormat: 'percent',
    colorTokens: ['#ef476f', '#ff7b00'],
    tooltipFormat: 'percent'
  }
];
