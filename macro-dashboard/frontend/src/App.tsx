import { useCallback, useEffect, useState } from 'react';
import { apiClient, type DashboardView, type HealthResponse } from './api/client';
import { KpiStrip } from './components/KpiStrip';
import { MacroChartPanel } from './components/MacroChartPanel';
import { SyncStatusBar } from './components/SyncStatusBar';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [healthResult, dashboardResult] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getDashboard()
      ]);
      setHealth(healthResult);
      setDashboard(dashboardResult);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await apiClient.sync();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  return (
    <main className="app-shell">
      <div className="mesh mesh-a" />
      <div className="mesh mesh-b" />

      <header className="hero">
        <p className="eyebrow">Macro Data Command Deck</p>
        <h1>Macro Dashboard V1</h1>
        <p className="subtitle">FRED + NBS | Config Driven Charts | Extensible Series Registry</p>
      </header>

      <SyncStatusBar health={health} syncing={syncing} onSync={handleSync} />
      <KpiStrip dashboard={dashboard} />

      {error && <div className="error-box">{error}</div>}

      <section className="chart-grid">
        {(dashboard?.charts ?? []).map((chart) => (
          <MacroChartPanel key={chart.key} chart={chart} />
        ))}
      </section>
    </main>
  );
}
