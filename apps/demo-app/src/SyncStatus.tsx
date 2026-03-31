import { useEffect, useState } from 'react';
import { useSdk } from './sdk-context';

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

export function SyncStatus() {
  const sdk = useSdk();
  const [status, setStatus] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle');
  const [online, setOnline] = useState(sdk.isOnlineState());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [counts, setCounts] = useState({ applied: 0, rejected: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Re-render every 30s so relative time stays fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onStart = () => {
      setStatus('syncing');
      setErrorMsg(null);
    };

    const onComplete: Parameters<typeof sdk.on<'sync-complete'>>[1] = (data) => {
      setStatus('synced');
      setLastSync(new Date());
      setErrorMsg(null);
      if (data) setCounts({ applied: data.applied, rejected: data.rejected });
    };

    const onFailed: Parameters<typeof sdk.on<'sync-failed'>>[1] = (data) => {
      setStatus('failed');
      if (data?.error) setErrorMsg(data.error.message);
    };

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    sdk.on('sync-start', onStart);
    sdk.on('sync-complete', onComplete);
    sdk.on('sync-failed', onFailed);
    sdk.on('online', onOnline);
    sdk.on('offline', onOffline);

    return () => {
      sdk.off('sync-start', onStart);
      sdk.off('sync-complete', onComplete);
      sdk.off('sync-failed', onFailed);
      sdk.off('online', onOnline);
      sdk.off('offline', onOffline);
    };
  }, [sdk]);

  const statusColor: Record<typeof status, string> = {
    idle: '#888',
    syncing: '#f0a500',
    synced: '#22c55e',
    failed: '#ef4444',
  };

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: '#555', flexWrap: 'wrap' }}>
      {/* Online/offline dot badge */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: online ? '#22c55e' : '#ef4444',
            boxShadow: online ? '0 0 0 2px #bbf7d0' : '0 0 0 2px #fecaca',
          }}
        />
        <span style={{ color: online ? '#16a34a' : '#dc2626' }}>
          {online ? 'Online' : 'Offline'}
        </span>
      </span>

      {/* Sync status */}
      <span style={{ color: statusColor[status] }}>
        {status === 'syncing' && '⟳ Syncing…'}
        {status === 'synced' && `✓ Synced — ${counts.applied} applied, ${counts.rejected} conflict${counts.rejected === 1 ? '' : 's'}`}
        {status === 'failed' && `✗ Sync failed${errorMsg ? `: ${errorMsg}` : ''}`}
        {status === 'idle' && 'Idle'}
      </span>

      {/* Last sync time */}
      {lastSync && (
        <span style={{ color: '#888' }}>
          Last sync: {formatRelativeTime(lastSync)}
        </span>
      )}

      {/* Manual sync button */}
      <button
        onClick={() => sdk.sync()}
        disabled={status === 'syncing' || !online}
        style={{
          marginLeft: 'auto',
          padding: '3px 10px',
          fontSize: 12,
          cursor: status === 'syncing' || !online ? 'not-allowed' : 'pointer',
          opacity: status === 'syncing' || !online ? 0.5 : 1,
        }}
      >
        Sync now
      </button>
    </div>
  );
}
