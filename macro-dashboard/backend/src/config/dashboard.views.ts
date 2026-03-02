export interface DashboardViewChartConfig {
  key: string;
  title: string;
  seriesKeys: string[];
  xAxis: 'time';
  yAxisFormat: 'percent';
  tooltipFormat: 'percent';
  colorTokens: string[];
}

export interface DashboardViewConfig {
  key: string;
  title: string;
  charts: DashboardViewChartConfig[];
}

export const DASHBOARD_VIEWS: DashboardViewConfig[] = [
  {
    key: 'macro-core',
    title: 'Macro Core Dashboard',
    charts: [
      {
        key: 'gdp',
        title: 'GDP YoY (%)',
        seriesKeys: ['us_gdp_yoy', 'cn_gdp_yoy'],
        xAxis: 'time',
        yAxisFormat: 'percent',
        tooltipFormat: 'percent',
        colorTokens: ['#005f73', '#0a9396']
      },
      {
        key: 'cpi',
        title: 'CPI YoY (%)',
        seriesKeys: ['us_cpi_yoy', 'cn_cpi_yoy'],
        xAxis: 'time',
        yAxisFormat: 'percent',
        tooltipFormat: 'percent',
        colorTokens: ['#bb3e03', '#ee9b00']
      },
      {
        key: 'ppi',
        title: 'PPI YoY (%)',
        seriesKeys: ['us_ppi_yoy', 'cn_ppi_yoy'],
        xAxis: 'time',
        yAxisFormat: 'percent',
        tooltipFormat: 'percent',
        colorTokens: ['#264653', '#2a9d8f']
      }
    ]
  }
];

export const DASHBOARD_VIEW_BY_KEY = new Map(DASHBOARD_VIEWS.map((view) => [view.key, view]));
