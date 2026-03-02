import type { HealthResponse } from '../api/client';

interface Props {
  health: HealthResponse | null;
  syncing: boolean;
  onSync: () => void;
}

export function SyncStatusBar({ health, syncing, onSync }: Props) {
  const run = health?.latestRun;
  const statusText = run
    ? `${run.status} | ${run.triggerType} | ${new Date(run.startedAt).toLocaleString()}`
    : 'No sync run yet';

  return (
    <section className="status-bar">
      <div>
        <p className="status-label">Sync Status</p>
        <p className="status-value">{statusText}</p>
      </div>
      <button className="sync-btn" onClick={onSync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Manual Sync'}
      </button>
    </section>
  );
}
