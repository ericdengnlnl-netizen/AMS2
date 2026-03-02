const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:4000/api/v1';

interface ApiEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return body.result;
}

export interface SeriesPoint {
  date: string;
  periodLabel: string;
  rawValue: number;
  value: number;
  sourceCode: string;
}

export interface DashboardSeries {
  seriesKey: string;
  displayName: string;
  source: 'FRED' | 'NBS';
  frequency: 'M' | 'Q';
  unit: string;
  points: SeriesPoint[];
}

export interface DashboardChart {
  key: string;
  title: string;
  seriesKeys: string[];
  xAxis: 'time';
  yAxisFormat: 'percent';
  tooltipFormat: 'percent';
  colorTokens: string[];
  series: DashboardSeries[];
}

export interface DashboardView {
  view: string;
  title: string;
  charts: DashboardChart[];
}

export interface HealthResponse {
  ok: boolean;
  now: string;
  latestRun: {
    id: string;
    status: 'RUNNING' | 'SUCCESS' | 'FAILED';
    triggerType: 'MANUAL' | 'SCHEDULED';
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

export interface SyncResponse {
  runId: string;
  status: 'SUCCESS' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  stats: {
    seriesCount: number;
    observationInserted: number;
    perSeries: Array<{
      seriesKey: string;
      inserted: number;
      fetched: number;
      sourceCode: string;
    }>;
  };
}

export const apiClient = {
  getHealth: () => request<HealthResponse>('/health'),
  getDashboard: () => request<DashboardView>('/dashboard?view=macro-core'),
  sync: () => request<SyncResponse>('/sync', { method: 'POST', body: JSON.stringify({}) })
};
