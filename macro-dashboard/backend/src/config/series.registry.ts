export type SourceType = 'FRED' | 'NBS';
export type FrequencyType = 'M' | 'Q';

export type TransformConfig =
  | { kind: 'YOY_LAG'; lag: number }
  | { kind: 'INDEX_MINUS_100' };

export type FetchConfig =
  | {
      type: 'FRED';
      seriesId: string;
    }
  | {
      type: 'NBS';
      dbcode: 'hgyd' | 'hgjd';
      valueCodeChain: string[];
      windowCode: 'LAST36' | 'LAST18';
    };

export interface SeriesRegistryItem {
  seriesKey: string;
  displayName: string;
  source: SourceType;
  frequency: FrequencyType;
  unit: string;
  fetchConfig: FetchConfig;
  transformConfig: TransformConfig;
  chartGroup: 'GDP' | 'CPI' | 'PPI';
}

export const SERIES_REGISTRY: SeriesRegistryItem[] = [
  {
    seriesKey: 'us_gdp_yoy',
    displayName: 'US GDP YoY',
    source: 'FRED',
    frequency: 'Q',
    unit: '%',
    fetchConfig: { type: 'FRED', seriesId: 'GDP' },
    transformConfig: { kind: 'YOY_LAG', lag: 4 },
    chartGroup: 'GDP'
  },
  {
    seriesKey: 'cn_gdp_yoy',
    displayName: 'China GDP YoY',
    source: 'NBS',
    frequency: 'Q',
    unit: '%',
    fetchConfig: {
      type: 'NBS',
      dbcode: 'hgjd',
      valueCodeChain: ['A010101'],
      windowCode: 'LAST18'
    },
    transformConfig: { kind: 'YOY_LAG', lag: 4 },
    chartGroup: 'GDP'
  },
  {
    seriesKey: 'us_cpi_yoy',
    displayName: 'US CPI YoY',
    source: 'FRED',
    frequency: 'M',
    unit: '%',
    fetchConfig: { type: 'FRED', seriesId: 'CPIAUCSL' },
    transformConfig: { kind: 'YOY_LAG', lag: 12 },
    chartGroup: 'CPI'
  },
  {
    seriesKey: 'cn_cpi_yoy',
    displayName: 'China CPI YoY',
    source: 'NBS',
    frequency: 'M',
    unit: '%',
    fetchConfig: {
      type: 'NBS',
      dbcode: 'hgyd',
      valueCodeChain: ['A01010J01', 'A01010G01', 'A01010101'],
      windowCode: 'LAST36'
    },
    transformConfig: { kind: 'INDEX_MINUS_100' },
    chartGroup: 'CPI'
  },
  {
    seriesKey: 'us_ppi_yoy',
    displayName: 'US PPI YoY',
    source: 'FRED',
    frequency: 'M',
    unit: '%',
    fetchConfig: { type: 'FRED', seriesId: 'PPIACO' },
    transformConfig: { kind: 'YOY_LAG', lag: 12 },
    chartGroup: 'PPI'
  },
  {
    seriesKey: 'cn_ppi_yoy',
    displayName: 'China PPI YoY',
    source: 'NBS',
    frequency: 'M',
    unit: '%',
    fetchConfig: {
      type: 'NBS',
      dbcode: 'hgyd',
      valueCodeChain: ['A01080101'],
      windowCode: 'LAST36'
    },
    transformConfig: { kind: 'INDEX_MINUS_100' },
    chartGroup: 'PPI'
  }
];

export const SERIES_BY_KEY = new Map(SERIES_REGISTRY.map((item) => [item.seriesKey, item]));
